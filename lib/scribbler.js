import { lookup } from './captains.js';
import { append as appendRaw } from './raw-log.js';

const UNKNOWN_REPLY =
  "This number isn't registered for Brewboat logs. " +
  'If you think this is a mistake, please contact Brewboat directly. ' +
  'Otherwise, ignore this reply.';

function unknownSenderMode() {
  return (process.env.UNKNOWN_SENDER ?? 'reply').toLowerCase();
}

export async function handleInbound({ from, body }) {
  const captain = await lookup(from);

  if (!captain) {
    await appendRaw({ phone: from, captain: 'unknown', body });
    const mode = unknownSenderMode();
    console.log(`[scribbler] unknown sender ${from} — mode=${mode}`);
    return { reply: mode === 'silent' ? null : UNKNOWN_REPLY, captain: null };
  }

  await appendRaw({ phone: from, captain: captain.name, body });
  console.log(`[scribbler] logged ${captain.name} (${from}): ${body.slice(0, 60)}`);
  return {
    reply: `Got it, ${captain.name}. Parsing now.`,
    captain,
  };
}
