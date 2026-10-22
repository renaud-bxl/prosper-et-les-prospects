import test from 'node:test';
import assert from 'node:assert/strict';
import { objectifsMission, runMissionPipeline, verifierDisponibiliteMission } from '../server/mission-pipeline.mjs';
import { RedactionError } from '../server/redaction-recovery.mjs';

const pause = () => new Promise((resolve) => setImmediate(resolve));
const draft = { constat: 'Observation du site de test.', objet: 'Un échange', mail: 'Offre de test et question personnalisée. Signature de test.' };
const place = (id, extra = {}) => ({ id: String(id), name: `Commerce ${id}`, lat: 50.85, lon: 4.35, ...extra });
const config = (contacts = 8, mails = 0, moteur = 'claude') => ({ recherche: { nombre: contacts, objectif_mails: mails, rayon_m: 2200 },
  equipe: { score_minimum: 60, lecteurs_en_parallele: 3 }, redaction: { moteur }, offre: {} });

async function fixture(pool, options = {}) {
  const rows = new Map(), events = [], written = [];
  let active = 0, maximum = 0;
  const outcome = await runMissionPipeline(options.config ?? config(), {
    discover: async (request, callbacks) => {
      let emitted = 0, stopped = false;
      for (const item of pool) {
        if (!await callbacks.shouldContinue()) { stopped = true; break; }
        if (emitted >= request.limite_scan) break;
        emitted++;
        if (await callbacks.onFound(item) === false) { stopped = true; break; }
      }
      const reason = options.reason ?? (stopped ? 'objective_reached' : emitted >= request.limite_scan ? 'scan_limit' : 'radius_exhausted');
      return Object.assign([], { scanned: emitted, queries: 6, rayon: 20000, reason, exhausted: reason === 'radius_exhausted' });
    },
    found: (row) => rows.set(row.id, { ...row, status: 'trouve' }),
    update: (id, fields) => Object.assign(rows.get(id), structuredClone(fields)), saved: (id) => rows.get(id),
    read: async (row) => { await pause(); return options.read ? options.read(row) : { signals: { site: true }, emails: [`contact-${row.id}@example.invalid`], excerpt: 'Site de test' }; },
    score: (_row, lecture) => ({ score: lecture.emails.length ? 75 : 20, raisons: [] }),
    write: async (...args) => {
      active++; maximum = Math.max(maximum, active); written.push(args[0].id);
      try { await pause(); return options.write ? await options.write(...args) : { ...draft, mail_langue: 'nl', mail_langue_source: 'site' }; }
      finally { active--; }
    },
    emit: (agent, type, id, data) => events.push({ agent, type, id, data }),
  });
  return { outcome, rows, events, written, maximum };
}

test('nombre représente les contacts ; l’objectif de mails reste distinct et analyse seule vaut zéro', () => {
  assert.deepEqual(objectifsMission(config(60)), { objectif_contacts: 60, objectif_mails: 60, limite_scan: 250, rayon_max_m: 20000 });
  assert.equal(objectifsMission(config(60, 12)).objectif_mails, 12);
  assert.equal(objectifsMission(config(8, 60)).objectif_mails, 8);
  assert.equal(objectifsMission(config(8, 0, 'aucun')).objectif_mails, 0);
});

test('60 mails parmi 240 sites : continuer après les rejets et garder deux rédacteurs maximum', { timeout: 5000 }, async () => {
  const f = await fixture(Array.from({ length: 260 }, (_, i) => place(i + 1)), {
    config: config(60), read: (row) => ({ signals: { site: true }, emails: Number(row.id) % 4 === 0 ? [`contact-${row.id}@example.invalid`] : [] }),
  });
  assert.equal(f.outcome.status, 'fini'); assert.equal(f.outcome.reason, 'objective_reached');
  assert.equal(f.outcome.ecrits, 60); assert.ok(f.outcome.retenus >= 60); assert.ok(f.outcome.lus >= 240);
  assert.ok(f.outcome.trouves <= 250); assert.equal(f.written.length, 60); assert.ok(f.maximum <= 2);
  assert.equal(new Set([...f.rows.values()].filter((row) => row.mail).map((row) => row.to_email)).size, 60);
  assert.ok([...f.rows.values()].filter((row) => row.mail).every((row) => row.mail_langue === 'nl' && row.mail_langue_source === 'site'));
});

test('un petit quota de mails ne coupe pas la collecte des contacts', { timeout: 3000 }, async () => {
  const f = await fixture(Array.from({ length: 30 }, (_, i) => place(i)), { config: config(8, 2) });
  assert.equal(f.outcome.status, 'fini'); assert.ok(f.outcome.retenus >= 8); assert.equal(f.outcome.ecrits, 2); assert.equal(f.written.length, 2);
  const readOnly = await fixture(Array.from({ length: 30 }, (_, i) => place(i)), { config: config(8, 0, 'aucun') });
  assert.equal(readOnly.outcome.status, 'fini'); assert.ok(readOnly.outcome.retenus >= 8); assert.equal(readOnly.written.length, 0);
});

test('une adresse partagée compte une fois, une autre adresse publique peut être choisie', { timeout: 3000 }, async () => {
  const f = await fixture([place('a'), place('b'), place('c'), place('d')], { config: config(3), read: (row) => ({ signals: { site: true },
    emails: row.id === 'a' ? ['INFO@Example.invalid'] : row.id === 'b' ? ['info@example.invalid'] : row.id === 'c' ? ['info@example.invalid', 'local@example.invalid'] : ['autre@example.invalid'] }) });
  assert.equal(f.outcome.status, 'fini'); assert.equal(f.outcome.retenus, 3); assert.equal(f.outcome.ecrits, 3);
  assert.equal(f.rows.get('b').status, 'ecarte'); assert.equal(f.rows.get('b').signals.doublon_email, true);
  assert.match(f.rows.get('b').signals.raison, /déjà associée/); assert.equal(f.rows.get('c').to_email, 'local@example.invalid');
  assert.equal(f.written.includes('b'), false);
});

test('un mail échoué reste visible et un commerce supplémentaire permet d’atteindre le quota', { timeout: 3000 }, async () => {
  const f = await fixture(Array.from({ length: 20 }, (_, i) => place(i)), { config: config(3), write: async (row) => {
    if (row.id === '0') throw new RedactionError('redaction_timeout', 'Délai de test dépassé', { retryable: true });
    return draft;
  } });
  assert.equal(f.outcome.status, 'fini'); assert.equal(f.outcome.ecrits, 3); assert.equal(f.outcome.erreurs_redaction, 1);
  assert.equal(f.rows.get('0').status, 'erreur'); assert.equal(f.rows.get('0').signals.redaction_error.code, 'redaction_timeout');
  assert.ok(f.events.some((event) => event.type === 'error' && event.data.action.includes('Résultats')));
});

test('erreur permanente : aucun appel automatique infini, collecte maintenue et reprise possible', { timeout: 3000 }, async () => {
  const f = await fixture(Array.from({ length: 50 }, (_, i) => place(i)), { write: async () => { throw new RedactionError('engine_missing', 'CLI de test absent'); } });
  assert.equal(f.outcome.status, 'partiel'); assert.equal(f.outcome.reason, 'writing_blocked'); assert.ok(f.outcome.retenus >= 8);
  assert.ok(f.written.length <= 2); assert.equal(f.outcome.ecrits, 0); assert.equal(f.outcome.a_reprendre, 8);
  assert.ok([...f.rows.values()].some((row) => row.status === 'analyse'));
});

test('les limites et l’épuisement sont explicites, aucun faux contact n’est créé', { timeout: 3000 }, async () => {
  const noMail = await fixture(Array.from({ length: 300 }, (_, i) => place(i)), { read: () => ({ signals: {}, emails: [] }) });
  assert.equal(noMail.outcome.status, 'partiel'); assert.equal(noMail.outcome.reason, 'scan_limit'); assert.equal(noMail.outcome.exhausted, false);
  assert.equal(noMail.outcome.trouves, 250); assert.equal(noMail.outcome.ecrits, 0); assert.equal(noMail.written.length, 0);
  const exhausted = await fixture([place(1), place(2), place(3)]);
  assert.equal(exhausted.outcome.status, 'partiel'); assert.equal(exhausted.outcome.reason, 'radius_exhausted'); assert.equal(exhausted.outcome.exhausted, true);
  assert.equal(exhausted.outcome.rayon, 20000); assert.equal(exhausted.outcome.ecrits, 3); assert.equal(exhausted.outcome.a_reprendre, 5);
});

test('une panne de source ne perd pas les lectures et mails déjà en attente', { timeout: 3000 }, async () => {
  const f = await fixture([place(1), place(2), place(3)], { reason: 'source_error' });
  assert.equal(f.outcome.status, 'partiel'); assert.equal(f.outcome.reason, 'source_error'); assert.equal(f.outcome.exhausted, false);
  assert.equal(f.outcome.lus, 3); assert.equal(f.outcome.ecrits, 3); assert.equal(f.outcome.erreur, false);
});

test('la mission refuse le verrou de mise à jour acquis pendant une lecture asynchrone', async () => {
  let release, updating = false, mutations = 0;
  const body = new Promise((resolve) => { release = resolve; });
  const request = (async () => { await body; verifierDisponibiliteMission({ running: false, updating }); mutations++; })();
  updating = true; release();
  await assert.rejects(request, { code: 'update_active' }); assert.equal(mutations, 0);
  assert.throws(() => verifierDisponibiliteMission({ running: true, updating: false }), { code: 'mission_active' });
});
