import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, existsSync } from 'fs';
import express from 'express';
import { createClient, createAccount } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

const app = express();
app.use(express.json({ limit: '10mb' }));

const distPath = join(__dirname, '..', 'dist');
const publicPath = join(__dirname, 'public');
if (existsSync(distPath)) {
  app.use(express.static(distPath));
} else {
  app.use(express.static(publicPath));
}

const REPO_ROOT = join(__dirname, '..');

const TERMINAL_STATUSES = new Set(['FINALIZED', 'ACCEPTED', 'UNDETERMINED', 'CANCELED']);
const FAILED_STATUSES = new Set(['UNDETERMINED', 'CANCELED']);

function isTerminal(status) { return TERMINAL_STATUSES.has(status); }
function isFailed(status) { return FAILED_STATUSES.has(status); }

app.get('/api/example', (req, res) => {
  try {
    const content = readFileSync(join(REPO_ROOT, 'examples', 'bank_vault.py'), 'utf8');
    res.json({ content });
  } catch { res.status(404).json({ error: 'Example file not found' }); }
});

app.post('/api/score', async (req, res) => {
  const { sourceCode, walletAddress } = req.body;
  if (!sourceCode) return res.status(400).json({ error: 'sourceCode is required' });
  
  const address = process.env.CONTRACT_ADDRESS || '';
  if (!address || address.startsWith('0x_')) {
    return res.status(400).json({ error: 'CONTRACT_ADDRESS is not set in .env' });
  }

  try {
    const rpcUrl = process.env.RPC_URL || 'https://studio.genlayer.com/api';
    const account = createAccount(process.env.PRIVATE_KEY);
    const client = createClient({ chain: studionet, endpoint: rpcUrl, account });
    
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

app.get('/api/status/:txHash', async (req, res) => {
  const address = process.env.CONTRACT_ADDRESS || '';
  if (!address || address.startsWith('0x_')) {
    return res.status(400).json({ error: 'CONTRACT_ADDRESS is not set in .env' });
  }

  try {
    const rpcUrl = process.env.RPC_URL || 'https://studio.genlayer.com/api';
    const account = createAccount(process.env.PRIVATE_KEY);
    const client = createClient({ chain: studionet, endpoint: rpcUrl, account });
    
    const tx = await client.getTransaction({ hash: req.params.txHash });
    const status = tx.statusName || tx.status?.name || String(tx.status) || 'UNKNOWN';
    const done = isTerminal(status);

    if (done && isFailed(status)) {
      return res.json({ status, done: true, error: 'Transaction ended with status: ' + status });
    }

    if (done) {
      try {
        const raw = await client.readContract({
          address,
          functionName: 'get_my_audits',
          args: [],
        });
        if (raw && raw.audits && raw.audits.length > 0) {
          const latest = raw.audits[raw.audits.length - 1];
          return res.json({ status, done: true, result: latest });
        }
        return res.json({ status, done: true, result: null });
      } catch (readErr) {
        return res.json({ status, done: true, error: readErr.message });
      }
    }

    res.json({ status, done: false });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

// History endpoint
app.get('/api/history/:walletAddress', async (req, res) => {
  const address = process.env.CONTRACT_ADDRESS || '';
  if (!address || address.startsWith('0x_')) {
    return res.status(400).json({ error: 'CONTRACT_ADDRESS is not set in .env' });
  }

  try {
    const rpcUrl = process.env.RPC_URL || 'https://studio.genlayer.com/api';
    const account = createAccount(process.env.PRIVATE_KEY);
    const client = createClient({ chain: studionet, endpoint: rpcUrl, account });
    
    const raw = await client.readContract({
      address,
      functionName: 'get_my_audits',
      args: [],
    });
    res.json({ audits: raw.audits || [], count: raw.count || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('\nGenLayer Contract Scorer → http://localhost:' + PORT);
});