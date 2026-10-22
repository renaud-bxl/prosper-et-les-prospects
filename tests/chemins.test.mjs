import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../web/src/chemins.js';
const road = (pts) => ({ cls: 'minor', pts });

test('3 km diagonal keeps its full route and is found at its midpoint', () => {
  const before = performance.now();
  const graph = buildGraph({ roads: [road([[0, 0], [3000, 3000]])] });
  assert.equal(graph.nodes, 2);
  const nearest = graph.nearest(1501, 1500);
  assert.ok(nearest); assert.ok(nearest.p.d < 1);
  const path = graph.path(10, 10, 2990, 2990);
  assert.deepEqual(path[0], [10, 10]); assert.deepEqual(path.at(-1), [2990, 2990]);
  assert.ok(path.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));
  console.log(`3km diagonal index and routing: ${(performance.now() - before).toFixed(1)}ms`);
});

test('grid-boundary endpoints, reverse diagonals and axis-aligned segments terminate correctly', () => {
  for (const pts of [
    [[10, 0], [0, 8]], [[0, 8], [10, 0]], [[0, 0], [-3000, -3000]],
    [[-3000, 3000], [0, 0]], [[8, 8], [8, -24]], [[-24, 8], [24, 8]],
    [[-.1, -.1], [24, 16]], [[24, 16], [-.1, -.1]],
  ]) {
    const graph = buildGraph({ roads: [road(pts)] });
    const [a, b] = pts, x = (a[0] + b[0]) / 2, y = (a[1] + b[1]) / 2;
    assert.ok(graph.nearest(x, y), JSON.stringify(pts));
    const path = graph.path(...a, ...b);
    assert.ok(Math.hypot(path[0][0] - a[0], path[0][1] - a[1]) < 1e-6);
    assert.ok(Math.hypot(path.at(-1)[0] - b[0], path.at(-1)[1] - b[1]) < 1e-6);
  }
});

test('connected streets and tile-border dangling endpoints stay connected', () => {
  const graph = buildGraph({ roads: [road([[0, 0], [100, 100]]), road([[100, 100], [200, 100]]), road([[150, 100.5], [150, 200]])] });
  const path = graph.path(0, 0, 150, 200);
  assert.deepEqual(path[0], [0, 0]); assert.deepEqual(path.at(-1), [150, 200]);
  assert.ok(path.some(([x, y]) => Math.abs(x - 150) < .01 && Math.abs(y - 100) < .01));
});
