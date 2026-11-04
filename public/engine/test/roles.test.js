import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roleScales, ROLE_SCALE, pickAt, computeLayout, islandPoint } from '../layout.js';
import { PERSONAL_SPACE, islandAxes } from '../wander.js';

const crit = (id, taskId, parentId) => ({ id, taskId, taskName: taskId.toUpperCase(), ...(parentId ? { parentId } : {}) });

test('roles: parent, child, solo; a child that is also a parent is parent-sized', () => {
  const roles = roleScales([
    crit('pm', 't'), crit('kid', 't', 'pm'), crit('grandkid', 't', 'kid'), crit('loner', 't'),
    crit('orphan', 't', 'gone'), crit('self', 't', 'self'), crit('remote', 'u', 'pm'),
  ]);
  const role = (id) => roles.get(id).role;
  assert.equal(role('pm'), 'parent');
  assert.equal(role('kid'), 'parent', 'has its own child');
  assert.equal(role('grandkid'), 'child');
  assert.equal(role('loner'), 'solo');
  assert.equal(role('orphan'), 'solo', 'parent not on the pen');
  assert.equal(role('self'), 'solo');
  assert.equal(role('remote'), 'child', 'children on other islands still count');
  assert.equal(roles.get('pm').kids, 2);
  assert.deepEqual([ROLE_SCALE.parent, ROLE_SCALE.child, ROLE_SCALE.solo], [1.35, 0.8, 1]);
  assert.equal(roles.get('pm').scale, 1.35);
  assert.equal(roles.get('grandkid').scale, 0.8);
});

test('hitbox scales with size: the parent is the easiest target', () => {
  const r = 20;
  const parent = { id: 'p', cx: 100, cy: 100, cr: r * ROLE_SCALE.parent };
  const solo = { id: 's', cx: 300, cy: 100, cr: r * ROLE_SCALE.solo };
  const child = { id: 'c', cx: 500, cy: 100, cr: r * ROLE_SCALE.child };
  const off = r * 1.5; // same distance from each centre
  assert.equal(pickAt([parent, solo, child], 100 + off, 100)?.id, 'p');
  assert.equal(pickAt([parent, solo, child], 300 + off, 100), null);
  assert.equal(pickAt([parent, solo, child], 500 + off, 100), null);
  assert.equal(pickAt([parent, solo, child], 500 + r * 0.9, 100)?.id, 'c');
});

test('layout: parents sit near the middle with their children around them', () => {
  const critters = [crit('pm', 't'), ...['a', 'b', 'c', 'd'].map((k) => crit(k, 't', 'pm')), crit('x', 't'), crit('y', 't')];
  const L = computeLayout({ width: 1200, height: 760, critters });
  const isl = L.islands[0];
  // Measured in world px: islands are wide and shallow.
  const at = (id) => { const s = L.slots.get(id), sp = L.spots.get(id); return islandPoint(isl, sp.u, sp.v, s.r * s.scale); };
  const fromMid = (id) => Math.hypot(at(id).x - isl.cx, at(id).y - isl.cy);
  for (const id of ['a', 'b', 'c', 'd', 'x', 'y']) assert.ok(fromMid('pm') <= fromMid(id), `parent nearer the middle than ${id}`);
  const near = (id) => Math.hypot(at(id).x - at('pm').x, at(id).y - at('pm').y);
  const kidMean = ['a', 'b', 'c', 'd'].reduce((s, id) => s + near(id), 0) / 4;
  const soloMean = (near('x') + near('y')) / 2;
  assert.ok(kidMean < soloMean, `children cluster around the parent (${kidMean.toFixed(2)} vs ${soloMean.toFixed(2)})`);
  assert.equal(L.slots.get('pm').scale, 1.35);
  assert.equal(L.slots.get('a').scale, 0.8);
  assert.equal(L.slots.get('x').scale, 1);
  assert.ok(isl.rx > computeLayout({ width: 1200, height: 760, critters: critters.map((c) => ({ ...c, parentId: undefined })) }).islands[0].rx * 0.95,
    'island leaves room for the big parent');
});

test('bodies never touch at rest, whatever the family shape (reduced motion uses these spots)', () => {
  const shapes = {
    solos: (k) => Array.from({ length: k }, (_, i) => crit(`s${i}`, 't')),
    family: (k) => [crit('p', 't'), ...Array.from({ length: k - 1 }, (_, i) => crit(`c${i}`, 't', 'p'))],
    mixed: (k) => Array.from({ length: k }, (_, i) => crit(`m${i}`, 't', i % 3 === 1 ? `m${i - 1}` : undefined)),
  };
  for (const [name, make] of Object.entries(shapes)) {
    for (let k = 2; k <= 9; k++) {
      const L = computeLayout({ width: 1200, height: 760, critters: make(k) });
      const isl = L.islands[0];
      const pts = [...L.slots.entries()].map(([id, s]) => {
        const cr = s.r * s.scale, sp = L.spots.get(id);
        return { id, cr, ...islandPoint(isl, sp.u, sp.v, cr) };
      });
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i], b = pts[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        // Bodies are circles of r at (x, ground - r); 8% slack for squash and breathing.
        assert.ok(d >= (a.cr + b.cr) * 1.08, `${name} k=${k}: ${a.id} and ${b.id} touch (${d.toFixed(1)} < ${((a.cr + b.cr) * 1.08).toFixed(1)})`);
      }
    }
  }
  assert.ok(PERSONAL_SPACE / 2 >= 1.08 * 1.08, 'personal space covers jitter + squash');
  assert.ok(islandAxes({ rx: 100, ry: 40 }, 10).ax > 0);
});
