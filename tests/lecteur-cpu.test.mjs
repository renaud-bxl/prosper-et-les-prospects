import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// Website HTML is untrusted. A worker subprocess gives every adversarial fixture
// a hard OS deadline, so a regex regression cannot freeze the parent test runner.
const moduleUrl=pathToFileURL(resolve(import.meta.dirname,'../server/agents/lecteur.mjs')).href;
const fixtures=[
  ['chevrons sans fermeture',`findEmails('<'.repeat(180000),'commerce.be')`],
  ['espaces Unicode sans saut de ligne',`findPhones('\\u00a0'.repeat(180000),'BE')`],
  ['blocs script sans fermeture',`informationsPubliques([{url:'https://commerce.be/',html:'<script>'.repeat(25000)}])`],
  ['liens sans balise fermante',`informationsPubliques([{url:'https://commerce.be/',html:'<a href="/contact">'.repeat(20000)}])`],
  ['attributs sans fin de balise',`informationsPubliques([{url:'https://commerce.be/',html:'<div itemprop="telephone" '.repeat(15000)}])`],
];
for(const [name,expression] of fixtures){
  test(`HTML hostile borné en temps : ${name}`,()=>{
    const code=`import{findEmails,findPhones,informationsPubliques}from ${JSON.stringify(moduleUrl)};${expression};console.log('completed');`;
    const started=Date.now();
    const child=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',timeout:1500,killSignal:'SIGKILL',maxBuffer:4096,env:{PATH:process.env.PATH??''}});
    assert.equal(child.error?.code,undefined,`${name}: child exceeded hard deadline (${Date.now()-started} ms, ${child.signal}). ${child.stderr??''}`);
    assert.equal(child.status,0,child.stderr);
    assert.equal(child.stdout.trim(),'completed');
  });
}
