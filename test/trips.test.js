import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../lib/db.js';
import { migrate } from '../lib/migrate.js';
import * as trips from '../lib/trips.js';

function freshDb() {
  const db = openDb(':memory:');
  migrate(db);
  return db;
}

const minimal = {
  status: 'confirmed',
  captain_chat_id: '8637420543',
  captain_name: 'Eric',
  boat_slug: 'brewboat',
  trip_date: '2026-05-11',
};

test('trips.create round-trips a minimal row', () => {
  const db = freshDb();
  const { id } = trips.create(db, minimal);
  assert.equal(typeof id, 'number');
  const row = trips.findById(db, id);
  assert.equal(row.captain_name, 'Eric');
  assert.equal(row.boat_slug, 'brewboat');
  assert.equal(row.status, 'confirmed');
});

test('trips.create rejects missing required fields', () => {
  const db = freshDb();
  assert.throws(() => trips.create(db, { ...minimal, boat_slug: undefined }), /boat_slug/);
});

test('trips.create persists optional fields including JSON parse_json', () => {
  const db = freshDb();
  const { id } = trips.create(db, {
    ...minimal,
    passenger_count: 12,
    first_mate_text: 'Mike',
    notes: 'choppy',
    parse_json: JSON.stringify({ a: 1 }),
    confirmed_at: '2026-05-11T22:00:00Z',
  });
  const row = trips.findById(db, id);
  assert.equal(row.passenger_count, 12);
  assert.equal(row.first_mate_text, 'Mike');
  assert.equal(row.notes, 'choppy');
  assert.equal(JSON.parse(row.parse_json).a, 1);
});

test('trips.create with first_mate_crew_id requires existing crew row (FK)', () => {
  const db = freshDb();
  assert.throws(() => trips.create(db, { ...minimal, first_mate_crew_id: 999 }), /FOREIGN KEY/);
  db.prepare("INSERT INTO crew (id, name) VALUES (1, 'Eric')").run();
  const { id } = trips.create(db, { ...minimal, first_mate_crew_id: 1 });
  assert.equal(trips.findById(db, id).first_mate_crew_id, 1);
});

test('findUnsynced returns only confirmed + unsynced', () => {
  const db = freshDb();
  const a = trips.create(db, minimal).id;
  const b = trips.create(db, { ...minimal, status: 'cancelled' }).id;
  const c = trips.create(db, minimal).id;
  trips.markSynced(db, c, '2026-05-11T23:00:00Z');
  const unsynced = trips.findUnsynced(db).map((r) => r.id);
  assert.deepEqual(unsynced, [a]);
  assert.ok(!unsynced.includes(b));
  assert.ok(!unsynced.includes(c));
});

test('markSynced sets sheet_synced_at and bumps updated_at', () => {
  const db = freshDb();
  const { id } = trips.create(db, minimal);
  const before = trips.findById(db, id).updated_at;
  // ensure a clock tick
  const changed = trips.markSynced(db, id, '2026-05-11T23:00:00Z');
  assert.equal(changed, 1);
  const after = trips.findById(db, id);
  assert.equal(after.sheet_synced_at, '2026-05-11T23:00:00Z');
  assert.ok(after.updated_at >= before);
});

test('update applies patch and bumps updated_at; ignores unknown keys', () => {
  const db = freshDb();
  const { id } = trips.create(db, minimal);
  const changes = trips.update(db, id, { notes: 'updated', bogus_field: 'ignored' });
  assert.equal(changes, 1);
  assert.equal(trips.findById(db, id).notes, 'updated');
});

test('findActive returns null when no open trip for captain', () => {
  const db = freshDb();
  trips.create(db, minimal);
  assert.equal(trips.findActive(db, minimal.captain_chat_id), null);
});

test('findActive returns the single open trip for a captain', () => {
  const db = freshDb();
  const open = trips.create(db, { ...minimal, status: 'open' }).id;
  trips.create(db, minimal);
  const row = trips.findActive(db, minimal.captain_chat_id);
  assert.equal(row.id, open);
  assert.equal(row.status, 'open');
});

test('findActive scopes by captain — another captain\'s open is not returned', () => {
  const db = freshDb();
  trips.create(db, { ...minimal, status: 'open', captain_chat_id: '99' });
  assert.equal(trips.findActive(db, minimal.captain_chat_id), null);
});

test('findActive throws when a captain has multiple open trips (3.1b territory)', () => {
  const db = freshDb();
  trips.create(db, { ...minimal, status: 'open' });
  trips.create(db, { ...minimal, status: 'open' });
  assert.throws(() => trips.findActive(db, minimal.captain_chat_id), /multi-open arbitration/);
});

test('confirmOpen flips status to confirmed and applies patch', () => {
  const db = freshDb();
  const { id } = trips.create(db, { ...minimal, status: 'open', passenger_count: null });
  trips.confirmOpen(db, id, { passenger_count: 14, notes: 'choppy', confirmed_at: '2026-05-21T20:00:00Z' });
  const row = trips.findById(db, id);
  assert.equal(row.status, 'confirmed');
  assert.equal(row.passenger_count, 14);
  assert.equal(row.notes, 'choppy');
  assert.equal(row.confirmed_at, '2026-05-21T20:00:00Z');
});

test('confirmOpen defaults confirmed_at when omitted', () => {
  const db = freshDb();
  const { id } = trips.create(db, { ...minimal, status: 'open' });
  trips.confirmOpen(db, id, { passenger_count: 7 });
  const row = trips.findById(db, id);
  assert.equal(row.status, 'confirmed');
  assert.ok(row.confirmed_at, 'confirmed_at should be auto-stamped');
});

test('remove deletes the row', () => {
  const db = freshDb();
  const { id } = trips.create(db, minimal);
  assert.equal(trips.remove(db, id), 1);
  assert.equal(trips.findById(db, id), null);
});
