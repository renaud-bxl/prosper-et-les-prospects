// Les petits dessins du QG, en pixel art et en code : le QG lui-même, les repères des commerces (le « ? » de l'éclaireur,
// le « ! » d'un client potentiel, l'enveloppe d'un mail prêt), la lettre qui vole, la poussière des robots pressés.
import { pixelText, textWidth } from './font.js';
import { t as tr, getLang } from './i18n.js';
import { darken, g2d, lighten, makeCanvas, outline, P, px, rect } from './pixels.js';

const cache = new Map();
const memo = (key, fn) => { let c = cache.get(key); if (!c) { c = fn(); cache.set(key, c); } return c; };

/* ------------------------------------------------------------------ le QG des agents */
// Dessiné à l'échelle de la ville au plus fin (0,5 m par pixel) : 92 × 52 px au sol (46 × 26 m), une façade de 30 px.
export const QG = { w: 92, d: 52, h: 30 };
export function qgSprite(tod, lit = 1) {
  return memo(`qg|${getLang()}|${tod}|${lit}`, () => {
    const { w, d, h } = QG;
    const c = makeCanvas(w + 2, d + h + 14);
    const g = g2d(c);
    const top = 12; // la place des enseignes au-dessus du toit
    const night = tod !== 'jour';
    // le toit
    rect(g, 1, top, w, d, '#2b2838');
    rect(g, 1, top, w, 1, '#4a4560');
    rect(g, 1, top + d - 1, w, 1, '#56506e');
    rect(g, 2, top + 1, w - 2, 1, '#38344a');
    // la piste de l'éclaireur (à droite)
    const hx = w - 18, hy = top + 8;
    for (let y = -9; y <= 9; y++) for (let x = -9; x <= 9; x++) {
      const r = Math.hypot(x, y);
      if (r <= 9.4 && r >= 8.2) px(g, hx + x, hy + y + 6, P.orange);
      else if (r < 8.2) px(g, hx + x, hy + y + 6, '#34304a');
    }
    // un H en pixels au milieu de la piste
    rect(g, hx - 3, hy + 2, 1, 7, P.orangeHi); rect(g, hx + 2, hy + 2, 1, 7, P.orangeHi); rect(g, hx - 3, hy + 5, 6, 1, P.orangeHi);
    // l'antenne et sa parabole
    rect(g, 8, top + 22, 1, 10, '#9a9fb5');
    rect(g, 5, top + 19, 7, 2, '#cfd2e0'); rect(g, 6, top + 18, 5, 1, '#e8e5f1');
    px(g, 8, top + 17, P.orange);
    // les bouches d'aération et une verrière
    for (const [x, y] of [[16, top + 40], [24, top + 40], [16, top + 34]]) { rect(g, x, y, 5, 3, '#4d4a5e'); rect(g, x, y, 5, 1, '#6d6a80'); }
    rect(g, 38, top + 30, 22, 14, '#1d2235'); for (let x = 39; x < 60; x += 4) rect(g, x, top + 31, 3, 12, night ? '#3d4670' : '#5a6c9c');
    if (night) { rect(g, 43, top + 34, 2, 3, '#ffcf6b'); rect(g, 51, top + 38, 2, 3, '#ffcf6b'); }
    // l'enseigne : la tête du robot VibesMoney, en grand, posée sur le toit
    const bx = 18, by = 0;
    rect(g, bx + 1, by + 14, 1, 6, '#5b566a'); rect(g, bx + 14, by + 14, 1, 6, '#5b566a');
    rect(g, bx, by, 16, 3, '#77718a');
    rect(g, bx, by + 3, 16, 11, '#4a4658');
    rect(g, bx + 15, by + 3, 1, 11, '#33303f');
    rect(g, bx + 2, by + 5, 12, 6, '#0b0910');
    rect(g, bx + 2, by + 5, 4, 1, '#4a4566');
    for (const ex of [bx + 4, bx + 9]) { rect(g, ex, by + 7, 3, 3, P.orange); px(g, ex, by + 7, '#ffe2c4'); }
    rect(g, bx + 7, by - 2, 2, 2, P.orange);
    // la façade : du verre sombre, un néon orange, la porte allumée
    const fy = top + d;
    rect(g, 1, fy, w, h, '#1f2234');
    for (let x = 3; x < w - 1; x += 6) {
      rect(g, x, fy + 3, 4, h - 8, night ? '#2d3456' : '#3c4a74');
      rect(g, x, fy + 3, 1, h - 8, night ? '#3d4670' : '#5a6c9c');
      if (night && (x * 7) % 5 < 3) rect(g, x + 1, fy + 5, 2, 3, '#ffcf6b');
    }
    rect(g, 1, fy, w, 2, P.orange);
    rect(g, 1, fy + 1, w, 1, P.orangeDark);
    // Enseigne courte du quartier général au-dessus de la porte
    const label = tr('QG PROSPER');
    const tw = textWidth(label);
    rect(g, Math.floor((w - tw) / 2) - 1, fy + 3, tw + 4, 7, '#100d16');
    pixelText(g, label, Math.floor((w - tw) / 2) + 1, fy + 4, P.orangeHi);
    // la porte
    const dx = Math.floor(w / 2) - 5;
    rect(g, dx, fy + 11, 12, h - 11, '#100d16');
    rect(g, dx + 1, fy + 12, 4, h - 12, lit ? '#ffcf6b' : '#3d4670');
    rect(g, dx + 6, fy + 12, 5, h - 12, lit ? '#ffb15a' : '#2d3456');
    rect(g, dx + 5, fy + 12, 1, h - 12, '#100d16');
    rect(g, 1, fy + h - 1, w, 1, '#100d16');
    outline(c, '#07060b');
    return { c, ax: 1, ay: top + d + h - 1, top };
  });
}

/* ------------------------------------------------------------------ les repères des commerces */
// Une bulle de jeu au-dessus de la porte : « ? » (repéré), « … » (en lecture), « ! » (client potentiel), enveloppe (mail prêt)…
const BADGE = {
  trouve: { bg: '#fbfaff', ink: '#15121d', glyph: '?' },
  lecture: { bg: '#4FB3FF', ink: '#0b1830', glyph: 'dots' },
  retenu: { bg: P.orange, ink: '#2a1206', glyph: '!' },
  ecarte: { bg: '#8a8598', ink: '#2a2733', glyph: 'x' },
  ecriture: { bg: '#A98BFF', ink: '#1a1033', glyph: 'pen' },
  pret: { bg: P.orange, ink: '#2a1206', glyph: 'mail' },
  valide: { bg: '#3DDC97', ink: '#06261a', glyph: 'check' },
  refuse: { bg: '#8a8598', ink: '#2a2733', glyph: 'x' },
  saute: { bg: '#4a4558', ink: '#c9c3d6', glyph: 'pause' },
};
export function badgeSprite(state, frame = 0) {
  const b = BADGE[state] ?? BADGE.trouve;
  return memo(`badge|${state}|${b.glyph === 'dots' ? frame % 3 : 0}`, () => {
    const W = 13, H = 14;
    const c = makeCanvas(W + 2, H + 2);
    const g = g2d(c);
    const small = state === 'ecarte' || state === 'refuse' || state === 'saute';
    // la bulle (coins arrondis) et sa pointe
    rect(g, 2, 1, W - 2, H - 4, b.bg);
    rect(g, 1, 2, W, H - 6, b.bg);
    rect(g, 5, H - 3, 4, 1, b.bg);
    rect(g, 6, H - 2, 2, 1, b.bg);
    // reflet
    rect(g, 2, 2, W - 4, 1, lighten(b.bg, 0.45));
    rect(g, 1, H - 5, W, 1, darken(b.bg, 0.18));
    const ink = b.ink;
    const cx = 7;
    switch (b.glyph) {
      case '?': rect(g, cx - 2, 3, 4, 1, ink); rect(g, cx + 1, 4, 2, 2, ink); rect(g, cx, 6, 2, 1, ink); rect(g, cx - 1, 7, 2, 1, ink); rect(g, cx - 1, 9, 2, 1, ink); break;
      case '!': rect(g, cx - 1, 3, 2, 5, ink); rect(g, cx - 1, 9, 2, 1, ink); break;
      case 'dots': for (let i = 0; i < 3; i++) rect(g, 3 + i * 3, 6, 2, 2, i === frame % 3 ? '#ffffff' : ink); break;
      case 'x': for (let i = 0; i < 5; i++) { px(g, cx - 2 + i, 4 + i, ink); px(g, cx + 2 - i, 4 + i, ink); px(g, cx - 1 + i, 4 + i, ink); px(g, cx + 1 - i, 4 + i, ink); } break;
      case 'check': for (const [x, y] of [[3, 6], [4, 7], [5, 8], [6, 7], [7, 6], [8, 5], [9, 4]]) { px(g, x, y, ink); px(g, x, y + 1, ink); } break;
      case 'mail': rect(g, 3, 4, 8, 6, '#fff7ef'); for (let i = 0; i < 4; i++) { px(g, 3 + i, 4 + i, ink); px(g, 10 - i, 4 + i, ink); } rect(g, 3, 9, 8, 1, darken('#fff7ef', 0.2)); break;
      case 'pause': rect(g, cx - 3, 4, 2, 6, ink); rect(g, cx + 1, 4, 2, 6, ink); break;
      case 'pen': for (let i = 0; i < 6; i++) { rect(g, 3 + i, 9 - i, 2, 1, '#ffd166'); } px(g, 3, 10, ink); px(g, 9, 3, '#ff8fb1'); px(g, 10, 3, '#ff8fb1'); break;
    }
    outline(c, '#15121d');
    if (small) return { c, ax: 7, ay: H + 1, small: true };
    return { c, ax: 7, ay: H + 1 };
  });
}

/** Le petit écriteau du commerce (son métier), posé sur le trottoir devant la porte. */
export function signSprite(kind = 'sport') {
  return memo(`sign|${kind}`, () => {
    const c = makeCanvas(13, 14);
    const g = g2d(c);
    rect(g, 6, 8, 1, 5, '#3a3547');
    rect(g, 1, 1, 11, 8, '#1d1a26');
    rect(g, 2, 2, 9, 6, '#2b2838');
    // un haltère
    rect(g, 3, 4, 1, 3, '#cfd2e0'); rect(g, 4, 3, 1, 5, '#e8e5f1');
    rect(g, 5, 5, 3, 1, '#9a9fb5');
    rect(g, 8, 3, 1, 5, '#e8e5f1'); rect(g, 9, 4, 1, 3, '#cfd2e0');
    rect(g, 4, 12, 5, 1, '#15121d');
    outline(c, '#15121d');
    return { c, ax: 6, ay: 12 };
  });
}

/** La lettre (le mail prêt) qui vole jusqu'à la file de validation. */
export function letterSprite() {
  return memo('letter', () => {
    const c = makeCanvas(12, 9);
    const g = g2d(c);
    rect(g, 1, 1, 10, 7, '#fff7ef');
    for (let i = 0; i < 5; i++) { px(g, 1 + i, 1 + i, '#d8d1c3'); px(g, 10 - i, 1 + i, '#d8d1c3'); }
    rect(g, 5, 4, 2, 2, P.orange);
    outline(c, '#15121d');
    return { c, ax: 6, ay: 4 };
  });
}

/** L'ombre d'un robot (ou de l'éclaireur en vol, plus petite quand il monte). */
export function shadowSprite(w) {
  return memo(`shadow|${w}`, () => {
    const c = makeCanvas(w, 4);
    const g = g2d(c);
    g.fillStyle = 'rgba(8,6,16,0.42)';
    g.fillRect(1, 0, w - 2, 4);
    g.fillRect(0, 1, w, 2);
    return { c, ax: Math.floor(w / 2), ay: 2 };
  });
}

/* ------------------------------------------------------------------ l'hologramme du site, au-dessus du commerce lu */
// Une petite fenêtre de navigateur : l'adresse du site, puis ce qui lui manque, une ligne après l'autre.
export function hologramSprite(domain, items, shown, phase) {
  const key = `holo|${getLang()}|${domain}|${items.map((i) => (i[0] ? 1 : 0) + i[1]).join(',')}|${shown}|${items.length ? 0 : phase % 8}`;
  return memo(key, () => {
    const W = 94, rows = Math.max(1, items.length);
    const H = items.length ? 13 + rows * 8 + 3 : 32;
    const c = makeCanvas(W + 2, H + 2);
    const g = g2d(c);
    rect(g, 1, 1, W, H, '#100d16');
    rect(g, 1, 1, W, 8, '#2a2535');
    for (const [i, col] of [[0, '#ff5f57'], [1, '#febc2e'], [2, '#28c840']]) rect(g, 3 + i * 4, 4, 2, 2, col);
    const d = domain.length > 19 ? domain.slice(0, 18) + '.' : domain;
    pixelText(g, d, 16, 3, '#e8e5f1');
    if (!items.length) {
      // en lecture : une barre qui balaie la page
      for (let y = 0; y < 2; y++) rect(g, 4, 13 + y * 4, 40 + y * 18, 2, '#3a3547');
      rect(g, 4 + (phase % 8) * 8, 12, 6, 7, 'rgba(255,138,61,0.55)');
      pixelText(g, tr('LECTURE'), 4, 13 + 8 + 1, P.orangeHi);
    } else {
      items.slice(0, shown).forEach(([ok, label], i) => {
        const y = 12 + i * 8;
        rect(g, 4, y, 5, 5, ok ? '#3ddc97' : '#ff5f4d');
        if (ok) { px(g, 5, y + 2, '#06261a'); px(g, 6, y + 3, '#06261a'); px(g, 7, y + 1, '#06261a'); }
        else { px(g, 5, y + 1, '#2a0b06'); px(g, 7, y + 1, '#2a0b06'); px(g, 6, y + 2, '#2a0b06'); px(g, 5, y + 3, '#2a0b06'); px(g, 7, y + 3, '#2a0b06'); }
        pixelText(g, label.length > 20 ? label.slice(0, 20) : label, 12, y, ok ? '#a39cb3' : '#fbfaff');
      });
    }
    // le liseré orange de la fenêtre
    g.strokeStyle = P.orange; g.lineWidth = 1;
    g.strokeRect(1.5, 1.5, W - 1, H - 1);
    outline(c, '#07060b');
    return { c, ax: Math.floor((W + 2) / 2), ay: H + 1 };
  });
}

