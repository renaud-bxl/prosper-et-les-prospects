import test from 'node:test';
import assert from 'node:assert/strict';
import {project,unproject,validCoordinates,fitBounds} from '../web/src/results-map.js';
test('Web Mercator preserves Belgian, Dutch and Luxembourg coordinates',()=>{
  for(const [lat,lon]of [[50.8466,4.3528],[52.3676,4.9041],[49.6116,6.1319],[0,0],[-60,-120]]){
    const [rlat,rlon]=unproject(...project(lat,lon));assert.ok(Math.abs(lat-rlat)<1e-8);assert.ok(Math.abs(lon-rlon)<1e-8);
  }
});
test('latitude clamping remains finite at the poles',()=>{for(const lat of [-90,90])assert.ok(project(lat,0).every(Number.isFinite));});
test('only genuine finite coordinates are accepted',()=>{
  for(const p of [{lat:50,lon:4},{lat:'50.2',lon:'4.3'},{lat:0,lon:0}])assert.equal(validCoordinates(p),true);
  for(const p of [{},{lat:null,lon:4},{lat:'',lon:4},{lat:51,lon:undefined},{lat:91,lon:4},{lat:NaN,lon:4},{lat:50,lon:181},{lat:true,lon:4},{lat:[],lon:4}])assert.equal(validCoordinates(p),false);
});
test('fit bounds contains every commerce with padding in a 500 by 280 map',()=>{
 const points=[[50.8466,4.3528],[50.88,4.43],[50.82,4.28]].map(([a,b])=>project(a,b));
 const cam=fitBounds(points,500,280),k=256*2**cam.zoom;
 for(const [x,y]of points){const sx=(x-cam.x)*k+250,sy=(y-cam.y)*k+140;assert.ok(sx>=41.99&&sx<=458.01);assert.ok(sy>=41.99&&sy<=238.01);}
});
test('single-point selection and empty bounds are stable',()=>{
 const point=project(50.8466,4.3528),cam=fitBounds([point,point],500,280);assert.equal(cam.x,point[0]);assert.equal(cam.y,point[1]);assert.equal(cam.zoom,16.5);
 const fallback=fitBounds([],0,0);assert.ok(Object.values(fallback).every(Number.isFinite));
});
