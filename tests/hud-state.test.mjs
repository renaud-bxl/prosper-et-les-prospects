import test from 'node:test';
import assert from 'node:assert/strict';
import { hudCounters } from '../web/src/hud-state.js';

const animated = Object.freeze({ trouves: 8, lus: 4, retenus: 1, prets: 1 });

test('top counters show actual backend progress while the characters are still catching up', () => {
  const progress = Object.freeze({ trouves: 140, lus: 129, retenus: 51, ecrits: 2 });
  assert.deepEqual(hudCounters(animated, progress), { trouves: 140, lus: 129, retenus: 51, prets: 2 });
  assert.deepEqual(animated, { trouves: 8, lus: 4, retenus: 1, prets: 1 });
});

test('completed and zero backend counts stay authoritative, including after decisions', () => {
  assert.deepEqual(hudCounters(animated, { trouves: 250, lus: 250, retenus: 60, ecrits: 60, status: 'fini' }),
    { trouves: 250, lus: 250, retenus: 60, prets: 60 });
  assert.deepEqual(hudCounters(animated, { trouves: 0, lus: 0, retenus: 0, ecrits: 0 }),
    { trouves: 0, lus: 0, retenus: 0, prets: 0 });
});

test('older replays without backend progress preserve animated counters', () => {
  for (const progress of [undefined, null, {}]) assert.deepEqual(hudCounters(animated, progress), animated);
});

test('missing or invalid progress fields fall back individually without inventing counts', () => {
  assert.deepEqual(hudCounters(animated, { trouves: 12, lus: NaN, retenus: -1, ecrits: Infinity }),
    { trouves: 12, lus: 4, retenus: 1, prets: 1 });
  for (const value of [null, '', '129', true, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(hudCounters(animated, { lus: value }), animated);
  }
  assert.deepEqual(hudCounters(animated, { lus: 129 }), { ...animated, lus: 129 });
});
