export const hasDraft = place => Boolean(place.mail);
export const isLead = place => Boolean(place.to_email || place.emails?.length) && ['analyse', 'retenu', 'a_ecrire', 'ecriture', 'en_attente', 'valide', 'refuse', 'erreur'].includes(place.status);
export const missingDrafts = places => places.filter(place => isLead(place) && !hasDraft(place) && place.status !== 'refuse');
export function filterBusinesses(places, filter = 'all', query = '') {
  const needle = query.trim().toLocaleLowerCase();
  return places.filter(place => {
    if (filter === 'ready' && !hasDraft(place)) return false;
    if (filter === 'leads' && !isLead(place)) return false;
    if (filter === 'todo' && (!isLead(place) || ['valide', 'refuse'].includes(place.status))) return false;
    if (filter === 'done' && place.status !== 'valide') return false;
    return [place.name, place.address, place.website, place.phone].some(value => String(value ?? '').toLocaleLowerCase().includes(needle));
  });
}
