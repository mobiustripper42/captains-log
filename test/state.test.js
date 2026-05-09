import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { load, save, clear } from '../lib/state.js';

let dir;

test('setup', async () => {
  dir = await mkdtemp(join(tmpdir(), 'captainslog-state-'));
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('load returns {} for missing file', async () => {
  const state = await load('nonexistent', dir);
  assert.deepEqual(state, {});
});

test('save and load roundtrip', async () => {
  const data = { status: 'awaiting_confirmation', raw_message: 'test', correction_count: 0 };
  await save('abc', data, dir);
  const loaded = await load('abc', dir);
  assert.deepEqual(loaded, data);
});

test('save is atomic — no partial reads', async () => {
  const data = { status: 'idle', x: 'a'.repeat(10_000) };
  await Promise.all([
    save('concurrent', { ...data, seq: 1 }, dir),
    save('concurrent', { ...data, seq: 2 }, dir),
    save('concurrent', { ...data, seq: 3 }, dir),
  ]);
  const loaded = await load('concurrent', dir);
  assert.ok([1, 2, 3].includes(loaded.seq), 'should be one of the writes');
  assert.equal(loaded.x, data.x, 'payload should be intact');
});

test('clear sets status: idle', async () => {
  await save('toclean', { status: 'awaiting_confirmation', raw_message: 'x' }, dir);
  await clear('toclean', dir);
  const loaded = await load('toclean', dir);
  assert.equal(loaded.status, 'idle');
});

test('different chatIds are isolated', async () => {
  await save('captain-1', { status: 'idle' }, dir);
  await save('captain-2', { status: 'awaiting_confirmation' }, dir);
  const s1 = await load('captain-1', dir);
  const s2 = await load('captain-2', dir);
  assert.equal(s1.status, 'idle');
  assert.equal(s2.status, 'awaiting_confirmation');
});
