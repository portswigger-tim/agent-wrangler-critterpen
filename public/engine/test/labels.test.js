import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeLabels, visibleOverlaps, shortLabel, anchorSpots, shiftLimits } from '../labels.js';
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
      short: shortLabel(NAMES[i % NAMES.length], labelWidth, measure),
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
        // Every name stays within a nudge of one of its owner's two anchors.
        const own = pt(Number(l.id.slice(1)));
        const it = { x: own.x, groundY: own.y, r };
        const { dx, dy } = shiftLimits(it);
        const near = anchorSpots(it).some((a) => Math.abs(l.x - a.x) <= dx + 1e-6 && Math.abs(l.y - a.y) <= dy + 1e-6);
        assert.ok(near, `k=${k} step ${step}: ${l.id}'s name strayed to (${l.x.toFixed(0)},${l.y.toFixed(0)})`);
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
  const [raised] = placeLabels([{ ...base, headroom: 10 }], measure);
  assert.equal(plain.y - raised.y, 10);
  assert.ok(raised.box.b < 700 - 18 * 2 - 10, 'label bottom sits above head + headroom');
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

test('short forms are the first whole word, or nothing', () => {
  const m = (t) => t.length * 7;
  assert.equal(shortLabel('Investigate CI timeouts', 140, m), 'Investigate…');
  assert.equal(shortLabel('L7 mitmproxy', 140, m), 'L7…');
  assert.equal(shortLabel('Review PR #2 skip hooks', 140, m), 'Review…');
  assert.equal(shortLabel('#2 skip hooks', 140, m), 'skip…', 'skips a punctuation-only word');
  assert.equal(shortLabel('PM', 140, m), '', 'single word: no short form');
  assert.equal(shortLabel('Investigate CI timeouts', 50, m), '', 'too narrow: nothing, never a fragment');
});

const BOARD = ['Ubuntu 26.04 sudo-rs fix', 'L7 mitmproxy egress spike for safer-runner-action v2', 'L7 mitmproxy',
  'Review PR #2 skip hooks on empty mode', 'Investigate CI timeouts', 'Refactor cart service', 'Critter Pen PM',
  'Safer-runner-action', 'Wrangler adapter', 'Fix flaky payment tests', 'Supercalifragilisticexpialidocious'];

/** A shortened name is a fragment if a cut word keeps fewer than 4 letters, or both end words are cut. */
function fragmentProblem(original, out) {
  if (out === '' || out === original) return null;
  const words = new Set(original.split(/\s+/));
  const parts = out.split('…');
  if (parts.length !== 2) return 'not exactly one ellipsis';
  const left = parts[0].trim().split(/\s+/).filter(Boolean), right = parts[1].trim().split(/\s+/).filter(Boolean);
  const lw = left[left.length - 1], rw = right[0];
  const cutL = lw !== undefined && !words.has(lw), cutR = rw !== undefined && !words.has(rw);
  if (cutL && lw.length < 4) return `left fragment "${lw}"`;
  if (cutR && rw.length < 4) return `right fragment "${rw}"`;
  if (cutL && cutR && original.split(/\s+/).length > 1) return 'cuts inside both end words';
  if (!lw && !rw) return 'empty around the ellipsis';
  return null;
}

test('no fragments: shortened names never keep a stub of a word, at any width', () => {
  const m = (t) => t.length * 6.8;
  for (const name of BOARD) {
    for (let w = 20; w <= 260; w += 4) {
      for (const out of [truncateMiddle(name, w, m), shortLabel(name, w, m)]) {
        assert.ok(m(out) <= w || out === '', `${name} @${w}: "${out}" too wide`);
        const why = fragmentProblem(name, out);
        assert.equal(why, null, `${name} @${w}: "${out}" (${why})`);
      }
    }
  }
});

test('a short name with clear space shows in full, even beside a busy neighbour', () => {
  const m = (t) => t.length * 7;
  // The live-board case: a working neighbour's name placed first, feet 3px apart.
  const items = [
    { id: 'sudo', text: 'Ubuntu … fix', x: 785, groundY: 334, r: 15, status: 'working' },
    { id: 'mitm', text: 'L7 mitmproxy', short: 'L7…', x: 716, groundY: 331, r: 17, status: 'idle' },
  ];
  const mitm = placeLabels(items, m).find((p) => p.id === 'mitm');
  assert.ok(mitm.visible && mitm.text === 'L7 mitmproxy', `got "${mitm.text}" visible=${mitm.visible}`);
});

test('a name that would cover a full name is hidden, not whispered underneath', () => {
  const m = (t) => t.length * 7;
  const items = [
    { id: 'readme', text: 'Rewrit… README', x: 185, groundY: 264, r: 14, status: 'finished' },
    { id: 'art', text: 'Critter … pass', x: 225, groundY: 271, r: 13, status: 'thinking' },
    { id: 'pm', text: 'PM', x: 205, groundY: 230, r: 22, status: 'thinking', parent: true },
    { id: 'eng', text: 'Build … engine', x: 250, groundY: 240, r: 13, status: 'working' },
  ];
  const placed = placeLabels(items, m);
  const full = placed.filter((p) => p.visible);
  for (const p of placed.filter((q) => !q.visible && !q.hidden)) {
    for (const f of full) {
      assert.ok(!(p.box.l < f.box.r && p.box.r > f.box.l && p.box.t < f.box.b && p.box.b > f.box.t), `${p.id} whispers under ${f.id}`);
    }
  }
});

test('a parent keeps its name even with busy children around it', () => {
  const m = (t) => t.length * 7;
  const items = [
    { id: 'pm', text: 'PM', x: 227, groundY: 202, r: 22, status: 'thinking', parent: true },
    { id: 'eng', text: 'Build … engine', x: 262, groundY: 205, r: 13, status: 'working' },
    { id: 'ad', text: 'Wrangler adapter', x: 190, groundY: 208, r: 13, status: 'working' },
    { id: 'art', text: 'Critter … pass', x: 225, groundY: 262, r: 13, status: 'thinking' },
  ];
  const pm = placeLabels(items, m).find((p) => p.id === 'pm');
  assert.ok(pm.visible, 'parent name shown');
});

test('names stay inside the pen', () => {
  const m = (t) => t.length * 7;
  // A big critter near the top edge whose name can't go under its feet.
  const items = [
    { id: 'top', text: 'Refactor service', x: 100, groundY: 60, r: 27, status: 'working' },
    { id: 'below', text: 'Blocker', x: 100, groundY: 100, r: 20, status: 'needs-you' },
  ];
  const bounds = { l: 0, t: 0, r: 400, b: 300 };
  for (const p of placeLabels(items, m, [{ l: 0, r: 400, t: 62, b: 120 }], bounds)) {
    if (p.hidden) continue;
    assert.ok(p.box.t >= 0 && p.box.l >= 0 && p.box.r <= 400 && p.box.b <= 300, `${p.id} at ${JSON.stringify(p.box)}`);
  }
});

test('each name stays within the tether of its OWN body: crowned parent beside a small child', () => {
  const m = (t) => t.length * 7;
  // Drawn bodies: a 1.35x parent mid-hop with a crown, a 0.8x child, packed together
  // so neither name fits under its feet (the Checkout island case).
  const R = 20, pr = R * 1.35, cr = R * 0.8;
  const items = [
    { id: 'parent', text: 'Refactor … service', x: 300, groundY: 200, r: pr, parent: true, status: 'working', headroom: 26,
      body: { cx: 300, cy: 200 - pr - 6, cr: pr } },
    { id: 'child', text: 'Investigate … timeouts', x: 262, groundY: 196, r: cr, status: 'thinking', headroom: 8,
      body: { cx: 262, cy: 196 - cr, cr } },
    { id: 'front', text: 'Fix flaky … tests', x: 290, groundY: 238, r: R, status: 'error', body: { cx: 290, cy: 238 - R, cr: R } },
  ];
  const placed = placeLabels(items, m);
  for (const p of placed) {
    if (p.hidden) continue;
    const it = items.find((x) => x.id === p.id), b = it.body;
    const body = { l: b.cx - b.cr, r: b.cx + b.cr, t: b.cy - b.cr, b: b.cy + b.cr };
    const gapY = p.box.t >= body.b ? p.box.t - body.b : p.box.b <= body.t ? body.t - p.box.b : 0;
    const tether = Math.max(it.r, 20) + 4; // about a radius, at least a line
    assert.ok(gapY <= tether, `${p.id}'s name is ${gapY.toFixed(0)}px from its body (tether ${tether})`);
    assert.ok(Math.abs(p.x - b.cx) <= it.r * 1.0 + 1e-6, `${p.id}'s name slid ${Math.abs(p.x - b.cx).toFixed(0)}px sideways`);
  }
});
