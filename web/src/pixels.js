// La boîte à outils du pixel art (reprise du Bureau des agents) : de toutes petites toiles dessinées pixel par pixel,
// agrandies sans flou. Tout le QG (la ville, les robots, les icônes) est dessiné ici, en code : aucune image externe.

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

export function g2d(c) {
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  return g;
}

export function rect(g, x, y, w, h, color) {
  g.fillStyle = color;
  g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

export function px(g, x, y, color) {
  g.fillStyle = color;
  g.fillRect(Math.round(x), Math.round(y), 1, 1);
}

/** Ajoute un contour d'un pixel autour de tout ce qui est opaque (la silhouette « pixel art »). */
export function outline(c, color, opts = {}) {
  const g = c.getContext('2d');
  const w = c.width, h = c.height;
  const d = g.getImageData(0, 0, w, h).data;
  const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 40;
  const out = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (solid(x, y)) continue;
      let hit = solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || (!opts.skipBottom && solid(x, y + 1));
      if (!hit && opts.diagonal) hit = solid(x - 1, y - 1) || solid(x + 1, y - 1) || solid(x - 1, y + 1) || solid(x + 1, y + 1);
      if (hit) out.push(x, y);
    }
  }
  g.fillStyle = color;
  for (let i = 0; i < out.length; i += 2) g.fillRect(out[i], out[i + 1], 1, 1);
  return c;
}

/** Un sprite décrit en texte : une ligne par rangée, un caractère par pixel (« . » = transparent). */
export function fromRows(rows, pal) {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const c = makeCanvas(w, h);
  const g = g2d(c);
  for (let y = 0; y < h; y++) {
    const r = rows[y];
    for (let x = 0; x < r.length; x++) {
      const ch = r[x];
      if (ch === '.' || ch === ' ') continue;
      if (pal[ch]) px(g, x, y, pal[ch]);
    }
  }
  return c;
}

export function mirror(src) {
  const c = makeCanvas(src.width, src.height);
  const g = g2d(c);
  g.translate(src.width, 0);
  g.scale(-1, 1);
  g.drawImage(src, 0, 0);
  return c;
}

/* ------------------------------------------------------------------ les couleurs */
export function parse(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

export function mix(a, b, t) {
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  return toHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}
export const lighten = (c, t) => mix(c, '#ffffff', t);
export const darken = (c, t) => mix(c, '#100c1c', t);
export function rgba(hex, a) {
  const [r, g, b] = parse(hex);
  return `rgba(${r},${g},${b},${a})`;
}
/** Une couleur au format des pixels d'une ImageData (Uint32, petit-boutiste : 0xAABBGGRR). */
export function u32(hex, a = 255) {
  const [r, g, b] = parse(hex);
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

/** Un petit générateur pseudo-aléatoire, pour que la ville soit toujours la même. */
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
/** Un hasard fixe attaché à un point (deux entiers) : entre 0 et 1. */
export function hash2(x, y) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/* ------------------------------------------------------------------ la palette du Bureau (le soir, chez VibesMoney : noir, bois chaud, un seul orange) */
export const P = {
  ink: '#15121d',
  inkSoft: '#231e2e',
  orange: '#ff8a3d',
  orangeHi: '#ffb27a',
  orangeLight: '#ffd2a8',
  orangeDark: '#d9622a',
  orangeDeep: '#9e4019',
  paper: '#f6f2e9',
  paperShade: '#d8d1c3',
  paperLine: '#a19a8c',
  metal: '#9a9fb5',
  metalHi: '#cfd2e0',
  metalDark: '#62667c',
  tech: '#262431',
  techMid: '#363443',
  techHi: '#4d4a5e',
  leafDeep: '#1f4733',
  leafDark: '#285e40',
  leaf: '#348050',
  leafHi: '#52a868',
  leafLight: '#86cf7c',
  white: '#f7f5fc',
};

