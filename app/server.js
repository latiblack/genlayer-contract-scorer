require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const REPO_ROOT = path.join(__dirname, '..');
const jobs = new Map();

function getConfig() {
  return {
    address:    process.env.CONTRACT_ADDRESS || '',
    rpcUrl:     process.env.RPC_URL          || 'http://localhost:8080',
    privateKey: process.env.PRIVATE_KEY      ? '••••••••' : '(not set)',
  };
}

function parseScoreResult(raw) {
  const result = { raw, overall: null, quality: null, security: null, vulnerabilities: [] };

  const m = raw.match(/Overall:\s*(\d+)\s*\|\s*Quality:\s*(\d+)\s*\|\s*Security:\s*(\d+)/i);
  if (m) {
    result.overall  = parseInt(m[1]);
    result.quality  = parseInt(m[2]);
    result.security = parseInt(m[3]);
  }

  result.vulnerabilities = (raw.match(/\[(CRITICAL|MEDIUM|LOW)\][^\n]+/gi) || [])
    .map(line => {
      const v = line.match(/\[(CRITICAL|MEDIUM|LOW)\]\s*(.+)/i);
      return v ? { severity: v[1].toLowerCase(), description: v[2].trim() } : null;
    })
    .filter(Boolean);

  return result;
}

// ── Config (read from .env) ───────────────────────────────────────────────────

app.get('/api/config', (req, res) => res.json(getConfig()));

// ── Example contract ──────────────────────────────────────────────────────────

app.get('/api/example', (req, res) => {
  try {
    const content = fs.readFileSync(path.join(REPO_ROOT, 'examples', 'bank_vault.py'), 'utf8');
    res.json({ content });
  } catch {
    res.status(404).json({ error: 'Example file not found' });
  }
});

// ── Scoring ───────────────────────────────────────────────────────────────────

app.post('/api/score', (req, res) => {
  const { sourceCode } = req.body;
  if (!sourceCode) return res.status(400).json({ error: 'sourceCode is required' });

  const { address, rpcUrl } = getConfig();
  if (!address || address.startsWith('0x_')) {
    return res.status(400).json({ error: 'CONTRACT_ADDRESS is not set in .env' });
  }

  const jobId = crypto.randomBytes(8).toString('hex');
  jobs.set(jobId, { address, rpcUrl, sourceCode });
  res.json({ jobId });
});

app.get('/api/stream/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  jobs.delete(req.params.jobId);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (type, payload) =>
    res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);

  const { address, rpcUrl, sourceCode } = job;
  const childEnv = {
    ...process.env,
    PRIVATE_KEY: process.env.PRIVATE_KEY || '',
    RPC_URL: rpcUrl,
  };

  const pipeLines = (stream, tag) =>
    stream.on('data', chunk =>
      chunk.toString().split('\n').filter(l => l.trim())
        .forEach(l => send('log', { text: tag ? `[${tag}] ${l}` : l }))
    );

  send('log', { text: `→ genlayer write ${address} score_contract` });
  send('log', { text: `  RPC: ${rpcUrl}` });

  const write = spawn(
    'genlayer', ['write', address, 'score_contract', '--args', JSON.stringify([sourceCode])],
    { env: childEnv, cwd: REPO_ROOT }
  );

  pipeLines(write.stdout, '');
  pipeLines(write.stderr, 'warn');

  write.on('close', code => {
    if (code !== 0) {
      send('error', { message: `genlayer write exited with code ${code}` });
      return res.end();
    }

    send('log', { text: '→ Reading result from contract state…' });

    const call = spawn(
      'genlayer', ['call', address, 'get_last_score'],
      { env: childEnv, cwd: REPO_ROOT }
    );

    let callOutput = '';
    call.stdout.on('data', chunk => {
      const text = chunk.toString();
      callOutput += text;
      text.split('\n').filter(l => l.trim()).forEach(l => send('log', { text: l }));
    });
    pipeLines(call.stderr, 'warn');

    call.on('close', callCode => {
      if (callCode !== 0) {
        send('error', { message: `genlayer call exited with code ${callCode}` });
        return res.end();
      }
      send('result', { data: parseScoreResult(callOutput) });
      res.end();
    });
  });

  req.on('close', () => write.kill());
});

// ── Refresh (re-read state without re-scoring) ────────────────────────────────

app.get('/api/result', (req, res) => {
  const { address, rpcUrl } = getConfig();
  if (!address || address.startsWith('0x_')) {
    return res.status(400).json({ error: 'CONTRACT_ADDRESS is not set in .env' });
  }

  const childEnv = { ...process.env, RPC_URL: rpcUrl };
  const call = spawn('genlayer', ['call', address, 'get_last_score'], {
    env: childEnv,
    cwd: REPO_ROOT,
  });

  let output = '';
  call.stdout.on('data', chunk => { output += chunk.toString(); });
  call.on('close', code => {
    if (code !== 0) return res.status(500).json({ error: 'genlayer call failed' });
    res.json({ data: parseScoreResult(output) });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  const cfg = getConfig();
  console.log(`\nGenLayer Contract Scorer  →  http://localhost:${PORT}`);
  console.log(`Contract : ${cfg.address || '(not set — add CONTRACT_ADDRESS to .env)'}`);
  console.log(`RPC      : ${cfg.rpcUrl}\n`);
});
