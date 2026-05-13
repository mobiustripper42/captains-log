#!/usr/bin/env node
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import express from 'express';
import { repoPath } from '../lib/config.js';
import { openDb } from '../lib/db.js';
import { migrate } from '../lib/migrate.js';
import { handle as purserHandle } from '../lib/purser.js';
import { validateSecretMiddleware, send as tgSend } from '../lib/telegram.js';

const { version: VERSION } = JSON.parse(
  readFileSync(repoPath('package.json'), 'utf8'),
);

if (process.argv.includes('--version') || process.argv.includes('-v')) {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}

const db = openDb();
migrate(db);

const app = express();
app.set('trust proxy', true);
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'captainslog', version: VERSION });
});

app.post('/webhook/telegram', validateSecretMiddleware(), async (req, res) => {
  // Acknowledge immediately — Telegram retries if we take >5s
  res.sendStatus(200);

  const msg = req.body?.message;
  if (!msg) return;

  const chatId = String(msg.chat?.id ?? '');
  const body = msg.text ?? '';

  if (!chatId) {
    console.warn('[server] telegram update missing chat.id');
    return;
  }

  try {
    const { reply } = await purserHandle({ chatId, body, source: 'telegram', db });
    if (reply) await tgSend({ chatId, text: reply });
  } catch (err) {
    console.error('[server] purserHandle failed:', err);
  }
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`[captainslog] listening on :${port} (v${VERSION})`);
  console.log(`[captainslog] Scribbler + Purser wired on /webhook/telegram.`);
});
