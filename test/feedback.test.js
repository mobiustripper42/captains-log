// Skip live Haiku + gh CLI calls — tests exercise the fake-draft / fake-URL paths.
process.env.CAPTAINSLOG_NO_HAIKU = '1';
process.env.CAPTAINSLOG_NO_GH_FILE = '1';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPending,
  findLatestPending,
  findById,
  markFiled,
  markCancelled,
  draftFeedback,
  fileViaGh,
} from '../lib/feedback.js';
import { openDb } from '../lib/db.js';
import { migrate } from '../lib/migrate.js';

function freshDb() {
  const db = openDb(':memory:');
  migrate(db);
  return db;
}

// --- DB CRUD ---

test('createPending inserts a pending row with the drafted body joined', () => {
  const db = freshDb();
  const { id } = createPending(db, {
    chatId: '42',
    body: 'fenders are cracking',
    draftedTitle: 'Replace cracked fenders',
    draftedBody: 'Bow fenders showing splits along the seam.',
  });
  const row = findById(db, id);
  assert.equal(row.submitted_by_chat_id, '42');
  assert.equal(row.body, 'fenders are cracking');
  assert.equal(row.status, 'pending');
  assert.equal(row.github_issue_url, null);
  assert.ok(row.drafted_issue_body.startsWith('Replace cracked fenders\n\n'));
});

test('createPending requires chatId and body', () => {
  const db = freshDb();
  assert.throws(() => createPending(db, { chatId: '', body: 'x' }), /required/);
  assert.throws(() => createPending(db, { chatId: '1', body: '' }), /required/);
});

test('findLatestPending returns the most recent pending row, ignoring filed/cancelled', () => {
  const db = freshDb();
  const { id: id1 } = createPending(db, { chatId: '1', body: 'first', draftedTitle: 'T1', draftedBody: 'B1' });
  const { id: id2 } = createPending(db, { chatId: '1', body: 'second', draftedTitle: 'T2', draftedBody: 'B2' });
  const { id: id3 } = createPending(db, { chatId: '1', body: 'third', draftedTitle: 'T3', draftedBody: 'B3' });

  // Latest is id3
  assert.equal(findLatestPending(db, '1').id, id3);

  // After filing id3, latest pending should be id2
  markFiled(db, id3, 'https://example.com/3');
  assert.equal(findLatestPending(db, '1').id, id2);

  // After cancelling id2, latest pending should be id1
  markCancelled(db, id2);
  assert.equal(findLatestPending(db, '1').id, id1);

  // After cancelling id1, none pending
  markCancelled(db, id1);
  assert.equal(findLatestPending(db, '1'), null);
});

test('findLatestPending scopes by chat_id', () => {
  const db = freshDb();
  createPending(db, { chatId: '1', body: 'mine', draftedTitle: 'T', draftedBody: 'B' });
  assert.equal(findLatestPending(db, '2'), null);
});

test('markFiled sets status and URL atomically', () => {
  const db = freshDb();
  const { id } = createPending(db, { chatId: '1', body: 'x', draftedTitle: 'T', draftedBody: 'B' });
  markFiled(db, id, 'https://github.com/foo/bar/issues/9');
  const row = findById(db, id);
  assert.equal(row.status, 'filed');
  assert.equal(row.github_issue_url, 'https://github.com/foo/bar/issues/9');
});

test('markCancelled flips status without setting URL', () => {
  const db = freshDb();
  const { id } = createPending(db, { chatId: '1', body: 'x', draftedTitle: 'T', draftedBody: 'B' });
  markCancelled(db, id);
  const row = findById(db, id);
  assert.equal(row.status, 'cancelled');
  assert.equal(row.github_issue_url, null);
});

// --- draftFeedback (NO_HAIKU fake) ---

test('draftFeedback returns a deterministic fake under CAPTAINSLOG_NO_HAIKU', async () => {
  const drafted = await draftFeedback('boat needs new fenders');
  assert.ok(drafted.title);
  assert.ok(drafted.body);
  assert.ok(drafted.title.includes('boat needs new fenders'));
});

// --- fileViaGh (NO_GH_FILE fake) ---

test('fileViaGh returns a fake URL under CAPTAINSLOG_NO_GH_FILE', async () => {
  const { url } = await fileViaGh({ title: 'T', body: 'B' });
  assert.ok(url.startsWith('https://github.com/'));
});
