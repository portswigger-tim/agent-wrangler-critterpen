import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout, landmarkSlots, familyOrder, groupByTask, fitCluster, chooseGrid, spacingFor, COMPACT_HEIGHT } from '../layout.js';
import { LANDMARK_KINDS } from '../contract.js';

const crit = (id, taskId, parentId) => ({ id, taskId, taskName: taskId.toUpperCase(), ...(parentId ? { parentId } : {}) });

test('every landmark kind gets a slot inside the pen', () => {
  for (const [w, h] of [[1200, 800], [400, 700], [900, 110]]) {
    const { landmarks, compact } = landmarkSlots(w, h);
    assert.equal(compact, h < COMPACT_HEIGHT);
    assert.deepEqual(landmarks.map((l) => l.kind).sort(), [...LANDMARK_KINDS].sort());
    for (const l of landmarks) {
      assert.ok(l.x - l.r >= 0 && l.x + l.r <= w, `${l.kind} x in ${w}x${h}`);
      assert.ok(l.y - l.r >= 0 && l.y + l.r <= h, `${l.kind} y in ${w}x${h}`);
    }
  }
});

test('narrow trays stack landmarks into two rows', () => {
  const { landmarks } = landmarkSlots(360, 110);
  assert.equal(new Set(landmarks.map((l) => Math.round(l.y))).size, 2);
});

test('familyOrder puts children right after their parent and survives cycles', () => {
  const list = [crit('kid', 't', 'mom'), crit('x', 't'), crit('mom', 't'), crit('grandkid', 't', 'kid')];
  assert.deepEqual(familyOrder(list).map((c) => c.id), ['x', 'mom', 'kid', 'grandkid']);
  const cyc = [crit('a', 't', 'b'), crit('b', 't', 'a')];
  assert.deepEqual(familyOrder(cyc).map((c) => c.id).sort(), ['a', 'b']);
  assert.deepEqual(familyOrder([crit('self', 't', 'self')]).map((c) => c.id), ['self']);
});

test('groupByTask keeps first-appearance order', () => {
  const g = groupByTask([crit('a', 't2'), crit('b', 't1'), crit('c', 't2')]);
  assert.deepEqual(g.map((x) => [x.taskId, x.members.length]), [['t2', 2], ['t1', 1]]);
});

test('fitCluster shrinks critters as the crowd grows', () => {
  const one = fitCluster(1, 400, 300);
  const many = fitCluster(20, 400, 300);
  assert.ok(one.r > many.r);
  assert.ok(many.cols * many.rows >= 20);
  assert.ok(fitCluster(50, 50, 50).r >= 7, 'never below the minimum');
});

test('chooseGrid uses both directions instead of one long band', () => {
  // A typical full pen: three small clusters should wrap, not sit in one row.
  const wide = chooseGrid([3, 3, 3], 1100, 560, 30);
  assert.ok(wide.cols >= 2 && wide.rows >= 2, JSON.stringify(wide));
  // Tall and narrow: stacks vertically.
  const tall = chooseGrid([3, 3, 3], 300, 1400);
  assert.ok(tall.rows >= 2 && tall.rows >= tall.cols, JSON.stringify(tall));
  // Very wide and short: a single row.
  assert.equal(chooseGrid([3, 3, 3], 1800, 260).rows, 1);
});

test('neighbouring name labels never overlap', () => {
  for (const [w, h, n] of [[1200, 760, 9], [700, 900, 14], [1400, 500, 24]]) {
    const critters = Array.from({ length: n }, (_, i) => crit(`c${i}`, `t${i % 3}`));
    const L = computeLayout({ width: w, height: h, critters });
    const pts = [...L.slots.values()];
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        if (Math.abs(pts[i].y - pts[j].y) > pts[i].r) continue; // different rows
        assert.ok(Math.abs(pts[i].x - pts[j].x) >= L.labelWidth + 4, `${w}x${h}: labels ${i},${j} collide`);
      }
    }
  }
});

test('computeLayout places every critter once, inside its cell, without overlaps', () => {
  const critters = [
    crit('a', 't1'), crit('b', 't1', 'a'), crit('c', 't1'),
    crit('d', 't2'), crit('e', 't2'), crit('f', 't2'),
    crit('g', 't3'), crit('h', 't3', 'g'),
  ];
  const L = computeLayout({ width: 1200, height: 760, critters });
  assert.equal(L.slots.size, critters.length);
  assert.equal(L.clusters.length, 3);
  const pts = [...L.slots.values()];
  for (const p of pts) {
    assert.ok(p.x > 0 && p.x < 1200 && p.y > 0 && p.y < 760);
  }
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
      assert.ok(d > pts[i].r * 2, `critters ${i} and ${j} overlap (${d.toFixed(1)})`);
    }
  }
  for (const cl of L.clusters) {
    const members = critters.filter((c) => c.taskId === cl.taskId);
    for (const m of members) {
      const s = L.slots.get(m.id);
      assert.ok(s.x >= cl.cell.x && s.x <= cl.cell.x + cl.cell.w, `${m.id} inside its cell`);
    }
  }
  assert.ok(L.labelWidth >= spacingFor(L.radius).col - 6);
});

test('computeLayout is deterministic and handles empty / tiny pens', () => {
  const critters = [crit('a', 't1'), crit('b', 't2')];
  const a = computeLayout({ width: 800, height: 600, critters });
  const b = computeLayout({ width: 800, height: 600, critters });
  assert.deepEqual([...a.slots], [...b.slots]);
  assert.equal(computeLayout({ width: 800, height: 600, critters: [] }).slots.size, 0);
  const tray = computeLayout({ width: 700, height: 100, critters });
  assert.ok(tray.compact);
  for (const s of tray.slots.values()) assert.ok(s.y < 100);
});
