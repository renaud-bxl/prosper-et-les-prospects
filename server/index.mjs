// Le serveur local : l'API des agents, le flux d'événements en direct et l'interface.
// Il n'écoute que sur 127.0.0.1 : rien n'est exposé sur le réseau.
import http from 'node:http';
import { readFileSync, existsSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join, extname } from 'node:path';
import { ROOT, loadConfig, GOOGLE_KEY } from './env.mjs';
import { lastRun, getRun, listRuns, listPlaces, listEvents, getPlace, updatePlace } from './db.mjs';
import { bus, lancer, decider, isRunning, isDraftRunning, visiter, lancerBrouillons, statutBrouillons, resumeMission, reprendreMission, missionReprenable } from './chef.mjs';
import { localiser } from './agents/eclaireur.mjs';
import { villeOSM } from './agents/carte.mjs';
import { capacitesMoteurs } from './agents/moteurs.mjs';
import { getUpdateStatus, startUpdate, isUpdating } from './updates.mjs';
import { validateMission, countryAt } from './benelux.mjs';
import { ficheGoogle } from './agents/google.mjs';
import { verifierDisponibiliteMission } from './mission-pipeline.mjs';

const PORT = Number(process.env.PORT ?? 5577);
const DEV = process.argv.includes('--dev');

const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 24000) throw new Error('Requête trop volumineuse.'); }
  return raw ? JSON.parse(raw) : {};
}

function snapshot(runId) {
  const run = runId ? getRun(runId) : lastRun();
  return { run, running: isRunning(), places: run ? listPlaces(run.id) : [], draftJob: run ? statutBrouillons(run.id) : null, summary: run ? resumeMission(run.id) : null, resumable: run ? missionReprenable(run.id) : false, config: publicConfig() };
}

function publicConfig() {
  const c = loadConfig();
  return { recherche: c.recherche, offre: c.offre, equipe: c.equipe, consignes: c.consignes ?? '', redaction: c.redaction ?? {moteur:'claude',modele:'',langue:'auto'} };
}

async function api(req, res, url) {
  const { pathname } = url;
  if (pathname === '/api/health' && req.method === 'GET') return json(res,200,{ok:true,app:'prosper-et-les-prospects',version:JSON.parse(readFileSync(join(ROOT,'package.json'),'utf8')).version});
  if (pathname === '/api/capabilities' && req.method === 'GET') return json(res,200,await capacitesMoteurs());
  if ((pathname === '/api/updates' || pathname === '/api/update') && req.method === 'GET') return json(res,200,await getUpdateStatus({force:url.searchParams.get('force')==='1'}));
  if (pathname === '/api/update' && req.method === 'POST') {
    if (isRunning()) return json(res,409,{code:'mission_active',error:'Une mission est en cours. Attendez sa fin avant la mise à jour.'});
    try { return json(res,202,await startUpdate({port:PORT})); } catch(e) { return json(res,409,{code:e.code ?? 'update_failed',error:e.message}); }
  }
  if (req.method === 'POST' && isUpdating() && !pathname.endsWith('/decision')) return json(res,409,{error:'Mise à jour en cours.'});
  if (pathname === '/api/state' && req.method === 'GET') return json(res, 200, snapshot(url.searchParams.get('run')));
  if (pathname === '/api/runs' && req.method === 'GET') return json(res, 200, listRuns());
  // La fiche Google d'un commerce : son identifiant, retrouvé une fois puis gardé.
  const gfiche = pathname.match(/^\/api\/runs\/([\w-]+)\/places\/([\w-]+)\/google$/);
  if (gfiche && req.method === 'GET') {
    const place = getPlace(gfiche[1], gfiche[2]);
    if (!place) return json(res, 404, { error: 'Commerce inconnu.' });
    if (place.gid) return json(res, 200, { gid: place.gid });
    try {
      const gid = await ficheGoogle(place);
      if (gid) updatePlace(gfiche[1], gfiche[2], { gid });
      return json(res, 200, { gid });
    } catch (e) { return json(res, 502, { error: e.message }); }
  }

  // La ville du QG : les immeubles un par un et les arbres (OpenStreetMap, gardés 7 jours dans data/overpass).
  if (pathname === '/api/ville' && req.method === 'GET') {
    const lat = Number(url.searchParams.get('lat')), lon = Number(url.searchParams.get('lon'));
    const r = Math.max(500, Math.min(5000, Number(url.searchParams.get('r')) || 2200));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return json(res, 400, { error: 'centre manquant' });
    try {
      const body = JSON.stringify(await villeOSM({ lat, lon }, r));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'max-age=3600' });
      return res.end(body);
    } catch (e) { return json(res, 502, { error: e.message }); }
  }

  // Les tuiles vectorielles de la ville (OpenFreeMap, données OpenStreetMap), gardées en cache dans data/tuiles.
  const tile = pathname.match(/^\/api\/tiles\/(\d+)\/(\d+)\/(\d+)$/);
  if (tile && req.method === 'GET') {
    const buf = await getTile(+tile[1], +tile[2], +tile[3]);
    res.writeHead(200, { 'Content-Type': 'application/x-protobuf', 'Cache-Control': 'max-age=86400' });
    return res.end(buf);
  }

  const ev = pathname.match(/^\/api\/runs\/([\w-]+)\/events$/);
  if (ev && req.method === 'GET') return json(res, 200, listEvents(ev[1]));

  const runPlaces = pathname.match(/^\/api\/runs\/([\w-]+)\/places$/);
  if (runPlaces && req.method === 'GET') {
    if (!getRun(runPlaces[1])) return json(res, 404, { code: 'run_not_found', error: 'Mission inconnue.' });
    return json(res, 200, listPlaces(runPlaces[1]));
  }
  const resume = pathname.match(/^\/api\/runs\/([\w-]+)\/resume$/);
  if(resume && req.method==='POST') {
    try {return json(res,202,{runId:await reprendreMission(resume[1])});}
    catch(error){return json(res,409,{code:error.code??'resume_failed',error:error.message});}
  }
  const drafts = pathname.match(/^\/api\/runs\/([\w-]+)\/drafts$/);
  if (drafts && ['GET', 'POST'].includes(req.method)) {
    if (!getRun(drafts[1])) return json(res, 404, { code: 'run_not_found', error: 'Mission inconnue.' });
    if (req.method === 'GET') return json(res, 200, statutBrouillons(drafts[1]));
    try { return json(res, 202, lancerBrouillons(drafts[1], await readBody(req))); }
    catch (error) { return json(res, error.status ?? 400, { code: error.code ?? 'invalid_request', error: error.message }); }
  }

  if (pathname === '/api/run' && req.method === 'POST') {
    const body = await readBody(req);
    const config = loadConfig();
    try {
      verifierDisponibiliteMission({ running: isRunning(), updating: isUpdating() });
      const cc = validateMission(body,config);
      if (body.metier) config.recherche.metier = String(body.metier).slice(0, 60);
      if (body.centre && Number.isFinite(+body.centre.lat) && Number.isFinite(+body.centre.lon)) {
        // La ville choisie sur la carte de mission.
        config.recherche.centre = { lat: +body.centre.lat, lon: +body.centre.lon };
        config.recherche.ville = String(body.ville ?? 'ce lieu').slice(0, 80);
        config.recherche.pays = cc;
      } else if (body.ville && body.ville !== config.recherche.ville) {
        config.recherche.ville = String(body.ville);
        config.recherche.centre = await localiser(config.recherche.ville);
      }
      if (body.rayon_m) config.recherche.rayon_m = Math.max(500, Math.min(5000, Number(body.rayon_m)));
      if (body.nombre) config.recherche.nombre = Math.max(5, Math.min(60, Number(body.nombre)));
      if (body.objectif_mails !== undefined) config.recherche.objectif_mails = Number(body.objectif_mails) > 0 ? Math.min(60, Number(body.objectif_mails)) : null;
      if (body.veut && typeof body.veut === 'object') config.recherche.veut = { emails: body.veut.emails !== false, telephones: body.veut.telephones !== false };
      if (body.offre && typeof body.offre === 'object') {
        for (const k of ['ce_que_je_vends', 'pour_qui', 'signature', 'site']) if (typeof body.offre[k] === 'string') config.offre[k] = body.offre[k].slice(0, 600);
      }
      if (body.redaction) config.redaction = {moteur:body.redaction.moteur, modele:String(body.redaction.modele ?? '').slice(0,80), langue:body.redaction.langue ?? 'auto'};
      if (typeof body.consignes === 'string') config.consignes = body.consignes.slice(0, 800);
      // Relire le verrou après chaque attente et avant toute écriture de configuration.
      verifierDisponibiliteMission({ running: isRunning(), updating: isUpdating() });
      // La dernière mission devient celle par défaut (la carte se centre sur cette ville au prochain chargement).
      writeFileSync(join(ROOT, 'config.json.tmp'), JSON.stringify(config, null, 2) + '\n');
      renameSync(join(ROOT,'config.json.tmp'),join(ROOT,'config.json'));
      return json(res, 200, { runId: await lancer(config) });
    } catch (e) { return json(res, 409, { code: e.code ?? 'invalid_request', error: e.message }); }
  }

  // Un commerce cliqué sur la carte du QG : un lecteur va le voir (les gestes arrivent dans le flux en direct).
  const vis = pathname.match(/^\/api\/runs\/([\w-]+)\/visite$/);
  if (vis && req.method === 'POST') {
    if (isDraftRunning()) return json(res, 409, { code: 'drafts_active', error: 'Une rédaction est déjà en cours.' });
    const body = await readBody(req);
    if (!body.name || !Number.isFinite(+body.lat) || !Number.isFinite(+body.lon)) return json(res, 400, { error: 'commerce incomplet' });
    if (!countryAt(+body.lat,+body.lon)) return json(res,400,{error:'Commerce hors Benelux.'});
    if (!getRun(vis[1])) return json(res, 404, { error: 'mission inconnue' });
    visiter(vis[1], { name: String(body.name).slice(0, 120), lat: +body.lat, lon: +body.lon, type: body.type ? String(body.type).slice(0, 40) : null, agent: /^lecteur-[123]$/.test(body.agent) ? body.agent : 'lecteur-1' }, loadConfig())
      .catch((e) => console.error('visite', e.message));
    return json(res, 202, { ok: true });
  }

  const dec = pathname.match(/^\/api\/runs\/([\w-]+)\/places\/([\w-]+)\/decision$/);
  if (dec && req.method === 'POST') {
    const body = await readBody(req);
    try { return json(res, 200, decider(dec[1], dec[2], body.decision, body)); } catch (e) { return json(res, 400, { error: e.message }); }
  }

  if (pathname === '/api/stream' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`);
    const onEvent = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    bus.on('event', onEvent);
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => { bus.off('event', onEvent); clearInterval(ping); });
    return;
  }
  return json(res, 404, { error: 'introuvable' });
}

let tileTemplate = null;
async function getTile(z, x, y) {
  const file = join(ROOT, 'data', 'tuiles', `${z}-${x}-${y}.pbf`);
  if (existsSync(file)) return readFileSync(file);
  if (!tileTemplate) tileTemplate = (await (await fetch('https://tiles.openfreemap.org/planet')).json()).tiles[0];
  const res = await fetch(tileTemplate.replace('{z}', z).replace('{x}', x).replace('{y}', y), { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`tuile ${z}/${x}/${y} : ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(join(ROOT, 'data', 'tuiles'), { recursive: true });
  writeFileSync(file, buf);
  return buf;
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

function serveStatic(req, res, url) {
  const dist = join(ROOT, 'web', 'dist');
  let file = join(dist, decodeURIComponent(url.pathname));
  if (!file.startsWith(dist + '/') && file !== dist) return json(res, 403, { error: 'interdit' });
  if (!existsSync(file) || url.pathname === '/') file = join(dist, 'index.html');
  if (!existsSync(file)) return json(res, 500, { error: "Interface non construite : lance « npm run build » ou « npm run dev »." });
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
}

let vite = null;
if (DEV) {
  const { createServer } = await import('vite');
  vite = await createServer({ root: join(ROOT, 'web'), server: { middlewareMode: true }, appType: 'spa', logLevel: 'warn' });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    const host = req.headers.host;
    if (![`127.0.0.1:${PORT}`,`localhost:${PORT}`].includes(host)) return json(res,403,{error:'Accès local uniquement.'});
    if (req.headers.origin && ![`http://127.0.0.1:${PORT}`,`http://localhost:${PORT}`].includes(req.headers.origin)) return json(res,403,{error:'Origine non autorisée.'});
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (vite) return vite.middlewares(req, res, () => json(res, 404, { error: 'introuvable' }));
    return serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: e.message });
  }
}).listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log(`Prosper et les prospects : ${url}${DEV ? ' (développement)' : ''}`);
  if (process.argv.includes('--open')) {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    import('node:child_process').then(({ spawn }) => spawn(cmd, [url], { stdio: 'ignore', shell: process.platform === 'win32', detached: true }).unref());
  }
});

