// Mission progress is authoritative; old replays can still use staged counters.
export function hudCounters(animated, progress) {
  const counters = { ...animated };
  for (const [key, source] of Object.entries({ trouves: 'trouves', lus: 'lus', retenus: 'retenus', prets: 'ecrits' })) {
    const value = progress?.[source];
    if (Number.isSafeInteger(value) && value >= 0) counters[key] = value;
  }
  return counters;
}
