// Le chef d'équipe : lance l'éclaireur, distribue le travail aux lecteurs puis aux rédacteurs,
// et raconte chaque geste sous forme d'événements (enregistrés pour pouvoir rejouer une session).
import { EventEmitter } from 'node:events';
import { db, upsertPlace, updatePlace, getPlace, getRun, listPlaces, insertEvent } from './db.mjs';
import { eclairer, CHAINES } from './agents/eclaireur.mjs';
import { eclairerOSM, overpass } from './agents/carte.mjs';
import { lire, noter } from './agents/lecteur.mjs';
import { rediger } from './agents/redacteur.mjs';
import { ficheGoogle } from './agents/google.mjs';
import { countryAt } from './benelux.mjs';
import { randomUUID } from 'node:crypto';
import { writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { GOOGLE_KEY, ROOT, loadConfig } from './env.mjs';
import { createDraftSessions } from './redaction-session.mjs';
import { isUpdating } from './updates.mjs';

export const bus = new EventEmitter();
bus.setMaxListeners(50);

let activeVisits = 0;
let current = null; // la session en cours, une seule à la fois

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function emit(runId, agent, type, placeId = null, data = {}) {
  const e = { run_id: runId, t: Date.now(), agent, type, place_id: placeId, data };
  e.seq = insertEvent(e);
  bus.emit('event', e);
  return e;
}

/** Une file d'attente toute simple : les ouvriers attendent qu'il y ait du travail ou que tout soit fini. */
class Queue {
  items = [];
  waiters = [];
  closed = false;
  push(x) { const w = this.waiters.shift(); w ? w(x) : this.items.push(x); }
  close() { this.closed = true; for (const w of this.waiters.splice(0)) w(null); }
  next() {
    if (this.items.length) return Promise.resolve(this.items.shift());
    if (this.closed) return Promise.resolve(null);
    return new Promise((r) => this.waiters.push(r));
  }
}

const draftSessions = createDraftSessions({
  getRun, listPlaces, getPlace, updatePlace, rediger, emit, loadConfig,
  isMissionRunning: () => Boolean(current) || activeVisits > 0,
  isUpdating,
  saveConfig(config) {
    const temporary = join(ROOT, 'config.json.tmp');
    writeFileSync(temporary, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
    renameSync(temporary, join(ROOT, 'config.json'));
  },
});

export function isRunning() { return Boolean(current) || activeVisits > 0 || draftSessions.isRunning(); }
export const isDraftRunning = draftSessions.isRunning;
export const lancerBrouillons = draftSessions.start;
export const statutBrouillons = draftSessions.getJob;

export async function lancer(config) {
  if (isRunning()) throw new Error('Une session tourne déjà.');
  const { recherche, offre, equipe } = config;
  const consignes = config.consignes ?? '';
  const objectif = Number(recherche.objectif_mails) > 0 ? Number(recherche.objectif_mails) : Infinity;
  const runId = new Date().toISOString().slice(0,19).replace(/[-:T]/g,'') + '-' + randomUUID().slice(0,8);
  db.prepare('INSERT INTO runs (id, metier, ville, started_at, status, lat, lon, rayon, nombre, pays) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(runId, recherche.metier, recherche.ville, Date.now(), 'en_cours', recherche.centre.lat, recherche.centre.lon,
      recherche.rayon_m ?? 2200, recherche.nombre, recherche.pays ?? null);
  current = { runId };
  emit(runId, 'chef', 'start', null, {
    metier: recherche.metier, ville: recherche.ville, centre: recherche.centre, nombre: recherche.nombre, rayon: recherche.rayon_m ?? 2200, pays: recherche.pays ?? null,
    redaction_active: config.redaction?.moteur !== 'aucun', objectif_mails: Number.isFinite(objectif) ? objectif : null, veut: recherche.veut ?? { emails: true, telephones: true }, offre: offre?.ce_que_je_vends ?? null,
  });

  const toRead = new Queue();
  const toWrite = new Queue();
  let failed = false;
  const counts = { trouves: 0, lus: 0, retenus: 0, ecrits: 0, ecartes: 0 };

  const lecteur = async (n) => {
    const agent = `lecteur-${n}`;
    for (let place; (place = await toRead.next()); ) {
      // l'objectif est atteint : les commerces qui restent ne sont pas lus (et on le montre)
      if (counts.retenus >= objectif) { emit(runId, agent, 'skip', place.id, { name: place.name }); continue; }
      updatePlace(runId, place.id, { status: 'lecture' });
      emit(runId, agent, 'start', place.id, { name: place.name, site: place.website });
      let lecture;
      try {
        lecture = await lire(place, { onStep: (texte) => emit(runId, agent, 'step', place.id, { texte }) });
      } catch (e) {
        lecture = { ok: false, raison: e.message, signals: { site: false }, emails: [], excerpt: '' };
      }
      const note = noter(place, lecture);
      const retenu = note.score >= equipe.score_minimum && lecture.emails.length > 0 && counts.retenus < objectif;
      counts.lus++;
      retenu ? counts.retenus++ : counts.ecartes++;
      updatePlace(runId, place.id, {
        status: retenu ? (config.redaction?.moteur === 'aucun' ? 'analyse' : 'a_ecrire') : 'ecarte',
        score: note.score,
        signals: { ...lecture.signals, telephones: lecture.telephones ?? [], raisons: note.raisons, raison: lecture.raison ?? null },
        emails: lecture.emails,
        to_email: lecture.emails[0] ?? null,
        email_source: lecture.email_source ?? null,
        excerpt: lecture.excerpt,
      });
      emit(runId, agent, 'done', place.id, {
        name: place.name, score: note.score, retenu, raisons: note.raisons, raison: lecture.raison ?? null,
        email: lecture.emails[0] ?? null, email_source: lecture.email_source ?? null, signals: lecture.signals, telephones: lecture.telephones ?? [],
      });
      if (retenu && config.redaction?.moteur !== 'aucun') toWrite.push({ place, lecture, note });
    }
  };

  const redacteur = async (n) => {
    const agent = `redacteur-${n}`;
    for (let job; (job = await toWrite.next()); ) {
      const { place, lecture, note } = job;
      updatePlace(runId, place.id, { status: 'ecriture' });
      emit(runId, agent, 'start', place.id, { name: place.name });
      try {
        const r = await rediger(place, lecture, note, offre, consignes, config.redaction ?? {});
        counts.ecrits++;
        updatePlace(runId, place.id, { status: 'en_attente', constat: r.constat, objet: r.objet, mail: r.mail });
        emit(runId, agent, 'done', place.id, { name: place.name, constat: r.constat, objet: r.objet, mail: r.mail, to: lecture.emails[0], duree_ms: r.duree_ms });
      } catch (e) {
        failed = true;
        updatePlace(runId, place.id, { status: 'erreur' });
        emit(runId, agent, 'error', place.id, { name: place.name, message: e.message });
      }
    }
  };

  // En coulisse : la fiche Google de chaque commerce trouvé sur OpenStreetMap (son identifiant seulement).
  const toMatch = new Queue();
  const matcher = async () => {
    for (let place; (place = await toMatch.next()); ) {
      try { updatePlace(runId, place.id, { gid: await ficheGoogle(place) }); } catch {}
    }
  };
  const matchers = GOOGLE_KEY && recherche.source !== 'google' ? [matcher(), matcher()] : [];

  const readers = Array.from({ length: equipe.lecteurs_en_parallele }, (_, i) => lecteur(i + 1));
  const writers = Array.from({ length: equipe.redacteurs_en_parallele }, (_, i) => redacteur(i + 1));

  (async () => {
    try {
      // Source des commerces : OpenStreetMap par défaut (utilisable avec notre carte), Google Places en option.
      const chercher = recherche.source === 'google' ? eclairer : eclairerOSM;
      const kept = await chercher(recherche, {
        exclure: CHAINES,
        onLog: (texte) => emit(runId, 'eclaireur', 'step', null, { texte }),
        onFound: async (place) => {
          const cc = countryAt(place.lat, place.lon);
          if (!cc) return;
          place.pays = cc;
          counts.trouves++;
          upsertPlace(runId, { ...place, gid: recherche.source === 'google' ? place.id : null, status: 'trouve' });
          if (matchers.length) toMatch.push(place);
          emit(runId, 'eclaireur', 'found', place.id, place);
          toRead.push(place);
          await sleep(180); // le temps de voir chaque commerce s'allumer sur la carte
        },
      });
      emit(runId, 'eclaireur', 'done', null, { trouves: counts.trouves, demandes: recherche.nombre, rayon: kept?.rayon ?? recherche.rayon_m ?? 2200 });
    } catch (e) {
      failed = true;
      emit(runId, 'eclaireur', 'error', null, { message: e.message });
    }
    toRead.close();
    toMatch.close();
    await Promise.all(readers);
    toWrite.close();
    await Promise.all(writers);
    await Promise.all(matchers);
    db.prepare('UPDATE runs SET ended_at = ?, status = ? WHERE id = ?').run(Date.now(), failed ? 'erreur' : 'fini', runId);
    emit(runId, 'chef', 'end', null, {...counts, erreur: failed});
    current = null;
  })();

  return runId;
}

export function decider(runId, placeId, decision, edits = {}) {
  const place = getPlace(runId, placeId);
  if (!place) throw new Error('Commerce inconnu.');
  if (!['valide','refuse'].includes(decision)) throw new Error('Décision invalide.');
  if (!place.mail) throw new Error('Aucun brouillon à valider.');
  const fields = { status: decision === 'valide' ? 'valide' : 'refuse', decided_at: Date.now() };
  if (typeof edits.objet === 'string') fields.objet = edits.objet;
  if (typeof edits.mail === 'string') fields.mail = edits.mail;
  updatePlace(runId, placeId, fields);
  emit(runId, 'chef', 'decision', placeId, { name: place.name, decision: fields.status, objet: fields.objet ?? place.objet, mail: fields.mail ?? place.mail });
  return getPlace(runId, placeId);
}

/**
 * Un commerce cliqué sur la carte : on retrouve sa fiche OpenStreetMap (site, téléphone, horaires), un lecteur va lire
 * son site et le note ; s'il est intéressant, un rédacteur lui écrit. Les gestes s'ajoutent à la mission ouverte.
 */
export async function visiter(runId, poi, config) {
  if (draftSessions.isRunning() || isUpdating()) throw new Error('Une rédaction ou une mise à jour est en cours.');
  activeVisits++;
  try {
  const { offre, equipe } = config;
  const cc = countryAt(poi.lat, poi.lon);
  if (!cc) throw new Error('Commerce hors Benelux.');
  const consignes = config.consignes ?? '';
  const q = `[out:json][timeout:25];nwr(around:45,${poi.lat},${poi.lon})["name"="${String(poi.name).replace(/["\\]/g, '')}"];out tags center 3;`;
  const data = await overpass(q).catch(() => ({ elements: [] }));
  const e = (data.elements ?? [])[0];
  const t = e?.tags ?? {};
  const place = {
    id: e ? `osm-${e.type}-${e.id}` : `poi-${Math.round(poi.lat * 1e5)}-${Math.round(poi.lon * 1e5)}`,
    pays: cc, name: poi.name, address: [t['addr:housenumber'], t['addr:street'], t['addr:city']].filter(Boolean).join(' '),
    lat: e?.lat ?? e?.center?.lat ?? poi.lat, lon: e?.lon ?? e?.center?.lon ?? poi.lon, rating: null, reviews: null,
    website: t.website ?? t['contact:website'] ?? t.url ?? null, phone: t.phone ?? t['contact:phone'] ?? null,
    email_osm: t.email ?? t['contact:email'] ?? null, horaires: t.opening_hours ?? null, type: poi.type ?? t.shop ?? t.amenity ?? t.leisure ?? 'commerce',
    maps_uri: e ? `https://www.openstreetmap.org/${e.type}/${e.id}` : null,
  };
  upsertPlace(runId, { ...place, status: 'trouve' });
  emit(runId, 'eclaireur', 'found', place.id, { ...place, visite: true });
  const agent = poi.agent ?? 'lecteur-1';
  emit(runId, agent, 'start', place.id, { name: place.name, site: place.website });
  let lecture;
  try { lecture = await lire(place, { onStep: (texte) => emit(runId, agent, 'step', place.id, { texte }) }); }
  catch (err) { lecture = { ok: false, raison: err.message, signals: { site: false }, emails: [], excerpt: '' }; }
  const note = noter(place, lecture);
  const retenu = note.score >= equipe.score_minimum && lecture.emails.length > 0;
  updatePlace(runId, place.id, {
    status: retenu ? (config.redaction?.moteur === 'aucun' ? 'analyse' : 'a_ecrire') : 'ecarte', score: note.score,
    signals: { ...lecture.signals, telephones: lecture.telephones ?? [], raisons: note.raisons, raison: lecture.raison ?? null },
    emails: lecture.emails, to_email: lecture.emails[0] ?? null, email_source: lecture.email_source ?? null, excerpt: lecture.excerpt,
  });
  emit(runId, agent, 'done', place.id, {
    name: place.name, score: note.score, retenu, raisons: note.raisons, raison: lecture.raison ?? null,
    email: lecture.emails[0] ?? null, email_source: lecture.email_source ?? null, signals: lecture.signals, telephones: lecture.telephones ?? [],
  });
  if (!retenu || config.redaction?.moteur === 'aucun') return { place, retenu };
  const w = 'redacteur-1';
  updatePlace(runId, place.id, { status: 'ecriture' });
  emit(runId, w, 'start', place.id, { name: place.name });
  try {
    const r = await rediger(place, lecture, note, offre, consignes, config.redaction ?? {});
    updatePlace(runId, place.id, { status: 'en_attente', constat: r.constat, objet: r.objet, mail: r.mail });
    emit(runId, w, 'done', place.id, { name: place.name, constat: r.constat, objet: r.objet, mail: r.mail, to: lecture.emails[0], duree_ms: r.duree_ms });
  } catch (err) {
    updatePlace(runId, place.id, { status: 'erreur' });
    emit(runId, w, 'error', place.id, { name: place.name, message: err.message });
  }
  return { place, retenu };
  } finally { activeVisits--; }
}

