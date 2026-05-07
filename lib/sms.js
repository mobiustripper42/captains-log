import twilio from 'twilio';
import { requireEnv } from './config.js';

let _client = null;

function client() {
  if (_client) return _client;
  requireEnv('TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN');
  _client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  return _client;
}

export function validateSignatureMiddleware() {
  return (req, res, next) => {
    if (process.env.TWILIO_SKIP_SIGNATURE === '1') return next();
    requireEnv('TWILIO_AUTH_TOKEN');
    const signature = req.get('X-Twilio-Signature') ?? '';
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const ok = twilio.validateRequest(
      process.env.TWILIO_AUTH_TOKEN,
      signature,
      url,
      req.body ?? {},
    );
    if (!ok) {
      console.warn(`[sms] rejected request — bad Twilio signature (url=${url})`);
      return res.status(403).type('text/plain').send('invalid signature');
    }
    next();
  };
}

export function twiml(message) {
  const r = new twilio.twiml.MessagingResponse();
  if (message) r.message(message);
  return r.toString();
}

export async function send({ to, body }) {
  requireEnv('TWILIO_PHONE_NUMBER');
  const msg = await client().messages.create({
    from: process.env.TWILIO_PHONE_NUMBER,
    to,
    body,
  });
  return msg.sid;
}
