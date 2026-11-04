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
