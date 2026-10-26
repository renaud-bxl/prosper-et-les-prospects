import test from 'node:test';
import assert from 'node:assert/strict';
import { Monde } from '../web/src/monde.js';
import { getLang, setLang } from '../web/src/i18n.js';

function cityFixture() {
  const road = { cls: 'minor', rank: 2, pave: false, bridge: false, half: 2, pts: [[-200, 35], [500, 35]] };
  return {
    roads: [road], buildingAt: () => null, areaAt: () => 0,
    toXY: (lat, lon) => [(lon - 4.35) * 100000, (50.85 - lat) * 100000 + 35],
    nearestRoad(x, y, max, filter) {
      if (filter && !filter(road)) return null;
      const px = Math.max(-200, Math.min(500, x)), d = Math.hypot(px - x, 35 - y);
      return d <= max ? { x: px, y: 35, half: road.half, d, road } : null;
    },
  };
}
const business = { id: 'fixture-cafe', name: 'Café de démonstration', lat: 50.85, lon: 4.351, website: 'https://fixture.example' };
const event = (agent, type, data = {}, place_id = null) => ({ agent, type, data, place_id });
const advance = (world, seconds) => { for (let t = 0; t < seconds - 1e-8; t += .05) world.update(.05); };
function pipeline(world) {
  world.push(event('chef', 'start', { metier: 'café', ville: 'Bruxelles', redaction_active: false }));
  world.push(event('eclaireur', 'step', { texte: 'Recherche de commerces — source de test' }));
  world.push(event('eclaireur', 'found', business, business.id));
  world.push(event('lecteur-1', 'start', { name: business.name, site: business.website }, business.id));
  world.push(event('lecteur-1', 'done', { name: business.name, score: 75, retenu: true, email: 'test@fixture.example', raisons: [] }, business.id));
}

test('readers depart and finish before scout.done, preserving the introduction and street visit', () => {
  const world = new Monde(cityFixture()), seen = [];
  world.on((type, data) => seen.push({ type, time: world.time, introDone: world.introDone, inside: data?.a?.inside }));
  pipeline(world);
  advance(world, 2);
  assert.equal(world.introDone, false);
  assert.equal(world.teamSent, false, 'the initial briefing still precedes reader dispatch');
  advance(world, 28);
  assert.equal(world.introDone, true);
  assert.equal(world.teamSent, true, 'reader.start must dispatch the team without scout.done');
  assert.equal(world.place(business.id).revealed, true);
  assert.equal(world.place(business.id).read, true, 'queued reader.done must become visible before discovery finishes');
  assert.equal(world.place(business.id).state, 'retenu');
  assert.ok(seen.some(e => e.type === 'go'), 'the reader still follows a route');
  assert.equal(seen.find(e => e.type === 'read')?.inside, business.id, 'reading still occurs inside the business');
  assert.equal(seen.find(e => e.type === 'scored')?.inside, null, 'the reader exits before presenting the score');
  assert.equal(seen.filter(e => e.type === 'team').length, 1);
  assert.ok(seen.find(e => e.type === 'team').introDone);
  world.push(event('eclaireur', 'done', { trouves: 1, demandes: 60 }));
  advance(world, 6);
  assert.equal(seen.filter(e => e.type === 'team').length, 1, 'the discovery fallback must not dispatch twice');
});

test('a manually visited street business remains readable without a mission briefing or scan', () => {
  const world = new Monde(cityFixture());
  world.push(event('eclaireur', 'found', { ...business, visite: true }, business.id));
  world.push(event('lecteur-1', 'start', { name: business.name }, business.id));
  world.push(event('lecteur-1', 'done', { score: 30, retenu: false, raisons: [] }, business.id));
  advance(world, 15);
  assert.equal(world.place(business.id).revealed, true);
  assert.equal(world.place(business.id).read, true);
  assert.equal(world.place(business.id).state, 'ecarte');
});

test('reset removes a pending dispatch from the previous mission', () => {
  const world = new Monde(cityFixture());
  pipeline(world);
  advance(world, 4.6);
  assert.equal(world.teamDispatchPending, true);
  assert.equal(world.teamSent, false);
  world.push(event('chef', 'start', { metier: 'fleuriste', ville: 'Bruxelles', redaction_active: false }));
  advance(world, 10);
  assert.equal(world.introDone, true);
  assert.equal(world.teamSent, false);
  assert.equal(world.places.size, 0);
});

test('legacy scout.done still dispatches the team once and completes the scan', () => {
  const world = new Monde(cityFixture()), teams = [];
  world.on(type => { if (type === 'team') teams.push(world.time); });
  world.push(event('chef', 'start', { metier: 'café', ville: 'Bruxelles' }));
  world.push(event('eclaireur', 'step', { texte: 'Recherche de test' }));
  world.push(event('eclaireur', 'found', business, business.id));
  world.push(event('eclaireur', 'done', { trouves: 1 }));
  advance(world, 20);
  assert.equal(world.teamSent, true);
  assert.equal(teams.length, 1);
  assert.equal(world.scan, null);
  assert.equal(world.place(business.id).revealed, true);
});

test('live pipeline dispatch is independent of the interface language', () => {
  const original = getLang();
  try {
    for (const language of ['fr', 'nl', 'en']) {
      setLang(language); const world = new Monde(cityFixture()); pipeline(world); advance(world, 30);
      assert.equal(world.teamSent, true, language); assert.equal(world.place(business.id).read, true, language);
    }
  } finally { setLang(original); }
});

// Event kinds and relative timings from the read-only recorded startup burst.
// Business names, identifiers, coordinates, text and contact data are synthetic.
function recordedStartupFixture() {
  const outline = [
    [0,'chef','start'],[.022,'eclaireur','step'],
    [2.669,'eclaireur','found',1],[2.672,'lecteur-1','start',1],[2.673,'lecteur-1','step',1],
    [2.677,'eclaireur','found',2],[2.679,'lecteur-2','start',2],[2.681,'lecteur-2','step',2],
    [2.685,'eclaireur','found',3],[2.688,'lecteur-3','start',3],[2.688,'lecteur-3','step',3],
    [2.691,'eclaireur','found',4],[2.694,'eclaireur','found',5],[2.698,'eclaireur','found',6],
    [2.828,'lecteur-2','step',2],[2.959,'lecteur-1','step',1],[3.083,'lecteur-2','step',2],
    [3.087,'lecteur-2','done',2],[3.09,'chef','progress'],[3.093,'redacteur-1','start',2],
    [3.103,'eclaireur','found',7],[3.105,'lecteur-2','start',4],[3.107,'lecteur-2','step',4],
    [3.111,'redacteur-1','error',2],[3.113,'chef','progress'],[3.334,'lecteur-3','step',3],
    [3.45,'lecteur-2','done',4],[3.452,'chef','progress'],[3.455,'eclaireur','found',8],
    [3.459,'lecteur-2','start',5],[3.461,'lecteur-2','step',5],[3.468,'lecteur-3','step',3],
  ];
  return outline.map(([t,agent,type,index],i) => {
    const p = index ? {...business,id:`trace-${index}`,name:`Commerce QA ${index}`,lon:4.351+index*.0002} : null;
    let data = {name:p?.name};
    if(agent==='chef'&&type==='start')data={metier:'café',ville:'Ville QA',objectif_contacts:60,objectif_mails:60,redaction_active:true};
    else if(type==='found')data=p;
    else if(type==='step')data={texte:'Étape QA fictive'};
    else if(type==='done')data={score:index===2?75:20,retenu:index===2,email:index===2?'contact@fixture.example':null,raisons:[]};
    else if(type==='progress')data={trouves:8,lus:2,retenus:1,ecrits:0,objectif_contacts:60,objectif_mails:60};
    else if(type==='error')data={code:'engine_missing',message:'Binaire QA fictif absent'};
    return {...event(agent,type,data,p?.id??null),seq:i+1,t};
  });
}

test('recorded startup burst of eight places and three readers starts visits before discovery ends', () => {
  const world = new Monde(cityFixture()), trace = recordedStartupFixture(), departures = new Set();
  world.on((type,d) => {if(type==='go')departures.add(d.a.id);});
  let index=0;
  for(let t=0;t<30;t+=.05){while(index<trace.length&&trace[index].t<=t)world.push(trace[index++]);world.update(.05);}
  assert.equal(world.introDone,true);assert.equal(world.teamSent,true);
  assert.equal(world.places.size,8);assert.equal([...world.places.values()].filter(p=>p.revealed).length,8);
  assert.equal([...world.places.values()].filter(p=>p.read).length,2);
  assert.deepEqual(departures,new Set(['lecteur-1','lecteur-2','lecteur-3']));
  assert.ok(world.scan,'the discovery scan is still active; no scout.done was needed');
});

test('cold reload followed by resume finishes old pending visits and retries writing without resetting the world', () => {
  const world = new Monde(cityFixture());
  for(const e of recordedStartupFixture())world.push(e);
  advance(world,30);
  world.push(event('chef','resume',{objectif_contacts:60,objectif_mails:60,commerces_conserves:8}));
  for(const [reader,index]of [[1,1],[2,3],[3,5],[1,6],[2,7],[3,8]]){
    const id=`trace-${index}`;
    world.push(event(`lecteur-${reader}`,'start',{name:'Commerce QA'},id));
    world.push(event(`lecteur-${reader}`,'done',{score:75,retenu:true,email:'contact@fixture.example',raisons:[]},id));
  }
  world.push(event('redacteur-1','start',{name:'Commerce QA'},'trace-2'));
  world.push(event('redacteur-1','done',{objet:'Objet QA fictif',mail:'Brouillon QA fictif',to:'contact@fixture.example'},'trace-2'));
  advance(world,45);
  assert.equal(world.places.size,8);assert.equal([...world.places.values()].filter(p=>p.read).length,8);
  assert.equal(world.place('trace-2').mail,'Brouillon QA fictif');assert.equal(world.teamSent,true);
  assert.ok([...world.actors.values()].every(a=>Number.isFinite(a.x)&&Number.isFinite(a.y)));
});
