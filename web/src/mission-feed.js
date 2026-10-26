// Reconcile the saved journal before delivering live events. In particular, a
// fast reader must never reach the world before chef.start resets that world.
export function createMissionFeed({ loadHistory, onEvent, onSynced = () => {}, onSyncError = () => {}, retryDelay = failures => Math.min(15000, 1000 * 2 ** Math.min(failures - 1, 4)) }) {
  const inbox = new Map();
  let selected = null, epoch = 0, ready = false, seen = new Set(), pending = null, retryTimer = null, failures = 0;
  const cancelRetry = () => { clearTimeout(retryTimer); retryTimer = null; };
  const normalize = e => ({ ...e, data: typeof e.data === 'string' ? JSON.parse(e.data) : e.data });
  const key = e => e.seq ?? JSON.stringify([e.run_id, e.t, e.agent, e.type, e.place_id, e.data]);
  function remember(raw) {
    const e = normalize(raw);
    if (!inbox.has(e.run_id)) inbox.set(e.run_id, new Map());
    inbox.get(e.run_id).set(key(e), e);
    return e;
  }
  function deliver(e, recovered) {
    const id = key(e);
    if (seen.has(id)) return;
    onEvent(e, { recovered });
    seen.add(id);
  }
  function receive(raw) {
    const e = remember(raw);
    if (ready && e.run_id === selected) deliver(e, false);
  }
  function pause() { ready = false; }
  function clear() { cancelRetry(); selected = null; epoch++; ready = false; seen = new Set(); pending = null; failures = 0; }
  function sync() {
    if (!selected) return Promise.resolve();
    if (pending) return pending;
    cancelRetry();
    ready = false;
    const id = selected, version = epoch;
    const work = (async () => {
      const history = await loadHistory(id);
      if (version !== epoch) return;
      if (!Array.isArray(history)) throw new Error('Invalid mission journal');
      for (const e of history) remember({ ...e, run_id: e.run_id ?? id });
      const all = [...(inbox.get(id)?.values() ?? [])].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
      for (const e of all) deliver(e, true);
      ready = true; failures = 0;
      onSynced(all);
    })();
    pending = work.catch(error => {
      if (version !== epoch) return;
      if (version === epoch && selected) {
        retryTimer = setTimeout(() => { retryTimer = null; sync().catch(onSyncError); }, retryDelay(++failures));
      }
      throw error;
    }).finally(() => { if (version === epoch) pending = null; });
    return pending;
  }
  function select(id, { delivered = [] } = {}) {
    clear(); selected = id;
    seen = new Set(delivered.map(key));
    return sync();
  }
  return { receive, select, sync, pause, clear };
}
