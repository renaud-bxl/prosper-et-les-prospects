import test from 'node:test';
import assert from 'node:assert/strict';
import {eclairerOSM} from '../server/agents/carte.mjs';
import {eclairer} from '../server/agents/eclaireur.mjs';
const centre={lat:50.8466,lon:4.3528};
const recherche={metier:'restaurant',ville:'Bruxelles',centre,nombre:60,rayon_m:2500};
const osm=(i,extra={})=>({type:'node',id:i,lat:centre.lat+(i%20)*.0001,lon:centre.lon+Math.floor(i/20)*.0001,tags:{name:`Commerce ${i}`,website:`https://commerce-${i}.example`,...extra}});
const google=i=>({id:`g${i}`,displayName:{text:`Commerce ${i}`},location:{latitude:centre.lat+(i%20)*.0001,longitude:centre.lon+Math.floor(i/20)*.0001},websiteUri:`https://commerce-${i}.example`,businessStatus:'OPERATIONAL'});
const list=n=>Array.from({length:n},(_,i)=>osm(i));
test('OSM can scan beyond the target60 and stops at250 unique businesses',async()=>{
 let found=0;const result=await eclairerOSM(recherche,{request:async()=>({elements:list(300)}),onFound:()=>{found++;}});
 assert.equal(found,250);assert.equal(result.scanned,250);assert.equal(result.reason,'scan_limit');assert.equal(result.exhausted,false);assert.equal(result.queries,1);
});
test('OSM keeps widening until60 useful contacts among240 scanned',async()=>{
 let queries=0,read=0,contacts=0;
 const result=await eclairerOSM(recherche,{request:async()=>({elements:list(++queries*100)}),shouldContinue:()=>contacts<60,onFound:()=>{if(++read%4===0)contacts++;}});
 assert.equal(contacts,60);assert.equal(read,240);assert.equal(result.scanned,240);assert.equal(result.reason,'objective_reached');assert.equal(result.queries,3);assert.equal(result.exhausted,false);
});
test('OSM deduplicates identifiers and normalised business names near each other',async()=>{
 const first=osm(1,{name:'Café Étoile'}),sameId={...first,tags:{...first.tags,name:'Other label'}},near=osm(2,{name:'Cafe Etoile'}),far={...osm(3,{name:'Cafe Etoile'}),lat:centre.lat+.009};
 const result=await eclairerOSM(recherche,{request:async()=>({elements:[first,sameId,near,far]})});
 assert.equal(result.length,2);assert.equal(result.reason,'radius_exhausted');
});
test('OSM radius and query count stay bounded and report genuine scope exhaustion',async()=>{
 const radii=[];const result=await eclairerOSM(recherche,{request:async query=>{radii.push(Number(query.match(/around:(\d+)/)[1]));return{elements:[]};}});
 assert.equal(result.reason,'radius_exhausted');assert.equal(result.exhausted,true);assert.equal(result.rayon,20000);assert.equal(result.queries,6);assert.ok(radii.every(r=>r<=20000));assert.ok(radii.every((r,i)=>!i||r>radii[i-1]));
});
test('OSM respects callback stop and pre-request stop',async()=>{
 const stopped=await eclairerOSM(recherche,{request:async()=>({elements:list(10)}),onFound:()=>false});assert.equal(stopped.length,1);assert.equal(stopped.reason,'objective_reached');
 const initial=await eclairerOSM(recherche,{request:()=>assert.fail('unexpected source request'),shouldContinue:()=>false});assert.equal(initial.queries,0);assert.equal(initial.reason,'objective_reached');
});
test('OSM source failure preserves prior results and never claims exhaustion',async()=>{
 let queries=0;const result=await eclairerOSM(recherche,{request:async()=>{if(++queries===2)throw Error('fixture source unavailable');return{elements:list(2)};}});
 assert.equal(result.length,2);assert.equal(result.queries,2);assert.equal(result.reason,'source_error');assert.equal(result.exhausted,false);assert.match(result.error,/unavailable/);
});
test('OSM rejects partial timeout responses instead of labelling them exhaustive',async()=>{
 const result=await eclairerOSM(recherche,{request:async()=>({elements:list(1),remark:'runtime timeout'})});assert.equal(result.reason,'source_error');assert.equal(result.exhausted,false);
});
test('OSM prefers sites from widened areas before spending scans on no-site places',async()=>{
 let queries=0;const result=await eclairerOSM(recherche,{request:async()=>({elements:++queries===1?list(300).map(p=>({...p,tags:{name:p.tags.name}})):list(300)}),onFound:p=>{assert.ok(p.website);}});
 assert.equal(result.length,250);assert.equal(result.queries,2);
});
test('Google paginates bounded search areas and can scan250 instead of only60',async()=>{
 let requests=0;const bodies=[];
 const result=await eclairer(recherche,{wait:async()=>{},request:async body=>{bodies.push(body);const start=requests++*20;return{places:Array.from({length:20},(_,i)=>google(start+i)),...(requests%3?{nextPageToken:`page${requests}`}:{})};}});
 assert.equal(result.scanned,250);assert.equal(result.reason,'scan_limit');assert.equal(result.exhausted,false);assert.equal(requests,13);assert.ok(bodies.some(b=>b.pageToken));assert.ok(new Set(bodies.map(b=>JSON.stringify(b.locationBias))).size>1);assert.ok(bodies.every(b=>b.regionCode==='BE'));
});
test('Google filters the true radius, Benelux borders, closed sites and chains',async()=>{
 const outside={...google(2),location:{latitude:51.8,longitude:4.3}},outsideBenelux={...google(3),location:{latitude:48.8,longitude:2.3}},closed={...google(4),businessStatus:'CLOSED_PERMANENTLY'},chain={...google(5),displayName:{text:'McDonalds'}};
 const result=await eclairer(recherche,{request:async()=>({places:[outside,outsideBenelux,closed,chain,google(1)]}),onFound:()=>false});
 assert.equal(result.length,1);assert.equal(result[0].id,'g1');assert.equal(result.reason,'objective_reached');
});
test('Google deduplicates cross-page and cross-area listings, bounded to18 calls',async()=>{
 let calls=0;const first=google(1),otherId={...google(2),displayName:first.displayName};
 const result=await eclairer(recherche,{wait:async()=>{},request:async()=>{calls++;return{places:[first,first,otherId],nextPageToken:'more'};}});
 assert.equal(calls,18);assert.equal(result.length,1);assert.equal(result.reason,'radius_exhausted');assert.equal(result.rayon,20000);assert.equal(result.exhausted,true);
});
test('Google stops without requesting another page once the useful objective is met',async()=>{
 let calls=0,found=0;const result=await eclairer(recherche,{shouldContinue:()=>found<3,wait:()=>assert.fail('unexpected delay'),request:async()=>{calls++;return{places:[google(1),google(2),google(3),google(4)],nextPageToken:'more'};},onFound:()=>{found++;}});
 assert.equal(calls,1);assert.equal(found,3);assert.equal(result.reason,'objective_reached');
});
test('Google reports errors with already discovered results intact',async()=>{
 let calls=0;const result=await eclairer(recherche,{wait:async()=>{},request:async()=>{if(++calls===2)throw Error('fixture quota');return{places:[google(1)],nextPageToken:'more'};}});
 assert.equal(result.length,1);assert.equal(result.reason,'source_error');assert.equal(result.exhausted,false);assert.match(result.error,/quota/);
});
test('both discovery sources reject invalid centres without touching a source',async()=>{
 for(const fn of [eclairer,eclairerOSM]){const result=await fn({...recherche,centre:{lat:NaN,lon:4}},{request:()=>assert.fail('unexpected source request')});assert.equal(result.reason,'source_error');assert.equal(result.queries,0);}
});
