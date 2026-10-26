import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executerRedaction, lireSortieMoteur } from '../server/agents/moteurs.mjs';
import { diagnosticRedaction, erreurRedaction, signauxRedaction } from '../server/redaction-recovery.mjs';

const PRIVATE = 'PRIVATE_PROMPT_TOKEN_MAIL_TRANSCRIPT';
function fixture(t, mode) {
  const dir = mkdtempSync(join(tmpdir(), 'prosper-diagnostic-'));
  const binary = join(dir, 'fake-codex'), counter = join(dir, 'count');
  const previous = process.env.CODEX_BIN;
  t.after(() => {
    if (previous === undefined) delete process.env.CODEX_BIN; else process.env.CODEX_BIN = previous;
    rmSync(dir, { recursive: true, force: true });
  });
  writeFileSync(binary, `#!${process.execPath}\nconst fs=require('node:fs');const counter=${JSON.stringify(counter)};fs.writeFileSync(counter,String(fs.existsSync(counter)?Number(fs.readFileSync(counter,'utf8'))+1:1));\nprocess.stdin.resume();process.stdin.on('end',()=>{\nconst mode=${JSON.stringify(mode)},privateText=${JSON.stringify(PRIVATE)};\nif(mode==='quiet')return setInterval(()=>{},1000);\nif(mode==='active'){console.log(JSON.stringify({type:'thread.started',thread_id:privateText}));console.log(JSON.stringify({type:'turn.started'}));return setInterval(()=>{console.log(JSON.stringify({type:'item.updated',item:{type:'reasoning',text:privateText}}));process.stderr.write(privateText+'\\n');},60);}\nif(mode==='auth_json'||mode==='auth_hung'){console.log(JSON.stringify({type:'turn.failed',error:{message:'unexpected status 401 Unauthorized: '+privateText}}));return mode==='auth_hung'?setInterval(()=>{},1000):setTimeout(()=>process.exit(1),10);}\nif(mode==='auth_stderr'){process.stderr.write('Not logged');return setTimeout(()=>{process.stderr.write(' in\\n'+privateText);setTimeout(()=>process.exit(1),10);},30);}\nprocess.stderr.write(privateText);setTimeout(()=>process.exit(9),10);\n});\n`, { mode: 0o700 });
  process.env.CODEX_BIN = binary;
  return { calls: () => Number(readFileSync(counter, 'utf8')) };
}

function assertPrivateAbsent(error) {
  const saved = erreurRedaction(error);
  assert.ok(!JSON.stringify(saved).includes(PRIVATE));
  assert.ok(!JSON.stringify(signauxRedaction({}, error)).includes(PRIVATE));
  return saved;
}

test('diagnostic à liste fermée : valeurs bornées et aucun contenu libre persistant', () => {
  assert.deepEqual(diagnosticRedaction({ moteur: 'codex', stdout_octets: 12.9, duree_ms: Infinity, silence_ms: -1,
    stderr: PRIVATE, thread_id: PRIVATE, prompt: PRIVATE, raw: PRIVATE, code_cli: PRIVATE,
    dernier_evenement: PRIVATE, evenements: { 'turn.started': 2, [PRIVATE]: 1 }, signal: PRIVATE }), {
    stdout_octets: 12, moteur: 'codex', evenements: { 'turn.started': 2 },
  });
});

test('authentification reconnue sans exposer son message ; erreurs libres non déduites', () => {
  for (const error of [{ code: 'unauthorized', message: PRIVATE }, { message: 'Not logged in. '+PRIVATE }, { message: 'Your access token could not be refreshed. '+PRIVATE }]) {
    assert.throws(() => lireSortieMoteur('codex', JSON.stringify({ type: 'turn.failed', error })), error => {
      assert.equal(error.code, 'engine_auth_required'); assert.equal(error.retryable, false);
      assert.match(assertPrivateAbsent(error).action, /Reconnectez votre abonnement/); return true;
    });
  }
  assert.throws(() => lireSortieMoteur('codex', JSON.stringify({ type: 'error', message: 'Unrelated website text: unauthorized '+PRIVATE })), { code: 'engine_reported_error' });
});

test('CLI muet : deux watchdogs bornés et diagnostic de silence sans transcript', async (t) => {
  const f = fixture(t, 'quiet');
  await assert.rejects(executerRedaction('Instructions privées', 'Offre privée', { moteur: 'codex', timeout_ms: 1000 }), error => {
    const saved = assertPrivateAbsent(error);
    assert.equal(saved.code, 'redaction_timeout'); assert.equal(saved.retryable, true); assert.equal(saved.attempts, 2);
    assert.equal(saved.diagnostic.timeout_ms, 2000); assert.equal(saved.diagnostic.activite, 'aucune');
    assert.equal(saved.diagnostic.stdout_octets, 0); assert.equal(saved.diagnostic.stderr_octets, 0);
    assert.equal(saved.diagnostic.premiere_activite_ms, null); assert.equal(saved.diagnostic.derniere_activite_ms, null);
    assert.ok(saved.diagnostic.silence_ms >= 1900); assert.equal(f.calls(), 2); return true;
  });
});

test('CLI actif : le délai reste borné, seules activité et catégories JSONL sont conservées', async (t) => {
  const f = fixture(t, 'active');
  const retries = [];
  await assert.rejects(executerRedaction('Instructions privées', 'Offre privée', { moteur: 'codex', timeout_ms: 1000, onRetry: info => retries.push(info) }), error => {
    const saved = assertPrivateAbsent(error);
    assert.equal(saved.code, 'redaction_timeout'); assert.equal(saved.diagnostic.activite, 'stdout_stderr');
    assert.ok(saved.diagnostic.stdout_octets > 0); assert.ok(saved.diagnostic.stderr_octets > 0);
    assert.equal(saved.diagnostic.evenements['thread.started'], 1); assert.equal(saved.diagnostic.evenements['turn.started'], 1);
    assert.ok(saved.diagnostic.evenements['item.updated'] > 0); assert.equal(saved.diagnostic.dernier_evenement, 'item.updated');
    assert.ok(saved.diagnostic.silence_ms < saved.diagnostic.duree_ms);
    assert.equal(f.calls(), 2); assert.equal(retries.length, 1); assert.ok(!JSON.stringify(retries).includes(PRIVATE)); return true;
  });
});

for (const mode of ['auth_json', 'auth_stderr']) test(`CLI ${mode} : connexion actionnable, aucune reprise automatique ni fuite`, async (t) => {
  const f = fixture(t, mode); let retries = 0;
  await assert.rejects(executerRedaction('Instructions privées', 'Offre privée', { moteur: 'codex', onRetry: () => retries++ }), error => {
    const saved = assertPrivateAbsent(error);
    assert.equal(saved.code, 'engine_auth_required'); assert.equal(saved.retryable, false); assert.equal(saved.attempts, 1);
    assert.equal(saved.diagnostic.code_cli, 'auth_required'); assert.equal(saved.diagnostic.exit_code, 1);
    assert.match(saved.message, /compte ChatGPT/); assert.equal(f.calls(), 1); assert.equal(retries, 0); return true;
  });
});

test('authentification déjà refusée puis CLI bloqué : le watchdog ne relance pas cet échec permanent', async (t) => {
  const f = fixture(t, 'auth_hung'); let retries = 0;
  await assert.rejects(executerRedaction('Instructions privées', 'Offre privée', { moteur: 'codex', timeout_ms: 1000, onRetry: () => retries++ }), error => {
    const saved = assertPrivateAbsent(error); assert.equal(saved.code, 'engine_auth_required');
    assert.equal(saved.retryable, false); assert.equal(saved.attempts, 1); assert.equal(saved.diagnostic.code_cli, 'auth_required');
    assert.equal(f.calls(), 1); assert.equal(retries, 0); return true;
  });
});

test('sortie CLI inconnue : code de sortie utile, texte privé écarté et aucune reprise', async (t) => {
  const f = fixture(t, 'unknown');
  await assert.rejects(executerRedaction('Instructions privées', 'Offre privée', { moteur: 'codex' }), error => {
    const saved = assertPrivateAbsent(error); assert.equal(saved.code, 'engine_exit_failed');
    assert.equal(saved.diagnostic.exit_code, 9); assert.ok(saved.diagnostic.stderr_octets > 0);
    assert.equal(saved.diagnostic.code_cli, undefined); assert.equal(f.calls(), 1); return true;
  });
});
