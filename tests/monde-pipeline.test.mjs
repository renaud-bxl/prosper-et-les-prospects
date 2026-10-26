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
