import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../lib/db.js';
import { migrate } from '../lib/migrate.js';
import { formatRow, syncAll, syncToSheet, _resetCacheForTests as resetSheets } from '../lib/sheets.js';
import { _resetCacheForTests as resetRosters } from '../lib/rosters.js';
import * as trips from '../lib/trips.js';

function freshDb() {
  resetRosters();
  resetSheets();
  const db = openDb(':memory:');
  migrate(db);
  return db;
}

function seedTrip(db, overrides = {}) {
  const fields = {
    status: 'confirmed',
    captain_chat_id: '123456789',
    captain_name: 'Eric',
    boat_slug: 'brewboat',
    route_slug: 'cuyahoga',
    trip_date: '2026-05-17',
    start_time: '13:00',
    end_time: '20:00',
    passenger_count: 30,
    first_mate_text: 'Mike',
    notes: 'good day',
    weather_summary: 'sunny, calm',
    confirmed_at: '2026-05-17T20:30:00Z',
    parse_json: JSON.stringify({
      parsed: { issues: [], emergency_drills: null },
    }),
    ...overrides,
  };
  return trips.create(db, fields);
}

test('formatRow maps trip → Brewboat Form schema', async () => {
  const db = freshDb();
  const { id } = seedTrip(db);
  const trip = trips.findById(db, id);
  const row = await formatRow(trip);

  assert.equal(row.Timestamp, '2026-05-17T20:30:00Z');
  assert.equal(row.Date, '2026-05-17');
  assert.equal(row['Departure Time'], '13:00');
  assert.equal(row.Equipment, 'Brewboat');
  assert.equal(row.Captain, 'Eric');
  assert.equal(row['First Mate'], 'Mike');
  assert.equal(row['Number of Passengers'], 30);
  assert.equal(row['Weather Forecast/Actual'], 'sunny, calm');
  assert.equal(row['Destinations/Stops'], 'Cuyahoga River');
  assert.equal(row['Vessel Concerns and Captain Notes'], 'good day');
  assert.equal(row['Emergency Drills (monthly checkbox)'], '');
});

test('formatRow includes "Yes" when emergency_drills is true', async () => {
  const db = freshDb();
  const { id } = seedTrip(db, {
    parse_json: JSON.stringify({ parsed: { issues: [], emergency_drills: true } }),
  });
  const trip = trips.findById(db, id);
  const row = await formatRow(trip);
  assert.equal(row['Emergency Drills (monthly checkbox)'], 'Yes');
});

test('formatRow merges issues into the notes column', async () => {
  const db = freshDb();
  const { id } = seedTrip(db, {
    notes: 'rough chop late afternoon',
    parse_json: JSON.stringify({
      parsed: { issues: ['VHF cutting out on ch 16', 'bilge alarm flickered once'], emergency_drills: null },
    }),
  });
  const trip = trips.findById(db, id);
  const row = await formatRow(trip);
  const notes = row['Vessel Concerns and Captain Notes'];
  assert.ok(notes.includes('rough chop late afternoon'));
  assert.ok(notes.includes('Issue: VHF cutting out on ch 16'));
  assert.ok(notes.includes('Issue: bilge alarm flickered once'));
});

test('formatRow tolerates missing parse_json and null route', async () => {
  const db = freshDb();
  const { id } = seedTrip(db, { parse_json: null, route_slug: null });
  const trip = trips.findById(db, id);
  const row = await formatRow(trip);
  assert.equal(row['Destinations/Stops'], '');
  assert.equal(row['Emergency Drills (monthly checkbox)'], '');
});

test('formatRow falls back to boat_slug when slug is not in roster', async () => {
  const db = freshDb();
  const { id } = seedTrip(db, { boat_slug: 'ghost-boat' });
  const trip = trips.findById(db, id);
  const row = await formatRow(trip);
  assert.equal(row.Equipment, 'ghost-boat');
});

test('syncAll early-exits with no unsynced trips and never opens the sheet', async () => {
  const db = freshDb();
  delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  delete process.env.GOOGLE_SHEET_ID;
  const result = await syncAll(db, { logger: { log() {}, error() {} } });
  assert.deepEqual(result, { synced: 0, failed: 0, pending: 0 });
});

test('syncToSheet appends every unsynced trip and marks each one synced', async () => {
  const db = freshDb();
  seedTrip(db);
  seedTrip(db, { trip_date: '2026-05-18', confirmed_at: '2026-05-18T20:00:00Z' });

  const captured = [];
  const fakeSheet = {
    async addRow(row) {
      captured.push(row);
    },
  };

  const silent = { log() {}, error() {} };
  const result = await syncToSheet(db, fakeSheet, { logger: silent });
  assert.equal(result.synced, 2);
  assert.equal(result.failed, 0);
  assert.equal(captured.length, 2);
  assert.equal(trips.findUnsynced(db).length, 0);
});

test('syncToSheet counts failures and leaves failed trips unsynced', async () => {
  const db = freshDb();
  const { id: a } = seedTrip(db);
  const { id: b } = seedTrip(db, { trip_date: '2026-05-18' });

  let calls = 0;
  const flakySheet = {
    async addRow() {
      calls++;
      if (calls === 1) throw new Error('quota exceeded');
    },
  };

  const silent = { log() {}, error() {} };
  const result = await syncToSheet(db, flakySheet, { logger: silent });
  assert.equal(result.synced, 1);
  assert.equal(result.failed, 1);

  const unsynced = trips.findUnsynced(db).map((t) => t.id);
  assert.deepEqual(unsynced, [a]);
  assert.ok(trips.findById(db, b).sheet_synced_at);
});
