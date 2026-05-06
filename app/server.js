import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, existsSync } from 'fs';
import express from 'express';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

const app = express();
app.use(express.json({ limit: '10mb' }));

// Serve built files from dist/ or static from public/
const distPath = join(__dirname, '..', 'dist');
const publicPath = join(__dirname, 'public');
if (existsSync(distPath)) {
  app.use(express.static(distPath));
} else {
  app.use(express.static(publicPath));
}

const REPO_ROOT = join(__dirname, '..');

// ── Example contract ──────────────────────────────────────────────────────────

app.get('/api/example', (req, res) => {
  try {
    const content = readFileSync(join(REPO_ROOT, 'examples', 'bank_vault.py'), 'utf8');
    res.json({ content });
  } catch {
    res.status(404).json({ error: 'Example file not found' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\nGenLayer Contract Scorer → http://localhost:${PORT}`);
  console.log(`Contract : ${process.env.CONTRACT_ADDRESS || '(not set — add CONTRACT_ADDRESS to .env)'}`);
  console.log(`RPC      : ${process.env.RPC_URL || 'http://localhost:8080'}\n`);
});