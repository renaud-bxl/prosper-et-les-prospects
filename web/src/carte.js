import { getLang } from './i18n.js';
// La carte de mission en pixel art : la Belgique, les Pays-Bas et le Luxembourg à partir des tuiles vectorielles
// (OpenFreeMap, données OpenStreetMap), en gros pixels comme le QG. On zoome, et toutes les villes apparaissent : les grandes
// d'abord, puis les villes moyennes, puis chaque village. Un clic choisit la ville de la mission, la caméra plonge dessus.
import { VectorTile } from '@mapbox/vector-tile';
import Protobuf from 'pbf';
import { u32 } from './pixels.js';

const D2R = Math.PI / 180;
const TILE = 128; // une tuile dessinée en 128 × 128 pixels : de gros pixels, comme la ville
const C = {
  land: u32('#2a2433'), urban: u32('#3a3246'), urban2: u32('#433a50'), wood: u32('#2b4a39'), grass: u32('#30533e'), sand: u32('#5a4c45'),
  water: u32('#29467d'), coast: u32('#4a72b4'), river: u32('#3d6cb4'), border: u32('#9a90b6'), region: u32('#463e55'),
  motorway: u32('#d08a52'), trunk: u32('#7a7092'), secondary: u32('#5f5776'), minor: u32('#4c4560'), building: u32('#57506b'), rail: u32('#3f3850'),
};

export const merc = (lat, lon) => [(lon + 180) / 360, (1 - Math.log(Math.tan(lat * D2R) + 1 / Math.cos(lat * D2R)) / Math.PI) / 2];
export const unmerc = (x, y) => [Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) / D2R, x * 360 - 180];

const CLASS = {
  country: { min: 0, max: 6.6, prio: 0 }, state: { min: 6.4, max: 8.6, prio: 1 }, province: { min: 6.4, max: 8.6, prio: 1 },
  city: { min: 0, max: 99, prio: 2 }, town: { min: 7.4, max: 99, prio: 3 }, village: { min: 9.2, max: 99, prio: 4 },
  suburb: { min: 11, max: 99, prio: 5 }, quarter: { min: 12.5, max: 99, prio: 6 }, hamlet: { min: 11.6, max: 99, prio: 6 }, neighbourhood: { min: 13, max: 99, prio: 7 },
};

export function createCarte({ onPick, getRayon = () => 2000 } = {}) {
  const [x, y] = merc(51.45, 4.9);
  const cam = { x, y, zoom: 7 }; // le Benelux, de Luxembourg aux îles frisonnes
  const tiles = new Map();
  const darkPalette={...C};
  let lightMap=false;
  function applyMapTheme(theme) {
    lightMap=theme==='light';
    const light={land:'#dce4e1',urban:'#d1dbe1',urban2:'#c8d3db',wood:'#b4cbbd',grass:'#cbdcc5',sand:'#f0d6c8',water:'#a8c5d3',coast:'#7d9fac',river:'#82adbf',border:'#748da3',region:'#a8b8c4',motorway:'#d49b87',trunk:'#9eacbc',secondary:'#adbac6',minor:'#b8c4ce',building:'#a8b6c5',rail:'#92a0af'};
    Object.assign(C,lightMap ? Object.fromEntries(Object.entries(light).map(([key,c])=>[key,u32(c)])) : darkPalette);
    for(const tile of tiles.values()) if(tile.vt) tile.canvas=raster(tile.vt,tile.z);
  }
  applyMapTheme(document.documentElement.dataset.theme);
  document.addEventListener('prosper-theme',e=>applyMapTheme(e.detail.theme));

  let pays = null; // les contours du Benelux (pour assombrir les voisins)
  let hover = null, selected = null, drawn = [];
  let flight = null;
  const t0 = performance.now();

  fetch('/carte/pays.json').then((r) => r.json()).then((d) => {
    pays = d.pays.filter((p) => ['BE', 'NL', 'LU'].includes(p.cc)).map((p) => ({ cc: p.cc, rings: p.rings.map((r) => r.map(([lon, lat]) => merc(lat, lon))) }));
  }).catch(() => {});

  function inPays(x, y) {
    if (!pays) return true;
    for (const p of pays) for (const ring of p.rings) {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) return p.cc;
    }
    return null;
  }

  /* ------------------------------------------------------------------ une tuile */
  function tile(z, x, y) {
    const key = `${z}/${x}/${y}`;
    let t = tiles.get(key);
    if (t) return t;
    t = { z, x, y, canvas: null, labels: [], state: 'loading' };
    tiles.set(key, t);
    fetch(`/api/tiles/${z}/${x}/${y}`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status)))).then((buf) => {
      const vt = new VectorTile(new Protobuf(new Uint8Array(buf)));
      t.vt=vt; t.canvas = raster(vt, z);
      t.labels = labelsOf(vt, z, x, y);
      t.state = 'ok';
    }).catch(() => { t.state = 'err'; });
    if (tiles.size > 700) for (const [k, v] of tiles) { if (v.state !== 'loading') { tiles.delete(k); break; } }
    return t;
  }

  function raster(vt, z) {
    const N = TILE;
    const buf = new Uint32Array(N * N).fill(C.land);
    const each = (name, fn) => { const L = vt.layers[name]; if (!L) return; for (let i = 0; i < L.length; i++) { const f = L.feature(i); fn(f, f.properties, N / L.extent); } };
    const poly = (f, s, col) => { if (f.type === 3) fillPoly(buf, N, f.loadGeometry(), s, col); };
    each('landcover', (f, p, s) => { const c = p.class === 'wood' || p.class === 'forest' ? C.wood : p.class === 'grass' ? C.grass : p.class === 'sand' ? C.sand : 0; if (c) poly(f, s, c); });
    each('landuse', (f, p, s) => { const c = ['residential', 'suburb', 'neighbourhood', 'quarter'].includes(p.class) ? C.urban : ['commercial', 'industrial', 'retail', 'railway'].includes(p.class) ? C.urban2 : 0; if (c) poly(f, s, c); });
    each('park', (f, p, s) => { if (z >= 9) poly(f, s, C.grass); });
    each('water', (f, p, s) => { if (p.class !== 'swimming_pool') poly(f, s, C.water); });
    // un liseré clair le long des côtes et des berges
    const w = new Uint32Array(buf);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x;
      if (buf[i] !== C.water) continue;
      if ((x > 0 && buf[i - 1] !== C.water) || (x < N - 1 && buf[i + 1] !== C.water) || (y > 0 && buf[i - N] !== C.water) || (y < N - 1 && buf[i + N] !== C.water)) w[i] = C.coast;
    }
    buf.set(w);
    each('waterway', (f, p, s) => { if (f.type === 2 && (p.class === 'river' || (z >= 11 && p.class === 'canal')) && p.brunnel !== 'tunnel') strokeLines(buf, N, f.loadGeometry(), s, z >= 10 ? 0.9 : 0.5, C.river); });
    each('building', (f, p, s) => { if (z >= 13) poly(f, s, C.building); });
    each('transportation', (f, p, s) => {
      if (f.type !== 2 || p.brunnel === 'tunnel') return;
      const c = p.class;
      let col = 0, r = 0.5;
      if (c === 'motorway') { col = C.motorway; r = z >= 9 ? 0.9 : 0.55; }
      else if (c === 'trunk' || c === 'primary') { if (z >= 7) { col = C.trunk; r = z >= 10 ? 0.8 : 0.5; } }
      else if (c === 'secondary' || c === 'tertiary') { if (z >= 9) { col = C.secondary; r = z >= 11 ? 0.7 : 0.5; } }
      else if (c === 'minor' || c === 'service') { if (z >= 11) { col = C.minor; r = 0.5; } }
      else if (c === 'rail') { if (z >= 9) { col = C.rail; r = 0.5; } }
      if (col) strokeLines(buf, N, f.loadGeometry(), s, r, col);
    });
    each('boundary', (f, p, s) => {
      if (f.type !== 2 || p.maritime) return;
      if (p.admin_level === 2) strokeLines(buf, N, f.loadGeometry(), s, 0.6, C.border, 3);
      else if (p.admin_level === 4 && z >= 6) strokeLines(buf, N, f.loadGeometry(), s, 0.5, C.region, 2);
    });
    const c = document.createElement('canvas');
    c.width = N; c.height = N;
    const g = c.getContext('2d');
    const img = g.createImageData(N, N);
    new Uint32Array(img.data.buffer).set(buf);
    g.putImageData(img, 0, 0);
    return c;
  }

  function labelsOf(vt, z, tx, ty) {
    const L = vt.layers.place;
    if (!L) return [];
    const out = [];
    const n = 2 ** z;
    for (let i = 0; i < L.length; i++) {
      const f = L.feature(i);
      const p = f.properties;
      const def = CLASS[p.class];
      if (!def || !p.name || f.type !== 1) continue;
      const pt = f.loadGeometry()[0][0];
      if (pt.x < 0 || pt.y < 0 || pt.x >= L.extent || pt.y >= L.extent) continue; // la tuile voisine s'en charge
      const x = (tx + pt.x / L.extent) / n, y = (ty + pt.y / L.extent) / n;
      const cc = p.class === 'country' || p.class === 'state' || p.class === 'province' ? true : inPays(x, y);
      if (!cc) continue;
      out.push({ name: p['name:'+getLang()] || p.name_int && p.class === 'country' && p['name:'+getLang()] || p.name, cls: p.class, rank: p.rank ?? 9, cap: p.capital ?? 0, x, y, pays: typeof cc === 'string' ? cc : null, def });
    }
    return out;
  }

  /* ------------------------------------------------------------------ dessiner */
  const scale = (W, dpr) => 256 * 2 ** cam.zoom * dpr; // pixels d'écran pour toute la largeur du monde
  function toScreen(x, y, W, H, dpr) { const k = scale(W, dpr); return [(x - cam.x) * k + W / 2, (y - cam.y) * k + H / 2]; }
  function toWorld(sx, sy, W, H, dpr) { const k = scale(W, dpr); return [(sx - W / 2) / k + cam.x, (sy - H / 2) / k + cam.y]; }

  function draw(g, W, H, dpr, now = performance.now()) {
    stepFlight(now);
    const t = (now - t0) / 1000;
    g.fillStyle = lightMap ? '#dce4e1' : '#101a24';
    g.fillRect(0, 0, W, H);
    g.imageSmoothingEnabled = false;
    const tz = Math.max(4, Math.min(14, Math.round(cam.zoom + 0.15)));
    const n = 2 ** tz;
    const k = scale(W, dpr);
    const [x0, y0] = toWorld(0, 0, W, H, dpr), [x1, y1] = toWorld(W, H, W, H, dpr);
    const visible = [];
    for (let ty = Math.max(0, Math.floor(y0 * n)); ty <= Math.min(n - 1, Math.floor(y1 * n)); ty++) {
      for (let tx = Math.max(0, Math.floor(x0 * n)); tx <= Math.min(n - 1, Math.floor(x1 * n)); tx++) {
        const sx0 = Math.round((tx / n - cam.x) * k + W / 2), sx1 = Math.round(((tx + 1) / n - cam.x) * k + W / 2);
        const sy0 = Math.round((ty / n - cam.y) * k + H / 2), sy1 = Math.round(((ty + 1) / n - cam.y) * k + H / 2);
        const tl = tile(tz, tx, ty);
        if (tl.canvas) g.drawImage(tl.canvas, sx0, sy0, sx1 - sx0, sy1 - sy0);
        else {
          // en attendant : la tuile parente, agrandie
          for (let up = 1; up <= 4; up++) {
            const pz = tz - up, px = tx >> up, py = ty >> up;
            const pt = tiles.get(`${pz}/${px}/${py}`);
            if (pt?.canvas) {
              const f = TILE / 2 ** up;
              g.drawImage(pt.canvas, (tx - (px << up)) * f, (ty - (py << up)) * f, f, f, sx0, sy0, sx1 - sx0, sy1 - sy0);
              break;
            }
          }
        }
        visible.push(tl);
      }
    }
    // les pays voisins dans l'ombre, la Belgique, les Pays-Bas et le Luxembourg dans la lumière
    if (pays) {
      g.save();
      g.beginPath();
      g.rect(0, 0, W, H);
      for (const p of pays) for (const ring of p.rings) {
        ring.forEach(([x, y], i) => { const [sx, sy] = [(x - cam.x) * k + W / 2, (y - cam.y) * k + H / 2]; i ? g.lineTo(sx, sy) : g.moveTo(sx, sy); });
        g.closePath();
      }
      g.fillStyle = lightMap ? 'rgba(240,244,247,0.68)' : 'rgba(6,5,10,0.62)';
      g.fill('evenodd');
      g.restore();
    }
    // le secteur choisi
    if (selected) {
      const [sx, sy] = toScreen(selected.x, selected.y, W, H, dpr);
      const mPerUnit = 40075016.686 * Math.cos(selected.lat * D2R);
      const r = (getRayon() / mPerUnit) * k;
      const S = Math.max(2, Math.round(dpr * 2));
      if (r > 6) {
        g.save();
        g.fillStyle = 'rgba(255,138,61,0.10)';
        g.strokeStyle = 'rgba(255,138,61,0.9)';
        g.lineWidth = S;
        g.setLineDash([S * 4, S * 3]);
        g.lineDashOffset = -t * 16;
        g.beginPath(); g.arc(sx, sy, r, 0, Math.PI * 2); g.fill(); g.stroke();
        g.restore();
      }
      const p = (Math.sin(t * 4) + 1) / 2;
      const R = (6 + p * 5) * S;
      g.strokeStyle = `rgba(255,138,61,${0.9 - p * 0.5})`;
      g.lineWidth = S;
      g.strokeRect(Math.round(sx - R), Math.round(sy - R), Math.round(R * 2), Math.round(R * 2));
    }
    drawLabels(g, visible, W, H, dpr, t);
  }

  function drawLabels(g, visible, W, H, dpr, t) {
    const z = cam.zoom;
    const all = [];
    for (const tl of visible) for (const l of tl.labels) if (z >= l.def.min && z < l.def.max) all.push(l);
    all.sort((a, b) => a.def.prio - b.def.prio || a.rank - b.rank || b.cap - a.cap);
    const rects = [];
    drawn = [];
    const k = scale(W, dpr);
    const S = Math.max(1, Math.round(dpr));
    for (const l of all) {
      const sx = Math.round((l.x - cam.x) * k + W / 2), sy = Math.round((l.y - cam.y) * k + H / 2);
      if (sx < -50 || sy < -20 || sx > W + 50 || sy > H + 20) continue;
      const big = l.cls === 'city' && l.rank <= 3;
      const area = l.cls === 'country' || l.cls === 'state' || l.cls === 'province';
      const fs = (area ? (l.cls === 'country' ? 20 : 13) : big ? 17 : l.cls === 'city' ? 15 : l.cls === 'town' ? 13 : 11.5) * dpr;
      const text = area ? l.name.toUpperCase() : l.name;
      g.font = `${area || big ? 700 : 600} ${fs}px 'Plus Jakarta Sans', system-ui, sans-serif`;
      const tw = g.measureText(text).width;
      const dot = area ? 0 : (big ? 5 : l.cls === 'city' ? 4 : l.cls === 'town' ? 3 : 2) * S;
      const box = area ? [sx - tw / 2 - 4, sy - fs / 2 - 2, tw + 8, fs + 4] : [sx - dot, sy - fs - dot - 2 * S, Math.max(tw, dot * 2) + 2 * dot, fs + dot * 2 + 4 * S];
      if (!area) box[0] = sx - tw / 2 - 2;
      if (rects.some((r) => box[0] < r[0] + r[2] && box[0] + box[2] > r[0] && box[1] < r[1] + r[3] && box[1] + box[3] > r[1])) continue;
      rects.push(box);
      const isHover = hover === l, isSel = selected && selected.name === l.name && Math.abs(selected.x - l.x) < 1e-6;
      if (area) {
        g.globalAlpha = l.cls === 'country' ? 0.55 : 0.4;
        g.fillStyle = lightMap ? '#465d75' : '#c9c3d6';
        g.letterSpacing = `${3 * dpr}px`;
        g.textAlign = 'center';
        g.fillText(text, sx, sy + fs / 3);
        g.letterSpacing = '0px';
        g.globalAlpha = 1;
        continue;
      }
      // le point de la ville : un carré de pixels
      const col = isHover || isSel ? '#ff8a3d' : big ? '#fbfaff' : l.cls === 'city' ? '#e8e5f1' : l.cls === 'town' ? '#c9c3d6' : '#a39cb3';
      g.fillStyle = '#07060b';
      g.fillRect(sx - dot - S, sy - dot - S, dot * 2 + 2 * S, dot * 2 + 2 * S);
      g.fillStyle = col;
      g.fillRect(sx - dot, sy - dot, dot * 2, dot * 2);
      g.textAlign = 'center';
      g.lineJoin = 'round';
      g.lineWidth = 3 * dpr;
      g.strokeStyle = '#07060b';
      g.strokeText(text, sx, sy - dot - 4 * S);
      g.fillStyle = isHover || isSel ? '#ffb27a' : col;
      g.fillText(text, sx, sy - dot - 4 * S);
      drawn.push({ l, sx, sy, r: Math.max(10 * dpr, dot * 3), box });
    }
  }

  /* ------------------------------------------------------------------ bouger, choisir */
  function pickAt(sx, sy) {
    let best = null, bd = Infinity;
    for (const d of drawn) {
      const inBox = sx >= d.box[0] && sx <= d.box[0] + d.box[2] && sy >= d.box[1] && sy <= d.box[1] + d.box[3];
      const dd = Math.hypot(sx - d.sx, sy - d.sy);
      if ((inBox || dd < d.r) && dd < bd) { best = d.l; bd = dd; }
    }
    return best;
  }
  function setHover(sx, sy) { hover = sx == null ? null : pickAt(sx, sy); return hover; }
  function choose(l) {
    const [lat, lon] = unmerc(l.x, l.y);
    selected = { name: l.name, x: l.x, y: l.y, lat, lon, cls: l.cls, pays: l.pays ?? inPays(l.x, l.y) ?? null };
    onPick?.(selected);
    return selected;
  }
  function select(c) { const [x, y] = merc(c.lat, c.lon); selected = { ...c, name: c.name ?? c.nom, x, y }; return selected; }
  function pan(dx, dy, W, dpr) { const k = scale(W, dpr); cam.x -= dx / k; cam.y -= dy / k; flight = null; }
  function zoomAt(sx, sy, dz, W, H, dpr) {
    const [wx, wy] = toWorld(sx, sy, W, H, dpr);
    cam.zoom = Math.max(4.6, Math.min(15.8, cam.zoom + dz));
    const [nx, ny] = toWorld(sx, sy, W, H, dpr);
    cam.x += wx - nx; cam.y += wy - ny;
    flight = null;
  }
  /** Un vol de caméra : on prend de la hauteur si c'est loin, puis on plonge. */
  function flyTo(lat, lon, zoom, ms = 1600) {
    const [x, y] = merc(lat, lon);
    const from = { ...cam };
    const dist = Math.hypot(x - from.x, y - from.y) * 2 ** Math.min(from.zoom, zoom) * 256;
    const hump = Math.max(0, Math.log2(Math.max(1, dist / 600)));
    flight = { from, to: { x, y, zoom }, t0: performance.now(), ms, hump };
    return new Promise((res) => { flight.done = res; });
  }
  function stepFlight(now) {
    if (!flight) return;
    const u = Math.min(1, (now - flight.t0) / flight.ms);
    const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    const { from, to, hump } = flight;
    // la position suit le zoom (on avance vite quand on est haut)
    const kz = (2 ** -from.zoom - 2 ** -(from.zoom + (to.zoom - from.zoom) * e)) / (2 ** -from.zoom - 2 ** -to.zoom || 1);
    const pe = Math.abs(to.zoom - from.zoom) > 0.5 ? Math.min(1, Math.max(e, kz * 0.6 + e * 0.4)) : e;
    cam.x = from.x + (to.x - from.x) * pe;
    cam.y = from.y + (to.y - from.y) * pe;
    cam.zoom = from.zoom + (to.zoom - from.zoom) * e - hump * Math.sin(Math.PI * u) * 0.8;
    if (u >= 1) { const d = flight.done; flight = null; d?.(); }
  }
  /** Pixels d'écran par mètre au centre de la vue (pour raccorder la carte et la ville). */
  function pxPerMeter(W, dpr) { const [lat] = unmerc(cam.x, cam.y); return scale(W, dpr) / (40075016.686 * Math.cos(lat * D2R)); }

  return { cam, draw, setHover, pickAt, choose, select, pan, zoomAt, flyTo, pxPerMeter, get selected() { return selected; }, get hover() { return hover; }, get flying() { return Boolean(flight); }, get loading() { let n = 0; for (const t of tiles.values()) if (t.state === 'loading') n++; return n; }, centre: () => unmerc(cam.x, cam.y) };
}

/* ------------------------------------------------------------------ remplir, tracer (coordonnées de tuile) */
function fillPoly(buf, N, rings, s, col) {
  const E = [];
  let ymin = Infinity, ymax = -Infinity;
  for (const ring of rings) for (let i = 0, n = ring.length; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    const ay = a.y * s, by = b.y * s;
    if (ay === by) continue;
    E.push(a.x * s, ay, b.x * s, by);
    ymin = Math.min(ymin, ay, by); ymax = Math.max(ymax, ay, by);
  }
  if (!E.length) return;
  const xs = [];
  for (let y = Math.max(0, Math.ceil(ymin - 0.5)); y <= Math.min(N - 1, Math.floor(ymax - 0.5)); y++) {
    const yc = y + 0.5;
    xs.length = 0;
    for (let i = 0; i < E.length; i += 4) {
      const ay = E[i + 1], by = E[i + 3];
      if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) xs.push(E[i] + ((yc - ay) / (by - ay)) * (E[i + 2] - E[i]));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k] - 0.5)), xb = Math.min(N - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = xa; x <= xb; x++) buf[y * N + x] = col;
    }
  }
}
function strokeLines(buf, N, lines, s, r, col, dash = 0) {
  for (const line of lines) {
    let d = 0;
    for (let i = 0; i + 1 < line.length; i++) {
      const ax = line[i].x * s, ay = line[i].y * s, bx = line[i + 1].x * s, by = line[i + 1].y * s;
      const len = Math.hypot(bx - ax, by - ay);
      const steps = Math.max(1, Math.ceil(len * 2));
      for (let j = 0; j <= steps; j++) {
        const u = j / steps;
        if (dash && Math.floor((d + u * len) / dash) % 2 === 1) continue;
        const x = ax + (bx - ax) * u, y = ay + (by - ay) * u;
        const x0 = Math.floor(x - r + 0.5), x1 = Math.floor(x + r - 0.5), y0 = Math.floor(y - r + 0.5), y1 = Math.floor(y + r - 0.5);
        for (let yy = Math.max(0, y0); yy <= Math.min(N - 1, Math.max(y0, y1)); yy++) for (let xx = Math.max(0, x0); xx <= Math.min(N - 1, Math.max(x0, x1)); xx++) buf[yy * N + xx] = col;
      }
      d += len;
    }
  }
}

