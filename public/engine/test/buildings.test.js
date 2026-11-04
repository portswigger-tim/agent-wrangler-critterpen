import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ISLET_KINDS, UNIT, buildingFootprint, isletFootprint, isletBob, hitPose, bellQueueSlots,
  buildingColor, drawServiceBuilding, drawCarrier, drawIslet, drawCaptionPlank,
} from '../buildings.js';
import { LANDMARK_KINDS } from '../contract.js';
import { resolvePalette, isDark, rgbToHsl, hueDistance } from '../color.js';
import { kindColor } from '../art.js';

const palFor = (mode) => { const p = resolvePalette({}, mode); return { ...p, dark: isDark(p.bg) }; };

/** A recording 2D context that also checks save/restore stay balanced. */
function recordingCtx() {
  let depth = 0, minDepth = 0;
  const calls = [];
  const grad = { addColorStop() {} };
  const target = {};
  const ctx = new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => grad;
      if (k === 'measureText') return (s) => ({ width: String(s).length * 6 });
      if (k === 'save') return () => { depth++; calls.push('save'); };
      if (k === 'restore') return () => { depth--; minDepth = Math.min(minDepth, depth); calls.push('restore'); };
      return (...a) => calls.push(String(k) + '(' + a.map((v) => (typeof v === 'number' ? v.toFixed(2) : '')).join(',') + ')');
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return { ctx, calls, get depth() { return depth; }, get minDepth() { return minDepth; } };
}

test('there is a building for every landmark kind', () => {
  assert.deepEqual([...ISLET_KINDS].sort(), [...LANDMARK_KINDS].sort());
});

test('buildings are about 2–2.5× the old landmarks (~45px) and scale linearly', () => {
  for (const kind of ISLET_KINDS) {
    const f = buildingFootprint(kind, 1);
    assert.ok(f.top >= 85 && f.top <= 130, `${kind} height ${f.top}`);
    assert.ok(f.w > 50 && f.w < 120, `${kind} width ${f.w}`);
    const h = buildingFootprint(kind, 0.5);
    assert.ok(Math.abs(h.top - f.top / 2) < 1e-9 && Math.abs(h.w - f.w / 2) < 1e-9);
  }
});

test('islet footprints: positive, the bell islet is the big one, scale is linear', () => {
  const bell = isletFootprint('human');
  for (const kind of ISLET_KINDS) {
    const f = isletFootprint(kind, 1);
    for (const k of ['rx', 'ry', 'top', 'bottom', 'r']) assert.ok(f[k] > 0, `${kind}.${k}`);
    assert.ok(f.r >= f.rx && f.r >= (f.top + f.bottom) / 2 - 1e-9, `${kind} radius covers it`);
    assert.ok(f.top >= buildingFootprint(kind).top, `${kind} islet leaves room for its building`);
    if (kind !== 'human') assert.ok(bell.rx > f.rx * 2, `bell islet wider than ${kind}`);
    assert.ok(Math.abs(isletFootprint(kind, 2).r - 2 * f.r) < 1e-9);
  }
});

test('bob is deterministic, gentle, per-kind, and still under reduced motion', () => {
  for (const kind of ISLET_KINDS) {
    for (const t of [0, 1.3, 7, 100]) {
      assert.equal(isletBob(kind, t), isletBob(kind, t));
      assert.ok(Math.abs(isletBob(kind, t)) <= 2.6 + 1e-9);
      assert.equal(isletBob(kind, t, 1, true), 0);
    }
  }
  assert.notEqual(isletBob('git', 3), isletBob('pr', 3), 'islets bob out of step');
});

test('hitPose: rest at 0, flag up during a hit and down again at the end', () => {
  assert.deepEqual(hitPose(0), { p: 1, h: 0, squash: 0, shake: 0, flag: 0, flash: 0, lift: 0 });
  assert.deepEqual(hitPose(-1), hitPose(0));
  const impact = hitPose(1);
  assert.equal(impact.flag, 0, 'flag starts down at impact');
  assert.equal(impact.flash, 1, 'windows flash brightest at impact');
  assert.ok(hitPose(0.6).flag > 0.9, 'flag is up mid-hit');
  assert.ok(hitPose(0.05).flag < 0.3, 'and lowers as the hit fades');
  for (let h = 0; h <= 1; h += 0.05) {
    const p = hitPose(h);
    assert.ok(Math.abs(p.shake) <= 1 && p.squash >= -1e-9 && p.squash <= 1 && p.lift >= -1e-9 && p.lift <= 1, `h=${h}`);
  }
});

test('bell queue: four either side, nearest first, no bodies overlapping each other or the bell', () => {
  for (const [scale, r] of [[1, 18], [0.7, 12.6], [1.3, 23.4]]) {
    const slots = bellQueueSlots(scale, r);
    assert.equal(slots.length, 8);
    assert.equal(slots.filter((s) => s.side > 0).length, 4);
    assert.equal(slots.filter((s) => s.side < 0).length, 4);
    for (const s of slots) assert.equal(Math.sign(s.dx), s.side);
    const half = buildingFootprint('human', scale).w / 2;
    for (const s of slots) assert.ok(Math.abs(s.dx) - r >= half - 1e-9, 'clear of the bell frame');
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const d = Math.hypot(slots[i].dx - slots[j].dx, slots[i].dy - slots[j].dy);
        assert.ok(d >= 2 * r - 1e-9, `slots ${i},${j} overlap (${d.toFixed(1)} < ${2 * r})`);
      }
    }
    // Nearest first on each side.
    for (const side of [1, -1]) {
      const xs = slots.filter((s) => s.side === side).map((s) => Math.abs(s.dx));
      assert.deepEqual(xs, [...xs].sort((a, b) => a - b));
    }
    // They fit on the bell islet.
    const f = isletFootprint('human', scale);
    for (const s of slots) assert.ok(Math.abs(s.dx) + r <= f.rx * 1.02, `slot ${s.dx.toFixed(1)} on the islet`);
  }
});

test('building colours come from the theme kind colours, softened', () => {
  for (const mode of ['dark', 'light']) {
    const pal = palFor(mode);
    for (const kind of ISLET_KINDS) {
      const raw = rgbToHsl(kindColor(kind, pal)), soft = rgbToHsl(buildingColor(kind, pal));
      if (raw.s > 0.2) assert.ok(hueDistance(raw.h, soft.h) < 1, `${mode} ${kind}`);
    }
  }
});

test('every building, carrier and caption draws in both themes with save/restore balanced', () => {
  for (const mode of ['dark', 'light']) {
    const pal = palFor(mode);
    for (const kind of ISLET_KINDS) {
      for (const hit of [0, 0.5, 1]) {
        const r = recordingCtx();
        drawServiceBuilding(r.ctx, kind, 100, 200, 1, pal, 3.2, { hit, waiting: 1 });
        const base = drawCarrier(r.ctx, 'islet', kind, 100, 200, 1, pal, 3.2);
        drawCaptionPlank(r.ctx, 100, base.captionY, kind, pal, 1);
        drawIslet(r.ctx, kind, 100, 200, 0.8, pal, 3.2, { hit, waiting: 0.5, caption: kind });
        assert.equal(r.depth, 0, `${mode} ${kind} hit=${hit}: save/restore balanced`);
        assert.ok(r.minDepth >= 0, 'never restores more than it saved');
        assert.ok(r.calls.some((c) => c.startsWith('fill(')), 'drew something');
      }
    }
  }
});

test('reduced motion: a building looks the same at any time and ignores hits', () => {
  const pal = palFor('dark');
  for (const kind of ISLET_KINDS) {
    const at = (t, hit) => { const r = recordingCtx(); drawIslet(r.ctx, kind, 100, 200, 1, pal, t, { hit, reduced: true }); return r.calls.join(';'); };
    assert.equal(at(0, 0), at(42, 0.8), kind);
  }
});

test('units: one building unit is UNIT px at scale 1', () => {
  assert.equal(UNIT, 2.2);
});

test('phone box: double-ring cadence, pure and periodic', async () => {
  const { phoneRinging } = await import('../buildings.js');
  assert.equal(phoneRinging(0.2), 1);
  assert.equal(phoneRinging(0.5), 0, 'gap between the two rings');
  assert.equal(phoneRinging(0.8), 1);
  assert.equal(phoneRinging(2), 0, 'pause');
  for (const t of [0.1, 0.7, 1.7, 2.9]) assert.equal(phoneRinging(t), phoneRinging(t + 3));
  for (let t = 0; t < 6; t += 0.01) assert.ok(phoneRinging(t) >= 0 && phoneRinging(t) <= 1);
});

test('phone box: the front of the queue holds the receiver, beside the box door', async () => {
  const { PHONE_HOLDER_SLOT, phoneSocket, receiverSpot } = await import('../buildings.js');
  for (const [scale, r] of [[1, 18], [0.7, 12.6]]) {
    const slots = bellQueueSlots(scale, r);
    const front = slots[PHONE_HOLDER_SLOT];
    for (const s of slots.filter((x) => x.side === front.side)) assert.ok(Math.abs(s.dx) >= Math.abs(front.dx), 'holder is nearest the box');
    const sock = phoneSocket(scale);
    assert.ok(sock.dx > 0 && sock.dy < 0, 'socket on the door side, up the box');
    const rs = receiverSpot(r, front.side);
    const hand = front.dx + rs.dx;
    assert.ok(Math.abs(hand) < Math.abs(front.dx), 'receiver on the cheek facing the box');
    assert.ok(Math.abs(hand) > sock.dx, 'the receiver is out past the socket, so the cord runs outward');
  }
});

test('phone box keeps the bell footprint, so placement is unchanged', () => {
  const f = isletFootprint('human', 1);
  assert.equal(f.rx, 140);
  assert.equal(f.ry, 32);
  assert.ok(Math.abs(f.top - (48 * UNIT + 12)) < 1e-9);
  assert.ok(Math.abs(buildingFootprint('human', 1).w - 44 * UNIT) < 1e-9);
});
