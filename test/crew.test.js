import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../lib/db.js';
import { migrate } from '../lib/migrate.js';
import { resolve } from '../lib/crew.js';
import { _resetCacheForTests } from '../lib/rosters.js';

function freshDb() {
  _resetCacheForTests();
  const db = openDb(':memory:');
  migrate(db);
  return db;
}

test('resolve returns null for unknown name', async () => {
  const db = freshDb();
  assert.equal(await resolve(db, 'nobody'), null);
});

test('resolve returns null for empty / null input', async () => {
  const db = freshDb();
  assert.equal(await resolve(db, null), null);
  assert.equal(await resolve(db, ''), null);
  assert.equal(await resolve(db, '   '), null);
});

test('resolve matches canonical name case-insensitively and creates a crew row', async () => {
  const db = freshDb();
  const id = await resolve(db, 'eric');
  assert.equal(typeof id, 'number');
  const row = db.prepare('SELECT * FROM crew WHERE id = ?').get(id);
  assert.equal(row.name, 'Eric');
  assert.equal(row.full_name, 'Eric Stoffer');
});

test('resolve matches via alias', async () => {
  const db = freshDb();
  const id = await resolve(db, 'Stoffer');
  const row = db.prepare('SELECT * FROM crew WHERE id = ?').get(id);
  assert.equal(row.name, 'Eric');
});

test('resolve is idempotent — repeat calls return same id, no duplicate row', async () => {
  const db = freshDb();
  const a = await resolve(db, 'Eric');
  const b = await resolve(db, 'eric');
  const c = await resolve(db, 'e');
  assert.equal(a, b);
  assert.equal(b, c);
  const count = db.prepare("SELECT COUNT(*) AS n FROM crew WHERE LOWER(name) = 'eric'").get().n;
  assert.equal(count, 1);
});

test('crew(name) has a case-insensitive unique index', () => {
  const db = freshDb();
  db.prepare('INSERT INTO crew (name) VALUES (?)').run('Aaron');
  assert.throws(
    () => db.prepare('INSERT INTO crew (name) VALUES (?)').run('aaron'),
    /UNIQUE constraint failed/,
  );
});

test('resolve finds an existing row inserted directly (no double-insert)', async () => {
  const db = freshDb();
  const { lastInsertRowid } = db
    .prepare('INSERT INTO crew (name, full_name) VALUES (?, ?)')
    .run('Eric', 'Eric Stoffer');
  const id = await resolve(db, 'eric');
  assert.equal(id, Number(lastInsertRowid));
  const count = db.prepare("SELECT COUNT(*) AS n FROM crew WHERE LOWER(name) = 'eric'").get().n;
  assert.equal(count, 1);
});
