import test from 'node:test';
import assert from 'node:assert/strict';
import { Monde } from '../web/src/monde.js';
import { City, AREA } from '../web/src/ville.js';
import { QG } from '../web/src/sprites.js';

// Reference order and geometry of the original placement search. This provides
// an exact comparison rather than a timing assertion tied to a test machine.
function uncachedPlacement(city) {
  const W = QG.w * .5, D = QG.d * .5;
  const free = (cx, cy) => {
    for (let y = cy - D / 2 - 3; y <= cy + D / 2 + 26; y += 2) {
      for (let x = cx - W / 2 - 4; x <= cx + W / 2 + 4; x += 2) {
        if (city.buildingAt(x, y)) return false;
        if (y > cy + D / 2 + 1) continue;
        if (city.areaAt(x, y) >= 11) return false;
        const n = city.nearestRoad(x, y, 20, r => r.rank >= 3 && !r.pave);
        if (n && n.d < n.half + .6) return false;
      }
    }
    return Boolean(city.nearestRoad(cx, cy + D / 2 + 3, 26));
  };
  for (let r = 0; r <= 700; r += 7) {
    const steps = Math.max(1, Math.round(2 * Math.PI * r / 7));
    for (let k = 0; k < steps; k++) {
      const a = k / steps * Math.PI * 2;
      const x = Math.round(Math.cos(a) * r), y = Math.round(Math.sin(a) * r);
      if (free(x, y)) return [x, y];
    }
  }
  return [0, 0];
}
const rect = (x0, y0, x1, y1) => [[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]];
function cityFixture({ buildings = [], areas = [], roads = [] } = {}) {
  return new City({
    centre: [50.85, 4.35], radius: 220,
    bounds: { minx: -240, miny: -240, maxx: 240, maxy: 240 },
    buildings: new Map(buildings.map((ring,i) => [i,{ parts:[[ring]],h:10,kind:'house' }])),
    areas, roads: roads.map(r => ({ cls:'minor',rank:2,w:4,pave:false,bridge:false,...r })),
    rails: [], names: [], pois: [], realTrees: [[220,220]],
  });
}
function counted(city) {
  const calls = { buildingAt:0, areaAt:0, nearestRoad:0 };
  const wrapper = Object.create(city);
  for (const method of Object.keys(calls)) wrapper[method] = (...args) => {
    calls[method]++;
    return city[method](...args);
  };
  return { city:wrapper, calls };
}
function cachedPlacement(city) {
  return Monde.prototype.placeQG.call({ city, qgAt:(x,y) => [x,y] });
}

test('QG memoization preserves real polygon/road placement and reduces geometry queries', () => {
  const city = cityFixture({
    buildings: [rect(-35,-40,45,50), rect(110,80,145,130)],
    areas: [{ kind:AREA.water, rings:[rect(-200,50,0,130)] }],
    roads: [
      { rank:5,w:10,pts:[[70,-210],[70,210]] },
      { pts:[[-210,180],[210,180]] },
    ],
  });
  const before=counted(city), after=counted(city);
  const expected=uncachedPlacement(before.city);
  assert.notDeepEqual(expected,[0,0], 'the fixture must exercise the search past obstacles');
  assert.deepEqual(cachedPlacement(after.city),expected);
  for (const method of ['buildingAt','areaAt','nearestRoad']) {
    assert.ok(after.calls[method] < before.calls[method] / 2,
      `${method}: ${after.calls[method]} cached vs ${before.calls[method]} uncached`);
  }
});

test('QG forecourt still allows water/road tests to be skipped, but never buildings', () => {
  const road = { rank:5,w:8,pts:[[-100,30],[100,30]] };
  const areas = [{ kind:AREA.water, rings:[rect(-100,16,100,45)] }];
  const open=cityFixture({ roads:[road],areas });
  assert.deepEqual(cachedPlacement(open),[0,0]);
  const blocked=cityFixture({ roads:[road],areas,buildings:[rect(-2,28,2,34)] });
  const expected=uncachedPlacement(blocked);
  assert.notDeepEqual(expected,[0,0]);
  assert.deepEqual(cachedPlacement(blocked),expected);
});

test('QG memoization is local to each search', () => {
  let changed=false;
  const city={
    buildingAt:(x,y) => changed && x===-27 && y===-16 ? {} : null,
    areaAt:() => 0,
    nearestRoad:(x,y,max,filter) => filter ? null : {d:0,half:1},
  };
  assert.deepEqual(cachedPlacement(city),[0,0]);
  changed=true;
  assert.deepEqual(cachedPlacement(city),uncachedPlacement(city));
  assert.notDeepEqual(cachedPlacement(city),[0,0]);
});
