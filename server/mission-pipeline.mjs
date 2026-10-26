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
  emit = () => {}, allowed = () => true, match = null, initialPlaces = [] } = {}) {
  const targets = objectifsMission(config);
  const minimum = Number(config.equipe?.score_minimum ?? 60);
  const readersCount = Math.min(3, Math.max(1, Number(config.equipe?.lecteurs_en_parallele) || 3));
  const maxDraftJobs = Math.min(250, targets.objectif_mails + Math.min(20, targets.objectif_mails));
  const counts = { trouves: 0, lus: 0, retenus: 0, ecrits: 0, ecartes: 0, erreurs_redaction: 0 };
  const entries = new Map(), qualified = new Set(), seen = new Set(), claimedEmails = new Set();
  const reads = new Queue(), writes = new Queue(), matches = new Queue();
  const changes = new Set(), workerFailures = [];
  let pendingReads = 0, pendingWrites = 0, activeWrites = 0, draftJobs = 0, draftFailures = 0, consecutiveErrors = 0, writingBlocked = null, writingBlockedCode = null, fatal = false;
  const changed = () => { for (const resolve of changes) resolve(); changes.clear(); };
  const waitChange = () => new Promise((resolve) => changes.add(resolve));
  const latest = (id) => saved(id) ?? entries.get(id);
  const record = (id, fields) => { Object.assign(entries.get(id), fields); update(id, fields); };
  const refresh = () => {
    counts.retenus = 0; counts.ecrits = 0; counts.erreurs_redaction = 0;
    // Une erreur historique réparée n'est plus un mail manquant. Le journal garde son événement.
    for (const id of entries.keys()) {
      const row = latest(id);
      if (row?.status === 'erreur' && !row.mail?.trim()) counts.erreurs_redaction++;
      if (!qualified.has(id) || !row || row.status === 'refuse') continue;
      counts.retenus++;
      if (row.mail?.trim()) counts.ecrits++;
    }
  };
  const reached = () => counts.retenus >= targets.objectif_contacts && counts.ecrits >= targets.objectif_mails;
  const stopDiscovery = () => fatal || reached() || Boolean(writingBlocked && counts.retenus >= targets.objectif_contacts);
  const progress = () => { refresh(); emit('chef', 'progress', null, { ...counts, ...targets, examines: counts.lus,
    objectif_atteint: reached(), a_reprendre: targets.objectif_mails ? Math.max(0, targets.objectif_mails - counts.ecrits) : 0,
    writing_blocked: writingBlocked, writing_blocked_code: writingBlockedCode,
    tentatives_redaction: draftJobs, limite_redactions: maxDraftJobs, echecs_redaction: draftFailures }); };

  // Seed persisted state before starting workers. A default database score of0
  // is not evidence that a trouve/lecture row was actually analysed.
  const analysedStatuses = new Set(['analyse', 'retenu', 'a_ecrire', 'ecriture', 'erreur', 'en_attente', 'valide', 'refuse', 'ecarte', 'rejete']);
  const rejectedStatuses = new Set(['refuse', 'ecarte', 'rejete']);
  const addressesOf = row => [...new Set([row.to_email, ...(Array.isArray(row.emails) ? row.emails : [])]
    .filter(value => typeof value === 'string').map(value => value.trim().toLowerCase())
    .filter(value => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value)))];
  for (const row of Array.isArray(initialPlaces) ? initialPlaces : []) {
    if (row?.id == null || seen.has(String(row.id))) continue;
    const id = String(row.id); seen.add(id); entries.set(id, { ...row, id });
  }
  counts.trouves = entries.size;
  // Existing drafts reserve their actual recipient before unfinished analyses
  // choose an alternative public address. Decisions themselves stay untouched.
  const priority = row => row.status === 'valide' ? 0 : row.mail?.trim() ? 1 : row.status === 'refuse' ? 2 : 3;
  for (const row of [...entries.values()].sort((a, b) => priority(a) - priority(b))) {
    const hasMail = Boolean(row.mail?.trim()), decided = ['valide', 'refuse'].includes(row.status);
    const analysisEvidence = Array.isArray(row.signals?.raisons) || Object.hasOwn(row.signals ?? {}, 'raison');
    const analysed = analysedStatuses.has(row.status) || hasMail || analysisEvidence;
    if (analysed) counts.lus++;
    if (rejectedStatuses.has(row.status)) counts.ecartes++;
    const addresses = addressesOf(row);
    const address = hasMail || decided ? addresses[0] : addresses.find(email => !claimedEmails.has(email));
    const duplicate = address && claimedEmails.has(address);
    if ((hasMail || decided) && address) claimedEmails.add(address);
    const retained = analysed && !rejectedStatuses.has(row.status) && Boolean(address) && !duplicate
      && (hasMail || row.status === 'valide' || Number(row.score) >= minimum);
    if (retained) {
      qualified.add(row.id); claimedEmails.add(address);
      if (!hasMail && !decided) {
        const emails = [address, ...addresses.filter(email => email !== address)];
        if (row.to_email !== address || row.emails?.[0] !== address) record(row.id, { to_email: address, emails });
        if (targets.objectif_mails) {
          const lecture = { ok: row.signals?.site !== false, signals: { ...(row.signals ?? {}) }, emails,
            telephones: row.signals?.telephones ?? [], email_source: row.email_source ?? null,
            excerpt: row.excerpt ?? '', raison: row.signals?.raison ?? null };
          pendingWrites++; writes.push({ place: row, lecture, note: { score: Number(row.score) || 0, raisons: row.signals?.raisons ?? [] } });
        }
      }
    } else if (!analysed && !hasMail && !decided) {
      pendingReads++; reads.push(row);
    }
  }
  if (entries.size) progress();
  const writer = async (number) => {
    for (let job; (job = await writes.next()); ) {
      const agent = `redacteur-${number}`, { place, lecture, note } = job;
      let executing = false;
      try {
        refresh();
        // Une reprise peut contenir plus de candidats mémorisés que de mails manquants.
        // Réserver les appels actifs évite de dépasser le quota avec le deuxième rédacteur.
        while (!writingBlocked && counts.ecrits < targets.objectif_mails && counts.ecrits + activeWrites >= targets.objectif_mails) { await waitChange(); refresh(); }
        if (writingBlocked || counts.ecrits >= targets.objectif_mails || latest(place.id)?.status === 'refuse' || latest(place.id)?.mail?.trim()) {
          if (!latest(place.id)?.mail?.trim() && latest(place.id)?.status !== 'refuse') record(place.id, { status: 'analyse' });
          continue;
        }
        if (draftJobs >= maxDraftJobs) {
          writingBlocked = 'model_budget'; writingBlockedCode = 'model_budget'; record(place.id, { status: 'analyse' });
          emit('chef', 'writing:blocked', null, { reason: writingBlocked, code: writingBlockedCode,
            message: `La limite de ${maxDraftJobs} candidats essayés en rédaction dans cette exécution est atteinte. Les brouillons et les candidats restants sont conservés pour une reprise explicite.`,
            tentatives_redaction: draftJobs, limite_redactions: maxDraftJobs });
          continue;
        }
        draftJobs++;
        activeWrites++; executing = true;
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
          draftFailures++;
          const row = latest(place.id);
          if (row && !row.mail?.trim() && !['valide', 'refuse'].includes(row.status)) record(place.id, { status: 'erreur', signals: signauxRedaction(row.signals, error) });
          const details = erreurRedaction(error);
          emit(agent, 'error', place.id, { name: place.name, ...details });
          // Un site lent n'établit pas une panne générale du moteur. Le candidat reste
          // reprenable et les suivants continuent, dans le budget borné de cette exécution.
          const transient = details.code === 'redaction_timeout' && details.retryable === true;
          consecutiveErrors = transient ? 0 : consecutiveErrors + 1;
          if (['engine_missing', 'engine_auth_required', 'engine_start_failed', 'engine_exit_failed', 'engine_reported_error', 'tool_use_blocked'].includes(details.code) || consecutiveErrors >= 3) {
            writingBlocked = 'writing_blocked'; writingBlockedCode = details.code;
            emit('chef', 'writing:blocked', null, { reason: writingBlocked, code: details.code,
              message: 'La rédaction nécessite une intervention. Les résultats enregistrés et les mails manquants sont conservés.',
              tentatives_redaction: draftJobs, limite_redactions: maxDraftJobs });
          }
        }
      } finally {
        if (executing) activeWrites--; pendingWrites--;
        try { progress(); } finally { changed(); }
        // Même une longue file de candidats sautés doit laisser répondre l'API entre deux jobs.
        await new Promise((resolve) => setImmediate(resolve));
      }
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
      } finally { pendingReads--; try { progress(); } finally { changed(); } await new Promise((resolve) => setImmediate(resolve)); }
    }
  };
  const matcher = async () => { for (let place; (place = await matches.next()); ) { try { await match(place); } catch {} } };
  const supervise = (task) => task.catch((error) => { workerFailures.push(error); fatal = true; writingBlocked = 'workflow_failed'; writingBlockedCode = 'workflow_failed'; changed(); });
  const readerTasks = Array.from({ length: readersCount }, (_, i) => supervise(reader(i + 1)));
  const writerTasks = targets.objectif_mails ? [supervise(writer(1)), supervise(writer(2))] : [];
  const matchTasks = match ? [matcher(), matcher()] : [];
  let discovery = null;
  try {
    const remainingScan = Math.max(0, targets.limite_scan - counts.trouves);
    // A source can rediscover seeded ids within its own250-result budget. The
    // admission guard below applies the remaining budget to genuinely new ids.
    discovery = remainingScan && !stopDiscovery() ? await discover({ ...config.recherche, ...targets }, {
      shouldContinue: () => !stopDiscovery() && counts.trouves < targets.limite_scan,
      onLog: (texte) => emit('eclaireur', 'step', null, { texte }),
      onFound: async (place) => {
        if (place?.id == null) return true;
        place = { ...place, id: String(place.id) };
        while (!stopDiscovery() && (pendingReads >= readersCount * 2 || !writingBlocked && targets.objectif_mails && counts.ecrits + pendingWrites >= targets.objectif_mails && counts.ecrits < targets.objectif_mails)) await waitChange();
        if (stopDiscovery()) return false;
        if (seen.has(String(place.id)) || !allowed(place)) return true;
        if (counts.trouves >= targets.limite_scan) return false;
        seen.add(place.id); entries.set(place.id, { ...place, status: 'trouve' }); counts.trouves++;
        found(place); emit('eclaireur', 'found', place.id, place);
        if (match) matches.push(place);
        pendingReads++; reads.push(place);
        return true;
      },
    }) : { reason: stopDiscovery() ? 'objective_reached' : 'scan_limit', exhausted: false, queries: 0, rayon: config.recherche.rayon_m };
    if (discovery?.reason === 'source_error') { fatal = true; emit('eclaireur', 'error', null, { code: 'source_error', message: 'La source de commerces ne répond pas. Les résultats déjà obtenus sont conservés.' }); }
  } catch { fatal = true; emit('eclaireur', 'error', null, { code: 'source_error', message: 'La source de commerces ne répond pas. Les résultats déjà obtenus sont conservés.' }); }
  reads.close(); matches.close();
  const readResults = await Promise.allSettled(readerTasks);
  writes.close();
  const all = [...readResults, ...await Promise.allSettled(writerTasks), ...await Promise.allSettled(matchTasks)];
  if (workerFailures.length || all.some((result) => result.status === 'rejected')) { fatal = true; emit('chef', 'error', null, { code: 'workflow_failed', message: 'Une étape de traitement a été interrompue. Les résultats déjà enregistrés sont conservés.' }); }
  refresh();
  const objectiveReached = reached();
  const reason = workerFailures.length ? 'workflow_failed' : fatal ? 'source_error' : objectiveReached ? 'objective_reached' : writingBlocked
    ?? (counts.trouves >= targets.limite_scan ? 'scan_limit' : discovery?.reason) ?? 'radius_exhausted';
  const partial = !objectiveReached || fatal || reason === 'source_error';
  const result = { ...counts, ...targets, examines: counts.lus, objectif_atteint: objectiveReached,
    a_reprendre: Math.max(0, targets.objectif_mails - counts.ecrits), reason, exhausted: reason !== 'scan_limit' && discovery?.exhausted === true, writing_blocked: writingBlocked, writing_blocked_code: writingBlockedCode,
    tentatives_redaction: draftJobs, limite_redactions: maxDraftJobs, echecs_redaction: draftFailures,
    rayon: discovery?.rayon ?? config.recherche.rayon_m, queries: discovery?.queries ?? null,
    status: fatal && counts.lus === 0 ? 'erreur' : partial ? 'partiel' : 'fini', erreur: fatal && counts.lus === 0, partiel: partial };
  emit('eclaireur', 'done', null, { ...result, demandes: targets.objectif_contacts });
  return result;
}
