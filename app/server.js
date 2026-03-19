import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import crypto from 'crypto';
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
const jobs = new Map();

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

// ── Example contract ──────────────────────────────────────────────────────────

app.get('/api/example', (req, res) => {
  try {
    const content = readFileSync(join(REPO_ROOT, 'examples', 'bank_vault.py'), 'utf8');
    res.json({ content });
  } catch {
    res.status(404).json({ error: 'Example file not found' });
  }
});

// ── Scoring ───────────────────────────────────────────────────────────────────

app.post('/api/score', (req, res) => {
  const { sourceCode } = req.body;
  if (!sourceCode) return res.status(400).json({ error: 'sourceCode is required' });

  const address = process.env.CONTRACT_ADDRESS || '';
  if (!address || address.startsWith('0x_')) {
    return res.status(400).json({ error: 'CONTRACT_ADDRESS is not set in .env' });
  }

  const jobId = crypto.randomBytes(8).toString('hex');
  jobs.set(jobId, { address, sourceCode });
  res.json({ jobId });
});

app.get('/api/stream/:jobId', async (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  jobs.delete(req.params.jobId);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (type, payload) =>
    res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);

  const { address, sourceCode } = job;
  try {
    const client = makeClient();
    const rpcUrl = process.env.RPC_URL || 'http://localhost:8080';

    send('log', { text: `→ Sending score_contract transaction to ${address}` });
    send('log', { text: `  RPC: ${rpcUrl}` });

    const txHash = await client.writeContract({
      address,
      functionName: 'score_contract',
      args: [sourceCode],
      value: 0n,
    });

    send('log', { text: `→ Transaction submitted: ${txHash}` });

    // Poll manually so we can stream live status updates to the UI
    const TERMINAL = new Set([
      TransactionStatus.ACCEPTED,
      TransactionStatus.FINALIZED,
      TransactionStatus.UNDETERMINED,
      TransactionStatus.CANCELED,
      TransactionStatus.LEADER_TIMEOUT,
      TransactionStatus.VALIDATORS_TIMEOUT,
    ]);
    let lastStatus = null;
    let accepted = false;
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 5000));
      let tx;
      try { tx = await client.getTransaction({ hash: txHash }); } catch { continue; }
      const st = tx.statusName || tx.status;
      if (st !== lastStatus) {
        send('log', { text: `  status: ${st}` });
        lastStatus = st;
      }
      if (TERMINAL.has(st)) {
        if (st !== TransactionStatus.ACCEPTED && st !== TransactionStatus.FINALIZED) {
          throw new Error(`Transaction ended with status: ${st}`);
        }
        accepted = true;
        break;
      }
    }
    if (!accepted) throw new Error('Timed out waiting for transaction to be accepted');

    send('log', { text: '→ Transaction accepted. Reading result…' });

    const raw = await client.readContract({
      address,
      functionName: 'get_last_score',
      args: [],
    });

    send('result', { data: parseScoreResult(raw) });
  } catch (err) {
    send('error', { message: err.message || String(err) });
  }

  res.end();
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
