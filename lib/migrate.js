import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { repoPath } from './config.js';

const MIGRATIONS_DIR = repoPath('lib', 'migrations');

export function migrate(db, dir = MIGRATIONS_DIR) {
  const files = readdirSync(dir)
    .filter((f) => /^\d{3}_.*\.sql$/.test(f))
    .sort();

  const current = db.pragma('user_version', { simple: true });

  // FK enforcement must be off to allow table-rebuild migrations (DROP/RENAME
  // would otherwise cascade). foreign_key_check before COMMIT verifies invariants.
  db.pragma('foreign_keys = OFF');
  try {
    for (const file of files) {
      const version = Number(file.slice(0, 3));
      if (version <= current) continue;
      const sql = readFileSync(join(dir, file), 'utf8');
      db.exec('BEGIN');
      try {
        db.exec(sql);
        const violations = db.pragma('foreign_key_check');
        if (violations.length) {
          throw new Error(`foreign_key_check: ${JSON.stringify(violations)}`);
        }
        db.pragma(`user_version = ${version}`);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw new Error(`migration ${file} failed: ${err.message}`);
      }
    }
  } finally {
    db.pragma('foreign_keys = ON');
  }

  return db.pragma('user_version', { simple: true });
}
