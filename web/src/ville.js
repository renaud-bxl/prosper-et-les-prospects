// La ville en pixel art, dessinée à partir des vraies rues (tuiles vectorielles OpenFreeMap, données OpenStreetMap) :
// les immeubles avec leur toit et leur façade côté sud (vue de dessus légèrement inclinée, comme le Bureau des agents),
// les rues et leurs trottoirs, les ponts, les fleuves, les parcs et leurs arbres.
// La ville est découpée en carreaux de 256 × 256 pixels, dessinés à la demande et gardés en mémoire, à quatre finesses
// (0,5 m, 1 m, 2 m et 4 m par pixel) : de la porte d'un commerce au quartier entier.
import { VectorTile } from '@mapbox/vector-tile';
import Protobuf from 'pbf';
import { t as tr } from './i18n.js';
import { hash2, makeCanvas, u32 } from './pixels.js';

const D2R = Math.PI / 180;
const Z = 14; // le niveau le plus détaillé des tuiles OpenMapTiles
export const LODS = [0.5, 1, 2, 4]; // mètres par pixel
export const CH = 256; // un carreau : 256 × 256 pixels
const FACADE_K = 0.5; // la hauteur visible d'une façade, en part de la hauteur réelle
const H_MIN = [5, 3, 2, 1];
const H_MAX = [30, 15, 7, 3];

/** Projection locale en mètres autour du centre : x vers l'est, y vers le sud (comme l'écran). */
export function projection(centre) {
  const k = Math.cos(centre.lat * D2R) * 111320;
  return {
    toXY: (lat, lon) => [(lon - centre.lon) * k, -(lat - centre.lat) * 110540],
    toLatLon: (x, y) => [centre.lat - y / 110540, centre.lon + x / k],
  };
}

function tileXY(lat, lon) {
  const n = 2 ** Z;
  return [
    Math.floor(((lon + 180) / 360) * n),
    Math.floor(((1 - Math.log(Math.tan(lat * D2R) + 1 / Math.cos(lat * D2R)) / Math.PI) / 2) * n),
  ];
}

/* ------------------------------------------------------------------ les heures de la journée */
// Le soir est la lumière du Bureau : ombres violettes, façades dorées par le soleil couchant, premières fenêtres allumées.
export const TODS = ['jour', 'soir', 'nuit'];
const PAL = {
  jour: {
    hull: '#3d4a6b', deckWood: '#a07a52', stone: '#cfc5b3',
    bg: '#2a2735', pave: '#b9b3c2', paveDot: '#b0aab9', curb: '#d6d1de', paving: '#cbc2b4', pavingDot: '#c1b8a9',
    asphalt: ['#5c5a6b', '#6e6a7c', '#5f5c6e', '#57546a', '#525064', '#4e4b60', '#4a475c', '#47445a', '#454257', '#434055'],
    marking: '#e8e4ee', deck: '#9a95a6', parapet: '#e4e0ea',
    grass: '#6aa954', grassDot: '#5d9a4b', grassHi: '#8cc46a', wood: '#4f8f45', woodDot: '#457e3d', sand: '#e0c48c', pitch: '#62b05a', pitchLine: '#e9f2df',
    playground: '#d9b77e', school: '#c9bfae', railway: '#8b8290', cemetery: '#5c8f50', track: '#b8644f',
    water: '#3f7fd0', waterDot: '#5a96dd', ripple: '#93c3f2', quay: '#cfc8d6', pool: '#7fd8f0', pier: '#b9a58a',
    facades: ['#e6c08a', '#efd6ab', '#e4a888', '#d8c3a6', '#e8b59b', '#efd795', '#d4ccbd', '#f1e6d3', '#e9c7a0'],
    roofs: ['#9aa0b8', '#b0b5ca', '#868ca5', '#b9735e', '#c3c7d6', '#737891', '#c48a6e'],
    glass: '#53648f', glassHi: '#a9c0e6', lit: '#ffe4a0', shop: '#7f93b8', shopLit: '#ffe9b8', outline: '#2c2836', seam: '#4b4658',
    leafDeep: '#2a5a34', leafDark: '#3c7a42', leaf: '#56a050', leafHi: '#86c76a', trunk: '#6b4a34',
    shadowK: 0.78, shadowLen: 2, litRate: 0.03,
  },
  soir: {
    hull: '#2c2f4d', deckWood: '#8a6447', stone: '#b9a68f',
    bg: '#1b1724', pave: '#5f5462', paveDot: '#584d5b', curb: '#83778b', paving: '#77696f', pavingDot: '#6e6167',
    asphalt: ['#3a3547', '#45404f', '#3b3647', '#363243', '#332f40', '#302c3d', '#2e2a3b', '#2c2839', '#2a2637', '#282435'],
    marking: '#9a92b0', deck: '#5a5368', parapet: '#9d94b3',
    grass: '#3e6e4c', grassDot: '#376244', grassHi: '#5a8f5c', wood: '#2f5a40', woodDot: '#2a5139', sand: '#a68862', pitch: '#3f7550', pitchLine: '#b9c7b4',
    playground: '#9c8060', school: '#5f5765', railway: '#4a4352', cemetery: '#33573f', track: '#8a4a44',
    water: '#29467d', waterDot: '#2f4f89', ripple: '#5b81c2', quay: '#857c98', pool: '#4fa7c9', pier: '#7a6656',
    facades: ['#d9965c', '#e3b077', '#d4876a', '#c9a685', '#dc9d80', '#e2bf75', '#bdae99', '#e4caa6', '#d8a679'],
    roofs: ['#6c6f8e', '#8184a2', '#5a5d7a', '#9a5a4c', '#9497b3', '#4c4e69', '#a8695a'],
    glass: '#2d3456', glassHi: '#56608f', lit: '#ffcf6b', shop: '#3a4166', shopLit: '#ffd88a', outline: '#16121e', seam: '#2b2637',
    leafDeep: '#1d3f2c', leafDark: '#285a3c', leaf: '#3a7a4c', leafHi: '#5ea362', trunk: '#4a3328',
    shadowK: 0.66, shadowLen: 5, litRate: 0.16,
  },
  nuit: {
    hull: '#15172a', deckWood: '#3a2c22', stone: '#3e3a44',
    bg: '#0b0a12', pave: '#25212f', paveDot: '#221e2b', curb: '#3a3449', paving: '#2c2735', pavingDot: '#29242f',
    asphalt: ['#191722', '#1d1a26', '#1a1823', '#181620', '#17151f', '#16141e', '#15131c', '#14121b', '#13111a', '#121019'],
    marking: '#4a4560', deck: '#2a2633', parapet: '#4d4761',
    grass: '#1b3326', grassDot: '#182e22', grassHi: '#244031', wood: '#152a20', woodDot: '#13261d', sand: '#4a3f33', pitch: '#1c3628', pitchLine: '#4f5f55',
    playground: '#463b31', school: '#28232f', railway: '#211d27', cemetery: '#162a1f', track: '#3f2624',
    water: '#121d3d', waterDot: '#152244', ripple: '#2b3f73', quay: '#3b3549', pool: '#1f5a73', pier: '#3a3029',
    facades: ['#4f3d45', '#574650', '#4b3a44', '#463f4c', '#52404a', '#574b4b', '#433f4a', '#5a4f55', '#4f4247'],
    roofs: ['#2f3045', '#35364c', '#2a2b3f', '#43302f', '#3a3b52', '#26273a', '#4a3530'],
    glass: '#161a2e', glassHi: '#262b45', lit: '#ffc35a', shop: '#1d2138', shopLit: '#ffcf7a', outline: '#07060b', seam: '#14111c',
    leafDeep: '#0d1d15', leafDark: '#13281c', leaf: '#1a3626', leafHi: '#24452f', trunk: '#231a16',
    shadowK: 0.85, shadowLen: 1, litRate: 0.42,
  },
};
// La même palette, au format des pixels (Uint32).
const PAL32 = {};
for (const [tod, p] of Object.entries(PAL)) {
  const q = {};
  for (const [k, v] of Object.entries(p)) q[k] = typeof v === 'string' ? u32(v) : Array.isArray(v) ? v.map((c) => u32(c)) : v;
  PAL32[tod] = q;
}
export const palette = (tod) => PAL[tod];

/* ------------------------------------------------------------------ ce qu'on garde des tuiles */
// Largeur des rues (m) et ordre de dessin (les grands axes par-dessus).
const ROADS = {
  motorway: [20, 9], trunk: [17, 8], primary: [15, 7], secondary: [12.5, 6], tertiary: [10.5, 5],
  minor: [8, 4], busway: [7, 4], service: [4.6, 3], track: [3.6, 2], path: [2.6, 1], raceway: [6, 2],
};
const PATHS = { pedestrian: 7, footway: 2.6, cycleway: 2.4, steps: 2.6, path: 2.2, platform: 3, bridleway: 2.4, corridor: 2.4 };
// Les surfaces, dans l'ordre où elles se peignent.
export const AREA = { grass: 1, wood: 2, sand: 3, school: 4, railway: 5, cemetery: 6, playground: 7, pitch: 8, track: 9, plaza: 10, water: 11, pool: 12, pier: 13 };
const LANDUSE = {
  pitch: 'pitch', playground: 'playground', school: 'school', university: 'school', kindergarten: 'school', college: 'school',
  railway: 'railway', cemetery: 'cemetery', track: 'track', recreation_ground: 'grass', stadium: 'pitch', garden: 'grass',
};

const RF_PAVE = 1, RF_BRIDGE = 2;
// Les points d'intérêt qui ne sont pas des commerces (on ne les propose pas au clic).
const PAS_COMMERCE = new Set(['bus', 'railway', 'parking', 'bicycle_parking', 'information', 'toilets', 'waste_basket', 'recycling', 'bench', 'drinking_water',
  'post', 'place_of_worship', 'school', 'college', 'kindergarten', 'town_hall', 'police', 'fire_station', 'prison', 'cemetery', 'park', 'garden', 'playground',
  'swimming_pool', 'pitch', 'gate', 'entrance', 'atm', 'telephone', 'fountain', 'monument', 'memorial', 'castle', 'attraction', 'aerialway', 'ferry_terminal', 'harbor', 'charging_station', 'fuel']);
// Le type d'immeuble (étiquette building=* d'OpenStreetMap) : sa hauteur par défaut et son allure.
const KIND = {
  houseboat: 'peniche', boathouse: 'peniche',
  garage: 'bas', garages: 'bas', carport: 'bas', shed: 'bas', service: 'bas', kiosk: 'bas', hut: 'bas', roof: 'bas', toilets: 'bas', transformer_tower: 'bas',
  house: 'maison', detached: 'maison', semidetached_house: 'maison', terrace: 'maison', bungalow: 'maison',
  church: 'eglise', cathedral: 'eglise', chapel: 'eglise', basilica: 'eglise',
  school: 'plat', office: 'plat', retail: 'plat', commercial: 'plat', industrial: 'plat', warehouse: 'plat', university: 'plat', hospital: 'plat', public: 'plat', supermarket: 'plat', train_station: 'plat', sports_hall: 'plat', parking: 'plat',
};
const DEFAULT_H = { peniche: 2.6, bas: 3.6, maison: 8, eglise: 24, plat: 13, immeuble: 18 };

export async function loadCity({ centre, radius = 2200, onProgress, fetchTile }) {
  const { toXY, toLatLon } = projection(centre);
  const dLat = radius / 110540, dLon = radius / (Math.cos(centre.lat * D2R) * 111320);
  const [x0, y0] = tileXY(centre.lat + dLat, centre.lon - dLon);
  const [x1, y1] = tileXY(centre.lat - dLat, centre.lon + dLon);
  const tiles = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) tiles.push([x, y]);
  const get = fetchTile ?? ((z, x, y) => fetch(`/api/tiles/${z}/${x}/${y}`).then((r) => { if (!r.ok) throw new Error(tr('tuile {x}/{y}', { x, y })); return r.arrayBuffer(); }));
  // Les immeubles un par un et les vrais arbres (OpenStreetMap) ; sinon, les pâtés de maisons des tuiles.
  const detailedRadius=Math.min(radius,2300)*1.05;
  const osm = await fetch(`/api/ville?lat=${centre.lat}&lon=${centre.lon}&r=${Math.round(detailedRadius)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const useOsm = Boolean(osm?.batiments?.length);

  const buildings = new Map();
  const roads = [];
  const rails = [];
  const areas = [];
  const names = [];
  const pois = [];
  let synth = 1e12;
  const ringsXY = (rings) => rings.map((ring) => ring.map(([lon, lat]) => toXY(lat, lon)));
  const polysOf = (gj) => gj.geometry.type === 'Polygon' ? [gj.geometry.coordinates] : gj.geometry.type === 'MultiPolygon' ? gj.geometry.coordinates : [];
  const linesOf = (gj) => gj.geometry.type === 'LineString' ? [gj.geometry.coordinates] : gj.geometry.type === 'MultiLineString' ? gj.geometry.coordinates : [];
  const addArea = (kind, rings) => areas.push({ kind: AREA[kind], rings: ringsXY(rings) });

  let done = 0;
  await Promise.all(tiles.map(async ([tx, ty]) => {
    const vt = new VectorTile(new Protobuf(new Uint8Array(await get(Z, tx, ty))));
    const each = (name, fn) => {
      const L = vt.layers[name];
      if (!L) return;
      for (let i = 0; i < L.length; i++) {
        const f = L.feature(i);
        fn(f.toGeoJSON(tx, ty, Z), f.properties, f.id);
      }
    };
    each('building', (gj, p, id) => {
      const key = id || synth++;
      let b = buildings.get(key);
      if (!b) { b = { id: 0, parts: [], h: 0 }; buildings.set(key, b); }
      for (const rings of polysOf(gj)) b.parts.push(ringsXY(rings));
      b.h = Math.max(b.h, Number(p.render_height) || 0);
    });
    each('transportation', (gj, p) => {
      if (p.brunnel === 'tunnel') return;
      if (gj.geometry.type.endsWith('Polygon')) {
        if (p.class === 'pier' || p.class === 'bridge') for (const r of polysOf(gj)) addArea('pier', r);
        else if (p.class === 'path' && p.subclass === 'pedestrian') for (const r of polysOf(gj)) addArea('plaza', r);
        return;
      }
      if (p.class === 'rail' || p.class === 'transit') {
        if (p.subclass === 'subway') return;
        for (const l of linesOf(gj)) rails.push({ pts: l.map(([lon, lat]) => toXY(lat, lon)), tram: p.subclass === 'tram' || p.subclass === 'light_rail' });
        return;
      }
      const R = ROADS[p.class];
      if (!R) return;
      let [w, rank] = R;
      let pave = false;
      if (p.class === 'path') { w = PATHS[p.subclass] ?? 2.4; pave = true; if (p.subclass === 'pedestrian') rank = 4; }
      if (p.class === 'minor' && p.subclass === 'living_street') pave = true;
      for (const l of linesOf(gj)) roads.push({ pts: l.map(([lon, lat]) => toXY(lat, lon)), w, rank, pave, bridge: p.brunnel === 'bridge', cls: p.class, sub: p.subclass ?? '' });
    });
    each('water', (gj, p) => {
      if (p.brunnel === 'tunnel') return;
      for (const r of polysOf(gj)) addArea(p.class === 'swimming_pool' ? 'pool' : 'water', r);
    });
    each('park', (gj, p) => { if (p.class === 'park' || p.class === 'garden') for (const r of polysOf(gj)) addArea('grass', r); });
    each('landcover', (gj, p) => {
      const k = p.class === 'grass' ? 'grass' : p.class === 'wood' ? 'wood' : p.class === 'sand' ? 'sand' : null;
      if (k) for (const r of polysOf(gj)) addArea(k, r);
    });
    each('landuse', (gj, p) => { const k = LANDUSE[p.class]; if (k) for (const r of polysOf(gj)) addArea(k, r); });
    each('place', (gj, p) => {
      if (!['suburb', 'quarter', 'neighbourhood'].includes(p.class) || !p.name) return;
      const [lon, lat] = gj.geometry.coordinates;
      const [x, y] = toXY(lat, lon);
      if (!names.some((n) => n.name === p.name)) names.push({ name: p.name, x, y, rank: p.class });
    });
    each('poi', (gj, p, id) => {
      if (gj.geometry.type !== 'Point' || !p.name || PAS_COMMERCE.has(p.class)) return;
      const [lon, lat] = gj.geometry.coordinates;
      const [x, y] = toXY(lat, lon);
      if (!pois.some((o) => o.name === p.name && Math.abs(o.x - x) < 2 && Math.abs(o.y - y) < 2)) pois.push({ name: p.name, cls: p.class, sub: p.subclass ?? '', x, y, lat, lon, id });
    });
    onProgress?.(++done / tiles.length);
  }));

  let realTrees = null;
  if (useOsm) {
    for(const [id,b] of buildings){const points=b.parts.flat(2);if(!points.length)continue;let x=0,y=0;for(const point of points){x+=point[0];y+=point[1];}x/=points.length;y/=points.length;if(Math.abs(x)<detailedRadius&&Math.abs(y)<detailedRadius)buildings.delete(id);}
    const ring = (f) => { const r = []; for (let i = 0; i + 1 < f.length; i += 2) r.push(toXY(f[i + 1], f[i])); return r; };
    for (const b of osm.batiments) buildings.set(b.id, { parts: [b.rings.map(ring)], h: b.h, kind: b.k, colour: b.c, roofColour: b.rc });
    realTrees = osm.arbres.map(([lon, lat]) => toXY(lat, lon));
  }

  // Le cadre : ce que couvrent les tuiles chargées (en mètres).
  const [nwx, nwy] = toXY(...tileCorner(x0, y0));
  const [sex, sey] = toXY(...tileCorner(x1 + 1, y1 + 1));
  const bounds = { minx: nwx, miny: nwy, maxx: sex, maxy: sey };
  return new City({ centre, radius, toXY, toLatLon, buildings, roads, rails, areas, names, pois, bounds, realTrees });
}

function tileCorner(tx, ty) {
  const n = 2 ** Z;
  const lon = (tx / n) * 360 - 180;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n))) / D2R;
  return [lat, lon];
}

/* ------------------------------------------------------------------ la ville */
const CELL = 64; // l'index spatial : des cases de 64 m

function bboxOf(rings) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const ring of rings) for (const [x, y] of ring) { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
  return { minx, miny, maxx, maxy };
}

export class City {
  constructor(d) {
    Object.assign(this, d);
    this.cache = new Map();
    // Les immeubles : un numéro par immeuble, sa hauteur, sa teinte, son toit.
    this.blist = [];
    for (const b of d.buildings.values()) {
      if (!b.parts.length) continue;
      let bb = { minx: Infinity, miny: Infinity, maxx: -Infinity, maxy: -Infinity };
      const partBounds = [];
      for (const rings of b.parts) {
        const q = bboxOf(rings);
        partBounds.push(q);
        bb = { minx: Math.min(bb.minx, q.minx), miny: Math.min(bb.miny, q.miny), maxx: Math.max(bb.maxx, q.maxx), maxy: Math.max(bb.maxy, q.maxy) };
      }
      const cx = (bb.minx + bb.maxx) / 2, cy = (bb.miny + bb.maxy) / 2;
      const r = hash2(Math.round(cx * 7), Math.round(cy * 7));
      const r2 = hash2(Math.round(cy * 13), Math.round(cx * 5));
      const kind = KIND[b.kind] ?? 'immeuble';
      let h = b.h;
      if (h <= 0 || (!d.realTrees && h <= 5)) h = kind === 'immeuble' ? 13 + r * 12 : DEFAULT_H[kind]; // hauteur inconnue : un immeuble lyonnais type
      let roof = r < 0.1 ? 3 : r > 0.94 ? 6 : [0, 1, 2, 4, 5, 0, 1][Math.floor(r2 * 7) % 7];
      if (kind === 'maison') roof = r < 0.7 ? 3 : 6;
      if (kind === 'eglise') roof = 5;
      if (kind === 'bas' || kind === 'plat') roof = r < 0.5 ? 4 : 1;
      const id = this.blist.length + 1;
      this.blist.push({ id, parts: b.parts, partBounds, h, ...bb, kind, tone: Math.floor(r2 * 9), roof, seed: Math.floor(r * 997) });
    }
    // Les arbres : le long des grands axes et dans les parcs (placés une fois pour toute la ville).
    this.grid = new Map();
    const put = (bb, kind, i) => {
      for (let gx = Math.floor(bb.minx / CELL); gx <= Math.floor(bb.maxx / CELL); gx++) {
        for (let gy = Math.floor(bb.miny / CELL); gy <= Math.floor(bb.maxy / CELL); gy++) {
          const k = gx * 100003 + gy;
          let c = this.grid.get(k);
          if (!c) { c = { b: [], r: [], a: [], t: [], l: [] }; this.grid.set(k, c); }
          c[kind].push(i);
        }
      }
    };
    this.blist.forEach((b, i) => put(b, 'b', i));
    this.roads.forEach((r, i) => { r.bb = bboxOf([r.pts]); put({ minx: r.bb.minx - r.w, miny: r.bb.miny - r.w, maxx: r.bb.maxx + r.w, maxy: r.bb.maxy + r.w }, 'r', i); });
    this.rails.forEach((r, i) => { r.bb = bboxOf([r.pts]); put({ minx: r.bb.minx - 3, miny: r.bb.miny - 3, maxx: r.bb.maxx + 3, maxy: r.bb.maxy + 3 }, 'l', i); });
    this.areas.forEach((a, i) => { a.bb = bboxOf(a.rings); put(a.bb, 'a', i); });
    this.trees = plantTrees(this);
    this.trees.forEach((t, i) => put({ minx: t.x - t.r, miny: t.y - t.r * 2.2, maxx: t.x + t.r, maxy: t.y + 1 }, 't', i));
    this.lamps = placeLamps(this);
  }

  /** Les objets d'une zone (en mètres), sans doublons. */
  query(kind, minx, miny, maxx, maxy) {
    const out = new Set();
    for (let gx = Math.floor(minx / CELL); gx <= Math.floor(maxx / CELL); gx++) {
      for (let gy = Math.floor(miny / CELL); gy <= Math.floor(maxy / CELL); gy++) {
        const c = this.grid.get(gx * 100003 + gy);
        if (c) for (const i of c[kind]) out.add(i);
      }
    }
    return out;
  }

  /** L'immeuble sous un point (ou null). */
  buildingAt(x, y) {
    for (const i of this.query('b', x, y, x, y)) {
      const b = this.blist[i];
      if (x < b.minx || x > b.maxx || y < b.miny || y > b.maxy) continue;
      // A generalized tile building can have many distant polygon parts. Its
      // overall bounds include all of them; reject each impossible part before
      // the exact even-odd test, keeping the same part and building order.
      for (let part = 0; part < b.parts.length; part++) {
        const bb = b.partBounds[part];
        if (x < bb.minx || x > bb.maxx || y < bb.miny || y > bb.maxy) continue;
        if (inRings(x, y, b.parts[part])) return b;
      }
    }
    return null;
  }
  areaAt(x, y) {
    let best = 0;
    for (const i of this.query('a', x, y, x, y)) {
      const a = this.areas[i];
      if (a.kind > best && x >= a.bb.minx && x <= a.bb.maxx && y >= a.bb.miny && y <= a.bb.maxy && inRings(x, y, a.rings)) best = a.kind;
    }
    return best;
  }
  /** La rue la plus proche : le point sur son axe, sa demi-largeur, la distance. */
  nearestRoad(x, y, maxD = 60, filter = () => true) {
    let best = null;
    for (const i of this.query('r', x - maxD, y - maxD, x + maxD, y + maxD)) {
      const r = this.roads[i];
      if (!filter(r)) continue;
      // The cell index can include a long road whose nearby cell is only in
      // its bounding rectangle. Skip geometry that cannot improve the exact
      // nearest distance; keep the original road/segment order for ties.
      const limit = best?.d ?? maxD;
      if (r.bb && (x < r.bb.minx - limit || x > r.bb.maxx + limit || y < r.bb.miny - limit || y > r.bb.maxy + limit)) continue;
      for (let k = 0; k + 1 < r.pts.length; k++) {
        const [ax, ay] = r.pts[k], [bx, by] = r.pts[k + 1];
        const limit = best?.d ?? maxD;
        if (x < Math.min(ax, bx) - limit || x > Math.max(ax, bx) + limit || y < Math.min(ay, by) - limit || y > Math.max(ay, by) + limit) continue;
        const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-9;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
        const qx = ax + t * dx, qy = ay + t * dy;
        const d = Math.hypot(x - qx, y - qy);
        if (d < maxD && (!best || d < best.d)) best = { d, x: qx, y: qy, road: r, half: r.w / 2 };
      }
    }
    return best;
  }
  onRoad(x, y, pad = 0.4) {
    const n = this.nearestRoad(x, y, 14);
    return Boolean(n && n.d < n.half + pad);
  }

  facadePx(b, L) {
    return Math.max(H_MIN[L], Math.min(H_MAX[L], Math.round((b.h * FACADE_K) / LODS[L])));
  }

  /** Un carreau de la ville (une toile de 256 × 256), dessiné à la demande. */
  chunk(tod, L, cx, cy) {
    const key = `${tod}|${L}|${cx}|${cy}`;
    let c = this.cache.get(key);
    if (c) { this.cache.delete(key); this.cache.set(key, c); return c; }
    c = this.raster(tod, L, cx, cy);
    this.cache.set(key, c);
    if (this.cache.size > 360) this.cache.delete(this.cache.keys().next().value);
    return c;
  }
  hasChunk(tod, L, cx, cy) { return this.cache.has(`${tod}|${L}|${cx}|${cy}`); }

  /** La silhouette d'un immeuble (toit et façade) à un niveau de finesse, pour l'allumer : { c, x0, y0 } en pixels de ce niveau. */
  silhouette(bid, L, roof, face) {
    const key = `sil|${bid}|${L}|${roof}|${face}`;
    let r = this.cache.get(key);
    if (r) return r;
    const b = this.blist[bid - 1];
    if (!b) return null;
    const s = 1 / LODS[L];
    const Hb = this.facadePx(b, L);
    const x0 = Math.floor(b.minx * s) - 2, y0 = Math.floor(b.miny * s) - Hb - 2;
    const w = Math.ceil(b.maxx * s) - x0 + 3, h = Math.ceil(b.maxy * s) - y0 + 3;
    const ids = new Int32Array(w * (h + 2));
    for (const rings of b.parts) fillRings(ids, w, h + 2, rings, x0, y0 - 0, s, 1);
    // le contour au sol est décalé : les pixels du tampon sont en coordonnées (x0, y0) ; le sol commence à y0 + Hb + 2
    const c = makeCanvas(w, h);
    const g = c.getContext('2d');
    const img = g.createImageData(w, h);
    const d32 = new Uint32Array(img.data.buffer);
    const R = u32(roof), F = u32(face), O = u32(roof);
    const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h + 2 ? ids[y * w + x] : 0);
    for (let y = 0; y < h + 2; y++) for (let x = 0; x < w; x++) {
      if (!ids[y * w + x]) continue;
      if (!at(x, y + 1)) for (let k = 0; k < Hb; k++) { const yy = y - k; if (yy >= 0 && yy < h) d32[yy * w + x] = F; }
    }
    for (let y = 0; y < h + 2; y++) for (let x = 0; x < w; x++) {
      if (!ids[y * w + x]) continue;
      const yy = y - Hb;
      if (yy >= 0 && yy < h) d32[yy * w + x] = R;
    }
    // un liseré clair autour (dans une deuxième toile : il reste net quand le voile est léger)
    const e = makeCanvas(w, h);
    const ge = e.getContext('2d');
    const eimg = ge.createImageData(w, h);
    const e32 = new Uint32Array(eimg.data.buffer);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (d32[i]) continue;
      if ((x > 0 && d32[i - 1]) || (x < w - 1 && d32[i + 1]) || (y > 0 && d32[i - w]) || (y < h - 1 && d32[i + w])) e32[i] = O;
    }
    g.putImageData(img, 0, 0);
    ge.putImageData(eimg, 0, 0);
    r = { c, e, x0, y0 };
    this.cache.set(key, r);
    return r;
  }

  raster(tod, L, cx, cy) {
    const pal = PAL32[tod];
    const mpp = LODS[L], s = 1 / mpp;
    const GW = CH + 2, GH = CH + 2;
    const HM = H_MAX[L] + 2;
    const ox = cx * CH - 1, oy = cy * CH - 1; // le coin du tampon (en pixels de ce niveau), une marge d'un pixel autour
    const N = GW * GH;
    const area = new Uint8Array(N);
    const rank = new Uint8Array(N);
    const rflag = new Uint8Array(N);
    const mark = new Uint8Array(N);
    const rail = new Uint8Array(N);
    // zone en mètres
    const mx0 = ox * mpp, my0 = oy * mpp, mx1 = (ox + GW) * mpp, my1 = (oy + GH) * mpp;

    // 1. les surfaces
    const as = [...this.query('a', mx0, my0, mx1, my1)].map((i) => this.areas[i]).sort((a, b) => a.kind - b.kind);
    for (const a of as) fillRings(area, GW, GH, a.rings, ox, oy, s, a.kind);

    // 2. les rues
    const minR = [0.5, 0.5, 0.6, 0.6][L];
    const rs = [...this.query('r', mx0, my0, mx1, my1)].map((i) => this.roads[i]).sort((a, b) => a.rank - b.rank);
    for (const r of rs) {
      if (L === 3 && r.rank <= 2) continue;
      if (L === 2 && r.rank <= 1 && !r.pave) continue;
      const half = Math.max(minR, (r.w / 2) * s);
      for (let k = 0; k + 1 < r.pts.length; k++) {
        const ax = r.pts[k][0] * s - ox, ay = r.pts[k][1] * s - oy, bx = r.pts[k + 1][0] * s - ox, by = r.pts[k + 1][1] * s - oy;
        strokeRoad(rank, rflag, GW, GH, ax, ay, bx, by, half, r.rank, (r.pave ? RF_PAVE : 0) | (r.bridge ? RF_BRIDGE : 0));
      }
    }
    // le marquage au sol (pointillés au milieu des grands axes)
    if (L <= 1) {
      for (const r of rs) {
        if (r.rank < 6 || r.pave || r.bridge) continue;
        let dist = 0;
        for (let k = 0; k + 1 < r.pts.length; k++) {
          const [ax, ay] = r.pts[k], [bx, by] = r.pts[k + 1];
          const len = Math.hypot(bx - ax, by - ay);
          const steps = Math.ceil(len * s * 1.5);
          for (let j = 0; j <= steps; j++) {
            const t = j / Math.max(1, steps), d = dist + t * len;
            if (d % 7 > 3.2) continue;
            const x = Math.floor((ax + t * (bx - ax)) * s - ox), y = Math.floor((ay + t * (by - ay)) * s - oy);
            if (x >= 0 && y >= 0 && x < GW && y < GH && rank[y * GW + x] === r.rank) mark[y * GW + x] = 1;
          }
          dist += len;
        }
      }
    }
    // les rails (tramway : deux fils sur la chaussée)
    if (L <= 1) {
      for (const i of this.query('l', mx0, my0, mx1, my1)) {
        const r = this.rails[i];
        for (let k = 0; k + 1 < r.pts.length; k++) {
          const [ax, ay] = r.pts[k], [bx, by] = r.pts[k + 1];
          const len = Math.hypot(bx - ax, by - ay) || 1;
          const nx = -(by - ay) / len, ny = (bx - ax) / len;
          for (const off of [-0.72, 0.72]) {
            const steps = Math.ceil(len * s * 1.5);
            for (let j = 0; j <= steps; j++) {
              const t = j / Math.max(1, steps);
              const x = Math.floor((ax + t * (bx - ax) + nx * off) * s - ox), y = Math.floor((ay + t * (by - ay) + ny * off) * s - oy);
              if (x >= 0 && y >= 0 && x < GW && y < GH) rail[y * GW + x] = 1;
            }
          }
        }
      }
    }

    // 3. les couleurs du sol
    const out = new Uint32Array(N);
    const wx0 = ox, wy0 = oy; // pour les motifs ancrés dans le monde
    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        const i = y * GW + x;
        const hx = wx0 + x, hy = wy0 + y;
        const r = rank[i];
        let c;
        if (r) {
          const f = rflag[i];
          if (f & RF_PAVE) c = hash2(hx, hy) < 0.12 ? pal.pavingDot : pal.paving;
          else if (f & RF_BRIDGE) c = pal.deck;
          else c = pal.asphalt[r];
          if (!(f & RF_PAVE)) {
            // le bord du trottoir
            const edge = (x > 0 && !rank[i - 1]) || (x < GW - 1 && !rank[i + 1]) || (y > 0 && !rank[i - GW]) || (y < GH - 1 && !rank[i + GW]);
            if (edge) c = f & RF_BRIDGE ? pal.parapet : pal.curb;
            else if (mark[i]) c = pal.marking;
          }
          if (rail[i] && L === 0) c = pal.parapet;
        } else {
          const a = area[i];
          const h = hash2(hx, hy);
          switch (a) {
            case AREA.grass: c = h < 0.03 ? pal.grassHi : h < 0.2 ? pal.grassDot : pal.grass; break;
            case AREA.wood: c = h < 0.25 ? pal.woodDot : pal.wood; break;
            case AREA.sand: case AREA.playground: c = a === AREA.sand ? pal.sand : pal.playground; break;
            case AREA.school: c = h < 0.1 ? pal.paveDot : pal.school; break;
            case AREA.railway: c = h < 0.3 ? pal.paveDot : pal.railway; break;
            case AREA.cemetery: c = (hx % 3 === 0 && hy % 4 === 0) ? pal.pave : pal.cemetery; break;
            case AREA.pitch: {
              const edge = (x > 0 && area[i - 1] !== a) || (x < GW - 1 && area[i + 1] !== a) || (y > 0 && area[i - GW] !== a) || (y < GH - 1 && area[i + GW] !== a);
              c = edge && L <= 1 ? pal.pitchLine : pal.pitch; break;
            }
            case AREA.track: c = pal.track; break;
            case AREA.plaza: c = h < 0.12 ? pal.pavingDot : pal.paving; break;
            case AREA.water: case AREA.pool: {
              const isW = (j) => area[j] === AREA.water || area[j] === AREA.pool;
              const edge = (x > 0 && !isW(i - 1) && !rank[i - 1]) || (x < GW - 1 && !isW(i + 1) && !rank[i + 1]) || (y > 0 && !isW(i - GW) && !rank[i - GW]) || (y < GH - 1 && !isW(i + GW) && !rank[i + GW]);
              if (a === AREA.pool) c = edge ? pal.quay : pal.pool;
              else if (edge) c = pal.quay;
              else {
                // de petites vagues : un trait clair de deux ou trois pixels
                const rip = hash2(Math.floor(hx / 3), hy) < 0.035 && (hy % 2 === 0);
                c = rip ? pal.ripple : h < 0.25 ? pal.waterDot : pal.water;
              }
              break;
            }
            case AREA.pier: c = pal.pier; break;
            default: c = h < 0.1 ? pal.paveDot : pal.pave;
          }
        }
        out[i] = c;
      }
    }
    // l'ombre des ponts sur l'eau
    for (let y = GH - 1; y >= 2; y--) for (let x = 0; x < GW; x++) {
      const i = y * GW + x;
      if (!rank[i] && area[i] === AREA.water && (rflag[i - GW] & RF_BRIDGE || rflag[i - 2 * GW] & RF_BRIDGE)) out[i] = shade(out[i], 0.6);
    }

    // 4. les immeubles et les arbres, du nord au sud (ceux du sud passent devant)
    const BH = GH + HM;
    const ids = new Int32Array(GW * BH);
    const bsel = [...this.query('b', mx0, my0, mx1, (oy + BH) * mpp)].map((i) => this.blist[i]);
    for (const b of bsel) for (const rings of b.parts) fillRings(ids, GW, BH, rings, ox, oy, s, b.id);
    const drawn = new Int32Array(N); // quel immeuble a peint chaque pixel (-1 : un arbre)
    const items = [];
    for (const b of bsel) items.push({ y: b.maxy * s - oy, b });
    if (L <= 2) {
      for (const i of this.query('t', mx0, my0, mx1, (oy + BH) * mpp)) {
        const t = this.trees[i];
        items.push({ y: t.y * s - oy, t });
      }
    }
    items.sort((a, b) => a.y - b.y);
    const facadeCol = new Uint32Array(64);
    for (const it of items) {
      if (it.t) { drawTree(out, drawn, GW, GH, it.t, s, ox, oy, L, pal); continue; }
      const b = it.b;
      const Hb = this.facadePx(b, L);
      const bx0 = Math.max(0, Math.floor(b.minx * s - ox) - 1), bx1 = Math.min(GW - 1, Math.ceil(b.maxx * s - ox) + 1);
      const by0 = Math.max(0, Math.floor(b.miny * s - oy) - 1), by1 = Math.min(BH - 1, Math.ceil(b.maxy * s - oy) + 1);
      if (bx0 > bx1 || by0 > by1) continue;
      const peniche = b.kind === 'peniche';
      const tone = peniche ? pal.hull : b.kind === 'eglise' ? pal.stone : pal.facades[b.tone % pal.facades.length];
      const roofC = peniche ? pal.deckWood : pal.roofs[b.roof % pal.roofs.length];
      const roofHi = lift(roofC, 1.18), roofLo = shade(roofC, 0.82), roofLo2 = shade(roofC, 0.9);
      const cornice = shade(tone, 0.72), base = shade(tone, 0.62), wall2 = shade(tone, 0.9);
      const id = b.id;
      const at = (x, y) => (x >= 0 && y >= 0 && x < GW && y < BH ? ids[y * GW + x] : 0);
      // la façade
      for (let y = by0; y <= by1; y++) {
        for (let x = bx0; x <= bx1; x++) {
          if (ids[y * GW + x] !== id || at(x, y + 1) === id) continue;
          // une colonne de façade, du toit jusqu'au sol
          const hx = ox + x;
          for (let r = 0; r < Hb; r++) facadeCol[r] = facadePixel(r, Hb, hx, b, L, tone, cornice, base, wall2, pal);
          for (let k = 0; k < Hb; k++) {
            const yy = y - k;
            if (yy < 0 || yy >= GH) continue;
            const i = yy * GW + x;
            out[i] = facadeCol[Hb - 1 - k];
            drawn[i] = id;
          }
        }
      }
      // le toit (décalé vers le haut de la hauteur de la façade)
      for (let y = by0; y <= by1; y++) {
        const yy = y - Hb;
        if (yy < 0 || yy >= GH) continue;
        for (let x = bx0; x <= bx1; x++) {
          if (ids[y * GW + x] !== id) continue;
          const S = at(x, y + 1) !== id, N2 = at(x, y - 2) !== id, E = at(x + 1, y) !== id, E2 = at(x + 2, y) !== id, W2 = at(x - 2, y) !== id;
          let c = roofC;
          if (S) c = roofHi;
          else if (N2 || W2) c = lift(roofC, 1.07);
          else if (E || E2) c = roofLo;
          else if (L === 0 && b.roof !== 3 && b.roof !== 6 && ((oy + y) % 4 === 0)) c = roofLo2; // les joints du zinc
          else if (L === 0 && (b.roof === 3 || b.roof === 6) && hash2(ox + x, oy + y) < 0.18) c = roofLo2; // les tuiles
          const i = yy * GW + x;
          out[i] = c;
          drawn[i] = id;
        }
      }
      // les cheminées
      if (L === 0 && (b.kind === 'immeuble' || b.kind === 'maison') && false) {
        for (let y = by0 + 2; y <= by1 - 2; y++) {
          for (let x = bx0 + 2; x <= bx1 - 3; x++) {
            if (ids[y * GW + x] !== id || hash2(ox + x + b.seed, oy + y) > 0.0016) continue;
            if (at(x + 2, y) !== id || at(x, y + 2) !== id || at(x - 1, y - 1) !== id) continue;
            const yy = y - Hb;
            for (const [dx, dy, col] of [[0, -1, lift(tone, 1.05)], [1, -1, lift(tone, 1.05)], [0, 0, cornice], [1, 0, base], [0, 1, pal.outline], [1, 1, pal.outline]]) {
              const xx = x + dx, y2 = yy + dy;
              if (xx >= 0 && y2 >= 0 && xx < GW && y2 < GH) { out[y2 * GW + xx] = col; drawn[y2 * GW + xx] = id; }
            }
          }
        }
      }
    }
    // le contour des immeubles (comme les sprites du Bureau) et le joint entre deux immeubles voisins
    const o = new Uint32Array(out);
    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        const i = y * GW + x, d = drawn[i];
        if (d <= 0) continue;
        const nb = (j) => drawn[j];
        const ground = (x > 0 && nb(i - 1) === 0) || (x < GW - 1 && nb(i + 1) === 0) || (y > 0 && nb(i - GW) === 0) || (y < GH - 1 && nb(i + GW) === 0);
        if (ground) { o[i] = pal.outline; continue; }
        if ((x < GW - 1 && nb(i + 1) > 0 && nb(i + 1) !== d) || (y < GH - 1 && nb(i + GW) > 0 && nb(i + GW) !== d)) o[i] = pal.seam;
      }
    }
    // l'ombre portée des immeubles sur le sol (le soir : longue, vers l'est)
    const SL = Math.max(1, Math.round(PAL[tod].shadowLen * [1, 0.6, 0.4, 0.25][L]));
    const K = PAL[tod].shadowK;
    for (let y = 0; y < GH; y++) {
      let since = 99;
      for (let x = 0; x < GW; x++) {
        const i = y * GW + x;
        if (drawn[i] > 0) { since = 0; continue; }
        since++;
        if (since <= SL && drawn[i] === 0) o[i] = shade(o[i], K);
      }
    }

    // 5. dans la toile
    const c = makeCanvas(CH, CH);
    const g = c.getContext('2d');
    const img = g.createImageData(CH, CH);
    const dst = new Uint32Array(img.data.buffer);
    for (let y = 0; y < CH; y++) dst.set(o.subarray((y + 1) * GW + 1, (y + 1) * GW + 1 + CH), y * CH);
    g.putImageData(img, 0, 0);
    return c;
  }
}

/** Un pixel de façade : corniche, fenêtres des étages (certaines allumées), vitrines du rez-de-chaussée. */
function facadePixel(r, Hb, hx, b, L, tone, cornice, base, wall2, pal) {
  if (r === 0) return cornice;
  if (r === Hb - 1) return base;
  if (b.kind === 'peniche') return (hx + b.seed) % 5 === 2 && r === 1 ? pal.lit : tone;
  if (b.kind === 'bas') return r % 2 ? tone : wall2;
  if (L >= 2) return r % 2 === 0 && L === 2 && Hb >= 4 ? wall2 : tone;
  const gf = Hb >= 8 && L === 0 ? 3 : Hb >= 6 ? 2 : 0; // le rez-de-chaussée (vitrines)
  if (gf && r >= Hb - 1 - gf) {
    const col = (hx + b.seed) % 6;
    if (col === 0) return wall2;
    const lit = hash2(Math.floor((hx + b.seed) / 6), b.id) < 0.5;
    return r === Hb - 1 - gf ? cornice : lit ? pal.shopLit : pal.shop;
  }
  const per = 3;
  const row = r - 1;
  if (row % per === per - 1) return L === 0 ? wall2 : tone;
  if (L === 1 && row % per === 1) return tone;
  const col = (hx + b.seed) % per;
  if (col !== 1) return tone;
  const floor = Math.floor(row / per);
  const lit = hash2(Math.floor((hx + b.seed) / per) * 31 + floor, b.id) < pal.litRate * (L === 0 ? 1 : 0.6);
  if (lit) return pal.lit;
  return L === 0 && row % per === 0 ? pal.glassHi : pal.glass;
}

/* ------------------------------------------------------------------ les arbres */
function plantTrees(city) {
  const trees = [];
  // Decoration is detailed near headquarters only. The full city bounds, real
  // addresses and routing graph remain available well beyond this circle.
  const radius = Math.min(2300, city.radius ?? 2300), radius2 = radius * radius;
  const inside = (x, y) => Number.isFinite(x) && Number.isFinite(y) && x * x + y * y <= radius2;
  const outside = (bb) => bb.maxx < -radius || bb.minx > radius || bb.maxy < -radius || bb.miny > radius;
  const near = new Set();
  const cell = (x, y) => Math.floor(x / 8) * 100003 + Math.floor(y / 8);
  // These are actual OSM positions, not decoration: preserve every real tree in
  // the detailed zone, even if their count alone exceeds the decorative budget.
  for (const [x, y] of city.realTrees ?? []) {
    if (!inside(x, y)) continue;
    const h = hash2(Math.round(x * 3), Math.round(y * 3));
    trees.push({ x, y, r: 2.4 + h * 1.3, k: 0 });
    near.add(cell(x, y));
  }
  const maximum = 6000, deadline = performance.now() + 200;
  const exhausted = () => trees.length >= maximum || performance.now() >= deadline;
  const ok = (x, y, pad = 1.4) => inside(x, y) && !near.has(cell(x, y))
    && !city.buildingAt(x, y) && !city.onRoad(x, y, pad)
    && ![AREA.water, AREA.pool, AREA.pitch, AREA.track].includes(city.areaAt(x, y));
  const add = (x, y, r, k) => { trees.push({ x, y, r, k }); near.add(cell(x, y)); };
  if (exhausted()) return trees;

  // Sparse street trees are a fallback when the central OSM data has no trees.
  if (!city.realTrees?.length) for (const road of city.roads) {
    if (exhausted()) return trees;
    if (road.rank < 5 || road.pave || road.bridge || outside(road.bb)) continue;
    let carry = hash2(Math.round(road.pts[0][0]), Math.round(road.pts[0][1])) * 20;
    for (let k = 0; k + 1 < road.pts.length; k++) {
      const [ax, ay] = road.pts[k], [bx, by] = road.pts[k + 1];
      const length = Math.hypot(bx - ax, by - ay);
      if (length < 0.5) continue;
      const ux = (bx - ax) / length, uy = (by - ay) / length;
      for (let d = carry; d < length; d += 20) {
        if (exhausted()) return trees;
        for (const side of [-1, 1]) {
          if (exhausted()) return trees;
          const offset = road.w / 2 + 2.1;
          const x = ax + ux * d - uy * offset * side, y = ay + uy * d + ux * offset * side;
          if (ok(x, y)) add(x, y, 2.6 + hash2(Math.round(x * 3), Math.round(y * 3)) * 1.1, 0);
        }
      }
      carry = ((carry - length) % 20 + 20) % 20;
    }
  }
  for (const area of city.areas) {
    if (exhausted()) return trees;
    if ((area.kind !== AREA.grass && area.kind !== AREA.wood) || outside(area.bb)) continue;
    const step = area.kind === AREA.wood ? 12 : 16;
    const size = (area.bb.maxx - area.bb.minx) * (area.bb.maxy - area.bb.miny);
    if (size < 300 || size > 4e6) continue;
    const minx = Math.max(-radius, area.bb.minx), maxx = Math.min(radius, area.bb.maxx);
    const miny = Math.max(-radius, area.bb.miny), maxy = Math.min(radius, area.bb.maxy);
    for (let x = Math.ceil(minx / step) * step; x < maxx; x += step) {
      for (let y = Math.ceil(miny / step) * step; y < maxy; y += step) {
        if (exhausted()) return trees;
        const h = hash2(Math.round(x * 10), Math.round(y * 10));
        if (area.kind === AREA.grass && h < 0.35) continue;
        const jx = x + (hash2(Math.round(y), Math.round(x)) - 0.5) * step * 0.8;
        const jy = y + (h - 0.5) * step * 0.8;
        if (!inside(jx, jy) || near.has(cell(jx, jy))) continue;
        if (!inRings(jx, jy, area.rings) || !ok(jx, jy, 1.8)) continue;
        add(jx, jy, 2.8 + h * 1.6, area.kind === AREA.wood ? 1 : 0);
      }
    }
  }
  return trees;
}

const TREE_SPRITES = new Map();
function treeSprite(L, rp, pal, k) {
  const key = `${L}|${rp}|${pal.leaf}|${k}`;
  let sp = TREE_SPRITES.get(key);
  if (sp) return sp;
  const trunkH = L === 0 ? Math.max(2, Math.round(rp * 0.55)) : L === 1 ? 1 : 0;
  const w = rp * 2 + 3, h = rp * 2 + trunkH + 3;
  const pix = new Uint32Array(w * h);
  const cx = rp + 1, cy = rp + 1;
  const [lDeep, lDark, l, lHi, tr] = [pal.leafDeep, pal.leafDark, k ? pal.leafDark : pal.leaf, pal.leafHi, pal.trunk];
  // le tronc
  for (let y = 0; y < trunkH; y++) { pix[(cy + rp - 1 + y) * w + cx] = tr; if (L === 0 && rp >= 3) pix[(cy + rp - 1 + y) * w + cx - 1] = shade(tr, 0.8); }
  // le feuillage : un disque ombré (lumière en haut à gauche)
  for (let y = -rp; y <= rp; y++) {
    for (let x = -rp; x <= rp; x++) {
      const d = Math.hypot(x + 0.5 * 0, y * 1.08);
      if (d > rp + 0.35) continue;
      let c = l;
      const lx = x + y; // diagonale de lumière
      if (d > rp - 0.75) c = lDeep;
      else if (lx > rp * 0.55) c = lDark;
      else if (lx < -rp * 0.5 && d < rp - 1) c = lHi;
      pix[(cy + y) * w + cx + x] = c;
    }
  }
  sp = { pix, w, h, ax: cx, ay: cy + rp + trunkH - 1 };
  TREE_SPRITES.set(key, sp);
  return sp;
}
function drawTree(out, drawn, GW, GH, t, s, ox, oy, L, pal) {
  const rp = Math.max(1, Math.round(t.r * s * [1, 1, 0.8, 0.6][L]));
  if (L === 2 && rp < 2) {
    const x = Math.floor(t.x * s - ox), y = Math.floor(t.y * s - oy) - 1;
    if (x >= 0 && y >= 0 && x < GW && y < GH) { out[y * GW + x] = pal.leaf; drawn[y * GW + x] = -1; }
    return;
  }
  const sp = treeSprite(L, rp, pal, t.k);
  const x0 = Math.floor(t.x * s - ox) - sp.ax, y0 = Math.floor(t.y * s - oy) - sp.ay;
  // l'ombre au pied de l'arbre
  if (L <= 1) {
    for (let x = -rp + 1; x <= rp + 1; x++) {
      const xx = x0 + sp.ax + x, yy = y0 + sp.ay + 1;
      if (xx >= 0 && yy >= 0 && xx < GW && yy < GH && drawn[yy * GW + xx] === 0) out[yy * GW + xx] = shade(out[yy * GW + xx], 0.72);
    }
  }
  for (let y = 0; y < sp.h; y++) {
    const yy = y0 + y;
    if (yy < 0 || yy >= GH) continue;
    for (let x = 0; x < sp.w; x++) {
      const c = sp.pix[y * sp.w + x];
      if (!c) continue;
      const xx = x0 + x;
      if (xx < 0 || xx >= GW) continue;
      out[yy * GW + xx] = c;
      drawn[yy * GW + xx] = -1;
    }
  }
}

/** Les réverbères : le long des rues, tous les 26 m d'un côté (ils s'allument le soir). */
function placeLamps(city) {
  const lamps = [];
  for (const r of city.roads) {
    if (r.rank < 4 || r.bridge) continue;
    let carry = 6;
    for (let k = 0; k + 1 < r.pts.length; k++) {
      const [ax, ay] = r.pts[k], [bx, by] = r.pts[k + 1];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 0.5) continue;
      const ux = (bx - ax) / len, uy = (by - ay) / len;
      for (let d = carry; d < len; d += 26) {
        const off = r.w / 2 + 0.9;
        lamps.push({ x: ax + ux * d - uy * off, y: ay + uy * d + ux * off });
      }
      carry = ((carry - len) % 26 + 26) % 26;
    }
  }
  return lamps;
}

/* ------------------------------------------------------------------ remplir, tracer */
export function inRings(x, y, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Remplit des anneaux (le premier : le contour, les suivants : les trous), règle pair-impair, au centre des pixels. */
function fillRings(buf, bw, bh, rings, ox, oy, s, val) {
  const E = [];
  let ymin = Infinity, ymax = -Infinity;
  for (const ring of rings) {
    for (let i = 0, n = ring.length; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
      const ay = a[1] * s - oy, by = b[1] * s - oy;
      if (ay === by) continue;
      const lo = Math.min(ay, by), hi = Math.max(ay, by);
      if (hi < 0 || lo > bh) { continue; }
      E.push(a[0] * s - ox, ay, b[0] * s - ox, by);
      if (lo < ymin) ymin = lo;
      if (hi > ymax) ymax = hi;
    }
  }
  if (!E.length) return;
  const y0 = Math.max(0, Math.ceil(ymin - 0.5)), y1 = Math.min(bh - 1, Math.floor(ymax - 0.5));
  const xs = [];
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5;
    xs.length = 0;
    for (let i = 0; i < E.length; i += 4) {
      const ay = E[i + 1], by = E[i + 3];
      if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) xs.push(E[i] + ((yc - ay) / (by - ay)) * (E[i + 2] - E[i]));
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k] - 0.5)), xb = Math.min(bw - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = xa; x <= xb; x++) buf[y * bw + x] = val;
    }
  }
}

/** Une rue : une gélule de demi-largeur r autour du segment ; la plus importante l'emporte. */
function strokeRoad(rank, rflag, bw, bh, ax, ay, bx, by, r, val, flags) {
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r)), x1 = Math.min(bw - 1, Math.ceil(Math.max(ax, bx) + r));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r)), y1 = Math.min(bh - 1, Math.ceil(Math.max(ay, by) + r));
  if (x0 > x1 || y0 > y1) return;
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-9, r2 = r * r;
  for (let y = y0; y <= y1; y++) {
    const py = y + 0.5 - ay;
    for (let x = x0; x <= x1; x++) {
      const pxx = x + 0.5 - ax;
      const t = Math.max(0, Math.min(1, (pxx * dx + py * dy) / L2));
      const ex = pxx - t * dx, ey = py - t * dy;
      if (ex * ex + ey * ey > r2) continue;
      const i = y * bw + x;
      if (val > rank[i] || (val === rank[i] && (flags & RF_BRIDGE))) { rank[i] = val; rflag[i] = flags; }
      else if (val === rank[i]) rflag[i] &= flags | ~RF_PAVE;
    }
  }
}

/** Assombrir ou éclaircir une couleur Uint32. */
function shade(c, k) {
  const r = (c & 255) * k, g = ((c >>> 8) & 255) * k, b = ((c >>> 16) & 255) * k;
  return ((255 << 24) | (Math.min(255, b) << 16) | (Math.min(255, g) << 8) | Math.min(255, r)) >>> 0;
}
const lift = shade;

