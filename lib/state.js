import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { repoPath } from './config.js';

const STATE_DIR = repoPath('state');

export async function load(chatId) {
  try {
    const raw = await readFile(join(STATE_DIR, `${chatId}.json`), 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function save(chatId, data) {
  await mkdir(STATE_DIR, { recursive: true });
  const file = join(STATE_DIR, `${chatId}.json`);
  const tmp = join(STATE_DIR, `.${chatId}.${randomUUID()}.tmp`);
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await rename(tmp, file);
}

export async function clear(chatId) {
  await save(chatId, { status: 'idle' });
}
