import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../lib/db.js';
import { migrate } from '../lib/migrate.js';

function freshDb() {
  const db = openDb(':memory:');
  migrate(db);
  return db;
}

test('migrate creates all 8 tables and bumps user_version', () => {
  const db = freshDb();
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r) => r.name);
  assert.deepEqual(tables, [
    'conversation_state',
    'crew',
    'drill_crew',
    'drills',
    'feedback',
    'handoffs',
    'trip_crew',
    'trips',
  ]);
  assert.equal(db.pragma('user_version', { simple: true }), 1);
});

test('migrate is idempotent', () => {
  const db = openDb(':memory:');
  migrate(db);
  migrate(db);
  assert.equal(db.pragma('user_version', { simple: true }), 1);
});

test('foreign keys are enforced on trip_crew', () => {
  const db = freshDb();
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  assert.throws(
    () => db.prepare('INSERT INTO trip_crew (trip_id, crew_id) VALUES (999, 999)').run(),
    /FOREIGN KEY/,
  );
});

test('trips.status CHECK rejects unknown status', () => {
  const db = freshDb();
  assert.throws(
    () =>
      db
        .prepare(
          "INSERT INTO trips (status, captain_chat_id, captain_name, boat_slug, trip_date) VALUES ('bogus', '1', 'X', 'b', '2026-05-11')",
        )
        .run(),
    /CHECK/,
  );
});

test('conversation_state.body rejects invalid JSON', () => {
  const db = freshDb();
  assert.throws(
    () =>
      db
        .prepare("INSERT INTO conversation_state (chat_id, body) VALUES ('1', 'not json')")
        .run(),
    /CHECK/,
  );
  db.prepare("INSERT INTO conversation_state (chat_id, body) VALUES ('2', '{\"a\":1}')").run();
});

test('trips.parse_json rejects invalid JSON but allows NULL', () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO trips (status, captain_chat_id, captain_name, boat_slug, trip_date) VALUES ('open', '1', 'X', 'b', '2026-05-11')",
  ).run();
  assert.throws(
    () =>
      db
        .prepare(
          "INSERT INTO trips (status, captain_chat_id, captain_name, boat_slug, trip_date, parse_json) VALUES ('open', '1', 'X', 'b', '2026-05-11', 'nope')",
        )
        .run(),
    /CHECK/,
  );
});

test('trip_crew cascades on trip delete', () => {
  const db = freshDb();
  db.prepare("INSERT INTO crew (id, name) VALUES (1, 'Alice')").run();
  const { lastInsertRowid: tripId } = db
    .prepare(
      "INSERT INTO trips (status, captain_chat_id, captain_name, boat_slug, trip_date) VALUES ('open', '1', 'X', 'b', '2026-05-11')",
    )
    .run();
  db.prepare('INSERT INTO trip_crew (trip_id, crew_id, role) VALUES (?, 1, ?)').run(
    tripId,
    'mate',
  );
  db.prepare('DELETE FROM trips WHERE id = ?').run(tripId);
  const remaining = db.prepare('SELECT COUNT(*) AS n FROM trip_crew').get().n;
  assert.equal(remaining, 0);
});
