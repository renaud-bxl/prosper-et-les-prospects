// API historique conservée ; les personnages sont maintenant des humains dessinés en courbes.
import { characterFor, drawHuman, poseFor } from './humans.js';

export const ROLES = {
  chef: { label: "Chef d'équipe", color: '#6e9780' },
  eclaireur: { label: 'Éclaireur', color: '#c5a064' },
  lecteur: { label: 'Lecteur', color: '#789aae' },
  redacteur: { label: 'Rédacteur', color: '#a491bd' },
};
export const ROBOT_W = 20;
export const ROBOT_H = 24;
export const ANCHOR_X = 10;
export const ANCHOR_Y = 22;
const RESOLUTION = 6;
const cache = new Map();
const portraits = new Map();

function canvas(width, height, resolution = RESOLUTION) {
  const c = document.createElement('canvas');
  c.width = Math.round(width * resolution);
  c.height = Math.round(height * resolution);
  c.logicalWidth = width;
  c.logicalHeight = height;
  c.smooth = true;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  return [c, g];
}

function remember(map, key, value, maximum) {
  map.set(key, value);
  if (map.size > maximum) map.delete(map.keys().next().value);
  return value;
}

/**
 * La taille et les ancrages restent exprimés en 20×24 unités ; la toile fait 120×144.
 * Le renderer lit logicalWidth/logicalHeight. identity accepte nom, id, ou {name,id,time}.
 */
export function robotSprite(role, pose = 'stand', dir = 'down', frame = 0, eyes = 'open', identity = {}) {
  const person = characterFor(role, identity);
  const options = typeof identity === 'object' && identity ? identity : {};
  const motion = poseFor(pose, frame, options.time, person.phase);
  const direction = ['down', 'up', 'left', 'right'].includes(dir) ? dir : 'down';
  const key = `${person.id}|${pose}|${direction}|${motion.tick}|${eyes}`;
  if (cache.has(key)) return cache.get(key);
  const [c, g] = canvas(ROBOT_W, ROBOT_H);
  g.scale(RESOLUTION, RESOLUTION);
  g.translate(ANCHOR_X, ANCHOR_Y);
  g.scale(.27, .27);
  drawHuman(g, person, { pose, direction, eyes, ...motion });
  return remember(cache, key, c, 640);
}

/** Portrait visage/épaules, haute définition. Le quatrième argument identifie la personne. */
export function portrait(role, eyes = 'open', scale = 4, identity = {}) {
  const person = characterFor(role, identity);
  const size = 16 * Math.max(1, Math.min(12, Number(scale) || 4));
  const key = `${person.id}|${eyes}|${size}`;
  if (portraits.has(key)) return portraits.get(key);
  const [c, g] = canvas(size, size, 2);
  g.scale(2, 2);
  g.beginPath();
  g.roundRect(0, 0, size, size, size * .25);
  g.fillStyle = person.wash;
  g.fill();
  g.clip();
  const src = robotSprite(role, 'stand', 'down', 0, eyes, person.id);
  g.drawImage(src, 2.6 * RESOLUTION, .3 * RESOLUTION, 14.8 * RESOLUTION, 14.8 * RESOLUTION, 0, 0, size, size);
  return remember(portraits, key, c, 80);
}
