// Smooth illustrated scenery, using the same real OSM geometry and spatial index.
// Cached vector-drawn tiles keep camera movement inexpensive; no pixel filters.
const caches = new WeakMap();
const CHUNK = 256;
const PALETTES = {
  jour: {ground:'#e8e5dc',walk:'#ede8dc',road:'#a2acb3',edge:'#c9d0ce',mark:'#f9f5e8',water:'#a4cbd4',green:'#b6cfb3',wood:'#a1c0a4',sand:'#ead7b5',roof:['#b3c0c7','#d0b1a2','#a8b9bc','#c6c8bf','#c4b3a3','#b7b9c6','#a1b3bb'],wall:['#f1dac1','#eee0cd','#e1c7b6','#d4ddd1','#f0d6c8','#e1d8c3'],line:'#7b9093',glass:'#a6c9d0',lit:'#f8e5ac',tree:'#89b49d',treeHi:'#abcab3',trunk:'#b09276'},
  soir: {ground:'#c2c4bb',walk:'#d7ccb7',road:'#7f8b92',edge:'#bac3be',mark:'#e8e3d1',water:'#7ea9bb',green:'#9cb69d',wood:'#80a18c',sand:'#cbb895',roof:['#92a5ae','#bc9687','#8a9fa7','#a5ada4','#af9686','#9f9eb3','#8a9da6'],wall:['#e0bea1','#dbccaf','#cda890','#b8c4b2','#e1bda6','#d0bea0'],line:'#687f85',glass:'#85afbc',lit:'#ffe1a1',tree:'#6c9b85',treeHi:'#90b49a',trunk:'#92765b'},
  nuit: {ground:'#243a42',walk:'#304852',road:'#233843',edge:'#425c65',mark:'#748b90',water:'#224557',green:'#2e5149',wood:'#25463f',sand:'#5c5b4c',roof:['#3c5664','#66544e','#405d66','#4b6265','#68594f','#4b5671','#3d5361'],wall:['#6a726a','#65766d','#736c60','#4b6a60','#736e67','#636b5b'],line:'#263f49',glass:'#324d60',lit:'#f3c47d',tree:'#315f50',treeHi:'#437661',trunk:'#5c5d4a'},
};

function polygon(g,rings,dy=0) {
  g.beginPath();
  for(const ring of rings) {
    if(!ring.length)continue;
    g.moveTo(ring[0][0],ring[0][1]+dy);
    for(let i=1;i<ring.length;i++)g.lineTo(ring[i][0],ring[i][1]+dy);
    g.closePath();
  }
}
function line(g,points) {
  if(points.length<2)return;
  g.beginPath();g.moveTo(...points[0]);
  for(let i=1;i<points.length;i++)g.lineTo(...points[i]);
}
function ellipse(g,x,y,rx,ry,color) {g.fillStyle=color;g.beginPath();g.ellipse(x,y,rx,ry,0,0,Math.PI*2);g.fill();}

function renderTile(city,cx,cy,mpp,tod) {
  const p=PALETTES[tod] ?? PALETTES.jour;
  const size=CHUNK*mpp, x=cx*size,y=cy*size, margin=24;
  // Two samples per output pixel, with room for facades crossing tile edges.
  const scale=2/mpp, padding=Math.ceil(margin*scale);
  const canvas=document.createElement('canvas');
  canvas.width=CHUNK*2+padding*2;canvas.height=CHUNK*2+padding*2;
  const g=canvas.getContext('2d');
  g.scale(scale,scale);g.translate(-x+margin,-y+margin);
  g.fillStyle=p.ground;g.fillRect(x-margin,y-margin,size+margin*2,size+margin*2);
  g.lineCap='round';g.lineJoin='round';
  const bounds=[x-margin,y-margin,x+size+margin,y+size+margin];
  const areas=[...city.query('a',...bounds)].map(i=>city.areas[i]).sort((a,b)=>a.kind-b.kind);
  const colors={1:p.green,2:p.wood,3:p.sand,4:p.walk,5:p.edge,6:p.wood,7:p.sand,8:p.green,9:p.sand,10:p.walk,11:p.water,12:p.water,13:p.walk};
  for(const area of areas) {polygon(g,area.rings);g.fillStyle=colors[area.kind]??p.ground;g.fill('evenodd');}
  const roads=[...city.query('r',...bounds)].map(i=>city.roads[i]).sort((a,b)=>a.rank-b.rank);
  for(const road of roads) {line(g,road.pts);g.strokeStyle=p.walk;g.lineWidth=road.w+4;g.stroke();line(g,road.pts);g.strokeStyle=road.pave?p.walk:p.road;g.lineWidth=road.w;g.stroke();}
  if(mpp<=1)for(const road of roads)if(road.w>=10&&!road.pave) {line(g,road.pts);g.strokeStyle=p.mark;g.lineWidth=.35;g.setLineDash([3.5,5]);g.stroke();g.setLineDash([]);}
  for(const i of city.query('l',...bounds)) {const rail=city.rails[i];line(g,rail.pts);g.strokeStyle=p.line;g.lineWidth=rail.tram?.35:.65;g.stroke();}
  const objects=[...city.query('b',...bounds)].map(i=>({b:city.blist[i],y:city.blist[i].maxy}));
  if(mpp<=2)for(const i of city.query('t',...bounds)){const tree=city.trees[i];objects.push({tree,y:tree.y});}
  objects.sort((a,b)=>a.y-b.y);
  for(const object of objects) {
    if(object.tree){const t=object.tree,r=t.r;
      ellipse(g,t.x+1,t.y+1,r*1.2,r*.5,'#243f3320');
      g.strokeStyle=p.trunk;g.lineWidth=.8;g.beginPath();g.moveTo(t.x,t.y);g.lineTo(t.x,t.y-r*1.7);g.stroke();
      ellipse(g,t.x,t.y-r*1.5,r*.95,r*1.2,p.tree);ellipse(g,t.x-r*.25,t.y-r*1.8,r*.65,r*.8,p.treeHi);continue;
    }
    const b=object.b;
    if(mpp>=4&&Math.max(b.maxx-b.minx,b.maxy-b.miny)<mpp*.7)continue;
    if(mpp>=2){for(const rings of b.parts){polygon(g,rings);g.fillStyle=p.roof[b.roof%p.roof.length];g.fill('evenodd');}continue;}
    const h=Math.max(1.5,Math.min(18,b.h*.45));
    const wall=p.wall[b.tone%p.wall.length],roof=p.roof[b.roof%p.roof.length];
    for(const rings of b.parts) {
      g.save();g.translate(h*.15,h*.25);polygon(g,rings);g.fillStyle='#24384620';g.fill('evenodd');g.restore();
      for(const ring of rings)for(let i=1;i<ring.length;i++){
        const [ax,ay]=ring[i-1],[bx,by]=ring[i];
        g.beginPath();g.moveTo(ax,ay-h);g.lineTo(bx,by-h);g.lineTo(bx,by);g.lineTo(ax,ay);g.closePath();
        g.fillStyle=wall;g.fill();g.strokeStyle=p.line+'40';g.lineWidth=.25;g.stroke();
        // South-facing frontage, simplified at distant scales.
        const length=Math.hypot(bx-ax,by-ay);
        if(mpp<=1 && Math.abs(bx-ax)>Math.abs(by-ay)*1.5 && (ay+by)/2>b.miny+(b.maxy-b.miny)*.45 && length>4){
          const columns=Math.min(16,Math.floor(length/3.8)),rows=Math.max(1,Math.min(5,Math.floor(h/3)));
          for(let col=0;col<columns;col++)for(let row=0;row<rows;row++){
            const u=(col+.5)/columns,wx=ax+(bx-ax)*u,wy=ay+(by-ay)*u-h+(row+.6)*h/rows;
            g.fillStyle=tod==='nuit'&&((b.seed+col*7+row*3)%5<2)?p.lit:p.glass;
            g.beginPath();g.roundRect(wx-.55,wy-.3,1.1,Math.min(1.2,h/rows*.45),.18);g.fill();
          }
        }
      }
      polygon(g,rings,-h);g.fillStyle=roof;g.fill('evenodd');g.strokeStyle=p.line+'80';g.lineWidth=.45;g.stroke();
      if(mpp<=.5 && b.maxx-b.minx>8 && b.maxy-b.miny>8){g.fillStyle=p.line+'22';g.beginPath();g.roundRect((b.minx+b.maxx)/2-1.8,(b.miny+b.maxy)/2-h-1,3.6,2,.45);g.fill();}
    }
  }
  return {canvas,padding};
}

export function drawIllustratedCity(g,city,cam,W,H,tod,maxNew=6) {
  let cache=caches.get(city);if(!cache){cache=new Map();caches.set(city,cache);}
  const z=cam.z,mpp=[.25,.5,1,2,4,8,16,32].find(value=>z*value>=.8)??32,size=CHUNK*mpp;
  const x0=cam.x-W/2/z,y0=cam.y-H/2/z,b=city.bounds;
  g.imageSmoothingEnabled=true;g.imageSmoothingQuality='high';
  let fresh=0,missing=0;const deadline=performance.now()+12;const visibleKeys=new Set();
  for(let cy=Math.floor(Math.max(y0,b.miny)/size);cy*size<Math.min(y0+H/z,b.maxy);cy++)for(let cx=Math.floor(Math.max(x0,b.minx)/size);cx*size<Math.min(x0+W/z,b.maxx);cx++){
    const key=`${tod}:${mpp}:${cx}:${cy}`;visibleKeys.add(key);
    let tile=cache.get(key);
    if(!tile){if(fresh>=maxNew||(fresh>0&&performance.now()>deadline)){missing++;continue;}tile=renderTile(city,cx,cy,mpp,tod);cache.set(key,tile);fresh++;}
    const sx=(cx*size-x0)*z,sy=(cy*size-y0)*z;
    g.drawImage(tile.canvas,tile.padding,tile.padding,CHUNK*2,CHUNK*2,sx,sy,size*z+.3,size*z+.3);
  }
  // Cap memory across camera zoom levels and the two themes.
  if(cache.size>96)for(const key of cache.keys()){if(cache.size<=96)break;if(!visibleKeys.has(key))cache.delete(key);}
  return {fresh,missing,illustrated:true};
}
