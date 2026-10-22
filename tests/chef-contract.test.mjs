import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, copyFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

test('vrai chef sur copie jetable : verrou update, visite conservée et bilan de reprise avec quotas', { timeout: 5000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'prosper-chef-contract-'));
  const previousFetch = globalThis.fetch, previousBinary = process.env.CLAUDE_BIN;
  let memory;
  t.after(() => { try { memory?.db.close(); } catch {} globalThis.fetch = previousFetch; if (previousBinary === undefined) delete process.env.CLAUDE_BIN; else process.env.CLAUDE_BIN = previousBinary; rmSync(root, { recursive: true, force: true }); });
  // Uniquement le code public et la géographie ; aucune copie de config/data/.env utilisateur.
  cpSync(resolve(import.meta.dirname, '../server'), join(root, 'server'), { recursive: true });
  mkdirSync(join(root, 'web/public/carte'), { recursive: true });
  copyFileSync(resolve(import.meta.dirname, '../web/public/carte/pays.json'), join(root, 'web/public/carte/pays.json'));
  globalThis.fetch = async () => { throw new Error('Aucun réseau autorisé dans ce test.'); };
  const binary = join(root, 'fake-claude');
  const draft = { constat: 'Observation test', objet: 'Objet test', mail: 'Offre test et échange. Signature test.' };
  writeFileSync(binary, `#!${process.execPath}\nprocess.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({structured_output:${JSON.stringify(draft)}})));\n`, { mode: 0o700 });
  process.env.CLAUDE_BIN = binary;
  const config = { recherche: { nombre: 60, centre: { lat: 50.85, lon: 4.35 }, ville: 'Ville de test', metier: 'Restaurant' },
    equipe: { score_minimum: 60 }, offre: { ce_que_je_vends: 'Offre test', signature: 'Signature test', site: '', pour_qui: '' },
    redaction: { moteur: 'claude', langue: 'auto', modele: '' }, consignes: '' };
  writeFileSync(join(root, 'config.json'), JSON.stringify(config));
  memory = await import(pathToFileURL(join(root, 'server/db.mjs')).href);
  const chef = await import(pathToFileURL(join(root, 'server/chef.mjs')).href);
  const addRun = (id) => memory.db.prepare('INSERT INTO runs(id,status) VALUES (?,?)').run(id, 'partiel');
  const event = (id, type, data) => memory.insertEvent({ run_id: id, t: Date.now(), agent: 'chef', type, data });
  const addPlace = (run, id, saved = false) => {
    memory.upsertPlace(run, { id, name: `Test ${id}`, address: '', lat: 50.85, lon: 4.35, status: saved ? 'valide' : 'analyse' });
    memory.updatePlace(run, id, { score: 75, signals: { site: true }, to_email: `${id}@example.invalid`, emails: [`${id}@example.invalid`], ...(saved ? { mail: `Mail conservé ${id}`, objet: 'Objet conservé' } : {}) });
  };
  writeFileSync(join(root, 'data/.update-state.json'), JSON.stringify({ id: 'test-only', phase: 'queued', updatedAt: new Date().toISOString() }));
  await assert.rejects(chef.lancer(config), { code: 'update_active' });
  assert.equal(memory.db.prepare('SELECT COUNT(*) AS count FROM runs').get().count, 0);
  rmSync(join(root, 'data/.update-state.json'));

  addRun('run'); event('run', 'start', { objectif_contacts: 8, objectif_mails: 8, score_minimum: 60, limite_scan: 250, rayon_max_m: 20000 });
  event('run', 'end', { ecrits: 3, retenus: 6, reason: 'radius_exhausted', status: 'partiel', exhausted: true });
  for (let i = 0; i < 6; i++) addPlace('run', String(i), i < 3);
  const before = memory.getPlace('run', '0');
  const kept = await chef.visiter('run', { name: before.name, lat: before.lat, lon: before.lon }, config);
  assert.equal(kept.conserve, true); assert.deepEqual(memory.getPlace('run', '0'), before);
  const job = chef.lancerBrouillons('run', { offre: config.offre, redaction: config.redaction });
  assert.equal(job.total, 3); assert.equal(chef.isRunning(), true);
  const until = Date.now() + 3000;
  while (chef.statutBrouillons('run').status === 'running' && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(chef.statutBrouillons('run').status, 'completed'); assert.equal(chef.isRunning(), false);
  const summary = chef.resumeMission('run');
  assert.equal(summary.ecrits, 6); assert.equal(summary.a_reprendre, 2); assert.equal(summary.objectif_atteint, false);
  assert.equal(summary.status, 'partiel'); assert.equal(memory.getRun('run').status, 'partiel');
  assert.deepEqual(memory.getPlace('run', '0'), before);

  addRun('legacy'); event('legacy', 'start', { nombre: 60 }); event('legacy', 'end', { ecrits: 10 });
  assert.equal(chef.resumeMission('legacy').objectif_contacts, null); assert.equal(chef.resumeMission('legacy').objectif_mails, null);
});
