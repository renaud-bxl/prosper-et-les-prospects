import test from 'node:test';
import assert from 'node:assert/strict';
import { choisirLangue, preparerRedaction, resolveLanguage } from '../server/agents/redacteur.mjs';

test('le choix explicite prévaut sur le site et utilise une provenance stable', () => {
  for (const langue of ['fr','nl','en']) {
    assert.deepEqual(resolveLanguage({langue},{signals:{langue:'nl',langue_source:'html[lang]'}}),{mail_langue:langue,mail_langue_source:'explicite'});
    assert.deepEqual(choisirLangue({langue},{signals:{langue:'nl'}}),{langue,langue_source:'explicite'});
  }
});

test('le mode automatique normalise les langues déclarées sans exposer leur format technique', () => {
  for (const [declaration,langue] of [['fr-BE','fr'],['NL_be','nl'],[' en-GB ','en']]) {
    assert.deepEqual(resolveLanguage({langue:'auto'},{signals:{langue:declaration,langue_source:'html[lang]'}}),{mail_langue:langue,mail_langue_source:'site'});
  }
});

test('une langue inconnue reste un repli français sans inférence du pays ou de la ville', () => {
  for (const valeur of [null,undefined,'','de','lb','constructor','__proto__',{},42]) {
    assert.deepEqual(resolveLanguage({}, {signals:{langue:valeur,pays:'NL'},ville:'Amsterdam',interface:'en',website:'https://exemple.nl'}),{mail_langue:'fr',mail_langue_source:'defaut'});
  }
  assert.throws(()=>resolveLanguage({langue:'de'}),/Langue de rédaction inconnue/);
});

test('les métadonnées du brouillon correspondent à la consigne et à la langue du prompt', () => {
  const base=[{name:'Commerce fictif'},{signals:{langue:'nl',langue_source:'html[lang]'},excerpt:'Fictieve zaak'},{raisons:[]},{signature:'Équipe QA'}];
  for (const [redaction,langue,source,instruction] of [
    [{langue:'en'},'en','explicite','Write in English'],
    [{langue:'auto'},'nl','site','Schrijf in het Nederlands'],
  ]) {
    const result=preparerRedaction(...base,'',redaction);
    assert.equal(result.mail_langue,langue);assert.equal(result.mail_langue_source,source);
    assert.equal(result.langue,langue);assert.equal(result.langue_source,source);
    assert.ok(result.system.includes(instruction));assert.ok(result.prompt.endsWith(`langue demandée : ${langue}.`));
  }
  const unknown=preparerRedaction(base[0],{signals:{}},base[2],base[3]);
  assert.equal(unknown.mail_langue,'fr');assert.equal(unknown.mail_langue_source,'defaut');
});
