import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KEEPER_KINDS,
  KEEPER_NAMES,
  CATCH,
  LAND,
  FULL_AT,
  FULL_WINDOW,
  catchProgress,
  recentCatches,
  keeperPose,
  keeperSpot,
  keeperMouth,
  keeperHitbox,
  keeperColors,
  drawKeeper,
} from '../buildings.js';
import { LANDMARK_KINDS, STATUSES } from '../contract.js';
import { resolvePalette, isDark, statusColor, rgbToHsl } from '../color.js';

const palFor = (mode) => {
  const p = resolvePalette({}, mode);
  return { ...p, dark: isDark(p.bg) };
};
const dist = (a, b) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);

function recordingCtx() {
  let depth = 0;
  const calls = [];
  const grad = { addColorStop() {} };
  const ctx = new Proxy(
    {},
    {
      get(t, k) {
        if (k in t) return t[k];
        if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => grad;
        if (k === 'save')
          return () => {
            depth++;
          };
        if (k === 'restore')
          return () => {
            depth--;
          };
        return (...a) =>
          calls.push(`${String(k)}(${a.map((v) => (typeof v === 'number' ? v.toFixed(2) : '')).join(',')})`);
      },
      set(t, k, v) {
        t[k] = v;
        return true;
      },
    },
  );
  return {
    ctx,
    calls,
    get depth() {
      return depth;
    },
  };
}

test('a keeper for every service but the phone box', () => {
  assert.deepEqual([...KEEPER_KINDS, 'human'].sort(), [...LANDMARK_KINDS].sort());
  for (const k of KEEPER_KINDS) {
    assert.ok(KEEPER_NAMES[k].endsWith('keeper'));
    assert.ok(keeperSpot(k) && keeperMouth(k) && keeperHitbox(k));
  }
  assert.equal(keeperSpot('human'), null);
  assert.equal(keeperMouth('human'), null);
  const r = recordingCtx();
  drawKeeper(r.ctx, 'human', 0, 0, 1, palFor('dark'), 0);
  assert.equal(r.calls.length, 0, 'nothing drawn at the phone box');
});

test('the mouth (landing point) sits up on the keeper and scales linearly', () => {
  for (const k of KEEPER_KINDS) {
    const s = keeperSpot(k),
      m = keeperMouth(k),
      h = keeperHitbox(k);
    assert.ok(m.dy < s.dy, `${k}: mouth above the keeper's feet`);
    assert.ok(Math.hypot(m.dx - h.dx, m.dy - h.dy) <= h.r, `${k}: mouth inside the hover circle`);
    const m2 = keeperMouth(k, 2);
    assert.ok(Math.abs(m2.dx - 2 * m.dx) < 1e-9 && Math.abs(m2.dy - 2 * m.dy) < 1e-9);
  }
});

test('catch timeline: progress window, landing moment and recent count', () => {
  assert.equal(catchProgress(10 - CATCH.lead - 0.01, 10), null);
  assert.equal(catchProgress(10 - CATCH.lead, 10), 0);
  assert.ok(Math.abs(catchProgress(10, 10) - LAND) < 1e-9);
  assert.equal(catchProgress(10 - CATCH.lead + CATCH.dur + 0.01, 10), null);
  assert.equal(recentCatches([1, 1.5, 2, 2.4, 9], 2.5), 3, '1.5, 2 and 2.4 are within a second');
  assert.equal(recentCatches([1, 1.5, 2, 2.4, 9], 2.5, 0.6), 2);
  assert.equal(recentCatches([3], 2.5), 0, 'future landings do not count');
  assert.equal(FULL_WINDOW, 1);
});

test('pose: mouth opens before landing, chomps after, wiggles, then rests', () => {
  for (const k of KEEPER_KINDS) {
    const at = (progress, recent = 1) => keeperPose(k, 0, { progress, recent });
    assert.equal(at(null).open, 0);
    assert.ok(at(LAND * 0.5).open > 0.3 && at(LAND * 0.98).open > 0.9, `${k}: anticipation`);
    assert.ok(at(LAND * 0.98).open > at(LAND * 0.5).open, `${k}: opening wider as it arrives`);
    assert.equal(at(LAND + 0.02).eyes, 'happy', `${k}: chomp`);
    assert.ok(Math.max(...[0.6, 0.65, 0.7, 0.75, 0.8].map((p) => Math.abs(at(p).rot))) > 0.08, `${k}: wiggle`);
    assert.equal(at(0.85).open, 0, `${k}: mouth shut during the wiggle`);
  }
});

test('several catches in a second make a keeper round-bellied and full', () => {
  for (const k of KEEPER_KINDS) {
    const one = keeperPose(k, 0, { recent: 1 }),
      full = keeperPose(k, 0, { recent: FULL_AT });
    assert.equal(one.full, 0);
    assert.equal(full.full, 1);
    assert.ok(full.sx > 1.1, `${k}: wider when full`);
    assert.equal(full.eyes, 'happy');
  }
});

test('reduced motion: no sway, chomp or wiggle; only the expression changes', () => {
  for (const k of KEEPER_KINDS) {
    for (const progress of [null, 0.1, LAND, 0.4, 0.8]) {
      for (const t of [0, 3.3]) {
        const p = keeperPose(k, t, { progress, recent: 1 }, true);
        assert.equal(p.rot, 0);
        assert.equal(p.open, 0);
        assert.equal(p.dy, 0);
        assert.equal(p.flicker, 0);
        assert.equal(p.sx, 1);
        assert.equal(p.sy, 1);
      }
    }
    assert.equal(keeperPose(k, 0, { progress: 0.5 }, true).eyes, 'happy');
  }
  // And it draws identically at any time.
  const pal = palFor('dark');
  for (const k of KEEPER_KINDS) {
    const draw = (t) => {
      const r = recordingCtx();
      drawKeeper(r.ctx, k, 50, 80, 1, pal, t, { progress: 0.6 }, { reduced: true });
      return r.calls.join(';');
    };
    assert.equal(draw(0), draw(12.5), k);
  }
});

test('keepers never wear a status colour', () => {
  for (const mode of ['dark', 'light']) {
    const pal = palFor(mode);
    const status = STATUSES.filter((s) => s !== 'archived').map((s) => [s, statusColor(s, pal)]);
    for (const k of KEEPER_KINDS) {
      const c = keeperColors(k, pal);
      assert.ok(rgbToHsl(c.body).s <= 0.45 + 1e-9, `${mode} ${k}: muted`);
      for (const [s, sc] of status)
        assert.ok(dist(c.body, sc) >= 40, `${mode} ${k} body too close to ${s} (${dist(c.body, sc).toFixed(1)})`);
    }
  }
});

test('every keeper draws in both themes and at every stage, with save/restore balanced', () => {
  for (const mode of ['dark', 'light']) {
    for (const k of KEEPER_KINDS) {
      for (const cs of [{}, { progress: 0.1 }, { progress: LAND + 0.05 }, { progress: 0.8, recent: 4 }]) {
        const r = recordingCtx();
        drawKeeper(r.ctx, k, 100, 200, 1, palFor(mode), 2.2, cs);
        assert.equal(r.depth, 0, `${mode} ${k}`);
        assert.ok(r.calls.some((c) => c.startsWith('fill(')));
      }
    }
  }
});

test('dark themes give keepers a soft pale rim; light themes need none', async () => {
  const { keeperRim, KSIZE } = await import('../buildings.js');
  assert.ok(KSIZE >= 1.8, 'keepers read at board size');
  for (const k of KEEPER_KINDS) {
    assert.equal(keeperRim(k, palFor('light')), null);
    const rim = keeperRim(k, palFor('dark'));
    assert.ok(rim && rim.alpha > 0.3 && rim.blur > 0, k);
    assert.ok(
      rgbToHsl(rim.color).l > rgbToHsl(keeperColors(k, palFor('dark')).body).l,
      `${k}: rim lighter than the body`,
    );
    // The rim is actually applied when drawing.
    const r = recordingCtx();
    drawKeeper(r.ctx, k, 0, 0, 1, palFor('dark'), 0);
    assert.ok(String(r.ctx.shadowColor || '').startsWith('rgba('), `${k}: shadowColor set`);
  }
});
