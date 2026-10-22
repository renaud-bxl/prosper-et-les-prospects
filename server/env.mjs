// Lit .env et config.json à la racine du projet. Les clés ne sont jamais écrites dans les logs.
import { readFileSync, existsSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const envPath = join(ROOT, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

/** Les réglages de la mission (config.json) ; au premier lancement, copiés depuis config.example.json. */
export function loadConfig() {
  const file = join(ROOT, 'config.json');
  if (!existsSync(file)) copyFileSync(join(ROOT, 'config.example.json'), file);
  return JSON.parse(readFileSync(file, 'utf8'));
}

export const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY ?? '';

