// Le réalisateur : il choisit le plan, comme une caméra de jeu qui suit l'action. Le QG au départ, l'éclaireur qui survole
// la ville, un lecteur qui file jusqu'à une salle (on voit son chemin), la porte où il entre, la note quand il ressort,
// le QG quand un mail est prêt, et la vue d'ensemble à la fin.
import { polyLength } from './chemins.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Realisateur {
  constructor(world, cam) {
    this.world = world;
    this.cam = cam;
    this.shotNow = null;
    this.manualUntil = 0;
    this.want = { x: cam.x, y: cam.y, z: cam.z };
    this.vel = { x: 0, y: 0, z: 0 };
    this.focus = null; // l'identifiant du commerce à mettre en valeur (pour la carte de score)
    this.writes = 0;
    world.on((type, d) => this.onEvent(type, d));
  }

  get now() { return this.world.time; }

  take(kind, opts = {}) {
    const t = this.now;
    const cur = this.shotNow;
    const prio = opts.prio ?? 1;
    if (cur && t < cur.until && !(t >= cur.minUntil && prio >= cur.prio) && !opts.force) return false;
    this.shotNow = { kind, ...opts, prio, at: t, minUntil: t + (opts.min ?? 1.6), until: t + (opts.max ?? 6) };
    return true;
  }

  onEvent(type, d) {
    const w = this.world;
    if (type === 'mission') this.take('qg', { min: 3.2, max: 3.6, prio: 3, force: true });
    if (type === 'scan') this.take('scan', { min: 2.5, max: 30, prio: 2, force: true });
    if (type === 'go') {
      if (w.scan && this.shotNow?.kind === 'scan') return; // l'onde de l'éclaireur d'abord
      this.take('route', { a: d.a, q: d.q, min: 1.4, max: 12, prio: 2 });
    }
    if (type === 'read' && this.shotNow?.a === d.a) this.take('door', { a: d.a, q: d.q, min: 1.2, max: 8, prio: 3, force: true });
    if (type === 'scored') {
      if (this.shotNow?.q === d.q) { this.focus = d.q.id; this.take('door', { a: d.a, q: d.q, min: d.d.retenu ? 1.8 : 1.0, max: d.d.retenu ? 2.4 : 1.4, prio: 3, force: true }); }
    }
    if (type === 'write' && this.writes++ < 2) this.take('qg', { min: 1.8, max: 2.6, prio: 1 });
    if (type === 'mail') this.take('qg', { min: 1.0, max: 1.6, prio: 1 });
    if (type === 'end') this.take('overview', { min: 99, max: 999, prio: 9, force: true });
  }

  /** Le plan voulu pour une toile W × H. */
  target(W, H) {
    const w = this.world;
    const s = this.shotNow;
    const qg = w.qg;
    const near = Math.min(W, H) / 115; // une rue de 115 m à l'écran : les robots en grand
    if (!s || this.now >= s.until) {
      // entre deux plans : suivre le lecteur le plus en mouvement, sinon le QG
      const mover = [...w.actors.values()].find((a) => a.route && a.alpha > 0);
      if (mover) { this.take('route', { a: mover, q: w.places.get(mover.routeTarget ?? mover.target), min: 1.2, max: 8, prio: 1, force: true }); return this.target(W, H); }
      return this.overview(W, H);
    }
    switch (s.kind) {
      case 'qg': return { x: qg.x, y: qg.door[1] - 8, z: near * 1.15 };
      case 'scan': {
        // on recule avec l'onde : la ville entière se découvre
        const sc = w.scan;
        if (!sc) { s.until = this.now; return this.overview(W, H); }
        const r = Math.max(120, sc.r * 1.08);
        return { x: qg.x, y: qg.y - r * 0.08, z: Math.min(near * 0.8, (Math.min(W, H) * 0.5) / r) };
      }
      case 'scout': {
        const a = w.actors.get('eclaireur');
        // assez large pour voir les repères qui s'allument autour de lui
        return { x: a.x, y: a.y - 14 - a.alt, z: near * 0.3 };
      }
      case 'route': {
        const a = s.a;
        if (!a.route) return { x: a.x, y: a.y - 8, z: near, subject: a };
        const end = a.route.at(-1);
        // le robot et sa destination dans le cadre : on voit où il va ; le plan se resserre tout seul à l'arrivée
        const dx = Math.abs(a.x - end[0]) + 30, dy = Math.abs(a.y - end[1]) + 40;
        const z = clamp(Math.min((W * 0.62) / dx, (H * 0.56) / dy), near * 0.22, near * 1.1);
        return { x: (a.x + end[0]) / 2, y: (a.y + end[1]) / 2 - 10, z, subject: a };
      }
      case 'door': return { x: s.q.x, y: s.q.y - 8, z: near * 1.15 };
      case 'overview':
      default: return this.overview(W, H);
    }
  }

  overview(W, H) {
    const w = this.world;
    const ps = [...w.places.values()].filter((q) => q.state !== 'cache');
    if (!ps.length) return { x: w.qg.x, y: w.qg.y, z: Math.min(W, H) / 600 };
    let x0 = w.qg.x, x1 = w.qg.x, y0 = w.qg.y, y1 = w.qg.y;
    for (const q of ps) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
    const z = Math.min((W * 0.86) / Math.max(200, x1 - x0), (H * 0.78) / Math.max(200, y1 - y0));
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 - 20 / z, z };
  }

  /** Un pas de caméra : un ressort amorti (position et zoom, le zoom en logarithme) ; un nouveau plan loin du cadre : on coupe. */
  update(dt, W, H) {
    if (this.now < this.manualUntil) return;
    const want = this.target(W, H);
    if (this.shotNow !== this.lastShot) {
      this.lastShot = this.shotNow;
      const far = Math.hypot(want.x - this.cam.x, want.y - this.cam.y) * Math.min(want.z, this.cam.z) > Math.min(W, H) * 0.9;
      const zoomJump = Math.abs(Math.log(want.z / this.cam.z)) > 1.4;
      if (this.shotNow && this.shotNow.kind !== 'scan' && this.shotNow.kind !== 'overview' && (far || zoomJump) && this.now > 0.5 && !(this.now < (this.smoothUntil ?? 0))) {
        Object.assign(this.cam, { x: want.x, y: want.y, z: want.z });
        this.vel = { x: 0, y: 0, z: 0 };
        this.cuts = (this.cuts ?? 0) + 1;
        return;
      }
    }
    const k = this.now < (this.smoothUntil ?? 0) ? 2.4 : this.shotNow?.kind === 'route' ? 6 : 4.2;
    const spring = (cur, tgt, v) => {
      const a = k * k * (tgt - cur) - 2 * k * v;
      v += a * dt;
      return [cur + v * dt, v];
    };
    [this.cam.x, this.vel.x] = spring(this.cam.x, want.x, this.vel.x);
    [this.cam.y, this.vel.y] = spring(this.cam.y, want.y, this.vel.y);
    const lz = Math.log(this.cam.z);
    let nz;
    [nz, this.vel.z] = spring(lz, Math.log(want.z), this.vel.z);
    this.cam.z = Math.exp(nz);
    // le robot suivi ne sort jamais du cadre
    const a = want.subject;
    if (a) {
      const mx = (W * 0.38) / this.cam.z, my = (H * 0.36) / this.cam.z;
      const ax = a.x, ay = a.y - 8;
      if (ax < this.cam.x - mx) this.cam.x = ax + mx; else if (ax > this.cam.x + mx) this.cam.x = ax - mx;
      if (ay < this.cam.y - my) this.cam.y = ay + my; else if (ay > this.cam.y + my) this.cam.y = ay - my;
    }
  }
}

