import { VectorTile } from '@mapbox/vector-tile';
import Protobuf from 'pbf';

const MAX_LAT = 85.05112878;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function project(lat, lon) {
  const r = clamp(lat, -MAX_LAT, MAX_LAT) * Math.PI / 180;
  return [(lon + 180) / 360, (1 - Math.log(Math.tan(Math.PI / 4 + r / 2)) / Math.PI) / 2];
}
export function unproject(x, y) {
  return [Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI, x * 360 - 180];
}
export function validCoordinates(place) {
  if (place?.lat == null || place?.lon == null || String(place.lat).trim() === '' || String(place.lon).trim() === '') return false;
  if (!['number', 'string'].includes(typeof place.lat) || !['number', 'string'].includes(typeof place.lon)) return false;
  const lat = Number(place.lat), lon = Number(place.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}
export function fitBounds(points, width, height, padding = 42) {
  if (!points.length) { const [x, y] = project(51.1, 4.8); return { x, y, zoom: 7 }; }
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = maxX - minX, spanY = maxY - minY;
  const zx = spanX ? Math.log2(Math.max(1, width - padding * 2) / (256 * spanX)) : 17;
  const zy = spanY ? Math.log2(Math.max(1, height - padding * 2) / (256 * spanY)) : 17;
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, zoom: clamp(Math.min(zx, zy), 4, 16.5) };
}
const words = {
  fr: { map: 'Carte des commerces', in: 'Zoom avant', out: 'Zoom arrière', fit: 'Vue d’ensemble', loading: 'Chargement de la carte…', error: 'Fond de carte indisponible. Les commerces restent accessibles.', retry: 'Réessayer', empty: 'Aucun commerce géolocalisé.', help: 'Flèches pour déplacer la carte, + et − pour zoomer.' },
  nl: { map: 'Kaart met bedrijven', in: 'Inzoomen', out: 'Uitzoomen', fit: 'Overzicht', loading: 'Kaart laden…', error: 'Kaartachtergrond niet beschikbaar. De bedrijven blijven bereikbaar.', retry: 'Opnieuw proberen', empty: 'Geen bedrijven met locatiegegevens.', help: 'Verplaats de kaart met de pijltjestoetsen, zoom met + en −.' },
  en: { map: 'Business map', in: 'Zoom in', out: 'Zoom out', fit: 'Show all', loading: 'Loading map…', error: 'Map background unavailable. Businesses remain accessible.', retry: 'Try again', empty: 'No businesses with coordinates.', help: 'Use arrow keys to pan and + or − to zoom.' },
};
const palettes = {
  light: { land: '#edf0e9', urban: '#e3e7e3', industrial: '#e0e3e7', wood: '#c8daca', grass: '#d9e5cc', sand: '#efe6d0', water: '#b6d4e4', road: '#fffefa', casing: '#d5d9d1', main: '#f1d8b4', rail: '#aab4b0', building: '#d4d9d5', border: '#8eaba2', text: '#4a6259', halo: '#fffef9' },
  dark: { land: '#182833', urban: '#20343f', industrial: '#293b49', wood: '#25473f', grass: '#2c483e', sand: '#49463a', water: '#223f56', road: '#48616e', casing: '#14232e', main: '#8e8270', rail: '#6c8188', building: '#344c59', border: '#718e96', text: '#ccdde3', halo: '#14232e' },
};

/** Smooth, directly drawn vector tiles; the z14 source stays vector-sharp when overzoomed. */
export function createResultsMap(root, { onSelect = () => {}, getLang = () => 'fr' } = {}) {
  const host = document.createElement('section'); host.className = 'results-map';
  const canvas = document.createElement('canvas'); canvas.className = 'results-map-canvas'; canvas.tabIndex = 0;
  const markers = document.createElement('div'); markers.className = 'results-map-markers';
  const controls = document.createElement('div'); controls.className = 'results-map-controls';
  const status = document.createElement('div'); status.className = 'results-map-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const statusText = document.createElement('span'), retry = document.createElement('button'); retry.type = 'button'; status.append(statusText, retry);
  const attribution = document.createElement('div'); attribution.className = 'results-map-attribution';
  attribution.innerHTML = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> · <a href="https://openfreemap.org/" target="_blank" rel="noopener noreferrer">OpenFreeMap</a>';
  const makeControl = (text, action) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.addEventListener('click', action); controls.append(b); return b; };
  const plus = makeControl('+', () => zoomBy(1)), minus = makeControl('−', () => zoomBy(-1)), fit = makeControl('', fitAll);
  host.append(canvas, markers, controls, status, attribution); root.append(host);
  const g = canvas.getContext('2d'), tiles = new Map(), buttons = new Map(), removers = [];
  let places = [], selected = null, width = 500, height = 280, dead = false, frame = null, active = 0, needed = new Set(), autoFit = true;
  let camera = fitBounds([], width, height), drag = null, signature = '';
  const text = () => words[getLang()] ?? words.fr;
  const listen = (el, type, fn, options) => { el.addEventListener(type, fn, options); removers.push(() => el.removeEventListener(type, fn, options)); };
  const scale = () => 256 * 2 ** camera.zoom;
  const screen = (x, y) => [(x - camera.x) * scale() + width / 2, (y - camera.y) * scale() + height / 2];
  const schedule = () => { if (!dead && frame === null) frame = requestAnimationFrame(draw); };
  function labels() {
    const w = text(); host.setAttribute('aria-label', w.map); canvas.setAttribute('aria-label', `${w.map}. ${w.help}`);
    plus.title = plus.ariaLabel = w.in; minus.title = minus.ariaLabel = w.out; fit.textContent = w.fit; retry.textContent = w.retry;
    schedule();
  }
  function tilePath(geometry) {
    const path = new Path2D();
    const bounds = [Infinity, Infinity, -Infinity, -Infinity];
    for (const line of geometry) {
      if (!line.length) continue; path.moveTo(line[0].x, line[0].y);
      for (let i = 0; i < line.length; i++) {
        const p = line[i]; if (i) path.lineTo(p.x, p.y);
        bounds[0] = Math.min(bounds[0], p.x); bounds[1] = Math.min(bounds[1], p.y); bounds[2] = Math.max(bounds[2], p.x); bounds[3] = Math.max(bounds[3], p.y);
      }
    }
    return { path, bounds };
  }
  function decode(buf) {
    const vt = new VectorTile(new Protobuf(new Uint8Array(buf))), shapes = [], names = [];
    for (const layerName of ['landcover', 'landuse', 'park', 'water', 'waterway', 'building', 'transportation', 'boundary', 'place', 'transportation_name']) {
      const layer = vt.layers[layerName]; if (!layer) continue;
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i), p = f.properties, geometry = f.loadGeometry();
        if ((layerName === 'place' || layerName === 'transportation_name') && p.name) {
          const point = geometry[0]?.[Math.floor((geometry[0]?.length ?? 1) / 2)];
          if (point && point.x >= 0 && point.y >= 0 && point.x < layer.extent && point.y < layer.extent) names.push({ p, x: point.x / layer.extent, y: point.y / layer.extent, road: layerName === 'transportation_name' });
        } else if (f.type === 2 || f.type === 3) shapes.push({ layer: layerName, p, type: f.type, extent: layer.extent, ...tilePath(geometry) });
      }
    }
    return { shapes, names };
  }
  function pump() {
    if (dead) return;
    for (const [key, tile] of tiles) {
      if (active >= 6) break;
      if (tile.state !== 'queued' || !needed.has(key)) continue;
      active++; tile.state = 'loading'; tile.controller = new AbortController();
      tile.timedOut = false;
      tile.timeout = setTimeout(() => { tile.timedOut = true; tile.controller.abort(); }, 15000);
      fetch(`/api/tiles/${key}`, { signal: tile.controller.signal }).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
        .then(buf => { if (!dead) { Object.assign(tile, decode(buf)); tile.state = 'ready'; } })
        .catch(e => { if (!dead) tile.state = e.name === 'AbortError' && !tile.timedOut ? 'queued' : 'error'; })
        .finally(() => { clearTimeout(tile.timeout); active--; if (!dead) { schedule(); pump(); } });
    }
  }
  function roadWidth(p) {
    const c = p.class;
    if (c === 'motorway' || c === 'trunk') return camera.zoom < 9 ? 1.4 : 3.3;
    if (c === 'primary' || c === 'secondary') return camera.zoom < 10 ? 1.1 : 2.7;
    if (c === 'tertiary' || c === 'minor' || c === 'residential') return camera.zoom >= 11 ? 2.2 : 0;
    return camera.zoom >= 13 ? (c === 'path' || c === 'footway' ? 1 : 1.7) : 0;
  }
  function drawTile(tile, tx, ty, z, colors, labelsOut) {
    const n = 2 ** z, size = scale() / n, [sx, sy] = screen(tx / n, ty / n);
    g.save(); g.beginPath(); g.rect(sx, sy, size + .25, size + .25); g.clip();
    for (const f of tile.shapes) {
      const { p, layer, type, path, extent, bounds } = f;
      // At zoom 17 only a fraction of a source z14 tile is visible.
      const margin = 8 * extent / size;
      if (bounds[2] < -sx * extent / size - margin || bounds[0] > (width - sx) * extent / size + margin || bounds[3] < -sy * extent / size - margin || bounds[1] > (height - sy) * extent / size + margin) continue;
      let fill = null, stroke = null, line = 1, dashed = false;
      if (layer === 'landcover') fill = /wood|forest/.test(p.class) ? colors.wood : p.class === 'sand' ? colors.sand : /grass|farmland/.test(p.class) ? colors.grass : null;
      else if (layer === 'landuse') fill = /commercial|industrial|retail/.test(p.class) ? colors.industrial : /residential|suburb|neighbourhood|quarter/.test(p.class) ? colors.urban : null;
      else if (layer === 'park') fill = colors.grass;
      else if (layer === 'water') fill = colors.water;
      else if (layer === 'waterway' && p.brunnel !== 'tunnel') { stroke = colors.water; line = p.class === 'river' ? 2 : 1; }
      else if (layer === 'building' && camera.zoom >= 13) fill = colors.building;
      else if (layer === 'boundary' && !p.maritime && Number(p.admin_level) <= 4) { stroke = colors.border; line = .8; dashed = true; }
      else if (layer === 'transportation' && p.brunnel !== 'tunnel') {
        line = roadWidth(p) * Math.max(1, 1 + (camera.zoom - 14) * .25);
        stroke = p.class === 'rail' ? colors.rail : /motorway|trunk|primary/.test(p.class) ? colors.main : colors.road;
        if (p.class === 'rail') { dashed = true; line = camera.zoom >= 11 ? 1 : 0; }
      }
      if ((!fill || type !== 3) && (!stroke || !line)) continue;
      const k = size / extent; g.save(); g.translate(sx, sy); g.scale(k, k);
      if (fill && type === 3) { g.fillStyle = fill; g.fill(path, 'evenodd'); }
      if (stroke && line) {
        g.lineWidth = line / k; g.lineCap = g.lineJoin = 'round'; g.strokeStyle = stroke;
        if (dashed) g.setLineDash([3 / k, 3 / k]);
        if (layer === 'transportation' && !dashed) { g.strokeStyle = colors.casing; g.lineWidth = (line + 1.3) / k; g.stroke(path); g.strokeStyle = stroke; g.lineWidth = line / k; }
        g.stroke(path);
      }
      g.restore();
    }
    g.restore();
    for (const label of tile.names) {
      const cls = label.p.class;
      const minZoom = label.road ? 15 : cls === 'city' ? 4 : cls === 'town' ? 9 : /village|suburb/.test(cls) ? 11 : /country|state|province/.test(cls) ? 4 : 13;
      if (camera.zoom < minZoom || (/country|state|province/.test(cls) && camera.zoom > 10)) continue;
      labelsOut.push({ ...label, sx: sx + label.x * size, sy: sy + label.y * size });
    }
  }
  function draw() {
    frame = null; if (dead) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = Math.round(width * dpr), h = Math.round(height * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.imageSmoothingEnabled = true;
    const colors = palettes[document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'];
    g.fillStyle = colors.land; g.fillRect(0, 0, width, height);
    const z = clamp(Math.floor(camera.zoom), 4, 14), n = 2 ** z, k = scale();
    const x0 = clamp(Math.floor((camera.x - width / (2 * k)) * n), 0, n - 1), x1 = clamp(Math.floor((camera.x + width / (2 * k)) * n), 0, n - 1);
    const y0 = clamp(Math.floor((camera.y - height / (2 * k)) * n), 0, n - 1), y1 = clamp(Math.floor((camera.y + height / (2 * k)) * n), 0, n - 1);
    needed = new Set(); let loading = false, failed = false; const mapLabels = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const key = `${z}/${x}/${y}`; needed.add(key);
      if (!tiles.has(key)) tiles.set(key, { state: 'queued' });
      const tile = tiles.get(key); tile.used = performance.now();
      if (tile.state === 'ready') drawTile(tile, x, y, z, colors, mapLabels);
      else if (tile.state === 'error') failed = true; else loading = true;
    }
    // Moving across town should not wait behind six obsolete downloads.
    for (const [key, tile] of tiles) if (tile.state === 'loading' && !needed.has(key)) tile.controller.abort();
    if (tiles.size > 96) for (const [key, tile] of [...tiles].sort((a, b) => (a[1].used ?? 0) - (b[1].used ?? 0))) {
      if (tiles.size <= 96) break; if (!needed.has(key) && tile.state !== 'loading') tiles.delete(key);
    }
    const boxes = []; g.font = '11px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const label of mapLabels.sort((a, b) => Number(a.road) - Number(b.road))) {
      if (label.sx < -60 || label.sy < -10 || label.sx > width + 60 || label.sy > height + 10 || boxes.length >= 150) continue;
      const name = label.p[`name:${getLang()}`] || label.p.name, tw = g.measureText(name).width;
      const box = [label.sx - tw / 2 - 4, label.sy - 8, label.sx + tw / 2 + 4, label.sy + 8];
      if (boxes.some(b => b[0] < box[2] && b[2] > box[0] && b[1] < box[3] && b[3] > box[1])) continue;
      boxes.push(box); g.lineWidth = 3; g.strokeStyle = colors.halo; g.strokeText(name, label.sx, label.sy); g.fillStyle = colors.text; g.fillText(name, label.sx, label.sy);
    }
    for (const place of places) {
      const b = buttons.get(String(place.id)), [sx, sy] = screen(...place.point), visible = sx > -24 && sy > -24 && sx < width + 24 && sy < height + 24;
      b.hidden = !visible; b.style.left = `${sx}px`; b.style.top = `${sy}px`;
      const isSelected = String(place.id) === selected; b.classList.toggle('selected', isSelected); b.setAttribute('aria-pressed', String(isSelected));
    }
    statusText.textContent = failed ? text().error : !places.length ? text().empty : loading ? text().loading : '';
    status.hidden = !statusText.textContent; retry.hidden = !failed; host.setAttribute('aria-busy', String(loading)); pump();
  }
  function setPlaces(next = []) {
    if (dead) return;
    const unique = new Map();
    for (const p of next) if (p.id != null && validCoordinates(p)) unique.set(String(p.id), p);
    const normalized = [...unique.values()].map(p => ({ ...p, point: project(Number(p.lat), Number(p.lon)) }));
    const nextSignature = normalized.map(p => `${p.id}:${p.lat}:${p.lon}`).join('|'), changed = signature !== nextSignature; signature = nextSignature;
    places = normalized;
    const ids = new Set(places.map(p => String(p.id)));
    for (const [id, b] of buttons) if (!ids.has(id)) { b.remove(); buttons.delete(id); }
    for (const p of places) {
      const id = String(p.id); let b = buttons.get(id);
      if (!b) {
        b = document.createElement('button'); b.type = 'button'; b.className = 'results-map-marker';
        const dot = document.createElement('span'); dot.className = 'results-map-dot'; dot.textContent = '•'; dot.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span'); label.className = 'results-map-name'; b.append(dot, label);
        b.addEventListener('click', () => { selectPlace(id, { focus: true }); const current = places.find(p => String(p.id) === id); if (current) onSelect(current.id, current); });
        markers.append(b); buttons.set(id, b);
      }
      b.setAttribute('aria-label', p.name || id); b.title = p.name || id; b.querySelector('.results-map-name').textContent = p.name || id;
    }
    if (!ids.has(selected)) selected = null;
    if (changed && autoFit) camera = fitBounds(places.map(p => p.point), width, height);
    labels(); schedule();
  }
  function selectPlace(id, { focus = true } = {}) {
    if (dead) return;
    selected = id == null ? null : String(id); const p = places.find(p => String(p.id) === selected);
    if (p && focus) { autoFit = false; camera = { x: p.point[0], y: p.point[1], zoom: 16.5 }; }
    schedule();
  }
  function fitAll() { if (dead) return; autoFit = true; camera = fitBounds(places.map(p => p.point), width, height); schedule(); }
  function zoomBy(amount, sx = width / 2, sy = height / 2) {
    autoFit = false; const old = scale(), wx = camera.x + (sx - width / 2) / old, wy = camera.y + (sy - height / 2) / old;
    camera.zoom = clamp(camera.zoom + amount, 4, 17); camera.x = clamp(wx - (sx - width / 2) / scale(), 0, 1); camera.y = clamp(wy - (sy - height / 2) / scale(), 0, 1); schedule();
  }
  function resize() { if (dead) return; const r = host.getBoundingClientRect(); if (r.width > 0 && r.height > 0) { width = r.width; height = r.height; if (autoFit) camera = fitBounds(places.map(p => p.point), width, height); } schedule(); }
  listen(canvas, 'wheel', e => { e.preventDefault(); const r = canvas.getBoundingClientRect(); zoomBy(-Math.sign(e.deltaY) * .4, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  listen(canvas, 'pointerdown', e => { if (e.button !== 0) return; autoFit = false; drag = { id: e.pointerId, x: e.clientX, y: e.clientY, cx: camera.x, cy: camera.y }; canvas.setPointerCapture(e.pointerId); host.classList.add('dragging'); });
  listen(canvas, 'pointermove', e => { if (!drag || drag.id !== e.pointerId) return; camera.x = clamp(drag.cx - (e.clientX - drag.x) / scale(), 0, 1); camera.y = clamp(drag.cy - (e.clientY - drag.y) / scale(), 0, 1); schedule(); });
  const endDrag = () => { drag = null; host.classList.remove('dragging'); };
  listen(canvas, 'pointerup', endDrag); listen(canvas, 'pointercancel', endDrag); listen(canvas, 'lostpointercapture', endDrag);
  listen(canvas, 'keydown', e => {
    const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (dirs[e.key]) { e.preventDefault(); autoFit = false; camera.x = clamp(camera.x + dirs[e.key][0] * 60 / scale(), 0, 1); camera.y = clamp(camera.y + dirs[e.key][1] * 60 / scale(), 0, 1); schedule(); }
    else if (e.key === '+' || e.key === '=' || e.key === '-') { e.preventDefault(); zoomBy(e.key === '-' ? -1 : 1); }
  });
  listen(retry, 'click', () => { for (const tile of tiles.values()) if (tile.state === 'error') tile.state = 'queued'; schedule(); });
  listen(document, 'prosper-theme', schedule); listen(document, 'prosper-language', labels); listen(window, 'resize', resize);
  const observer = new ResizeObserver(resize); observer.observe(host);
  const themeObserver = new MutationObserver(schedule); themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  labels(); resize();
  return { setPlaces, selectPlace, fitAll, resize, destroy() {
    if (dead) return; dead = true; if (frame !== null) cancelAnimationFrame(frame);
    for (const tile of tiles.values()) { clearTimeout(tile.timeout); tile.controller?.abort(); } observer.disconnect(); themeObserver.disconnect(); for (const remove of removers) remove(); tiles.clear(); buttons.clear(); places = []; host.remove();
  } };
}
