import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import express from 'express';
import { createClient, createAccount } from 'genlayer-js';
import { localnet } from 'genlayer-js/chains';
import { TransactionStatus } from 'genlayer-js/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(join(__dirname, 'public')));

const REPO_ROOT = join(__dirname, '..');

function makeClient() {
  const rpcUrl = process.env.RPC_URL || 'http://localhost:8080';
  console.log('Creating client with RPC:', rpcUrl);
  const account = createAccount(process.env.PRIVATE_KEY);
  return createClient({ chain: localnet, endpoint: rpcUrl, account });
}

// Map status to terminal states
const TERMINAL_STATUSES = new Set([
  'FINALIZED',
  'ACCEPTED',
  'UNDETERMINED',
  'CANCELED',
  'LEADER_TIMEOUT',
  'VALIDATORS_TIMEOUT',
]);

const FAILED_STATUSES = new Set([
  'UNDETERMINED',
  'CANCELED',
  'LEADER_TIMEOUT',
  'VALIDATORS_TIMEOUT',
]);

function isTerminal(status) {
  return TERMINAL_STATUSES.has(status);
}

function isFailed(status) {
  return FAILED_STATUSES.has(status);
}

/**
 * Parse the audit result from the contract.
 * The contract returns JSON format:
 *   {"overall": int, "quality": int, "security": int, "summary": str, "vulnerabilities": str}
 */
function parseScoreResult(raw) {
  let text = typeof raw === 'string' ? raw : JSON.stringify(raw);
  text = text.trim();

  // Try parsing as JSON first (new contract format)
  try {
    const data = JSON.parse(text);
    if (typeof data === 'object' && data !== null) {
      let vulnerabilities = [];
      if (data.vulnerabilities) {
        try {
          vulnerabilities = JSON.parse(data.vulnerabilities);
        } catch {
          vulnerabilities = typeof data.vulnerabilities === 'string'
            ? JSON.parse(data.vulnerabilities)
            : (data.vulnerabilities || []);
        }
      }
      return {
        overall: data.overall ?? data.overall ?? null,
        quality: data.quality ?? data.quality ?? null,
        security: data.security ?? data.security ?? null,
        summary: data.summary || '',
        vulnerabilities: Array.isArray(vulnerabilities) ? vulnerabilities : [],
      };
    }
  } catch { /* not JSON, try old format */ }

  // Fallback to old text format parsing
  text = text.replace(/\\n/g, '\n').trim();
  const result = { overall: null, quality: null, security: null, summary: '', vulnerabilities: [] };

  const m = text.match(/Overall:\s*(\d+)\s*\|\s*Quality:\s*(\d+)\s*\|\s*Security:\s*(\d+)/i);
  if (m) {
    result.overall = parseInt(m[1]);
    result.quality = parseInt(m[2]);
    result.security = parseInt(m[3]);
  }

  const sm = text.match(/Summary:\s*(.+)/i);
  if (sm) {
    result.summary = sm[1].trim();
  }

  result.vulnerabilities = (text.match(/\[(CRITICAL|MEDIUM|LOW)\][^\n]*/gi) || [])
    .map(line => {
      const v = line.match(/\[(CRITICAL|MEDIUM|LOW)\]\s*(.+)/i);
      return v ? { severity: v[1].toLowerCase(), description: v[2].trim() } : null;
    })
    .filter(Boolean);

  return result;
}

// Track request IDs per address (client-side mapping)
const addressRequestIdMap = new Map();

// ── Example contract ──────────────────────────────────────────────────────────

app.get('/api/example', (req, res) => {
  try {
    const content = readFileSync(join(REPO_ROOT, 'examples', 'bank_vault.py'), 'utf8');
    res.json({ content });
  } catch {
    res.status(404).json({ error: 'Example file not found' });
  }
});

// ── Submit audit transaction ──────────────────────────────────────────────────

app.post('/api/score', async (req, res) => {
  const { sourceCode } = req.body;
  if (!sourceCode) return res.status(400).json({ error: 'sourceCode is required' });

  const address = process.env.CONTRACT_ADDRESS || '';
  if (!address || address.startsWith('0x_')) {
    return res.status(400).json({ error: 'CONTRACT_ADDRESS is not set in .env' });
  }

  try {
    console.log('Submitting score request, contract:', address);
    const client = makeClient();
    const txHash = await client.writeContract({
      address,
      functionName: 'score_contract',
      args: [sourceCode],
      value: 0n,
    });
    console.log('Transaction submitted:', txHash);
    res.json({ txHash, address });
  } catch (err) {
    console.error('score error:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

// ── Poll transaction status ───────────────────────────────────────────────────

app.get('/api/status/:txHash', async (req, res) => {
  const { walletAddress } = req.query;
  const address = process.env.CONTRACT_ADDRESS || '';
  if (!address || address.startsWith('0x_')) {
    return res.status(400).json({ error: 'CONTRACT_ADDRESS is not set in .env' });
  }

  try {
    const client = makeClient();
    console.log('Fetching tx:', req.params.txHash);
    const tx = await client.getTransaction({ hash: req.params.txHash });
    console.log('Got tx:', JSON.stringify(tx).slice(0, 500));
    const status = tx.statusName || tx.status?.name || String(tx.status) || 'UNKNOWN';
    const done = isTerminal(status);

    if (done && isFailed(status)) {
      return res.json({ status, done: true, error: `Transaction ended with status: ${status}` });
    }

    if (done) {
      console.log('Transaction finalized, reading contract with wallet:', walletAddress);
      try {
        const raw = await client.readContract({
          address,
          functionName: 'get_my_audits',
          args: [],
          account: walletAddress,
        });
        console.log('Contract read result:', raw);
        if (raw && raw.audits && raw.audits.length > 0) {
          const latest = raw.audits[raw.audits.length - 1];
          return res.json({ status, done: true, result: parseScoreResult(latest) });
        }
        return res.json({ status, done: true, result: { overall: null, quality: null, security: null, summary: 'No audits yet', vulnerabilities: [] } });
      } catch (readErr) {
        const errMsg = readErr.message || String(readErr);
        console.error('Read error:', errMsg);
        return res.json({ status, done: true, error: 'Read failed: ' + errMsg });
      }
    }

    console.log('tx status:', status, 'done:', done, 'tx keys:', Object.keys(tx));
    res.json({ status, done: false });
  } catch (err) {
    console.error('status check error:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

// ── Get latest audit result (re-read without re-scoring) ─────────────────────

app.get('/api/result', async (req, res) => {
  const { walletAddress } = req.query;
  const address = process.env.CONTRACT_ADDRESS || '';
  if (!address || address.startsWith('0x_')) {
    return res.status(400).json({ error: 'CONTRACT_ADDRESS is not set in .env' });
  }

  try {
    const client = makeClient();
    const raw = await client.readContract({
      address,
      functionName: 'get_my_audits',
      args: [],
      account: walletAddress,
    });
    if (raw && raw.audits && raw.audits.length > 0) {
      const latest = raw.audits[raw.audits.length - 1];
      res.json({ data: parseScoreResult(latest) });
    } else {
      res.json({ data: { overall: null, quality: null, security: null, summary: 'No audits yet', vulnerabilities: [] } });
    }
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

// ── Get audit history for the configured account ─────────────────────────────

app.get('/api/history', async (req, res) => {
  const { walletAddress } = req.query;
  const address = process.env.CONTRACT_ADDRESS || '';
  if (!address || address.startsWith('0x_')) {
    return res.status(400).json({ error: 'CONTRACT_ADDRESS is not set in .env' });
  }

  try {
    const client = makeClient();
    const raw = await client.readContract({
      address,
      functionName: 'get_my_audits',
      args: [],
      account: walletAddress,
    });
res.json({ audits: raw.audits || [], count: raw.count || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

// ── Get latest audit for wallet ────────────────────────────────────────────────────

app.get('/api/latest', async (req, res) => {
  const { walletAddress } = req.query;
  const address = process.env.CONTRACT_ADDRESS || '';
  if (!address || address.startsWith('0x_')) {
    return res.status(400).json({ error: 'CONTRACT_ADDRESS is not set in .env' });
  }

  try {
    const client = makeClient();
    const raw = await client.readContract({
      address,
      functionName: 'get_my_audits',
      args: [],
      account: walletAddress,
    });
    if (raw && raw.audits && raw.audits.length > 0) {
      const latest = raw.audits[raw.audits.length - 1];
      res.json({ data: parseScoreResult(latest), id: raw.audits.length - 1 });
    } else {
      res.json({ data: null });
    }
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

// ── Get audit count for wallet ───────────────────────────────────────────

app.get('/api/count', async (req, res) => {
  const { walletAddress } = req.query;
  const address = process.env.CONTRACT_ADDRESS || '';
  if (!address || address.startsWith('0x_')) {
    return res.status(400).json({ error: 'CONTRACT_ADDRESS is not set in .env' });
  }

  try {
    const client = makeClient();
    const raw = await client.readContract({
      address,
      functionName: 'get_my_audits',
      args: [],
      account: walletAddress,
    });
    res.json({ count: raw.count || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

// ── Get specific audit by ID ────────────────────────────────────────────

app.get('/api/audit/:id', async (req, res) => {
  const { walletAddress } = req.query;
  const { id } = req.params;
  const address = process.env.CONTRACT_ADDRESS || '';
  if (!address || address.startsWith('0x_')) {
    return res.status(400).json({ error: 'CONTRACT_ADDRESS is not set in .env' });
  }

  try {
    const client = makeClient();
    const raw = await client.readContract({
      address,
      functionName: 'get_my_audits',
      args: [],
      account: walletAddress,
    });
    const idx = parseInt(id);
    if (raw && raw.audits && raw.audits[idx]) {
      res.json({ data: parseScoreResult(raw.audits[idx]), id: idx });
    } else {
      res.status(404).json({ error: 'Audit not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\nGenLayer Contract Scorer → http://localhost:${PORT}`);
  console.log(`Contract : ${process.env.CONTRACT_ADDRESS || '(not set — add CONTRACT_ADDRESS to .env)'}`);
  console.log(`RPC      : ${process.env.RPC_URL || 'http://localhost:8080'}\n`);
});
