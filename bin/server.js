#!/usr/bin/env node
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import express from 'express';
import { repoPath, requireEnv } from '../lib/config.js';
import { handleInbound } from '../lib/scribbler.js';
import { twiml, validateSignatureMiddleware } from '../lib/sms.js';

const { version: VERSION } = JSON.parse(
  readFileSync(repoPath('package.json'), 'utf8'),
);

if (process.argv.includes('--version') || process.argv.includes('-v')) {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}

try {
  requireEnv('TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER');
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const app = express();
app.set('trust proxy', true);
app.use(express.urlencoded({ extended: false }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'captainslog', version: VERSION });
});

app.post('/webhook/sms', validateSignatureMiddleware(), async (req, res) => {
  const from = req.body.From;
  const body = req.body.Body ?? '';
  if (!from) {
    console.warn('[server] webhook missing From — returning empty TwiML');
    return res.type('text/xml').send(twiml());
  }

  try {
    const { reply } = await handleInbound({ from, body });
    res.type('text/xml').send(twiml(reply));
  } catch (err) {
    console.error('[server] handleInbound failed:', err);
    res.type('text/xml').send(twiml());
  }
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`[captainslog] listening on :${port} (v${VERSION})`);
  console.log(
    `[captainslog] Scribbler wired. Purser (3.3) not yet — confirmation SMS comes after parse.`,
  );
});
