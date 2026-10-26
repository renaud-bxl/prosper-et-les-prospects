import test from 'node:test';
import assert from 'node:assert/strict';
import { City, inRings } from '../web/src/ville.js';

const bounds = (pts) => ({
  minx:Math.min(...pts.map(p=>p[0])),miny:Math.min(...pts.map(p=>p[1])),
  maxx:Math.max(...pts.map(p=>p[0])),maxy:Math.max(...pts.map(p=>p[1])),
});
const rect = (x0,y0,x1,y1) => [[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]];
function referenceNearest(city,x,y,maxD=60,filter=()=>true) {
  let best=null;
  for(const i of city.query('r',x-maxD,y-maxD,x+maxD,y+maxD)) {
    const road=city.roads[i]; if(!filter(road))continue;
    for(let k=0;k+1<road.pts.length;k++) {
      const [ax,ay]=road.pts[k],[bx,by]=road.pts[k+1];
      const dx=bx-ax,dy=by-ay,L2=dx*dx+dy*dy||1e-9;
      const t=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/L2));
      const qx=ax+t*dx,qy=ay+t*dy,d=Math.hypot(x-qx,y-qy);
      if(d<maxD&&(!best||d<best.d))best={d,x:qx,y:qy,road,half:road.w/2};
    }
  }
  return best;
}
function referenceBuilding(city,x,y) {
  for(const i of city.query('b',x,y,x,y)) {
    const b=city.blist[i];
    if(x<b.minx||x>b.maxx||y<b.miny||y>b.maxy)continue;
    for(const rings of b.parts)if(inRings(x,y,rings))return b;
  }
  return null;
}
function random(seed=405) {
  return () => { seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296; };
}

test('road bounds pruning matches original projections, filters and strict distance limits', () => {
  const rand=random(), roads=[];
  for(let i=0;i<90;i++) {
    const pts=[];
    for(let p=0;p<12;p++)pts.push([(rand()-.5)*1200,(rand()-.5)*1200]);
    roads.push({pts,bb:bounds(pts),rank:i%7,w:2+i%11,pave:i%3===0});
  }
  const city=Object.assign(Object.create(City.prototype),{
    roads,query:()=>new Set(roads.map((_,i)=>i)),
  });
  const filters=[()=>true,r=>r.rank>=3&&!r.pave,r=>r.rank===0];
  for(let i=0;i<800;i++) {
    const x=(rand()-.5)*1800,y=(rand()-.5)*1800,max=[.01,4,20,60,120][i%5],filter=filters[i%3];
    assert.deepEqual(city.nearestRoad(x,y,max,filter),referenceNearest(city,x,y,max,filter));
  }
});

test('road pruning preserves equal-distance first road, endpoints and zero-length segments', () => {
  const roads=[
    {pts:[[-10,1],[10,1]],w:2},
    {pts:[[-10,-1],[10,-1]],w:8},
    {pts:[[20,0],[20,0]],w:3},
  ];
  for(const r of roads)r.bb=bounds(r.pts);
  const city=Object.assign(Object.create(City.prototype),{roads,query:()=>new Set([0,1,2])});
  assert.equal(city.nearestRoad(0,0,2).road,roads[0]);
  assert.equal(city.nearestRoad(0,0,1),null,'strictly inside maxD, as before');
  for(const [x,y,d]of [[20,0,1],[10,1,1],[30,0,10],[30,0,10.000001],[0,2,0]]) {
    assert.deepEqual(city.nearestRoad(x,y,d),referenceNearest(city,x,y,d));
  }
});

test('building part bounds preserve holes, distant parts, boundaries and first identity', () => {
  const buildings=new Map([
    [1,{parts:[[rect(-20,-20,20,20),rect(-4,-4,4,4)],[rect(70,60,80,90)]],h:12,kind:'house'}],
    [2,{parts:[[rect(-18,-18,-8,-8)]],h:15,kind:'house'}],
  ]);
  const city=new City({centre:[50.85,4.35],radius:10,
    bounds:{minx:-100,miny:-100,maxx:100,maxy:100},
    buildings,roads:[],rails:[],areas:[],names:[],pois:[],realTrees:[],
  });
  const rand=random();
  const points=[[-20,-20],[-4,0],[4,0],[20,20],[0,0],[70,60],[80,90],[-10,-10]];
  for(let i=0;i<1200;i++)points.push([(rand()-.5)*220,(rand()-.5)*220]);
  for(const [x,y]of points)assert.equal(city.buildingAt(x,y),referenceBuilding(city,x,y));
  assert.equal(city.buildingAt(0,0),null,'a polygon hole remains empty');
  assert.equal(city.buildingAt(-10,-10),city.blist[0],'the first overlapping building keeps its identity');
  assert.equal(city.buildingAt(75,75),city.blist[0],'distant parts remain the same building');
});
