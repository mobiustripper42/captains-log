import { handleInbound as scribblerHandle } from './scribbler.js';
import { send as tgSend } from './telegram.js';
import { load as loadState, save as saveState, clear as clearState } from './state.js';
import { parseTrip } from './parse.js';
import { append as appendStructured } from './structured-log.js';

export const Y_PATTERN = /^\s*y(?:es|ep|o)?\s*$/i;

export function formatConfirmation(captainName, parsed) {
  const lines = [`Confirming your log, ${captainName}:`];

  if (parsed.boat) lines.push(`• ${parsed.boat}`);
  if (parsed.route) lines.push(`• ${parsed.route}`);

  const trips = parsed.trip_count
    ? `${parsed.trip_count} trip${parsed.trip_count !== 1 ? 's' : ''}`
    : null;
  const times = [parsed.trip_start, parsed.trip_end].filter(Boolean).join('–');
  if (trips && times) lines.push(`• ${trips}, ${times}`);
  else if (trips) lines.push(`• ${trips}`);
  else if (times) lines.push(`• ${times}`);

  if (parsed.passengers_by_trip?.length) {
    lines.push(`• ${parsed.passengers_by_trip.join(' + ')} = ${parsed.total_passengers} passengers`);
  } else if (parsed.total_passengers) {
    lines.push(`• ${parsed.total_passengers} passengers`);
  }

  if (parsed.first_mate) {
    lines.push(`• First mate: ${parsed.first_mate}`);
  } else {
    lines.push(`• ⚠ First mate: not provided — please include`);
  }

  if (parsed.emergency_drills === true) lines.push(`• Emergency drills: completed`);

  for (const issue of parsed.issues ?? []) lines.push(`• Issue: ${issue}`);

  if (parsed.notes) lines.push(`• Notes: ${parsed.notes}`);

  lines.push(`Reply Y to file, or tell me what's wrong.`);
  return lines.join('\n');
}

async function parseAndConfirm({
  chatId,
  rawText,
  captain,
  prior = null,
  correction = null,
  correctionCount = 0,
  receivedAt = null,
}) {
  try {
    const parsed = await parseTrip({ rawText, prior, correction });
    if (!parsed) {
      await tgSend({
        chatId,
        text: `Sorry ${captain.name}, I couldn't make sense of that. Please include boat, route, trip count, and passenger count.`,
      });
      return;
    }
    await saveState(chatId, {
      status: 'awaiting_confirmation',
      raw_message: rawText,
      parsed,
      received_at: receivedAt ?? new Date().toISOString(),
      correction_count: correctionCount,
    });
    await tgSend({ chatId, text: formatConfirmation(captain.name, parsed) });
  } catch (err) {
    console.error('[purser] parseAndConfirm failed:', err);
    await tgSend({
      chatId,
      text: `Something went wrong on my end, ${captain.name}. Try again in a moment.`,
    });
  }
}

export async function handle({ chatId, body, source }) {
  const scribbled = await scribblerHandle({ chatId, body, source });

  if (!scribbled.captain) {
    return { reply: scribbled.reply };
  }

  const { captain } = scribbled;
  const state = await loadState(chatId);

  if (state.status === 'awaiting_confirmation') {
    if (Y_PATTERN.test(body)) {
      const entry = {
        ...state.parsed,
        captain: captain.name,
        captain_id: String(chatId),
        source,
        raw_message: state.raw_message,
        received_at: state.received_at,
        confirmed_at: new Date().toISOString(),
        correction_count: state.correction_count ?? 0,
        filed_to_sheet: false,
      };
      await appendStructured(entry);
      await clearState(chatId);
      return { reply: `Filed. Thanks, ${captain.name}.` };
    }

    // Correction — re-parse async, no immediate reply
    setImmediate(() =>
      parseAndConfirm({
        chatId,
        rawText: state.raw_message,
        captain,
        prior: state.parsed,
        correction: body,
        correctionCount: (state.correction_count ?? 0) + 1,
        receivedAt: state.received_at,
      }),
    );
    return { reply: null };
  }

  // Idle / no state — new trip message
  const receivedAt = new Date().toISOString();
  setImmediate(() => parseAndConfirm({ chatId, rawText: body, captain, receivedAt }));
  return { reply: `Got it, ${captain.name}. Parsing now.` };
}
