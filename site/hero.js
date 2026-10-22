import {CHARACTERS,drawHuman,poseFor} from './assets/humans.js?v=forward-20261023';
import {patrolAt} from './motion.js';
const canvas=document.querySelector('#town-people'),g=canvas.getContext('2d');
const toggle=document.querySelector('#scene-toggle');
const grid=document.querySelector('#people-grid');
const people=Object.values(CHARACTERS);
const roles={fr:['Chef d’équipe','Éclaireur','Lecteur','Lectrice','Lectrice','Rédacteur','Rédactrice'],nl:['Teamleider','Verkenner','Onderzoeker','Onderzoeker','Onderzoeker','Schrijver','Schrijver'],en:['Team leader','Scout','Researcher','Researcher','Researcher','Writer','Writer']};
const labels={fr:{pause:'Pause animation',play:'Reprendre l’animation'},nl:{pause:'Animatie pauzeren',play:'Animatie hervatten'},en:{pause:'Pause animation',play:'Resume animation'}};
const lines={fr:['Une ville en tête ? On part ensemble.','Je repère les commerces de votre secteur.','Je relève les informations utiles.','Je vérifie les contacts publics.','Je lis les sites des commerces.','Je prépare votre premier contact.','Chaque mail parle à son destinataire.'],nl:['Een stad in gedachten? Samen op pad.','Ik zoek bedrijven in uw sector.','Ik verzamel nuttige informatie.','Ik controleer openbare contactgegevens.','Ik lees de bedrijfswebsites.','Ik bereid uw eerste contact voor.','Elke e-mail past bij de ontvanger.'],en:['A city in mind? Let’s go together.','I find businesses in your sector.','I collect useful information.','I check public contact details.','I read the business websites.','I prepare your first introduction.','Each email speaks to its recipient.']};
const lang=()=>['fr','nl','en'].includes(document.documentElement.lang)?document.documentElement.lang:'fr';
let selected=0,paused=matchMedia('(prefers-reduced-motion:reduce)').matches,visible=true,time=0,last=0;
const reduced=matchMedia('(prefers-reduced-motion:reduce)');
function updateLabels(){const l=lang();toggle.textContent=paused?'▷':'Ⅱ';toggle.setAttribute('aria-pressed',String(paused));toggle.setAttribute('aria-label',labels[l][paused?'play':'pause']);for(const [i,b] of [...grid.children].entries()){b.querySelector('small').textContent=roles[l][i];b.setAttribute('aria-label',people[i].name+' · '+roles[l][i]);}updateSelection();}
function updateSelection(){for(const [i,b] of [...grid.children].entries())b.setAttribute('aria-pressed',String(i===selected));document.querySelector('.town-bubble strong').textContent=people[selected].name;document.querySelector('.town-bubble>span').textContent=lines[lang()][selected];}
for(const [i,p] of people.entries()){const b=document.createElement('button');b.type='button';b.className='person-card';const c=document.createElement('canvas');c.width=240;c.height=240;c.setAttribute('aria-hidden','true');const ctx=c.getContext('2d');ctx.scale(2,2);ctx.translate(60,115);ctx.scale(1.35,1.35);drawHuman(ctx,p,{pose:'stand',direction:'down'});const name=document.createElement('b');name.textContent=p.name;const role=document.createElement('small');b.append(c,name,role);b.addEventListener('click',()=>{selected=i;updateSelection();draw();});grid.append(b);}
toggle.addEventListener('click',()=>{paused=!paused;updateLabels();draw();});
document.addEventListener('prosper-language',updateLabels);
reduced.addEventListener('change',e=>{paused=e.matches;updateLabels();draw();});
if('IntersectionObserver' in window)new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;},{threshold:0}).observe(canvas);
const positions=[[365,405],[600,495],[155,390],[675,420],[480,555],[425,395],[485,410]];
const routes={
  1:{from:[560,510],to:[686,510],seconds:7,pause:1.2,offset:1.6},
  2:{from:[175,405],to:[245,405],seconds:5,pause:1.4,offset:3},
  4:{from:[490,570],to:[490,486],seconds:6,pause:1.2,offset:2.4},
};
function draw(){
  const ratio=Math.min(2,devicePixelRatio||1),width=Math.round(800*ratio),height=Math.round(650*ratio);
  if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
  g.setTransform(ratio,0,0,ratio,0,0);g.clearRect(0,0,800,650);
  const order=people.map((p,i)=>{const route=routes[i];return{p,i,...(route?patrolAt(route,time):{x:positions[i][0],y:positions[i][1],walking:false,direction:'down',distance:0})};}).sort((a,b)=>a.y-b.y);
  for(const {p,i,x,y,walking,direction,distance}of order){
    g.save();g.translate(x,y);
    if(i===selected){g.fillStyle='#fffdf480';g.strokeStyle='#79977e70';g.lineWidth=1.5;g.beginPath();g.ellipse(0,1,26,9,0,0,Math.PI*2);g.fill();g.stroke();}
    g.scale(1.04,1.04);
    const moving=walking&&!paused,pose=moving?'walk':routes[i]?'stand':i===selected?'wave':i>4?'carry':'stand';
    const motion=poseFor(pose,0,time,p.phase);
    if(moving){motion.phase=distance/14*Math.PI*2;motion.step=Math.sin(motion.phase);motion.bob=Math.abs(motion.step)*1.1;}
    drawHuman(g,p,{...motion,pose,direction,eyes:'open'});g.restore();
  }
}
function frame(ts){const dt=last?Math.min(.1,(ts-last)/1000):0;last=ts;if(visible&&!document.hidden){if(!paused)time+=dt;draw();}requestAnimationFrame(frame);}
updateLabels();draw();requestAnimationFrame(frame);
