// L'éclaireur : trouve les commerces d'un métier dans une ville, avec l'API officielle Google Places (New).
import { GOOGLE_KEY } from '../env.mjs';

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

/**
 * Cherche jusqu'à `nombre` commerces (60 au plus : trois pages de 20, la limite de Google).
 * `onFound(place)` est appelé pour chaque commerce retenu, `onLog(texte)` pour raconter la recherche.
 */
export async function eclairer({ metier, ville, centre, rayon_m, nombre, pays }, { onFound, onLog }) {
  const body = {
    textQuery: `${metier} ${ville}`,
    languageCode: 'fr',
    regionCode: pays ?? 'FR',
    pageSize: 20,
    ...(centre ? { locationBias: { circle: { center: { latitude: centre.lat, longitude: centre.lon }, radius: rayon_m ?? 3000 } } } : {}),
  };
  const kept = [];
  let pageToken;
  for (let page = 1; page <= 3 && kept.length < nombre; page++) {
    onLog?.(`Recherche « ${body.textQuery} » sur Google Maps, page ${page}`);
    const data = await searchPage(pageToken ? { ...body, pageToken } : body);
    for (const p of data.places ?? []) {
      if (kept.length >= nombre) break;
      const name = p.displayName?.text ?? '';
      if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') continue;
      if (CHAINES.test(name)) { onLog?.(`${name} : une chaîne, je passe`); continue; }
      const place = {
        id: p.id,
        name,
        address: p.formattedAddress ?? '',
        lat: p.location?.latitude,
        lon: p.location?.longitude,
        rating: p.rating ?? null,
        reviews: p.userRatingCount ?? 0,
        website: p.websiteUri ?? null,
        phone: p.nationalPhoneNumber ?? null,
        type: p.primaryTypeDisplayName?.text ?? metier,
        maps_uri: p.googleMapsUri ?? null,
      };
      kept.push(place);
      await onFound?.(place);
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
    // Google demande un court délai avant que le jeton de page suivante soit valable.
    await new Promise((r) => setTimeout(r, 1500));
  }
  return kept;
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

