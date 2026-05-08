import { readFile } from 'node:fs/promises';
import { repoPath } from './config.js';

let cache = null;

async function load() {
  if (cache) return cache;
  const raw = await readFile(repoPath('config/captains.json'), 'utf8');
  cache = JSON.parse(raw);
  return cache;
}

export async function lookup(id) {
  const captains = await load();
  const captain = captains[String(id)];
  if (!captain || captain.active === false) return null;
  return { id, ...captain };
}

export function _resetCacheForTests() {
  cache = null;
}
