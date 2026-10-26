// Une seule reprise automatique pour le délai local : jamais pour une sortie refusée ou un problème de connexion/configuration.
export class RedactionError extends Error {
  constructor(code, message, { retryable = false, diagnostic } = {}) {
    super(message); this.name = 'RedactionError'; this.code = code; this.retryable = retryable;
    const safe = diagnosticRedaction(diagnostic); if (safe) this.diagnostic = safe;
  }
}

const TYPES_EVENEMENTS = new Set(['thread.started', 'turn.started', 'turn.completed', 'turn.failed', 'item.started', 'item.updated', 'item.completed', 'error', 'inconnu']);
// Liste fermée : jamais de message brut, identifiant de session, chemin, prompt ou extrait du moteur.
export function diagnosticRedaction(value) {
  if (!value || typeof value !== 'object') return undefined;
  const safe = {};
  for (const key of ['duree_ms', 'timeout_ms', 'stdout_octets', 'stderr_octets', 'premiere_activite_ms', 'derniere_activite_ms', 'silence_ms']) {
    if (value[key] === null) safe[key] = null;
    else if (Number.isFinite(value[key]) && value[key] >= 0) safe[key] = Math.min(1_000_000_000, Math.floor(value[key]));
  }
  if (['claude', 'codex'].includes(value.moteur)) safe.moteur = value.moteur;
  if (['aucune', 'stdout', 'stderr', 'stdout_stderr'].includes(value.activite)) safe.activite = value.activite;
  if (TYPES_EVENEMENTS.has(value.dernier_evenement)) safe.dernier_evenement = value.dernier_evenement;
  if (value.evenements && typeof value.evenements === 'object') {
    safe.evenements = {};
    for (const type of TYPES_EVENEMENTS) if (Number.isInteger(value.evenements[type]) && value.evenements[type] > 0) safe.evenements[type] = Math.min(100000, value.evenements[type]);
  }
  if (value.code_cli === 'auth_required') safe.code_cli = value.code_cli;
  if (Number.isInteger(value.exit_code) && value.exit_code >= 0 && value.exit_code < 256) safe.exit_code = value.exit_code;
  if (['SIGTERM', 'SIGKILL', 'SIGABRT', 'SIGSEGV', 'SIGPIPE', 'SIGHUP', 'SIGINT'].includes(value.signal)) safe.signal = value.signal;
  return Object.keys(safe).length ? safe : undefined;
}

export function erreurRedaction(error) {
  const code = error instanceof RedactionError ? error.code : 'redaction_failed';
  const action = code === 'engine_auth_required'
    ? 'Reconnectez votre abonnement dans le CLI sélectionné, puis reprenez les mails manquants. Une erreur de connexion ne déclenche aucun nouvel essai automatique.'
    : code === 'redaction_timeout'
    ? 'Le commerce reste disponible dans Résultats. Reprenez uniquement les mails manquants ; les brouillons déjà écrits seront conservés.'
    : code === 'engine_missing' || code === 'engine_start_failed' || code === 'engine_exit_failed' || code === 'engine_reported_error'
      ? 'Vérifiez la connexion du CLI et le modèle choisi, puis reprenez les mails manquants dans Résultats.'
      : code === 'tool_use_blocked'
        ? 'Le garde-fou a bloqué une action du moteur. Aucun mail créé : changez de modèle ou vérifiez sa configuration avant une reprise manuelle.'
        : 'Aucun brouillon de remplacement n’a été inventé. Vérifiez le moteur et ses consignes avant de reprendre ce mail dans Résultats.';
  const diagnostic = diagnosticRedaction(error?.diagnostic);
  return { code, message: String(error?.message ?? 'La rédaction a échoué.').slice(0, 500), action,
    retryable: error instanceof RedactionError && error.retryable === true, attempts: error?.attempts ?? 1,
    ...(diagnostic ? { diagnostic } : {}) };
}

export function signauxRedaction(signals, error = null) {
  const copy = { ...(signals ?? {}) };
  delete copy.redaction_error;
  if (error) copy.redaction_error = { ...erreurRedaction(error), at: Date.now() };
  return copy;
}

export async function avecRepriseRedaction(operation, { timeoutMs, onRetry = () => {} }, { wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const limit = attempt === 1 ? timeoutMs : Math.min(300000, timeoutMs * 2);
    try { return { ...await operation({ attempt, timeoutMs: limit }), attempts: attempt }; }
    catch (error) {
      error.attempts = attempt;
      // Seul notre propre watchdog est une défaillance transitoire établie. Pas de déduction depuis stderr.
      if (attempt === 2 || !(error instanceof RedactionError) || error.code !== 'redaction_timeout' || !error.retryable) throw error;
      await onRetry({ ...erreurRedaction(error), attempt, nextAttempt: 2, maxAttempts: 2, nextTimeoutMs: Math.min(300000, timeoutMs * 2) });
      await wait(1000);
    }
  }
}

export function bilanMission(counts, fatal = false) {
  const remaining = counts.erreurs_redaction ?? 0;
  return { status: fatal ? 'erreur' : remaining ? 'partiel' : 'fini', erreur: fatal, partiel: !fatal && remaining > 0, a_reprendre: remaining };
}
