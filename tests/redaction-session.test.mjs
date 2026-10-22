import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDraftSessions, normaliserDemandeBrouillons, lectureEnregistree, candidatBrouillon } from '../server/redaction-session.mjs';
import { rediger as redigerAvecCli } from '../server/agents/redacteur.mjs';

const draft = { constat: 'Observation enregistrée.', objet: 'Un échange utile', mail: 'Notre offre de test. Un bref échange ?\nSignature de test' };
const offer = { ce_que_je_vends: 'notre offre de test', pour_qui: 'Commerces de test', signature: 'Signature de test', site: 'https://example.invalid' };
const request = { offre: offer, consignes: 'Une question simple.', redaction: { moteur: 'claude', modele: '', langue: 'auto' } };
const tick = () => new Promise((resolve) => setImmediate(resolve));
const place = (id, overrides = {}) => ({ id, name: `Commerce de test ${id}`, status: 'analyse', score: 75,
  to_email: `contact-${id}@example.invalid`, emails: [`contact-${id}@example.invalid`], email_source: '/contact',
  signals: { site: true, langue: 'nl', langue_source: 'html', telephones: ['+32000000000'], raisons: [{ pts: 25, texte: 'Réservation non repérée' }] },
  excerpt: 'Site déjà analysé', ...overrides });

function fixture(rows, options = {}) {
  const places = new Map(rows.map((row) => [row.id, structuredClone(row)]));
  let config = { offre: { ce_que_je_vends: '', pour_qui: '', signature: '', site: '' }, consignes: '',
    redaction: { moteur: 'aucun', modele: '', langue: 'auto' }, equipe: { score_minimum: 60, redacteurs_en_parallele: 99 },
    recherche: { ville: 'Ville de test', nombre: 60 } };
  const events = [], calls = [], saved = [];
  const service = createDraftSessions({
    getRun: (id) => id === 'run-test' ? { id, status: options.runStatus ?? 'fini' } : null,
    listPlaces: () => [...places.values()].map((row) => structuredClone(row)),
    getPlace: (_run, id) => places.has(id) ? structuredClone(places.get(id)) : null,
    updatePlace: (_run, id, fields) => { options.beforeUpdate?.(id, fields); Object.assign(places.get(id), structuredClone(fields)); },
    rediger: async (...args) => { calls.push(args); return options.rediger ? options.rediger(...args) : { ...draft, duree_ms: 1 }; },
    emit: (...args) => events.push(args),
    loadConfig: () => structuredClone(config),
    saveConfig: (value) => { config = structuredClone(value); saved.push(structuredClone(value)); },
    isMissionRunning: () => Boolean(options.missionActive), isUpdating: () => Boolean(options.updateActive),
  });
  return { service, places, events, calls, saved };
}

test('une offre, une signature et un moteur explicites sont nécessaires ; aucune valeur n’est inventée', () => {
  const config = { offre: {}, redaction: { moteur: 'aucun' } };
  assert.throws(() => normaliserDemandeBrouillons({}, config), { code: 'offer_required' });
  assert.throws(() => normaliserDemandeBrouillons({ offre: { ce_que_je_vends: 'offre' } }, config), { code: 'signature_required' });
  assert.throws(() => normaliserDemandeBrouillons({ offre: offer }, config), { code: 'engine_required' });
  assert.throws(() => normaliserDemandeBrouillons({ ...request, offre: { ...offer, signature: 'Ton prénom et ton nom' } }, config), { code: 'signature_required' });
  assert.throws(() => normaliserDemandeBrouillons({ ...request, offre: { ...offer, site: 'javascript:alert(1)' } }, config), { code: 'invalid_site' });
  assert.throws(() => normaliserDemandeBrouillons({ ...request, consignes: 'x'.repeat(801) }, config), { code: 'invalid_fields' });
  assert.throws(() => normaliserDemandeBrouillons({ ...request, redaction: { moteur: 'codex', modele: 'bad\nmodel' } }, config), { code: 'invalid_model' });
  assert.throws(() => normaliserDemandeBrouillons({ ...request, redaction: { moteur: 'codex', langue: 'de' } }, config), { code: 'invalid_redaction' });
  assert.throws(() => normaliserDemandeBrouillons({ ...request, regenerate: true }, config), { code: 'regeneration_disabled' });
  assert.deepEqual(normaliserDemandeBrouillons({ ...request, regenerate: false }, config), request);
});

test('la lecture est reconstruite depuis les preuves et le score enregistrés, sans relecture ni renotation', () => {
  const original = place('proof');
  const rebuilt = lectureEnregistree(original);
  assert.deepEqual(rebuilt.note, { score: 75, raisons: original.signals.raisons });
  assert.equal(rebuilt.lecture.excerpt, original.excerpt);
  assert.equal(rebuilt.lecture.email_source, '/contact');
  assert.equal(rebuilt.lecture.signals.langue, 'nl');
  assert.deepEqual(rebuilt.lecture.telephones, ['+32000000000']);
  rebuilt.lecture.signals.langue = 'en';
  assert.equal(original.signals.langue, 'nl');
  assert.equal(candidatBrouillon(place('bad', { to_email: 'invalid', emails: [] })), false);
});

test('seuls les clients potentiels sans mail sont rédigés ; décisions et brouillons existants sont conservés', async () => {
  const eligible = ['analyse', 'retenu', 'a_ecrire', 'erreur'].map((status, i) => place(`eligible-${i}`, { status }));
  const protectedRows = [
    place('approved', { status: 'valide', mail: 'Mail approuvé' }), place('refused', { status: 'refuse', mail: 'Mail refusé' }),
    place('pending', { status: 'en_attente', mail: 'Brouillon existant' }), place('existing-error', { status: 'erreur', mail: 'Brouillon conservé' }),
    place('existing-analysis', { mail: 'Brouillon conservé' }), place('excluded', { status: 'ecarte' }),
    place('low', { score: 59 }), place('no-email', { to_email: null, emails: [] }), place('writing', { status: 'ecriture' }),
  ];
  const f = fixture([...eligible, ...protectedRows]);
  const started = f.service.start('run-test', request);
  assert.equal(started.status, 'running'); assert.equal(started.total, 4);
  const result = await f.service.waitForJob('run-test');
  assert.equal(result.status, 'completed'); assert.equal(result.completed, 4); assert.equal(result.failed, 0);
  assert.equal(f.calls.length, 4); assert.equal(f.service.isRunning(), false);
  for (const row of eligible) assert.equal(f.places.get(row.id).status, 'en_attente');
  for (const row of protectedRows) assert.deepEqual(f.places.get(row.id), row);
  assert.equal(f.saved[0].recherche.nombre, 60);
  assert.deepEqual(f.saved[0].offre, offer);
  assert.deepEqual(f.saved[0].redaction, request.redaction);
  assert.ok(f.events.some((event) => event[1] === 'chef' && event[2] === 'drafts:start'));
  assert.ok(f.events.some((event) => event[1] === 'chef' && event[2] === 'drafts:end'));
  assert.ok(f.events.filter((event) => event[2] === 'done').every((event) => /^redacteur-[12]$/.test(event[1])));
});

test('deux rédacteurs au maximum et un verrou gardé jusqu’à la fin effective du lot', async () => {
  let active = 0, maximum = 0;
  const gates = [];
  const f = fixture(Array.from({ length: 7 }, (_, i) => place(String(i))), { rediger: async () => {
    active++; maximum = Math.max(maximum, active);
    await new Promise((resolve) => gates.push(resolve));
    active--; return draft;
  } });
  f.service.start('run-test', request);
  assert.equal(f.service.isRunning(), true);
  await tick(); assert.equal(active, 2);
  assert.throws(() => f.service.start('run-test', request), { code: 'mission_active' });
  while (f.service.isRunning()) { for (const release of gates.splice(0)) release(); await tick(); }
  const completed = await f.service.waitForJob('run-test');
  assert.equal(maximum, 2); assert.equal(completed.completed, 7); assert.equal(completed.errors.length, 0);
});

test('une erreur de moteur ne remplace pas les autres brouillons et laisse le client en erreur réessayable', async () => {
  const f = fixture([place('bad'), place('good')], { rediger: async (row) => {
    if (row.id === 'bad') throw new Error('Erreur du CLI de test');
    return draft;
  } });
  f.service.start('run-test', request);
  const result = await f.service.waitForJob('run-test');
  assert.equal(result.status, 'completed'); assert.equal(result.completed, 2); assert.equal(result.failed, 1);
  assert.equal(result.errors[0].placeId, 'bad');
  assert.equal(f.places.get('bad').status, 'erreur'); assert.equal(f.places.get('bad').mail, undefined);
  assert.equal(f.places.get('good').status, 'en_attente');
  result.errors[0].message = 'changed outside';
  assert.equal(f.service.getJob('run-test').errors[0].message, 'Erreur du CLI de test');
});

test('une décision ou un brouillon arrivé pendant la rédaction n’est jamais écrasé', async () => {
  const f = fixture([place('edited')], { rediger: async () => {
    Object.assign(f.places.get('edited'), { status: 'valide', mail: 'Mail choisi par la personne', objet: 'Son objet' });
    return draft;
  } });
  f.service.start('run-test', request);
  const result = await f.service.waitForJob('run-test');
  assert.equal(result.skipped, 1); assert.equal(result.completed, 1);
  assert.equal(f.places.get('edited').status, 'valide');
  assert.equal(f.places.get('edited').mail, 'Mail choisi par la personne');
});

test('mission active, mise à jour, mission absente ou aucun candidat : aucun appel ni sauvegarde', () => {
  for (const [options, code] of [[{ missionActive: true }, 'mission_active'], [{ updateActive: true }, 'update_active'], [{ runStatus: 'en_cours' }, 'mission_active']]) {
    const f = fixture([place('x')], options);
    assert.throws(() => f.service.start('run-test', request), { code });
    assert.equal(f.calls.length, 0); assert.equal(f.saved.length, 0);
  }
  const f = fixture([place('existing', { status: 'en_attente', mail: 'Conservé' })]);
  assert.throws(() => f.service.start('missing', request), { code: 'run_not_found' });
  assert.throws(() => f.service.start('run-test', request), { code: 'no_candidates' });
  assert.equal(f.saved.length, 0); assert.equal(f.service.getJob('run-test'), null);
});

test('une panne de persistance ne libère pas le verrou pendant qu’un autre rédacteur travaille encore', async () => {
  let release;
  const f = fixture([place('broken-store'), place('slow')], {
    beforeUpdate: (id) => { if (id === 'broken-store') throw new Error('Stockage indisponible'); },
    rediger: async () => { await new Promise((resolve) => { release = resolve; }); return draft; },
  });
  f.service.start('run-test', request);
  await tick(); assert.equal(f.service.isRunning(), true);
  release();
  const job = await f.service.waitForJob('run-test');
  assert.equal(job.status, 'failed'); assert.equal(f.service.isRunning(), false);
  assert.ok(job.errors.some((error) => error.message === 'Stockage indisponible'));
});

test('bout en bout avec un vrai processus CLI de test : lecture enregistrée, offre fournie et JSON de brouillon', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'prosper-draft-batch-cli-'));
  const binary = join(temporary, 'fake-claude');
  const previous = process.env.CLAUDE_BIN;
  writeFileSync(binary, `#!${process.execPath}\nlet input='';process.stdin.on('data',d=>input+=d);process.stdin.on('end',()=>{if(!input.includes('notre offre de test')||!input.includes('Site déjà analysé'))process.exit(8);console.log(JSON.stringify({structured_output:${JSON.stringify(draft)}}));});\n`, { mode: 0o700 });
  process.env.CLAUDE_BIN = binary;
  try {
    const f = fixture([place('cli')], { rediger: redigerAvecCli });
    f.service.start('run-test', request);
    const job = await f.service.waitForJob('run-test');
    assert.equal(job.failed, 0); assert.equal(job.completed, 1);
    assert.equal(f.places.get('cli').mail, draft.mail);
    assert.equal(f.places.get('cli').status, 'en_attente');
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_BIN; else process.env.CLAUDE_BIN = previous;
    rmSync(temporary, { recursive: true, force: true });
  }
});
