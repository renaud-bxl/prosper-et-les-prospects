// Le dessin d'une image : les carreaux de la ville au bon niveau de finesse, agrandis sans flou, puis ce qui bouge par-dessus.
import { CH, LODS } from './ville.js';
import { t as tr } from './i18n.js';

/** Le niveau de finesse à utiliser pour un zoom (pixels d'écran par mètre) : le plus fin dont un pixel reste au moins un pixel d'écran. */
export function lodFor(z) {
  // des pixels de ville d'au moins un pixel et demi : la ville et les robots gardent le même grain
  for (let L = 0; L < LODS.length; L++) if (z * LODS[L] >= 1.45) return L;
  return LODS.length - 1;
}

/** La ville vue par la caméra { x, y (m), z (px/m) } dans une toile W × H. maxNew : combien de carreaux neufs on s'autorise à dessiner. */
export function drawCity(g, city, cam, W, H, tod, maxNew = Infinity) {
  const L = lodFor(cam.z);
  const mpp = LODS[L];
  const z = cam.z;
  const x0 = cam.x - W / 2 / z, y0 = cam.y - H / 2 / z;
  const cs = CH * mpp;
  const b = city.bounds;
  let fresh = 0, missing = 0;
  g.imageSmoothingEnabled = false;
  for (let cy = Math.floor(Math.max(y0, b.miny) / cs); cy * cs < Math.min(y0 + H / z, b.maxy); cy++) {
    for (let cx = Math.floor(Math.max(x0, b.minx) / cs); cx * cs < Math.min(x0 + W / z, b.maxx); cx++) {
      const sx0 = Math.round((cx * cs - x0) * z), sx1 = Math.round(((cx + 1) * cs - x0) * z);
      const sy0 = Math.round((cy * cs - y0) * z), sy1 = Math.round(((cy + 1) * cs - y0) * z);
      if (!city.hasChunk(tod, L, cx, cy)) {
        if (fresh >= maxNew) {
          // pas encore dessiné : le niveau plus grossier en attendant
          missing++;
          const L2 = L + 1;
          if (L2 < LODS.length) {
            const cs2 = CH * LODS[L2];
            const kx = Math.floor((cx * cs) / cs2), ky = Math.floor((cy * cs) / cs2);
            if (city.hasChunk(tod, L2, kx, ky)) {
              const c2 = city.chunk(tod, L2, kx, ky);
              const f = cs / cs2, u = ((cx * cs) / cs2 - kx) * CH, v = ((cy * cs) / cs2 - ky) * CH;
              g.drawImage(c2, u, v, CH * f, CH * f, sx0, sy0, sx1 - sx0, sy1 - sy0);
            }
          }
          continue;
        }
        fresh++;
      }
      g.drawImage(city.chunk(tod, L, cx, cy), sx0, sy0, sx1 - sx0, sy1 - sy0);
    }
  }
  return { L, fresh, missing };
}

/** Du monde (m) à l'écran (px). */
export const toScreen = (cam, W, H, x, y) => [(x - cam.x) * cam.z + W / 2, (y - cam.y) * cam.z + H / 2];
export const toWorld = (cam, W, H, sx, sy) => [(sx - W / 2) / cam.z + cam.x, (sy - H / 2) / cam.z + cam.y];

/* ------------------------------------------------------------------ ce qui bouge par-dessus la ville */
import { ANCHOR_X, ANCHOR_Y, ROLES, robotSprite } from './robots.js';
import { badgeSprite, hologramSprite, letterSprite, qgSprite, shadowSprite, signSprite } from './sprites.js';

const ROOF = { retenu: ['#ff8a3d', '#d9622a'], pret: ['#ff8a3d', '#d9622a'], valide: ['#3ddc97', '#239a68'], lecture: ['#4fb3ff', '#2f7fc4'], ecriture: ['#a98bff', '#7a5fd0'] };

/** La taille d'un pixel des robots à l'écran : comme la ville de près, un peu plus gros de loin (des pions de jeu). */
export const spriteScale = (z) => Math.max(3, Math.round(z * 0.55));

export function drawWorld(g, world, cam, W, H, tod, opts = {}) {
  const city = world.city;
  const t = world.time;
  const z = cam.z;
  const L = lodFor(z);
  const tex = z * LODS[L];
  const S = opts.S ?? spriteScale(z);
  const scr = (x, y) => [Math.round((x - cam.x) * z + W / 2), Math.round((y - cam.y) * z + H / 2)];

  // 1. les immeubles des commerces, allumés selon leur état
  for (const q of world.places.values()) {
    const col = ROOF[q.state];
    if (!col || !q.bid) continue;
    const sil = city.silhouette(q.bid, L, col[0], col[1]);
    if (!sil) continue;
    const pulse = q.state === 'lecture' || q.state === 'ecriture' ? 0.42 + 0.2 * Math.sin(t * 6) : 0.5 + 0.1 * Math.sin(t * 2.2);
    const fresh = Math.min(1, (t - q.stateAt) / 0.35);
    const [sx, sy] = scr(sil.x0 * LODS[L], sil.y0 * LODS[L]);
    const dw = Math.round(sil.c.width * tex), dh = Math.round(sil.c.height * tex);
    g.globalAlpha = pulse * fresh;
    g.drawImage(sil.c, sx, sy, dw, dh);
    g.globalAlpha = fresh;
    // le liseré, épais d'un pixel de robot quelle que soit la finesse de la ville
    const o = Math.max(1, Math.round(S / 2));
    for (const [dx, dy] of [[0, 0], [o, 0], [-o, 0], [0, o], [0, -o]]) g.drawImage(sil.e, sx + dx, sy + dy, dw, dh);
    g.globalAlpha = 1;
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
        g.fillStyle = '#15121d';
        g.fillRect(sx - S * 1.5, sy - S * 1.5, S * 3, S * 3);
        g.fillStyle = col;
        g.fillRect(sx - S, sy - S, S * 2, S * 2);
        next += step;
      }
      d += l; i++;
    }
    if (head) {
      // la tête du tracé : un point lumineux qui file
      const [hx, hy] = scr(head[0], head[1]);
      g.fillStyle = '#ffffff';
      g.fillRect(hx - S * 2, hy - S * 2, S * 4, S * 4);
      g.fillStyle = col;
      g.fillRect(hx - S, hy - S, S * 2, S * 2);
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
  const w = sp.c.width * k, h = sp.c.height * k;
  g.drawImage(sp.c, Math.round(sx - sp.ax * k), Math.round(sy - sp.ay * k), Math.round(w), Math.round(h));
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
  g.drawImage(b.c, Math.round(sx - b.ax * Sx), Math.round(sy - (lift + pop) * S - b.ay * Sx), Math.round(b.c.width * Sx), Math.round(b.c.height * Sx));
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
    g.drawImage(h.c, Math.round(sx - h.ax * hs), Math.round(sy - 34 * S - h.ay * hs), h.c.width * hs, h.c.height * hs);
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
  const sp = robotSprite(a.role, a.pose, a.dir, a.frame, a.eyes);
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
    g.strokeRect(Math.round(sx - r), Math.round(sy - r * 0.6 - 10 * S), Math.round(r * 2), Math.round(r * 1.2));
  } else if (f.kind === 'dust') {
    g.fillStyle = `rgba(220,210,230,${0.5 * (1 - u)})`;
    const r = (1 + u * 2) * S;
    g.fillRect(Math.round(sx - r + f.vx * u * 6 * S), Math.round(sy - r - u * 3 * S), Math.round(r * 2), Math.round(r * 2));
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
  g.drawImage(c, Math.round(x - ax * S), Math.round(y - ay * S), c.width * S, c.height * S);
}

