import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const REPO_ROOT = resolve(__dirname, '..');

export function requireEnv(...keys) {
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(
      `[captainslog] missing required env vars: ${missing.join(', ')}. ` +
        'Copy .env.example to .env and fill in.',
    );
  }
}

export function repoPath(...parts) {
  return resolve(REPO_ROOT, ...parts);
}
