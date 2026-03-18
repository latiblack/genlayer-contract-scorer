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

function parseScoreResult(raw) {
  // genlayer call may wrap the return value in JSON quotes with escaped \n
  let text = raw.trim();
  if ((text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'"))) {
    try { text = JSON.parse(text); } catch { /* leave as-is */ }
  }
  // Normalise literal \n sequences into real newlines
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

  const address = process.env.CONTRACT_ADDRESS || '';
  const rpcUrl  = process.env.RPC_URL || 'http://localhost:8080';
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

    let callStdout = '';
    let callStderr = '';

    call.stdout.on('data', chunk => {
      const text = chunk.toString();
      callStdout += text;
      text.split('\n').filter(l => l.trim()).forEach(l => send('log', { text: l }));
    });
    call.stderr.on('data', chunk => {
      const text = chunk.toString();
      callStderr += text;
      text.split('\n').filter(l => l.trim()).forEach(l => send('log', { text: `[warn] ${l}` }));
    });

    call.on('close', callCode => {
      if (callCode !== 0) {
        send('error', { message: `genlayer call exited with code ${callCode}` });
        return res.end();
      }
      // Some genlayer CLI versions write the return value to stderr instead of stdout
      const callOutput = callStdout.trim() ? callStdout : callStderr;
      console.log('[scorer] raw call stdout:', JSON.stringify(callStdout));
      console.log('[scorer] raw call stderr:', JSON.stringify(callStderr));
      if (!callOutput.trim()) {
        send('error', { message: 'genlayer call returned empty output — transaction may not be finalised yet. Try "Refresh result" in a few seconds.' });
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
  const address = process.env.CONTRACT_ADDRESS || '';
  const rpcUrl  = process.env.RPC_URL || 'http://localhost:8080';
  if (!address || address.startsWith('0x_')) {
    return res.status(400).json({ error: 'CONTRACT_ADDRESS is not set in .env' });
  }

  const childEnv = { ...process.env, RPC_URL: rpcUrl };
  const call = spawn('genlayer', ['call', address, 'get_last_score'], {
    env: childEnv,
    cwd: REPO_ROOT,
  });

  let stdout = '';
  let stderr = '';
  call.stdout.on('data', chunk => { stdout += chunk.toString(); });
  call.stderr.on('data', chunk => { stderr += chunk.toString(); });
  call.on('close', code => {
    if (code !== 0) return res.status(500).json({ error: 'genlayer call failed' });
    const output = stdout.trim() ? stdout : stderr;
    console.log('[scorer/refresh] stdout:', JSON.stringify(stdout));
    console.log('[scorer/refresh] stderr:', JSON.stringify(stderr));
    res.json({ data: parseScoreResult(output) });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\nGenLayer Contract Scorer  →  http://localhost:${PORT}`);
  console.log(`Contract : ${process.env.CONTRACT_ADDRESS || '(not set — add CONTRACT_ADDRESS to .env)'}`);
  console.log(`RPC      : ${process.env.RPC_URL || 'http://localhost:8080'}\n`);
});
