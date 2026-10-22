// Prépare les données de la carte de mission (à lancer une fois) :
// - web/public/carte/pays.json : les contours de la Belgique, des Pays-Bas, du Luxembourg et de leurs voisins
//   (Natural Earth 1:10 m, domaine public, via le paquet world-atlas) ;
// - web/public/carte/villes.json : les villes de plus de 5 000 habitants des trois pays (GeoNames, CC BY 4.0).
// GeoNames : télécharger et décompresser cities5000.zip, plus admin1CodesASCII.txt dans data/geonames.
// Source officielle : https://download.geonames.org/export/dump/ ; autre dossier : --geonames=/chemin/du/dossier
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { feature } from 'topojson-client';
import { ROOT } from '../server/env.mjs';

const OUT = join(ROOT, 'web', 'public', 'carte');
const inputArg = process.argv.find((a) => a.startsWith('--geonames='));
const INPUT = inputArg ? resolve(inputArg.slice('--geonames='.length)) : join(ROOT, 'data', 'geonames');
mkdirSync(OUT, { recursive: true });

/* ---------- les pays */
export const PAYS = { BE: 'Belgique', NL: 'Pays-Bas', LU: 'Luxembourg' };
const NUM = {
  250: 'FR', '056': 'BE', 756: 'CH',
  442: 'LU', 276: 'DE', 528: 'NL', 380: 'IT', 724: 'ES', '020': 'AD', 492: 'MC', 438: 'LI', '040': 'AT', 826: 'GB', 620: 'PT', 203: 'CZ', 208: 'DK', 705: 'SI', 191: 'HR',
};
const BOX = { w: -3, e: 12, s: 47, n: 56 };
const topo = JSON.parse(readFileSync(join(ROOT, 'node_modules', 'world-atlas', 'countries-10m.json'), 'utf8'));
const geo = feature(topo, topo.objects.countries);

// Un point tous les ~800 m suffit à la carte ; les îles minuscules sont oubliées.
const simplify = (ring) => {
  const out = [];
  for (const [x, y] of ring) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(x - last[0], y - last[1]) > 0.008) out.push([+x.toFixed(3), +y.toFixed(3)]);
  }
  return out.length >= 4 ? out : null;
};
const inBox = (ring) => ring.some(([x, y]) => x > BOX.w && x < BOX.e && y > BOX.s && y < BOX.n);
const area = (ring) => Math.abs(ring.reduce((a, [x, y], i) => { const [x2, y2] = ring[(i + 1) % ring.length]; return a + x * y2 - x2 * y; }, 0) / 2);

const pays = [];
for (const f of geo.features) {
  const cc = NUM[f.id];
  if (!cc) continue;
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const rings = [];
  for (const poly of polys) {
    const outer = poly[0];
    if (!inBox(outer) || area(outer) < 0.004) continue; // hors cadre (outre-mer) ou îlot
    const r = simplify(outer);
    if (r) rings.push(r);
  }
  if (rings.length) pays.push({ cc, nom: PAYS[cc] ?? null, rings });
}
writeFileSync(join(OUT, 'pays.json'), JSON.stringify({ box: BOX, source: { nom: 'Natural Earth', licence: 'Domaine public', url: 'https://www.naturalearthdata.com/' }, pays }));
console.log('pays :', pays.map((p) => `${p.cc} (${p.rings.reduce((a, r) => a + r.length, 0)} points)`).join(', '));

/* ---------- les villes */
// Les noms en français (GeoNames garde souvent le nom local ou anglais).
const FR_NOMS = {
  Brussels: 'Bruxelles', Antwerp: 'Anvers', Gent: 'Gand', Brugge: 'Bruges', Leuven: 'Louvain', Mechelen: 'Malines', Aalst: 'Alost',
  Kortrijk: 'Courtrai', Ostend: 'Ostende', 'Sint-Niklaas': 'Saint-Nicolas', Roeselare: 'Roulers', Ieper: 'Ypres', Tongeren: 'Tongres',
  Vilvoorde: 'Vilvorde', Dendermonde: 'Termonde', Ronse: 'Renaix', Halle: 'Hal', Geneva: 'Genève', Basel: 'Bâle', Bern: 'Berne',
  'The Hague': 'La Haye', Groningen: 'Groningue', Nijmegen: 'Nimègue', "'s-Hertogenbosch": 'Bois-le-Duc',
  Luzern: 'Lucerne', 'Sankt Gallen': 'Saint-Gall', Schaffhausen: 'Schaffhouse', Biel: 'Bienne', 'Biel/Bienne': 'Bienne', Solothurn: 'Soleure',
  Zürich: 'Zurich', Zug: 'Zoug', Dunkirk: 'Dunkerque', Chur: 'Coire', Thun: 'Thoune', Lugano: 'Lugano', Bellinzona: 'Bellinzone', Sitten: 'Sion', Freiburg: 'Fribourg',
};
const FR_REGIONS = {
  'Brussels Capital': 'Bruxelles-Capitale', Wallonia: 'Wallonie', Flanders: 'Flandre', Zurich: 'canton de Zurich', Zug: 'canton de Zoug',
  'South Holland': 'Hollande-Méridionale', 'North Holland': 'Hollande-Septentrionale', 'North Brabant': 'Brabant-Septentrional',
  Zeeland: 'Zélande', Limburg: 'Limbourg', Groningen: 'Groningue', Gelderland: 'Gueldre', Friesland: 'Frise',
  Vaud: 'canton de Vaud', Valais: 'Valais', Uri: 'canton d’Uri', Ticino: 'Tessin', Thurgau: 'Thurgovie', Solothurn: 'canton de Soleure',
  Schwyz: 'canton de Schwytz', Schaffhausen: 'canton de Schaffhouse', 'Saint Gallen': 'canton de Saint-Gall', Obwalden: 'Obwald',
  Nidwalden: 'Nidwald', Neuchâtel: 'canton de Neuchâtel', Lucerne: 'canton de Lucerne', Jura: 'canton du Jura', Grisons: 'Grisons',
  Glarus: 'canton de Glaris', Geneva: 'canton de Genève', Fribourg: 'canton de Fribourg', Bern: 'canton de Berne', 'Basel-City': 'Bâle-Ville',
  'Basel-Landschaft': 'Bâle-Campagne', 'Appenzell Ausserrhoden': 'Appenzell Rhodes-Extérieures', 'Appenzell Innerrhoden': 'Appenzell Rhodes-Intérieures',
  Aargau: 'Argovie', Corsica: 'Corse', Brittany: 'Bretagne', 'New Aquitaine': 'Nouvelle-Aquitaine', Normandy: 'Normandie',
};
const regions = [];
const regionIndex = new Map();
for (const line of readFileSync(join(INPUT, 'admin1CodesASCII.txt'), 'utf8').split('\n')) {
  const [code, nom] = line.split('\t');
  if (!code || !/^(BE|NL|LU)\./.test(code)) continue;
  regionIndex.set(code, regions.length);
  regions.push(FR_REGIONS[nom] ?? nom);
}

const villes = [];
for (const line of readFileSync(join(INPUT, 'cities5000.txt'), 'utf8').split('\n')) {
  const c = line.split('\t');
  const cc = c[8];
  if (!PAYS[cc]) continue;
  if (/^(PPLX|PPLH|PPLQ|PPLW)$/.test(c[7])) continue; // quartiers, lieux disparus
  if (/^(Paris|Marseille|Lyon) \d|^(Marne La Vallée|Saint-Quentin-en-Yvelines|Cergy-Pontoise)$/.test(c[1])) continue; // arrondissements, villes nouvelles
  const pop = +c[14];
  if (pop < 5000) continue;
  const nom = FR_NOMS[c[1]] ?? c[1];
  // Les alias viennent uniquement de GeoNames : Brussel, Antwerpen, Den Haag, Lëtzebuerg…
  const aliases = [...new Set([c[1], c[2], ...(c[3] ?? '').split(',')])].filter((s) => s && s !== nom && s.length <= 90);
  villes.push([nom, +(+c[4]).toFixed(4), +(+c[5]).toFixed(4), pop, cc, regionIndex.get(`${cc}.${c[10]}`) ?? -1, aliases]);
}
villes.sort((a, b) => b[3] - a[3]);
writeFileSync(join(OUT, 'villes.json'), JSON.stringify({ pays: PAYS, source: {
  nom: 'GeoNames cities5000 et admin1CodesASCII', url: 'https://download.geonames.org/export/dump/',
  licence: 'CC BY 4.0', attribution: 'GeoNames — https://www.geonames.org/', population_minimum: 5000,
  colonnes: ['nom', 'latitude', 'longitude', 'population', 'pays', 'region', 'alias'],
}, regions, villes }));
console.log('villes :', villes.length, '· les 12 premières :', villes.slice(0, 12).map((v) => v[0]).join(', '));

