// Le chef d'équipe : lance l'éclaireur, distribue le travail aux lecteurs puis aux rédacteurs,
// et raconte chaque geste sous forme d'événements (enregistrés pour pouvoir rejouer une session).
import { EventEmitter } from 'node:events';
import { db, upsertPlace, updatePlace, getPlace, getRun, listPlaces, insertEvent } from './db.mjs';
import { eclairer, CHAINES } from './agents/eclaireur.mjs';
import { eclairerOSM, overpass } from './agents/carte.mjs';
import { lire, noter } from './agents/lecteur.mjs';
import { rediger } from './agents/redacteur.mjs';
import { countryAt } from './benelux.mjs';
import { randomUUID } from 'node:crypto';
import { writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadConfig } from './env.mjs';
import { createDraftSessions } from './redaction-session.mjs';
import { isUpdating } from './updates.mjs';
import { erreurRedaction, signauxRedaction } from './redaction-recovery.mjs';
import { objectifsMission, runMissionPipeline, verifierDisponibiliteMission } from './mission-pipeline.mjs';
import { resumerEvenements, bilanReprise } from './mission-summary.mjs';
import { configReprise, peutReprendre } from './mission-resume.mjs';

export const bus = new EventEmitter();
bus.setMaxListeners(50);

let activeVisits = 0;
let current = null; // la session en cours, une seule à la fois

function emit(runId, agent, type, placeId = null, data = {}) {
  const e = { run_id: runId, t: Date.now(), agent, type, place_id: placeId, data };
  e.seq = insertEvent(e);
  bus.emit('event', e);
  return e;
}

const draftSessions = createDraftSessions({
  getRun, listPlaces, getPlace, updatePlace, rediger, emit, loadConfig,
  isMissionRunning: () => Boolean(current) || activeVisits > 0,
  isUpdating,
  getTargets: resumeMission,
  onCompleted(runId, job) {
    const previous = resumeMission(runId);
    const minimum = previous.score_minimum ?? Number(loadConfig().equipe?.score_minimum ?? 60);
    const summary = bilanReprise(listPlaces(runId), previous, { minimum, objectifMails: job.objectif_mails, failed: job.status === 'failed' });
    db.prepare('UPDATE runs SET status = ? WHERE id = ?').run(summary.status, runId);
    emit(runId, 'chef', 'progress', null, summary);
  },
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

export function resumeMission(runId) {
  const read = (types, descending) => {
    const row = db.prepare("SELECT data FROM events WHERE run_id = ? AND agent = 'chef' AND type IN (" + types.map(() => '?').join(',') + ") ORDER BY seq " + (descending ? 'DESC' : 'ASC') + " LIMIT 1").get(runId, ...types);
    try { return row ? JSON.parse(row.data) : {}; } catch { return {}; }
  };
  const first = read(['start'], false), last = read(['progress', 'end'], true);
  return resumerEvenements(first, last);
}

export async function lancer(config) {
  verifierDisponibiliteMission({ running: isRunning(), updating: isUpdating() });
  const { recherche } = config;
  const targets = objectifsMission(config);
  const runId = new Date().toISOString().slice(0,19).replace(/[-:T]/g,'') + '-' + randomUUID().slice(0,8);
  db.prepare('INSERT INTO runs (id, metier, ville, started_at, status, lat, lon, rayon, nombre, pays) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(runId, recherche.metier, recherche.ville, Date.now(), 'en_cours', recherche.centre.lat, recherche.centre.lon,
      recherche.rayon_m ?? 2200, targets.objectif_contacts, recherche.pays ?? null);
  current = { runId };
  try {
  emit(runId, 'chef', 'start', null, {
    metier: recherche.metier, ville: recherche.ville, centre: recherche.centre, nombre: targets.objectif_contacts,
    rayon: recherche.rayon_m ?? 2200, pays: recherche.pays ?? null, ...targets,
    score_minimum: Number(config.equipe?.score_minimum ?? 60), redaction_active: targets.objectif_mails > 0, veut: recherche.veut ?? { emails: true, telephones: true }, offre: config.offre?.ce_que_je_vends ?? null,
  });
  executerMission(runId, config);
  return runId;
  } catch(error){current=null;throw error;}
}

export function missionReprenable(runId) {const run=getRun(runId);return peutReprendre(run,resumeMission(runId),isRunning()||isUpdating());}
export async function reprendreMission(runId) {
  verifierDisponibiliteMission({running:isRunning(),updating:isUpdating()});
  const run=getRun(runId);
  if(!run)throw Object.assign(new Error('Mission inconnue.'),{code:'run_not_found'});
  const config=configReprise(run,resumeMission(runId),loadConfig());
  const initialPlaces=listPlaces(runId);
  verifierDisponibiliteMission({running:isRunning(),updating:isUpdating()});
  current={runId};
  try {
  db.prepare('UPDATE runs SET status = ?, ended_at = NULL WHERE id = ?').run('en_cours',runId);
  emit(runId,'chef','resume',null,{...objectifsMission(config),commerces_conserves:initialPlaces.length});
  executerMission(runId,config,initialPlaces);
  return runId;
  }catch(error){current=null;throw error;}
}
function executerMission(runId, config, initialPlaces=[]) {
  const {recherche}=config,targets=objectifsMission(config);
  (async () => {
    try {
      const search = recherche.source === 'google' ? eclairer : eclairerOSM;
      const outcome = await runMissionPipeline(config, {
        initialPlaces,
        discover: (request, options) => search(request, { ...options, exclure: CHAINES }),
        read: lire, score: noter, write: rediger,
        allowed(place) { const cc = countryAt(place.lat, place.lon); if (!cc) return false; place.pays = cc; return true; },
        found(place) { upsertPlace(runId, { ...place, gid: recherche.source === 'google' ? place.id : null, status: 'trouve' }); },
        update: (id, fields) => updatePlace(runId, id, fields),
        saved: (id) => getPlace(runId, id),
        emit: (agent, type, placeId, data) => emit(runId, agent, type, placeId, data),
        // La fiche Google facultative est résolue au clic par l'API, pas par 250 requêtes en queue de mission.
      });
      db.prepare('UPDATE runs SET ended_at = ?, status = ? WHERE id = ?').run(Date.now(), outcome.status, runId);
      emit(runId, 'chef', 'end', null, outcome);
    } catch {
      const places = listPlaces(runId), hasResults = places.some((place) => place.score != null || place.mail);
      db.prepare('UPDATE runs SET ended_at = ?, status = ? WHERE id = ?').run(Date.now(), hasResults ? 'partiel' : 'erreur', runId);
      emit(runId, 'chef', 'error', null, { code: 'workflow_failed', message: 'Une étape de traitement a été interrompue. Les résultats déjà enregistrés sont conservés.' });
      emit(runId, 'chef', 'end', null, { ...targets, status: hasResults ? 'partiel' : 'erreur', erreur: !hasResults, partiel: hasResults, objectif_atteint: false, reason: 'workflow_failed' });
    } finally { current = null; }
  })().catch(() => {
    // Si la mémoire locale est elle-même indisponible, le journal de secours peut échouer aussi.
    // Observer ce dernier rejet garde le serveur vivant, sans exposer de données de la mission.
    console.error('Le bilan de la mission ne peut pas être enregistré. Vérifiez le dossier de données local.');
  });
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
  const kept = (place) => ({ place, retenu: Number(place.score) >= Number(equipe.score_minimum) && Boolean(place.to_email), conserve: true });
  const existingPoi = listPlaces(runId).find((place) => place.name === poi.name && Math.abs(place.lat - poi.lat) < 0.0005 && Math.abs(place.lon - poi.lon) < 0.0005);
  if (existingPoi) return kept(existingPoi);
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
  const existing = getPlace(runId, place.id);
  if (existing) return kept(existing);
  upsertPlace(runId, { ...place, status: 'trouve' });
  emit(runId, 'eclaireur', 'found', place.id, { ...place, visite: true });
  const agent = poi.agent ?? 'lecteur-1';
  emit(runId, agent, 'start', place.id, { name: place.name, site: place.website });
  let lecture;
  try { lecture = await lire(place, { onStep: (texte) => emit(runId, agent, 'step', place.id, { texte }) }); }
  catch (err) { lecture = { ok: false, raison: err.message, signals: { site: false }, emails: [], excerpt: '' }; }
  const note = noter(place, lecture);
  const retenu = note.score >= equipe.score_minimum && lecture.emails.length > 0;
  const beforeReadCommit = getPlace(runId, place.id);
  if (beforeReadCommit?.mail?.trim() || ['valide', 'refuse'].includes(beforeReadCommit?.status)) return kept(beforeReadCommit);
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
    const r = await rediger(place, lecture, note, offre, consignes, { ...config.redaction,
      onRetry: (info) => emit(runId, w, 'retry', place.id, { name: place.name, ...info }),
    });
    const beforeDraftCommit = getPlace(runId, place.id);
    if (beforeDraftCommit?.mail?.trim() || ['valide', 'refuse'].includes(beforeDraftCommit?.status)) return kept(beforeDraftCommit);
    updatePlace(runId, place.id, { status: 'en_attente', constat: r.constat, objet: r.objet, mail: r.mail,
      mail_langue: r.mail_langue ?? null, mail_langue_source: r.mail_langue_source ?? null, signals: signauxRedaction(getPlace(runId, place.id)?.signals) });
    emit(runId, w, 'done', place.id, { name: place.name, constat: r.constat, objet: r.objet, mail: r.mail, to: lecture.emails[0], duree_ms: r.duree_ms,
      attempts: r.attempts ?? 1, mail_langue: r.mail_langue ?? null, mail_langue_source: r.mail_langue_source ?? null });
  } catch (err) {
    const latest = getPlace(runId, place.id);
    if (latest?.mail?.trim() || ['valide', 'refuse'].includes(latest?.status)) return kept(latest);
    updatePlace(runId, place.id, { status: 'erreur', signals: signauxRedaction(latest?.signals, err) });
    emit(runId, w, 'error', place.id, { name: place.name, ...erreurRedaction(err) });
  }
  return { place, retenu };
  } finally { activeVisits--; }
}

