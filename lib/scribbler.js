import { lookup } from './captains.js';
import { append as appendRaw } from './raw-log.js';

const UNKNOWN_REPLY =
  "This account isn't registered for Brewboat logs. " +
  'If you think this is a mistake, please contact Brewboat directly. ' +
  'Otherwise, ignore this reply.';

function unknownSenderMode() {
  return (process.env.UNKNOWN_SENDER ?? 'reply').toLowerCase();
}

export async function handleInbound({ chatId, body, source }) {
  const captain = await lookup(chatId);
  const sender = `${source}:${chatId}`;

  if (!captain) {
    await appendRaw({ sender, captain: 'unknown', body });
    const mode = unknownSenderMode();
    console.log(`[scribbler] unknown sender ${sender} — mode=${mode}`);
    return { reply: mode === 'silent' ? null : UNKNOWN_REPLY, captain: null };
  }

  await appendRaw({ sender, captain: captain.name, body });
  console.log(`[scribbler] logged ${captain.name} (${sender}): ${body.slice(0, 60)}`);
  return { reply: `Got it, ${captain.name}. Parsing now.`, captain, source };
}
