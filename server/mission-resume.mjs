/** Reprendre uniquement une mission dont les objectifs ont été enregistrés. */
export function peutReprendre(run, summary, running = false) {
  return !running && Boolean(run) && ['en_cours','partiel','erreur'].includes(run.status)
    && Number.isFinite(summary?.objectif_contacts) && summary.objectif_contacts > 0
    && Number.isFinite(summary?.objectif_mails) && summary.objectif_mails >= 0
    && summary.objectif_atteint !== true;
}
export function configReprise(run, summary, current) {
  if (!peutReprendre(run, summary)) throw Object.assign(new Error('Cette mission ne dispose pas d’objectifs enregistrés permettant une reprise.'), {code:'resume_unavailable'});
  if (!Number.isFinite(run.lat) || !Number.isFinite(run.lon)) throw Object.assign(new Error('Le centre de la mission est manquant.'), {code:'resume_unavailable'});
  const config=structuredClone(current);
  config.recherche={...config.recherche,metier:run.metier,ville:run.ville,centre:{lat:run.lat,lon:run.lon},pays:run.pays,
    nombre:summary.objectif_contacts,objectif_mails:summary.objectif_mails || null,rayon_m:run.rayon??summary.rayon??2000};
  config.equipe={...config.equipe,score_minimum:summary.score_minimum??config.equipe?.score_minimum??60};
  if(summary.objectif_mails===0)config.redaction={...config.redaction,moteur:'aucun'};
  return config;
}
