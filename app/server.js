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
  const account = createAccount(process.env.PRIVATE_KEY);
  return createClient({ chain: localnet, endpoint: rpcUrl, account });
}

function parseScoreResult(raw) {
  let text = typeof raw === 'string' ? raw : JSON.stringify(raw);
  text = text.trim();
  if ((text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'"))) {
    try { text = JSON.parse(text); } catch { /* leave as-is */ }
  }
  text = text.replace(/\\n/g, '\n').trim();

  const result = { raw: text, overall: null, quality: null, security: null, vulnerabilities: [] };

  const m = text.match(/Overall:\s*(\d+)\s*\|\s*Quality:\s*(\d+)\s*\|\s*Security:\s*(\d+)/i);
  if (m) {
    result.overall  = parseInt(m[1]);
    result.quality  = parseInt(m[2]);
    result.security = parseInt(m[3]);
  }

  result.vulnerabilities = (text.match(/\[(CRITICAL|MEDIUM|LOW)\][^\n]*/gi) || [])
    .map(line => {
      const v = line.match(/\[(CRITICAL|MEDIUM|LOW)\]\s*(.+)/i);
      return v ? { severity: v[1].toLowerCase(), description: v[2].trim() } : null;
    })
    .filter(Boolean);

  return result;
}

const TERMINAL = new Set([
  TransactionStatus.ACCEPTED,
  TransactionStatus.FINALIZED,
  TransactionStatus.UNDETERMINED,
  TransactionStatus.CANCELED,
  TransactionStatus.LEADER_TIMEOUT,
  TransactionStatus.VALIDATORS_TIMEOUT,
]);

const FAILED = new Set([
  TransactionStatus.UNDETERMINED,
  TransactionStatus.CANCELED,
  TransactionStatus.LEADER_TIMEOUT,
  TransactionStatus.VALIDATORS_TIMEOUT,
]);

// ── Example contract ──────────────────────────────────────────────────────────

app.get('/api/example', (req, res) => {
  try {
    const content = readFileSync(join(REPO_ROOT, 'examples', 'bank_vault.py'), 'utf8');
    res.json({ content });
  } catch {
    res.status(404).json({ error: 'Example file not found' });
  }
});

// ── Submit transaction ────────────────────────────────────────────────────────

app.post('/api/score', async (req, res) => {
  const { sourceCode } = req.body;
  if (!sourceCode) return res.status(400).json({ error: 'sourceCode is required' });

  const address = process.env.CONTRACT_ADDRESS || '';
  if (!address || address.startsWith('0x_')) {
    return res.status(400).json({ error: 'CONTRACT_ADDRESS is not set in .env' });
  }

  try {
    const client = makeClient();
    const txHash = await client.writeContract({
      address,
      functionName: 'score_contract',
      args: [sourceCode],
      value: 0n,
    });
    res.json({ txHash, address });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

// ── Poll transaction status ───────────────────────────────────────────────────
// Returns { status, done, result? } — each call is short-lived (<2 s).

app.get('/api/status/:txHash', async (req, res) => {
  const address = process.env.CONTRACT_ADDRESS || '';
  if (!address || address.startsWith('0x_')) {
    return res.status(400).json({ error: 'CONTRACT_ADDRESS is not set in .env' });
  }

  try {
    const client = makeClient();
    const tx = await client.getTransaction({ hash: req.params.txHash });
    const status = tx.statusName || String(tx.status);
    const done = TERMINAL.has(status);

    if (done && FAILED.has(status)) {
      return res.json({ status, done: true, error: `Transaction ended with status: ${status}` });
    }

    if (done) {
      const raw = await client.readContract({
        address,
        functionName: 'get_last_score',
        args: [],
      });
      return res.json({ status, done: true, result: parseScoreResult(raw) });
    }

    res.json({ status, done: false });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

// ── Refresh (re-read state without re-scoring) ────────────────────────────────

app.get('/api/result', async (req, res) => {
  const address = process.env.CONTRACT_ADDRESS || '';
  if (!address || address.startsWith('0x_')) {
    return res.status(400).json({ error: 'CONTRACT_ADDRESS is not set in .env' });
  }

  try {
    const client = makeClient();
    const raw = await client.readContract({
      address,
      functionName: 'get_last_score',
      args: [],
    });
    res.json({ data: parseScoreResult(raw) });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\nGenLayer Contract Scorer  →  http://localhost:${PORT}`);
  console.log(`Contract : ${process.env.CONTRACT_ADDRESS || '(not set — add CONTRACT_ADDRESS to .env)'}`);
  console.log(`RPC      : ${process.env.RPC_URL || 'http://localhost:8080'}\n`);
});
