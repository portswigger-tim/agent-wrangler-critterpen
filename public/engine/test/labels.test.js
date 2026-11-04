import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeLabels, visibleOverlaps, shortLabel, MAX_SHIFT, SHORT_FRACTION } from '../labels.js';
import { islandSize, islandPoint, homeSpots } from '../layout.js';
import { createWander, stepWander, separate, wanderPace, PERSONAL_SPACE, DEPTH_WEIGHT } from '../wander.js';
import { rng, truncateMiddle as shorten } from '../util.js';

const measure = (t) => t.length * 6.2; // ~11px system-ui
const NAMES = ['Refactor cart service', 'Investigate CI timeouts', 'Fix flaky payment tests', 'Critter Pen PM',
  'Wrangler adapter', 'Build animation engine', 'Write API reference', 'Migrate docs to Astro'];

test('wandering crowds: no overlapping labels, every name near its owner, most readable', () => {
  const r = 20, labelWidth = Math.min(150, Math.max(110, r * 6)); // as computeLayout
  const pt = (i) => islandPoint(isl, crowd[i].w.u, crowd[i].w.v, r);
  let isl, crowd;
  for (const k of [3, 5, 7]) {
    const size = islandSize(k, r);
    isl = { cx: 500, cy: 300, rx: size.rx, ry: size.ry };
    const rand = rng(k * 31);
    crowd = homeSpots(k, 77).map((p, i) => ({
      w: createWander(p.u, p.v, rand),
      text: shorten(NAMES[i % NAMES.length], labelWidth, measure),
      short: shortLabel(NAMES[i % NAMES.length], labelWidth * SHORT_FRACTION, measure),
      status: ['working', 'thinking', 'idle'][i % 3],
    }));
    let shown = 0, total = 0;
    for (let step = 0; step < 3000; step++) {
      for (const c of crowd) stepWander(c.w, 1 / 30, rand, wanderPace(c.status));
      separate(crowd.map((c) => c.w), r * PERSONAL_SPACE, isl.rx - r * 0.9, (isl.ry - r * 0.4) * DEPTH_WEIGHT, 0.6);
      if (step % 10) continue;
      const placed = placeLabels(crowd.map((c, i) => {
        const p = pt(i);
        return { id: `c${i}`, text: c.text, short: c.short, x: p.x, groundY: p.y, r, status: c.status };
      }), measure);
      assert.deepEqual(visibleOverlaps(placed), [], `k=${k} step ${step}`);
      for (const l of placed) {
        const moved = Math.hypot(l.x - l.home.x, l.y - l.home.y);
        assert.ok(moved <= r * MAX_SHIFT + 1e-6, `k=${k} step ${step}: ${l.id}'s name strayed ${moved.toFixed(1)}px`);
        const own = pt(Number(l.id.slice(1)));
        assert.ok(Math.abs(l.x - own.x) <= r * MAX_SHIFT + 1e-6 && l.y - own.y <= 10 + r * MAX_SHIFT + 1e-6, `${l.id} stays with its owner`);
      }
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
  // Without the hint a visible name never covers the caption; hemmed in, it
  // stays home faded rather than wandering off.
  for (const gy of [695, 640]) {
    const [m] = placeLabels([{ id: 'm', text: 'Somebody', x: 500, groundY: gy, r: 20, status: 'working' }], measure, [caption]);
    if (m.visible) assert.ok(m.box.b <= caption.t || m.box.t >= caption.b || m.box.r <= caption.l || m.box.l >= caption.r);
    else assert.deepEqual([m.x, m.y], [m.home.x, m.home.y]);
  }
  const [free] = placeLabels([{ id: 'f', text: 'Somebody', x: 500, groundY: 640, r: 20, status: 'working' }], measure, [caption]);
  assert.ok(free.visible, 'a name with room shows');
});

test('placement is deterministic', () => {
  const items = NAMES.map((t, i) => ({ id: `x${i}`, text: t, x: 100 + (i % 3) * 30, groundY: 200 + (i % 2) * 8, r: 18, status: 'working' }));
  assert.deepEqual(placeLabels(items, measure), placeLabels([...items].reverse(), measure));
});

test('a label placed above the head clears the headroom of a hat or bubble', () => {
  const measure = (t) => t.length * 7;
  const base = { id: 'q', text: 'Write API reference', x: 500, groundY: 700, r: 18, status: 'needs-you', above: true };
  const [plain] = placeLabels([base], measure);
  const [raised] = placeLabels([{ ...base, headroom: 20 }], measure);
  assert.equal(plain.y - raised.y, 20);
  assert.ok(raised.box.b < 700 - 18 * 2 - 20, 'label bottom sits above head + headroom');
  // ...but never drifts far above: tall headroom is capped.
  const [tall] = placeLabels([{ ...base, headroom: 60 }], measure);
  assert.equal(plain.y - tall.y, MAX_HEADROOM);
  assert.ok(700 - 18 * 2 - tall.box.b <= MAX_HEADROOM + 4, 'sits close over the head');
});

import { stripTaskPrefix, MAX_HEADROOM } from '../labels.js';
import { truncateMiddle } from '../util.js';

test('labels drop a leading copy of the task name, loosely matched', () => {
  const cases = [
    ['Safer-runner-action Ubuntu 26.04 sudo-rs fix', 'Safer Runner', 'Ubuntu 26.04 sudo-rs fix'],
    ['Safer-runner-action L7 mitmproxy', 'Safer Runner', 'L7 mitmproxy'],
    ['Checkout revamp: fix tax', 'Checkout revamp', 'fix tax'],
    ['checkout_REVAMP - fix tax', 'Checkout revamp', 'fix tax'],
    ['Checkout revampery', 'Checkout revamp', 'Checkout revampery'], // not a word boundary
    ['Checkout revamp', 'Checkout revamp', 'Checkout revamp'], // never down to nothing
    ['Checkout revamp:  ', 'Checkout revamp', 'Checkout revamp:  '],
    ['Fix flaky tests', 'Checkout revamp', 'Fix flaky tests'],
    ['Anything', '', 'Anything'],
  ];
  for (const [name, task, want] of cases) assert.equal(stripTaskPrefix(name, task), want, `${name} / ${task}`);
});

test('middle ellipsis keeps the distinguishing tail', () => {
  const m = (t) => t.length * 6;
  const a = truncateMiddle('Safer-runner-action Ubuntu 26.04 sudo-rs fix', 100, m);
  const b = truncateMiddle('Safer-runner-action L7 mitmproxy', 100, m);
  assert.ok(m(a) <= 100 && m(b) <= 100);
  assert.notEqual(a, b, 'two sessions stay distinguishable');
  assert.ok(a.endsWith('fix') && b.endsWith('mitmproxy'));
  assert.equal(truncateMiddle('short', 100, m), 'short');
  assert.equal(truncateMiddle('anything', 2, m), '');
});

test('middle ellipsis drops whole words before cutting inside one', () => {
  const m = (t) => t.length * 7;
  assert.equal(truncateMiddle('Critter cuteness pass', 105, m), 'Critter … pass');
  assert.equal(truncateMiddle('Fix flaky payment tests', 105, m), 'Fix … tests');
  assert.equal(truncateMiddle('Migrate docs to Astro', 105, m), 'Migrate … Astro');
  // Two whole words don't fit: keep the last whole, shorten the first.
  assert.equal(truncateMiddle('Investigate CI timeouts', 105, m), 'Inves… timeouts');
  // A single long word: character cut, both ends kept.
  const one = truncateMiddle('Safer-runner-action', 105, m);
  assert.ok(m(one) <= 105 && one.includes('…') && one.startsWith('Safer') && one.endsWith('action'));
  // Grows from the tail first when there is room for more words.
  assert.equal(truncateMiddle('Write the API reference for search', 210, m), 'Write … reference for search');
});

test('names never sit on another critter\'s body', () => {
  // A critter standing right where its neighbour's label would go.
  const items = [
    { id: 'back', text: 'Investigate CI timeouts', x: 200, groundY: 200, r: 20, status: 'working' },
    { id: 'front', text: 'Refactor cart service', x: 205, groundY: 250, r: 20, status: 'working' },
  ];
  const placed = placeLabels(items, (t) => t.length * 7);
  const body = (it) => ({ l: it.x - it.r, r: it.x + it.r, t: it.groundY - 2 * it.r, b: it.groundY });
  for (const p of placed.filter((q) => q.visible)) {
    for (const it of items) {
      if (it.id === p.id) continue;
      const b = body(it);
      assert.ok(!(p.box.l < b.r && p.box.r > b.l && p.box.t < b.b && p.box.b > b.t), `${p.id}'s name covers ${it.id}`);
    }
  }
  // The front critter keeps its name; the one behind may fade, but stays home.
  assert.ok(placed.find((p) => p.id === 'front').visible);
  for (const p of placed.filter((q) => !q.visible)) assert.deepEqual([p.x, p.y], [p.home.x, p.home.y]);
});

test('short forms keep the distinguishing last word', () => {
  const m = (t) => t.length * 7;
  assert.equal(shortLabel('Investigate CI timeouts', 70, m), '…timeouts');
  assert.equal(shortLabel('Wrangler adapter', 70, m), '…adapter');
  assert.equal(shortLabel('PM', 70, m), 'PM');
  const long = shortLabel('Supercalifragilistic', 70, m);
  assert.ok(m(long) <= 70 && long.includes('…'));
});
