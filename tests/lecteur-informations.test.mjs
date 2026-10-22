import test from 'node:test';
import assert from 'node:assert/strict';
import { informationsPubliques, lire } from '../server/agents/lecteur.mjs';
const page=(html,url='https://commerce.nl/')=>({url,html});

test('la fiche publique lit JSON-LD métier, adresse, horaires et contacts sourcés sans records Person',()=>{
 const data={'@graph':[{'@type':'Restaurant',url:'https://commerce.nl/',email:'contact@commerce.nl',telephone:'+31 20 1234567',address:{streetAddress:'Voorbeeldstraat 12',postalCode:'1000 AB',addressLocality:'Amsterdam',addressCountry:'NL'},openingHoursSpecification:[{dayOfWeek:['https://schema.org/Monday','https://schema.org/Tuesday'],opens:'09:00',closes:'18:00'}],sameAs:['https://www.instagram.com/commerce/'],availableService:[{name:'Terrasse'}],hasMenu:'/menu',contactPoint:{'@type':'ContactPoint',email:'reservatie@commerce.nl'}},{'@type':'Person',email:'personne@commerce.nl',telephone:'+31 6 12345678'}]};
 const info=informationsPubliques([page(`<title>Notre commerce</title><script type="application/ld+json">${JSON.stringify(data)}</script>`)],{pays:'NL'});
 assert.equal(info.version,1);assert.equal(info.pages[0].titre,'Notre commerce');
 assert.deepEqual(info.adresse,[{value:'Voorbeeldstraat 12, 1000 AB, Amsterdam, NL',source:'https://commerce.nl/'}]);
 assert.deepEqual(info.emails.map(p=>p.value),['contact@commerce.nl','reservatie@commerce.nl']);
 assert.deepEqual(info.telephones,[{value:'+31201234567',source:'https://commerce.nl/'}]);
 assert.match(info.horaires[0].value,/Monday, Tuesday 09:00–18:00/);
 assert.equal(info.reseaux[0].label,'Instagram');assert.equal(info.services[0].value,'Terrasse');assert.equal(info.liens[0].url,'https://commerce.nl/menu');
});

test('microdata, liens tel/mailto et pages utiles restent des observations avec URL source exacte',()=>{
 const html=`<div itemscope itemtype="https://schema.org/LocalBusiness"><div itemprop="address" itemscope itemtype="https://schema.org/PostalAddress"><span itemprop="streetAddress">Rue Exemple 2</span><span itemprop="addressLocality">Bruxelles</span></div><meta itemprop="openingHours" content="Mo-Fr 08:00-17:00"><meta itemprop="telephone" content="02 123 45 67"><meta itemprop="email" content="info@commerce.be"></div><a href="/services">Nos services</a><a href="https://facebook.com/commerce">Facebook</a><a href="javascript:alert(1)">Contact</a><a href="http://127.0.0.1/contact">Contact local</a>`;
 const info=informationsPubliques([page(html,'https://commerce.be/contact')],{pays:'BE'});
 assert.ok(info.adresse.some(item=>item.value.includes('Rue Exemple 2')));
 assert.equal(info.horaires[0].value,'Mo-Fr 08:00-17:00');assert.equal(info.telephones[0].value,'+3221234567');assert.equal(info.emails[0].value,'info@commerce.be');
 assert.ok(info.liens.some(item=>item.url==='https://commerce.be/services'));assert.ok(info.reseaux.some(item=>item.label==='Facebook'));
 for(const key of ['adresse','horaires','emails','telephones','reseaux','liens'])assert.ok(info[key].every(item=>item.source==='https://commerce.be/contact'));
 assert.equal(info.liens.some(item=>/javascript:|127\.0\.0\.1/.test(item.url)),false);
});

test('fiche bornée : pages et listes limitées, JSON malformé ignoré et absence jamais inventée',()=>{
 const many=Array.from({length:40},(_,i)=>`<a href="/services/${i}">Service ${i}</a>`).join('');
 const info=informationsPubliques(Array.from({length:10},(_,i)=>page(`<script type="application/ld+json">{broken}</script>${many}`,`https://commerce.nl/page-${i}`)));
 assert.equal(info.pages.length,4);assert.equal(info.liens.length,20);
 assert.deepEqual(info.horaires,[]);assert.deepEqual(info.telephones,[]);assert.deepEqual(info.emails,[]);assert.deepEqual(info.services,[]);
});

test('les contacts structurés enrichissent la lecture existante sans visite réseau supplémentaire',async()=>{
 const calls=[];
 const pages={
  'https://commerce.nl/':'<html lang="nl"><title>Commerce</title><a href="/contact">Contact</a></html>',
  'https://commerce.nl/contact':'<script type="application/ld+json">{"@type":"LocalBusiness","email":"info@commerce.nl","telephone":"020 1234567","address":"Voorbeeld 1, Amsterdam"}</script>',
 };
 const result=await lire({website:'https://commerce.nl/',pays:'NL'},{resolver:async()=>[{address:'93.184.216.34',family:4}],fetchImpl:async url=>{calls.push(url);assert.ok(pages[url]);return new Response(pages[url],{headers:{'Content-Type':'text/html'}});}});
 assert.equal(result.ok,true);assert.equal(calls.length,2);assert.deepEqual(result.emails,['info@commerce.nl']);assert.deepEqual(result.telephones,['+31201234567']);assert.equal(result.email_source,'/contact');
 assert.equal(result.signals.info.emails[0].source,'https://commerce.nl/contact');assert.equal(result.signals.info.adresse[0].value,'Voorbeeld 1, Amsterdam');assert.equal(result.signals.langue,'nl');
});
