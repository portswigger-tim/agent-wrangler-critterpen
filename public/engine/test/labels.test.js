import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeLabels, visibleOverlaps } from '../labels.js';
import { islandSize, islandPoint, homeSpots } from '../layout.js';
import { createWander, stepWander, separate, wanderPace } from '../wander.js';
import { rng, truncateToWidth } from '../util.js';

const measure = (t) => t.length * 6.2; // ~11px system-ui
const NAMES = ['Refactor cart service', 'Investigate CI timeouts', 'Fix flaky payment tests', 'Critter Pen PM',
  'Wrangler adapter', 'Build animation engine', 'Write API reference', 'Migrate docs to Astro'];

test('wandering crowds never show two overlapping labels, and most stay readable', () => {
  const r = 20, labelWidth = Math.min(120, Math.max(56, r * 4.4));
  for (const k of [3, 5, 7]) {
    const size = islandSize(k, r);
    const isl = { cx: 500, cy: 300, rx: size.rx, ry: size.ry };
    const rand = rng(k * 31);
    const crowd = homeSpots(k, 77).map((p, i) => ({
      w: createWander(p.u, p.v, rand),
      text: truncateToWidth(NAMES[i % NAMES.length], labelWidth, measure),
      status: ['working', 'thinking', 'idle'][i % 3],
    }));
    let shown = 0, total = 0;
    for (let step = 0; step < 3000; step++) {
      for (const c of crowd) stepWander(c.w, 1 / 30, rand, wanderPace(c.status));
      separate(crowd.map((c) => c.w), r * 2.7, isl.rx - r * 0.9, (isl.ry - r * 0.4) * 0.5, 0.35);
      if (step % 10) continue;
      const placed = placeLabels(crowd.map((c, i) => {
        const p = islandPoint(isl, c.w.u, c.w.v, r);
        return { id: `c${i}`, text: c.text, x: p.x, groundY: p.y, r, status: c.status };
      }), measure);
      assert.deepEqual(visibleOverlaps(placed), [], `k=${k} step ${step}`);
      shown += placed.filter((p) => p.visible).length;
      total += placed.length;
    }
    assert.ok(shown / total >= 0.85, `k=${k}: only ${(100 * shown / total).toFixed(0)}% of labels readable`);
  }
});

test('the critter that needs you wins the contested spot', () => {
  const placed = placeLabels([
    { id: 'busy', text: 'Busy one', x: 100, groundY: 200, r: 20, status: 'working' },
    { id: 'help', text: 'Needs help', x: 104, groundY: 198, r: 20, status: 'needs-you' },
  ], measure);
  const help = placed.find((p) => p.id === 'help'), busy = placed.find((p) => p.id === 'busy');
  assert.equal(help.y, 198 + 10, 'needs-you keeps the spot under its feet');
  assert.ok(help.visible && busy.visible, 'the other one moves rather than vanishing');
  assert.notEqual(busy.y, 210);
});

test('bell queuers put their names above their heads, clear of the building captions', () => {
  const caption = { l: 480, r: 520, t: 704, b: 718 }; // the "you" caption under the bell
  const [l] = placeLabels([{ id: 'q', text: 'Write API reference', x: 500, groundY: 700, r: 20, status: 'needs-you', above: true }], measure, [caption]);
  assert.ok(l.visible && l.y < 700 - 40, `label at ${l.y}`);
  // Without the hint it still avoids the caption.
  const [m] = placeLabels([{ id: 'm', text: 'Somebody', x: 500, groundY: 695, r: 20, status: 'working' }], measure, [caption]);
  assert.ok(m.visible);
  assert.ok(m.box.b <= caption.t || m.box.t >= caption.b || m.box.r <= caption.l || m.box.l >= caption.r);
});

test('placement is deterministic', () => {
  const items = NAMES.map((t, i) => ({ id: `x${i}`, text: t, x: 100 + (i % 3) * 30, groundY: 200 + (i % 2) * 8, r: 18, status: 'working' }));
  assert.deepEqual(placeLabels(items, measure), placeLabels([...items].reverse(), measure));
});

test('a label placed above the head clears the headroom of a hat or bubble', () => {
  const measure = (t) => t.length * 7;
  const base = { id: 'q', text: 'Write API reference', x: 500, groundY: 700, r: 18, status: 'needs-you', above: true };
  const [plain] = placeLabels([base], measure);
  const [raised] = placeLabels([{ ...base, headroom: 30 }], measure);
  assert.equal(plain.y - raised.y, 30);
  assert.ok(raised.box.b < 700 - 18 * 2 - 30, 'label bottom sits above head + headroom');
});
