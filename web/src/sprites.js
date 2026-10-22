/* Illustrated scene materials inspired by Oscar et les Agents, public/pixel-world.js:
 * https://github.com/renaud-bxl/oscar-et-les-agents — Copyright (c) 2026 Renaud.
 * MIT License: Permission is hereby granted, free of charge, to any person obtaining
 * a copy of this software and associated documentation files (the "Software"), to
 * deal in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions: The above copyright notice and this permission
 * notice shall be included in all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 * INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
 * PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 * HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 * The headquarters and map markers below are drawn for Prosper on a 6× canvas;
 * their logical footprint and anchors preserve the existing mission choreography.
 */
import { t as tr, getLang } from './i18n.js';

const DENSITY = 6;
const cache = new Map();
const memo = (key, draw) => {
  const value = cache.has(key) ? cache.get(key) : draw();
  cache.delete(key); cache.set(key, value);
  if (cache.size > 128) cache.delete(cache.keys().next().value);
  return value;
};
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
function surface(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * DENSITY); c.height = Math.ceil(h * DENSITY);
  c.logicalWidth = w; c.logicalHeight = h; c.smooth = true;
  const g = c.getContext('2d'); g.scale(DENSITY, DENSITY);
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.lineCap = 'round'; g.lineJoin = 'round';
  return [c, g];
}
function round(g, x, y, w, h, r, fill, stroke = null, width = 0.6) {
  g.beginPath(); g.roundRect(x, y, w, h, r);
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = width; g.stroke(); }
}
function line(g, points, color, width = 0.7) {
  g.beginPath(); points.forEach(([x, y], index) => index ? g.lineTo(x, y) : g.moveTo(x, y));
  g.strokeStyle = color; g.lineWidth = width; g.stroke();
}
function ellipse(g, x, y, rx, ry, fill, rotation = 0) {
  g.beginPath(); g.ellipse(x, y, rx, ry, rotation, 0, Math.PI * 2); g.fillStyle = fill; g.fill();
}
function text(g, value, x, y, size, color, weight = 650, align = 'left') {
  g.font = `${weight} ${size}px ${FONT}`; g.textAlign = align; g.textBaseline = 'alphabetic';
  g.fillStyle = color; g.fillText(value, x, y);
}
function fitText(g, value, max) {
  let label = String(value);
  while (label.length > 1 && g.measureText(label).width > max) label = label.slice(0, -1);
  return label.length < String(value).length ? label.slice(0, -1) + '…' : label;
}
function plant(g, x, y, scale = 1, night = false) {
  g.save(); g.translate(x, y); g.scale(scale, scale);
  ellipse(g, 0, 2, 4.5, 1.3, '#263a3420');
  round(g, -3, -2, 6, 5, 1.6, night ? '#b58970' : '#d6ad8b');
  ellipse(g, 0, -2, 3, 0.8, '#e9caac');
  line(g, [[0, -2], [0, -11]], '#78927b', 0.7);
  for (const [lx, ly, angle] of [[-2.2, -5, -.6], [2, -7, .5], [-2, -9, -.6], [1.7, -11, .6]]) {
    ellipse(g, lx, ly, 2.8, 1.2, night ? '#769d88' : '#8eae91', angle);
    line(g, [[0, ly + 1], [lx, ly]], '#b2c6a6', 0.3);
  }
  g.restore();
}

export const QG = { w: 92, d: 52, h: 30 };
export function qgSprite(tod, lit = 1) {
  return memo(`hq|${getLang()}|${tod}|${lit}`, () => {
    const [c, g] = surface(94, 96);
    const night = tod === 'nuit', evening = tod === 'soir';
    const top = 12, fy = top + QG.d;
    // A warm, furnished roof terrace above the real entrance and shopfronts.
    ellipse(g, 47, 91.5, 45.5, 3.7, '#263a342b');
    const wall = g.createLinearGradient(0, fy, 0, 95);
    wall.addColorStop(0, night ? '#607a82' : '#eee6d8'); wall.addColorStop(1, night ? '#3e5966' : '#d5c3a9');
    round(g, 3, 26, 88, 68, 4, wall, '#718b87', 0.7);
    round(g, 1, top, 92, 53.5, 5, night ? '#4a6570' : '#b7ccc2', '#739385', 0.7);
    round(g, 4, top + 3, 86, 47, 3.5, night ? '#60757b' : '#d8dfcf', '#edf2df', 0.5);
    const deck = g.createLinearGradient(0, 20, 0, 57);
    deck.addColorStop(0, night ? '#8c8272' : '#e6c4a1'); deck.addColorStop(1, night ? '#776f65' : '#ccaa84');
    round(g, 9, 20, 76, 37, 3.3, deck, '#b79778', 0.45);
    for (let y = 24; y < 56; y += 4) line(g, [[10, y], [84, y]], night ? '#b4a18a38' : '#b38e6948', .35);
    for (let x = 18; x < 84; x += 18) line(g, [[x, 21], [x, 56]], '#f7e3c640', .35);
    // Skylight: curved blue glazing, with quiet reflections instead of black pixel outlines.
    round(g, 36, 29, 24, 18, 2.5, '#6b8b95', '#587583', .6);
    round(g, 37.5, 30.5, 21, 15, 1.7, night ? '#516d7b' : '#adc9cd');
    for (const x of [44.5, 51.5]) line(g, [[x, 30.5], [x, 45.5]], '#edf3e7', .65);
    line(g, [[38.5, 32], [56.5, 32]], '#ffffff78', .7);
    line(g, [[39, 44], [56.5, 33]], '#ffffff38', 1.2);
    // Pergola, outdoor work table, cushions and a mug.
    for (const x of [13, 31]) round(g, x, 19, 1, 14, .4, '#b28b6a');
    for (const y of [19, 22, 25, 28]) round(g, 12, y, 21, .9, .4, '#f4dfbc', '#c4a382', .2);
    round(g, 14, 37, 13, 8, 2, '#c0cfb7', '#93aa98', .4);
    round(g, 14.8, 37.5, 11.4, 4, 1.7, '#e4e6d0');
    ellipse(g, 21, 48, 6.5, 3.3, '#f4dfc4');
    line(g, [[21, 48.5], [21, 52]], '#a3876b', .8);
    round(g, 19.4, 46, 3.4, 1.8, .5, '#fff9e8');
    round(g, 24, 47.5, 1.6, 1.9, .6, '#9bb4a6');
    // The scout's existing roof position remains an open landing/collaboration spot.
    ellipse(g, 74, 27, 9, 6.8, '#c6d6bd');
    ellipse(g, 74, 27, 7.7, 5.7, night ? '#668b7b' : '#94b39d');
    line(g, [[74, 23.5], [74, 30.5]], '#edf2dc', .7);
    line(g, [[70.5, 27], [77.5, 27]], '#edf2dc', .7);
    plant(g, 79, 52, .95, night); plant(g, 14, 31, .6, night);
    // Roof parapet and a soft blue canopy over the illustrated façade.
    round(g, 2, 59, 90, 6, 2, night ? '#65888c' : '#b6cabb', '#769486', .5);
    round(g, 4, fy + 1, 86, 29, 2.5, wall);
    round(g, 4, fy + 8, 86, 3, 1, night ? '#63828c' : '#8eacb5');
    const glazing = g.createLinearGradient(0, fy + 12, 0, 93);
    glazing.addColorStop(0, lit && (night || evening) ? '#f4dfaf' : '#b4d1d3');
    glazing.addColorStop(1, night && lit ? '#d5ae79' : '#7199a6');
    for (const x of [8, 61]) {
      round(g, x, fy + 12, 25, 16, 1.4, glazing, '#607d86', .55);
      line(g, [[x + 12.5, fy + 12], [x + 12.5, fy + 28]], '#eef0db', .65);
      line(g, [[x + 1.5, fy + 14], [x + 10.5, fy + 14]], '#ffffff75', .65);
    }
    round(g, 40, fy + 11, 14, 19, 1.6, '#527975', '#3f625e', .6);
    round(g, 42, fy + 12.5, 10, 14, 1, lit ? '#c5ddcd' : '#8fb1ab');
    ellipse(g, 51, fy + 22, .7, .7, '#efd39f');
    round(g, 30, fy + 1.1, 36, 7, 2.2, night ? '#304d59' : '#44675e', '#719184', .4);
    text(g, tr('QG PROSPER'), 48, fy + 5.9, 3.9, '#fffbed', 750, 'center');
    round(g, 37, 93.1, 20, 1.7, .5, '#b2997c');
    plant(g, 7, 90, .55, night); plant(g, 87, 90, .55, night);
    return { c, ax: 1, ay: 95, top };
  });
}

const BADGE = {
  trouve: { bg: '#fffaf0', ink: '#4b6866', glyph: '?' },
  lecture: { bg: '#a9c5d2', ink: '#35596c', glyph: 'dots' },
  retenu: { bg: '#e7c79d', ink: '#71533e', glyph: '!' },
  ecarte: { bg: '#dce0db', ink: '#6c7e79', glyph: 'x' },
  ecriture: { bg: '#c7bed7', ink: '#61516f', glyph: 'pen' },
  pret: { bg: '#c5d9c3', ink: '#426956', glyph: 'mail' },
  valide: { bg: '#afd2b8', ink: '#3d6c51', glyph: 'check' },
  refuse: { bg: '#e0cfca', ink: '#8d675b', glyph: 'x' },
  saute: { bg: '#d5dcd6', ink: '#718179', glyph: 'pause' },
};
export function badgeSprite(state, frame = 0) {
  const b = BADGE[state] ?? BADGE.trouve;
  return memo(`badge|${state}|${b.glyph === 'dots' ? frame % 3 : 0}`, () => {
    const [c, g] = surface(15, 16);
    ellipse(g, 7.5, 14, 5.6, .9, '#34483d1c');
    g.beginPath(); g.moveTo(5.4, 11.2); g.lineTo(7.5, 14.8); g.lineTo(9.6, 11.2); g.closePath(); g.fillStyle = b.bg; g.fill();
    round(g, .8, .8, 13.4, 11.5, 3, b.bg, '#536d6438', .55);
    line(g, [[3, 2.1], [11.7, 2.1]], '#ffffff7d', .45);
    switch (b.glyph) {
      case '?': case '!': text(g, b.glyph, 7.5, 10.2, 10.4, b.ink, 750, 'center'); break;
      case 'dots': for (let i = 0; i < 3; i++) ellipse(g, 4 + i * 3.5, 7, .8, .8, i === frame % 3 ? '#fffdf6' : b.ink); break;
      case 'x': line(g, [[5, 4.6], [10, 9.6]], b.ink, 1.35); line(g, [[10, 4.6], [5, 9.6]], b.ink, 1.35); break;
      case 'check': line(g, [[3.8, 7], [6.4, 9.1], [11, 4.4]], b.ink, 1.4); break;
      case 'mail': round(g, 3, 4, 9, 6.4, 1.1, '#fffdf4', b.ink, .6); line(g, [[3.5, 4.7], [7.5, 7.7], [11.5, 4.7]], b.ink, .65); break;
      case 'pause': round(g, 4.8, 4.2, 1.7, 5.9, .5, b.ink); round(g, 8.4, 4.2, 1.7, 5.9, .5, b.ink); break;
      case 'pen': line(g, [[4.7, 9.7], [10.3, 4.1]], '#fff4dc', 2.2); line(g, [[4.7, 9.7], [10.3, 4.1]], b.ink, .8); ellipse(g, 4.2, 10.2, .6, .6, b.ink); break;
    }
    return { c, ax: 7.5, ay: 15, small: ['ecarte', 'refuse', 'saute'].includes(state) };
  });
}

export function signSprite(kind = 'commerce') {
  return memo(`sign|${kind}`, () => {
    const [c, g] = surface(13, 14);
    ellipse(g, 6.5, 12.5, 5.8, .8, '#34483d25');
    line(g, [[3.1, 7], [2.5, 12.5]], '#a98767', .85); line(g, [[9.8, 7], [10.5, 12.5]], '#a98767', .85);
    round(g, 1.2, 1, 10.6, 9, 1.5, '#e6c4a1', '#9c8268', .5);
    round(g, 2.3, 2, 8.4, 6.8, 1, '#f7f3e8');
    round(g, 4, 4.5, 5, 3.2, .4, '#9fb8a7');
    round(g, 3.4, 3.5, 6.2, 1.7, .5, '#d5a08d');
    line(g, [[6.5, 5.8], [6.5, 7.8]], '#edf2df', .45);
    return { c, ax: 6.5, ay: 12.5 };
  });
}
export function letterSprite() {
  return memo('letter', () => {
    const [c, g] = surface(12, 9);
    round(g, .7, .7, 10.6, 7.6, 1.5, '#fffaf0', '#9bb09f', .55);
    line(g, [[1.4, 1.8], [6, 5.2], [10.6, 1.8]], '#a7baaa', .6);
    line(g, [[1.4, 7.2], [4.6, 4.4]], '#cbd5c6', .45); line(g, [[10.6, 7.2], [7.4, 4.4]], '#cbd5c6', .45);
    ellipse(g, 6, 5.1, 1.05, 1.05, '#d5a08d');
    return { c, ax: 6, ay: 4.5 };
  });
}
export function shadowSprite(w) {
  return memo(`shadow|${w}`, () => {
    const [c, g] = surface(w, 4);
    const gradient = g.createRadialGradient(w / 2, 2, .5, w / 2, 2, w / 2);
    gradient.addColorStop(0, '#324b3e30'); gradient.addColorStop(1, '#324b3e00');
    ellipse(g, w / 2, 2, w / 2, 1.8, gradient);
    return { c, ax: w / 2, ay: 2 };
  });
}

export function hologramSprite(domain, items, shown, phase) {
  const key = `note|${getLang()}|${domain}|${items.map((i) => `${i[0]}:${i[1]}`).join(',')}|${shown}|${items.length ? 0 : phase % 8}`;
  return memo(key, () => {
    const W = 96, H = items.length ? 15 + items.length * 8 : 34;
    const [c, g] = surface(W, H);
    round(g, 1, 1, W - 2, H - 2, 4, '#fffdf5', '#8da496', .65);
    round(g, 1.5, 1.5, W - 3, 8, 3, '#e0e8dc');
    for (const [i, color] of ['#d6a18c', '#dfc591', '#9fbaa5'].entries()) ellipse(g, 5 + i * 3.6, 5.4, 1, 1, color);
    g.font = `650 4.8px ${FONT}`;
    text(g, fitText(g, domain, 75), 16, 6.8, 4.8, '#4b6866');
    if (!items.length) {
      round(g, 6, 14, 69, 2.4, 1, '#e1e7dc'); round(g, 6, 19, 49, 2, 1, '#edf0e7');
      round(g, 6 + (phase % 8) * 7, 14, 12, 2.4, 1, '#9bb9a5');
      text(g, tr('LECTURE'), 6, 28, 4.8, '#668b79');
    } else items.slice(0, shown).forEach(([ok, label], i) => {
      const y = 16 + i * 8;
      ellipse(g, 7, y, 2.2, 2.2, ok ? '#d3e5d4' : '#f2dfd1');
      if (ok) line(g, [[5.9, y], [6.8, y + .8], [8.3, y - 1]], '#5c886c', .65);
      else line(g, [[6.1, y - .9], [7.9, y + .9]], '#b58068', .65);
      g.font = `550 4.6px ${FONT}`;
      text(g, fitText(g, label, 78), 12, y + 1.6, 4.6, ok ? '#789184' : '#4b6866', 550);
    });
    return { c, ax: W / 2, ay: H };
  });
}
