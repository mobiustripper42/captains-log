#!/usr/bin/env node
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import express from 'express';
import cron from 'node-cron';
import { repoPath } from '../lib/config.js';
import { openDb } from '../lib/db.js';
import { migrate } from '../lib/migrate.js';
import { handle as purserHandle } from '../lib/purser.js';
import { syncAll as syncSheets } from '../lib/sheets.js';
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

const SHEETS_SYNC_CRON = process.env.SHEETS_SYNC_CRON ?? '*/5 * * * *';
if (process.env.SHEETS_SYNC_DISABLED !== '1') {
  cron.schedule(
    SHEETS_SYNC_CRON,
    async () => {
      try {
        const result = await syncSheets(db);
        if (result.pending > 0) {
          console.log(
            `[sheets] cron tick: ${result.synced}/${result.pending} synced, ${result.failed} failed`,
          );
        }
      } catch (err) {
        console.error('[sheets] cron tick failed:', err.message);
      }
    },
    { timezone: process.env.TIMEZONE ?? 'America/New_York' },
  );
}

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`[captainslog] listening on :${port} (v${VERSION})`);
  console.log(`[captainslog] Scribbler + Purser wired on /webhook/telegram.`);
  if (process.env.SHEETS_SYNC_DISABLED !== '1') {
    console.log(`[captainslog] Sheet sync cron: ${SHEETS_SYNC_CRON}`);
  }
});
