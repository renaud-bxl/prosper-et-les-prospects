import test from 'node:test';
import assert from 'node:assert/strict';
import { resumerEvenements, bilanReprise, contactsUniques } from '../server/mission-summary.mjs';

const row = (id, fields = {}) => ({ id, score: 75, status: 'analyse', to_email: `${id}@example.invalid`, emails: [`${id}@example.invalid`], ...fields });

test('les objectifs historiques absents restent inconnus, même si le premier événement contient nombre', () => {
  const summary = resumerEvenements({ nombre: 60, rayon: 2500 }, { ecrits: 10, lus: 60 });
  assert.equal(summary.objectif_contacts, null); assert.equal(summary.objectif_mails, null); assert.equal(summary.limite_scan, null);
  assert.equal(summary.rayon, 2500); assert.equal(summary.ecrits, 10);
});

test('une reprise complète ses compteurs et reste partielle si la source a fourni moins que le quota', () => {
  const previous = { objectif_contacts: 8, objectif_mails: 8, retenus: 6, ecrits: 3, a_reprendre: 5, reason: 'radius_exhausted', exhausted: true, rayon: 20000 };
  const rows = Array.from({ length: 6 }, (_, i) => row(String(i), { status: 'en_attente', mail: `Mail ${i}` }));
  const result = bilanReprise(rows, previous);
  assert.equal(result.status, 'partiel'); assert.equal(result.objectif_atteint, false); assert.equal(result.ecrits, 6);
  assert.equal(result.a_reprendre, 2); assert.equal(result.reason, 'radius_exhausted'); assert.equal(result.exhausted, true);
  assert.equal(resumerEvenements({ objectif_contacts: 8, objectif_mails: 8 }, result).ecrits, 6);
});

test('la réparation atteint les deux quotas et retire l’état bloqué sans toucher aux mails', () => {
  const rows = Array.from({ length: 8 }, (_, i) => row(String(i), { status: i === 0 ? 'valide' : 'en_attente', mail: `Mail conservé ${i}` }));
  const before = structuredClone(rows);
  const result = bilanReprise(rows, { objectif_contacts: 8, objectif_mails: 8, reason: 'writing_blocked', writing_blocked: 'writing_blocked' });
  assert.equal(result.status, 'fini'); assert.equal(result.objectif_atteint, true); assert.equal(result.a_reprendre, 0);
  assert.equal(result.reason, 'objective_reached'); assert.equal(result.writing_blocked, null); assert.deepEqual(rows, before);
});

test('des adresses communes, refus et scores faibles ne gonflent jamais le bilan', () => {
  const rows = [row('a', { mail: 'A', status: 'valide' }), row('b', { to_email: 'A@example.invalid', emails: ['A@example.invalid'], mail: 'B' }),
    row('c', { to_email: 'a@example.invalid', emails: ['a@example.invalid', 'local@example.invalid'] }),
    row('refused', { status: 'refuse', mail: 'Refusé' }), row('low', { score: 50, mail: 'Bas' })];
  assert.equal(contactsUniques(rows).length, 2); assert.equal(contactsUniques(rows)[1].to_email, 'local@example.invalid');
  const result = bilanReprise(rows, { objectif_contacts: 3, objectif_mails: 3 });
  assert.equal(result.retenus, 2); assert.equal(result.ecrits, 1); assert.equal(result.status, 'partiel');
});

test('une ancienne mission réparée peut finir sans inventer de quotas historiques', () => {
  const result = bilanReprise([row('a', { mail: 'Réparé', status: 'en_attente' })], {});
  assert.equal(result.status, 'fini'); assert.equal(result.objectif_contacts, null); assert.equal(result.objectif_mails, null);
  assert.equal(result.objectif_atteint, null); assert.equal(result.a_reprendre, 0);
});

test('une demande explicite de rédaction après analyse conserve sa nouvelle cible dans le bilan', () => {
  const previous = { objectif_contacts: 3, objectif_mails: 0 };
  const summary = bilanReprise([row('a', { mail: 'A' }), row('b', { mail: 'B' })], previous, { objectifMails: 3 });
  assert.equal(summary.objectif_mails, 3); assert.equal(summary.status, 'partiel'); assert.equal(summary.a_reprendre, 1);
  assert.equal(resumerEvenements(previous, summary).objectif_mails, 3);
});
