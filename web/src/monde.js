// Le monde du QG : l'équipe, les commerces, ce que chacun fait et où il va. Chaque geste venu des vrais agents (en direct ou
// rejoué) devient une petite mise en scène, dans l'ordre, à un rythme qu'on peut suivre : l'éclaireur s'envole du toit et
// marque chaque salle qu'il trouve d'un « ? » ; un lecteur marche jusqu'à la porte, entre, lit le site, ressort avec sa note ;
// un rédacteur écrit le mail au QG, et la lettre part dans la file de validation (rien n'est envoyé sans toi).
import { buildGraph, offsetLine, pointAt, polyLength } from './chemins.js';
import { QG } from './sprites.js';
import { t as tr } from './i18n.js';

export const TEAM = {
  chef: { name: 'Prosper', role: 'chef', label: "chef d'équipe" },
  eclaireur: { name: 'Léo', role: 'eclaireur', label: 'éclaireur' },
  'lecteur-1': { name: 'Hugo', role: 'lecteur', label: 'lecteur' },
  'lecteur-2': { name: 'Zoé', role: 'lecteur', label: 'lectrice' },
  'lecteur-3': { name: 'Iris', role: 'lecteur', label: 'lectrice' },
  'redacteur-1': { name: 'Malo', role: 'redacteur', label: 'rédacteur' },
  'redacteur-2': { name: 'Nina', role: 'redacteur', label: 'rédactrice' },
};

const ease = (t) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));
/** Une marche pressée : démarrage et arrivée en douceur, le milieu à pleine vitesse. */
const travel = (t) => {
  const a = 0.18;
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const v = 1 / (1 - a); // vitesse de croisière (pour que la distance totale fasse 1)
  if (t < a) return (v * t * t) / (2 * a);
  if (t > 1 - a) { const u = 1 - t; return 1 - (v * u * u) / (2 * a); }
  return v * (t - a / 2);
};
const dirOf = (dx, dy) => (Math.abs(dx) > Math.abs(dy) * 0.9 ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up');
const host = (url) => { try { return new URL(url).host.replace(/^www\./, ''); } catch { return ''; } };
/** Les adresses mail à l'écran : la partie avant le @ masquée. */
export const masque = (t) => String(t ?? '').replace(/[\w.+-]+@([\w-]+\.[\w.-]+)/g, '•••••@$1');

/** « salle de sport » → « salles de sport », « agence immobilière » → « agences immobilières ». */
const PLURIELS = {
  yoga: 'studios de yoga', 'café': 'cafés', 'kiné': 'kinés', 'auto-école': 'auto-écoles', 'institut de beauté': 'instituts de beauté',
  'agence immobilière': 'agences immobilières', 'hôtel': 'hôtels', 'garage': 'garages', 'bar': 'bars', 'barbier': 'barbiers',
};
export function pluriel(m) {
  const k = String(m ?? '').trim().toLowerCase();
  if (PLURIELS[k]) return tr(PLURIELS[k]);
  const w = String(m ?? 'commerce').trim().split(' ');
  const pl = (x) => (/[sxz]$/i.test(x) ? x : x + 's');
  w[0] = pl(w[0]);
  if (w.length === 2 && !/^(de|du|des|d')$/i.test(w[1])) w[1] = pl(w[1]);
  return tr(w.join(' '));
}
const cap = (t) => String(t ?? '').replace(/^./, (c) => c.toUpperCase());

class Actor {
  constructor(id, x, y) {
    const info = TEAM[id] ?? { name: id, role: 'lecteur', label: '' };
    Object.assign(this, { id, name: info.name, role: info.role, label: info.label });
    this.x = x; this.y = y; this.alt = 0;
    this.dir = 'down'; this.pose = 'stand'; this.frame = 0; this.eyes = 'open';
    this.alpha = 1;
    this.tasks = [];
    this.cur = null;
    this.curT = 0;
    this.route = null; // le chemin qu'il suit (pour dessiner la trace)
    this.routeD = 0;
    this.target = null; // l'identifiant du commerce visé
    this.bubble = null; // { text, until, kind }
    this.status = tr('Au QG');
    this.lane = [];
    this.anim = 0;
    this.nextBlink = 1 + Math.random() * 3;
    this.blinkUntil = 0;
    this.cheerUntil = 0;
    this.home = [x, y];
    this.inside = null;
  }
  get busy() { return Boolean(this.cur || this.tasks.length); }
  /** Une réplique. prio 3 : toujours dite (et entendue à la radio si le robot n'est pas à l'écran) ; 0 : seulement s'il est à l'écran. */
  say(text, ms = 1800, kind = '', prio = 1) { this.world.talk(this, text, ms, kind, prio); }
  do(...t) { this.tasks.push(...t); return this; }
}

export class Monde {
  constructor(city, opts = {}) {
    this.city = city;
    this.graph = buildGraph(city);
    this.time = 0;
    this.opts = opts;
    this.qg = this.placeQG();
    this.actors = new Map();
    this.places = new Map();
    this.fx = [];
    this.order = []; // les commerces, dans l'ordre où l'éclaireur les a trouvés
    this.listeners = new Set();
    this.reset();
  }

  /** La conversation de l'équipe : une réplique à la fois, les moins importantes passent leur tour s'il y a du monde. */
  talk(a, text, ms, kind, prio) {
    const now = this.time;
    const cur = this.line;
    if (cur && now < cur.until && prio < cur.prio && prio < 3) return;
    if (prio <= 0 && cur && now < cur.until) return;
    for (const b of this.actors.values()) if (b !== a) b.bubble = null;
    a.bubble = { text, until: now + ms / 1000, kind, at: now, prio };
    this.line = { a, text, until: now + ms / 1000, prio, kind, at: now };
    this.emit('line', this.line);
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type, data) { for (const fn of this.listeners) fn(type, data); }

  reset() {
    this.time = 0;
    this.actors.clear();
    this.places.clear();
    this.order = [];
    this.fx = [];
    const q = this.qg;
    const spot = (k) => [q.x + k * 4.8, q.door[1] + 11 + Math.abs(k) * 0.5];
    const homes = { chef: spot(0), 'redacteur-1': spot(-1.6), 'redacteur-2': spot(1.6), 'lecteur-1': spot(-3), 'lecteur-2': spot(3), 'lecteur-3': spot(-4.4), eclaireur: spot(4.4) };
    for (const id of Object.keys(TEAM)) {
      const [x, y] = homes[id];
      const a = new Actor(id, x, y);
      a.world = this;
      a.home = [x, y];
      if (id === 'eclaireur') { a.alt = 0; a.dir = 'down'; }
      // au départ, toute l'équipe est à l'intérieur ; Prosper sort le premier
      a.alpha = 0;
      a.x = q.door[0]; a.y = q.door[1];
      a.inside = 'qg';
      this.actors.set(id, a);
    }
    this.mission = null;
    this.progress = null;
    this.scan = null;
    this.introDone = false;
    this.timers = [];
    this.journal = [];
    this.line = null;
    this.teamSent = false;
    this.writeGo = false;
    this.firstKept = null;
    this.firstMail = null;
  }

  /* ------------------------------------------------------------------ le QG : sur une place, près du centre */
  placeQG() {
    const c = this.city;
    const W = QG.w * 0.5, D = QG.d * 0.5; // en mètres
    const free = (cx, cy) => {
      // de la place devant le QG (on voit l'équipe en entier, sans toit d'immeuble par-dessus)
      for (let y = cy - D / 2 - 3; y <= cy + D / 2 + 26; y += 2) {
        for (let x = cx - W / 2 - 4; x <= cx + W / 2 + 4; x += 2) {
          if (c.buildingAt(x, y)) return false;
          if (y > cy + D / 2 + 1) continue;
          const a = c.areaAt(x, y);
          if (a >= 11) return false; // l'eau
          const n = c.nearestRoad(x, y, 20, (r) => r.rank >= 3 && !r.pave);
          if (n && n.d < n.half + 0.6) return false;
        }
      }
      // une rue (ou une place piétonne) devant la porte
      const n = c.nearestRoad(cx, cy + D / 2 + 3, 26);
      return Boolean(n);
    };
    for (let r = 0; r <= 700; r += 7) {
      const steps = Math.max(1, Math.round((2 * Math.PI * r) / 7));
      for (let k = 0; k < steps; k++) {
        const a = (k / steps) * Math.PI * 2;
        const cx = Math.round(Math.cos(a) * r), cy = Math.round(Math.sin(a) * r);
        if (free(cx, cy)) return this.qgAt(cx, cy);
      }
    }
    return this.qgAt(0, 0);
  }
  qgAt(cx, cy) {
    const W = QG.w * 0.5, D = QG.d * 0.5;
    return {
      x: cx, y: cy, w: W, d: D,
      x0: cx - W / 2, y0: cy - D / 2, // le coin nord-ouest au sol
      door: [cx, cy + D / 2 + 0.6],
      pad: [cx + W / 2 - 9, cy - D / 2 + 7], padAlt: QG.h * 0.5 + 1.2, // la piste de l'éclaireur, sur le toit
    };
  }

  /* ------------------------------------------------------------------ les commerces */
  doorOf(p) {
    const c = this.city;
    const [x, y] = c.toXY(p.lat, p.lon);
    const n = c.nearestRoad(x, y, 90, (r) => r.cls !== 'motorway' && !r.bridge);
    const b = c.buildingAt(x, y);
    if (!n) return { x, y, face: 'up', bid: b?.id ?? null };
    const ux = x - n.x, uy = y - n.y, l = Math.hypot(ux, uy) || 1;
    let d = Math.min(l, n.half + 1.3);
    let dx = n.x + (ux / l) * d, dy = n.y + (uy / l) * d;
    while (d > n.half * 0.6 && c.buildingAt(dx, dy)) { d -= 0.4; dx = n.x + (ux / l) * d; dy = n.y + (uy / l) * d; }
    const face = Math.abs(uy) > Math.abs(ux) ? (uy < 0 ? 'up' : 'down') : ux < 0 ? 'left' : 'right';
    return { x: dx, y: dy, face, bid: b?.id ?? c.buildingAt(dx + (ux / l) * 2.5, dy + (uy / l) * 2.5)?.id ?? null };
  }
  place(id) { return this.places.get(id); }
  addPlace(p) {
    let q = this.places.get(p.id);
    if (q) return Object.assign(q, { data: { ...q.data, ...p } });
    const door = this.doorOf(p);
    q = { id: p.id, name: p.name, data: p, ...door, state: 'cache', stateAt: this.time, score: null, revealed: false, read: false };
    this.places.set(p.id, q);
    this.order.push(q);
    return q;
  }
  setState(q, state) {
    if (!q || q.state === state) return;
    q.state = state;
    q.stateAt = this.time;
    this.emit('place', q);
  }

  /* ------------------------------------------------------------------ les gestes des agents */
  /** Un événement venu du chef (en direct ou rejoué) : il rejoint la file de l'agent concerné. */
  push(e) {
    if (e.agent === 'chef' && e.type === 'start') {
      this.reset();
      this.mission = { ...e.data };
    }
    if(e.agent==='chef' && ['progress','end'].includes(e.type) && e.data?.objectif_contacts){this.progress={...e.data};this.emit('progress',this.progress);if(e.type==='progress')return;}
    if(e.agent==='chef' && e.type==='decision' && e.place_id) {
      const q=this.places.get(e.place_id); if(q){ q.savedDecision={...e.data}; if(q.mail) {Object.assign(q,{objet:e.data.objet ?? q.objet,mail:e.data.mail ?? q.mail});this.setState(q,e.data.decision);} }
      return;
    }
    if (e.place_id && e.agent === 'eclaireur' && e.type === 'found') this.addPlace(e.data);
    this.actors.get(e.agent)?.lane.push(e);
  }

  /** Transforme le prochain événement de la file d'un agent en gestes. */
  stage(a, e) {
    const d = e.data ?? {};
    const q = e.place_id ? this.places.get(e.place_id) : null;
    const W = this;
    if (a.id === 'chef') {
      if (e.type === 'start') {
        a.do({ t: 'wait', ms: 200 }, { t: 'exit' }, { t: 'go', to: a.home, dur: 0.6 },
          { t: 'call', fn: () => { a.say(tr('Mission : les {metier} de {ville} !', { metier: pluriel(d.metier), ville: d.ville ?? tr('la ville') }), 2100, 'chef', 3); a.status = tr('Lance la mission'); } },
          { t: 'wait', ms: 2100, pose: 'wave', dir: 'down' },
          { t: 'call', fn: () => { a.say(tr('Léo, trouve-les-moi.'), 1400, 'chef', 3); } },
          { t: 'wait', ms: 900, dir: 'down' }, { t: 'call', fn: () => { this.introDone = true; } });
        // le reste de l'équipe sort derrière lui
        let k = 0;
        for (const id of ['redacteur-1', 'redacteur-2', 'lecteur-1', 'lecteur-2', 'lecteur-3','eclaireur']) {
          const b = this.actors.get(id);
          b.tasks.unshift({ t: 'wait', ms: 700 + k++ * 260 }, { t: 'exit' }, { t: 'go', to: b.home, dur: 0.55 }, { t: 'wait', ms: 120, dir: 'down' });
        }
        this.emit('mission', this.mission);
      }
      if (e.type === 'end') {
        a.do({ t: 'until', fn: () => [...this.actors.values()].every((b) => b === a || (!b.busy && !b.lane.length)) },
          { t: 'call', fn: () => { this.emit('end', d); a.say(tr(d.partiel||d.erreur?"Résultats conservés : {nombre} mails prêts.":"Mission terminée : {nombre} mails t'attendent.", { nombre: d.ecrits ?? 0 }), 4200, 'chef', 3); a.status = tr(d.partiel||d.erreur?'Objectif incomplet':'Mission terminée'); for (const b of this.actors.values()) b.cheerUntil = this.time + 2.6; } },
          { t: 'wait', ms: 2600, pose: 'cheer', dir: 'down' });
      }
      return;
    }
    if (a.id === 'eclaireur') {
      if (e.type === 'step') {
        const texte = d.texte.replace(/ indépendants sur la carte, j'en garde /, ' sur la carte, j’en garde ');
        if (!a.flying) {
          a.do({ t: 'until', fn: () => this.introDone }, { t: 'call', fn: () => { a.say(tr('Je scanne la ville…'), 1600, '', 2); a.status = tr('Scanne la ville'); } },
            { t: 'wait', ms: 800, pose: 'carry', dir:'down' },
            { t: 'call', fn: () => { a.flying = true; this.scan = { x: this.qg.x, y: this.qg.y, t0: this.time, speed: 520, r: 0 }; W.emit('scan', this.scan); } });
        } else a.do({ t: 'call', fn: () => { this.journal.push({ who: a.id, texte }); } });
      }
      if (e.type === 'found' && q) {
        const dist = Math.hypot(q.x - this.qg.x, q.y - this.qg.y);
        // un commerce ajouté à la main (cliqué sur la carte) : il s'allume tout de suite
        const now = Boolean(d.visite) || (!this.scan && this.teamSent);
        a.do({ t: 'until', fn: () => now || (this.scan && this.scan.r >= dist) },
          { t: 'call', fn: () => {
            q.revealed = true;
            W.setState(q, 'trouve');
            W.fx.push({ kind: 'ring', x: q.x, y: q.y, t0: W.time, dur: 0.7 });
            a.status = tr('Trouve {nom}', { nom: q.name });
            W.emit('found', q);
          } });
      }
      if (e.type === 'error') a.do({ t: 'call', fn: () => { this.teamSent = true; if (this.scan) this.scan.end = this.time; a.say(tr('La source des commerces ne répond pas…'), 1800, 'bad', 3); } });
      if (e.type === 'done') {
        a.do({ t: 'call', fn: () => {
            const n = d.trouves ?? this.order.length;
            a.say(!d.objectif_contacts && d.demandes && n < d.demandes ? tr("{nombre} sur {demandes} : la zone n'en a pas plus.", { nombre: n, demandes: d.demandes }) : tr('{nombre} sur la carte !', { nombre: n }), 2000, 'good', 3);
            a.status = tr('Rentre au QG');
            if (this.scan) this.scan.end = this.time;
            if (this.mission) Object.assign(this.mission, { trouves: n, demandes: d.demandes ?? this.mission.nombre, rayon: d.rayon ?? this.mission.rayon });
            this.emit('scouted', { ...d, trouves: n });
          } },
          { t: 'wait', ms: 700, pose: 'stand' },
          { t: 'go', to: a.home, dur: 0.9 },
          { t: 'call', fn: () => { a.flying = false; a.status = tr('Au QG'); } });
        // Prosper envoie les lecteurs quand l'éclaireur a fini (ou tout de suite s'il en a déjà trouvé et que ça traîne)
        this.later(1.5, () => {
          if (this.teamSent) return;
          this.actors.get('chef').say(tr('Hugo, Zoé, Iris : allez les voir !'), 1700, 'chef', 3);
          this.later(0.9, () => { this.teamSent = true; this.emit('team', null); });
        });
      }
      return;
    }
    if (a.role === 'lecteur' && q) {
      if (e.type === 'start') {
        a.do({ t: 'until', fn: () => q.revealed && this.teamSent });
        if (a.inside) a.do({ t: 'exit' });
        a.do({ t: 'call', fn: () => {
            a.status = tr('Va chez {nom}', { nom: q.name }); a.target = q.id;
            if (!a.trips) a.say(tr(['Je file !', 'J’y vais !', 'C’est parti !'][['lecteur-1', 'lecteur-2', 'lecteur-3'].indexOf(a.id)] ?? 'J’y vais !'), 1100, '', 0);
            a.trips = (a.trips ?? 0) + 1;
            W.emit('go', { a, q });
          } },
          { t: 'go', to: [q.x, q.y], target: q.id },
          { t: 'wait', ms: 120, dir: q.face },
          { t: 'enter', place: q.id },
          { t: 'call', fn: () => { W.setState(q, 'lecture'); a.status = tr('Lit {nom}', { nom: host(q.data.website) || q.name }); q.journal = []; W.emit('read', { a, q }); } },
          { t: 'wait', ms: 650 });
      }
      if (e.type === 'step') {
        // ce que le lecteur fait sur le site : dans la fiche du commerce (et dans l'hologramme du site), pas en bulle
        a.do({ t: 'call', fn: () => { (q.journal ??= []).push(d.texte); W.emit('step', { a, q, texte: d.texte }); } }, { t: 'wait', ms: 380 });
      }
      if (e.type === 'skip') {
        // l'objectif de mails est atteint : ce commerce ne sera pas lu
        a.do({ t: 'call', fn: () => { W.setState(q, 'saute'); } });
        return;
      }
      if (e.type === 'done') {
        a.do({ t: 'wait', ms: 200 },
          { t: 'exit', place: q.id },
          { t: 'call', fn: () => {
            q.score = d.score; q.read = true;
            q.raisons = d.raisons ?? []; q.retenu = d.retenu;
            Object.assign(q, { signals: d.signals ?? {}, email: d.email ?? null, email_source: d.email_source ?? null, telephones: d.telephones ?? [], raison: d.raison ?? null, doneAt: W.time });
            W.setState(q, d.retenu ? 'retenu' : 'ecarte');
            W.fx.push({ kind: 'score', x: q.x, y: q.y, t0: W.time, dur: 1.6, score: d.score, good: d.retenu });
            const top = (d.raisons ?? []).filter((r) => r.pts > 0).sort((x, y) => y.pts - x.pts)[0];
            if (d.retenu) {
              const first = !this.firstKept;
              this.firstKept = this.firstKept ?? q.id;
              a.say(`${q.name} : ${tr(top ? top.texte : 'à contacter')} !`, 2000, 'good', first ? 3 : 1);
              if (first && this.mission?.redaction_active !== false) this.later(2.1, () => { this.actors.get('chef').say(tr('Client potentiel ! Malo, Nina : écrivez-leur.'), 1800, 'chef', 3); this.later(1.6, () => { this.writeGo = true; }); });
            } else a.say(tr('Pas pour nous.'), 1100, 'bad', 0);
            if (d.retenu) a.cheerUntil = W.time + 0.9;
            a.status = d.retenu ? tr('{nom} retenu', { nom: q.name }) : tr('{nom} écarté', { nom: q.name });
            a.target = null;
            W.emit('scored', { a, q, d });
          } },
          { t: 'wait', ms: d.retenu ? 1000 : 600, dir: 'down' });
      }
      return;
    }
    if (a.role === 'redacteur' && q) {
      if (e.type === 'start') {
        a.do({ t: 'until', fn: () => q.read && (this.writeGo || q.data?.visite) },
          { t: 'call', fn: () => { W.setState(q, 'ecriture'); a.target = q.id; a.status = tr('Écrit à {nom}', { nom: q.name }); a.say(tr("J'écris à {nom}…", { nom: q.name }), 1600, '', 0); W.emit('write', { a, q }); } },
          { t: 'wait', ms: 1500, pose: 'carry', dir: 'down' });
      }
      if (e.type === 'done') {
        a.do({ t: 'call', fn: () => {
          Object.assign(q, { objet: d.objet, mail: d.mail, to: d.to });
          if(q.savedDecision) { Object.assign(q,{objet:q.savedDecision.objet ?? q.objet,mail:q.savedDecision.mail ?? q.mail}); W.setState(q,q.savedDecision.decision); } else W.setState(q, 'pret');
          W.fx.push({ kind: 'letter', x: a.x, y: a.y - 6, t0: W.time, dur: 1.1, place: q.id });
          if (!this.firstMail) { this.firstMail = q.id; a.say(tr('Mail prêt. Il attend ta validation.'), 2200, 'good', 3); }
          else a.say(tr('Mail prêt !'), 1100, 'good', 0);
          a.status = tr('Mail prêt');
          a.target = null;
          W.emit('mail', { a, q, d });
        } }, { t: 'wait', ms: 900, pose: 'stand', dir: 'down' });
      }
      if (e.type === 'retry') a.do({ t: 'call', fn: () => { a.status=tr('Reprise de la rédaction…'); a.say(tr('Reprise de la rédaction…'),1800,'',1); } });
      if (e.type === 'error') a.do({ t: 'call', fn: () => { W.setState(q, 'retenu'); a.target = null; } });
    }
  }

  /* ------------------------------------------------------------------ le temps qui passe */
  later(sec, fn) { this.timers.push({ at: this.time + sec, fn }); }

  update(dt) {
    this.time += dt;
    if (this.timers.length) {
      const due = this.timers.filter((k) => k.at <= this.time);
      this.timers = this.timers.filter((k) => k.at > this.time);
      for (const k of due) k.fn();
    }
    if (this.scan) {
      this.scan.r = (this.time - this.scan.t0) * this.scan.speed;
      if (this.scan.end && this.time - this.scan.end > 1.2) this.scan = null;
    }
    for (const a of this.actors.values()) {
      if (!a.cur && !a.tasks.length && a.lane.length) this.stage(a, a.lane.shift());
      this.runTasks(a, dt);
      this.animate(a, dt);
    }
    this.fx = this.fx.filter((f) => this.time - f.t0 < f.dur);
  }

  runTasks(a, dt) {
    let guard = 0;
    while (guard++ < 20) {
      if (!a.cur) {
        a.cur = a.tasks.shift() ?? null;
        a.curT = 0;
        if (!a.cur) { if (a.pose === 'walk') a.pose = 'stand'; return; }
        this.begin(a, a.cur);
      }
      const done = this.step(a, a.cur, dt);
      if (!done) return;
      a.cur = null;
      dt = 0;
    }
  }

  begin(a, k) {
    if (k.t === 'go') {
      let pts = this.graph.path(a.x, a.y, k.to[0], k.to[1]);
      if (pts.length > 2) pts = [pts[0], ...offsetLine(pts.slice(1, -1), 1.6), pts.at(-1)];
      k.pts = pts;
      k.len = polyLength(pts);
      k.dur = k.dur ?? Math.max(0.9, Math.min(3.4, 0.6 + k.len / 430));
      a.route = k.target ? pts : null;
      a.routeTarget = k.target ?? null;
      a.routeAt = this.time;
      k.lead = k.target ? 0.45 : 0; // le temps que le tracé arrive au commerce, avant le départ
    }
    if (k.t === 'fly') { k.from = [a.x, a.y, a.alt]; k.alt = k.alt ?? a.alt; }
    if (k.t === 'enter' || k.t === 'exit') k.dur = 0.32;
  }

  step(a, k, dt) {
    a.curT += dt;
    const t = a.curT;
    switch (k.t) {
      case 'wait':
        if (k.pose) a.pose = k.pose;
        if (k.dir) a.dir = k.dir;
        if (t * 1000 >= k.ms) { if (k.pose) a.pose = 'stand'; return true; }
        return false;
      case 'call': k.fn(); return true;
      case 'until': return k.fn();
      case 'go': {
        if (t < (k.lead ?? 0)) { a.pose = 'stand'; a.dir = k.pts.length > 1 ? dirOf(k.pts[1][0] - k.pts[0][0], k.pts[1][1] - k.pts[0][1]) : a.dir; return false; }
        const u = Math.min(1, (t - (k.lead ?? 0)) / k.dur);
        const d = travel(u) * k.len;
        const p = pointAt(k.pts, d);
        a.x = p.x; a.y = p.y;
        a.routeD = d;
        if (Math.abs(p.dx) + Math.abs(p.dy) > 1e-6) a.dir = Math.abs(p.dx) > Math.abs(p.dy) * 0.9 ? (p.dx > 0 ? 'right' : 'left') : p.dy > 0 ? 'down' : 'up';
        a.pose = 'walk';
        a.speed = k.len / k.dur;
        if (u >= 1) { a.pose = 'stand'; a.route = null; a.speed = 0; return true; }
        // de la poussière quand il court vite
        if (a.speed > 60 && Math.random() < dt * 14) this.fx.push({ kind: 'dust', x: a.x, y: a.y, t0: this.time, dur: 0.45, vx: -Math.sign(p.dx || 1) });
        return false;
      }
      case 'fly': {
        const u = Math.min(1, t / k.dur);
        const e = ease(u);
        a.x = k.from[0] + (k.to[0] - k.from[0]) * e;
        a.y = k.from[1] + (k.to[1] - k.from[1]) * e;
        a.alt = k.from[2] + (k.alt - k.from[2]) * e;
        a.pose = 'fly';
        const dx = k.to[0] - k.from[0], dy = k.to[1] - k.from[1];
        if (Math.abs(dx) + Math.abs(dy) > 0.5) a.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
        if (k.target) a.routeTarget = k.target;
        if (u >= 1) { a.routeTarget = null; if (!a.flying && a.alt <= this.qg.padAlt + 0.1) a.pose = 'stand'; return true; }
        return false;
      }
      case 'enter': {
        a.alpha = 1 - Math.min(1, t / k.dur);
        if (t >= k.dur) { a.inside = k.place ?? 'qg'; a.alpha = 0; return true; }
        return false;
      }
      case 'exit': {
        a.inside = null;
        a.alpha = Math.min(1, t / k.dur);
        if (t >= k.dur) { a.alpha = 1; return true; }
        return false;
      }
    }
    return true;
  }

  animate(a, dt) {
    a.anim += dt;
    const fps = a.pose === 'walk' ? Math.min(14, 6 + (a.speed ?? 0) / 18) : a.pose === 'fly' ? 12 : 4;
    a.frame = Math.floor(a.anim * fps) % 4;
    if (this.time > a.nextBlink) { a.blinkUntil = this.time + 0.13; a.nextBlink = this.time + 2 + Math.random() * 3; }
    a.eyes = this.time < a.blinkUntil ? 'blink' : this.time < a.cheerUntil ? 'happy' : 'open';
    if (this.time < a.cheerUntil && a.pose === 'stand') a.pose = 'cheer';
    else if (this.time >= a.cheerUntil && a.pose === 'cheer' && !(a.cur?.t === 'wait' && a.cur.pose === 'cheer')) a.pose = 'stand';
    if (a.bubble && this.time > a.bubble.until) a.bubble = null;
  }

  /** Tout le monde a fini (plus rien dans les files, plus aucun geste en cours). */
  get idle() { return [...this.actors.values()].every((a) => !a.busy && !a.lane.length); }
}

