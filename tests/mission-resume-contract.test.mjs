import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync,copyFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
test('the real coordinator resumes the same saved mission, preserves decisions and reads only pending businesses',{timeout:10000},async t=>{
 const root=mkdtempSync(join(tmpdir(),'prosper-resume-contract-'));let memory;const oldBinary=process.env.CLAUDE_BIN;
 t.after(()=>{try{memory?.db.close();}catch{}if(oldBinary===undefined)delete process.env.CLAUDE_BIN;else process.env.CLAUDE_BIN=oldBinary;rmSync(root,{recursive:true,force:true});});
 cpSync(resolve(import.meta.dirname,'../server'),join(root,'server'),{recursive:true});mkdirSync(join(root,'web/public/carte'),{recursive:true});copyFileSync(resolve(import.meta.dirname,'../web/public/carte/pays.json'),join(root,'web/public/carte/pays.json'));
 // La source du test ne contacte aucun réseau ni vrai établissement.
 writeFileSync(join(root,'server/agents/carte.mjs'),`export async function overpass(){return {elements:[]};} export async function eclairerOSM(request,{onFound}){await onFound({id:'pending',name:'Pending QA',lat:50.85,lon:4.35});return {reason:'radius_exhausted',exhausted:true,rayon:20000,queries:1};}`);
 const binary=join(root,'fake-claude');writeFileSync(binary,`#!${process.execPath}\nprocess.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({structured_output:{constat:'Observation QA',objet:'Objet QA',mail:'Offre QA. Signature QA.'}})));`,{mode:0o700});process.env.CLAUDE_BIN=binary;
 writeFileSync(join(root,'config.json'),JSON.stringify({recherche:{nombre:5,centre:{lat:52,lon:5},metier:'autre',source:'osm'},equipe:{lecteurs_en_parallele:3,score_minimum:60},offre:{ce_que_je_vends:'Offre QA',signature:'Signature QA'},redaction:{moteur:'claude',langue:'fr'}}));
 memory=await import(pathToFileURL(join(root,'server/db.mjs')));const chef=await import(pathToFileURL(join(root,'server/chef.mjs')));
 memory.db.prepare('INSERT INTO runs(id,status,metier,ville,lat,lon,rayon,nombre,pays) VALUES(?,?,?,?,?,?,?,?,?)').run('stranded','en_cours','café','Bruxelles',50.85,4.35,2000,60,'BE');
 memory.insertEvent({run_id:'stranded',t:Date.now(),agent:'chef',type:'start',data:{objectif_contacts:60,objectif_mails:60,score_minimum:60}});
 for(const [id,status] of [['saved','valide'],['draft','erreur'],['pending','lecture'],['rejected','ecarte']]){memory.upsertPlace('stranded',{id,name:id+' QA',address:'',status,lat:50.85,lon:4.35});if(id==='saved'||id==='draft')memory.updatePlace('stranded',id,{score:75,signals:{site:true,raisons:[]},emails:[id+'@example.invalid'],to_email:id+'@example.invalid',excerpt:'Observation QA',...(id==='saved'?{objet:'Objet conservé',mail:'Mail conservé',decided_at:123}:{})});}
 const before=memory.getPlace('stranded','saved');assert.equal(chef.missionReprenable('stranded'),true);
 assert.equal(await chef.reprendreMission('stranded'),'stranded');assert.equal(chef.isRunning(),true);await assert.rejects(chef.reprendreMission('stranded'),{code:'mission_active'});
 const until=Date.now()+6000;while(chef.isRunning()&&Date.now()<until)await new Promise(r=>setTimeout(r,10));assert.equal(chef.isRunning(),false);
 assert.equal(memory.db.prepare('SELECT count(*) AS n FROM runs').get().n,1);assert.deepEqual(memory.getPlace('stranded','saved'),before);assert.equal(memory.getPlace('stranded','pending').status,'ecarte');assert.ok(memory.getPlace('stranded','draft').mail);assert.equal(memory.getPlace('stranded','rejected').status,'ecarte');
 const summary=chef.resumeMission('stranded');assert.equal(summary.objectif_contacts,60);assert.equal(summary.objectif_mails,60);assert.equal(summary.status,'partiel');assert.equal(summary.ecrits,2);
});
