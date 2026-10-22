import test from 'node:test';
import assert from 'node:assert/strict';
import {patrolAt,directionBetween} from '../site/motion.js';
test('facing follows the actual forward and return movement in all four directions',()=>{
  for(const to of [[126,0],[-126,0],[0,84],[0,-84]]){
    const route={from:[0,0],to,seconds:6,pause:1};
    for(let time=.1;time<14;time+=.05){
      const a=patrolAt(route,time),b=patrolAt(route,time+.001);
      if(a.walking&&b.walking)assert.equal(a.direction,directionBetween([a.x,a.y],[b.x,b.y]));
    }
  }
});
test('arrival stops before turning; departure faces the next destination',()=>{
  const route={from:[0,0],to:[126,0],seconds:6,pause:1};
  assert.deepEqual(patrolAt(route,6.2),{x:126,y:0,direction:'right',walking:false,distance:126});
  assert.equal(patrolAt(route,6.8).direction,'left');
  assert.equal(patrolAt(route,6.8).walking,false);
  assert.equal(patrolAt(route,7.1).direction,'left');
  assert.equal(patrolAt(route,7.1).walking,true);
  assert.equal(patrolAt(route,0).x,patrolAt(route,14).x);
});
