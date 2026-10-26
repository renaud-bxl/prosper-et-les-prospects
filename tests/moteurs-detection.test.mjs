import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detecterMoteur, capacitesMoteurs, commandeRedaction } from '../server/agents/moteurs.mjs';

const requiredFlags = '--ephemeral --ignore-user-config --skip-git-repo-check --sandbox --json --output-schema';
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'prosper-detection-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const options = { env: { PATH: '' }, home: join(dir, 'home'), platform: 'darwin', bundles: [] };
  const cli = (name, mode = 'connecte') => {
    const binary = join(dir, name);
    const trace = `${binary}.trace`;
    writeFileSync(binary, `#!${process.execPath}\nimport('node:fs').then(({appendFileSync})=>{\nconst args=process.argv.slice(2); appendFileSync(${JSON.stringify(trace)},JSON.stringify(args)+'\\n');\nif(process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY || process.env.ANTHROPIC_API_KEY) process.exit(8);\nif(args.join(' ')==='exec --help'){console.log(${JSON.stringify(mode === 'options' ? '--json' : requiredFlags)});process.exit(0);}\nif(args.join(' ')==='login status'){\n${mode === 'timeout' ? 'return setTimeout(()=>{},60000);' : mode === 'config' ? `console.error('Error loading configuration: unknown variant max PRIVATE_CONFIG_VALUE');process.exit(1);` : mode === 'absent' ? `console.error('Not logged in');process.exit(1);` : `console.log('Logged in using ChatGPT');process.exit(0);`}\n}\nprocess.exit(9);\n});`, { mode: 0o700 });
    return { binary, trace };
  };
  return { dir, options, cli };
}

test('PATH absolu et surcharge explicite gardent la priorité sans exécuter de sonde', (t) => {
  const { dir, options, cli } = fixture(t);
  const pathCli = cli('codex');
  const bundle = cli('bundle');
  const result = detecterMoteur('codex', { ...options, env: { PATH: dir }, bundles: [bundle.binary] });
  assert.equal(result.binary, pathCli.binary);
  assert.equal(result.source, 'path');
  assert.equal(existsSync(pathCli.trace), false);
  assert.equal(existsSync(bundle.trace), false);
  const missing = join(dir, 'explicit missing');
  assert.deepEqual(detecterMoteur('codex', { ...options, env: { PATH: dir, CODEX_BIN: missing }, bundles: [bundle.binary] }), {
    binary: missing, installe: false, source: 'explicite',
  });
  assert.equal(existsSync(bundle.trace), false, 'une surcharge invalide reste visible');
});

test('un dossier, un fichier non exécutable et un PATH relatif ne prouvent pas une installation', (t) => {
  const { dir, options } = fixture(t);
  mkdirSync(join(dir, 'codex'));
  writeFileSync(join(dir, 'claude'), 'not executable', { mode: 0o600 });
  assert.deepEqual(capacitesMoteurs({ ...options, env: { PATH: dir } }), {
    claude: { installe: false }, codex: { installe: false },
  });
  assert.equal(detecterMoteur('codex', { ...options, env: { PATH: '.:relative' } }).installe, false);
});

test('bundle compatible dans un chemin avec espaces : aide puis état local, aucune rédaction', (t) => {
  const { dir, options, cli } = fixture(t);
  const bundle = cli('ChatGPT codex ; no-shell');
  const detected = detecterMoteur('codex', { ...options, env: { PATH: '', OPENAI_API_KEY: 'test-no-secret', CODEX_API_KEY: 'test-no-secret', ANTHROPIC_API_KEY: 'test-no-secret' }, bundles: [bundle.binary] });
  assert.equal(detected.binary, bundle.binary);
  assert.equal(detected.authentification, 'connecte');
  const calls = readFileSync(bundle.trace, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(calls, [['exec', '--help'], ['login', 'status']]);
  assert.equal(existsSync(join(dir, 'no-shell')), false);
  const command = commandeRedaction('instructions', { moteur: 'codex' }, '/tmp/schema.json', { ...options, bundles: [bundle.binary] });
  assert.equal(command.binary, bundle.binary);
  assert.ok(command.args.includes('--ignore-user-config'));
});

test('bundle ancien refusé sans exposer sa configuration puis candidat compatible retenu', (t) => {
  const { options, cli } = fixture(t);
  const old = cli('old-codex', 'config');
  const current = cli('current-codex');
  const detected = detecterMoteur('codex', { ...options, bundles: [old.binary, current.binary] });
  assert.equal(detected.binary, current.binary);
  assert.equal(detected.authentification, 'connecte');
  const rejected = detecterMoteur('codex', { ...options, bundles: [old.binary] });
  assert.equal(rejected.installe, false);
  assert.equal(rejected.refuses[0].raison, 'configuration_incompatible');
  assert.ok(!JSON.stringify(rejected).includes('PRIVATE_CONFIG_VALUE'));
  assert.throws(() => commandeRedaction('', { moteur: 'codex' }, '/tmp/schema.json', { ...options, bundles: [old.binary] }),
    (error) => error.code === 'engine_start_failed' && /configuration locale/.test(error.message) && !error.message.includes('PRIVATE_CONFIG_VALUE'));
});

test('options insuffisantes et sonde bloquée sont bornées et passent au candidat suivant', (t) => {
  const { options, cli } = fixture(t);
  const bad = cli('wrong-options', 'options');
  const hung = cli('hung', 'timeout');
  const good = cli('good');
  const start = Date.now();
  const detected = detecterMoteur('codex', { ...options, bundles: [bad.binary, hung.binary, good.binary], probeTimeoutMs: 1000 });
  assert.equal(detected.binary, good.binary);
  assert.ok(Date.now() - start < 8000, 'une sonde ne doit pas bloquer le serveur indéfiniment');
  assert.deepEqual(readFileSync(bad.trace, 'utf8').trim().split('\n').map(JSON.parse), [['exec', '--help']]);
});

test('un CLI déconnecté reste installé et ne déclenche aucun flux de connexion', (t) => {
  const { options, cli } = fixture(t);
  const bundle = cli('signed-out', 'absent');
  const detected = detecterMoteur('codex', { ...options, bundles: [bundle.binary] });
  assert.equal(detected.installe, true);
  assert.equal(detected.authentification, 'absente');
  assert.deepEqual(readFileSync(bundle.trace, 'utf8').trim().split('\n').map(JSON.parse), [['exec', '--help'], ['login', 'status']]);
});
