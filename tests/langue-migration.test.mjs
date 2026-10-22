import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

test('la migration additive conserve les anciens mails et persiste les langues des nouveaux', async t => {
  // Load a copy of the real module beside a disposable fixture database. Never import the user's DB module.
  const root=await mkdtemp(join(tmpdir(),'prosper-langue-db-'));
  const opened=[];
  t.after(async()=>{for(const database of opened){try{database.close();}catch{}}await rm(root,{recursive:true,force:true});});
  await mkdir(join(root,'server'));await mkdir(join(root,'data'));
  const file=join(root,'data','agents.db');
  const old=new DatabaseSync(file);
  old.exec(`CREATE TABLE places (
    id TEXT, run_id TEXT, name TEXT, status TEXT, mail TEXT, objet TEXT, signals TEXT, emails TEXT, updated_at INTEGER,
    PRIMARY KEY(run_id,id)
  );
  INSERT INTO places(id,run_id,name,status,mail,objet,updated_at)
    VALUES ('ancien','mission','Ancien commerce','valide','Texte historique à conserver','Objet historique',123);
  INSERT INTO places(id,run_id,name,status,updated_at) VALUES ('nouveau','mission','Nouveau commerce','analyse',456);`);
  old.close();
  const moduleFile=join(root,'server','db.mjs');
  await writeFile(moduleFile,await readFile(resolve(import.meta.dirname,'../server/db.mjs'),'utf8'));
  const first=await import(pathToFileURL(moduleFile).href+'?migration=first');opened.push(first.db);
  const historical=first.getPlace('mission','ancien');
  assert.equal(historical.mail,'Texte historique à conserver');assert.equal(historical.objet,'Objet historique');assert.equal(historical.status,'valide');assert.equal(historical.updated_at,123);
  assert.equal(historical.mail_langue,null);assert.equal(historical.mail_langue_source,null);
  first.updatePlace('mission','nouveau',{mail:'Fictieve nieuwe tekst',objet:'Nieuw onderwerp',mail_langue:'nl',mail_langue_source:'site'});
  assert.equal(first.getPlace('mission','nouveau').mail_langue,'nl');assert.equal(first.getPlace('mission','nouveau').mail_langue_source,'site');
  first.db.close();
  const again=await import(pathToFileURL(moduleFile).href+'?migration=again');opened.push(again.db);
  const columns=again.db.prepare('PRAGMA table_info(places)').all().map(c=>c.name);
  assert.equal(columns.filter(c=>c==='mail_langue').length,1);assert.equal(columns.filter(c=>c==='mail_langue_source').length,1);
  assert.equal(again.getPlace('mission','nouveau').mail_langue,'nl');assert.equal(again.getPlace('mission','ancien').mail_langue,null);
  assert.equal(again.listPlaces('mission').length,2);
});
