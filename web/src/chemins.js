// Les chemins des robots : le graphe des vraies rues (OpenStreetMap) et le plus court chemin (A*) d'un point à un autre.
// Les tuiles découpent les rues à leur bord : les bouts qui pendent sont recollés à la rue la plus proche.

const SNAP = 0.25; // m

export function buildGraph(city) {
  const xs = [], ys = [];
  const index = new Map();
  const adj = [];
  const node = (x, y) => {
    const k = `${Math.round(x / SNAP)},${Math.round(y / SNAP)}`;
    let i = index.get(k);
    if (i === undefined) { i = xs.length; xs.push(x); ys.push(y); adj.push([]); index.set(k, i); }
    return i;
  };
  const link = (a, b) => {
    if (a === b) return;
    const d = Math.hypot(xs[a] - xs[b], ys[a] - ys[b]);
    if (!adj[a].some((e) => e[0] === b)) adj[a].push([b, d]);
    if (!adj[b].some((e) => e[0] === a)) adj[b].push([a, d]);
  };
  const unlink = (a, b) => {
    adj[a] = adj[a].filter((e) => e[0] !== b);
    adj[b] = adj[b].filter((e) => e[0] !== a);
  };
  for (const r of city.roads) {
    if (r.cls === 'motorway') continue;
    let prev = -1;
    for (const [x, y] of r.pts) {
      const i = node(x, y);
      if (prev >= 0) link(prev, i);
      prev = i;
    }
  }
  // l'index des segments (cases de 8 m)
  const CELL = 8;
  const segs = new Map();
  const key = (gx, gy) => gx * 100003 + gy;
  const indexedSegments = new Map();
  const addSeg = (a, b) => {
    const id = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (indexedSegments.has(id)) return;
    const segment = [a, b];
    indexedSegments.set(id, segment);
    const ax = xs[a], ay = ys[a], bx = xs[b], by = ys[b];
    if (![ax, ay, bx, by].every(Number.isFinite)) return;
    let gx = Math.floor(ax / CELL), gy = Math.floor(ay / CELL);
    const endX = Math.floor(bx / CELL), endY = Math.floor(by / CELL);
    const dx = bx - ax, dy = by - ay, stepX = Math.sign(dx), stepY = Math.sign(dy);
    const deltaX = dx ? Math.abs(CELL / dx) : Infinity, deltaY = dy ? Math.abs(CELL / dy) : Infinity;
    let nextX = dx ? ((stepX > 0 ? gx + 1 : gx) * CELL - ax) / dx : Infinity;
    let nextY = dy ? ((stepY > 0 ? gy + 1 : gy) * CELL - ay) / dy : Infinity;
    const visited = new Set();
    const put = (x, y) => {
      const k = key(x, y);
      if (visited.has(k)) return;
      visited.add(k);
      let entries = segs.get(k);
      if (!entries) { entries = []; segs.set(k, entries); }
      entries.push(segment);
    };
    put(gx, gy);
    // Supercover DDA indexes only cells crossed by the real segment. A 3 km
    // diagonal is linear in its length, rather than filling its entire square.
    while (gx !== endX || gy !== endY) {
      const tx = gx === endX ? Infinity : nextX, ty = gy === endY ? Infinity : nextY;
      if (Math.abs(tx - ty) < 1e-12) {
        put(gx + stepX, gy); put(gx, gy + stepY);
        gx += stepX; gy += stepY; nextX += deltaX; nextY += deltaY;
      } else if (tx < ty) { gx += stepX; nextX += deltaX; }
      else { gy += stepY; nextY += deltaY; }
      put(gx, gy);
    }
  };
  for (let a = 0; a < adj.length; a++) for (const [b] of adj[a]) if (a < b) addSeg(a, b);
  const nearSegs = (x, y, r) => {
    const out = new Set();
    for (let gx = Math.floor((x - r) / CELL); gx <= Math.floor((x + r) / CELL); gx++) {
      for (let gy = Math.floor((y - r) / CELL); gy <= Math.floor((y + r) / CELL); gy++) {
        for (const s of segs.get(key(gx, gy)) ?? []) out.add(s);
      }
    }
    return out;
  };
  const project = (x, y, a, b) => {
    const ax = xs[a], ay = ys[a], dx = xs[b] - ax, dy = ys[b] - ay, L2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
    const qx = ax + t * dx, qy = ay + t * dy;
    return { t, x: qx, y: qy, d: Math.hypot(x - qx, y - qy) };
  };
  // recoller les bouts qui pendent (bords des tuiles, rues qui s'arrêtent à un mètre d'une autre)
  const n0 = adj.length;
  for (let i = 0; i < n0; i++) {
    if (adj[i].length !== 1) continue;
    let best = null;
    for (const [a, b] of nearSegs(xs[i], ys[i], 1.6)) {
      if (a === i || b === i || adj[a] === undefined) continue;
      if (!adj[a].some((e) => e[0] === b)) continue; // segment déjà coupé
      const p = project(xs[i], ys[i], a, b);
      if (p.d < 1.6 && (!best || p.d < best.p.d)) best = { a, b, p };
    }
    if (!best) continue;
    const { a, b, p } = best;
    if (p.t < 0.02) link(i, a);
    else if (p.t > 0.98) link(i, b);
    else {
      const m = node(p.x, p.y);
      unlink(a, b);
      link(a, m); link(m, b); link(i, m);
      addSeg(a, m); addSeg(m, b);
    }
  }

  /** Le point du graphe le plus proche (sur un segment), et ses deux bouts. */
  function nearest(x, y, maxR = 120) {
    for (let r = 10; r <= maxR; r *= 2) {
      let best = null;
      for (const [a, b] of nearSegs(x, y, r)) {
        if (!adj[a].some((e) => e[0] === b)) continue;
        const p = project(x, y, a, b);
        if (!best || p.d < best.p.d) best = { a, b, p };
      }
      if (best && best.p.d <= r) return best;
    }
    return null;
  }

  /** Le plus court chemin entre deux points (en mètres) : une liste de points le long des rues. */
  function path(ax, ay, bx, by) {
    const s = nearest(ax, ay), t = nearest(bx, by);
    if (!s || !t) return [[ax, ay], [bx, by]];
    const N = xs.length;
    const S = N, T = N + 1; // deux nœuds provisoires : les projections du départ et de l'arrivée
    const pos = (i) => (i === S ? [s.p.x, s.p.y] : i === T ? [t.p.x, t.p.y] : [xs[i], ys[i]]);
    const neigh = (i) => {
      if (i === S) return [[s.a, s.p.d * 0 + Math.hypot(s.p.x - xs[s.a], s.p.y - ys[s.a])], [s.b, Math.hypot(s.p.x - xs[s.b], s.p.y - ys[s.b])], ...sameSeg()];
      const out = adj[i].slice();
      if (i === t.a) out.push([T, Math.hypot(t.p.x - xs[t.a], t.p.y - ys[t.a])]);
      if (i === t.b) out.push([T, Math.hypot(t.p.x - xs[t.b], t.p.y - ys[t.b])]);
      return out;
    };
    function sameSeg() {
      const same = (s.a === t.a && s.b === t.b) || (s.a === t.b && s.b === t.a);
      return same ? [[T, Math.hypot(s.p.x - t.p.x, s.p.y - t.p.y)]] : [];
    }
    const g = new Map([[S, 0]]);
    const from = new Map();
    const heap = new Heap();
    const h = (i) => { const [x, y] = pos(i); return Math.hypot(x - t.p.x, y - t.p.y); };
    heap.push(S, h(S));
    const closed = new Set();
    let found = false, guard = 0;
    while (heap.size && guard++ < 400000) {
      const u = heap.pop();
      if (u === T) { found = true; break; }
      if (closed.has(u)) continue;
      closed.add(u);
      const gu = g.get(u);
      for (const [v, w] of neigh(u)) {
        const gv = gu + w;
        if (gv < (g.get(v) ?? Infinity)) { g.set(v, gv); from.set(v, u); heap.push(v, gv + h(v)); }
      }
    }
    if (!found) return [[ax, ay], [bx, by]];
    const pts = [];
    for (let u = T; u !== undefined; u = from.get(u)) pts.push(pos(u));
    pts.reverse();
    return [[ax, ay], ...pts, [bx, by]].filter((p, i, a) => i === 0 || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 0.05);
  }

  return { nodes: xs.length, nearest, path };
}

class Heap {
  constructor() { this.k = []; this.p = []; }
  get size() { return this.k.length; }
  push(k, p) {
    const K = this.k, Pp = this.p;
    let i = K.length;
    K.push(k); Pp.push(p);
    while (i > 0) {
      const j = (i - 1) >> 1;
      if (Pp[j] <= p) break;
      K[i] = K[j]; Pp[i] = Pp[j];
      i = j;
    }
    K[i] = k; Pp[i] = p;
  }
  pop() {
    const K = this.k, Pp = this.p;
    const top = K[0];
    const k = K.pop(), p = Pp.pop();
    if (K.length) {
      let i = 0;
      const n = K.length;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && Pp[c + 1] < Pp[c]) c++;
        if (Pp[c] >= p) break;
        K[i] = K[c]; Pp[i] = Pp[c];
        i = c;
      }
      K[i] = k; Pp[i] = p;
    }
    return top;
  }
}

/** La longueur d'une ligne brisée, et le point à une distance donnée (avec la direction). */
export function polyLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}
export function pointAt(pts, d) {
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const l = Math.hypot(bx - ax, by - ay);
    if (d <= l || i === pts.length - 1) {
      const t = l ? Math.max(0, Math.min(1, d / l)) : 1;
      return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, dx: bx - ax, dy: by - ay, i };
    }
    d -= l;
  }
  const p = pts.at(-1);
  return { x: p[0], y: p[1], dx: 0, dy: 1, i: pts.length - 1 };
}
/** Décale une ligne brisée vers sa droite (le trottoir), avec des angles nets. */
export function offsetLine(pts, off) {
  if (pts.length < 2 || !off) return pts;
  const n = pts.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let n1x = 0, n1y = 0, n2x = 0, n2y = 0;
    if (i > 0) { const dx = p[0] - a[0], dy = p[1] - a[1], l = Math.hypot(dx, dy) || 1; n1x = -dy / l; n1y = dx / l; }
    if (i < n - 1) { const dx = b[0] - p[0], dy = b[1] - p[1], l = Math.hypot(dx, dy) || 1; n2x = -dy / l; n2y = dx / l; }
    if (i === 0) { n1x = n2x; n1y = n2y; }
    if (i === n - 1) { n2x = n1x; n2y = n1y; }
    let mx = n1x + n2x, my = n1y + n2y;
    const ml = Math.hypot(mx, my) || 1;
    mx /= ml; my /= ml;
    const cos = mx * n1x + my * n1y;
    const k = Math.min(2.2, 1 / Math.max(0.3, cos));
    // à droite du sens de la marche (y vers le bas : la normale (-dy, dx) pointe à droite)
    out.push([p[0] + mx * off * k, p[1] + my * off * k]);
  }
  return out;
}

