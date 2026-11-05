import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ambientCount, particleAt, drawAmbient, drawSky, cloudAt } from '../ambient.js';
import { resolvePalette, isDark } from '../color.js';

const palFor = (mode) => {
  const p = resolvePalette({}, mode);
  return { ...p, dark: isDark(p.bg) };
};

function recordingCtx() {
  const calls = [];
  const grad = { addColorStop() {} };
  return {
    calls,
    ctx: new Proxy(
      {},
      {
        get(t, k) {
          if (k in t) return t[k];
          if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => grad;
          return (...a) =>
            calls.push(`${String(k)}(${a.map((v) => (typeof v === 'number' ? v.toFixed(2) : '')).join(',')})`);
        },
        set(t, k, v) {
          t[k] = v;
          return true;
        },
      },
    ),
  };
}

test('particle count scales with the pen but stays sparse', () => {
  assert.equal(ambientCount(100, 100), 4);
  assert.equal(ambientCount(5000, 5000), 30);
  const mid = ambientCount(1200, 700);
  assert.ok(mid > 4 && mid < 30);
});

test('particles are deterministic and stay on the canvas', () => {
  for (const dark of [true, false]) {
    for (let i = 0; i < 30; i++) {
      for (const t of [0, 1.7, 33, 600]) {
        const a = particleAt(i, t, 900, 600, dark),
          b = particleAt(i, t, 900, 600, dark);
        assert.deepEqual(a, b);
        assert.ok(a.x >= 0 && a.x <= 900, `x ${a.x}`);
        assert.ok(a.y >= -20 && a.y <= 620, `y ${a.y}`);
        assert.ok(a.a >= 0 && a.a <= 1);
        assert.equal(a.kind === 'firefly', dark);
      }
    }
  }
});

test('fireflies gather around islands when given them', () => {
  const islands = [{ cx: 200, cy: 300, rx: 80, ry: 30 }];
  for (let i = 0; i < 20; i++) {
    const p = particleAt(i, 12, 900, 600, true, islands);
    assert.ok(Math.abs(p.x - 200) < 80 + 40, `x ${p.x}`);
    assert.ok(p.y < 300 + 30, `y ${p.y}`);
  }
});

test('reduced motion draws no particles at all', () => {
  for (const mode of ['dark', 'light']) {
    const off = recordingCtx();
    drawAmbient(off.ctx, { W: 900, H: 600, pal: palFor(mode), time: 5, reduced: true });
    assert.equal(off.calls.length, 0);
    const on = recordingCtx();
    drawAmbient(on.ctx, { W: 900, H: 600, pal: palFor(mode), time: 5, reduced: false });
    assert.ok(on.calls.includes('fill()'));
  }
});

test('sky: deterministic clouds that drift, and hold still under reduced motion', () => {
  const a = cloudAt(2, 10, 900, 500),
    b = cloudAt(2, 10, 900, 500);
  assert.deepEqual(a, b);
  assert.notEqual(cloudAt(2, 20, 900, 500).x, a.x, 'drifts with time');
  for (let i = 0; i < 5; i++) assert.ok(cloudAt(i, 0, 900, 500).y < 500 * 0.5, 'clouds stay high in the sky');
  // Reduced: the sky is drawn identically at any time.
  const draw = (time) => {
    const r = recordingCtx();
    drawSky(r.ctx, { W: 900, H: 600, pal: palFor('light'), time, reduced: true });
    return r;
  };
  const t0 = draw(0),
    t9 = draw(99);
  assert.ok(
    t0.calls.some((c) => c.startsWith('arc(')),
    'clouds drawn',
  );
  assert.deepEqual(t0.calls, t9.calls);
});
