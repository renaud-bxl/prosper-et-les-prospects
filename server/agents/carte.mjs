// L'éclaireur version OpenStreetMap : la carte libre, utilisable avec n'importe quelle carte et sans clé.
// Les commerces viennent de l'API Overpass ; le métier est traduit en étiquettes OSM.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { ROOT } from '../env.mjs';
import { countryAt } from '../benelux.mjs';

const ENDPOINTS = [
  'https://overpass.openstreetmap.fr/api/interpreter', // OpenStreetMap France : le plus rapide pour une ville française
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// Métier (en français) → sélecteurs OpenStreetMap.
const METIERS = [
  [/salle de sport|fitness|musculation|gym|crossfit/i, ['nwr["leisure"="fitness_centre"]', 'nwr["leisure"="sports_centre"]["sport"~"fitness|crossfit|boxing|pilates"]']],
  [/yoga|pilates/i, ['nwr["sport"~"yoga|pilates"]', 'nwr["leisure"="fitness_centre"]["name"~"yoga|pilates",i]']],
  [/restaurant/i, ['nwr["amenity"="restaurant"]']],
  [/bar\b/i, ['nwr["amenity"="bar"]', 'nwr["amenity"="pub"]']],
  [/caf[ée]/i, ['nwr["amenity"="cafe"]']],
  [/coiff/i, ['nwr["shop"="hairdresser"]']],
  [/barbier/i, ['nwr["shop"="hairdresser"]["hairdresser"~"barber"]', 'nwr["shop"="barber"]']],
  [/beaut|esth[ée]ti/i, ['nwr["shop"="beauty"]']],
  [/boulang/i, ['nwr["shop"="bakery"]']],
  [/fleur/i, ['nwr["shop"="florist"]']],
  [/optic/i, ['nwr["shop"="optician"]']],
  [/garage|m[ée]cani/i, ['nwr["shop"="car_repair"]']],
  [/auto[- ]?[ée]cole/i, ['nwr["amenity"="driving_school"]']],
  [/dentist/i, ['nwr["amenity"="dentist"]', 'nwr["healthcare"="dentist"]']],
  [/kin[ée]|physio/i, ['nwr["healthcare"="physiotherapist"]']],
  [/immobili/i, ['nwr["office"="estate_agent"]', 'nwr["shop"="estate_agent"]']],
  [/avocat/i, ['nwr["office"="lawyer"]']],
  [/h[ôo]tel/i, ['nwr["tourism"="hotel"]']],
  [/plomb/i, ['nwr["craft"="plumber"]']],
  [/[ée]lectric/i, ['nwr["craft"="electrician"]']],
  [/v[ée]t[ée]rinaire/i, ['nwr["amenity"="veterinary"]']],
  [/pharmac/i, ['nwr["amenity"="pharmacy"]']],
];

function selecteurs(metier) {
  for (const [re, sel] of METIERS) if (re.test(metier)) return sel;
  // Métier inconnu : on cherche le mot dans le nom des commerces.
  const mot = metier.replace(/["\\]/g, '').trim();
  return [`nwr["name"~"${mot}",i]["shop"]`, `nwr["name"~"${mot}",i]["amenity"]`, `nwr["name"~"${mot}",i]["craft"]`];
}

// Les réponses sont gardées 7 jours (data/overpass) : la carte publique est parfois lente, la deuxième session part tout de suite.
export async function overpass(query) {
  const key = createHash('sha1').update(query).digest('hex').slice(0, 16);
  const file = join(ROOT, 'data', 'overpass', `${key}.json`);
  if (existsSync(file) && Date.now() - statSync(file).mtimeMs < 7 * 24 * 3600 * 1000) return JSON.parse(readFileSync(file, 'utf8'));
  const data = await overpassLive(query);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data));
  return data;
}

// Les trois serveurs publics sont interrogés en même temps : le premier qui répond gagne.
async function overpassLive(query) {
  const ctrl = new AbortController();
  const ask = async (url) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'agents-clients/0.1 (outil local)' },
      body: 'data=' + encodeURIComponent(query),
      signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(90000)]),
    });
    if (!res.ok) throw new Error(`Overpass ${res.status}`);
    const data = await res.json();
    if (data.remark && !data.elements?.length) throw new Error(data.remark);
    return data;
  };
  try {
    const data = await Promise.any(ENDPOINTS.map(ask));
    ctrl.abort();
    return data;
  } catch (e) {
    throw new Error(`La carte (Overpass) ne répond pas : ${e.errors?.map((x) => x.message).join(', ') ?? e.message}`);
  }
}

const distance = (a, b) => {
  const R = 6371000, d2r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * d2r, dLon = (b.lon - a.lon) * d2r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * d2r) * Math.cos(b.lat * d2r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/**
 * Cherche les commerces autour du centre de la ville, du plus proche au plus loin.
 * `onFound(place)` pour chaque commerce retenu, `onLog(texte)` pour raconter la recherche.
 */
export async function eclairerOSM(
  { metier, ville, centre, rayon_m = 2500, limite_scan = 250, rayon_max_m = 20000 },
  { onFound, onLog, exclure, shouldContinue = () => true, request = overpass } = {},
) {
  const cap = Math.min(250, Math.max(1, Math.floor(Number(limite_scan) || 250)));
  const maxRadius = Math.min(20000, Math.max(100, Number(rayon_max_m) || 20000));
  const initial = Math.min(maxRadius, Math.max(100, Number(rayon_m) || 2500));
  const sel = selecteurs(metier), kept = [], ids = new Set(), names = new Map(), deferred = new Map();
  let rayon = initial, queries = 0, reason = 'radius_exhausted', sourceError = null;
  const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const excluded = value => { if (!exclure) return false; exclure.lastIndex = 0; return exclure.test(value); };
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
      const next = pass === 5 ? maxRadius : Math.min(maxRadius, Math.round(initial * 1.65 ** pass));
      if (pass && next <= rayon) break;
      rayon = next;
      onLog?.(`Je fouille la carte de ${ville} : ${metier} — rayon ${(rayon / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km`);
      const around = `(around:${Math.round(rayon)},${centre.lat},${centre.lon})`;
      queries++;
      const data = await request(`[out:json][timeout:50];(${sel.map(s => s + around + ';').join('')});out tags center;`);
      // Overpass can return a partial result with a timeout remark: never call that exhaustion.
      if (data.remark) throw new Error(String(data.remark));
      const candidates = [];
      for (const e of data.elements ?? []) {
        const t = e.tags ?? {}, lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
        if (!t.name || !Number.isFinite(lat) || !Number.isFinite(lon) || !countryAt(lat, lon)) continue;
        if (distance(centre, { lat, lon }) > rayon || excluded(t.name) || excluded(t.brand ?? '') || t['brand:wikidata']) continue;
        candidates.push({
          id: `osm-${e.type}-${e.id}`, name: t.name,
          address: [t['addr:housenumber'], t['addr:street'], t['addr:postcode'], t['addr:city'] ?? ville].filter(Boolean).join(' '),
          lat, lon, rating: null, reviews: null, website: t.website ?? t['contact:website'] ?? t.url ?? null,
          phone: t.phone ?? t['contact:phone'] ?? null, email_osm: t.email ?? t['contact:email'] ?? null,
          horaires: t.opening_hours ?? null, type: metier, maps_uri: `https://www.openstreetmap.org/${e.type}/${e.id}`,
        });
      }
      candidates.sort((a, b) => distance(centre, a) - distance(centre, b));
      for (const p of candidates) {
        if (!p.website) { deferred.set(p.id, p); continue; }
        deferred.delete(p.id);
        if (!await emit(p)) return finish();
      }
      if (rayon >= maxRadius) break;
    }
    // Prefer reading genuine sites across the whole allowed area before no-site results.
    for (const p of [...deferred.values()].sort((a, b) => distance(centre, a) - distance(centre, b))) if (!await emit(p)) break;
    if (reason === 'radius_exhausted' && !await shouldContinue()) reason = 'objective_reached';
  } catch (error) {
    reason = 'source_error'; sourceError = error.message ?? String(error); onLog?.(sourceError);
  }
  return finish();
}

/**
 * La ville du QG des agents : chaque immeuble (son contour, sa hauteur) et chaque arbre d'OpenStreetMap, dans un carré
 * de 2 × r mètres autour du centre. Les tuiles vectorielles fusionnent les immeubles d'un même pâté de maisons : ici, on
 * les a un par un, comme dans la vraie rue. Format compact : contours en [lon, lat, lon, lat…] arrondis au dix-millionième.
 */
export async function villeOSM(centre, r) {
  const dLat = r / 110540, dLon = r / (Math.cos((centre.lat * Math.PI) / 180) * 111320);
  const bbox = [centre.lat - dLat, centre.lon - dLon, centre.lat + dLat, centre.lon + dLon].map((v) => v.toFixed(4)).join(',');
  const [bat, arb] = await Promise.all([
    overpass(`[out:json][timeout:180][bbox:${bbox}];(way["building"];relation["building"]["type"="multipolygon"];);out tags geom qt;`),
    overpass(`[out:json][timeout:120][bbox:${bbox}];node["natural"="tree"];out qt;`),
  ]);
  const flat = (geom) => geom.flatMap((p) => [Math.round(p.lon * 1e7) / 1e7, Math.round(p.lat * 1e7) / 1e7]);
  const hauteur = (t) => {
    const h = parseFloat(String(t.height ?? '').replace(',', '.'));
    if (Number.isFinite(h) && h > 0) return Math.min(h, 200);
    const n = parseFloat(t['building:levels']);
    if (Number.isFinite(n) && n > 0) return Math.min(n * 3.2 + (parseFloat(t['roof:levels']) || 0) * 2 + 1.5, 200);
    return 0;
  };
  const batiments = [];
  for (const e of bat.elements ?? []) {
    const t = e.tags ?? {};
    if (t.building === 'roof' || t.location === 'underground') continue;
    let rings = [];
    if (e.type === 'way' && e.geometry?.length > 3) rings = [flat(e.geometry)];
    if (e.type === 'relation') {
      const outer = assemble((e.members ?? []).filter((m) => m.role !== 'inner' && m.geometry).map((m) => m.geometry));
      const inner = assemble((e.members ?? []).filter((m) => m.role === 'inner' && m.geometry).map((m) => m.geometry));
      // un immeuble par contour extérieur, avec les cours intérieures qu'il contient
      outer.forEach((o, k) => {
        const holes = inner.filter((h) => inGeom(h[0], o));
        batiments.push({ id: `r${e.id}-${k}`, h: hauteur(t), c: t['building:colour'] ?? null, rc: t['roof:colour'] ?? null, k: t.building, rings: [flat(o), ...holes.map(flat)] });
      });
      continue;
    }
    if (!rings.length) continue;
    batiments.push({ id: `w${e.id}`, h: hauteur(t), c: t['building:colour'] ?? null, rc: t['roof:colour'] ?? null, k: t.building, rings });
  }
  const arbres = (arb.elements ?? []).map((e) => [Math.round(e.lon * 1e7) / 1e7, Math.round(e.lat * 1e7) / 1e7]);
  return { batiments, arbres };
}

function inGeom(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.lat > p.lat) !== (b.lat > p.lat) && p.lon < ((b.lon - a.lon) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lon) inside = !inside;
  }
  return inside;
}

/** Recolle des chemins ouverts en anneaux fermés (les contours d'une relation sont parfois en plusieurs morceaux). */
function assemble(ways) {
  const same = (a, b) => Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lon - b.lon) < 1e-7;
  const rings = [];
  const open = ways.map((w) => [...w]).filter((w) => w.length > 1);
  while (open.length) {
    let ring = open.shift();
    let grew = true;
    while (!same(ring[0], ring.at(-1)) && grew) {
      grew = false;
      for (let i = 0; i < open.length; i++) {
        const w = open[i];
        if (same(ring.at(-1), w[0])) ring = ring.concat(w.slice(1));
        else if (same(ring.at(-1), w.at(-1))) ring = ring.concat([...w].reverse().slice(1));
        else if (same(ring[0], w.at(-1))) ring = w.concat(ring.slice(1));
        else if (same(ring[0], w[0])) ring = [...w].reverse().concat(ring.slice(1));
        else continue;
        open.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (ring.length > 3) rings.push(ring);
  }
  return rings;
}

