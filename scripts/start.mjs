// Lance Prosper et les prospects et ouvre son interface locale.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, statSync, readdirSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [maj, min] = process.versions.node.split('.').map(Number);
if (maj < 22 || (maj === 22 && min < 13)) {
  console.error(`Il faut Node.js 22.13 ou plus récent (tu as ${process.versions.node}). Installe la version LTS depuis https://nodejs.org`);
  process.exit(1);
}
// l'interface est reconstruite quand un fichier de web/ est plus récent que la dernière construction
const newest = (dir) => readdirSync(dir, { withFileTypes: true }).reduce((m, e) => Math.max(m, e.isDirectory() ? newest(join(dir, e.name)) : statSync(join(dir, e.name)).mtimeMs), 0);
const dist = join(ROOT, 'web', 'dist', 'index.html');
if (!existsSync(dist) || statSync(dist).mtimeMs < Math.max(newest(join(ROOT, 'web', 'src')), newest(join(ROOT, 'web', 'public')), statSync(join(ROOT, 'web', 'index.html')).mtimeMs)) {
  console.log('Construction de l’interface…');
  const b = spawnSync(process.execPath, [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', 'web', '--logLevel', 'warn'], { cwd: ROOT, stdio: 'inherit' });
  if (b.status !== 0) process.exit(b.status ?? 1);
}
spawn(process.execPath, [join(ROOT, 'server', 'index.mjs'), '--open'], { cwd: ROOT, stdio: 'inherit' }).on('exit', (c) => process.exit(c ?? 0));

