// Une seule reprise automatique pour le délai local : jamais pour une sortie refusée ou un problème de connexion/configuration.
export class RedactionError extends Error {
  constructor(code, message, { retryable = false } = {}) { super(message); this.name = 'RedactionError'; this.code = code; this.retryable = retryable; }
}

export function erreurRedaction(error) {
  const code = error instanceof RedactionError ? error.code : 'redaction_failed';
  const action = code === 'redaction_timeout'
    ? 'Le commerce reste disponible dans Résultats. Reprenez uniquement les mails manquants ; les brouillons déjà écrits seront conservés.'
    : code === 'engine_missing' || code === 'engine_start_failed' || code === 'engine_exit_failed' || code === 'engine_reported_error'
      ? 'Vérifiez la connexion du CLI et le modèle choisi, puis reprenez les mails manquants dans Résultats.'
      : code === 'tool_use_blocked'
        ? 'Le garde-fou a bloqué une action du moteur. Aucun mail créé : changez de modèle ou vérifiez sa configuration avant une reprise manuelle.'
        : 'Aucun brouillon de remplacement n’a été inventé. Vérifiez le moteur et ses consignes avant de reprendre ce mail dans Résultats.';
  return { code, message: String(error?.message ?? 'La rédaction a échoué.').slice(0, 500), action,
    retryable: error instanceof RedactionError && error.retryable === true, attempts: error?.attempts ?? 1 };
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
