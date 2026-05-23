import Anthropic from '@anthropic-ai/sdk';
import { load as loadRosters } from './rosters.js';

const client = new Anthropic();

function buildSystemPrompt(boats, routes) {
  const boatList = Object.values(boats)
    .map((b) => `  ${b.official_name} (aliases: ${b.aliases.join(', ')})`)
    .join('\n');
  const routeList = Object.values(routes)
    .map((r) => `  ${r.official_name} (aliases: ${r.aliases.join(', ')})`)
    .join('\n');

  return `You extract structured trip data from Brewboat captain messages.

Available boats (match aliases case-insensitively):
${boatList}

Available routes (match aliases case-insensitively):
${routeList}

Return a JSON object with exactly these fields. Use null for anything not mentioned:
{
  "intent": "<one of: trip, drill, unknown. trip = anything trip-related (starting, updating, finishing, or a single-message full log). drill = the message is about an emergency drill activity (not a trip that happened to include drills). unknown = can't classify as either>",
  "sub_intent": "<one of: starting, update, done, null. Only meaningful when intent=trip. null = single-message log covering the whole trip>",
  "boat": "<official boat name or null>",
  "route": "<official route name or null>",
  "trip_count": <integer or null>,
  "total_passengers": <integer or null>,
  "passengers_by_trip": [<integers> or null],
  "trip_start": "<time e.g. 2:00pm or null>",
  "trip_end": "<time e.g. 8:30pm or null>",
  "first_mate": "<name or null>",
  "emergency_drills": <true if drills mentioned as completed, false if explicitly not done, null if not mentioned>,
  "drill_type": "<one of: abandon_ship, mob, fire, crew_emergency, null. Only meaningful when intent=drill. mob = man-overboard>",
  "crew_present": [<crew name strings present for the drill, or null>],
  "issues": ["<equipment/safety/operational issue strings>"],
  "notes": "<anything else notable or null>"
}

If passengers_by_trip is provided, compute total_passengers as their sum.
Return ONLY the JSON object — no explanation, no markdown fences.`;
}

export async function parseTrip({ rawText, prior = null, correction = null }) {
  const { boats, routes } = await loadRosters();
  const system = buildSystemPrompt(boats, routes);

  const messages = [];
  if (prior && correction) {
    // Show original message + what was parsed, then the correction
    messages.push({ role: 'user', content: rawText });
    messages.push({ role: 'assistant', content: JSON.stringify(prior, null, 2) });
    messages.push({ role: 'user', content: `Correction from captain: ${correction}` });
  } else {
    messages.push({ role: 'user', content: rawText });
  }

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages,
  });

  const raw = response.content[0]?.text ?? '';
  // Strip markdown fences if present
  const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  try {
    return JSON.parse(text);
  } catch {
    console.error('[parse] non-JSON from Haiku:', raw.slice(0, 200));
    return null;
  }
}
