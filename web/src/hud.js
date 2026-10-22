// L'interface de jeu du QG : la mission en cours, les compteurs (comme les ressources d'un jeu), l'équipe avec ce que fait
// chacun, la file de validation (les lettres arrivent là, rien ne part sans toi), les bulles des robots et la carte du score.
import { ROLES, portrait, ANCHOR_Y } from './robots.js';
import { badgeSprite } from './sprites.js';
import { TEAM, masque } from './monde.js';
import { t as tr, getLocale } from './i18n.js';

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const host = (url) => { try { return new URL(url).host.replace(/^www\./, ''); } catch { return ''; } };
const capital = (s) => String(s ?? '').replace(/^./, (c) => c.toUpperCase());

function icon(state, scale = 3) {
  const b = badgeSprite(state);
  const c = document.createElement('canvas');
  const density = Math.min(3, globalThis.devicePixelRatio || 1);
  c.width = Math.ceil((b.c.logicalWidth ?? b.c.width) * scale * density); c.height = Math.ceil((b.c.logicalHeight ?? b.c.height) * scale * density);
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(b.c, 0, 0, c.width, c.height);
  return c;
}

export function createHud(root, world) {
  root.innerHTML = `
    <section class="quest" id="h-quest" hidden>
      <span class="tag"><i></i>${esc(tr('Mission'))}</span>
      <h1 id="h-title"></h1>
      <p id="h-sub"></p>
      <div class="q-bar"><i id="h-bar"></i></div>
    </section>
    <section class="res" id="h-res" hidden>
      <div class="r" data-k="trouves"><span class="ic" data-i="trouve"></span><b>0</b><em>${esc(tr('repérées'))}</em></div>
      <div class="r" data-k="lus"><span class="ic" data-i="lecture"></span><b>0</b><em>${esc(tr('sites lus'))}</em></div>
      <div class="r" data-k="retenus"><span class="ic" data-i="retenu"></span><b>0</b><em>${esc(tr('clients potentiels'))}</em></div>
      <div class="r hot" data-k="prets"><span class="ic" data-i="pret"></span><b>0</b><em>${esc(tr('mails prêts'))}</em></div>
    </section>
    <section class="party" id="h-party" hidden></section>
    <section class="inbox" id="h-inbox" hidden>
      <div class="ib-head"><span class="ic" data-i="pret"></span><h2>${esc(tr('En attente de ta validation'))}</h2><b id="h-nin">0</b></div>
      <ul id="h-letters"></ul>
      <p class="ib-foot">${esc(tr('Rien ne part sans toi.'))}</p>
    </section>
    <div class="scorecard" id="h-card" hidden></div>
    <div class="bubbles" id="h-bubbles"></div>
    <div class="radio" id="h-radio" hidden><span class="rd-face"></span><div><b class="rd-name"></b><p class="rd-text"></p></div></div>`;
  for (const el of root.querySelectorAll('.ic')) el.append(icon(el.dataset.i));
  const $ = (id) => root.querySelector('#' + id);

  // l'équipe
  const party = $('h-party');
  const frames = new Map();
  for (const [id, info] of Object.entries(TEAM)) {
    const el = document.createElement('div');
    el.className = 'pf';
    el.dataset.actor=id;el.tabIndex=0;el.setAttribute('role','button');el.setAttribute('aria-label',tr('Suivre {nom}',{nom:info.name}));
    el.style.setProperty('--c', ROLES[info.role].color);
    const face = portrait(info.role, 'open', 3, info.name);
    face.className = 'pf-face';
    el.append(face);
    el.insertAdjacentHTML('beforeend', `<div class="pf-txt"><b>${esc(info.name)}</b><span class="pf-role">${esc(capital(tr(info.label)))}</span><span class="pf-st"></span></div>`);
    party.append(el);
    frames.set(id, { el, st: el.querySelector('.pf-st'), last: '' });
  }

  const counters = { trouves: -1, lus: -1, retenus: -1, prets: -1 };
  const letters = $('h-letters');
  const bubbleEls = new Map();
  let cardFor = null;

  world.on((type, d) => {
    if (type === 'mission') {
      const m = d ?? {};
      $('h-title').textContent = `${capital(tr(m.metier ?? 'Commerces'))} · ${m.ville ?? ''}`;
      $('h-sub').textContent = tr('{km} km autour du QG · {nombre} commerces au plus', { km: ((m.rayon ?? 2200) / 1000).toLocaleString(getLocale(), { maximumFractionDigits: 1 }), nombre: m.nombre ?? '' });
      for (const id of ['h-quest', 'h-res', 'h-party']) $(id).hidden = false;
      letters.innerHTML = '';
      $('h-inbox').hidden = true;
    }
    if (type === 'scouted') {
      const m = world.mission ?? {};
      const km = ((m.rayon ?? 2200) / 1000).toLocaleString(getLocale(), { maximumFractionDigits: 1 });
      $('h-sub').textContent = d.demandes && d.trouves < d.demandes
        ? tr("{nombre} trouvés sur {demandes} demandés · {km} km autour du QG (la zone n'en a pas plus)", { nombre: d.trouves, demandes: d.demandes, km })
        : tr('{nombre} trouvés · {km} km autour du QG', { nombre: d.trouves, km });
    }
    if (type === 'mail') {
      const q = d.q;
      $('h-inbox').hidden = false;
      const li = document.createElement('li');
      li.className = 'letter';
      li.innerHTML = `<span class="l-top"><b>${esc(q.name)}</b><em>${q.score ?? ''}</em></span><span class="l-obj">${esc(q.objet ?? '')}</span><span class="l-to">${esc(masque(q.to ?? ''))}</span>`;
      li.tabIndex=0;li.setAttribute('role','button');li.dataset.place=q.id;
      letters.prepend(li);
      requestAnimationFrame(() => li.classList.add('in'));
      while (letters.children.length > 4) letters.lastChild.remove();
    }
    if (type === 'scored' && d.d.retenu) showCard(d.q);
  });

  function showCard(q) {
    const card = $('h-card');
    const rs = (q.raisons ?? []).filter((r) => r.pts > 0).slice(0, 3);
    card.innerHTML = `<div class="sc-top"><div><h3>${esc(q.name)}</h3><p>${esc(host(q.data.website) || q.data.address || '')}</p></div><div class="sc-n"><b>${q.score}</b><span>/100</span></div></div>
      <div class="sc-bar"><i style="transform:scaleX(${(q.score ?? 0) / 100})"></i></div>
      <ul>${rs.map((r) => `<li><b>+${r.pts}</b><span>${esc(tr(r.texte))}</span></li>`).join('')}</ul>
      <p class="sc-tag">${esc(tr('Client potentiel'))}</p>`;
    card.hidden = false;
    card.classList.remove('in'); void card.offsetWidth; card.classList.add('in');
    cardFor = { q, from: world.time, until: world.time + 2.6 };
  }

  /** À chaque image : les compteurs, l'équipe, les bulles (placées au-dessus des robots), la carte du score. */
  function update(cam, W, H, S, dpr) {
    const ps = [...world.places.values()];
    const now = {
      trouves: ps.filter((q) => q.state !== 'cache').length,
      lus: ps.filter((q) => q.read).length,
      retenus: ps.filter((q) => ['retenu', 'ecriture', 'pret', 'valide'].includes(q.state)).length,
      prets: ps.filter((q) => q.state === 'pret' || q.state === 'valide').length,
    };
    for (const k of Object.keys(now)) {
      if (now[k] === counters[k]) continue;
      const el = root.querySelector(`.r[data-k="${k}"]`);
      el.querySelector('b').textContent = now[k];
      if (counters[k] >= 0) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
      counters[k] = now[k];
    }
    $('h-nin').textContent = now.prets;
    $('h-bar').style.transform = `scaleX(${now.trouves ? now.lus / now.trouves : 0})`;
    for (const [id, f] of frames) {
      const a = world.actors.get(id);
      const st = a?.status ?? '';
      if (st !== f.last) { f.st.textContent = st; f.last = st; }
      f.el.classList.toggle('busy', Boolean(a && (a.busy || a.lane.length) && st !== tr('Au QG')));
    }
    // les répliques : en bulle si le robot est à l'écran, sinon à la radio (avec son portrait)
    const toScr = (x, y) => [((x - cam.x) * cam.z + W / 2) / dpr, ((y - cam.y) * cam.z + H / 2) / dpr];
    const seen = new Set();
    const radio = $('h-radio');
    let onAir = null;
    for (const a of world.actors.values()) {
      if (!a.bubble) continue;
      const q0 = a.inside && a.inside !== 'qg' ? world.places.get(a.inside) : null;
      const [vx, vy] = q0 ? toScr(q0.x, q0.y) : toScr(a.x, a.y);
      const visible = vx > 30 && vx < W / dpr - 30 && vy > 60 && vy < H / dpr - 20 && (a.alpha > 0.2 || q0);
      if (!visible) { if (a.bubble.prio >= 1) onAir = a; continue; }
      seen.add(a.id);
      let el = bubbleEls.get(a.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'bubble';
        el.style.setProperty('--c', ROLES[a.role].color);
        el.innerHTML = '<span class="b-name"></span><span class="b-text"></span>';
        $('h-bubbles').append(el);
        bubbleEls.set(a.id, el);
      }
      if (el.dataset.text !== a.bubble.text) {
        el.dataset.text = a.bubble.text;
        el.querySelector('.b-name').textContent = a.name;
        el.querySelector('.b-text').textContent = a.bubble.text;
        el.dataset.kind = a.bubble.kind ?? '';
        el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
      }
      // un robot entré dans un commerce parle depuis la porte
      const q = a.inside && a.inside !== 'qg' ? world.places.get(a.inside) : null;
      const [sx, sy] = q ? toScr(q.x, q.y) : toScr(a.x, a.y);
      const lift = ((q ? 30 : ANCHOR_Y + 3 + a.alt) * S) / dpr;
      el.style.transform = `translate(${Math.round(sx)}px, ${Math.round(sy - lift)}px)`;
    }
    for (const [id, el] of bubbleEls) if (!seen.has(id)) { el.remove(); bubbleEls.delete(id); }
    if (onAir) {
      const key = `${onAir.id}|${onAir.bubble.text}`;
      if (radio.dataset.key !== key) {
        radio.dataset.key = key;
        radio.style.setProperty('--c', ROLES[onAir.role].color);
        const face = radio.querySelector('.rd-face');
        face.replaceChildren(portrait(onAir.role, 'open', 4, onAir.name));
        radio.querySelector('.rd-name').textContent = `${onAir.name} · radio`;
        radio.querySelector('.rd-text').textContent = onAir.bubble.text;
        radio.hidden = false;
        radio.classList.remove('in'); void radio.offsetWidth; radio.classList.add('in');
      }
    } else if (!radio.hidden) { radio.hidden = true; radio.dataset.key = ''; }
    // deux bulles qui se chevauchent : la plus haute monte encore un peu
    const boxes = [...bubbleEls.values()].map((el) => {
      const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(el.style.transform);
      return { el, x: +m[1], y: +m[2], w: el.offsetWidth, h: el.offsetHeight };
    }).sort((a, b) => b.y - a.y);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = 0; j < i; j++) {
        const a = boxes[i], b = boxes[j];
        const ox = Math.abs(a.x - b.x) < (a.w + b.w) / 2 + 6;
        if (ox && a.y > b.y - b.h - 6) { a.y = b.y - b.h - 6; a.el.style.transform = `translate(${Math.round(a.x)}px, ${Math.round(a.y)}px)`; }
      }
    }
    // aucune bulle coupée par le bord de l'écran (ni sous les bandes noires du cinéma)
    const vw = W / dpr, vh = H / dpr, top = document.body.classList.contains('cinema') ? vh * 0.07 : 8;
    for (const b of boxes) {
      const x = Math.min(vw - b.w / 2 - 12, Math.max(b.w / 2 + 12, b.x)), y = Math.max(top + b.h, b.y);
      if (x !== b.x || y !== b.y) b.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    }
    // la carte du score suit son commerce
    const card = $('h-card');
    if (cardFor) {
      // (le monde rejoué repart de zéro : une carte d'avant le retour en arrière s'efface aussi)
      if (world.time > cardFor.until || world.time < cardFor.from) { card.hidden = true; cardFor = null; }
      else {
        const [sx, sy] = toScr(cardFor.q.x, cardFor.q.y);
        const right = sx + 330 < W / dpr - 20;
        // la carte reste dans l'écran, sous les compteurs et au-dessus de la radio
        const vw = W / dpr, vh = H / dpr;
        const x = right ? sx + (22 * S) / dpr : sx - 300 - (22 * S) / dpr;
        const y = Math.min(vh * 0.84 - card.offsetHeight, Math.max(vh * 0.2, sy - (40 * S) / dpr));
        card.style.left = `${Math.round(Math.min(vw - card.offsetWidth - 16, Math.max(16, x)))}px`;
        card.style.top = `${Math.round(y)}px`;
      }
    }
  }

  return { update, inboxPoint: () => { const r = $('h-inbox').hidden ? $('h-res').querySelector('.hot').getBoundingClientRect() : $('h-inbox').getBoundingClientRect(); return [r.left + 40, r.top + 30]; } };
}

