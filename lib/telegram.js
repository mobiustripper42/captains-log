import { requireEnv } from './config.js';

export function validateSecretMiddleware() {
  return (req, res, next) => {
    if (process.env.TELEGRAM_SKIP_SECRET === '1') return next();
    requireEnv('TELEGRAM_SECRET_TOKEN');
    const token = req.get('X-Telegram-Bot-Api-Secret-Token') ?? '';
    if (token !== process.env.TELEGRAM_SECRET_TOKEN) {
      console.warn('[telegram] rejected request — bad secret token');
      return res.status(403).type('text/plain').send('invalid token');
    }
    next();
  };
}

export async function send({ chatId, text }) {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.warn(`[telegram] no TELEGRAM_BOT_TOKEN — would send to ${chatId}: ${text}`);
    return null;
  }
  const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`[telegram] sendMessage failed: ${err}`);
  }
  return res.json();
}
