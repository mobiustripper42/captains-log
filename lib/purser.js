import { handleInbound as scribblerHandle } from './scribbler.js';
import { send as tgSend } from './telegram.js';
import { load as loadState, save as saveState, clear as clearState } from './state.js';
import { parseTrip } from './parse.js';
import { tx } from './db.js';
import { resolve as resolveCrew, canonicalNameFor } from './crew.js';
import { boatSlugFor, routeSlugFor } from './rosters.js';
import { getWeatherSummary } from './weather.js';
import * as trips from './trips.js';
import * as drills from './drills.js';
import * as feedback from './feedback.js';

const DRILL_TYPE_LABELS = {
  abandon_ship: 'Abandon ship',
  mob: 'Man overboard',
  fire: 'Fire',
  crew_emergency: 'Crew emergency',
};

const VALID_DRILL_TYPES = new Set(drills.DRILL_TYPES);

export const Y_PATTERN = /^\s*y(?:es|ep|o)?\s*$/i;
export const SLASH_COMMAND_PATTERN = /^\/(feedback|file)(?:@\w+)?(?:\s|$)/i;
// `s` flag so multi-line feedback bodies survive intact.
export const FEEDBACK_PATTERN = /^\/feedback(?:@\w+)?(?:\s+(.*))?$/is;
export const FILE_PATTERN = /^\/file(?:@\w+)?\s*$/i;

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

function etDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

// Builds the persistable column patch from a parsed payload. Only includes
// non-null fields so a `done` update doesn't clobber values set on `starting`.
async function fieldsFromParsed({ db, parsed }) {
  const [boatSlug, routeSlug] = await Promise.all([
    boatSlugFor(parsed.boat),
    routeSlugFor(parsed.route),
  ]);
  const [firstMateCrewId, weatherSummary] = await Promise.all([
    parsed.first_mate ? resolveCrew(db, parsed.first_mate) : null,
    getWeatherSummary({ routeSlug, boatSlug }),
  ]);
  const patch = {};
  if (boatSlug) patch.boat_slug = boatSlug;
  if (routeSlug) patch.route_slug = routeSlug;
  if (parsed.trip_start != null) patch.start_time = parsed.trip_start;
  if (parsed.trip_end != null) patch.end_time = parsed.trip_end;
  if (parsed.total_passengers != null) patch.passenger_count = parsed.total_passengers;
  if (parsed.first_mate != null) patch.first_mate_text = parsed.first_mate;
  if (firstMateCrewId != null) patch.first_mate_crew_id = firstMateCrewId;
  if (parsed.notes != null) patch.notes = parsed.notes;
  if (weatherSummary != null) patch.weather_summary = weatherSummary;
  return { patch, boatSlug };
}

export async function openTrip({ db, chatId, captain, parsed }) {
  const { patch, boatSlug } = await fieldsFromParsed({ db, parsed });
  if (!boatSlug) {
    const err = new Error(`unknown boat: ${parsed.boat ?? '(none provided)'}`);
    err.code = 'UNKNOWN_BOAT';
    err.boatName = parsed.boat ?? null;
    throw err;
  }
  const fields = {
    ...patch,
    status: 'open',
    captain_chat_id: String(chatId),
    captain_name: captain.name,
    boat_slug: boatSlug,
    trip_date: etDate(),
    parse_json: JSON.stringify({ parsed, sub_intent: 'starting' }),
  };
  return tx(db, () => trips.create(db, fields));
}

export async function updateOpenTrip({ db, tripId, parsed }) {
  const { patch } = await fieldsFromParsed({ db, parsed });
  return tx(db, () => trips.update(db, tripId, patch));
}

export function formatDrillConfirmation(captainName, parsed) {
  const lines = [`Confirming your drill log, ${captainName}:`];
  const typeLabel = VALID_DRILL_TYPES.has(parsed.drill_type)
    ? DRILL_TYPE_LABELS[parsed.drill_type]
    : null;
  if (typeLabel) lines.push(`• ${typeLabel} drill`);
  else lines.push(`• ⚠ Drill type not provided — please include`);

  if (parsed.boat) lines.push(`• ${parsed.boat}`);
  if (parsed.crew_present?.length) {
    lines.push(`• Crew: ${parsed.crew_present.join(', ')}`);
  }
  if (parsed.notes) lines.push(`• Notes: ${parsed.notes}`);

  lines.push(`Reply Y to file, or tell me what's wrong.`);
  return lines.join('\n');
}

async function drillCrewText(parsed) {
  if (!parsed.crew_present?.length) return null;
  const canonical = await Promise.all(
    parsed.crew_present.map(async (name) => (await canonicalNameFor(name)) ?? name),
  );
  const trimmed = canonical.map((n) => String(n).trim()).filter(Boolean);
  return trimmed.length ? trimmed.join(', ') : null;
}

export async function fileDrill({ db, chatId, captain, state, source }) {
  const { parsed, raw_message, received_at } = state;
  const boatSlug = await boatSlugFor(parsed.boat);
  if (!boatSlug) {
    const err = new Error(`unknown boat: ${parsed.boat ?? '(none provided)'}`);
    err.code = 'UNKNOWN_BOAT';
    err.boatName = parsed.boat ?? null;
    throw err;
  }
  if (!VALID_DRILL_TYPES.has(parsed.drill_type)) {
    // Treats both null and out-of-enum values the same — captain gets the
    // same nudge either way. SQLite's CHECK constraint would also reject
    // bad values, but this surfaces a friendly reply instead of a generic
    // "something went wrong" from the catch-all.
    const err = new Error('drill_type missing or invalid');
    err.code = 'DRILL_TYPE_MISSING';
    throw err;
  }
  const crewText = await drillCrewText(parsed);
  const parseJson = JSON.stringify({
    parsed,
    raw_message,
    received_at,
    source,
    correction_count: state.correction_count ?? 0,
  });
  const fields = {
    drill_date: etDate(),
    drill_type: parsed.drill_type,
    boat_slug: boatSlug,
    captain_chat_id: String(chatId),
    crew_present_text: crewText,
    notes: parsed.notes ?? null,
    parse_json: parseJson,
  };
  return tx(db, () => drills.create(db, fields));
}

export async function fileTrip({ db, chatId, captain, state, source }) {
  const { parsed, raw_message, received_at, open_trip_id } = state;
  const { patch, boatSlug } = await fieldsFromParsed({ db, parsed });
  const parseJson = JSON.stringify({
    parsed,
    raw_message,
    received_at,
    source,
    correction_count: state.correction_count ?? 0,
  });

  if (open_trip_id) {
    return tx(db, () => {
      trips.confirmOpen(db, open_trip_id, { ...patch, parse_json: parseJson });
      return { id: open_trip_id };
    });
  }

  if (!boatSlug) {
    const err = new Error(`unknown boat: ${parsed.boat ?? '(none provided)'}`);
    err.code = 'UNKNOWN_BOAT';
    err.boatName = parsed.boat ?? null;
    throw err;
  }

  const fields = {
    ...patch,
    status: 'confirmed',
    captain_chat_id: String(chatId),
    captain_name: captain.name,
    boat_slug: boatSlug,
    trip_date: etDate(),
    parse_json: parseJson,
    confirmed_at: new Date().toISOString(),
  };
  return tx(db, () => trips.create(db, fields));
}

// Dispatch a parsed payload to the right side effect. Returns
// `{ reply, state }` so callers (and tests) can inspect without mocking I/O.
// `reply` is the captain-facing text or null; `state` is the new
// conversation_state body or null (null = clear/no write).
export async function routeParsed({
  db,
  chatId,
  captain,
  parsed,
  rawText,
  receivedAt,
  correctionCount = 0,
  existingOpenTripId = null,
}) {
  const intent = parsed.intent ?? 'trip';
  const subIntent = parsed.sub_intent ?? null;
  const multiOpenReply = `You have more than one open trip, ${captain.name}. I'll need 3.1b's arbitration to sort it out — for now, text Eric.`;

  if (intent === 'drill') {
    const boatSlug = await boatSlugFor(parsed.boat);
    if (!boatSlug) {
      const shown = parsed.boat ? `"${parsed.boat}"` : 'that boat';
      return {
        reply: `I don't recognize ${shown} as a Brewboat fleet boat, ${captain.name}. What boat was the drill on?`,
        state: null,
      };
    }
    saveState(db, chatId, {
      status: 'awaiting_confirmation',
      kind: 'drill',
      raw_message: rawText,
      parsed,
      received_at: receivedAt ?? new Date().toISOString(),
      correction_count: correctionCount,
    });
    return { reply: formatDrillConfirmation(captain.name, parsed), state: 'awaiting_confirmation' };
  }

  if (intent === 'unknown') {
    return {
      reply: `I didn't catch what that was about, ${captain.name}. Trip, drill, or something else? Send it again with a bit more context.`,
      state: null,
    };
  }

  if (subIntent === 'starting') {
    try {
      await openTrip({ db, chatId, captain, parsed });
    } catch (err) {
      if (err.code === 'UNKNOWN_BOAT') {
        const shown = err.boatName ? `"${err.boatName}"` : 'that boat';
        return { reply: `I don't recognize ${shown} as a Brewboat fleet boat, ${captain.name}. What boat are you on?`, state: null };
      }
      throw err;
    }
    const where = parsed.route ? ` out on ${parsed.route}` : '';
    const boat = parsed.boat ?? 'the boat';
    return {
      reply: `Got it — ${boat}${where}. Text me when you're back.`,
      state: null,
    };
  }

  if (subIntent === 'update') {
    let active;
    try {
      active = trips.findActive(db, chatId);
    } catch (err) {
      console.error('[purser] findActive multi-open on update:', err.message);
      return { reply: multiOpenReply, state: null };
    }
    if (!active) {
      return {
        reply: `No open trip on file, ${captain.name}. Send me the trip details and I'll start one.`,
        state: null,
      };
    }
    await updateOpenTrip({ db, tripId: active.id, parsed });
    return { reply: `Noted.`, state: null };
  }

  // 'done' merges any open trip's fields into `parsed` and routes through
  // the confirmation flow, exactly like single-message logs do.
  // null (single-message) falls through here too.
  let mergedParsed = parsed;
  let openTripId = existingOpenTripId;
  if (subIntent === 'done' && existingOpenTripId == null) {
    let active;
    try {
      active = trips.findActive(db, chatId);
    } catch (err) {
      console.error('[purser] findActive multi-open on done:', err.message);
      return { reply: multiOpenReply, state: null };
    }
    if (active) {
      openTripId = active.id;
      mergedParsed = mergeOpenTripIntoParsed(active, parsed);
    }
  } else if (subIntent === 'done' && existingOpenTripId != null) {
    const active = trips.findById(db, existingOpenTripId);
    if (active) mergedParsed = mergeOpenTripIntoParsed(active, parsed);
  }

  saveState(db, chatId, {
    status: 'awaiting_confirmation',
    kind: 'trip',
    raw_message: rawText,
    parsed: mergedParsed,
    received_at: receivedAt ?? new Date().toISOString(),
    correction_count: correctionCount,
    ...(openTripId ? { open_trip_id: openTripId } : {}),
  });
  return { reply: formatConfirmation(captain.name, mergedParsed), state: 'awaiting_confirmation' };
}

// Carry forward fields the captain set on `starting` so the `done`
// confirmation shows the full picture. Boat/route stay as slugs on the open
// row; fileTrip's open_trip_id path bypasses slug re-resolution.
function mergeOpenTripIntoParsed(openRow, parsed) {
  const merged = { ...parsed };
  if (merged.trip_start == null && openRow.start_time) merged.trip_start = openRow.start_time;
  if (merged.trip_end == null && openRow.end_time) merged.trip_end = openRow.end_time;
  if (merged.first_mate == null && openRow.first_mate_text) merged.first_mate = openRow.first_mate_text;
  return merged;
}

async function parseAndRoute({
  db,
  chatId,
  rawText,
  captain,
  prior = null,
  correction = null,
  correctionCount = 0,
  receivedAt = null,
  existingOpenTripId = null,
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
    const { reply } = await routeParsed({
      db,
      chatId,
      captain,
      parsed,
      rawText,
      receivedAt,
      correctionCount,
      existingOpenTripId,
    });
    if (reply) await tgSend({ chatId, text: reply });
  } catch (err) {
    console.error('[purser] parseAndRoute failed:', err);
    await tgSend({
      chatId,
      text: `Something went wrong on my end, ${captain.name}. Try again in a moment.`,
    });
  }
}

function formatDraftReply(captainName, drafted) {
  return [
    `Draft issue, ${captainName}:`,
    '',
    `**${drafted.title}**`,
    '',
    drafted.body,
    '',
    `Send /file to submit, or /feedback cancel to drop it.`,
  ].join('\n');
}

export async function handleSlash({ db, chatId, captain, body }) {
  if (captain.role !== 'owner') {
    return { reply: `Feedback is owner-only for now, ${captain.name}. Text Eric if something's off.` };
  }

  const feedbackMatch = body.match(FEEDBACK_PATTERN);
  if (feedbackMatch) {
    const arg = (feedbackMatch[1] ?? '').trim();
    if (!arg) {
      return { reply: `Send /feedback followed by your observation, ${captain.name}.` };
    }
    if (/^cancel$/i.test(arg)) {
      const pending = feedback.findLatestPending(db, chatId);
      if (!pending) {
        return { reply: `Nothing pending to cancel, ${captain.name}.` };
      }
      feedback.markCancelled(db, pending.id);
      return { reply: `Cancelled, ${captain.name}.` };
    }
    let drafted;
    try {
      drafted = await feedback.draftFeedback(arg);
    } catch (err) {
      console.error('[purser] draftFeedback failed:', err);
      return { reply: `Couldn't draft that one, ${captain.name}. Try again or text Eric.` };
    }
    feedback.createPending(db, {
      chatId,
      body: arg,
      draftedTitle: drafted.title,
      draftedBody: drafted.body,
    });
    return { reply: formatDraftReply(captain.name, drafted) };
  }

  if (FILE_PATTERN.test(body)) {
    const pending = feedback.findLatestPending(db, chatId);
    if (!pending) {
      return { reply: `Nothing pending to file, ${captain.name}. Send /feedback <observation> first.` };
    }
    const [title, ...rest] = (pending.drafted_issue_body ?? '').split('\n\n');
    const issueBody = rest.join('\n\n');
    if (!title || !issueBody) {
      return { reply: `That draft looks empty, ${captain.name}. Re-send /feedback with the observation.` };
    }
    let url;
    try {
      ({ url } = await feedback.fileViaGh({ title, body: issueBody }));
    } catch (err) {
      console.error('[purser] fileViaGh failed:', err);
      return { reply: `Couldn't file that one, ${captain.name}. Text Eric.` };
    }
    feedback.markFiled(db, pending.id, url);
    return { reply: `Filed: ${url}` };
  }

  // SLASH_COMMAND_PATTERN matched but no sub-pattern did — shouldn't happen
  // unless the patterns drift. Treat as unknown.
  return { reply: `I don't recognize that command, ${captain.name}.` };
}

export async function handle({ chatId, body, source, db }) {
  const scribbled = await scribblerHandle({ chatId, body, source });

  if (!scribbled.captain) {
    return { reply: scribbled.reply };
  }

  const { captain } = scribbled;

  // Slash commands bypass Haiku entirely. State (including any in-flight
  // confirmation) is preserved so a stray /file doesn't blow away a pending Y.
  if (SLASH_COMMAND_PATTERN.test(body)) {
    return await handleSlash({ db, chatId, captain, body });
  }

  const state = loadState(db, chatId);

  if (state.status === 'awaiting_confirmation') {
    if (Y_PATTERN.test(body)) {
      const kind = state.kind ?? 'trip';
      try {
        if (kind === 'drill') {
          await fileDrill({ db, chatId, captain, state, source });
        } else {
          await fileTrip({ db, chatId, captain, state, source });
        }
      } catch (err) {
        console.error(`[purser] file${kind === 'drill' ? 'Drill' : 'Trip'} failed:`, err);
        if (err.code === 'UNKNOWN_BOAT') {
          // Leave state in awaiting_confirmation — the captain's next message
          // is treated as a correction and re-parsed against the prior parse.
          const shown = err.boatName ? `"${err.boatName}"` : 'that boat';
          return {
            reply: `I don't recognize ${shown} as a Brewboat fleet boat, ${captain.name}. Reply with the correct boat name and I'll re-confirm.`,
          };
        }
        if (err.code === 'DRILL_TYPE_MISSING') {
          return {
            reply: `I didn't catch the drill type, ${captain.name}. Reply with which drill (abandon ship, MOB, fire, or crew emergency) and I'll re-confirm.`,
          };
        }
        return { reply: `Something went wrong filing that, ${captain.name}. Try again or text Eric.` };
      }
      clearState(db, chatId);
      return { reply: `Filed. Thanks, ${captain.name}.` };
    }

    // Correction — re-parse async, no immediate reply. Preserve open_trip_id
    // across re-parse so a correction on a `done` doesn't lose the link to
    // the open row it was about to close.
    setImmediate(() =>
      parseAndRoute({
        db,
        chatId,
        rawText: state.raw_message,
        captain,
        prior: state.parsed,
        correction: body,
        correctionCount: (state.correction_count ?? 0) + 1,
        receivedAt: state.received_at,
        existingOpenTripId: state.open_trip_id ?? null,
      }),
    );
    return { reply: null };
  }

  // Idle / no state — new trip message
  const receivedAt = new Date().toISOString();
  setImmediate(() => parseAndRoute({ db, chatId, rawText: body, captain, receivedAt }));
  return { reply: `Got it, ${captain.name}. Parsing now.` };
}
