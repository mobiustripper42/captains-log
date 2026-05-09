import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { repoPath } from './config.js';

const STRUCTURED_DIR = repoPath('structured');

function etDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

export async function append(entry) {
  await mkdir(STRUCTURED_DIR, { recursive: true });
  const date = etDate();
  const file = join(STRUCTURED_DIR, `${date}.json`);
  let entries = [];
  try {
    const raw = await readFile(file, 'utf8');
    entries = JSON.parse(raw);
  } catch {
    // first entry of the day
  }
  entries.push(entry);
  const tmp = join(STRUCTURED_DIR, `.${date}.${randomUUID()}.tmp`);
  await writeFile(tmp, JSON.stringify(entries, null, 2), 'utf8');
  await rename(tmp, file);
}
