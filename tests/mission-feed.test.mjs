import test from 'node:test';
import assert from 'node:assert/strict';
import { createMissionFeed } from '../web/src/mission-feed.js';
const e = (seq, type, run_id = 'cafe-1000') => ({ seq, run_id, agent: 'chef', type, data: '{}' });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('live reader events wait for the delayed journal and survive the initial world reset', async () => {
  const history = deferred(), received = [], world = [];
  const feed = createMissionFeed({ loadHistory: () => history.promise, onEvent: event => {
    received.push(event.seq); if (event.type === 'start') world.length = 0; world.push(event.seq);
  } });
  const follow = feed.select('cafe-1000');
  feed.receive(e(4, 'read')); feed.receive(e(5, 'done'));
  assert.deepEqual(received, []);
  history.resolve([e(1, 'start'), e(2, 'scan'), e(3, 'found'), e(4, 'read')]);
  await follow;
  assert.deepEqual(received, [1, 2, 3, 4, 5]); assert.deepEqual(world, received);
  feed.receive(e(5, 'done')); feed.receive(e(6, 'progress'));
  assert.deepEqual(received, [1, 2, 3, 4, 5, 6]);
});

test('reconnection catches up missed events before new live events, once only', async () => {
  const catchup = deferred(), received = []; let calls = 0;
  const feed = createMissionFeed({ loadHistory: () => ++calls === 1 ? [e(1, 'start')] : catchup.promise, onEvent: event => received.push(event.seq) });
  await feed.select('cafe-1000'); feed.receive(e(2, 'found')); feed.pause();
  const one = feed.sync(), two = feed.sync(); assert.equal(one, two);
  feed.receive(e(5, 'read')); catchup.resolve([e(1, 'start'), e(2, 'found'), e(3, 'found'), e(4, 'read')]);
  await one; assert.deepEqual(received, [1, 2, 3, 4, 5]); assert.equal(calls, 2);
});

test('an older asynchronous selection cannot reset the new mission', async () => {
  const old = deferred(), received = [];
  const feed = createMissionFeed({ loadHistory: id => id === 'old' ? old.promise : [e(20, 'start', 'new')], onEvent: event => received.push(event.run_id) });
  const previous = feed.select('old'); feed.receive(e(2, 'found', 'old'));
  await feed.select('new'); old.resolve([e(1, 'start', 'old')]); await previous;
  assert.deepEqual(received, ['new']);
});

test('a failed history fetch keeps events queued until recovery, with previous replay events seeded', async () => {
  let fail = true; const received = [];
  const feed = createMissionFeed({ loadHistory: () => { if (fail) throw Error('offline'); return [e(1, 'start'), e(2, 'found')]; }, onEvent: event => received.push(event.seq) });
  await assert.rejects(feed.select('cafe-1000', { delivered: [e(1, 'start')] }), /offline/);
  feed.receive(e(3, 'read')); assert.deepEqual(received, []);
  fail = false; await feed.sync(); assert.deepEqual(received, [2, 3]);
});

test('a failed journal retries automatically even when the SSE connection stays open', async () => {
  let calls = 0; const received = [];
  const feed = createMissionFeed({ retryDelay: () => 5, loadHistory: () => {
    if (++calls === 1) throw Error('temporary journal failure');
    return [e(1, 'start'), e(2, 'found')];
  }, onEvent: event => received.push(event.seq) });
  await assert.rejects(feed.select('cafe-1000'));
  feed.receive(e(3, 'read'));
  const until = Date.now() + 500;
  while (received.length < 3 && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(received, [1, 2, 3]); assert.equal(calls, 2); feed.clear();
});

test('leaving a mission cancels a scheduled journal retry', async () => {
  let calls = 0;
  const feed = createMissionFeed({ retryDelay: () => 10, loadHistory: () => { calls++; throw Error('offline'); }, onEvent: () => assert.fail('stale event') });
  await assert.rejects(feed.select('cafe-1000')); feed.clear();
  await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(calls, 1);
});
