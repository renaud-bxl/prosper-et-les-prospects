import test from 'node:test';
import assert from 'node:assert/strict';
import { countryAt, validateMission } from '../server/benelux.mjs';

test('Les trois pays sont reconnus, les voisins exclus',()=>{
  for(const [lat,lon,cc] of [[50.8503,4.3517,'BE'],[52.3676,4.9041,'NL'],[49.6116,6.1319,'LU'],[48.8566,2.3522,null],[50.9375,6.9603,null]]) assert.equal(countryAt(lat,lon),cc);
});
test('Les missions hors pays et les données invalides sont refusées',()=>{
  const b={centre:{lat:50.8503,lon:4.3517},pays:'BE',redaction:{moteur:'aucun',langue:'nl'}};
  assert.equal(validateMission(b,{}),'BE');
  assert.throws(()=>validateMission({...b,pays:'NL'},{}));
  assert.throws(()=>validateMission({...b,nombre:'abc'},{}));
  assert.throws(()=>validateMission({...b,redaction:{moteur:'claude',modele:'$(bad)'}},{}));
  assert.throws(()=>validateMission({...b,redaction:{moteur:'claude'}},{}));
});
