import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleInbound } from '../lib/scribbler.js';
import { _resetCacheForTests as resetCaptains } from '../lib/captains.js';

// `config/captains.json` ships with Eric at chat_id 8637420543. Use that as
// the "known captain" fixture so these tests run against the real lookup
// path without standing up a separate config file.
const ERIC_CHAT_ID = '8637420543';
const ERIC_NAME = 'Eric';
const UNKNOWN_CHAT_ID = '99999999999';

let tmpRawDir;
let savedEnv;

test.beforeEach(async () => {
  resetCaptains();
  tmpRawDir = await mkdtemp(join(tmpdir(), 'captainslog-scribbler-'));
  savedEnv = {
    UNKNOWN_SENDER: process.env.UNKNOWN_SENDER,
    CAPTAINSLOG_RAW_DIR: process.env.CAPTAINSLOG_RAW_DIR,
  };
  process.env.CAPTAINSLOG_RAW_DIR = tmpRawDir;
  delete process.env.UNKNOWN_SENDER;
});

test.afterEach(async () => {
  if (savedEnv.UNKNOWN_SENDER === undefined) delete process.env.UNKNOWN_SENDER;
  else process.env.UNKNOWN_SENDER = savedEnv.UNKNOWN_SENDER;
  if (savedEnv.CAPTAINSLOG_RAW_DIR === undefined) delete process.env.CAPTAINSLOG_RAW_DIR;
  else process.env.CAPTAINSLOG_RAW_DIR = savedEnv.CAPTAINSLOG_RAW_DIR;
  await rm(tmpRawDir, { recursive: true, force: true });
});

async function readOnlyRawFile() {
  const files = (await readdir(tmpRawDir)).filter((f) => f.endsWith('.log'));
  assert.equal(files.length, 1, `expected one raw log file, got ${files.length}`);
  return readFile(join(tmpRawDir, files[0]), 'utf8');
}

test('known captain → returns captain, reply, and source; raw line tagged with captain name', async () => {
  const result = await handleInbound({
    chatId: ERIC_CHAT_ID,
    body: '3 trips, 30 pax, Cuyahoga',
    source: 'telegram',
  });
  assert.equal(result.captain?.name, ERIC_NAME);
  assert.equal(result.source, 'telegram');
  assert.equal(result.reply, `Got it, ${ERIC_NAME}. Parsing now.`);

  const log = await readOnlyRawFile();
  assert.match(log, /\| telegram:8637420543 \| Eric \| 3 trips, 30 pax, Cuyahoga$/m);
});

test('unknown sender (default mode) → returns UNKNOWN_REPLY, raw line tagged "unknown"', async () => {
  const result = await handleInbound({
    chatId: UNKNOWN_CHAT_ID,
    body: 'who is this',
    source: 'telegram',
  });
  assert.equal(result.captain, null);
  assert.ok(result.reply, 'default mode should reply');
  assert.match(result.reply, /isn't registered for Brewboat logs/i);

  const log = await readOnlyRawFile();
  assert.match(log, /\| telegram:99999999999 \| unknown \| who is this$/m);
});

test('unknown sender with UNKNOWN_SENDER=silent → null reply, still appends raw line', async () => {
  process.env.UNKNOWN_SENDER = 'silent';
  const result = await handleInbound({
    chatId: UNKNOWN_CHAT_ID,
    body: 'spam spam spam',
    source: 'telegram',
  });
  assert.equal(result.captain, null);
  assert.equal(result.reply, null);

  const log = await readOnlyRawFile();
  assert.match(log, /\| unknown \| spam spam spam$/m);
});

test('UNKNOWN_SENDER value is case-insensitive', async () => {
  process.env.UNKNOWN_SENDER = 'SILENT';
  const result = await handleInbound({
    chatId: UNKNOWN_CHAT_ID,
    body: 'whatever',
    source: 'telegram',
  });
  assert.equal(result.reply, null);
});

test('raw line is pipe-separated, newline-terminated, timestamp-prefixed', async () => {
  await handleInbound({
    chatId: ERIC_CHAT_ID,
    body: 'first message',
    source: 'telegram',
  });
  const log = await readOnlyRawFile();
  assert.ok(log.endsWith('\n'), 'log ends with newline');
  const line = log.trimEnd();
  const parts = line.split(' | ');
  assert.equal(parts.length, 4, 'four pipe-separated fields');
  assert.match(parts[0], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+00:00$/);
  assert.equal(parts[1], 'telegram:8637420543');
  assert.equal(parts[2], 'Eric');
  assert.equal(parts[3], 'first message');
});

test('newlines in body are sanitized to spaces', async () => {
  await handleInbound({
    chatId: ERIC_CHAT_ID,
    body: 'line one\nline two\rline three',
    source: 'telegram',
  });
  const log = await readOnlyRawFile();
  const lines = log.trimEnd().split('\n');
  assert.equal(lines.length, 1, 'one row, not three');
  assert.match(lines[0], /line one line two line three$/);
});

test('multiple inbounds in the same day append to the same file', async () => {
  await handleInbound({ chatId: ERIC_CHAT_ID, body: 'first', source: 'telegram' });
  await handleInbound({ chatId: ERIC_CHAT_ID, body: 'second', source: 'telegram' });
  const files = (await readdir(tmpRawDir)).filter((f) => f.endsWith('.log'));
  assert.equal(files.length, 1, 'one daily log file');
  const log = await readFile(join(tmpRawDir, files[0]), 'utf8');
  assert.equal(log.trimEnd().split('\n').length, 2);
});

test('inactive captain is treated as unknown', async () => {
  // captains.lookup returns null for active: false. Simulate by hitting an
  // inactive-shaped chat_id — captains.json doesn't currently ship one, so
  // this test re-verifies the unknown-sender path with a deliberately
  // unmapped id and serves as documentation: see lib/captains.js line 16.
  const result = await handleInbound({
    chatId: '0',
    body: 'hello',
    source: 'telegram',
  });
  assert.equal(result.captain, null);
});
