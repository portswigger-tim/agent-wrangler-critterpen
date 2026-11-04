import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout, packIslands, islandSize, islandPoint, homeSpots, sceneFrame, isUnassigned } from '../layout.js';
import { createWander, stepWander, separate, randomPoint, wanderPace } from '../wander.js';
import { rng } from '../util.js';
import { LANDMARK_KINDS } from '../contract.js';
import { isletFootprint } from '../buildings.js';

const crit = (id, taskId, extra = {}) => ({ id, taskId, taskName: taskId.toUpperCase(), ...extra });
const crowd = (n, tasks) => Array.from({ length: n }, (_, i) => crit(`c${i}`, `t${i % tasks}`));
const boxes = (L) => L.islands.map((i) => i.box);
const sep = (a, b) => Math.max(a.l - b.r, b.l - a.r, a.t - b.b, b.t - a.b);

function assertNoOverlap(L, label) {
  const bs = [...boxes(L), ...L.islets.map((i) => i.box)];
  for (let i = 0; i < bs.length; i++) {
    for (let j = i + 1; j < bs.length; j++) {
      assert.ok(sep(bs[i], bs[j]) >= 0, `${label}: boxes ${i} and ${j} overlap`);
    }
    const b = bs[i], sky = L.sky;
    assert.ok(b.l >= sky.x - 0.5 && b.r <= sky.x + sky.w + 0.5 && b.t >= sky.y - 0.5 && b.b <= sky.y + sky.h + 0.5, `${label}: island ${i} leaves the sky`);
  }
}

test('every service gets an islet; "you" sits front and centre, the rest keep their corners', () => {
  for (const [w, h] of [[1200, 760], [800, 600], [1800, 500]]) {
    const L = computeLayout({ width: w, height: h, critters: crowd(6, 2), footprint: isletFootprint });
    assert.deepEqual(L.islets.map((i) => i.kind).sort(), [...LANDMARK_KINDS].sort());
    assert.deepEqual(L.landmarks.map((l) => l.kind).sort(), [...LANDMARK_KINDS].sort());
    const at = Object.fromEntries(L.islets.map((i) => [i.kind, i]));
    assert.ok(Math.abs(at.human.x - w / 2) < w * 0.15 && at.human.y > h * 0.6, `you islet at ${at.human.x.toFixed(0)},${at.human.y.toFixed(0)}`);
    assert.ok(at.git.x < w / 2 && at.git.y < h / 2, 'git top-left');
    assert.ok(at.jira.x > w / 2 && at.jira.y < h / 2, 'jira top-right');
    assert.ok(at.terminal.x > w * 0.6, 'shell on the right');
    for (const l of L.landmarks) assert.ok(l.baseY != null && l.islet, `${l.kind} stands on an islet`);
  }
});


test('islands never overlap and stay in the sky, across sizes and crowds', () => {
  for (const [w, h] of [[1200, 760], [800, 600], [390, 760], [1600, 480]]) {
    for (const [n, tasks] of [[1, 1], [8, 3], [20, 5], [40, 9]]) {
      const L = computeLayout({ width: w, height: h, critters: crowd(n, tasks), footprint: isletFootprint });
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



// ── events must not change the view ──────────────────────────────────────────

const centres = (L) => new Map([...L.islands.map((i) => [i.taskId, [i.cx, i.cy]]), ...L.islets.map((i) => [`svc:${i.kind}`, [i.x, i.y]])]);

test('pinned: a long run of joins, spawns, archives and removals never moves an existing island or islet', () => {
  let critters = crowd(9, 3);
  let L = computeLayout({ width: 1200, height: 760, critters, footprint: isletFootprint });
  const start = centres(L), r0 = L.radius;
  const rand = rng(2024);
  for (let step = 0; step < 60; step++) {
    const k = Math.floor(rand() * 4);
    const task = `t${Math.floor(rand() * 3)}`;
    if (k === 0) critters = [...critters, crit(`j${step}`, task)]; // joins an existing task
    else if (k === 1) { // spawns a child into its parent's task
      const mates = critters.filter((c) => c.taskId === task);
      if (mates.length) critters = [...critters, crit(`s${step}`, task, { parentId: mates[0].id })];
    } else if (k === 2 && critters.length > 4) critters = critters.filter((_, i) => i !== Math.floor(rand() * critters.length)); // archived
    // k === 3: statuses and events change nothing the layout sees
    L = computeLayout({ width: 1200, height: 760, critters, prev: L, footprint: isletFootprint });
    assert.equal(L.radius, r0, 'critter size never changes');
    for (const [id, [x, y]] of centres(L)) {
      if (!start.has(id)) continue;
      assert.deepEqual([x, y], start.get(id), `step ${step}: ${id} moved`);
    }
  }
});

test('pinned: a new task goes into free space without moving anyone; a removed one leaves its gap', () => {
  let critters = crowd(6, 2);
  const L0 = computeLayout({ width: 1200, height: 760, critters, footprint: isletFootprint });
  const before = centres(L0);
  const L1 = computeLayout({ width: 1200, height: 760, critters: [...critters, crit('n1', 'fresh'), crit('n2', 'fresh')], prev: L0, footprint: isletFootprint });
  for (const [id, xy] of before) assert.deepEqual(centres(L1).get(id), xy, `${id} moved for the new task`);
  assertNoOverlap(L1, 'with the new task');
  const fresh = L1.islands.find((i) => i.taskId === 'fresh');
  for (const o of [...L1.islands.filter((i) => i !== fresh).map((i) => i.box), ...L1.islets.map((i) => i.box)]) assert.ok(sep(fresh.box, o) >= 0);
  // Remove a task: its island becomes a ghost; nobody slides into the gap.
  const L2 = computeLayout({ width: 1200, height: 760, critters: critters.filter((c) => c.taskId !== 't0').concat(crit('n1', 'fresh'), crit('n2', 'fresh')), prev: L1, footprint: isletFootprint });
  assert.deepEqual(L2.ghosts.map((g) => g.taskId), ['t0']);
  for (const [id, xy] of centres(L2)) if (centres(L1).has(id)) assert.deepEqual(xy, centres(L1).get(id));
  // A third task lands in free space, not on the ghost.
  const L3 = computeLayout({ width: 1200, height: 760, critters: [...critters.filter((c) => c.taskId !== 't0'), crit('n1', 'fresh'), crit('z', 'third')], prev: L2, footprint: isletFootprint });
  const third = L3.islands.find((i) => i.taskId === 'third');
  assert.ok(sep(third.box, L2.ghosts[0].box) >= 0, 'not on the removed island\'s spot');
});

test('pinned: an island grows in place, centre fixed, never into a neighbour', () => {
  let critters = crowd(6, 2);
  let L = computeLayout({ width: 1000, height: 640, critters, footprint: isletFootprint });
  const c0 = centres(L).get('t0'), rx0 = L.islands.find((i) => i.taskId === 't0').rx;
  for (let i = 0; i < 12; i++) {
    critters = [...critters, crit(`g${i}`, 't0')];
    L = computeLayout({ width: 1000, height: 640, critters, prev: L, footprint: isletFootprint });
    assert.deepEqual(centres(L).get('t0'), c0);
    assertNoOverlap(L, `grow ${i}`);
  }
  assert.ok(L.islands.find((i) => i.taskId === 't0').rx >= rx0, 'it grew (or held)');
});

test('only a resize re-packs, keeping the left-to-right order', () => {
  const critters = crowd(9, 3);
  const L0 = computeLayout({ width: 1200, height: 760, critters, footprint: isletFootprint });
  const L1 = computeLayout({ width: 900, height: 700, critters, prev: L0, footprint: isletFootprint });
  assert.notDeepEqual([...centres(L1).values()], [...centres(L0).values()], 'a resize may re-pack');
  const order = (L) => L.islands.slice().sort((a, b) => a.cx - b.cx).map((i) => i.taskId).join();
  assert.equal(order(L1), order(L0));
  assertNoOverlap(L1, 'after resize');
});

test('the first critters lay out afresh, even after an empty layout of the same size', () => {
  const empty = computeLayout({ width: 980, height: 614, critters: [], footprint: isletFootprint });
  const L = computeLayout({ width: 980, height: 614, critters: crowd(14, 4), prev: empty, footprint: isletFootprint });
  const fresh = computeLayout({ width: 980, height: 614, critters: crowd(14, 4), footprint: isletFootprint });
  assert.equal(L.radius, fresh.radius);
  assert.deepEqual(L.islands.map((i) => Math.round(i.rx)), fresh.islands.map((i) => Math.round(i.rx)));
  assertNoOverlap(L, 'first critters');
});
