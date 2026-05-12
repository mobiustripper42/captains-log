import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { repoPath } from './config.js';

function defaultPath() {
  return process.env.CAPTAINSLOG_DB_PATH || repoPath('data', 'captains-log.db');
}

export function openDb(path = defaultPath()) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  return db;
}

export function tx(db, fn) {
  return db.transaction(fn)();
}
