import { getLang } from './i18n.js';
import { l, businessLabels } from './i18n-launch.js';
// Le panneau de lancement : la ville (choisie sur la carte ou cherchée), le métier, la zone, combien d'établissements,
// ce qu'on veut récupérer (e-mails, téléphones), combien de mails préparer, ton offre et tes consignes pour le mail.
// L'équipe écrit chaque mail avec ton offre et ce qu'elle a vu chez le commerce. Rien ne part sans ta validation.

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const norm = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const METIERS = [
  ['Salles de sport', 'salle de sport'], ['Yoga & pilates', 'yoga'], ['Restaurants', 'restaurant'], ['Cafés', 'café'], ['Bars', 'bar'],
  ['Coiffeurs', 'coiffeur'], ['Barbiers', 'barbier'], ['Instituts de beauté', 'institut de beauté'], ['Boulangeries', 'boulangerie'],
  ['Fleuristes', 'fleuriste'], ['Opticiens', 'opticien'], ['Garages', 'garage'], ['Auto-écoles', 'auto-école'], ['Dentistes', 'dentiste'],
  ['Kinés', 'kiné'], ['Agences immobilières', 'agence immobilière'], ['Hôtels', 'hôtel'], ['Vétérinaires', 'vétérinaire'],
];
const PAYS = Object.fromEntries(['BE','NL','LU'].map(cc => [cc,l(cc)]));

export function createLancement(root, { config, onLaunch, onSearch, onReplay }) {
  const cfg = config ?? {};
  const st = {
    ville: null,
    metier: cfg.recherche?.metier ?? 'salle de sport',
    rayon: cfg.recherche?.rayon_m ?? 2000,
    nombre: cfg.recherche?.nombre ?? 20,
    objectif: cfg.recherche?.objectif_mails ?? 0,
    veut: { emails: cfg.recherche?.veut?.emails !== false, telephones: cfg.recherche?.veut?.telephones !== false },
    offre: { ce_que_je_vends: '', pour_qui: '', signature: '', site: '', ...(cfg.offre ?? {}) },
    consignes: cfg.consignes || '',
    redaction: { moteur: 'claude', modele: '', langue: 'auto', ...(cfg.redaction ?? {}) },
  };
  let villes = [];
  fetch('/carte/villes.json').then((r) => r.json()).then((d) => { villes = d.villes.map(([nom, lat, lon, pop, cc, region, aliases = []]) => ({ nom, lat, lon, pop, cc, n: norm(nom), recherche: norm([nom,...aliases].join(' ')) })); }).catch(() => {});

  root.className = 'launch';
  root.innerHTML = `
    <div class="l-head"><span class="tag"><i></i>${l('mission')}</span><h2 id="l-ville">${l('choose')}</h2><p id="l-ville-sub">${l('chooseHint')}</p>
      <div class="l-search"><input id="l-q" placeholder="${l('search')}" autocomplete="off"><ul id="l-sug" hidden></ul></div></div>
    <section><h3>${l('who')}</h3><div class="chips" id="l-metiers"></div><input id="l-autre" class="l-input" placeholder="${l('other')}"></section>
    <section class="l-row"><div><h3>${l('area')}</h3><div class="chips" id="l-rayon">${[1000, 2000, 3000, 4000].map((r) => `<button type="button" data-v="${r}">${r / 1000} km</button>`).join('')}</div></div></section>
    <section><h3>${l('count')} <b id="l-n"></b></h3><input type="range" id="l-nombre" min="5" max="60" step="5"><p class="l-hint">${l('expand')}</p></section>
    <section><h3>${l('contacts')}</h3><div class="chips toggles" id="l-veut"><button type="button" data-k="emails">${l('emails')}</button><button type="button" data-k="telephones">${l('phones')}</button></div></section>
    <section><h3>${l('drafts')} <b id="l-o"></b></h3><input type="range" id="l-objectif" min="0" max="60" step="1"><p class="l-hint">${l('stop')}</p></section>
    <details class="l-box" open><summary>${l('offer')}</summary>
      <label>${l('sell')}</label><textarea id="l-vend" rows="3"></textarea>
      <label>${l('forWhom')}</label><input id="l-pourqui" class="l-input">
      <div class="l-two"><div><label>${l('signature')}</label><input id="l-sign" class="l-input"></div><div><label>${l('site')}</label><input id="l-site" class="l-input"></div></div>
    </details>
    <details class="l-box"><summary>${l('mail')}</summary>
      <label>${l('instructions')}</label><textarea id="l-consignes" rows="3"></textarea>
      <p class="l-hint">${l('mailHint')}</p>
    </details>
    <details class="l-box" open><summary>${l('engine')}</summary>
      <label for="l-engine">${l('engine')}</label><select id="l-engine" class="l-input"><option value="claude">Claude Code</option><option value="codex">OpenAI · Codex</option><option value="aucun">${l('collect')}</option></select>
      <p class="l-hint" id="l-engine-status"></p><label for="l-model">${l('model')}</label><input id="l-model" class="l-input" maxlength="80" placeholder="sonnet / …"><p class="l-hint">${l('modelHint')}</p>
      <label for="l-lang">${l('mailLanguage')}</label><select id="l-lang" class="l-input">${['auto','fr','nl','en'].map(code=>`<option value="${code}">${l(code)}</option>`).join('')}</select><p class="l-hint">${l('languageNote')}</p>
    </details>
    <p class="l-recap" id="l-recap"></p>
    <button type="button" class="l-go" id="l-go" disabled>${l('launch')}</button>
    <p class="l-note">${l('safe')}</p>
    <p class="l-err" id="l-err" hidden></p>
    <button type="button" class="l-replay" id="l-replay">${l('replay')}</button>`;
  const $ = (id) => root.querySelector('#' + id);

  // métiers
  const chips = $('l-metiers');
  for (const [i, [label, v]] of METIERS.entries()) {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.v = v; b.textContent = businessLabels[getLang()][i] ?? label;
    chips.append(b);
  }
  chips.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { st.metier = b.dataset.v; $('l-autre').value = ''; sync(); } });
  $('l-autre').addEventListener('input', (e) => { const v = e.target.value.trim(); if (v) st.metier = v; sync(); });
  $('l-rayon').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { st.rayon = +b.dataset.v; sync(); } });
  $('l-nombre').addEventListener('input', (e) => { st.nombre = +e.target.value; sync(); });
  $('l-objectif').addEventListener('input', (e) => { st.objectif = +e.target.value; sync(); });
  $('l-veut').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { st.veut[b.dataset.k] = !st.veut[b.dataset.k]; if (!st.veut.emails && !st.veut.telephones) st.veut.emails = true; sync(); } });
  const bind = (id, set) => $(id).addEventListener('input', (e) => { set(e.target.value); sync(); });
  $('l-vend').value = st.offre.ce_que_je_vends; bind('l-vend', (v) => { st.offre.ce_que_je_vends = v; });
  $('l-pourqui').value = st.offre.pour_qui; bind('l-pourqui', (v) => { st.offre.pour_qui = v; });
  $('l-sign').value = st.offre.signature; bind('l-sign', (v) => { st.offre.signature = v; });
  $('l-site').value = st.offre.site; bind('l-site', (v) => { st.offre.site = v; });
  $('l-consignes').value = st.consignes; bind('l-consignes', (v) => { st.consignes = v; });
  $('l-nombre').value = st.nombre;
  $('l-objectif').value = st.objectif;

  $('l-engine').value = st.redaction.moteur;
  $('l-model').value = st.redaction.modele;
  $('l-lang').value = st.redaction.langue;
  let capabilities = {};
  fetch('/api/capabilities').then(r=>r.json()).then(c=>{ capabilities = c; sync(); }).catch(()=>{});
  $('l-engine').addEventListener('change', e=>{ st.redaction.moteur=e.target.value; st.redaction.modele=''; $('l-model').value=''; sync(); });
  bind('l-model', v=>{ st.redaction.modele=v; });
  $('l-lang').addEventListener('change', e=>{ st.redaction.langue=e.target.value; });

  // la recherche de ville
  const q = $('l-q'), sug = $('l-sug');
  q.addEventListener('input', () => {
    const t = norm(q.value.trim());
    if (t.length < 2) { sug.hidden = true; return; }
    const res = villes.filter((v) => v.n.startsWith(t)).concat(villes.filter((v) => !v.n.startsWith(t) && v.recherche.includes(t))).slice(0, 7);
    sug.innerHTML = res.map((v, i) => `<li data-i="${i}"><b>${esc(v.nom)}</b><span>${PAYS[v.cc] ?? v.cc}</span></li>`).join('');
    sug.hidden = !res.length;
    sug.onclick = (e) => { const li = e.target.closest('li'); if (!li) return; const v = res[+li.dataset.i]; sug.hidden = true; q.value = ''; onSearch?.(v); };
  });

  $('l-go').addEventListener('click', async () => {
    if (!st.ville) return;
    if (st.redaction.moteur !== 'aucun' && (!st.offre.ce_que_je_vends.trim() || !st.offre.signature.trim())) { $('l-err').hidden=false; $('l-err').textContent=l('required'); return; }
    const b = $('l-go');
    b.disabled = true; b.textContent = l('launching');
    $('l-err').hidden = true;
    try {
      await onLaunch({
        metier: st.metier, ville: st.ville.name, centre: { lat: st.ville.lat, lon: st.ville.lon }, pays: st.ville.pays ?? null,
        rayon_m: st.rayon, nombre: st.nombre, objectif_mails: st.objectif || null, veut: st.veut, offre: st.offre, consignes: st.consignes, redaction: st.redaction,
      });
    } catch (e) {
      $('l-err').textContent = e.message;
      $('l-err').hidden = false;
    } finally { b.textContent = l('launch'); sync(); }
  });
  $('l-replay').addEventListener('click', () => onReplay?.());

  function sync() {
    for (const b of chips.children) b.classList.toggle('on', b.dataset.v === st.metier);
    for (const b of $('l-rayon').children) b.classList.toggle('on', +b.dataset.v === st.rayon);
    for (const b of $('l-veut').children) b.classList.toggle('on', st.veut[b.dataset.k]);
    $('l-n').textContent = st.nombre;
    $('l-objectif').max = String(st.nombre);
    if (st.objectif > st.nombre) st.objectif = st.nombre;
    $('l-o').textContent = st.objectif ? st.objectif : `${st.nombre} · ${l('all')}`;
    const i = METIERS.findIndex(([,v])=>v===st.metier);
    const label = i<0 ? st.metier : businessLabels[getLang()][i].toLowerCase();
    const cap = capabilities[st.redaction.moteur];
    $('l-engine-status').textContent = st.redaction.moteur==='aucun' ? l('scanOnly') : cap ? l(cap.installe ? 'installed' : 'unavailable') : '';
    $('l-model').disabled = st.redaction.moteur==='aucun';
    $('l-objectif').disabled = st.redaction.moteur==='aucun';
    if(st.redaction.moteur==='aucun') $('l-o').textContent=l('collect');
    $('l-recap').innerHTML = st.ville
      ? `<b>${st.nombre} ${esc(label)}</b> ${l('around')} <b>${esc(st.ville.name)}</b> (${st.rayon / 1000} km) · ${[st.veut.emails && l('emails'), st.veut.telephones && l('phones')].filter(Boolean).join(' · ')} · ${st.redaction.moteur==='aucun' ? l('scanOnly') : `${st.objectif || st.nombre} ${l('maxMail')}`}`
      : l('selectFirst');
    $('l-go').disabled = !st.ville || !st.metier;
  }
  function setVille(v) {
    st.ville = v;
    $('l-ville').textContent = v ? v.name : l('choose');
    $('l-ville-sub').textContent = v ? `${{ city: l('city'), town: l('city'), village: l('village'), hamlet: l('hamlet'), suburb: l('district') }[v.cls] ?? l('city')}${v.pays ? ` · ${PAYS[v.pays] ?? v.pays}` : ''} · ${v.lat.toFixed(3)}, ${v.lon.toFixed(3)}` : l('chooseHint');
    sync();
  }
  sync();
  return { setVille, get state() { return st; }, show() { root.hidden = false; }, hide() { root.hidden = true; } };
}

