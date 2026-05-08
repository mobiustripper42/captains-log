import { appendFile, mkdir } from 'node:fs/promises';
import { repoPath } from './config.js';

const RAW_DIR = repoPath('raw');

function isoNow() {
  return new Date().toISOString().replace('Z', '+00:00');
}

function utcDate(iso) {
  return iso.slice(0, 10);
}

function sanitize(s) {
  return String(s ?? '').replace(/[\r\n]+/g, ' ').trim();
}

export async function append({ sender, captain, body }) {
  const ts = isoNow();
  const line =
    [ts, sanitize(sender), sanitize(captain ?? 'unknown'), sanitize(body)].join(' | ') + '\n';
  await mkdir(RAW_DIR, { recursive: true });
  await appendFile(repoPath('raw', `${utcDate(ts)}.log`), line, 'utf8');
  return { ts, line };
}
