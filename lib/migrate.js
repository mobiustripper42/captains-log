import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { repoPath } from './config.js';

const MIGRATIONS_DIR = repoPath('lib', 'migrations');

export function migrate(db, dir = MIGRATIONS_DIR) {
  const files = readdirSync(dir)
    .filter((f) => /^\d{3}_.*\.sql$/.test(f))
    .sort();

  const current = db.pragma('user_version', { simple: true });

  for (const file of files) {
    const version = Number(file.slice(0, 3));
    if (version <= current) continue;
    const sql = readFileSync(join(dir, file), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.pragma(`user_version = ${version}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`migration ${file} failed: ${err.message}`);
    }
  }

  return db.pragma('user_version', { simple: true });
}
