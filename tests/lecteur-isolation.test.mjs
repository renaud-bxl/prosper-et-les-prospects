import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { lire, lireDirecte, lireProtegee, findEmails } from '../server/agents/lecteur.mjs';
import { fetchPublic } from '../server/agents/public-web.mjs';
const publicDns = async () => [{ address: '93.184.216.34', family: 4 }];
const html = (text) => new Response(text, { headers: { 'content-type': 'text/html' } });
const forever = () => new Promise(() => {});

test('un DNS qui ne revient jamais respecte le délai et ne déclenche aucun HTTP', { timeout: 2000 }, async () => {
  const controller = new AbortController(); let requests = 0;
  const timer = setTimeout(() => controller.abort(new Error('DNS deadline fixture')), 30);
  try { await assert.rejects(fetchPublic('https://commerce.be/', { resolver: forever, signal: controller.signal,
    fetchImpl: async () => { requests++; return html('must not read'); } }), /DNS deadline fixture/); }
  finally { clearTimeout(timer); }
  assert.equal(requests, 0);
});

test('un fetch qui ignore AbortSignal ne retient pas le lecteur', { timeout: 2000 }, async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('HTTP deadline fixture')), 30);
  try { await assert.rejects(fetchPublic('https://commerce.be/', { resolver: publicDns, signal: controller.signal, fetchImpl: forever }), /HTTP deadline fixture/); }
  finally { clearTimeout(timer); }
});

test('un corps HTTP qui ne finit jamais est annulé et renvoie une erreur de lecture honnête', { timeout: 2000 }, async () => {
  let cancelled = false;
  const keepAlive = setInterval(() => {}, 100);
  try {
    const result = await lireDirecte({ website: 'https://commerce.be/' }, { resolver: publicDns, requestTimeoutMs: 40,
      fetchImpl: async () => new Response(new ReadableStream({ pull() { return forever(); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/html' } }) });
    assert.equal(result.ok, false); assert.equal(result.signals.read_error.code, 'site_request_timeout');
    assert.deepEqual(result.emails, []); assert.equal(cancelled, true);
  } finally { clearInterval(keepAlive); }
});

test('les échecs de liens contact consomment le budget : accueil et trois essais au maximum', async () => {
  const requests = [];
  const result = await lire({ website: 'https://commerce.be/' }, { resolver: publicDns, fetchImpl: async (url) => {
    requests.push(url);
    return url === 'https://commerce.be/' ? html('<p>Commerce public contact@commerce.be</p>' + Array.from({ length: 100 }, (_, i) => `<a href="/contact-${i}">Contact</a>`).join(''))
      : new Response('absent', { status: 404 });
  } });
  assert.equal(requests.length, 4); assert.equal(result.signals.pages_essayees, 4);
  assert.deepEqual(result.signals.pages_lues, ['/']); assert.deepEqual(result.emails, ['contact@commerce.be']);
});

function workerFixture(t, source) {
  const directory = mkdtempSync(join(tmpdir(), 'prosper-reader-worker-'));
  const file = join(directory, 'fixture.mjs'); writeFileSync(file, source);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return pathToFileURL(file);
}

test('le worker CPU bloqué est terminé sans bloquer les autres requêtes du parent', { timeout: 3000 }, async (t) => {
  const workerUrl = workerFixture(t, "import {parentPort} from 'node:worker_threads';parentPort.postMessage({type:'step',texte:'fixture CPU'});while(true){}");
  let heartbeat = false;
  const timer = setTimeout(() => { heartbeat = true; }, 20);
  const started = Date.now();
  const result = await lireProtegee({ website: 'https://example.invalid/' }, { workerUrl, siteTimeoutMs: 100 });
  clearTimeout(timer);
  assert.equal(heartbeat, true); assert.equal(result.ok, false); assert.equal(result.signals.read_error.code, 'site_timeout');
  assert.ok(Date.now() - started < 2000); assert.deepEqual(result.emails, []);
});

test('un crash de worker est contenu et ne produit aucun contact inventé', { timeout: 2000 }, async (t) => {
  const workerUrl = workerFixture(t, "throw new Error('crash fixture');");
  const result = await lireProtegee({ website: 'https://example.invalid/' }, { workerUrl });
  assert.equal(result.ok, false); assert.equal(result.signals.read_error.code, 'site_read_failed'); assert.deepEqual(result.emails, []);
});

test('le relais de progression conserve le résultat exact du worker', { timeout: 2000 }, async (t) => {
  const expected = { ok: true, signals: { site: true }, emails: ['public@example.invalid'], excerpt: 'Preuve fixture' };
  const workerUrl = workerFixture(t, `import{parentPort}from'node:worker_threads';parentPort.postMessage({type:'step',texte:'lecture fixture'});parentPort.postMessage({type:'result',result:${JSON.stringify(expected)}});`);
  const steps = [];
  assert.deepEqual(await lireProtegee({}, { workerUrl, onStep: (value) => steps.push(value) }), expected);
  assert.deepEqual(steps, ['lecture fixture']);
});

test('la vraie entrée worker conserve la protection des adresses locales avant tout réseau', { timeout: 2000 }, async () => {
  const result = await lire({ website: 'http://127.0.0.1/' });
  assert.equal(result.ok, false); assert.equal(result.excerpt, ''); assert.deepEqual(result.emails, []);
});

test('la normalisation bornée conserve les adresses publiques obfusquées', () => {
  assert.deepEqual(findEmails('<p>contact [at] commerce [dot] be</p>', 'commerce.be'), ['contact@commerce.be']);
  assert.deepEqual(findEmails('<p>info arobase commerce (dot) be</p>', 'commerce.be'), ['info@commerce.be']);
});
