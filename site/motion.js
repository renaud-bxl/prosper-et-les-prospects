// Travel and facing share the same route. Pauses contain the turn, so nobody
// slides backwards or changes direction while their feet are still moving.
export function directionBetween(from,to){
  const dx=to[0]-from[0],dy=to[1]-from[1];
  return Math.abs(dx)>Math.abs(dy)?(dx>0?'right':'left'):(dy>0?'down':'up');
}
const ease=u=>(1-Math.cos(Math.PI*u))/2;
export function patrolAt(route,time){
  const {from,to,seconds=6,pause=1,offset=0}=route;
  const half=seconds+pause,cycle=half*2;
  const clock=((time+offset)%cycle+cycle)%cycle;
  const returning=clock>=half,local=clock%half;
  const start=returning?to:from,end=returning?from:to;
  const progress=local<seconds?ease(local/seconds):1;
  const walking=local>0&&local<seconds;
  const facing=local>=seconds+pause/2?directionBetween(end,start):directionBetween(start,end);
  const length=Math.hypot(to[0]-from[0],to[1]-from[1]);
  return{x:start[0]+(end[0]-start[0])*progress,y:start[1]+(end[1]-start[1])*progress,direction:facing,walking,distance:length*progress};
}
