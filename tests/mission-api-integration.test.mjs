import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, copyFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import net from 'node:net';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const requestBody = { metier: 'café', ville: '1000 Bruxelles', pays: 'BE', centre: { lat: 50.8505, lon: 4.3488 }, rayon_m: 2000,
  nombre: 5, objectif_mails: 5, offre: { ce_que_je_vends: 'Offre fixture', signature: 'Signature fixture', pour_qui: '', site: '' },
  redaction: { moteur: 'claude', modele: '', langue: 'fr' } };

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  assert.notEqual(port, 5577, 'this test must never address the user application');
  return port;
}

test('API + SQLite + vrais workers : délais transitoires, refus permanent, reprise du même id et plafond80', { timeout: 30000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'prosper-api-fixture-'));
  let child, database;
  t.after(async () => {
    if (child && child.exitCode === null) {
      await new Promise((resolve) => {
        const timer = setTimeout(() => child.kill('SIGKILL'), 1000);
        child.once('exit', () => { clearTimeout(timer); resolve(); }); child.kill('SIGTERM');
      });
    }
    try { database?.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
  });
  // Public source only. No live config, data, .env, credentials, website or AI provider is copied/contacted.
  cpSync(resolve(import.meta.dirname, '../server'), join(directory, 'server'), { recursive: true });
  mkdirSync(join(directory, 'web/public/carte'), { recursive: true });
  copyFileSync(resolve(import.meta.dirname, '../web/public/carte/pays.json'), join(directory, 'web/public/carte/pays.json'));
  copyFileSync(resolve(import.meta.dirname, '../package.json'), join(directory, 'package.json'));
  writeFileSync(join(directory, 'config.json'), JSON.stringify({ recherche: { ...requestBody, source: 'osm' }, offre: requestBody.offre,
    redaction: requestBody.redaction, equipe: { lecteurs_en_parallele: 3, score_minimum: 60 }, consignes: '' }));
  const modeFile = join(directory, 'fixture-mode');
  writeFileSync(modeFile, 'three-timeouts');
  writeFileSync(join(directory, 'server/agents/carte.mjs'), `
export async function overpass(){return {elements:[]};}
export async function villeOSM(){return {};}
export async function eclairerOSM(request,{onFound,shouldContinue}){
 let stopped=false;
 for(let i=0;i<300;i++){
  if(!await shouldContinue()){stopped=true;break;}
  if(await onFound({id:'fixture-'+i,name:'Café fixture '+i,address:'Adresse fixture',lat:50.8505+i*0.00005,lon:4.3488,website:'https://fixture-'+i+'.invalid/'})===false){stopped=true;break;}
 }
 return Object.assign([],{reason:stopped?'objective_reached':'radius_exhausted',exhausted:!stopped,queries:1,rayon:2000});
}`);
  // Keep the real reader, parser, security checks and worker lifecycle. Only HTTP/DNS responses are fixtures.
  writeFileSync(join(directory, 'server/agents/lecteur-worker.mjs'), `
import{parentPort,workerData}from'node:worker_threads';import{lireDirecte}from'./lecteur.mjs';
const result=await lireDirecte(workerData.place,{resolver:async()=>[{address:'93.184.216.34',family:4}],fetchImpl:async(url)=>{
 const host=new URL(url).hostname;return new Response('<html lang="fr"><p>Commerce fixture contact@'+host+'</p></html>',{headers:{'content-type':'text/html'}});
},onStep:texte=>parentPort.postMessage({type:'step',texte})});parentPort.postMessage({type:'result',result});`);
  writeFileSync(join(directory, 'server/agents/redacteur.mjs'), `
import{readFileSync}from'node:fs';import{RedactionError}from'../redaction-recovery.mjs';
let previous='',calls=0;
export async function rediger(place){const mode=readFileSync(${JSON.stringify(modeFile)},'utf8');if(mode!==previous){previous=mode;calls=0;}const call=++calls;
 await new Promise(resolve=>setTimeout(resolve,20));
 if(mode==='auth')throw new RedactionError('engine_auth_required','Authentification fixture requise');
 if(mode==='all-timeouts'||mode==='three-timeouts'&&call<=3)throw new RedactionError('redaction_timeout','Délai transitoire fixture',{retryable:true});
 return{constat:'Observation fixture',objet:'Objet fixture',mail:'Offre fixture pour '+place.id+'. Signature fixture.',mail_langue:'fr',mail_langue_source:'explicite',duree_ms:20};}`);
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  let log = '';
  child = spawn(process.execPath, [join(directory, 'server/index.mjs')], { cwd: directory, env: { PATH: process.env.PATH ?? '', PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk) => { log = (log + chunk).slice(-4000); });
  child.stderr.on('data', (chunk) => { log = (log + chunk).slice(-4000); });
  const call = async (path, body) => {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(2000) });
    return { status: response.status, data: await response.json() };
  };
  let ready = false;
  for (let i = 0; i < 100; i++) { try { ready = (await call('/api/health')).status === 200; } catch {} if (ready) break; await delay(20); }
  assert.equal(ready, true, log);
  database = new DatabaseSync(join(directory, 'data/agents.db'));
  const finished = async (id) => {
    for (let i = 0; i < 1000; i++) { const state = (await call('/api/state?run=' + id)).data; if (!state.running) return state; await delay(10); }
    assert.fail('fixture mission did not finish');
  };

  const first = await call('/api/run', requestBody);
  assert.equal(first.status, 200);
  const successful = await finished(first.data.runId);
  assert.equal(successful.run.ville, '1000 Bruxelles'); assert.equal(successful.run.lat, 50.8505); assert.equal(successful.run.lon, 4.3488);
  assert.equal(successful.run.status, 'fini'); assert.equal(successful.summary.ecrits, 5); assert.equal(successful.summary.echecs_redaction, 3);
  assert.equal(successful.summary.writing_blocked, null); assert.equal(successful.summary.tentatives_redaction, 8);

  writeFileSync(modeFile, 'auth');
  const blockedRun = await call('/api/run', requestBody);
  const blocked = await finished(blockedRun.data.runId);
  assert.equal(blocked.run.status, 'partiel'); assert.equal(blocked.summary.writing_blocked_code, 'engine_auth_required');
  assert.ok(blocked.summary.tentatives_redaction <= 2); assert.equal(blocked.summary.ecrits, 0); assert.equal(blocked.resumable, true);
  const savedId = blocked.places[0].id;
  database.prepare('UPDATE places SET status=?,mail=?,objet=?,decided_at=? WHERE run_id=? AND id=?')
    .run('valide', 'Mail préexistant fixture à conserver', 'Objet conservé fixture', 12345, blocked.run.id, savedId);
  const protectedPlace = (await call('/api/state?run=' + blocked.run.id)).data.places.find((row) => row.id === savedId);
  writeFileSync(modeFile, 'normal');
  const resumed = await call('/api/runs/' + blocked.run.id + '/resume', {});
  assert.equal(resumed.status, 202); assert.equal(resumed.data.runId, blocked.run.id);
  assert.equal((await call('/api/runs/' + blocked.run.id + '/resume', {})).status, 409);
  const repaired = await finished(blocked.run.id);
  assert.equal(repaired.run.id, blocked.run.id); assert.equal(repaired.run.status, 'fini'); assert.equal(repaired.summary.ecrits, 5);
  assert.equal(repaired.summary.erreurs_redaction, 0); assert.equal(repaired.summary.writing_blocked_code, null);
  assert.deepEqual(repaired.places.find((row) => row.id === savedId), protectedPlace);
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM runs').get().n, 2);

  writeFileSync(modeFile, 'all-timeouts');
  const boundedRun = await call('/api/run', { ...requestBody, nombre: 60, objectif_mails: 60 });
  const bounded = await finished(boundedRun.data.runId);
  assert.equal(bounded.run.status, 'partiel'); assert.equal(bounded.summary.reason, 'model_budget');
  assert.equal(bounded.summary.tentatives_redaction, 80); assert.equal(bounded.summary.limite_redactions, 80);
  assert.equal(bounded.summary.ecrits, 0); assert.equal(bounded.summary.a_reprendre, 60); assert.equal(bounded.resumable, true);
  assert.equal(bounded.summary.exhausted, false); assert.ok(bounded.places.length <= 250);
});
