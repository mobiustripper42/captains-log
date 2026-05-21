// Set BEFORE imports so weather.js sees it from the first call.
process.env.CAPTAINSLOG_NO_WEATHER = '1';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Y_PATTERN, formatConfirmation, fileTrip, routeParsed } from '../lib/purser.js';
import { load as loadState } from '../lib/state.js';
import * as trips from '../lib/trips.js';
import { openDb } from '../lib/db.js';
import { migrate } from '../lib/migrate.js';
import { _resetCacheForTests as resetRosters } from '../lib/rosters.js';
import { _resetCacheForTests as resetWeather } from '../lib/weather.js';

function freshDb() {
  resetRosters();
  resetWeather();
  const db = openDb(':memory:');
  migrate(db);
  return db;
}

// --- Y_PATTERN ---

test('Y_PATTERN matches bare Y', () => {
  assert.ok(Y_PATTERN.test('Y'));
  assert.ok(Y_PATTERN.test('y'));
});

test('Y_PATTERN matches yes / yep / yo', () => {
  assert.ok(Y_PATTERN.test('yes'));
  assert.ok(Y_PATTERN.test('YES'));
  assert.ok(Y_PATTERN.test('yep'));
  assert.ok(Y_PATTERN.test('yo'));
});

test('Y_PATTERN matches with surrounding whitespace', () => {
  assert.ok(Y_PATTERN.test('  Y  '));
  assert.ok(Y_PATTERN.test('\tyes\n'));
});

test('Y_PATTERN rejects corrections and other text', () => {
  assert.ok(!Y_PATTERN.test('actually 3 trips not 4'));
  assert.ok(!Y_PATTERN.test('yeah but the boat was blue'));
  assert.ok(!Y_PATTERN.test(''));
  assert.ok(!Y_PATTERN.test('nope'));
});

// --- formatConfirmation ---

const full = {
  boat: 'Brewboat',
  route: 'Cuyahoga River',
  trip_count: 3,
  trip_start: '1:00pm',
  trip_end: '8:00pm',
  total_passengers: 45,
  passengers_by_trip: null,
  first_mate: 'Mike',
  emergency_drills: null,
  issues: [],
  notes: null,
};

test('formatConfirmation happy path includes all key fields', () => {
  const msg = formatConfirmation('Eric', full);
  assert.ok(msg.includes('Brewboat'));
  assert.ok(msg.includes('Cuyahoga River'));
  assert.ok(msg.includes('3 trips'));
  assert.ok(msg.includes('1:00pm'));
  assert.ok(msg.includes('8:00pm'));
  assert.ok(msg.includes('45 passengers'));
  assert.ok(msg.includes('First mate: Mike'));
  assert.ok(msg.includes('Reply Y to file'));
});

test('formatConfirmation warns on missing first mate', () => {
  const msg = formatConfirmation('Eric', { ...full, first_mate: null });
  assert.ok(msg.includes('⚠ First mate: not provided'));
});

test('formatConfirmation shows per-trip breakdown when available', () => {
  const msg = formatConfirmation('Eric', {
    ...full,
    passengers_by_trip: [12, 12, 13],
    total_passengers: 37,
  });
  assert.ok(msg.includes('12 + 12 + 13 = 37'));
  assert.ok(!msg.includes('45 passengers'));
});

test('formatConfirmation shows emergency drills when completed', () => {
  const msg = formatConfirmation('Eric', { ...full, emergency_drills: true });
  assert.ok(msg.includes('Emergency drills: completed'));
});

test('formatConfirmation omits emergency drills when null', () => {
  const msg = formatConfirmation('Eric', { ...full, emergency_drills: null });
  assert.ok(!msg.includes('Emergency drills'));
});

test('formatConfirmation lists issues', () => {
  const msg = formatConfirmation('Eric', {
    ...full,
    issues: ['VHF cutting out on ch 16'],
  });
  assert.ok(msg.includes('Issue: VHF cutting out on ch 16'));
});

test('formatConfirmation singular trip', () => {
  const msg = formatConfirmation('Eric', { ...full, trip_count: 1 });
  assert.ok(msg.includes('1 trip,'));
  assert.ok(!msg.includes('1 trips'));
});

test('formatConfirmation uses captain name in header', () => {
  const msg = formatConfirmation('Drew', full);
  assert.ok(msg.startsWith('Confirming your log, Drew:'));
});

// --- fileTrip — boat-slug resolution ---

const captain = { name: 'Eric' };

function stateWith(parsedOverrides) {
  return {
    parsed: {
      boat: 'Brewboat',
      route: 'Cuyahoga River',
      trip_count: 1,
      total_passengers: 10,
      ...parsedOverrides,
    },
    raw_message: 'test message',
    received_at: '2026-05-17T20:00:00Z',
    correction_count: 0,
  };
}

test('fileTrip throws UNKNOWN_BOAT when parsed.boat does not resolve', async () => {
  const db = freshDb();
  await assert.rejects(
    () => fileTrip({ db, chatId: '1', captain, state: stateWith({ boat: 'Mystery Boat' }), source: 'telegram' }),
    (err) => err.code === 'UNKNOWN_BOAT' && err.boatName === 'Mystery Boat',
  );
  const count = db.prepare('SELECT COUNT(*) AS n FROM trips').get().n;
  assert.equal(count, 0, 'no trip row should be written on unknown-boat reject');
});

test('fileTrip throws UNKNOWN_BOAT when parsed.boat is empty', async () => {
  const db = freshDb();
  await assert.rejects(
    () => fileTrip({ db, chatId: '1', captain, state: stateWith({ boat: null }), source: 'telegram' }),
    (err) => err.code === 'UNKNOWN_BOAT' && err.boatName === null,
  );
});

test('fileTrip succeeds with a known boat slug; CAPTAINSLOG_NO_WEATHER skips the lookup', async () => {
  const db = freshDb();
  const { id } = await fileTrip({
    db,
    chatId: '1',
    captain,
    state: stateWith({ boat: 'Brewboat' }),
    source: 'telegram',
  });
  const row = db.prepare('SELECT boat_slug, status, weather_summary FROM trips WHERE id = ?').get(id);
  assert.equal(row.boat_slug, 'brewboat');
  assert.equal(row.status, 'confirmed');
  assert.equal(row.weather_summary, null);
});
// (Weather happy-path with a fake fetch is covered in test/weather.test.js;
// not duplicated here so we don't have to toggle env vars mid-suite.)

// --- routeParsed — sub_intent dispatch ---

const baseParsed = {
  boat: 'Brewboat',
  route: 'Cuyahoga River',
  trip_count: null,
  total_passengers: null,
  passengers_by_trip: null,
  trip_start: null,
  trip_end: null,
  first_mate: null,
  emergency_drills: null,
  issues: [],
  notes: null,
};

test('routeParsed starting — creates open trip, no state write, returns ack', async () => {
  const db = freshDb();
  const result = await routeParsed({
    db,
    chatId: '1',
    captain,
    parsed: { ...baseParsed, sub_intent: 'starting', trip_start: '1:00pm' },
    rawText: 'starting Cuyahoga in Brewboat',
    receivedAt: '2026-05-21T17:00:00Z',
  });
  assert.equal(result.state, null);
  assert.match(result.reply, /Got it/);
  const open = trips.findActive(db, '1');
  assert.ok(open, 'expected open trip row');
  assert.equal(open.boat_slug, 'brewboat');
  assert.equal(open.route_slug, 'cuyahoga');
  assert.equal(open.start_time, '1:00pm');
  assert.equal(loadState(db, '1').status, undefined, 'no conversation_state row');
});

test('routeParsed starting — unknown boat returns friendly reply, no row', async () => {
  const db = freshDb();
  const result = await routeParsed({
    db,
    chatId: '1',
    captain,
    parsed: { ...baseParsed, sub_intent: 'starting', boat: 'Mystery Boat' },
    rawText: 'starting on Mystery',
    receivedAt: '2026-05-21T17:00:00Z',
  });
  assert.match(result.reply, /don't recognize/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM trips').get().n, 0);
});

test('routeParsed update — with no open trip returns nudge', async () => {
  const db = freshDb();
  const result = await routeParsed({
    db,
    chatId: '1',
    captain,
    parsed: { ...baseParsed, sub_intent: 'update', total_passengers: 8 },
    rawText: '8 pax on board now',
    receivedAt: '2026-05-21T17:00:00Z',
  });
  assert.match(result.reply, /No open trip on file/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM trips').get().n, 0);
});

test('routeParsed update — merges into open trip, no state write', async () => {
  const db = freshDb();
  await routeParsed({
    db,
    chatId: '1',
    captain,
    parsed: { ...baseParsed, sub_intent: 'starting', trip_start: '1:00pm' },
    rawText: 'starting',
    receivedAt: '2026-05-21T17:00:00Z',
  });
  const result = await routeParsed({
    db,
    chatId: '1',
    captain,
    parsed: { ...baseParsed, sub_intent: 'update', notes: 'fog rolling in' },
    rawText: 'fog rolling in',
    receivedAt: '2026-05-21T17:15:00Z',
  });
  assert.equal(result.reply, 'Noted.');
  const row = trips.findActive(db, '1');
  assert.equal(row.notes, 'fog rolling in');
  assert.equal(row.start_time, '1:00pm', 'starting fields preserved');
});

test('routeParsed done — with open trip merges + sets open_trip_id in state', async () => {
  const db = freshDb();
  await routeParsed({
    db,
    chatId: '1',
    captain,
    parsed: { ...baseParsed, sub_intent: 'starting', trip_start: '1:00pm' },
    rawText: 'starting',
    receivedAt: '2026-05-21T17:00:00Z',
  });
  const openId = trips.findActive(db, '1').id;
  const result = await routeParsed({
    db,
    chatId: '1',
    captain,
    parsed: { ...baseParsed, sub_intent: 'done', total_passengers: 12, trip_end: '4:00pm' },
    rawText: 'done, 12 pax',
    receivedAt: '2026-05-21T20:00:00Z',
  });
  assert.equal(result.state, 'awaiting_confirmation');
  assert.match(result.reply, /Confirming your log/);
  const state = loadState(db, '1');
  assert.equal(state.status, 'awaiting_confirmation');
  assert.equal(state.open_trip_id, openId);
  assert.equal(state.parsed.trip_start, '1:00pm', 'merged from open row');
  assert.equal(state.parsed.trip_end, '4:00pm');
  assert.equal(state.parsed.total_passengers, 12);
});

test('routeParsed done — with no open trip falls through to confirmation flow (no open_trip_id)', async () => {
  const db = freshDb();
  const result = await routeParsed({
    db,
    chatId: '1',
    captain,
    parsed: { ...baseParsed, sub_intent: 'done', total_passengers: 12 },
    rawText: 'done, 12 pax',
    receivedAt: '2026-05-21T20:00:00Z',
  });
  assert.equal(result.state, 'awaiting_confirmation');
  const state = loadState(db, '1');
  assert.equal(state.open_trip_id, undefined);
});

test('routeParsed null sub_intent preserves today\'s single-shot confirmation flow', async () => {
  const db = freshDb();
  const result = await routeParsed({
    db,
    chatId: '1',
    captain,
    parsed: { ...baseParsed, total_passengers: 30, trip_count: 2 },
    rawText: '2 trips, 30 pax',
    receivedAt: '2026-05-21T20:00:00Z',
  });
  assert.equal(result.state, 'awaiting_confirmation');
  assert.match(result.reply, /Confirming your log/);
  const state = loadState(db, '1');
  assert.equal(state.open_trip_id, undefined);
});

test('routeParsed done — existingOpenTripId (correction path) preserves the link without re-querying', async () => {
  const db = freshDb();
  // simulate the open trip already on file (e.g. from a prior `starting`)
  const { id: openId } = trips.create(db, {
    status: 'open',
    captain_chat_id: '1',
    captain_name: 'Eric',
    boat_slug: 'brewboat',
    trip_date: '2026-05-21',
    start_time: '1:00pm',
  });
  // also seed a second open trip — would normally make findActive throw.
  // existingOpenTripId path should bypass findActive entirely.
  trips.create(db, {
    status: 'open',
    captain_chat_id: '1',
    captain_name: 'Eric',
    boat_slug: 'brewboat',
    trip_date: '2026-05-21',
  });
  const result = await routeParsed({
    db,
    chatId: '1',
    captain,
    parsed: { ...baseParsed, sub_intent: 'done', total_passengers: 12 },
    rawText: 'done, 12 pax',
    receivedAt: '2026-05-21T20:00:00Z',
    existingOpenTripId: openId,
  });
  assert.equal(result.state, 'awaiting_confirmation');
  const state = loadState(db, '1');
  assert.equal(state.open_trip_id, openId);
  assert.equal(state.parsed.trip_start, '1:00pm', 'merged from the linked open row, not findActive');
});

test('routeParsed done — multi-open without existingOpenTripId returns friendly reply, not 500', async () => {
  const db = freshDb();
  trips.create(db, { status: 'open', captain_chat_id: '1', captain_name: 'Eric', boat_slug: 'brewboat', trip_date: '2026-05-21' });
  trips.create(db, { status: 'open', captain_chat_id: '1', captain_name: 'Eric', boat_slug: 'brewboat', trip_date: '2026-05-21' });
  const result = await routeParsed({
    db,
    chatId: '1',
    captain,
    parsed: { ...baseParsed, sub_intent: 'done', total_passengers: 12 },
    rawText: 'done',
    receivedAt: '2026-05-21T20:00:00Z',
  });
  assert.match(result.reply, /more than one open trip/);
  assert.equal(result.state, null);
});

test('routeParsed update — multi-open returns friendly reply, not 500', async () => {
  const db = freshDb();
  trips.create(db, { status: 'open', captain_chat_id: '1', captain_name: 'Eric', boat_slug: 'brewboat', trip_date: '2026-05-21' });
  trips.create(db, { status: 'open', captain_chat_id: '1', captain_name: 'Eric', boat_slug: 'brewboat', trip_date: '2026-05-21' });
  const result = await routeParsed({
    db,
    chatId: '1',
    captain,
    parsed: { ...baseParsed, sub_intent: 'update', notes: 'fog' },
    rawText: 'fog rolling in',
    receivedAt: '2026-05-21T17:00:00Z',
  });
  assert.match(result.reply, /more than one open trip/);
  assert.equal(result.state, null);
});

// --- fileTrip — open_trip_id path ---

test('fileTrip with state.open_trip_id updates the existing open row to confirmed', async () => {
  const db = freshDb();
  const { id: openId } = trips.create(db, {
    status: 'open',
    captain_chat_id: '1',
    captain_name: 'Eric',
    boat_slug: 'brewboat',
    trip_date: '2026-05-21',
    start_time: '1:00pm',
  });
  const state = {
    parsed: { ...baseParsed, sub_intent: 'done', total_passengers: 12, trip_end: '4:00pm' },
    raw_message: 'done, 12 pax',
    received_at: '2026-05-21T20:00:00Z',
    correction_count: 0,
    open_trip_id: openId,
  };
  const { id } = await fileTrip({ db, chatId: '1', captain, state, source: 'telegram' });
  assert.equal(id, openId, 'should update the same row, not insert');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM trips').get().n, 1);
  const row = db.prepare('SELECT * FROM trips WHERE id = ?').get(openId);
  assert.equal(row.status, 'confirmed');
  assert.equal(row.passenger_count, 12);
  assert.equal(row.end_time, '4:00pm');
  assert.equal(row.start_time, '1:00pm', 'starting fields preserved on confirm');
});

test('fileTrip with open_trip_id does not require parsed.boat (slug already on row)', async () => {
  const db = freshDb();
  const { id: openId } = trips.create(db, {
    status: 'open',
    captain_chat_id: '1',
    captain_name: 'Eric',
    boat_slug: 'brewboat',
    trip_date: '2026-05-21',
  });
  const state = {
    parsed: { ...baseParsed, boat: null, sub_intent: 'done', total_passengers: 9 },
    raw_message: 'done, 9 pax',
    received_at: '2026-05-21T20:00:00Z',
    correction_count: 0,
    open_trip_id: openId,
  };
  const { id } = await fileTrip({ db, chatId: '1', captain, state, source: 'telegram' });
  assert.equal(id, openId);
  assert.equal(db.prepare('SELECT status FROM trips WHERE id = ?').get(openId).status, 'confirmed');
});
