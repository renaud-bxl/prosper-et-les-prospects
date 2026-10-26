import test from 'node:test';
import assert from 'node:assert/strict';
import {runMissionPipeline} from '../server/mission-pipeline.mjs';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const draft={constat:'Observation de démonstration vérifiée.',objet:'Une proposition locale',mail:'Une offre de démonstration et une question personnalisée. Signature de démonstration.'};
const place=(id,extra={})=>({id:String(id),name:`Commerce ${id}`,lat:50.85,lon:4.35,website:`https://fixture-${id}.example`,...extra});
const config=(target=8,moteur='codex')=>({recherche:{nombre:target,objectif_mails:target,rayon_m:2200},equipe:{score_minimum:60,lecteurs_en_parallele:3},redaction:{moteur},offre:{},consignes:''});
const analysed=(id,status='analyse',extra={})=>place(id,{status,score:75,signals:{site:true,raisons:[],langue:'nl'},emails:[`contact-${id}@example.invalid`],to_email:`contact-${id}@example.invalid`,email_source:`https://fixture-${id}.example/contact`,excerpt:'Informations publiques persistées.',...extra});

async function fixture(initialPlaces,pool=[],options={}){
 const rows=new Map(initialPlaces.map(row=>[String(row.id),structuredClone(row)])),readIds=[],written=[],events=[],newIds=[];
 let queries=0,discoveryRequest=null;
 const result=await runMissionPipeline(options.config??config(),{
  initialPlaces, saved:id=>rows.get(id),update:(id,fields)=>{assert.ok(rows.has(id));Object.assign(rows.get(id),structuredClone(fields));},
  found:row=>{assert.equal(rows.has(row.id),false,'existing rows must not be reinserted or reset');rows.set(row.id,{...row,status:'trouve'});newIds.push(row.id);},
  read:async row=>{readIds.push(row.id);await tick();return options.read?options.read(row):{signals:{site:true,langue:'nl'},emails:[`contact-${row.id}@example.invalid`],excerpt:'Lecture de démonstration.'};},
  score:(_row,lecture)=>({score:lecture.emails.length?75:20,raisons:[]}),
  write:async(row,lecture,note,...rest)=>{written.push({id:row.id,lecture:structuredClone(lecture),note:structuredClone(note)});await tick();return options.write?options.write(row,lecture,note,...rest):{...draft,mail_langue:'nl',mail_langue_source:'site'};},
  discover:async(request,callbacks)=>{
   queries++;discoveryRequest=request;if(options.discoveryError)throw Error('Source de démonstration indisponible');
   let emitted=0,stopped=false;
   for(const row of pool){if(!await callbacks.shouldContinue()){stopped=true;break;}if(emitted>=request.limite_scan)break;emitted++;if(await callbacks.onFound(row)===false){stopped=true;break;}}
   const reason=stopped?'objective_reached':emitted>=request.limite_scan?'scan_limit':'radius_exhausted';
   return Object.assign([],{reason,exhausted:reason==='radius_exhausted',rayon:20000,queries:1,scanned:emitted});
  },
  emit:(agent,type,id,data)=>events.push({agent,type,id,data:structuredClone(data)}),
 });
 return{result,rows,readIds,written,events,newIds,queries,discoveryRequest};
}

test('resume eight existing places: two analysed, six pending; preserve the approved draft and finish from new discovery',{timeout:3000},async()=>{
 const approved=analysed('0','valide',{...draft,objet:'Objet approuvé à conserver',mail:'Message approuvé, déjà corrigé par la personne.',decided_at:12345});
 const rejected=analysed('1','ecarte',{score:20,emails:[],to_email:null,signals:{site:true,raisons:[],raison:'Pas de contact public'}});
 const pending=Array.from({length:6},(_,i)=>place(i+2,{status:i%2?'lecture':'trouve',score:0,signals:null,emails:[]}));
 const initial=[approved,rejected,...pending],f=await fixture(initial,[...initial.map(row=>place(row.id)),place('8')]);
 const seeded=f.events.find(e=>e.agent==='chef'&&e.type==='progress').data;
 assert.deepEqual([seeded.trouves,seeded.lus,seeded.retenus,seeded.ecrits,seeded.ecartes],[8,2,1,1,1]);
 assert.equal(f.result.status,'fini');assert.equal(f.result.ecrits,8);assert.equal(f.result.retenus,8);assert.equal(f.result.trouves,9);assert.equal(f.result.lus,9);
 assert.deepEqual(f.newIds,['8']);assert.equal(f.readIds.length,7);assert.ok(pending.every(row=>f.readIds.includes(row.id)));
 assert.equal(f.readIds.includes('0'),false);assert.equal(f.readIds.includes('1'),false);assert.equal(f.written.some(row=>row.id==='0'||row.id==='1'),false);
 assert.deepEqual(f.rows.get('0'),approved);assert.deepEqual(f.rows.get('1'),rejected);
});

test('analysed/a_ecrire/ecriture/engine_missing rows retry writing from persisted contacts without another read',{timeout:3000},async()=>{
 const initial=['analyse','a_ecrire','ecriture','erreur'].map((status,i)=>analysed(i,status,status==='erreur'?{signals:{site:true,raisons:[],langue:'nl',redaction_error:{code:'engine_missing',message:'Ancien binaire manquant'}}}:{}));
 const f=await fixture(initial,[],{config:config(4)});
 assert.equal(f.result.status,'fini');assert.equal(f.result.ecrits,4);assert.equal(f.result.writing_blocked,null);assert.deepEqual(f.readIds,[]);
 assert.deepEqual(new Set(f.written.map(row=>row.id)),new Set(['0','1','2','3']));
 assert.ok(f.written.every(row=>row.lecture.emails[0]===`contact-${row.id}@example.invalid`&&row.lecture.excerpt==='Informations publiques persistées.'&&row.note.score===75));
 assert.equal(f.rows.get('3').signals.redaction_error,undefined);
 assert.equal(f.result.erreurs_redaction,0,'the repaired historic engine_missing is no longer an outstanding error');
 assert.ok(f.written.every(row=>row.lecture.email_source.endsWith('/contact')));
});

test('preserve decisions and existing mails; seeded recipients stay unique and an alternative public address can be used',{timeout:3000},async()=>{
 const approved=analysed('approved','valide',{...draft,to_email:'SHARED@EXAMPLE.INVALID',emails:['SHARED@EXAMPLE.INVALID']});
 const refused=analysed('refused','refuse',{...draft,to_email:'refused@example.invalid',emails:['refused@example.invalid'],decided_at:123});
 const duplicate=analysed('duplicate','analyse',{to_email:'shared@example.invalid',emails:['shared@example.invalid']});
 const pending=place('pending',{status:'lecture',score:0,signals:null});
 const f=await fixture([approved,refused,duplicate,pending],[place('refused'),place('copy-refused'),place('new')],{config:config(3),read:row=>({signals:{site:true},emails:row.id==='pending'?['shared@example.invalid','branch@example.invalid']:row.id==='copy-refused'?['refused@example.invalid']:['new@example.invalid']})});
 assert.equal(f.result.status,'fini');assert.equal(f.result.ecrits,3);assert.equal(f.rows.get('pending').to_email,'branch@example.invalid');
 assert.equal(f.rows.get('copy-refused').status,'ecarte');assert.equal(f.rows.get('copy-refused').signals.doublon_email,true);
 assert.deepEqual(f.rows.get('approved'),approved);assert.deepEqual(f.rows.get('refused'),refused);assert.deepEqual(f.rows.get('duplicate'),duplicate);
 assert.equal(f.written.some(row=>['approved','refused','duplicate'].includes(row.id)),false);
 assert.equal(new Set(f.written.map(row=>row.lecture.emails[0])).size,f.written.length);
});

test('rescan ids do not spend the remaining250-place admission budget or reread completed rejections',{timeout:3000},async()=>{
 const initial=Array.from({length:200},(_,i)=>analysed(i,'ecarte',{score:20,emails:[],to_email:null}));
 const pool=[...initial.map(row=>place(row.id)),...Array.from({length:80},(_,i)=>place(i+200))];
 const f=await fixture(initial,pool,{config:config(1,'aucun'),read:()=>({signals:{site:true},emails:[]})});
 assert.equal(f.result.trouves,250);assert.equal(f.newIds.length,50);assert.equal(f.readIds.length,50);assert.equal(f.result.lus,250);assert.equal(f.result.ecartes,250);
 assert.equal(f.result.reason,'scan_limit');assert.equal(f.result.exhausted,false);assert.equal(f.written.length,0);
});

test('already satisfied seeded objectives require no discovery, read or rewrite',{timeout:3000},async()=>{
 const initial=[analysed('a','valide',{...draft}),analysed('b','en_attente',{...draft})];
 const f=await fixture(initial,[],{config:config(2)});
 assert.equal(f.result.status,'fini');assert.equal(f.queries,0);assert.deepEqual(f.readIds,[]);assert.deepEqual(f.written,[]);assert.equal(f.result.ecrits,2);
 for(const row of initial)assert.deepEqual(f.rows.get(row.id),row);
});

test('reaching the global250 cap cannot falsely report source exhaustion on the final candidate',{timeout:3000},async()=>{
 const initial=Array.from({length:200},(_,i)=>analysed(i,'ecarte',{score:20,emails:[],to_email:null}));
 const f=await fixture(initial,Array.from({length:50},(_,i)=>place(i+200)),{config:config(1,'aucun'),read:()=>({signals:{site:true},emails:[]})});
 assert.equal(f.result.trouves,250);assert.equal(f.result.reason,'scan_limit');assert.equal(f.result.exhausted,false);
});

test('a failed discovery still finishes seeded reads and writes, without losing the stored entries',{timeout:3000},async()=>{
 const initial=[analysed('known'),place('pending',{status:'lecture',score:0,signals:null})];
 const f=await fixture(initial,[],{config:config(2),discoveryError:true});
 assert.equal(f.result.reason,'source_error');assert.equal(f.result.status,'partiel');assert.equal(f.result.trouves,2);assert.equal(f.result.lus,2);assert.equal(f.result.ecrits,2);
 assert.deepEqual(f.readIds,['pending']);assert.equal(f.written.length,2);assert.equal(f.result.erreur,false);
});
