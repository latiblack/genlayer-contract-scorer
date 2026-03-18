require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const ENVS_FILE = path.join(__dirname, 'environments.json');
const REPO_ROOT = path.join(__dirname, '..');

// In-memory job store: jobId -> {env, sourceCode}
const jobs = new Map();

function loadEnvs() {
  try {
    return JSON.parse(fs.readFileSync(ENVS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveEnvs(envs) {
  fs.writeFileSync(ENVS_FILE, JSON.stringify(envs, null, 2));
}

// Parse the plain-text score result from get_last_score
function parseScoreResult(raw) {
  const result = { raw, overall: null, quality: null, security: null, vulnerabilities: [] };

  const scoreMatch = raw.match(/Overall:\s*(\d+)\s*\|\s*Quality:\s*(\d+)\s*\|\s*Security:\s*(\d+)/i);
  if (scoreMatch) {
    result.overall = parseInt(scoreMatch[1]);
    result.quality = parseInt(scoreMatch[2]);
    result.security = parseInt(scoreMatch[3]);
  }

  const vulnMatches = raw.match(/\[(CRITICAL|MEDIUM|LOW)\][^\n]+/gi) || [];
  result.vulnerabilities = vulnMatches.map(line => {
    const m = line.match(/\[(CRITICAL|MEDIUM|LOW)\]\s*(.+)/i);
    return m ? { severity: m[1].toLowerCase(), description: m[2].trim() } : null;
  }).filter(Boolean);

  return result;
}

// ── Environments ──────────────────────────────────────────────────────────────

app.get('/api/environments', (req, res) => {
  res.json(loadEnvs());
});

app.post('/api/environments', (req, res) => {
  const { name, address, rpcUrl } = req.body;
  if (!name || !address) return res.status(400).json({ error: 'name and address are required' });

  const envs = loadEnvs();
  if (envs.find(e => e.name === name)) {
    return res.status(400).json({ error: `Environment "${name}" already exists` });
  }

  envs.push({
    name,
    address,
    rpcUrl: rpcUrl || process.env.RPC_URL || 'https://studio.genlayer.com',
  });
  saveEnvs(envs);
  res.json({ ok: true });
});

app.delete('/api/environments/:name', (req, res) => {
  const envs = loadEnvs().filter(e => e.name !== decodeURIComponent(req.params.name));
  saveEnvs(envs);
  res.json({ ok: true });
});

// ── Example contract ──────────────────────────────────────────────────────────

app.get('/api/example', (req, res) => {
  const examplePath = path.join(REPO_ROOT, 'examples', 'bank_vault.py');
  try {
    res.json({ content: fs.readFileSync(examplePath, 'utf8') });
  } catch {
    res.status(404).json({ error: 'Example file not found' });
  }
});

// ── Scoring ───────────────────────────────────────────────────────────────────

// Step 1: create job and return jobId
app.post('/api/score', (req, res) => {
  const { envName, sourceCode } = req.body;
  if (!envName || !sourceCode) {
    return res.status(400).json({ error: 'envName and sourceCode are required' });
  }

  const env = loadEnvs().find(e => e.name === envName);
  if (!env) return res.status(404).json({ error: 'Environment not found' });

  const jobId = crypto.randomBytes(8).toString('hex');
  jobs.set(jobId, { env, sourceCode });
  res.json({ jobId });
});

// Step 2: SSE stream — runs genlayer write then genlayer call
app.get('/api/stream/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  jobs.delete(req.params.jobId);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (type, payload) => {
    res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
  };

  const { env, sourceCode } = job;
  const childEnv = {
    ...process.env,
    PRIVATE_KEY: process.env.PRIVATE_KEY || '',
    RPC_URL: env.rpcUrl,
  };

  const argsJson = JSON.stringify([sourceCode]);
  send('log', { text: `Submitting to ${env.address} on ${env.rpcUrl}...` });

  const writeProc = spawn(
    'genlayer',
    ['write', env.address, 'score_contract', '--args', argsJson],
    { env: childEnv, cwd: REPO_ROOT }
  );

  const pipeLines = (stream, prefix) =>
    stream.on('data', chunk =>
      chunk.toString().split('\n').filter(l => l.trim()).forEach(l =>
        send('log', { text: prefix ? `[${prefix}] ${l}` : l })
      )
    );

  pipeLines(writeProc.stdout, '');
  pipeLines(writeProc.stderr, 'warn');

  writeProc.on('close', code => {
    if (code !== 0) {
      send('error', { message: `genlayer write failed (exit ${code})` });
      return res.end();
    }

    send('log', { text: 'Transaction submitted. Reading result...' });

    const callProc = spawn(
      'genlayer',
      ['call', env.address, 'get_last_score'],
      { env: childEnv, cwd: REPO_ROOT }
    );

    let callOutput = '';
    callProc.stdout.on('data', chunk => {
      const text = chunk.toString();
      callOutput += text;
      text.split('\n').filter(l => l.trim()).forEach(l => send('log', { text: l }));
    });
    pipeLines(callProc.stderr, 'warn');

    callProc.on('close', callCode => {
      if (callCode !== 0) {
        send('error', { message: `genlayer call failed (exit ${callCode})` });
        return res.end();
      }
      send('result', { data: parseScoreResult(callOutput) });
      res.end();
    });
  });

  req.on('close', () => writeProc.kill());
});

// ── Refresh result only (no re-score) ────────────────────────────────────────

app.get('/api/result/:envName', (req, res) => {
  const env = loadEnvs().find(e => e.name === decodeURIComponent(req.params.envName));
  if (!env) return res.status(404).json({ error: 'Environment not found' });

  const childEnv = {
    ...process.env,
    PRIVATE_KEY: process.env.PRIVATE_KEY || '',
    RPC_URL: env.rpcUrl,
  };

  const callProc = spawn('genlayer', ['call', env.address, 'get_last_score'], {
    env: childEnv,
    cwd: REPO_ROOT,
  });

  let output = '';
  callProc.stdout.on('data', chunk => { output += chunk.toString(); });
  callProc.on('close', code => {
    if (code !== 0) return res.status(500).json({ error: 'genlayer call failed' });
    res.json({ data: parseScoreResult(output) });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\nGenLayer Contract Scorer UI → http://localhost:${PORT}\n`);
});
