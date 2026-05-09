import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { repoPath } from './config.js';

const DEFAULT_STATE_DIR = repoPath('state');

export async function load(chatId, dir = DEFAULT_STATE_DIR) {
  try {
    const raw = await readFile(join(dir, `${chatId}.json`), 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function save(chatId, data, dir = DEFAULT_STATE_DIR) {
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${chatId}.json`);
  const tmp = join(dir, `.${chatId}.${randomUUID()}.tmp`);
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await rename(tmp, file);
}

export async function clear(chatId, dir = DEFAULT_STATE_DIR) {
  await save(chatId, { status: 'idle' }, dir);
}
