import { handleInbound as scribblerHandle } from './scribbler.js';
import { send as tgSend } from './telegram.js';
import { load as loadState, save as saveState, clear as clearState } from './state.js';
import { parseTrip } from './parse.js';
import { tx } from './db.js';
import { resolve as resolveCrew } from './crew.js';
import { boatSlugFor, routeSlugFor } from './rosters.js';
import * as trips from './trips.js';

export const Y_PATTERN = /^\s*y(?:es|ep|o)?\s*$/i;

export function formatConfirmation(captainName, parsed) {
  const lines = [`Confirming your log, ${captainName}:`];

  if (parsed.boat) lines.push(`• ${parsed.boat}`);
  if (parsed.route) lines.push(`• ${parsed.route}`);

  const tripWord = parsed.trip_count
    ? `${parsed.trip_count} trip${parsed.trip_count !== 1 ? 's' : ''}`
    : null;
  const times = [parsed.trip_start, parsed.trip_end].filter(Boolean).join('–');
  if (tripWord && times) lines.push(`• ${tripWord}, ${times}`);
  else if (tripWord) lines.push(`• ${tripWord}`);
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
  db,
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
    saveState(db, chatId, {
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

function etDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

async function fileTrip({ db, chatId, captain, state, source }) {
  const { parsed, raw_message, received_at } = state;
  const [boatSlug, routeSlug] = await Promise.all([
    boatSlugFor(parsed.boat),
    routeSlugFor(parsed.route),
  ]);
  const firstMateCrewId = parsed.first_mate ? await resolveCrew(db, parsed.first_mate) : null;

  const fields = {
    status: 'confirmed',
    captain_chat_id: String(chatId),
    captain_name: captain.name,
    boat_slug: boatSlug ?? 'unknown',
    route_slug: routeSlug,
    trip_date: etDate(),
    start_time: parsed.trip_start ?? null,
    end_time: parsed.trip_end ?? null,
    passenger_count: parsed.total_passengers ?? null,
    first_mate_text: parsed.first_mate ?? null,
    first_mate_crew_id: firstMateCrewId,
    notes: parsed.notes ?? null,
    parse_json: JSON.stringify({
      parsed,
      raw_message,
      received_at,
      source,
      correction_count: state.correction_count ?? 0,
    }),
    confirmed_at: new Date().toISOString(),
  };

  return tx(db, () => trips.create(db, fields));
}

export async function handle({ chatId, body, source, db }) {
  const scribbled = await scribblerHandle({ chatId, body, source });

  if (!scribbled.captain) {
    return { reply: scribbled.reply };
  }

  const { captain } = scribbled;
  const state = loadState(db, chatId);

  if (state.status === 'awaiting_confirmation') {
    if (Y_PATTERN.test(body)) {
      try {
        await fileTrip({ db, chatId, captain, state, source });
      } catch (err) {
        console.error('[purser] fileTrip failed:', err);
        return { reply: `Something went wrong filing that, ${captain.name}. Try again or text Eric.` };
      }
      clearState(db, chatId);
      return { reply: `Filed. Thanks, ${captain.name}.` };
    }

    // Correction — re-parse async, no immediate reply
    setImmediate(() =>
      parseAndConfirm({
        db,
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
  setImmediate(() => parseAndConfirm({ db, chatId, rawText: body, captain, receivedAt }));
  return { reply: `Got it, ${captain.name}. Parsing now.` };
}
