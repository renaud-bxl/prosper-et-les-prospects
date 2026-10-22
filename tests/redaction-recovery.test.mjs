import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RedactionError, avecRepriseRedaction, erreurRedaction, signauxRedaction, bilanMission } from '../server/redaction-recovery.mjs';
import { executerRedaction } from '../server/agents/moteurs.mjs';

test('un délai transitoire n’a qu’une seule reprise, avec délai étendu et plafond', async () => {
  const limits = [], retries = [], waits = [];
  const result = await avecRepriseRedaction(async ({ attempt, timeoutMs }) => {
    limits.push(timeoutMs);
    if (attempt === 1) throw new RedactionError('redaction_timeout', 'délai', { retryable: true });
    return { mail: 'Sortie réelle du moteur de test' };
  }, { timeoutMs: 90000, onRetry: (info) => retries.push(info) }, { wait: async (ms) => waits.push(ms) });
  assert.deepEqual(limits, [90000, 180000]); assert.equal(result.attempts, 2); assert.equal(retries.length, 1); assert.deepEqual(waits, [1000]);
  const capped = [];
  await assert.rejects(avecRepriseRedaction(async ({ timeoutMs }) => {
    capped.push(timeoutMs); throw new RedactionError('redaction_timeout', 'délai', { retryable: true });
  }, { timeoutMs: 260000 }, { wait: async () => {} }), { code: 'redaction_timeout', attempts: 2 });
  assert.deepEqual(capped, [260000, 300000]);
});

test('authentification, garde-fou, JSON ou erreur inconnue ne déclenchent aucune reprise automatique', async () => {
  for (const code of ['engine_missing', 'engine_reported_error', 'engine_exit_failed', 'tool_use_blocked', 'invalid_json', 'invalid_draft']) {
    let calls = 0, retries = 0;
    await assert.rejects(avecRepriseRedaction(async () => { calls++; throw new RedactionError(code, code, { retryable: true }); },
      { timeoutMs: 90000, onRetry: () => retries++ }, { wait: async () => {} }), { code });
    assert.equal(calls, 1); assert.equal(retries, 0);
  }
  let calls = 0;
  await assert.rejects(avecRepriseRedaction(async () => { calls++; throw Object.assign(new Error('timeout text only'), { retryable: true }); },
    { timeoutMs: 90000 }, { wait: async () => {} }), /timeout text/);
  assert.equal(calls, 1);
});

test('les preuves sont conservées et une erreur parlead produit un bilan partiel, pas un échec global', () => {
  const original = { site: true, langue: 'nl', raisons: [{ pts: 25, texte: 'preuve' }] };
  const error = new RedactionError('redaction_timeout', 'Délai de test', { retryable: true }); error.attempts = 2;
  const saved = signauxRedaction(original, error);
  assert.equal(saved.redaction_error.code, 'redaction_timeout'); assert.equal(saved.redaction_error.attempts, 2);
  assert.match(erreurRedaction(error).action, /brouillons déjà écrits seront conservés/);
  assert.equal(original.redaction_error, undefined);
  assert.deepEqual(signauxRedaction(saved), original);
  assert.deepEqual(bilanMission({ ecrits: 10, erreurs_redaction: 1 }), { status: 'partiel', erreur: false, partiel: true, a_reprendre: 1 });
  assert.equal(bilanMission({ erreurs_redaction: 0 }).status, 'fini');
  assert.equal(bilanMission({ erreurs_redaction: 1 }, true).status, 'erreur');
});

test('le premier CLI est réellement terminé avant la reprise ; aucun vrai moteur n’est appelé', async () => {
  const root = mkdtempSync(join(tmpdir(), 'prosper-timeout-cli-'));
  const counter = join(root, 'count'), exited = join(root, 'first-exited'), binary = join(root, 'fake-cli');
  const previous = process.env.CLAUDE_BIN;
  const draft = { constat: 'Constat de test', objet: 'Objet de test', mail: 'Texte de test' };
  writeFileSync(binary, `#!${process.execPath}\nconst fs=require('node:fs');const counter=${JSON.stringify(counter)},exited=${JSON.stringify(exited)};const n=fs.existsSync(counter)?Number(fs.readFileSync(counter,'utf8'))+1:1;fs.writeFileSync(counter,String(n));let input='';process.stdin.on('data',d=>input+=d);process.stdin.on('end',()=>{if(n===1){process.on('SIGTERM',()=>setTimeout(()=>{fs.writeFileSync(exited,'yes');process.exit(0);},100));setInterval(()=>{},1000);}else{if(!fs.existsSync(exited))process.exit(8);console.log(JSON.stringify({structured_output:${JSON.stringify(draft)}}));}});\n`, { mode: 0o700 });
  process.env.CLAUDE_BIN = binary;
  try {
    const retryEvents = [];
    const result = await executerRedaction('Instructions de test', 'Prompt de test', { moteur: 'claude', timeout_ms: 1000, onRetry: (event) => retryEvents.push(event) });
    assert.equal(result.mail, draft.mail); assert.equal(result.attempts, 2);
    assert.equal(readFileSync(counter, 'utf8'), '2'); assert.equal(readFileSync(exited, 'utf8'), 'yes'); assert.equal(retryEvents.length, 1);
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_BIN; else process.env.CLAUDE_BIN = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
