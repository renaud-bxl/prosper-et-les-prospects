/*
 * Smooth illustrated people, adapted from Oscar et les agents / public/pixel-world.js.
 * MIT License — Copyright (c) 2026 Renaud
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions: The above copyright notice and this
 * permission notice shall be included in all copies or substantial portions of
 * the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO
 * EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
 * OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
 * ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 */

export const CHARACTERS = Object.freeze({
  prosper: Object.freeze({ id: 'prosper', name: 'Prosper', role: 'chef', skin: '#e8b993', blush: '#cf927c', hair: '#5b514c', hairLight: '#aaa394', style: 'parted', jacket: '#3e5969', shirt: '#eee6d4', trousers: '#56685f', shoes: '#394c49', accent: '#a9cbbb', wash: '#e5eee7', beard: true, phase: 0 }),
  leo: Object.freeze({ id: 'leo', name: 'Léo', role: 'eclaireur', skin: '#dca783', blush: '#bd7f69', hair: '#594d43', hairLight: '#8b7159', style: 'beanie', jacket: '#7c9c8b', shirt: '#f4e5c5', trousers: '#566976', shoes: '#495951', accent: '#dab984', wash: '#f3e9d5', satchel: true, phase: .6 }),
  hugo: Object.freeze({ id: 'hugo', name: 'Hugo', role: 'lecteur', skin: '#bb896b', blush: '#a86c5d', hair: '#394440', hairLight: '#667266', style: 'crop', jacket: '#89aabd', shirt: '#f2e8d6', trousers: '#5b6a60', shoes: '#3c514a', accent: '#a9c6cd', wash: '#e2edf2', glasses: true, beard: true, phase: 1.2 }),
  zoe: Object.freeze({ id: 'zoe', name: 'Zoé', role: 'lecteur', skin: '#edbf9d', blush: '#d89383', hair: '#8b674f', hairLight: '#b88d6e', style: 'bun', jacket: '#d7a495', shirt: '#fff0dd', trousers: '#77836c', shoes: '#596b5b', accent: '#d6c099', wash: '#f4e5df', glasses: true, phase: 1.8 }),
  iris: Object.freeze({ id: 'iris', name: 'Iris', role: 'lecteur', skin: '#9f7059', blush: '#8c564b', hair: '#3d3637', hairLight: '#675249', style: 'curls', jacket: '#b8acc9', shirt: '#f3e6d6', trousers: '#67766c', shoes: '#45564e', accent: '#dfbf91', wash: '#ece5f2', earrings: true, phase: 2.4 }),
  malo: Object.freeze({ id: 'malo', name: 'Malo', role: 'redacteur', skin: '#ddb08f', blush: '#c78973', hair: '#60534b', hairLight: '#927866', style: 'sweep', jacket: '#9fbabd', shirt: '#e9dfcb', trousers: '#6b6c68', shoes: '#4b5750', accent: '#d8b989', wash: '#e4eeeb', glasses: true, phase: 3 }),
  nina: Object.freeze({ id: 'nina', name: 'Nina', role: 'redacteur', skin: '#f0c9a8', blush: '#d99480', hair: '#a56c4b', hairLight: '#c48d62', style: 'ponytail', jacket: '#a9c2aa', shirt: '#f6eddb', trousers: '#718397', shoes: '#4e5b61', accent: '#d5a19b', wash: '#e9eee2', earrings: true, pencil: true, phase: 3.6 }),
});
const ALIASES = { chef: 'prosper', eclaireur: 'leo', 'lecteur-1': 'hugo', 'lecteur-2': 'zoe', 'lecteur-3': 'iris', 'redacteur-1': 'malo', 'redacteur-2': 'nina' };
const DEFAULTS = { chef: 'prosper', eclaireur: 'leo', lecteur: 'hugo', redacteur: 'malo' };
const keyOf = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

export function characterFor(role, identity = {}) {
  const options = typeof identity === 'object' && identity ? identity : { name: identity };
  for (const candidate of [options.identity, options.name, options.id]) {
    const key = keyOf(candidate);
    if (CHARACTERS[key]) return CHARACTERS[key];
    if (ALIASES[key]) return CHARACTERS[ALIASES[key]];
  }
  return CHARACTERS[DEFAULTS[role] ?? 'hugo'];
}

/** Twelve phases keep movement smooth and the generated-canvas cache bounded. */
export function poseFor(pose, frame = 0, time, offset = 0) {
  const tick = Number.isFinite(time) ? ((Math.floor(time * (pose === 'walk' ? 12 : 6) + offset) % 12) + 12) % 12
    : ((Math.floor(Number(frame) || 0) % 4) + 4) % 4 * 3;
  const phase = tick * Math.PI / 6;
  const walking = pose === 'walk';
  const step = walking ? Math.sin(phase) : 0;
  const bob = walking ? Math.abs(step) * 1.5 : pose === 'cheer' ? Math.max(0, Math.sin(phase)) * 4
    : pose === 'fly' ? Math.sin(phase) * 1.2 : Math.sin(phase) * .6;
  return { tick, phase, step, bob };
}

const oval = (g, x, y, rx, ry, fill) => { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fillStyle = fill; g.fill(); };
const rounded = (g, x, y, w, h, r, fill, stroke) => {
  g.beginPath(); g.roundRect(x, y, w, h, r); if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1; g.stroke(); }
};
const limb = (g, x1, y1, x2, y2, color, width = 5) => {
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.lineWidth = width; g.lineCap = 'round'; g.strokeStyle = color; g.stroke();
};
const curve = (g, color, width, ...points) => {
  g.beginPath(); g.moveTo(points[0], points[1]); g.quadraticCurveTo(...points.slice(2)); g.strokeStyle = color; g.lineWidth = width; g.lineCap = 'round'; g.stroke();
};

function hairBack(g, person) {
  const p = person;
  if (p.style === 'bun') { oval(g, -2, -57, 15.5, 17, p.hair); oval(g, -10, -72, 8, 7, p.hair); oval(g, -12, -74, 3.5, 2, p.hairLight); }
  if (p.style === 'ponytail') {
    g.beginPath(); g.moveTo(8, -64); g.bezierCurveTo(28, -65, 24, -44, 16, -37); g.quadraticCurveTo(21, -51, 9, -52); g.fillStyle = p.hair; g.fill();
    rounded(g, 12, -63, 7, 4, 2, p.accent);
  }
  if (p.style === 'curls') for (const [x, y, r] of [[-13,-58,7],[-11,-67,8],[-3,-72,8],[6,-71,8],[13,-64,8],[14,-53,7],[-12,-49,7]]) oval(g, x, y, r, r, p.hair);
}

function hairFront(g, p, back) {
  if (p.style === 'beanie') {
    if(back) { oval(g,0,-55,13,13,p.hair); oval(g,0,-45,10,5,p.hair); }
    g.beginPath(); g.moveTo(-15,-58); g.bezierCurveTo(-17,-80,15,-81,16,-58); g.closePath(); g.fillStyle = p.accent; g.fill();
    rounded(g,-16,-64,33,8,3,'#c4a374');
    for (let x=-11;x<16;x+=5) limb(g,x,-68,x,-72,'#b5946470',1.2);
    rounded(g,7,-62,5,4,1.2,'#eee4ca'); return;
  }
  if (back) { oval(g,0,-56,14,15,p.hair); oval(g,0,-46,12.5,7,p.hair); return; }
  g.beginPath();
  if (p.style === 'crop') { g.moveTo(-14,-55); g.bezierCurveTo(-17,-75,15,-76,14,-55); g.lineTo(10,-64); g.quadraticCurveTo(0,-68,-11,-62); }
  else if (p.style === 'curls') {
    for (const [x,y,r] of [[-12,-63,6],[-5,-68,6],[3,-69,6],[11,-64,6]]) oval(g,x,y,r,r,p.hair);
    return;
  } else { g.moveTo(-14,-54); g.bezierCurveTo(-19,-77,11,-79,15,-60); g.quadraticCurveTo(8,-65,3,-64); g.bezierCurveTo(-5,-58,-9,-63,-12,-53); }
  g.closePath(); g.fillStyle=p.hair; g.fill();
  if (p.style === 'parted') { curve(g,p.hairLight,2,-11,-65,-6,-71,2,-70); limb(g,11,-60,12,-54,p.hairLight,2); }
  else if (p.style === 'sweep' || p.style === 'ponytail') curve(g,p.hairLight,1.6,-10,-66,-2,-72,7,-68);
}

// A single right-facing profile is mirrored with the entire body for the left view.
function profileFace(g, p, { eyes, pose, phase }) {
  if (p.style==='ponytail') {
    g.beginPath(); g.moveTo(-10,-64); g.bezierCurveTo(-29,-66,-26,-43,-17,-37); g.quadraticCurveTo(-19,-51,-10,-52); g.fillStyle=p.hair; g.fill();
    rounded(g,-20,-63,7,4,2,p.accent);
  }
  if (p.style==='bun') { oval(g,-12,-70,8,8,p.hair); oval(g,-14,-73,3.5,2,p.hairLight); }
  if (p.style==='curls') for (const [x,y,r] of [[-12,-50,6],[-14,-59,7],[-10,-68,7],[-2,-73,7],[6,-70,7]]) oval(g,x,y,r,r,p.hair);
  rounded(g,-4,-45,8,11,3,p.skin);
  g.beginPath(); g.moveTo(-11,-62); g.bezierCurveTo(-8,-73,8,-73,12,-62);
  g.quadraticCurveTo(12,-58,11,-55); g.lineTo(16,-51); g.quadraticCurveTo(18,-49,12,-48);
  g.quadraticCurveTo(14,-44,10,-43); g.quadraticCurveTo(9,-39,3,-40); g.bezierCurveTo(-9,-40,-13,-49,-11,-62);
  g.closePath(); g.fillStyle=p.skin; g.fill();
  oval(g,6,-47.5,3.2,1.6,`${p.blush}65`);
  if (p.beard) {
    g.beginPath(); g.moveTo(-4,-48); g.quadraticCurveTo(3,-43,12,-47); g.quadraticCurveTo(13,-40,4,-39.5); g.quadraticCurveTo(-3,-41,-4,-48); g.fillStyle=`${p.hair}85`; g.fill();
  }
  if (eyes==='blink') curve(g,'#43574c',1.5,6.5,-54,9,-53,11,-54);
  else if (eyes==='happy') curve(g,'#43574c',1.5,6.5,-54,9,-57,11,-54);
  else { oval(g,9,-54.5,1.8,2.5,'#344b43'); oval(g,9.4,-55.3,.6,.8,'#fffaf0'); }
  curve(g,p.hair,1.2,6,-59.5,8.5,-60.5,11,-59.5);
  if (pose==='speak'||eyes==='talk') oval(g,11,-44.3,1.6,1+Math.abs(Math.sin(phase)),'#925c4b');
  else curve(g,'#925c4b',1.2,9,-44.7,11,-44,12.4,-45);
  // Hair follows the back of the skull, leaving the nose, chin and one eye clear.
  if (p.style==='beanie') {
    g.beginPath(); g.moveTo(-13,-58); g.bezierCurveTo(-18,-79,10,-81,13,-60); g.closePath(); g.fillStyle=p.accent; g.fill();
    rounded(g,-14,-64,28,7,3,'#c4a374');
    for(let x=-10;x<11;x+=5) limb(g,x,-68,x,-72,'#b5946470',1.2);
    rounded(g,5,-62,5,4,1.2,'#eee4ca');
  } else {
    g.beginPath(); g.moveTo(-11,-47); g.bezierCurveTo(-18,-58,-13,-75,0,-75); g.quadraticCurveTo(13,-75,13,-61);
    if(p.style==='crop') { g.lineTo(8,-65); g.quadraticCurveTo(1,-66,-3,-60); }
    else { g.quadraticCurveTo(6,-63,3,-66); g.quadraticCurveTo(-1,-61,-5,-60); }
    g.lineTo(-6,-48); g.closePath(); g.fillStyle=p.hair; g.fill();
    if(p.style!=='curls') curve(g,p.hairLight,1.5,-10,-64,-5,-72,4,-70);
    else for(const [x,y,r]of [[-9,-65,5],[-3,-70,5],[4,-70,5],[9,-65,5]]) oval(g,x,y,r,r,p.hair);
  }
  oval(g,-5,-52,3.2,4,p.skin); curve(g,`${p.blush}a0`,1,-6,-53,-3,-54,-4,-50);
  if(p.glasses) {
    g.beginPath(); g.ellipse(8.5,-54.5,4.5,4.2,0,0,Math.PI*2); g.strokeStyle='#536e64'; g.lineWidth=1.5; g.stroke();
    limb(g,-4,-54.5,4,-55,'#536e64',1.4); limb(g,12.5,-54.5,14,-53.5,'#536e64',1.2);
  }
  if(p.earrings) oval(g,-5,-47,1.8,2.4,p.accent);
  if(p.pencil) { limb(g,-10,-66,-12,-52,'#d8b46b',2.3); limb(g,-10,-66,-10.4,-63,'#d69a96',2.7); }
}

function face(g, p, { direction, eyes, pose, phase }) {
  if(direction==='left'||direction==='right') { profileFace(g,p,{eyes,pose,phase}); return; }
  const back=direction==='up', dx=eyes==='left'?-1.7:eyes==='right'?1.7:0;
  hairBack(g,p);
  oval(g,-13,-53,3,4,p.skin); oval(g,13,-53,3,4,p.skin);
  rounded(g,-4,-44,8,10,3,p.skin);
  const skin=g.createLinearGradient(-12,-65,12,-40); skin.addColorStop(0,p.skin); skin.addColorStop(1,p.skin);
  oval(g,0,-55,14,16,skin);
  if (!back) {
    oval(g,-9+dx,-48,3.5,1.7,`${p.blush}65`); oval(g,9+dx,-48,3.5,1.7,`${p.blush}65`);
    for (const sx of [-5.3,5.3]) {
      if (eyes==='blink') curve(g,'#43574c',1.6,sx+dx-2,-54,sx+dx,-53,sx+dx+2,-54);
      else if (eyes==='happy') curve(g,'#43574c',1.6,sx+dx-2,-53,sx+dx,-57,sx+dx+2,-53);
      else {
        oval(g,sx+dx,-54,2.1,2.8,'#344b43'); oval(g,sx+dx-.5,-55,.7,.9,'#fffaf0');
        if (p.earrings) limb(g,sx+dx-2,-57,sx+dx+1,-57.5,p.hair,1);
      }
      curve(g,p.hair,1.1,sx+dx-2.5,-60,sx+dx,-61,sx+dx+2.5,-60);
    }
    curve(g,`${p.blush}a0`,1.1,dx,-53,dx+2,-49,dx-1,-49);
    if (p.beard) {
      g.beginPath(); g.moveTo(-10,-46); g.quadraticCurveTo(0,-34,11,-46); g.quadraticCurveTo(1,-40,-10,-46); g.fillStyle=`${p.hair}70`; g.fill();
    }
    if (pose==='speak' || eyes==='talk') oval(g,dx,-44,2.5,1.3+Math.abs(Math.sin(phase))*1.4,'#925c4b');
    else curve(g,'#925c4b',1.5,-3+dx,-45,dx,-41.5,4+dx,-45);
    if (p.glasses) {
      for (const sx of [-6.2,6.2]) { g.beginPath(); g.ellipse(sx+dx,-54,5.3,4.3,0,0,Math.PI*2); g.strokeStyle='#536e64'; g.lineWidth=1.5; g.stroke(); }
      limb(g,-1+dx,-54,1+dx,-54,'#536e64',1.4);
    }
    if (p.earrings) { oval(g,-14,-48,1.8,2.4,p.accent); oval(g,14,-48,1.8,2.4,p.accent); }
  }
  hairFront(g,p,back);
  if (p.pencil && !back) {
    limb(g,14,-66,16,-53,'#d8b46b',2.3); limb(g,14,-66,14.4,-63,'#d69a96',2.7); limb(g,16,-53,16.5,-51,'#52655c',1.3);
  }
}

export function drawHuman(g, p, motion = {}) {
  const { pose='stand', direction='down', eyes='open', step=0, bob=0, phase=0 }=motion;
  const back=direction==='up', side=direction==='left'||direction==='right', walking=pose==='walk';
  const stride=walking?step:0, bodyBob=walking?(1-Math.abs(stride))*.8:bob;
  g.save();
  if (direction==='left') g.scale(-1,1);
  // Feet stay relative to the ground; only hips, shoulders and head bob.
  const legs=[-1,1].map(sign=>{
    const swing=sign*stride, lift=walking?Math.max(0,sign*Math.cos(phase)):0;
    return side ? {sign,hipX:sign*1.7,x:sign*1.7+swing*6,y:-3.8-lift*3.2,lift}
      : {sign,hipX:sign*5.7,x:sign*5.7+swing*.4,y:-3.8+swing*(back?-2.8:2.8)-lift*1.5,lift};
  });
  const drawLeg=leg=>{
    const {hipX,x,y,lift,sign}=leg;
    const kneeX=(hipX+x)*.5+(side?lift*1.7:sign*.4), kneeY=(-19-bodyBob+y)*.5+lift*.7;
    limb(g,hipX,-19-bodyBob,kneeX,kneeY,p.trousers,side?6.5:6.8);
    limb(g,kneeX,kneeY,x,y-1.3,p.trousers,side?5.5:6);
    if(side) {
      rounded(g,x-3.7,y-2,11,5,2.5,p.shoes);
      limb(g,x-1.8,y+1.4,x+5.5,y+1.4,'#ffffff25',1);
    } else {
      rounded(g,x-4.4,y-1.6,8.8,5.2,2.6,p.shoes);
      if(back) limb(g,x-2.8,y-.1,x+2.8,y-.1,'#ffffff30',1.2);
      else curve(g,'#ffffff25',1,x-2.6,y+1.8,x,y+2.5,x+2.6,y+1.8);
    }
  };
  const sideHand=(near)=>{
    const sign=near?1:-1;
    if(['carry','read','type'].includes(pose)) return [near?11:7,-25+Math.sin(phase)*.5];
    if(pose==='think'&&near) return [11,-45];
    if(['wave','raise','cheer'].includes(pose)&&near) return [15+Math.sin(phase)*2,-61];
    if(pose==='cheer'&&!near) return [7,-57];
    return [sign*1.8-sign*stride*6.2,-20.5+Math.abs(stride)*.5];
  };
  const drawSideArm=near=>{
    const [hx,hy]=sideHand(near), sx=near?2.5:-2.5;
    const elbowX=hy<-40?10:(sx+hx)*.5-1.8, elbowY=hy<-40?-43:-28;
    limb(g,sx,-35,elbowX,elbowY,p.jacket,near?7:6);
    limb(g,elbowX,elbowY,hx,hy,p.skin,near?5.5:4.7);
    oval(g,hx,hy,near?3.5:3,3.3,p.skin);
  };
  if(side) {
    drawLeg(legs[0]);
    g.save(); g.translate(0,-bodyBob); drawSideArm(false); g.restore();
    drawLeg(legs[1]);
  } else for(const leg of legs.sort((a,b)=>a.y-b.y)) drawLeg(leg);
  g.translate(0,-bodyBob);
  const shirt=g.createLinearGradient(-14,-40,15,-17); shirt.addColorStop(0,p.jacket); shirt.addColorStop(1,p.jacket);
  rounded(g,side?-10.5:-15,-41,side?22:30,25,[10,10,7,7],shirt);
  if(side) {
    // The jacket opening is at the leading edge of a profile, not on its centre.
    curve(g,p.shirt,3,8,-40,7,-32,9,-26);
    if(p.id==='prosper') { rounded(g,-6,-41,17,6,2.5,p.accent); rounded(g,5,-37,5,11,2,'#94b49d'); }
  } else if (!back) {
    g.beginPath(); g.moveTo(-6,-41); g.lineTo(0,-27); g.lineTo(6,-41); g.closePath(); g.fillStyle=p.shirt; g.fill();
    limb(g,0,-27,0,-19,'#ffffff30',1.2);
    if (p.id==='prosper') { rounded(g,-10,-40,20,7,3,p.accent); limb(g,-7,-36,6,-31,'#e6ead7',2); rounded(g,0,-35,6,10,2,'#94b49d'); }
    else { oval(g,9,-30,1,1,p.accent); oval(g,9,-24,1,1,p.accent); }
  } else limb(g,-8,-35,7,-35,'#ffffff25',1.2);
  let hands=[[-19,-20+stride*1.8],[19,-20-stride*1.8]];
  if (['carry','read','type'].includes(pose)) hands=[[-10,-25+Math.sin(phase)*.7],[10,-25-Math.sin(phase)*.7]];
  if (pose==='think') hands=[[-19,-20],[9,-45]];
  if (pose==='wave'||pose==='raise') hands=[[-19,-20],[26+Math.sin(phase)*2,-61]];
  if (pose==='cheer') hands=[[-26,-58+Math.sin(phase)*2],[26,-58-Math.sin(phase)*2]];
  if (pose==='fly') hands=[[-23,-24],[23,-29]]; // léger déplacement, jamais d'hélice ni de pièce mécanique
  if(side) drawSideArm(true);
  else for (let i=0;i<2;i++) {
    const sign=i?1:-1,[hx,hy]=hands[i], elbowX=hy<-40?sign*24:sign*17, elbowY=hy<-40?-43:-30;
    limb(g,sign*12,-35,elbowX,elbowY,p.jacket,7);
    limb(g,elbowX,elbowY,hx,hy,p.skin,5.5);
    oval(g,hx,hy,3.7,3.5,p.skin);
  }
  if (p.satchel) {
    if(side) {
      curve(g,'#9c7b5c',2.7,1,-39,-9,-33,-9,-22); rounded(g,-15,-24,11,15,4,'#b18e69'); rounded(g,-15,-24,11,5,2.5,'#c5a37b'); oval(g,-9,-18,1.2,1.2,'#f0dab2');
    } else {
      limb(g,-10,-40,13,-18,'#9c7b5c',3); rounded(g,9,-25,13,16,4,'#b18e69');
      if(!back) { rounded(g,9,-25,13,6,3,'#c5a37b'); oval(g,15,-18,1.3,1.3,'#f0dab2'); }
    }
  }
  face(g,p,{direction,eyes,pose,phase});
  if (['carry','read','type'].includes(pose) && !back) {
    if (pose==='type') {
      rounded(g,-18,-27,36,10,3,'#e5eadc','#a7b7a6');
      for(let row=0;row<2;row++)for(let col=0;col<6;col++)rounded(g,-14+col*5,-25+row*3,3,1.8,.7,(col+row+Math.round(phase))%6===0?'#91b0a1':'#c0cdbd');
    } else if (pose==='read') {
      rounded(g,-15,-29,30,17,2.8,'#f7ecd6','#cbb99e'); limb(g,0,-28,0,-13,'#c1b198',1);
      for (const x of [-10,4]) for (let row=0;row<3;row++) limb(g,x,-25+row*3,x+6,-25+row*3,'#a5b49d',1);
    } else {
      rounded(g,-16,-28,32,18,3,'#fff7e8','#c8bfa9');
      limb(g,-15,-27,0,-18,'#c8bfa9',1.1); limb(g,0,-18,15,-27,'#c8bfa9',1.1);
      oval(g,8,-16,2,2,p.accent);
    }
    for (const [hx,hy] of hands) oval(g,hx,hy+1,3.5,2.8,p.skin);
  }
  g.restore();
}
