// Prépare les mails d'une mission déjà analysée, uniquement à partir de sa mémoire locale.
// Les dépendances sont injectées : les tests ne lancent aucun modèle et ne touchent pas la base utilisateur.
import { randomUUID } from 'node:crypto';
import { normaliserRedaction, validerBrouillon } from './agents/moteurs.mjs';

const ELIGIBLE = new Set(['analyse', 'retenu', 'a_ecrire', 'erreur']);
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const OBJECT = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));

export class DraftSessionError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}

function text(value, field, maximum) {
  if (typeof value !== 'string' || value.length > maximum || /\0/.test(value)) throw new DraftSessionError('invalid_fields', `Champ invalide : ${field} (${maximum} caractères au plus).`);
  return value.trim();
}

export function normaliserDemandeBrouillons(body, config = {}) {
  if (!OBJECT(body)) throw new DraftSessionError('invalid_request', 'Demande de rédaction invalide.');
  if (body.regenerate !== undefined && body.regenerate !== false) throw new DraftSessionError('regeneration_disabled', 'Les brouillons existants sont conservés.');
  if (body.offre !== undefined && !OBJECT(body.offre)) throw new DraftSessionError('invalid_fields', 'Offre invalide.');
  if (body.redaction !== undefined && !OBJECT(body.redaction)) throw new DraftSessionError('invalid_fields', 'Choix de rédaction invalide.');
  const offre = {};
  for (const key of ['ce_que_je_vends', 'pour_qui', 'signature', 'site']) offre[key] = text(body.offre?.[key] ?? config.offre?.[key] ?? '', key, 600);
  if (!offre.ce_que_je_vends || /^Décris ici, en une phrase/i.test(offre.ce_que_je_vends)) throw new DraftSessionError('offer_required', 'Renseignez votre offre avant de préparer les mails.');
  if (!offre.signature || /^(Ton prénom et ton nom|Votre nom|Prénom Nom)$/i.test(offre.signature)) throw new DraftSessionError('signature_required', 'Renseignez votre signature avant de préparer les mails.');
  if (offre.site) {
    try { if (!['https:', 'http:'].includes(new URL(offre.site).protocol)) throw new Error(); }
    catch { throw new DraftSessionError('invalid_site', 'Le site doit commencer par https:// ou http://.'); }
  }
  const supplied = { ...(config.redaction ?? {}), ...(body.redaction ?? {}) };
  if (!['claude', 'codex'].includes(supplied.moteur)) throw new DraftSessionError('engine_required', 'Choisissez Claude Code ou Codex pour préparer les mails.');
  const modele = text(supplied.modele ?? '', 'modele', 80);
  if (modele && !/^[\w.:-]+$/.test(modele)) throw new DraftSessionError('invalid_model', 'Nom de modèle invalide.');
  let normalised;
  try { normalised = normaliserRedaction({ moteur: supplied.moteur, modele, langue: supplied.langue ?? 'auto' }); }
  catch (error) { throw new DraftSessionError('invalid_redaction', error.message); }
  const redaction = { moteur: normalised.moteur, modele: normalised.modele, langue: normalised.langue };
  const consignes = text(body.consignes ?? config.consignes ?? '', 'consignes', 800);
  return { offre, consignes, redaction };
}

export function adresseBrouillon(place) {
  const possible = [place.to_email, ...(Array.isArray(place.emails) ? place.emails : [])];
  return possible.find((value) => typeof value === 'string' && EMAIL.test(value)) ?? null;
}

export function candidatBrouillon(place, scoreMinimum = 60) {
  return Boolean(place && ELIGIBLE.has(place.status) && !place.mail?.trim()
    && Number.isFinite(Number(place.score)) && Number(place.score) >= scoreMinimum && adresseBrouillon(place));
}

/** Reconstruit exactement les éléments enregistrés ; aucune nouvelle lecture de site ni nouveau score. */
export function lectureEnregistree(place) {
  const signals = OBJECT(place.signals) ? place.signals : {};
  const first = adresseBrouillon(place);
  const emails = [...new Set([first, ...(Array.isArray(place.emails) ? place.emails : [])].filter((value) => typeof value === 'string' && EMAIL.test(value)))];
  return {
    lecture: { ok: Boolean(signals.site), signals: { ...signals }, emails, email_source: place.email_source ?? null,
      telephones: Array.isArray(signals.telephones) ? [...signals.telephones] : [], excerpt: String(place.excerpt ?? '') },
    note: { score: Number(place.score), raisons: Array.isArray(signals.raisons) ? signals.raisons.map((reason) => ({ ...reason })) : [] },
  };
}

export function createDraftSessions({ getRun, listPlaces, getPlace, updatePlace, rediger, emit,
  loadConfig, saveConfig, isMissionRunning = () => false, isUpdating = () => false, now = () => Date.now() }) {
  const jobs = new Map(), completions = new Map();
  let active = null;
  const publicJob = (job) => job ? { ...job, errors: job.errors.map((error) => ({ ...error })) } : null;
  const getJob = (runId) => publicJob(jobs.get(runId));
  const isRunning = () => Boolean(active);

  function start(runId, body) {
    if (active || isMissionRunning()) throw new DraftSessionError('mission_active', 'Une mission ou une rédaction est déjà en cours.', 409);
    if (isUpdating()) throw new DraftSessionError('update_active', 'Une mise à jour est en cours.', 409);
    const run = getRun(runId);
    if (!run) throw new DraftSessionError('run_not_found', 'Mission inconnue.', 404);
    if (run.status === 'en_cours') throw new DraftSessionError('mission_active', 'Attendez la fin de la mission avant de préparer les mails.', 409);
    const config = loadConfig();
    const request = normaliserDemandeBrouillons(body, config);
    const threshold = Number.isFinite(Number(config.equipe?.score_minimum)) ? Number(config.equipe.score_minimum) : 60;
    const candidates = listPlaces(runId).filter((place) => candidatBrouillon(place, threshold));
    if (!candidates.length) throw new DraftSessionError('no_candidates', 'Aucun client potentiel sans brouillon ne peut être rédigé dans cette mission.', 409);
    // L'offre explicite de la personne devient celle du prochain lancement ; les autres réglages sont conservés.
    saveConfig({ ...config, offre: request.offre, consignes: request.consignes, redaction: request.redaction });
    const job = { id: randomUUID(), runId, status: 'running', completed: 0, total: candidates.length,
      failed: 0, skipped: 0, errors: [], startedAt: now(), endedAt: null };
    jobs.set(runId, job);
    active = job;
    let resolveDone;
    completions.set(job.id, new Promise((resolve) => { resolveDone = resolve; }));
    queueMicrotask(async () => {
      let index = 0;
      try {
        emit(runId, 'chef', 'drafts:start', null, { ...publicJob(job), batch: true });
        const worker = async (number) => {
          const agent = `redacteur-${number}`;
          for (;;) {
            const queued = candidates[index++];
            if (!queued) return;
            const place = getPlace(runId, queued.id);
            if (!candidatBrouillon(place, threshold)) { job.completed++; job.skipped++; continue; }
            const { lecture, note } = lectureEnregistree(place);
            updatePlace(runId, place.id, { status: 'ecriture' });
            emit(runId, agent, 'start', place.id, { name: place.name, batch: true });
            try {
              const result = await rediger(place, lecture, note, request.offre, request.consignes, request.redaction);
              const draft = validerBrouillon(result);
              const latest = getPlace(runId, place.id);
              // Un choix manuel ou un brouillon arrivé entre-temps ne peut être écrasé.
              if (!latest || ['valide', 'refuse'].includes(latest.status) || latest.mail?.trim()) {
                job.skipped++;
                emit(runId, agent, 'error', place.id, { name: place.name, message: 'Le brouillon existant a été conservé.', batch: true });
                continue;
              }
              updatePlace(runId, place.id, { status: 'en_attente', ...draft });
              emit(runId, agent, 'done', place.id, { name: place.name, ...draft, to: lecture.emails[0], duree_ms: result.duree_ms, batch: true });
            } catch (error) {
              const latest = getPlace(runId, place.id);
              if (latest && !['valide', 'refuse'].includes(latest.status) && !latest.mail?.trim()) updatePlace(runId, place.id, { status: 'erreur' });
              const message = String(error.message ?? 'La rédaction a échoué.').slice(0, 500);
              job.failed++;
              job.errors.push({ placeId: place.id, message });
              emit(runId, agent, 'error', place.id, { name: place.name, message, batch: true });
            } finally { job.completed++; }
          }
        };
        // Deux appels au plus ; aucune valeur de configuration ne peut élargir ce lot.
        const workers = await Promise.allSettled([worker(1), worker(2)]);
        const broken = workers.find((result) => result.status === 'rejected');
        if (broken) throw broken.reason;
        job.status = 'completed';
      } catch (error) {
        job.status = 'failed';
        job.failed++;
        job.errors.push({ placeId: null, message: String(error.message ?? 'La rédaction a été interrompue.').slice(0, 500) });
      } finally {
        job.endedAt = now();
        active = null;
        try { emit(runId, 'chef', 'drafts:end', null, { ...publicJob(job), batch: true }); }
        catch (error) {
          job.status = 'failed';
          job.failed++;
          job.errors.push({ placeId: null, message: String(error.message ?? 'Journal de rédaction indisponible.').slice(0, 500) });
        } finally { resolveDone(publicJob(job)); }
      }
    });
    return publicJob(job);
  }
  return { start, getJob, isRunning,
    waitForJob(runId) { const job = jobs.get(runId); return job ? completions.get(job.id) : Promise.resolve(null); } };
}
