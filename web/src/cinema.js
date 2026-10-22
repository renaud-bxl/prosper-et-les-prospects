// La version cinéma du QG : la vraie mission rejouée comme un film. Le réalisateur connaît d'avance tout ce qui va se passer
// (une première passe, sans image, relève l'heure de chaque geste), choisit ses plans, ralentit sur les moments forts
// (la note d'un client potentiel, le mail prêt), accélère entre deux, et pose les titres, les chapitres et les compteurs.
import { polyLength } from './chemins.js';
import { masque } from './monde.js';
import { t as tr } from './i18n.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Relève l'heure de chaque geste en jouant la mission une fois, très vite, sans rien dessiner. */
export function survey(world, push) {
  world.reset();
  push();
  const marks = { reads: [], scored: [], mails: [], go: [], lines: [] };
  const off = world.on((type, d) => {
    const t = world.time;
    if (type === 'scan') marks.scan = t;
    if (type === 'scouted') marks.scanEnd = t;
    if (type === 'team') marks.team = t;
    if (type === 'go') marks.go.push({ t, a: d.a.id, q: d.q.id });
    if (type === 'read') marks.reads.push({ t, a: d.a.id, q: d.q.id });
    if (type === 'scored') marks.scored.push({ t, a: d.a.id, q: d.q.id, retenu: d.d.retenu, score: d.d.score });
    if (type === 'mail') marks.mails.push({ t, a: d.a.id, q: d.q.id });
    if (type === 'end') marks.end = t;
    if (type === 'line') marks.lines.push({ t, a: d.a.id, text: d.text });
  });
  for (let i = 0; i < 60 * 240 && !(world.idle && world.time > 5 && marks.end); i++) world.update(1 / 60);
  marks.fin = world.time;
  marks.scanEnd ??= (marks.scan ?? 5) + 3;
  off();
  world.reset();
  push();
  return marks;
}

export function createCinema(root, { world, cam, marks, metier, ville, duree, setTod }) {
  root.innerHTML = `
    <div class="cn-bars"><i></i><i></i></div>
    <div class="cn-vignette"></div>
    <div class="cn-title" id="cn-title"><span class="cn-kicker">${esc(tr('Mission'))}</span><h1>Prosper et les prospects</h1><p></p></div>
    <div class="cn-chapter" id="cn-chapter"><b></b><span></span></div>
    <div class="cn-count" id="cn-count">
      <div data-k="trouves"><b>0</b><span>${esc(tr('établissements repérés'))}</span></div>
      <div data-k="retenus"><b>0</b><span>${esc(tr('clients potentiels'))}</span></div>
      <div data-k="prets" class="hot"><b>0</b><span>${esc(tr('mails prêts'))}</span></div>
    </div>
    <div class="cn-mail" id="cn-mail"><div class="cm-bar"><i></i><i></i><i></i><span>${esc(tr('Nouveau message'))}</span></div><p class="cm-to"></p><p class="cm-obj"></p><p class="cm-body"></p><div class="cm-foot"><span>${esc(tr('En attente de ta validation'))}</span><b>${esc(tr('Rien ne part sans toi'))}</b></div></div>
    <div class="cn-end" id="cn-end"><div class="ce-row"><b data-k="trouves">0</b><span>${esc(tr('établissements repérés'))}</span></div><div class="ce-row hot"><b data-k="prets">0</b><span>${esc(tr('mails prêts'))}</span></div><div class="ce-row"><b data-k="duree">0</b><span>${esc(tr('secondes'))}</span></div><p>${esc(tr('Rien ne part sans toi.'))}</p></div>`;
  const $ = (id) => root.querySelector('#' + id);
  $('cn-title').querySelector('p').textContent = `${ville} · ${tr(metier)}`;

  /* ------------------------------------------------------------------ le découpage */
  const M = marks;
  const firstKept = M.scored.find((s) => s.retenu);
  // la vedette : le client potentiel le mieux noté (en cas d'égalité, celui qui arrive le plus tard, pour finir fort)
  const best = [...M.scored].filter((s) => s.retenu).sort((a, b) => b.score - a.score || b.t - a.t)[0];
  const stars = [firstKept, best && best.q !== firstKept?.q ? best : null].filter(Boolean);
  const goOf = (s) => [...M.go].reverse().find((g) => g.q === s.q && g.t <= s.t);
  const readOf = (s) => M.reads.find((r) => r.q === s.q);
  const mailOf = (s) => M.mails.find((m) => m.q === s.q);
  const shots = [];
  const add = (from, to, kind, o = {}) => { if (to > from) shots.push({ from, to, kind, ...o }); };
  const scan = M.scan ?? 4, team = M.team ?? scan + 4;
  add(0, 2.2, 'opening');
  add(2.2, scan - 0.9, 'qg');
  add(scan - 0.9, M.scanEnd + 0.4, 'scan');
  add(M.scanEnd + 0.4, team + 0.2, 'qg');
  add(team + 0.2, team + 2.6, 'departs');
  let cursor = team + 2.6;
  for (const s of stars) {
    const go = goOf(s), rd = readOf(s), ml = mailOf(s);
    if (!go || !rd) continue;
    if (go.t - 0.2 > cursor) { add(cursor, go.t - 0.2, 'montage'); }
    add(Math.max(cursor, go.t - 0.2), rd.t - 0.15, 'follow', { a: s.a, q: s.q });
    add(rd.t - 0.15, s.t + 2.1, 'door', { a: s.a, q: s.q, star: s });
    cursor = s.t + 2.1;
    if (ml && s === stars[0]) {
      const wStart = ml.t - 1.6;
      if (wStart > cursor) add(cursor, wStart, 'montage');
      add(Math.max(cursor, wStart), ml.t + 1.4, 'writers', { q: s.q });
      cursor = ml.t + 1.4;
    } else if (ml) {
      add(cursor, ml.t + 1.4, 'writers', { q: s.q });
      cursor = ml.t + 1.4;
    }
  }
  const end = M.end ?? M.fin;
  add(cursor, end, 'rush');
  add(end, end + 5, 'finale');
  const total = end + 5;

  /** La vitesse du monde à chaque instant : ralenti sur les notes, accéléré pendant le montage et la fin. */
  function speedAt(t) {
    const s = shots.find((x) => t >= x.from && t < x.to);
    if (!s) return 1;
    if (s.kind === 'door' && s.star && Math.abs(t - s.star.t) < 0.5) return 0.35;
    if (s.kind === 'montage') return 1.7;
    if (s.kind === 'rush') return 5.5;
    if (s.kind === 'finale') return 1;
    return 1;
  }

  /* ------------------------------------------------------------------ la caméra de chaque plan */
  const qg = world.qg;
  function camFor(s, t, W, H) {
    const near = Math.min(W, H) / 110;
    const u = (t - s.from) / Math.max(0.01, s.to - s.from);
    switch (s.kind) {
      case 'opening': {
        // on continue la plongée commencée au-dessus de la France, jusqu'à la porte du QG
        const o = openFrom ?? (openFrom = { x: cam.x, y: cam.y, z: cam.z });
        const e = ease(u);
        const z1 = near * 0.95;
        return { x: o.x + (qg.x - o.x) * e, y: o.y + (qg.door[1] - 6 - o.y) * e, z: Math.exp(Math.log(o.z) + (Math.log(z1) - Math.log(o.z)) * e) };
      }
      case 'qg': return { x: qg.x + Math.sin(t * 0.3) * 1.5, y: qg.door[1] - 8, z: near * (1.02 + u * 0.08) };
      case 'scan': {
        const a = world.actors.get('eclaireur');
        const r = world.scan ? world.scan.r : 0;
        const zr = r > 0 ? Math.min(near * 0.8, (Math.min(W, H) * 0.48) / (r * 1.1 + 60)) : near * 0.8;
        return { x: qg.x, y: a.y - 10 - a.alt * 0.5, z: zr };
      }
      case 'departs': {
        // les trois lecteurs et leurs premières destinations
        let x0 = qg.x, x1 = qg.x, y0 = qg.y, y1 = qg.y;
        for (const a of world.actors.values()) if (a.route) for (const p of [a.route.at(-1), [a.x, a.y]]) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
        const z = Math.min(near * 0.55, (W * 0.7) / Math.max(120, x1 - x0), (H * 0.62) / Math.max(120, y1 - y0));
        return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 - 10, z };
      }
      case 'follow': {
        const a = world.actors.get(s.a);
        const q = world.places.get(s.q);
        if (!a.route) return { x: a.x, y: a.y - 10, z: near * 0.9 };
        const left = Math.max(0, polyLength(a.route) - a.routeD);
        const end = a.route.at(-1);
        // un plan large qui montre le tracé, puis on s'accroche au robot, puis la porte
        const k = clamp(1 - left / 120, 0, 1);
        const span = Math.max(Math.abs(a.x - end[0]) + 40, (Math.abs(a.y - end[1]) + 50) * (W / H));
        const zFar = clamp((W * 0.62) / span, near * 0.28, near * 0.9);
        const z = zFar + (near * 1.05 - zFar) * ease(k);
        const tx = (a.x + end[0]) / 2 + (end[0] - (a.x + end[0]) / 2) * k, ty = (a.y + end[1]) / 2 + (end[1] - (a.y + end[1]) / 2) * k - 10;
        return { x: tx, y: ty, z, q };
      }
      case 'door': {
        const q = world.places.get(s.q);
        const slow = s.star && Math.abs(t - s.star.t) < 0.6 ? 1.12 : 1.04;
        return { x: q.x, y: q.y - 14, z: near * slow };
      }
      case 'writers': return { x: qg.x, y: qg.door[1] - 2, z: near * 1.1 };
      case 'montage': {
        // un plan par lecteur, à tour de rôle : on le suit de près (on le voit courir, entrer, ressortir)
        const rs = ['lecteur-1', 'lecteur-2', 'lecteur-3'].map((id) => world.actors.get(id));
        const k = Math.floor((t - s.from) / 1.6);
        const a = rs[k % 3];
        const q = a.inside && a.inside !== 'qg' ? world.places.get(a.inside) : null;
        const p = q ?? a;
        return { x: p.x, y: p.y - 12, z: near * 0.95, key: `m${k}`, follow: true };
      }
      case 'rush':
      case 'finale': return overview(W, H);
    }
    return { x: qg.x, y: qg.y, z: near * 0.5 };
  }
  function overview(W, H) {
    const ps = [...world.places.values()].filter((q) => q.state !== 'cache');
    let x0 = qg.x, x1 = qg.x, y0 = qg.y, y1 = qg.y;
    for (const q of ps) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
    const z = Math.min((W * 0.8) / Math.max(300, x1 - x0), (H * 0.72) / Math.max(300, y1 - y0));
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z };
  }

  /* ------------------------------------------------------------------ chaque image */
  let cur = null, prev = null, trans = null, chapterShown = new Set(), lastCount = {}, openFrom = null;
  const CHAPTERS = { scan: ['1', tr("L'éclaireur scanne la ville")], departs: ['2', tr('Les lecteurs vont voir chaque salle')], writers: ['3', tr('Les rédacteurs écrivent les mails')], rush: ['4', tr('Tout attend ta validation')] };
  function chapter(kind) {
    if (!CHAPTERS[kind] || chapterShown.has(kind)) return;
    chapterShown.add(kind);
    const el = $('cn-chapter');
    el.querySelector('b').textContent = CHAPTERS[kind][0];
    el.querySelector('span').textContent = CHAPTERS[kind][1];
    el.classList.remove('in'); void el.offsetWidth; el.classList.add('in');
  }

  function update(W, H, dpr) {
    const t = world.time;
    const s = shots.find((x) => t >= x.from && t < x.to) ?? shots.at(-1);
    let want = camFor(s, t, W, H);
    if (s !== cur || (want.key && want.key !== cur?._key)) {
      // changement de plan : coupe franche, ou un vol (on prend de la hauteur, on plonge) si c'est loin
      const from = { x: cam.x, y: cam.y, z: cam.z };
      const far = Math.hypot(want.x - from.x, want.y - from.y) * Math.min(want.z, from.z) > Math.min(W, H) * 0.7;
      const kinds = `${cur?.kind}>${s.kind}`;
      const glide = ['opening>qg', 'qg>scan', 'scan>qg', 'qg>departs', 'departs>follow', 'follow>door', 'door>writers', 'writers>montage', 'montage>follow'].includes(kinds);
      trans = cur && s !== cur ? { from, t0: t, dur: far ? 1.1 : glide ? 0.8 : 0, swoop: far } : null;
      prev = cur;
      cur = s;
      cur._key = want.key;
      chapter(s.kind);
    }
    if (trans && trans.dur > 0) {
      const u = clamp((t - trans.t0) / (trans.dur * (speedAt(t) || 1)), 0, 1);
      const e = ease(u);
      const hump = trans.swoop ? Math.sin(Math.PI * u) * 1.1 : 0;
      cam.x = trans.from.x + (want.x - trans.from.x) * e;
      cam.y = trans.from.y + (want.y - trans.from.y) * e;
      cam.z = Math.exp(Math.log(trans.from.z) + (Math.log(want.z) - Math.log(trans.from.z)) * e - hump);
      if (u >= 1) trans = null;
    } else Object.assign(cam, { x: want.x, y: want.y, z: want.z });

    $('cn-title').classList.remove('on');
    // les compteurs
    const ps = [...world.places.values()];
    const n = {
      trouves: ps.filter((q) => q.state !== 'cache').length,
      retenus: ps.filter((q) => ['retenu', 'ecriture', 'pret', 'valide'].includes(q.state)).length,
      prets: ps.filter((q) => q.state === 'pret' || q.state === 'valide').length,
    };
    const cnt = $('cn-count');
    cnt.classList.toggle('on', t > (M.scan ?? 5) && s.kind !== 'finale');
    for (const [k, v] of Object.entries(n)) {
      if (lastCount[k] === v) continue;
      const el = cnt.querySelector(`[data-k="${k}"]`);
      el.querySelector('b').textContent = v;
      if (lastCount[k] != null) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
      lastCount[k] = v;
    }
    // le mail qui s'écrit
    const mailEl = $('cn-mail');
    if (s.kind === 'writers') {
      const q = world.places.get(s.q);
      const typing = q?.mail ? 1 : 0;
      if (!mailEl.classList.contains('on')) {
        mailEl.classList.add('on');
        mailEl.querySelector('.cm-to').innerHTML = `<span>${esc(tr('À'))}</span>${esc(masque(q?.to ?? q?.email ?? ''))}`;
      }
      if (q?.mail) {
        mailEl.querySelector('.cm-obj').textContent = q.objet ?? '';
        const body = (q.mail ?? '').split('\n').filter(Boolean).slice(0, 3).join('\n');
        const since = t - (q.stateAt ?? t);
        mailEl.querySelector('.cm-body').textContent = body.slice(0, Math.floor(clamp(since / 1.1, 0, 1) * body.length));
      } else mailEl.querySelector('.cm-obj').textContent = tr("J'écris à {nom}…", { nom: q?.name ?? '' });
      void typing;
    } else mailEl.classList.remove('on');
    // la fin
    const endEl = $('cn-end');
    document.body.classList.toggle('finale', s.kind === 'finale');
    if (s.kind === 'finale') {
      if (!endEl.classList.contains('on')) {
        endEl.classList.add('on');
        endEl.querySelector('[data-k="duree"]').textContent = Math.round(duree ?? 39);
        setTod?.('nuit');
      }
      endEl.querySelector('[data-k="trouves"]').textContent = n.trouves;
      endEl.querySelector('[data-k="prets"]').textContent = Math.max(n.prets, M.mails.length);
    }
  }

  /** Pendant le vol au-dessus de la France : le titre. */
  function title(on) { $('cn-title').classList.toggle('on', on); }

  return { update, speedAt, total, shots, title };
}

