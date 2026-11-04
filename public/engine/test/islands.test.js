import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout, packIslands, islandSize, islandPoint, homeSpots, sceneFrame, isUnassigned } from '../layout.js';
import { createWander, stepWander, separate, randomPoint, bellSlot, wanderPace } from '../wander.js';
import { rng } from '../util.js';
import { LANDMARK_KINDS } from '../contract.js';

const crit = (id, taskId, extra = {}) => ({ id, taskId, taskName: taskId.toUpperCase(), ...extra });
const crowd = (n, tasks) => Array.from({ length: n }, (_, i) => crit(`c${i}`, `t${i % tasks}`));
const boxes = (L) => L.islands.map((i) => i.box);
const sep = (a, b) => Math.max(a.l - b.r, b.l - a.r, a.t - b.b, b.t - a.b);

function assertNoOverlap(L, label) {
  const bs = boxes(L);
  for (let i = 0; i < bs.length; i++) {
    for (let j = i + 1; j < bs.length; j++) {
      assert.ok(sep(bs[i], bs[j]) >= 0, `${label}: islands ${L.islands[i].taskId} and ${L.islands[j].taskId} overlap`);
    }
    const b = bs[i], sky = L.sky;
    assert.ok(b.l >= sky.x - 0.5 && b.r <= sky.x + sky.w + 0.5 && b.t >= sky.y - 0.5 && b.b <= sky.y + sky.h + 0.5, `${label}: island ${i} leaves the sky`);
  }
}

test('the scene has a mainland with every landmark building on it, bell in the middle', () => {
  for (const [w, h] of [[1200, 760], [390, 700], [1800, 500]]) {
    const { landmarks, mainland, sky } = sceneFrame(w, h);
    assert.deepEqual(landmarks.map((l) => l.kind).sort(), [...LANDMARK_KINDS].sort());
    for (const l of landmarks) {
      assert.ok(l.baseY > mainland.y && l.baseY < h, `${l.kind} stands on the mainland`);
      assert.ok(l.x - l.r >= 0 && l.x + l.r <= w);
    }
    const xs = landmarks.map((l) => l.x).sort((a, b) => a - b);
    assert.equal(landmarks.find((l) => l.kind === 'human').x, xs[3]);
    assert.ok(sky.y + sky.h <= mainland.y);
  }
});

test('islands never overlap and stay in the sky, across sizes and crowds', () => {
  for (const [w, h] of [[1200, 760], [800, 600], [390, 760], [1600, 480]]) {
    for (const [n, tasks] of [[1, 1], [8, 3], [20, 5], [40, 9]]) {
      const L = computeLayout({ width: w, height: h, critters: crowd(n, tasks) });
      assert.equal(L.islands.length, tasks);
      assertNoOverlap(L, `${w}x${h} ${n}/${tasks}`);
    }
  }
});

test('islands grow with their crowd', () => {
  const r = 20;
  assert.ok(islandSize(9, r).rx > islandSize(4, r).rx);
  assert.ok(islandSize(4, r).rx > islandSize(1, r).rx);
  const L = computeLayout({ width: 1200, height: 760, critters: [...crowd(6, 1), crit('x', 'small')] });
  const big = L.islands.find((i) => i.taskId === 't0'), small = L.islands.find((i) => i.taskId === 'small');
  assert.ok(big.rx > small.rx);
});

test('packing is stable: adding or removing a critter barely moves other islands', () => {
  let critters = crowd(9, 3);
  let L = computeLayout({ width: 1200, height: 760, critters });
  const moved = (A, B) => Math.max(...A.islands.filter((i) => B.islands.some((j) => j.taskId === i.taskId))
    .map((i) => { const j = B.islands.find((x) => x.taskId === i.taskId); return Math.hypot(i.cx - j.cx, i.cy - j.cy); }));
  // Add a critter to an existing island.
  critters = [...critters, crit('extra', 't1')];
  let L2 = computeLayout({ width: 1200, height: 760, critters, anchors: L.anchors });
  assert.ok(moved(L, L2) < 60, `add: moved ${moved(L, L2).toFixed(1)}px`);
  assertNoOverlap(L2, 'after add');
  // A whole new task appears.
  critters = [...critters, crit('new1', 'fresh'), crit('new2', 'fresh')];
  const L3 = computeLayout({ width: 1200, height: 760, critters, anchors: L2.anchors });
  assert.ok(moved(L2, L3) < 80, `new island: moved ${moved(L2, L3).toFixed(1)}px`);
  assertNoOverlap(L3, 'after new island');
  // Remove one.
  critters = critters.filter((c) => c.id !== 'c0');
  const L4 = computeLayout({ width: 1200, height: 760, critters, anchors: L3.anchors });
  assert.ok(moved(L3, L4) < 40, `remove: moved ${moved(L3, L4).toFixed(1)}px`);
  // Same input + anchors twice: no drift at all.
  const L5 = computeLayout({ width: 1200, height: 760, critters, anchors: L4.anchors });
  assert.ok(moved(L4, L5) < 0.5, `idempotent: moved ${moved(L4, L5).toFixed(2)}px`);
});

test('packIslands spreads fresh islands out rather than piling them together', () => {
  const sky = { x: 0, y: 0, w: 1200, h: 600 };
  const specs = ['a', 'b', 'c'].map((id) => ({ id, ...islandSize(3, 18) }));
  const { pos, ok } = packIslands(specs, sky);
  assert.ok(ok);
  const xs = [...pos.values()].map((p) => p.x);
  assert.ok(Math.max(...xs) - Math.min(...xs) > sky.w * 0.4, 'uses the width');
});

test('unassigned sessions get a rocky islet', () => {
  assert.ok(isUnassigned('adhoc', 'Unassigned'));
  assert.ok(isUnassigned('', ''));
  assert.ok(!isUnassigned('t1', 'Checkout'));
  const L = computeLayout({ width: 1000, height: 700, critters: [crit('a', 'adhoc', { taskName: 'Unassigned' }), crit('b', 't1')] });
  assert.ok(L.islands.find((i) => i.taskId === 'adhoc').rocky);
  assert.ok(!L.islands.find((i) => i.taskId === 't1').rocky);
});

test('home spots sit inside the island, apart from each other', () => {
  for (const k of [1, 2, 5, 12]) {
    const spots = homeSpots(k, 1234);
    for (const p of spots) assert.ok(Math.hypot(p.u, p.v) <= 0.9);
    for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) {
      assert.ok(Math.hypot(spots[i].u - spots[j].u, spots[i].v - spots[j].v) > 0.15, `k=${k} spots ${i},${j} too close`);
    }
  }
});

test('wandering critters never leave their island', () => {
  const isl = { cx: 400, cy: 300, rx: 160, ry: 62 };
  const r = 18;
  const rand = rng(99);
  const crowdOn = Array.from({ length: 8 }, () => { const p = randomPoint(rand); return createWander(p.u, p.v, rand); });
  for (let step = 0; step < 6000; step++) {
    for (const w of crowdOn) stepWander(w, 1 / 30, rand, wanderPace(step % 2 ? 'working' : 'thinking'));
    separate(crowdOn, r * 2.4, isl.rx - r * 0.9, isl.ry - r * 0.4, 0.2);
    for (const w of crowdOn) {
      assert.ok(Math.hypot(w.u, w.v) <= 1 + 1e-9, `left the disk at step ${step}`);
      const p = islandPoint(isl, w.u, w.v, r);
      const e = ((p.x - isl.cx) / isl.rx) ** 2 + ((p.y - isl.cy) / isl.ry) ** 2;
      assert.ok(e <= 1, `feet off the island at step ${step}`);
    }
  }
});

test('wanderers actually wander, and sleepers stay put', () => {
  const rand = rng(5);
  const w = createWander(0, 0, rand);
  const seen = new Set();
  for (let i = 0; i < 3000; i++) { stepWander(w, 1 / 30, rand, wanderPace('working')); seen.add(`${Math.round(w.u * 5)},${Math.round(w.v * 5)}`); }
  assert.ok(seen.size > 8, `visited ${seen.size} cells`);
  const sleeper = createWander(0.3, -0.2, rand);
  for (let i = 0; i < 600; i++) stepWander(sleeper, 1 / 30, rand, wanderPace('asleep'));
  assert.deepEqual([sleeper.u, sleeper.v], [0.3, -0.2]);
});

test('separate pushes stacked critters apart and stays in the disk', () => {
  const a = { u: 0.95, v: 0 }, b = { u: 0.95, v: 0 };
  for (let i = 0; i < 50; i++) separate([a, b], 40, 140, 50);
  assert.ok(Math.hypot((a.u - b.u) * 140, (a.v - b.v) * 50) >= 39);
  for (const p of [a, b]) assert.ok(Math.hypot(p.u, p.v) <= 1 + 1e-9);
});

test('the bell queue fans out left and right of the bell', () => {
  const bell = { x: 500, baseY: 700 };
  const slots = Array.from({ length: 4 }, (_, i) => bellSlot(i, bell, 18));
  assert.ok(slots[0].x < 500 && slots[1].x > 500 && slots[2].x < slots[0].x && slots[3].x > slots[1].x);
  assert.equal(new Set(slots.map((s) => s.x)).size, 4);
});
