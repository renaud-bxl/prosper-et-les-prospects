// Le dessin d'une image : les carreaux de la ville au bon niveau de finesse, agrandis sans flou, puis ce qui bouge par-dessus.
import { LODS } from './ville.js';
import { drawIllustratedCity } from './illustrated-city.js';
import { t as tr } from './i18n.js';

/** Finest existing masks near the camera; economical masks only at city overview scale. */
export function lodFor(z) {
  for (let L = LODS.length - 1; L >= 0; L--) if (z * LODS[L] <= 1.1) return L;
  return 0;
}

/** Real geographic geometry, drawn as smooth illustrated surfaces by the shared renderer. */
export function drawCity(g, city, cam, W, H, tod, maxNew = Infinity) {
  return drawIllustratedCity(g, city, cam, W, H, tod, maxNew);
}

/** Du monde (m) à l'écran (px). */
export const toScreen = (cam, W, H, x, y) => [(x - cam.x) * cam.z + W / 2, (y - cam.y) * cam.z + H / 2];
export const toWorld = (cam, W, H, sx, sy) => [(sx - W / 2) / cam.z + cam.x, (sy - H / 2) / cam.z + cam.y];

/* ------------------------------------------------------------------ ce qui bouge par-dessus la ville */
import { ANCHOR_X, ANCHOR_Y, ROLES, robotSprite } from './robots.js';
import { badgeSprite, hologramSprite, letterSprite, qgSprite, shadowSprite, signSprite } from './sprites.js';

const ROOF = { retenu: ['#b9ceb4', '#7c9b84'], pret: ['#abc9b0', '#719681'], valide: ['#8ebda0', '#5d8a70'], lecture: ['#a4c3d2', '#6e96aa'], ecriture: ['#c7bcd8', '#9887b1'] };

/** La taille d'un pixel des robots à l'écran : comme la ville de près, un peu plus gros de loin (des pions de jeu). */
export const spriteScale = (z) => Math.max(3, z * 0.55);

export function drawWorld(g, world, cam, W, H, tod, opts = {}) {
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  const city = world.city;
  const t = world.time;
  const z = cam.z;
  const L = lodFor(z);
  const tex = z * LODS[L];
  const S = opts.S ?? spriteScale(z);
  const scr = (x, y) => [(x - cam.x) * z + W / 2, (y - cam.y) * z + H / 2];

  // 1. les immeubles des commerces, allumés selon leur état
  for (const q of world.places.values()) {
    const col = ROOF[q.state];
    if (!col || !q.bid) continue;
    const building=city.blist[q.bid-1];if(!building)continue;
    const pulse=q.state==='lecture'||q.state==='ecriture'?.42+.2*Math.sin(t*6):.5;
    g.save();g.globalAlpha=pulse*Math.min(1,(t-q.stateAt)/.35);g.fillStyle=col[0];g.strokeStyle=col[1];g.lineWidth=Math.max(1,S*.4);g.lineJoin='round';
    const lift=Math.max(1.5,Math.min(18,building.h*.45));
    for(const rings of building.parts){g.beginPath();for(const ring of rings){for(let i=0;i<ring.length;i++){const [x,y]=scr(ring[i][0],ring[i][1]-lift);if(i===0)g.moveTo(x,y);else g.lineTo(x,y);}g.closePath();}g.fill('evenodd');g.stroke();}
    g.restore();
  }

  // l'onde de l'éclaireur : un anneau qui part du QG, la ville se découvre derrière lui
  if (world.scan) {
    const sc = world.scan;
    const [cx, cy] = scr(sc.x, sc.y);
    const r = sc.r * z;
    const fade = sc.end ? Math.max(0, 1 - (t - sc.end) / 1.2) : 1;
    g.save();
    const grad = g.createRadialGradient(cx, cy, Math.max(0, r - 90 * Math.max(1, z * 0.2)), cx, cy, r);
    grad.addColorStop(0, 'rgba(255,201,61,0)');
    grad.addColorStop(0.85, `rgba(255,201,61,${0.16 * fade})`);
    grad.addColorStop(1, `rgba(255,236,170,${0.55 * fade})`);
    g.fillStyle = grad;
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = `rgba(255,214,110,${0.9 * fade})`;
    g.lineWidth = Math.max(2, S);
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
    g.restore();
  }

  // 2. le cercle de la mission
  if (world.mission) {
    const [cx, cy] = scr(0, 0);
    const r = (world.mission.rayon ?? city.radius) * z;
    g.save();
    g.strokeStyle = 'rgba(255,138,61,0.55)';
    g.lineWidth = Math.max(2, S);
    g.setLineDash([S * 6, S * 5]);
    g.lineDashOffset = -t * 20;
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
    g.restore();
  }

  // 3. les chemins des robots : des pointillés de leur couleur jusqu'au commerce visé
  for (const a of world.actors.values()) {
    if (!a.route || a.alpha <= 0) continue;
    const col = ROLES[a.role].color;
    const step = Math.max(2.2, 7 / z * S);
    const pts = a.route;
    const total = a.routeLen ?? (a.routeLen = pts.reduce((s2, p, k) => (k ? s2 + Math.hypot(p[0] - pts[k - 1][0], p[1] - pts[k - 1][1]) : 0), 0));
    const traced = total * Math.min(1, (t - (a.routeAt ?? -9)) / 0.45);
    let d = 0, i = 1, next = a.routeD + step - ((a.routeD + t * 9) % step);
    g.fillStyle = col;
    let head = null;
    while (i < pts.length) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      const l = Math.hypot(bx - ax, by - ay);
      if (traced < total && d <= traced && traced <= d + l) { const u = (traced - d) / (l || 1); head = [ax + (bx - ax) * u, ay + (by - ay) * u]; }
      while (next <= d + l && next <= traced) {
        const u = (next - d) / (l || 1);
        const [sx, sy] = scr(ax + (bx - ax) * u, ay + (by - ay) * u);
        g.fillStyle = '#fffaf0b0';
        g.beginPath(); g.arc(sx, sy, S * 1.4, 0, Math.PI * 2); g.fill();
        g.fillStyle = col;
        g.beginPath(); g.arc(sx, sy, S * .9, 0, Math.PI * 2); g.fill();
        next += step;
      }
      d += l; i++;
    }
    if (head) {
      // la tête du tracé : un point lumineux qui file
      const [hx, hy] = scr(head[0], head[1]);
      g.fillStyle = '#ffffff';
      g.beginPath(); g.arc(hx, hy, S * 1.8, 0, Math.PI * 2); g.fill();
      g.fillStyle = col;
      g.beginPath(); g.arc(hx, hy, S, 0, Math.PI * 2); g.fill();
    }
  }
  // la trace en vol de l'éclaireur vers le commerce qu'il va marquer
  const sc = world.actors.get('eclaireur');
  if (sc?.routeTarget) {
    const q = world.places.get(sc.routeTarget);
    if (q) {
      const [ax, ay] = scr(sc.x, sc.y), [bx, by] = scr(q.x, q.y);
      g.save(); g.strokeStyle = 'rgba(255,201,61,0.7)'; g.lineWidth = S; g.setLineDash([S * 3, S * 3]);
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke(); g.restore();
    }
  }

  // 4. les objets, du nord au sud
  const items = [];
  const q0 = world.qg;
  items.push({ y: q0.y + q0.d / 2, draw: () => drawQG(g, world, scr, z, tod, S) });
  for (const q of world.places.values()) if (q.state !== 'cache') items.push({ y: q.y, draw: () => drawPlace(g, world, q, scr, S, t) });
  for (const a of world.actors.values()) if (a.alpha > 0.01) items.push({ y: a.y + (a.alt > 3 ? 1000 : 0), draw: () => drawActor(g, a, scr, S, t) });
  items.sort((a, b) => a.y - b.y);
  for (const it of items) it.draw();

  // 5. les effets
  for (const f of world.fx) drawFx(g, world, f, scr, S, t, opts);

  // le final : un faisceau de lumière au-dessus de chaque client potentiel
  if (opts.beacons) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const q of world.places.values()) {
      if (!['retenu', 'ecriture', 'pret', 'valide'].includes(q.state)) continue;
      const [bx, by] = scr(q.x, q.y);
      const h = Math.min(H * 0.5, 260 * S), w = 7 * S;
      const gr = g.createLinearGradient(0, by - h, 0, by);
      gr.addColorStop(0, 'rgba(255,138,61,0)');
      gr.addColorStop(1, `rgba(255,150,70,${0.55 + 0.2 * Math.sin(t * 3 + q.x)})`);
      g.fillStyle = gr;
      g.fillRect(Math.round(bx - w / 2), Math.round(by - h), Math.round(w), Math.round(h));
    }
    g.restore();
  }
}

function drawQG(g, world, scr, z, tod, S) {
  const q = world.qg;
  const sp = qgSprite(tod);
  const k = z * 0.5; // le QG est dessiné à l'échelle de la ville la plus fine
  const [sx, sy] = scr(q.x0, q.y0 + q.d);
  drawSprite(g, sp.c, sx, sy, sp.ax, sp.ay, k);
  if (z < 1.6) {
    // de loin, un repère : la tête du robot dans une bulle orange
    const [px, py] = scr(q.x, q.y0);
    const b = badgeSprite('retenu');
    g.globalAlpha = Math.min(1, (1.6 - z) * 3);
    drawSprite(g, b.c, px, py - 4 * S, b.ax, b.ay, S);
    g.globalAlpha = 1;
  }
}

function drawPlace(g, world, q, scr, S, t) {
  const [sx, sy] = scr(q.x, q.y);
  const age = t - q.stateAt;
  const sign = signSprite();
  drawSprite(g, sign.c, sx, sy, sign.ax, sign.ay, S);
  const b = badgeSprite(q.state, Math.floor(t * 6));
  // la bulle saute quand elle change d'état, et le « ! » rebondit
  let lift = 15;
  const pop = age < 0.3 ? Math.sin((age / 0.3) * Math.PI) * 5 : 0;
  if (q.state === 'retenu' || q.state === 'pret') lift += Math.abs(Math.sin(t * 3.2)) * 2.5;
  const scale = age < 0.18 ? 0.4 + (age / 0.18) * 0.75 : age < 0.3 ? 1.15 - ((age - 0.18) / 0.12) * 0.15 : 1;
  const small = b.small ? 0.8 : 1;
  const Sx = S * scale * small;
  drawSprite(g, b.c, sx, sy - (lift + pop) * S, b.ax, b.ay, Sx);
  // ce que le lecteur voit sur le site, et ce qui manque au commerce
  const since = q.doneAt != null ? t - q.doneAt : null;
  if (S >= 3 && (q.state === 'lecture' || (since != null && since < 2.6))) {
    const dom = (() => { try { return new URL(q.data.website).host.replace(/^www\./, ''); } catch { return q.name; } })();
    const items = q.state === 'lecture' ? [] : bilanCourt(q);
    const shown = since == null ? 0 : Math.min(items.length, Math.floor(since / 0.28) + 1);
    const h = hologramSprite(dom.toUpperCase(), items, shown, Math.floor(t * 10));
    const a = since != null && since > 2.1 ? Math.max(0, 1 - (since - 2.1) / 0.5) : Math.min(1, (t - q.stateAt) / 0.2);
    const hs = Math.max(2, S - 1);
    g.globalAlpha = a;
    drawSprite(g, h.c, sx, sy - 34 * S, h.ax, h.ay, hs);
    g.globalAlpha = 1;
  }
}

/** Les trois signaux qu'on montre dans l'hologramme. */
function bilanCourt(q) {
  const s = q.signals ?? {};
  if (!s.site) return [[false, tr('PAS DE SITE LISIBLE')]];
  return [
    s.reservation_en_ligne ? [true, tr('RESA EN LIGNE')] : [false, tr('RESA EN LIGNE')],
    s.discussion ? [true, tr('CHAT SUR LE SITE')] : [false, tr('CHAT SUR LE SITE')],
    s.whatsapp ? [true, 'WHATSAPP'] : [false, 'WHATSAPP'],
  ];
}

function drawActor(g, a, scr, S, t) {
  const [sx, sy] = scr(a.x, a.y);
  if (a.pose === 'walk' && (a.speed ?? 0) > 70 && a.alpha > 0.5) {
    const back = { left: [1, 0], right: [-1, 0], up: [0, 1], down: [0, -1] }[a.dir] ?? [0, 0];
    g.fillStyle = 'rgba(255,255,255,0.55)';
    for (let k = 0; k < 3; k++) {
      const len = (6 + ((k * 7 + Math.floor(t * 20)) % 5) * 2) * S;
      const off = (-6 + k * 6) * S;
      if (back[0]) g.fillRect(Math.round(sx + back[0] * (10 * S) + (back[0] < 0 ? -len : 0)), Math.round(sy - 12 * S + off), Math.round(len), S);
      else g.fillRect(Math.round(sx + off), Math.round(sy - 12 * S + back[1] * (14 * S) + (back[1] < 0 ? -len : 0)), S, Math.round(len));
    }
  }
  g.globalAlpha = a.alpha;
  // l'ombre au sol (plus petite quand l'éclaireur vole haut)
  const sh = shadowSprite(a.alt > 3 ? 10 : 14);
  drawSprite(g, sh.c, sx, sy, sh.ax, sh.ay, S);
  const sp = robotSprite(a.role, a.pose, a.dir, a.frame, a.bubble ? 'talk' : a.eyes, { id: a.id, name: a.name, time: t });
  const alt = Math.round(a.alt * 2 * (S / 2)); // un mètre d'altitude = deux pixels du robot
  drawSprite(g, sp, sx, sy - alt, ANCHOR_X, ANCHOR_Y, S);
  g.globalAlpha = 1;
}

function drawFx(g, world, f, scr, S, t, opts) {
  const u = (t - f.t0) / f.dur;
  const [sx, sy] = scr(f.x, f.y);
  if (f.kind === 'ring') {
    g.strokeStyle = `rgba(255,201,61,${1 - u})`;
    g.lineWidth = S;
    const r = (4 + u * 18) * S;
    g.beginPath(); g.ellipse(sx, sy - 10 * S, r, r * .6, 0, 0, Math.PI * 2); g.stroke();
  } else if (f.kind === 'dust') {
    g.fillStyle = `rgba(220,210,230,${0.5 * (1 - u)})`;
    const r = (1 + u * 2) * S;
    g.beginPath(); g.ellipse(sx + f.vx * u * 6 * S, sy - u * 3 * S, r, r * .6, 0, 0, Math.PI * 2); g.fill();
  } else if (f.kind === 'letter') {
    // la lettre monte et file vers la file de validation (en haut à droite)
    const sp = letterSprite();
    const tx = opts.inbox?.[0] ?? sx + 200, ty = opts.inbox?.[1] ?? sy - 300;
    const e = u * u * (3 - 2 * u);
    const x = sx + (tx - sx) * e, y = sy + (ty - sy) * e - Math.sin(u * Math.PI) * 60 * S / 2;
    drawSprite(g, sp.c, x, y, sp.ax, sp.ay, S);
  }
}

function drawSprite(g, c, x, y, ax, ay, S) {
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(c, x - ax * S, y - ay * S, (c.logicalWidth ?? c.width) * S, (c.logicalHeight ?? c.height) * S);
}

