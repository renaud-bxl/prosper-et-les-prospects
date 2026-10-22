// L'éclaireur : trouve les commerces d'un métier dans une ville, avec l'API officielle Google Places (New).
import { GOOGLE_KEY } from '../env.mjs';
import { countryAt } from '../benelux.mjs';

const FIELDS = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.location', 'places.rating',
  'places.userRatingCount', 'places.websiteUri', 'places.nationalPhoneNumber', 'places.primaryTypeDisplayName',
  'places.googleMapsUri', 'places.businessStatus', 'nextPageToken',
].join(',');

// Les chaînes ne sont pas des clients pour un indépendant : on les écarte d'office.
export const CHAINES = /mcdonald|burger king|kfc|starbucks|subway|domino|pizza hut|five guys|o'?tacos|flunch|buffalo grill|hippopotamus|courtepaille|big fernand|del arte|la pataterie|léon de bruxelles|leon de bruxelles|bagelstein|prêt à manger|pret a manger|columbus|sushi shop|planet sushi|class'croute|boulangerie paul|brioche dorée|brioche doree|memphis coffee|popeyes|tim hortons|cojean|exki|pitaya|bistro régent|bistro regent|au bureau|poivre rouge|l'atelier du burger|basic[- ]?fit|fitness park|l'appart fitness|on air\b|keep ?cool|neoness|wellness sport club|cmg sports? club|magic form|orange bleue|gigafit|vita liberté|vita liberte|episod|club med gym|amazonia|liberty gym|moving\b|jims\b|let'?s go fitness|passage fitness|activ fitness|update fitness|kieser|john reed|mcfit|clever ?fit|injoy|fitnesspark|silhouette fitness/i;

async function searchPage(body) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE_KEY, 'X-Goog-FieldMask': FIELDS },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Places ${res.status} : ${data?.error?.status ?? ''} ${data?.error?.message ?? ''}`.trim());
  return data;
}

const distance = (a, b) => {
  const rad = Math.PI / 180, dlat = (b.lat - a.lat) * rad, dlon = (b.lon - a.lon) * rad;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dlon / 2) ** 2;
  return 12742000 * Math.asin(Math.min(1, Math.sqrt(h)));
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Up to six bounded search areas, each with at most three Google result pages. */
export async function eclairer(
  { metier, ville, centre, rayon_m = 2500, limite_scan = 250, rayon_max_m = 20000, pays, langue = 'fr' },
  { onFound, onLog, exclure = CHAINES, shouldContinue = () => true, request = searchPage, wait = delay } = {},
) {
  const kept = [], ids = new Set(), names = new Map(), deferred = new Map();
  const cap = Math.min(250, Math.max(1, Math.floor(Number(limite_scan) || 250)));
  const maxRadius = Math.min(20000, Math.max(100, Number(rayon_max_m) || 20000));
  const initial = Math.min(maxRadius, Math.max(100, Number(rayon_m) || 2500));
  let rayon = initial, queries = 0, reason = 'radius_exhausted', sourceError = null;
  const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const excluded = name => { if (!exclure) return false; exclure.lastIndex = 0; return exclure.test(name); };
  const finish = () => Object.assign(kept, { rayon, queries, scanned: kept.length, exhausted: reason === 'radius_exhausted', reason, ...(sourceError ? { error: sourceError } : {}) });
  const emit = async place => {
    if (!await shouldContinue()) { reason = 'objective_reached'; return false; }
    if (kept.length >= cap) { reason = 'scan_limit'; return false; }
    const key = normalize(place.name);
    if (ids.has(place.id) || (names.get(key) ?? []).some(p => distance(p, place) < 80)) return true;
    ids.add(place.id); names.set(key, [...(names.get(key) ?? []), place]); kept.push(place);
    if (await onFound?.(place) === false || !await shouldContinue()) { reason = 'objective_reached'; return false; }
    if (kept.length >= cap) { reason = 'scan_limit'; return false; }
    return true;
  };
  try {
    if (!centre || !Number.isFinite(centre.lat) || !Number.isFinite(centre.lon)) throw new Error('Centre de recherche invalide.');
    for (let pass = 0; pass < 6; pass++) {
      if (!await shouldContinue()) { reason = 'objective_reached'; return finish(); }
      rayon = pass === 5 ? maxRadius : Math.min(maxRadius, Math.round(initial * 1.65 ** pass));
      // Shift the bias over the permitted area; a repeated city-wide query only returns the same first60.
      const angle = pass * 2.399963229728653, offset = pass ? rayon * .45 : 0;
      const biasCentre = { latitude: centre.lat + Math.sin(angle) * offset / 111320, longitude: centre.lon + Math.cos(angle) * offset / (111320 * Math.cos(centre.lat * Math.PI / 180)) };
      const body = {
        textQuery: pass ? metier : `${metier} ${ville}`, languageCode: ['fr','nl','en'].includes(langue) ? langue : 'fr', regionCode: pays ?? countryAt(centre.lat, centre.lon) ?? 'BE', pageSize: 20,
        locationBias: { circle: { center: biasCentre, radius: pass ? rayon * .7 : rayon } },
      };
      let pageToken;
      for (let page = 1; page <= 3; page++) {
        if (!await shouldContinue()) { reason = 'objective_reached'; return finish(); }
        onLog?.(`Recherche « ${body.textQuery} » sur Google Maps, zone ${pass + 1}, page ${page}`);
        queries++;
        const data = await request(pageToken ? { ...body, pageToken } : body);
        for (const p of data.places ?? []) {
          const name = p.displayName?.text ?? '', lat = p.location?.latitude, lon = p.location?.longitude;
          if (!p.id || !name || !Number.isFinite(lat) || !Number.isFinite(lon) || !countryAt(lat, lon)) continue;
          if (distance(centre, { lat, lon }) > rayon || (p.businessStatus && p.businessStatus !== 'OPERATIONAL') || excluded(name)) continue;
          const place = { id: p.id, name, address: p.formattedAddress ?? '', lat, lon, rating: p.rating ?? null, reviews: p.userRatingCount ?? 0,
            website: p.websiteUri ?? null, phone: p.nationalPhoneNumber ?? null, type: p.primaryTypeDisplayName?.text ?? metier, maps_uri: p.googleMapsUri ?? null };
          if (!place.website) { deferred.set(place.id, place); continue; }
          deferred.delete(place.id);
          if (!await emit(place)) return finish();
        }
        pageToken = data.nextPageToken;
        if (!pageToken || page === 3) break;
        if (!await shouldContinue()) { reason = 'objective_reached'; return finish(); }
        await wait(1500);
      }
    }
    for (const place of deferred.values()) if (!await emit(place)) break;
    if (reason === 'radius_exhausted' && !await shouldContinue()) reason = 'objective_reached';
  } catch (error) {
    reason = 'source_error'; sourceError = error.message ?? String(error); onLog?.(sourceError);
  }
  return finish();
}

/** Trouve le centre d'une ville (pour une mission ailleurs qu'à Lyon). */
export async function localiser(ville) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE_KEY, 'X-Goog-FieldMask': 'places.location' },
    body: JSON.stringify({ textQuery: ville, languageCode: 'fr', pageSize: 1 }),
    signal: AbortSignal.timeout(10000),
  });
  const loc = (await res.json()).places?.[0]?.location;
  if (!loc) throw new Error(`Ville introuvable : ${ville}`);
  return { lat: loc.latitude, lon: loc.longitude };
}

