import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../lib/db.js';
import { migrate } from '../lib/migrate.js';
import { load, save, clear } from '../lib/state.js';

function freshDb() {
  const db = openDb(':memory:');
  migrate(db);
  return db;
}

test('load returns {} for missing row', () => {
  const db = freshDb();
  assert.deepEqual(load(db, 'nonexistent'), {});
});

test('save and load roundtrip', () => {
  const db = freshDb();
  const data = { status: 'awaiting_confirmation', raw_message: 'test', correction_count: 0 };
  save(db, 'abc', data);
  assert.deepEqual(load(db, 'abc'), data);
});

test('upsert overwrites — one row per chat_id', () => {
  const db = freshDb();
  save(db, 'abc', { seq: 1 });
  save(db, 'abc', { seq: 2 });
  save(db, 'abc', { seq: 3 });
  assert.deepEqual(load(db, 'abc'), { seq: 3 });
  const { n } = db
    .prepare('SELECT COUNT(*) AS n FROM conversation_state WHERE chat_id = ?')
    .get('abc');
  assert.equal(n, 1);
});

test('clear sets status: idle', () => {
  const db = freshDb();
  save(db, 'toclean', { status: 'awaiting_confirmation', raw_message: 'x' });
  clear(db, 'toclean');
  assert.deepEqual(load(db, 'toclean'), { status: 'idle' });
});

test('different chatIds are isolated', () => {
  const db = freshDb();
  save(db, 'captain-1', { status: 'idle' });
  save(db, 'captain-2', { status: 'awaiting_confirmation' });
  assert.equal(load(db, 'captain-1').status, 'idle');
  assert.equal(load(db, 'captain-2').status, 'awaiting_confirmation');
});

test('chatId is coerced to string', () => {
  const db = freshDb();
  save(db, 12345, { status: 'idle' });
  assert.deepEqual(load(db, 12345), { status: 'idle' });
  assert.deepEqual(load(db, '12345'), { status: 'idle' });
});
