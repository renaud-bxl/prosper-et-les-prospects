// Les robots du QG : les cubes-robots du Bureau des agents (visière noire, yeux orange), avec un corps, des bras et
// l'accessoire de leur métier. Max, le chef, est le robot noir du logo à la cravate orange ; l'équipe est blanche :
// l'éclaireur a son hélice (il survole la ville), les lecteurs leur chapeau d'explorateur (ils vont voir chaque commerce),
// les rédacteurs leur crayon. Tout est dessiné en code, pose par pose, puis gardé en mémoire.
import { darken, g2d, lighten, makeCanvas, mirror, outline, P, px, rect } from './pixels.js';

export const ROLES = {
  chef: { label: "Chef d'équipe", color: '#FF8A3D' },
  eclaireur: { label: 'Éclaireur', color: '#FFC93D' },
  lecteur: { label: 'Lecteur', color: '#4FB3FF' },
  redacteur: { label: 'Rédacteur', color: '#A98BFF' },
};

/** Taille d'un sprite de robot ; les pieds (le bas du contour) sont au point d'ancrage. */
export const ROBOT_W = 20;
export const ROBOT_H = 24;
export const ANCHOR_X = 10;
export const ANCHOR_Y = 22;

function lookOf(role) {
  if (role === 'chef') {
    return {
      chef: true, role,
      top: '#77718a', front: '#4a4658', shade: '#33303f', visor: '#0b0910', visorHi: '#4a4566',
      body: '#4a4658', bodyHi: '#615c73', bodyShade: '#33303f', arm: '#5a5569', hand: '#3d3a4a', leg: '#2a2734', tip: P.orange,
    };
  }
  const c = ROLES[role].color;
  return {
    chef: false, role,
    top: '#ffffff', front: '#e8e5f1', shade: '#c4bfd4', visor: '#15121c', visorHi: '#3d3852',
    body: c, bodyHi: lighten(c, 0.3), bodyShade: darken(c, 0.25), arm: '#d7d3e2', hand: '#b9b4c9', leg: '#3a3547', tip: c,
  };
}

const EYE = P.orange;
const EYE_HI = '#ffe2c4';
const EYE_DIM = '#c8612a';

function drawEyes(g, eyes, bob) {
  const y0 = 8 + bob;
  if (eyes === 'blink') {
    rect(g, 7, y0 + 1, 2, 1, EYE_DIM);
    rect(g, 11, y0 + 1, 2, 1, EYE_DIM);
    return;
  }
  if (eyes === 'happy') {
    for (const x of [7, 11]) {
      rect(g, x, y0, 2, 1, EYE);
      px(g, x - 1, y0 + 1, EYE);
      px(g, x + 2, y0 + 1, EYE);
    }
    return;
  }
  const ox = eyes === 'left' ? -1 : eyes === 'right' ? 1 : 0;
  const oy = eyes === 'down' ? 1 : eyes === 'up' ? -1 : 0;
  for (const x of [7, 11]) {
    rect(g, x + ox, y0 + oy, 2, 2, EYE);
    px(g, x + ox, y0 + oy, EYE_HI);
  }
}

function drawHead(g, L, dir, eyes, bob) {
  const y = 4 + bob;
  rect(g, 4, y, 12, 2, L.top);
  rect(g, 4, y + 2, 12, 8, L.front);
  rect(g, 15, y + 2, 1, 8, L.shade);
  rect(g, 4, y + 9, 12, 1, L.shade);
  rect(g, 4, y + 2, 11, 1, lighten(L.front, 0.12));
  if (dir === 'down') {
    rect(g, 6, y + 3, 8, 4, L.visor);
    rect(g, 6, y + 3, 3, 1, L.visorHi);
    drawEyes(g, eyes, bob);
  } else if (dir === 'up') {
    rect(g, 8, y + 5, 4, 1, L.shade);
    rect(g, 8, y + 7, 4, 1, L.shade);
  } else {
    rect(g, 10, y + 3, 6, 4, L.visor);
    rect(g, 10, y + 3, 2, 1, L.visorHi);
    const oy = eyes === 'down' ? 1 : eyes === 'up' ? -1 : 0;
    if (eyes === 'blink') rect(g, 13, y + 5, 2, 1, EYE_DIM);
    else if (eyes === 'happy') { rect(g, 13, y + 4, 2, 1, EYE); px(g, 12, y + 5, EYE); }
    else { rect(g, 13, y + 4 + oy, 2, 2, EYE); px(g, 13, y + 4 + oy, EYE_HI); }
    rect(g, 4, y + 2, 1, 8, L.shade);
  }
}

function drawAntenna(g, L, bob) {
  rect(g, 9, 3 + bob, 2, 1, L.chef ? '#5b566a' : '#9d98ae');
  rect(g, 9, 1 + bob, 2, 2, L.tip);
  px(g, 9, 1 + bob, lighten(L.tip, 0.5));
}

/** Les accessoires de métier, par-dessus la tête. frame anime l'hélice de l'éclaireur. */
function drawAccessory(g, L, dir, bob, frame) {
  const y = bob;
  switch (L.role) {
    case 'lecteur': { // le chapeau d'explorateur (il part voir chaque commerce)
      rect(g, 3, 4 + y, 14, 1, '#d6bd86');
      rect(g, 6, 1 + y, 8, 3, '#c7aa70');
      rect(g, 6, 3 + y, 8, 1, '#7c6337');
      rect(g, 7, 1 + y, 6, 1, '#e3cf9e');
      break;
    }
    case 'redacteur': { // un crayon sur l'oreille
      if (dir === 'down') {
        px(g, 16, 3 + y, '#ff8fb1');
        rect(g, 16, 4 + y, 1, 5, '#ffd166');
        px(g, 16, 9 + y, '#3a3547');
      }
      break;
    }
    case 'eclaireur': { // une casquette à hélice
      const c = ROLES.eclaireur.color;
      rect(g, 5, 2 + y, 10, 2, c);
      rect(g, 6, 1 + y, 8, 1, lighten(c, 0.3));
      if (dir === 'down') rect(g, 4, 4 + y, 12, 1, darken(c, 0.2));
      else if (dir === 'right') rect(g, 10, 4 + y, 7, 1, darken(c, 0.2));
      rect(g, 9, 0 + y, 2, 1, '#3a3547');
      const f = frame % 2;
      if (f === 0) rect(g, 2, -1 + y + 1, 16, 1, '#e8e5f1');
      else rect(g, 6, -1 + y + 1, 8, 1, '#c4bfd4');
      break;
    }
  }
}

function drawBodyFront(g, L, dir, limbs, bob, seated) {
  const y = 14 + bob;
  if (!seated) {
    rect(g, 7, 19, 2, 3 - limbs.ll, L.leg);
    rect(g, 11, 19, 2, 3 - limbs.rl, L.leg);
  }
  rect(g, 6, y, 8, 5, L.body);
  rect(g, 6, y, 8, 1, L.bodyHi);
  rect(g, 6, y + 4, 8, 1, L.bodyShade);
  rect(g, 13, y + 1, 1, 3, L.bodyShade);
  if (L.chef && dir === 'down') {
    rect(g, 9, y, 2, 1, P.orangeDark);
    rect(g, 9, y + 1, 2, 2, P.orange);
    px(g, 9, y + 3, P.orange);
  } else if (!L.chef && dir === 'down') {
    px(g, 8, y + 2, lighten(L.body, 0.55));
  }
  for (const [x, ay, h] of [limbs.la, limbs.ra]) {
    rect(g, x, ay + bob, 2, h, L.arm);
    rect(g, x, ay + bob + h - 1, 2, 1, L.hand);
  }
}

function drawBodySide(g, L, frame, walking, bob, pose) {
  const y = 14 + bob;
  const swing = walking ? [0, 1, 0, -1][frame % 4] : 0;
  if (pose === 'fly') {
    rect(g, 8, 19, 2, 2, darken(L.leg, 0.15));
    rect(g, 10, 19, 2, 2, L.leg);
  } else {
    rect(g, 8 + swing, 19, 2, 3, darken(L.leg, 0.15));
    rect(g, 10 - swing, 19, 2, 3, L.leg);
  }
  rect(g, 7, y, 7, 5, L.body);
  rect(g, 7, y, 7, 1, L.bodyHi);
  rect(g, 7, y + 4, 7, 1, L.bodyShade);
  if (pose === 'carry') {
    // la lettre tenue devant lui
    rect(g, 12, y, 5, 4, P.paper);
    rect(g, 12, y, 5, 1, P.paperShade);
    px(g, 14, y + 1, P.paperLine);
    rect(g, 11, y + 1, 3, 2, L.arm);
  } else if (pose === 'fly') {
    rect(g, 9, y + 1, 5, 2, L.arm);
    rect(g, 13, y + 1, 1, 2, L.hand);
  } else {
    rect(g, 9 - swing, y + 1, 2, 4, L.arm);
    rect(g, 9 - swing, y + 4, 2, 1, L.hand);
  }
}

function limbsFor(pose, frame) {
  const f = frame % 4;
  switch (pose) {
    case 'walk':
      return { la: [4, 14 + (f === 1 ? 1 : f === 3 ? -1 : 0), 4], ra: [14, 14 + (f === 1 ? -1 : f === 3 ? 1 : 0), 4], ll: f === 1 ? 1 : 0, rl: f === 3 ? 1 : 0 };
    case 'type':
      return { la: [5, 16 - (frame % 2 === 0 ? 1 : 0), 3], ra: [13, 16 - (frame % 2 === 1 ? 1 : 0), 3], ll: 0, rl: 0 };
    case 'read':
      return { la: [5, 16, 3], ra: [13, 16, 3], ll: 0, rl: 0 };
    case 'think':
      return { la: [4, 14, 4], ra: [13, 11, 4], ll: 0, rl: 0 };
    case 'raise':
      return { la: [4, 14, 4], ra: [15, 2 + (frame % 2), 6], ll: 0, rl: 0 };
    case 'cheer':
      return { la: [3, 3 + (frame % 2), 6], ra: [15, 3 + ((frame + 1) % 2), 6], ll: frame % 2, rl: (frame + 1) % 2 };
    case 'wave':
      return { la: [4, 14, 4], ra: [15 + (frame % 2), 4, 6], ll: 0, rl: 0 };
    case 'fly':
      return { la: [2, 13 + (frame % 2), 3], ra: [16, 13 + ((frame + 1) % 2), 3], ll: 1, rl: 1 };
    case 'carry':
      return { la: [5, 15, 3], ra: [13, 15, 3], ll: 0, rl: 0 };
    default:
      return { la: [4, 14, 4], ra: [14, 14, 4], ll: 0, rl: 0 };
  }
}

function build(role, pose, dir, frame, eyes) {
  const L = lookOf(role);
  if (dir === 'left') return mirror(build(role, pose, 'right', frame, eyes));
  const c = makeCanvas(ROBOT_W, ROBOT_H);
  const g = g2d(c);
  const walking = pose === 'walk';
  const f = frame % 4;
  const bob = walking ? (f === 1 || f === 3 ? -1 : 0) : pose === 'cheer' ? -(frame % 2) : pose === 'fly' ? (frame % 4 < 2 ? 0 : -1) : 0;
  const hatted = L.role === 'lecteur' || L.role === 'eclaireur';
  if (dir === 'right') {
    drawBodySide(g, L, frame, walking, bob, pose);
    if (!hatted) drawAntenna(g, L, bob);
    drawHead(g, L, 'right', eyes, bob);
    drawAccessory(g, L, 'right', bob, frame);
  } else {
    const limbs = limbsFor(pose, frame);
    drawBodyFront(g, L, dir, limbs, bob, false);
    if (!hatted) drawAntenna(g, L, bob);
    drawHead(g, L, dir, eyes, bob);
    drawAccessory(g, L, dir, bob, frame);
    if (pose === 'carry' && dir === 'down') {
      // la lettre, tenue à deux mains devant le ventre
      rect(g, 6, 15 + bob, 8, 5, P.paper);
      rect(g, 6, 15 + bob, 8, 1, P.paperShade);
      px(g, 7, 16 + bob, P.paperLine); px(g, 12, 16 + bob, P.paperLine);
      rect(g, 8, 17 + bob, 4, 1, P.paperLine);
      px(g, 10, 18 + bob, P.orange);
      rect(g, 4, 16 + bob, 2, 2, L.hand);
      rect(g, 14, 16 + bob, 2, 2, L.hand);
    }
    if ((pose === 'raise' || pose === 'cheer' || pose === 'wave') && dir === 'down') {
      const [x, ay, h] = limbs.ra;
      if (x <= 15) { rect(g, x, ay + bob, 2, h, L.arm); rect(g, x, ay + bob, 2, 1, L.hand); }
      if (pose === 'cheer') { const [lx, ly, lh] = limbs.la; rect(g, lx, ly + bob, 2, lh, L.arm); rect(g, lx, ly + bob, 2, 1, L.hand); }
    }
  }
  outline(c, L.chef ? '#07060a' : P.ink);
  return c;
}

const cache = new Map();

/** Le sprite d'un robot (gardé en mémoire : chaque pose n'est dessinée qu'une fois). */
export function robotSprite(role, pose, dir, frame, eyes = 'open') {
  const key = `${role}|${pose}|${dir}|${frame}|${eyes}`;
  let c = cache.get(key);
  if (!c) {
    c = build(role, pose, dir, frame, eyes);
    cache.set(key, c);
  }
  return c;
}

/** Le visage d'un robot en grand (pour les portraits de l'équipe). */
export function portrait(role, eyes = 'open', scale = 4) {
  const src = robotSprite(role, 'stand', 'down', 0, eyes);
  const c = makeCanvas(16 * scale, 16 * scale);
  const g = g2d(c);
  g.drawImage(src, 2, 0, 16, 16, 0, 0, 16 * scale, 16 * scale);
  return c;
}

