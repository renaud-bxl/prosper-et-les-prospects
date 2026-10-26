import test from 'node:test';
import assert from 'node:assert/strict';
import {configReprise,peutReprendre} from '../server/mission-resume.mjs';
const run={id:'test',status:'en_cours',metier:'café',ville:'Bruxelles',lat:50.85,lon:4.35,rayon:2000,pays:'BE',nombre:60};
const summary={objectif_contacts:60,objectif_mails:60,score_minimum:60};
const config={recherche:{metier:'autre',nombre:5,centre:{lat:52,lon:5}},equipe:{score_minimum:99},offre:{signature:'QA'},redaction:{moteur:'codex',langue:'nl'}};
test('resume pins the recorded targets and geography without changing the offer or provider',()=>{const c=configReprise(run,summary,config);assert.equal(c.recherche.nombre,60);assert.equal(c.recherche.objectif_mails,60);assert.deepEqual(c.recherche.centre,{lat:50.85,lon:4.35});assert.equal(c.equipe.score_minimum,60);assert.deepEqual(c.offre,config.offre);assert.deepEqual(c.redaction,config.redaction);assert.equal(config.recherche.nombre,5);});
test('running, completed and legacy missions with unknown targets cannot be silently resumed',()=>{assert.equal(peutReprendre(run,summary,true),false);assert.equal(peutReprendre({...run,status:'fini'},summary),false);assert.equal(peutReprendre(run,{}),false);assert.throws(()=>configReprise(run,{},config),{code:'resume_unavailable'});});
test('analysis-only resumes do not start a writing assistant',()=>{assert.equal(configReprise(run,{...summary,objectif_mails:0},config).redaction.moteur,'aucun');});
