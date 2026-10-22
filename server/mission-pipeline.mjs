// Objectif = contacts réellement qualifiés et mails réellement rédigés, jamais lieux simplement scannés.
import { validerBrouillon } from './agents/moteurs.mjs';
import { erreurRedaction, signauxRedaction } from './redaction-recovery.mjs';

class Queue {
  items = []; waiters = []; closed = false;
  push(item) { const waiter = this.waiters.shift(); waiter ? waiter(item) : this.items.push(item); }
  close() { this.closed = true; for (const waiter of this.waiters.splice(0)) waiter(null); }
  next() { if (this.items.length) return Promise.resolve(this.items.shift()); return this.closed ? Promise.resolve(null) : new Promise((resolve) => this.waiters.push(resolve)); }
}

export function verifierDisponibiliteMission({ running, updating }) {
  if (updating) throw Object.assign(new Error('Une mise à jour est en cours. Attendez sa fin avant une mission.'), { code: 'update_active' });
  if (running) throw Object.assign(new Error('Une mission ou une rédaction est déjà en cours.'), { code: 'mission_active' });
}

export function objectifsMission(config) {
  const contacts = Math.max(1, Math.min(60, Math.floor(Number(config.recherche.nombre) || 20)));
  const active = config.redaction?.moteur !== 'aucun';
  const requested = Number(config.recherche.objectif_mails);
  return { objectif_contacts: contacts, objectif_mails: active ? Math.min(contacts, requested > 0 ? Math.floor(requested) : contacts) : 0,
    limite_scan: 250, rayon_max_m: 20000 };
}

export async function runMissionPipeline(config, { discover, read, score, write, found = () => {}, update = () => {}, saved = () => null,
  emit = () => {}, allowed = () => true, match = null } = {}) {
  const targets = objectifsMission(config);
  const minimum = Number(config.equipe?.score_minimum ?? 60);
  const readersCount = Math.min(3, Math.max(1, Number(config.equipe?.lecteurs_en_parallele) || 3));
  const maxDraftJobs = Math.min(250, targets.objectif_mails + Math.min(20, targets.objectif_mails));
  const counts = { trouves: 0, lus: 0, retenus: 0, ecrits: 0, ecartes: 0, erreurs_redaction: 0 };
  const entries = new Map(), qualified = new Set(), seen = new Set(), claimedEmails = new Set();
  const reads = new Queue(), writes = new Queue(), matches = new Queue();
  const changes = new Set(), workerFailures = [];
  let pendingReads = 0, pendingWrites = 0, draftJobs = 0, consecutiveErrors = 0, writingBlocked = null, fatal = false;
  const changed = () => { for (const resolve of changes) resolve(); changes.clear(); };
  const waitChange = () => new Promise((resolve) => changes.add(resolve));
  const latest = (id) => saved(id) ?? entries.get(id);
  const record = (id, fields) => { Object.assign(entries.get(id), fields); update(id, fields); };
  const refresh = () => {
    counts.retenus = 0; counts.ecrits = 0;
    for (const id of qualified) {
      const row = latest(id);
      if (!row || row.status === 'refuse') continue;
      counts.retenus++;
      if (row.mail?.trim()) counts.ecrits++;
    }
  };
  const reached = () => { refresh(); return counts.retenus >= targets.objectif_contacts && counts.ecrits >= targets.objectif_mails; };
  const stopDiscovery = () => fatal || reached() || Boolean(writingBlocked && counts.retenus >= targets.objectif_contacts);
  const progress = () => { refresh(); emit('chef', 'progress', null, { ...counts, ...targets, examines: counts.lus,
    objectif_atteint: reached(), a_reprendre: targets.objectif_mails ? Math.max(0, targets.objectif_mails - counts.ecrits) : 0,
    writing_blocked: writingBlocked }); };
  const writer = async (number) => {
    for (let job; (job = await writes.next()); ) {
      const agent = `redacteur-${number}`, { place, lecture, note } = job;
      try {
        refresh();
        if (writingBlocked || counts.ecrits >= targets.objectif_mails || latest(place.id)?.status === 'refuse' || latest(place.id)?.mail?.trim()) {
          if (!latest(place.id)?.mail?.trim() && latest(place.id)?.status !== 'refuse') record(place.id, { status: 'analyse' });
          continue;
        }
        if (draftJobs >= maxDraftJobs) { writingBlocked = 'model_budget'; record(place.id, { status: 'analyse' }); continue; }
        draftJobs++;
        record(place.id, { status: 'ecriture' });
        emit(agent, 'start', place.id, { name: place.name });
        try {
          const result = await write(place, lecture, note, config.offre, config.consignes ?? '', { ...config.redaction,
            onRetry: (info) => emit(agent, 'retry', place.id, { name: place.name, ...info }),
          });
          const draft = validerBrouillon(result), row = latest(place.id);
          if (!row || ['valide', 'refuse'].includes(row.status) || row.mail?.trim()) continue;
          const language = { mail_langue: result.mail_langue ?? null, mail_langue_source: result.mail_langue_source ?? null };
          record(place.id, { status: 'en_attente', ...draft, ...language, signals: signauxRedaction(row.signals) });
          consecutiveErrors = 0;
          emit(agent, 'done', place.id, { name: place.name, ...draft, ...language, to: lecture.emails[0], duree_ms: result.duree_ms, attempts: result.attempts ?? 1 });
        } catch (error) {
          counts.erreurs_redaction++; consecutiveErrors++;
          const row = latest(place.id);
          if (row && !row.mail?.trim() && !['valide', 'refuse'].includes(row.status)) record(place.id, { status: 'erreur', signals: signauxRedaction(row.signals, error) });
          const details = erreurRedaction(error);
          emit(agent, 'error', place.id, { name: place.name, ...details });
          if (['engine_missing', 'engine_start_failed', 'engine_exit_failed', 'engine_reported_error', 'tool_use_blocked'].includes(details.code) || consecutiveErrors >= 3) writingBlocked = 'writing_blocked';
        }
      } finally { pendingWrites--; try { progress(); } finally { changed(); } }
    }
  };
  const reader = async (number) => {
    const agent = `lecteur-${number}`;
    for (let place; (place = await reads.next()); ) {
      try {
        // Une panne de la source ferme la découverte, pas les lectures déjà reçues.
        if (reached() || Boolean(writingBlocked && counts.retenus >= targets.objectif_contacts)) { emit(agent, 'skip', place.id, { name: place.name }); continue; }
        record(place.id, { status: 'lecture' });
        emit(agent, 'start', place.id, { name: place.name, site: place.website });
        let lecture;
        try { lecture = await read(place, { onStep: (texte) => emit(agent, 'step', place.id, { texte }) }); }
        catch (error) { lecture = { ok: false, raison: error.message, signals: { site: false }, emails: [], excerpt: '' }; }
        lecture.emails = [...new Set((lecture.emails ?? []).filter((email) => typeof email === 'string' && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)).map((email) => email.trim().toLowerCase()))];
        const note = score(place, lecture);
        const address = lecture.emails.find((email) => !claimedEmails.has(email));
        const duplicate = lecture.emails.length > 0 && !address;
        const retained = note.score >= minimum && Boolean(address) && latest(place.id)?.status !== 'refuse';
        if (retained) {
          claimedEmails.add(address);
          lecture.emails = [address, ...lecture.emails.filter((email) => email !== address)];
        }
        if (duplicate) lecture.raison = 'Adresse publique déjà associée à un autre commerce de cette mission.';
        counts.lus++;
        if (retained) qualified.add(place.id); else counts.ecartes++;
        const signals = { ...lecture.signals, telephones: lecture.telephones ?? [], raisons: note.raisons, raison: lecture.raison ?? null, doublon_email: duplicate };
        record(place.id, { status: retained ? 'analyse' : 'ecarte', score: note.score, signals, emails: lecture.emails,
          to_email: lecture.emails[0] ?? null, email_source: lecture.email_source ?? null, excerpt: lecture.excerpt ?? '' });
        emit(agent, 'done', place.id, { name: place.name, score: note.score, retenu: retained, raisons: note.raisons, raison: lecture.raison ?? null,
          email: lecture.emails[0] ?? null, email_source: lecture.email_source ?? null, signals: lecture.signals, telephones: lecture.telephones ?? [] });
        if (retained && targets.objectif_mails) {
          refresh();
          while (!writingBlocked && counts.ecrits < targets.objectif_mails && counts.ecrits + pendingWrites >= targets.objectif_mails) { await waitChange(); refresh(); }
          if (!writingBlocked && counts.ecrits < targets.objectif_mails && latest(place.id)?.status !== 'refuse') {
            pendingWrites++; record(place.id, { status: 'a_ecrire' }); writes.push({ place, lecture, note });
          }
        }
      } finally { pendingReads--; try { progress(); } finally { changed(); } }
    }
  };
  const matcher = async () => { for (let place; (place = await matches.next()); ) { try { await match(place); } catch {} } };
  const supervise = (task) => task.catch((error) => { workerFailures.push(error); fatal = true; writingBlocked = 'workflow_failed'; changed(); });
  const readerTasks = Array.from({ length: readersCount }, (_, i) => supervise(reader(i + 1)));
  const writerTasks = targets.objectif_mails ? [supervise(writer(1)), supervise(writer(2))] : [];
  const matchTasks = match ? [matcher(), matcher()] : [];
  let discovery = null;
  try {
    discovery = await discover({ ...config.recherche, ...targets }, {
      shouldContinue: () => !stopDiscovery(),
      onLog: (texte) => emit('eclaireur', 'step', null, { texte }),
      onFound: async (place) => {
        while (!stopDiscovery() && (pendingReads >= readersCount * 2 || !writingBlocked && targets.objectif_mails && counts.ecrits + pendingWrites >= targets.objectif_mails && counts.ecrits < targets.objectif_mails)) await waitChange();
        if (stopDiscovery()) return false;
        if (seen.has(place.id) || !allowed(place)) return true;
        if (counts.trouves >= targets.limite_scan) return false;
        seen.add(place.id); entries.set(place.id, { ...place, status: 'trouve' }); counts.trouves++;
        found(place); emit('eclaireur', 'found', place.id, place);
        if (match) matches.push(place);
        pendingReads++; reads.push(place);
        return true;
      },
    });
    if (discovery?.reason === 'source_error') { fatal = true; emit('eclaireur', 'error', null, { code: 'source_error', message: 'La source de commerces ne répond pas. Les résultats déjà obtenus sont conservés.' }); }
  } catch { fatal = true; emit('eclaireur', 'error', null, { code: 'source_error', message: 'La source de commerces ne répond pas. Les résultats déjà obtenus sont conservés.' }); }
  reads.close(); matches.close();
  const readResults = await Promise.allSettled(readerTasks);
  writes.close();
  const all = [...readResults, ...await Promise.allSettled(writerTasks), ...await Promise.allSettled(matchTasks)];
  if (workerFailures.length || all.some((result) => result.status === 'rejected')) { fatal = true; emit('chef', 'error', null, { code: 'workflow_failed', message: 'Une étape de traitement a été interrompue. Les résultats déjà enregistrés sont conservés.' }); }
  refresh();
  const objectiveReached = reached();
  const reason = workerFailures.length ? 'workflow_failed' : fatal ? 'source_error' : objectiveReached ? 'objective_reached' : writingBlocked ?? discovery?.reason ?? 'radius_exhausted';
  const partial = !objectiveReached || fatal || reason === 'source_error';
  const result = { ...counts, ...targets, examines: counts.lus, objectif_atteint: objectiveReached,
    a_reprendre: Math.max(0, targets.objectif_mails - counts.ecrits), reason, exhausted: discovery?.exhausted === true, writing_blocked: writingBlocked,
    rayon: discovery?.rayon ?? config.recherche.rayon_m, queries: discovery?.queries ?? null,
    status: fatal && counts.lus === 0 ? 'erreur' : partial ? 'partiel' : 'fini', erreur: fatal && counts.lus === 0, partiel: partial };
  emit('eclaireur', 'done', null, { ...result, demandes: targets.objectif_contacts });
  return result;
}
