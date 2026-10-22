// Le lien avec Google Maps. Règle européenne (depuis le 8 juillet 2025) : à côté de notre carte, on n'utilise de l'API
// Places que la position (latitude, longitude) et l'identifiant du lieu ; la fiche elle-même est affichée par le
// composant officiel de Google (Places UI Kit) dans le navigateur, qui a le droit d'être posé à côté de n'importe quelle carte.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, GOOGLE_KEY } from '../env.mjs';

async function places(path, { body, fields }) {
  if (!GOOGLE_KEY) throw new Error('Pas de clé Google (GOOGLE_MAPS_API_KEY dans .env).');
  const res = await fetch(`https://places.googleapis.com/v1/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE_KEY, 'X-Goog-FieldMask': fields },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google ${res.status} : ${data?.error?.status ?? ''}`.trim());
  return data;
}

/**
 * Retrouve la fiche Google d'un commerce trouvé sur OpenStreetMap : son nom, cherché dans un carré de 500 m
 * autour de sa position. On ne demande que l'identifiant (la recherche la moins chère, sans contenu Google).
 */
export async function ficheGoogle(place) {
  if (!place?.name || place.lat == null) return null;
  const d = 0.0025;
  const data = await places('places:searchText', {
    fields: 'places.id',
    body: {
      textQuery: place.name,
      languageCode: 'fr',
      pageSize: 1,
      locationRestriction: { rectangle: { low: { latitude: place.lat - d, longitude: place.lon - d }, high: { latitude: place.lat + d, longitude: place.lon + d } } },
    },
  });
  return data.places?.[0]?.id ?? null;
}

/** La position d'un lieu choisi dans la recherche Google (une ville). */
export async function positionDuLieu(placeId) {
  if (!/^[\w-]{10,}$/.test(placeId)) throw new Error('Identifiant de lieu invalide.');
  const d = await places(`places/${placeId}`, { fields: 'location,viewport' });
  if (!d.location) throw new Error('Lieu sans position.');
  return { lat: d.location.latitude, lon: d.location.longitude };
}

/* ---------- le nom de la ville, pris dans les données libres (OpenStreetMap, puis GeoNames) */
let villes = null;
function villeProche(lat, lon) {
  villes ??= JSON.parse(readFileSync(join(ROOT, 'web', 'public', 'carte', 'villes.json'), 'utf8'));
  let best = null, bestD = Infinity;
  const k = Math.cos((lat * Math.PI) / 180);
  for (const v of villes.villes) {
    const dd = (v[1] - lat) ** 2 + ((v[2] - lon) * k) ** 2;
    if (dd < bestD) { bestD = dd; best = v; }
  }
  return best && Math.sqrt(bestD) * 111 < 12 ? { nom: best[0], pays: best[4] } : null;
}

export async function nomDuLieu(lat, lon) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=fr&lat=${lat}&lon=${lon}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'agents-clients/0.1 (outil local)' }, signal: AbortSignal.timeout(4000) });
    const a = (await res.json()).address ?? {};
    const nom = a.city ?? a.town ?? a.village ?? a.municipality ?? a.city_district;
    if (nom) return { nom, pays: (a.country_code ?? '').toUpperCase() || null };
  } catch {}
  return villeProche(lat, lon) ?? { nom: 'ce lieu', pays: null };
}

