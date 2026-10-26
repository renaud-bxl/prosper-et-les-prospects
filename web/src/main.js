import { createResultsDialog } from './results.js';
import './results.css';
import { t, getLang, setLang } from './i18n.js';
import { l } from './i18n-launch.js';
import { initTheme } from './theme.js';
import { createUpdateUI } from './updates-ui.js';
// Le QG des agents : on choisit une ville sur la carte de France (toutes les villes apparaissent quand on zoome), le métier,
// combien d'établissements, ce qu'on veut récupérer, son offre et ses consignes de mail ; la caméra plonge sur la ville
// en pixel art et l'équipe s'y met, en direct. On clique un commerce pour voir ce qui lui manque, ses contacts et le mail.
//   /qg.html                 la carte de mission (lancer une nouvelle mission)
//   /qg.html?run=<id>        rejouer une mission enregistrée
//   ?tod=jour|soir|nuit      la lumière (touche N) · ?vitesse=1.5 · ?libre (caméra à la main)
import { loadCity, TODS, palette } from './ville.js';
import { drawCity, drawWorld, spriteScale, toWorld } from './rendu.js';
import { Monde } from './monde.js';
import { Realisateur } from './realisateur.js';
import { createHud } from './hud.js';
import { createFiche } from './fiche.js';
import { createCarte } from './carte.js';
import { createLancement } from './lancement.js';
import { createCinema, survey } from './cinema.js';

const $ = (id) => document.getElementById(id);
document.documentElement.lang = getLang();
$('interface-language').value=getLang();
$('interface-language').setAttribute('aria-label',l('interfaceLanguage'));
$('interface-language').addEventListener('change',e=>setLang(e.target.value));
$('carte-title').querySelector('h1').textContent=l('headline');
$('carte-title').querySelector('p').textContent=l('subtitle');
$('btn-carte').textContent=l('newMission');
const attribution=document.querySelector('.attrib'); attribution.replaceChildren(document.createTextNode(l('data')+' © '));const osmLink=document.createElement('a');osmLink.href='https://www.openstreetmap.org/copyright';osmLink.target='_blank';osmLink.rel='noopener';osmLink.textContent=l('osm');attribution.append(osmLink,document.createTextNode(' · '+l('tiles')+' '));const ofmLink=document.createElement('a');ofmLink.href='https://openfreemap.org';ofmLink.target='_blank';ofmLink.rel='noopener';ofmLink.textContent='OpenFreeMap';attribution.append(ofmLink);
$('cn-play').setAttribute('aria-label',t('Lancer le film'));
$('loading').textContent=l('loading');
const updateUI=createUpdateUI({root:$('updates'), getLang});
const updateButton=document.createElement('button');updateButton.type='button';updateButton.textContent=l('updates');updateButton.addEventListener('click',()=>{updateUI.open();});$('updates').prepend(updateButton);

let deferredReplay=null;
const results=createResultsDialog({onResume:resumeSearch,onClose:()=>{if(deferredReplay){const id=deferredReplay;deferredReplay=null;replay(id).catch(showError);}}});
let latestResultRun=null;
const resultButton=document.createElement('button');resultButton.type='button';resultButton.textContent=({fr:'Résultats',nl:'Resultaten',en:'Results'})[getLang()];resultButton.addEventListener('click',()=>results.open(runId??latestResultRun));document.querySelector('.app-controls').append(resultButton);
const resumeButton=document.createElement('button');resumeButton.type='button';resumeButton.hidden=true;resumeButton.textContent=({fr:'Reprendre la mission',nl:'Missie hervatten',en:'Resume mission'})[getLang()];resumeButton.addEventListener('click',()=>resumeSearch(latestResultRun).catch(showError));document.querySelector('.app-controls').append(resumeButton);
async function resumeSearch(id){if(!id)return;const r=await fetch(`/api/runs/${encodeURIComponent(id)}/resume`,{method:'POST'});const body=await r.json();if(!r.ok)throw new Error(t(body.error??l('launchFailed')));location.assign('?run='+encodeURIComponent(body.runId));}
const canvas = $('world');
const g = canvas.getContext('2d');
const params = new URLSearchParams(location.search);

const cam = { x: 0, y: 0, z: 2 };
let city = null, world = null, director = null, hud = null, fiche = null;
let animationPaused=false, followActor=null;
let tod = params.get('tod') ?? 'jour';
initTheme({onChange:({theme})=>{tod=theme==='dark'?'nuit':'jour';}});
let speed = Number(params.get('vitesse')) || 1;
let W = 0, H = 0, DPR = 1;
let mode = 'carte'; // carte | plongee | ville
let fade = 0, fadeFrom = null; // le fondu de la carte vers la ville (et l'échelle de la carte au moment du passage)
let runId = null, liveRun = null, events = [], buffer = [];
let config = null;
let lanc = null;
const CINE = params.has('cinema');
let cine = null, pre = null; // la version cinéma, et son vol d'ouverture au-dessus de la France

const carte = createCarte({ onPick: (c) => lanc?.setVille(c), getRayon: () => lanc?.state.rayon ?? 2000 });

function resize() {
  DPR = window.devicePixelRatio || 1;
  W = Math.round(canvas.clientWidth * DPR);
  H = Math.round(canvas.clientHeight * DPR);
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;
}

function setMode(m) {
  mode = m;
  document.body.dataset.mode = m;
  $('hud').hidden = m !== 'ville';
  $('launch').hidden = m !== 'carte';
  $('carte-title').hidden = m !== 'carte';
  $('btn-carte').hidden = m !== 'ville';
  document.querySelector('#scene-tools')?.toggleAttribute('hidden',m!=='ville');
  followActor=null;
  if (m !== 'ville') fiche?.close();
}

/* ------------------------------------------------------------------ une image */
function frame(dt) {
  if(results.isOpen)return;
  if(animationPaused)dt=0;
  if (pre) {
    // l'ouverture du film : la France, puis on plonge sur la ville
    if (pre.wait) { carte.draw(g, W, H, DPR, performance.now()); return; } // ?attente : la France, immobile, jusqu'au clic sur Lecture
    pre.t += dt;
    const u = Math.min(1, pre.t / pre.dur);
    const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    Object.assign(carte.cam, { x: pre.from.x + (pre.to.x - pre.from.x) * Math.min(1, e * 1.25), y: pre.from.y + (pre.to.y - pre.from.y) * Math.min(1, e * 1.25), zoom: pre.from.zoom + (pre.to.zoom - pre.from.zoom) * e });
    carte.draw(g, W, H, DPR, performance.now());
    cine?.title(u > 0.04 && u < 0.78);
    if (u >= 1) { pre = null; cine?.title(false); enterCity(); }
    return;
  }
  if (world && dt > 0) {
    if (cine) { world.update(dt * cine.speedAt(world.time)); }
    else {
      world.update(dt * speed);
      if (mode === 'ville') director?.update(dt * speed, W, H);
      if(followActor && mode==='ville'){const a=world.actors.get(followActor);if(a){cam.x+=(a.x-cam.x)*.15;cam.y+=(a.y-cam.y)*.15;cam.z+=(5*DPR-cam.z)*.1;director.manualUntil=world.time+60;}}
    }
  }
  if (cine && mode === 'ville') cine.update(W, H, DPR);
  if (mode === 'carte' || mode === 'plongee') carte.draw(g, W, H, DPR);
  if (mode === 'ville' && city) {
    const b=city.bounds;cam.z=Math.max(cam.z,W/(b.maxx-b.minx),H/(b.maxy-b.miny));const hw=W/(2*cam.z),hh=H/(2*cam.z);cam.x=Math.max(b.minx+hw,Math.min(b.maxx-hw,cam.x));cam.y=Math.max(b.miny+hh,Math.min(b.maxy-hh,cam.y));
    g.fillStyle = palette(tod).bg;
    g.fillRect(0, 0, W, H);
    drawCity(g, city, cam, W, H, tod, window.__CAPTURE ? Infinity : 6);
    if (world) {
      const S = spriteScale(cam.z);
      const ib = hud?.inboxPoint();
      drawWorld(g, world, cam, W, H, tod, { S, inbox: ib ? [ib[0] * DPR, ib[1] * DPR] : null, beacons: cine && world.time > (cine.shots.at(-1)?.from ?? 1e9) });
      hud?.update(cam, W, H, S, DPR);
    }
    // la carte s'efface sur la ville
    if (fade > 0) {
      // la carte suit la caméra de la ville pendant le fondu : les deux images restent l'une sur l'autre
      if (fadeFrom) {
        const [lat, lon] = city.toLatLon(cam.x, cam.y);
        Object.assign(carte.cam, { x: (lon + 180) / 360, y: (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2, zoom: fadeFrom.zoom + Math.log2(cam.z / fadeFrom.z) });
      }
      g.globalAlpha = fade * fade * (3 - 2 * fade);
      carte.draw(g, W, H, DPR);
      g.globalAlpha = 1;
      fade = Math.max(0, fade - Math.max(dt, 1 / 60) * 1.1);
    }
  }
}

let last = 0;
function loop(ts) {
  const dt = last ? Math.min(0.1, (ts - last) / 1000) : 0;
  last = ts;
  resize();
  frame(dt);
  requestAnimationFrame(loop);
}

/* ------------------------------------------------------------------ la ville d'une mission */
async function buildCity(centre, rayon) {
  $('loading').hidden = false;
  $('loading').textContent = l('loading');
  const t0 = performance.now();
  city = await loadCity({ centre, radius: Math.min(8500, Math.max(6500, rayon + 900)), onProgress: (k) => { $('loading').textContent = l('loadingPct',{n:Math.round(k*100)}); } });
  world = new Monde(city);
  director = new Realisateur(world, cam);
  hud = createHud($('hud'), world);
  fiche = createFiche($('fiche'), { getRunId: () => runId });
  world.on((type, d) => { if (type === 'place') fiche.refresh(d); if (type === 'mail' || type === 'scored') fiche.refresh(d.q); });
  console.log(`ville : ${city.blist.length} immeubles, ${city.roads.length} rues, ${city.trees.length} arbres, graphe ${world.graph.nodes} nœuds, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  $('loading').hidden = true;
  return world;
}

/** La carte se change en ville : même centre, même échelle, puis le réalisateur plonge sur le QG. */
function enterCity() {
  const [lat, lon] = carte.centre();
  const [x, y] = city.toXY(lat, lon);
  Object.assign(cam, { x, y, z: carte.pxPerMeter(W, DPR) });
  director.smoothUntil = world.time + 4;
  fade = 1;
  fadeFrom = { zoom: carte.cam.zoom, z: cam.z };
  setMode('ville');
}

/** La version cinéma : la mission rejouée comme un film (titres, chapitres, ralentis, compteurs). */
async function cinema(id) {
  document.body.classList.add('cinema');
  const st = await fetch(`/api/state${id ? `?run=${id}` : ''}`).then((r) => r.json());
  const run = st.run;
  if (!run) { document.body.classList.remove('cinema'); setMode('carte'); return; } // pas encore de mission à filmer
  runId = run.id;
  if(!CINE) history.replaceState(null,'', '?run='+encodeURIComponent(runId));
  events = await fetch(`/api/runs/${run.id}/events`).then((r) => r.json());
  for(const p of st.places ?? []) if(['valide','refuse'].includes(p.status)) events.push({agent:'chef',type:'decision',place_id:p.id,data:{decision:p.status,objet:p.objet,mail:p.mail}});
  const start = events.find((e) => e.agent === 'chef' && e.type === 'start');
  const sd = typeof start?.data === 'string' ? JSON.parse(start.data) : start?.data;
  const centre = run.lat != null ? { lat: run.lat, lon: run.lon } : sd?.centre ?? { lat: 50.8503, lon: 4.3517 };
  setMode('plongee');
  await buildCity(centre, run.rayon ?? sd?.rayon ?? 2200);
  const pushAll = () => { for (const e of events) world.push({ ...e, data: typeof e.data === 'string' ? JSON.parse(e.data) : e.data }); };
  const marks = survey(world, pushAll);
  const ends = events.filter((e) => e.agent === 'chef' && (e.type === 'start' || e.type === 'end')).map((e) => e.t);
  cine = createCinema($('cine'), { world, cam, marks, metier: sd?.metier ?? '', ville: sd?.ville ?? run.ville ?? '', duree: ends.length === 2 ? (ends[1] - ends[0]) / 1000 : null, setTod: (t2) => { tod = t2; } });
  window.__qg.marks = marks;
  carte.select({ name: sd?.ville ?? '', lat: centre.lat, lon: centre.lon });
  const [qx, qy] = [world.qg.x, world.qg.door[1]];
  const [qlat, qlon] = city.toLatLon(qx, qy);
  const to = { ...carte.cam };
  const [tx, ty] = [(qlon + 180) / 360, (1 - Math.log(Math.tan(qlat * Math.PI / 180) + 1 / Math.cos(qlat * Math.PI / 180)) / Math.PI) / 2];
  // le vol finit assez bas pour que la ville couvre tout l'écran au moment du passage (sinon, un carré sur fond noir)
  const side = 2 * Math.min(8500, Math.max(6500, (run.rayon ?? sd?.rayon ?? 2200) + 900)) * 0.8;
  const zEnd = Math.log2((W / DPR) * 40075016.686 * Math.cos(qlat * Math.PI / 180) / (256 * side));
  pre = { t: 0, wait: params.has('attente'), dur: Number(params.get('ouverture') ?? 4.6), from: { x: (4.9+180)/360, y: (1-Math.log(Math.tan(51.45*Math.PI/180)+1/Math.cos(51.45*Math.PI/180))/Math.PI)/2, zoom: 7 }, to: { x: tx, y: ty, zoom: Math.max(13.4, zEnd) } };
  Object.assign(carte.cam, pre.from);
  void to;
  if (pre.wait) $('cn-play').hidden = false;
}

/** ?attente : le film part quand on appuie sur Lecture (ou Entrée, Espace), pour se filmer en train de le lancer. */
function startCinema() {
  if (!pre?.wait) return;
  pre.wait = false;
  $('cn-play').hidden = true;
  document.body.classList.add('playing');
}
$('cn-play').addEventListener('click', startCinema);

/** Rejoue une mission : tous ses gestes partent dans les files des agents, qui les jouent à leur rythme. */
function play() {
  if (!events.length || !world) return;
  world.reset();
  for (const e of events) world.push({ ...e, data: typeof e.data === 'string' ? JSON.parse(e.data) : e.data });
}

async function replay(id) {
  const st = await fetch(`/api/state${id ? `?run=${id}` : ''}`).then((r) => r.json());
  const run = st.run;
  if (!run) { alert(l('noReplay')); return; }
  runId = run.id;
  if(!CINE) history.replaceState(null,'', '?run='+encodeURIComponent(runId));
  liveRun = null;
  events = await fetch(`/api/runs/${run.id}/events`).then((r) => r.json());
  for(const p of st.places ?? []) if(['valide','refuse'].includes(p.status)) events.push({agent:'chef',type:'decision',place_id:p.id,data:{decision:p.status,objet:p.objet,mail:p.mail}});
  const start = events.find((e) => e.agent === 'chef' && e.type === 'start');
  const sd = typeof start?.data === 'string' ? JSON.parse(start.data) : start?.data;
  const centre = run.lat != null ? { lat: run.lat, lon: run.lon } : sd?.centre ?? { lat: 50.8503, lon: 4.3517 };
  const rayon = run.rayon ?? sd?.rayon ?? 2200;
  setMode('plongee');
  carte.select({ name: run.ville ?? sd?.ville, lat: centre.lat, lon: centre.lon });
  const built = buildCity(centre, rayon);
  if (!window.__CAPTURE) await carte.flyTo(centre.lat, centre.lon, 14.4, 2400);
  else { carte.cam.x = carte.selected.x; carte.cam.y = carte.selected.y; carte.cam.zoom = 14.4; }
  await built;
  enterCity();
  if (window.__CAPTURE) play(); else setTimeout(play, 300);
}

/** Lance une vraie mission : l'équipe part, et ses gestes arrivent en direct. */
async function launch(p) {
  const res = await fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
  const body = await res.json();
  if (!res.ok) throw new Error(t(body.error ?? l('launchFailed')));
  runId = body.runId;
  history.replaceState(null,'','?run='+encodeURIComponent(runId));
  buffer = [];
  events = [];
  pushed.clear();
  follow(runId);
  setMode('plongee');
  $('mission-status').hidden=false; $('mission-status').className=''; $('mission-status').textContent=l('working');
  const built = buildCity(p.centre, p.rayon_m);
  await carte.flyTo(p.centre.lat, p.centre.lon, 14.4, 2600);
  try { await built; } catch(e) { $('loading').hidden=true; setMode('carte'); throw e; }
  world.reset();
  enterCity();
  for (const e of buffer.splice(0)) world.push(e);
}

// Tous les gestes reçus en direct, rangés par mission : une mission rapide peut commencer avant que la page sache laquelle suivre.
let healthExpected=false,healthPending=false,healthLost=false;
setInterval(async()=>{if(!healthExpected||healthPending||document.hidden)return;healthPending=true;try{const response=await fetch('/api/health',{signal:AbortSignal.timeout(5000),cache:'no-store'});if(!response.ok)throw new Error();if(healthExpected&&healthLost){healthLost=false;$('mission-status').className='';$('mission-status').textContent=l('working');}}catch{if(healthExpected){healthLost=true;$('mission-status').hidden=false;$('mission-status').className='error';$('mission-status').textContent=l('serverUnresponsive');}}finally{healthPending=false;}},12000);
const heard = new Map();
const pushed = new Set();
function deliver(e) {
  if (e.seq != null) { if (pushed.has(e.seq)) return; pushed.add(e.seq); }
  events.push(e);
  if (world && mode === 'ville') world.push(e); else buffer.push(e);
}
function connect() {
  const es = new EventSource('/api/stream');
  es.onmessage = (m) => {
    const e = JSON.parse(m.data);
    if (!heard.has(e.run_id)) heard.set(e.run_id, []);
    heard.get(e.run_id).push(e);
    if (liveRun && e.run_id === liveRun) {
      deliver(e);
      const status=$('mission-status');
      if(e.type==='error' && !e.agent?.startsWith('redacteur-')) {status.hidden=false;status.className='error';status.textContent=t(e.data?.message ?? l('failed'));}
      if(e.type==='retry' && e.agent?.startsWith('redacteur-')) {status.hidden=false;status.className='';status.textContent=l('retryingDraft');}
      if(e.agent==='chef' && e.type==='drafts:start' && world) world.writeGo=true;
      if(e.agent==='chef' && e.type==='end') {healthExpected=false;results.autoOpen(e.run_id).catch(()=>{});status.hidden=false;status.className=e.data?.erreur?'error':e.data?.partiel?'partial':'done';status.textContent=l(e.data?.erreur?'failed':e.data?.partiel?'partial':'completed');}
    }
  };
}
/** Suivre une mission en direct : ses gestes déjà passés d'abord (reçus ou relus sur le serveur), puis la suite. */
async function follow(id) {
  healthExpected=true;healthLost=false;liveRun = id;
  const past = await fetch(`/api/runs/${id}/events`).then((r) => r.json()).catch(() => []);
  const all = [...past, ...(heard.get(id) ?? [])].map((e) => ({ ...e, data: typeof e.data === 'string' ? JSON.parse(e.data) : e.data }));
  all.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  for (const e of all) deliver(e);
}

/* ------------------------------------------------------------------ cliquer un commerce */
function pick(clientX, clientY) {
  if (!world) return null;
  const sx = clientX * DPR, sy = clientY * DPR;
  const S = spriteScale(cam.z);
  let best = null, bestD = Infinity;
  for (const q of world.places.values()) {
    if (q.state === 'cache') continue;
    const px = (q.x - cam.x) * cam.z + W / 2, py = (q.y - cam.y) * cam.z + H / 2;
    for (const [ox, oy, r] of [[0, -22 * S, 11 * S], [0, -6 * S, 8 * S]]) {
      const d = Math.hypot(sx - px - ox, sy - py - oy);
      if (d < r && d < bestD) { best = q; bestD = d; }
    }
  }
  if (best) return best;
  const [wx, wy] = toWorld(cam, W, H, sx, sy);
  for (let k = 0; k <= 14; k += 1) {
    const b = city.buildingAt(wx, wy + k);
    if (!b) continue;
    for (const q of world.places.values()) if (q.bid === b.id && q.state !== 'cache') return q;
  }
  return null;
}
/** Un commerce de la carte (calque des points d'intérêt) sous le clic : le plus proche à quelques mètres. */
function pickPoi(clientX, clientY) {
  if (!city?.pois?.length || cam.z < 1.2) return null;
  const [wx, wy] = toWorld(cam, W, H, clientX * DPR, clientY * DPR);
  let best = null, bd = 9 + 14 / cam.z;
  for (const p of city.pois) {
    // le pied de l'immeuble est plus bas que son toit à l'écran : on accepte un clic un peu au-dessus
    const d = Math.hypot(p.x - wx, (p.y - wy) * (p.y > wy ? 0.55 : 1));
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}
async function sendReader(poi) {
  if (!runId) throw new Error(l('noMission'));
  const busy = (id) => { const a = world.actors.get(id); return a.busy || a.lane.length; };
  const agent = ['lecteur-1', 'lecteur-2', 'lecteur-3'].find((id) => !busy(id)) ?? 'lecteur-1';
  if (liveRun !== runId) { for (const e of events) if (e.seq != null) pushed.add(e.seq); liveRun = runId; } // la suite arrive par le flux en direct
  const r = await fetch(`/api/runs/${runId}/visite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: poi.name, lat: poi.lat, lon: poi.lon, type: poi.sub || poi.cls, agent }) });
  if (!r.ok) throw new Error((await r.json()).error ?? l('readerFailed'));
  world.teamSent = true;
}

/* ------------------------------------------------------------------ la souris */
let drag = null;
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, cx: cam.x, cy: cam.y, moved: false }; canvas.classList.add('drag'); canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => {
  if (!drag) {
    if (mode === 'carte') canvas.classList.toggle('can-pick', Boolean(carte.setHover(e.clientX * DPR, e.clientY * DPR)));
    else if (mode === 'ville') {
      const q = pick(e.clientX, e.clientY);
      const poi = q ? null : pickPoi(e.clientX, e.clientY);
      canvas.classList.toggle('can-pick', Boolean(q || poi));
      const tip = $('tip');
      if (poi) { tip.textContent = poi.name; tip.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 12}px)`; tip.hidden = false; }
      else tip.hidden = true;
    }
    return;
  }
  if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) drag.moved = true;
  if (!drag.moved) return;
  if (mode === 'carte') { carte.pan((e.clientX - drag.lx) * DPR, (e.clientY - drag.ly) * DPR, W, DPR); drag.lx = e.clientX; drag.ly = e.clientY; return; }
  if (mode !== 'ville') return;
  cam.x = drag.cx - ((e.clientX - drag.x) * DPR) / cam.z;
  cam.y = drag.cy - ((e.clientY - drag.y) * DPR) / cam.z;
  if (director) director.manualUntil = world.time + (params.has('libre') ? 1e9 : 6);
});
canvas.addEventListener('pointerup', (e) => {
  const click = drag && !drag.moved;
  drag = null;
  canvas.classList.remove('drag');
  if (!click) return;
  if (mode === 'carte') {
    const l = carte.pickAt(e.clientX * DPR, e.clientY * DPR);
    if (l) { const c = carte.choose(l); carte.flyTo(c.lat, c.lon, Math.max(carte.cam.zoom, 11.6), 1200); }
    return;
  }
  if (mode !== 'ville') return;
  const q = pick(e.clientX, e.clientY);
  if (q) return fiche.open(q);
  const poi = pickPoi(e.clientX, e.clientY);
  if (poi) {
    const known = [...world.places.values()].find((x) => x.name === poi.name && Math.hypot(x.x - poi.x, x.y - poi.y) < 60);
    if (known && known.state !== 'cache') return fiche.open(known);
    return fiche.openPoi(poi, { ville: world.mission?.ville, onSend: sendReader });
  }
  fiche?.close();
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (mode === 'carte') { carte.zoomAt(e.clientX * DPR, e.clientY * DPR, -e.deltaY * 0.0022, W, H, DPR); return; }
  if (mode !== 'ville') return;
  const [wx, wy] = toWorld(cam, W, H, e.clientX * DPR, e.clientY * DPR);
  cam.z = Math.max(0.12, Math.min(16, cam.z * Math.exp(-e.deltaY * 0.0015)));
  const [nx, ny] = toWorld(cam, W, H, e.clientX * DPR, e.clientY * DPR);
  cam.x += wx - nx;
  cam.y += wy - ny;
  if (director) director.manualUntil = world.time + (params.has('libre') ? 1e9 : 6);
}, { passive: false });
window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea')) return;
  if (e.key === 'Escape') fiche?.close();
  if (e.key === 'Enter' || e.key === ' ') { if (pre?.wait) e.preventDefault(); startCinema(); }
  if (e.key === 'n' || e.key === 'N') tod = TODS[(TODS.indexOf(tod) + 1) % TODS.length];
  if ((e.key === 'r' || e.key === 'R') && mode === 'ville') play();
  if ((e.key === 'c' || e.key === 'C') && director) director.manualUntil = 0;
});
window.addEventListener('resize', resize);
$('btn-carte').addEventListener('click', () => {history.replaceState(null,'',location.pathname);setMode('carte');});

/** La plus grosse des dernières missions (les petits essais ne valent pas un rejeu). */
async function biggestRun() {
  const rs = await fetch('/api/runs').then((r) => r.json()).catch(() => []);
  return rs.slice(0, 12).sort((a, b) => (b.n ?? 0) - (a.n ?? 0))[0]?.id ?? null;
}

const toolWords={fr:{pause:'Pause animation',play:'Reprendre',center:'Voir le QG',replay:'Rejouer',speed:'Vitesse'},nl:{pause:'Animatie pauzeren',play:'Hervatten',center:'Hoofdkwartier',replay:'Opnieuw afspelen',speed:'Snelheid'},en:{pause:'Pause animation',play:'Resume',center:'View HQ',replay:'Replay',speed:'Speed'}}[getLang()];
const sceneTools=document.createElement('nav');sceneTools.id='scene-tools';sceneTools.className='scene-tools';sceneTools.hidden=true;
function tool(text,fn){const b=document.createElement('button');b.type='button';b.textContent=text;b.addEventListener('click',fn);sceneTools.append(b);return b;}
const pauseTool=tool(toolWords.pause,()=>{animationPaused=!animationPaused;pauseTool.textContent=animationPaused?toolWords.play:toolWords.pause;});
tool('−',()=>{cam.z=Math.max(.12,cam.z/1.35);followActor=null;if(director)director.manualUntil=world.time+60;});
tool('+',()=>{cam.z=Math.min(16,cam.z*1.35);if(director)director.manualUntil=world.time+60;});
tool(toolWords.center,()=>{followActor='chef';});
tool(toolWords.replay,()=>{animationPaused=false;pauseTool.textContent=toolWords.pause;followActor=null;play();});
const speedTool=document.createElement('select');speedTool.setAttribute('aria-label',toolWords.speed);for(const rate of [1,2,4]){const option=document.createElement('option');option.value=rate;option.textContent='×'+rate;speedTool.append(option);}speedTool.addEventListener('change',e=>{speed=+e.target.value;});sceneTools.append(speedTool);$('qg').append(sceneTools);
function shortcut(event){const actor=event.target.closest('[data-actor]');const place=event.target.closest('[data-place]');if(actor){followActor=actor.dataset.actor;}if(place){const q=world?.places.get(place.dataset.place);if(q)fiche.open(q);}}
$('hud').addEventListener('click',shortcut);$('hud').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();shortcut(e);}});

/* ------------------------------------------------------------------ le départ */
async function boot() {
  resize();
  const asked = params.get('run');
  const st = await fetch('/api/state').then((r) => r.json()).catch(() => ({}));
  config = st.config ?? {};
  latestResultRun=st.run?.id??null;resumeButton.hidden=!st.resumable;
  const showingResults=!CINE && st.run && !st.running && (st.resumable||['fini','partiel','erreur'].includes(st.run.status)) ? await results.autoOpen(asked ?? st.run.id).catch(()=>false) : false;
  lanc = createLancement($('launch'), {
    config,
    onLaunch: launch,
    onSearch: (v) => { const c = carte.select({ name: v.nom, lat: v.lat, lon: v.lon, pays: v.cc, cls: 'city' }); lanc.setVille(c); carte.flyTo(v.lat, v.lon, 11.6, 1600); },
    onReplay: async () => replay(await biggestRun()),
  });
  connect();
  setMode((asked || CINE) && !showingResults ? 'plongee' : 'carte');
  if (!window.__CAPTURE) requestAnimationFrame(loop);
  window.__qg.ready = true;
  if (CINE) await cinema(params.get('cinema') || asked || (await biggestRun()));
  else if (st.running && st.run?.status==='en_cours' && (!asked || asked===st.run.id)) {
    runId=st.run.id; buffer=[]; events=[]; pushed.clear();
    await follow(runId);
    const centre={lat:st.run.lat,lon:st.run.lon};
    carte.select({name:st.run.ville,...centre,pays:st.run.pays});
    setMode('plongee'); await buildCity(centre,st.run.rayon ?? 2000); enterCity();
    for(const event of buffer.splice(0)) world.push(event);
  }
  else if (asked) {if(showingResults){deferredReplay=asked;runId=asked;}else await replay(asked);}
  window.__qg.loaded = true;
}

window.__qg = {
  ready: false,
  loaded: false,
  cam,
  carte,
  get city() { return city; },
  get world() { return world; },
  get director() { return director; },
  get mode() { return mode; },
  get cine() { return cine; },
  get fiche() { return fiche; },
  get pre() { return pre; },
  setCam(x, y, z) { Object.assign(cam, { x, y, z }); if (director) director.manualUntil = 1e12; },
  setTod(t) { tod = t; },
  play,
  replay,
  launch,
  /** Avance de dt secondes (pour une capture image par image). */
  step(dt) { resize(); frame(dt); },
  render() { resize(); frame(0); },
};
function showError(e){$('loading').hidden=true;$('mission-status').hidden=false;$('mission-status').className='error';$('mission-status').textContent=l('networkError')+' '+t(e.message);}
boot().catch(showError);

