import { readFile } from 'node:fs/promises';
import { repoPath } from './config.js';

let cache = null;

export async function load() {
  if (cache) return cache;
  const [boatsRaw, routesRaw, crewRaw] = await Promise.all([
    readFile(repoPath('config/boats.json'), 'utf8'),
    readFile(repoPath('config/routes.json'), 'utf8'),
    readFile(repoPath('config/crew.json'), 'utf8'),
  ]);
  cache = {
    boats: JSON.parse(boatsRaw),
    routes: JSON.parse(routesRaw),
    crew: JSON.parse(crewRaw),
  };
  return cache;
}

export async function boatSlugFor(officialName) {
  if (!officialName) return null;
  const { boats } = await load();
  for (const [slug, b] of Object.entries(boats)) {
    if (b.official_name?.toLowerCase() === officialName.toLowerCase()) return slug;
  }
  return null;
}

export async function routeSlugFor(officialName) {
  if (!officialName) return null;
  const { routes } = await load();
  for (const [slug, r] of Object.entries(routes)) {
    if (r.official_name?.toLowerCase() === officialName.toLowerCase()) return slug;
  }
  return null;
}

export function _resetCacheForTests() {
  cache = null;
}
