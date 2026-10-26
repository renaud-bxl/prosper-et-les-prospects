// Les objectifs proviennent de l'historique de la mission, jamais de la configuration actuelle.
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
export function adressesContact(place) {
  return [...new Set([place.to_email, ...(Array.isArray(place.emails) ? place.emails : [])]
    .filter((value) => typeof value === 'string' && EMAIL.test(value)).map((value) => value.trim().toLowerCase()))];
}

export function resumerEvenements(first = {}, last = {}) {
  const summary = {};
  for (const key of ['trouves','lus','retenus','ecrits','ecartes','erreurs_redaction','examines','a_reprendre','objectif_atteint','reason','exhausted','queries','status','erreur','partiel','writing_blocked','writing_blocked_code','tentatives_redaction','limite_redactions','echecs_redaction']) summary[key] = last[key] ?? null;
  for (const key of ['objectif_contacts','objectif_mails','limite_scan','rayon_max_m','score_minimum']) summary[key] = last[key] ?? first[key] ?? null;
  summary.rayon = last.rayon ?? first.rayon ?? null;
  return summary;
}

export function contactsUniques(rows, minimum = 60) {
  const claimed = new Set(), contacts = [];
  // Les brouillons existants gardent leur destinataire ; ils réservent leur adresse en premier.
  const ordered = [...rows.filter((row) => row.mail?.trim()), ...rows.filter((row) => !row.mail?.trim())];
  for (const row of ordered) {
    if (['refuse', 'ecarte'].includes(row.status) || !Number.isFinite(Number(row.score)) || Number(row.score) < minimum) continue;
    const addresses = adressesContact(row);
    const address = row.mail?.trim() ? addresses[0] : addresses.find((email) => !claimed.has(email));
    if (!address || claimed.has(address)) continue;
    claimed.add(address); contacts.push({ ...row, to_email: address });
  }
  return contacts;
}

export function bilanReprise(rows, previous = {}, { minimum = 60, objectifMails = null, failed = false } = {}) {
  const contacts = contactsUniques(rows, minimum);
  const ecrits = contacts.filter((row) => row.mail?.trim()).length;
  const knownContacts = Number.isFinite(previous.objectif_contacts) ? previous.objectif_contacts : null;
  const knownMails = Number.isFinite(objectifMails) ? objectifMails : Number.isFinite(previous.objectif_mails) ? previous.objectif_mails : null;
  const pending = contacts.filter((row) => !row.mail?.trim()).length;
  const targetKnown = knownContacts !== null && knownMails !== null;
  const reached = targetKnown ? contacts.length >= knownContacts && ecrits >= knownMails : null;
  const partial = failed || (targetKnown ? !reached : pending > 0 || ['source_error','workflow_failed'].includes(previous.reason));
  const hasResults = rows.some((row) => row.score != null || row.mail?.trim());
  const status = failed && !hasResults ? 'erreur' : partial ? 'partiel' : 'fini';
  return { ...previous, objectif_contacts: knownContacts, objectif_mails: knownMails,
    trouves: rows.length, lus: rows.filter((row) => row.score != null).length, examines: rows.filter((row) => row.score != null).length,
    retenus: contacts.length, ecrits, ecartes: rows.filter((row) => ['ecarte','refuse'].includes(row.status)).length,
    erreurs_redaction: contacts.filter((row) => row.status === 'erreur' && !row.mail?.trim()).length,
    a_reprendre: knownMails === null ? pending : Math.max(0, knownMails - ecrits), objectif_atteint: reached,
    status, erreur: status === 'erreur', partiel: status === 'partiel',
    reason: failed ? 'workflow_failed' : reached ? 'objective_reached' : previous.reason ?? (partial ? 'writing_blocked' : null),
    writing_blocked: status === 'fini' ? null : previous.writing_blocked ?? null,
    writing_blocked_code: status === 'fini' ? null : previous.writing_blocked_code ?? null };
}
