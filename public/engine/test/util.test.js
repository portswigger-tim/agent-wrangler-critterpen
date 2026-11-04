import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hash32, rng, ease, springStep, truncateToWidth, quad, arcControl, clamp } from '../util.js';

test('hash32 is deterministic, unsigned and spreads similar ids', () => {
  assert.equal(hash32('session-1'), hash32('session-1'));
  assert.notEqual(hash32('session-1'), hash32('session-2'));
  for (const s of ['', 'a', 'x'.repeat(500)]) {
    const h = hash32(s);
    assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff);
  }
  // Ten accessory buckets: sequential ids should not all land in one.
  const buckets = new Set(Array.from({ length: 40 }, (_, i) => hash32(`s-${i}`) % 10));
  assert.ok(buckets.size >= 7, `only ${buckets.size} buckets used`);
});

test('rng is seeded and stays in [0, 1)', () => {
  const a = rng(42), b = rng(42);
  const xs = Array.from({ length: 100 }, a);
  assert.deepEqual(xs, Array.from({ length: 100 }, b));
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  assert.notDeepEqual(xs.slice(0, 5), Array.from({ length: 5 }, rng(43)));
});

test('every easing maps 0→0 and 1→1', () => {
  for (const [name, f] of Object.entries(ease)) {
    assert.ok(Math.abs(f(0)) < 1e-9, `${name}(0)`);
    assert.ok(Math.abs(f(1) - 1) < 1e-9, `${name}(1)`);
  }
  assert.ok(ease.outBack(0.7) > 1, 'outBack overshoots');
  assert.ok(ease.inOutCubic(0.5) === 0.5);
});

test('springStep converges without overshooting much, even with a huge dt', () => {
  const s = { x: 0, v: 0 };
  for (let i = 0; i < 120; i++) springStep(s, 100, 1 / 60);
  assert.ok(Math.abs(s.x - 100) < 1, `x=${s.x}`);
  const big = springStep({ x: 0, v: 0 }, 10, 5);
  assert.ok(Number.isFinite(big.x) && Math.abs(big.x - 10) < 0.5);
});

test('truncateToWidth adds an ellipsis only when needed', () => {
  const measure = (s) => s.length * 6;
  assert.equal(truncateToWidth('short', 100, measure), 'short');
  const t = truncateToWidth('Refactor cart service', 60, measure);
  assert.ok(t.endsWith('…'));
  assert.ok(measure(t) <= 60);
  assert.equal(truncateToWidth('anything', 2, measure), '');
});

test('quad hits endpoints and arcControl lifts above both ends', () => {
  const a = { x: 0, y: 100 }, b = { x: 200, y: 50 };
  const c = arcControl(a, b);
  assert.ok(c.y < 50);
  assert.deepEqual(quad(a, c, b, 0), a);
  assert.deepEqual(quad(a, c, b, 1), b);
  assert.ok(arcControl({ x: 0, y: 10 }, { x: 10, y: 10 }, 4).y >= 4, 'clamped inside canvas');
  assert.equal(clamp(5, 0, 3), 3);
});

// ── hat / tint spread over realistic session ids ─────────────────────────────
import { critterTraits } from '../util.js';

const HATS = 10;
// Deterministic UUID-shaped ids so the test never flakes.
const hex = (r, n) => Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join('');
const uuid = (r) => `${hex(r, 8)}-${hex(r, 4)}-4${hex(r, 3)}-8${hex(r, 3)}-${hex(r, 12)}`;
const FAMILIES = {
  'random uuids': (() => { const r = rng(7); return () => uuid(r); })(),
  'shared prefix': (() => { let i = 0; return () => `6abf2ad4-fc55-4f49-8bbf-${(i++).toString(16).padStart(12, '0')}`; })(),
  'shared suffix': (() => { let i = 0; return () => `${(i++).toString(16).padStart(8, '0')}-fc55-4f49-8bbf-ad039ef2ea13`; })(),
  'sequential short ids': (() => { let i = 0; return () => `s-${i++}`; })(),
};
// Chi-square critical values at p = 0.001.
const CHI2_DF9 = 27.88, CHI2_DF81 = 124.84;
const chi2 = (counts, expected) => counts.reduce((s, c) => s + (c - expected) ** 2 / expected, 0);

for (const [name, next] of Object.entries(FAMILIES)) {
  test(`accessories spread evenly across ${name}`, () => {
    const n = 5000, buckets = Array(HATS).fill(0);
    for (let i = 0; i < n; i++) buckets[critterTraits(next(), HATS).accessory]++;
    const x = chi2(buckets, n / HATS);
    assert.ok(x < CHI2_DF9, `chi2=${x.toFixed(1)} buckets=${buckets.join(',')}`);
  });
}

test('sharing a hat says nothing about the tint hue', () => {
  const r = rng(11), n = 10000, table = Array.from({ length: HATS }, () => Array(HATS).fill(0));
  for (let i = 0; i < n; i++) {
    const t = critterTraits(uuid(r), HATS);
    table[t.accessory][Math.floor(t.hue / 36)]++;
  }
  // Independence: every (hat, hue band) cell should hold about n / 100.
  const x = chi2(table.flat(), n / (HATS * HATS));
  assert.ok(x < CHI2_DF81, `chi2=${x.toFixed(1)}`);
});

test('hash32 collisions stay near the birthday bound', () => {
  const r = rng(3), seen = new Set();
  let coll = 0;
  for (let i = 0; i < 50000; i++) {
    const h = hash32(uuid(r));
    if (seen.has(h)) coll++;
    seen.add(h);
  }
  assert.ok(coll <= 3, `${coll} collisions (expected ~0.3)`);
});

test('critterTraits is stable and in range', () => {
  const a = critterTraits('6abf2ad4-fc55-4f49-8bbf-ad039ef2ea13', HATS);
  assert.deepEqual(a, critterTraits('6abf2ad4-fc55-4f49-8bbf-ad039ef2ea13', HATS));
  assert.ok(a.accessory >= 0 && a.accessory < HATS && a.hue >= 0 && a.hue < 360 && a.hop >= 0 && a.hop < 7);
  assert.ok(a.size >= 0.92 && a.size <= 1.08);
});
