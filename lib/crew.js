import { load as loadRosters } from './rosters.js';

function normalize(s) {
  return String(s ?? '').trim().toLowerCase();
}

async function findCanonical(rawName) {
  const n = normalize(rawName);
  if (!n) return null;
  const { crew } = await loadRosters();
  for (const [key, entry] of Object.entries(crew)) {
    if (normalize(entry.name) === n) return { key, entry };
    if (normalize(key) === n) return { key, entry };
    for (const alias of entry.aliases ?? []) {
      if (normalize(alias) === n) return { key, entry };
    }
  }
  return null;
}

export async function resolve(db, rawName) {
  const canonical = await findCanonical(rawName);
  if (!canonical) return null;

  const { entry } = canonical;
  const existing = db
    .prepare('SELECT id FROM crew WHERE LOWER(name) = LOWER(?)')
    .get(entry.name);
  if (existing) return existing.id;

  const { lastInsertRowid } = db
    .prepare('INSERT INTO crew (name, full_name) VALUES (?, ?)')
    .run(entry.name, entry.full_name ?? null);
  return Number(lastInsertRowid);
}
