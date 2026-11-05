import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BEHAVIOURS,
  AMBIENT_KINDS,
  GAP_MIN,
  GAP_MAX,
  FIRST_MIN,
  FIRST_MAX,
  schedule,
  createMind,
  behaviourPose,
  applyBehaviour,
  envelope,
  busyFraction,
} from '../behaviour.js';
import { hash32 } from '../util.js';

const SEEDS = ['s-cart', 's-pay', 's-ci', 's-api', 's-links', 'a', 'b', '7f3e-uuid'].map(hash32);
const take = (gen, n) => Array.from({ length: n }, () => gen.next().value);
const NEAR = ['n1', 'n2'];

test('the same seed and time always give the same behaviour', () => {
  for (const seed of SEEDS) {
    const a = createMind(seed),
      b = createMind(seed);
    const ctx = { status: 'idle', neighbours: NEAR };
    for (let t = 0; t < 300; t += 0.37) assert.deepEqual(a.at(t, ctx), b.at(t, ctx));
  }
});

test('answers do not depend on query order (time can jump back)', () => {
  const seed = SEEDS[0];
  const ctx = { status: 'idle', neighbours: NEAR };
  const fwd = createMind(seed),
    jumpy = createMind(seed);
  const times = Array.from({ length: 400 }, (_, i) => i * 0.5);
  const expected = times.map((t) => fwd.at(t, ctx));
  const shuffled = [...times].reverse();
  const got = new Map(shuffled.map((t) => [t, jumpy.at(t, ctx)]));
  times.forEach((t, i) => assert.deepEqual(got.get(t), expected[i], `t=${t}`));
});

test('different seeds get different schedules', () => {
  const starts = SEEDS.map((s) => take(schedule(s), 1)[0].start.toFixed(3));
  assert.ok(new Set(starts).size >= SEEDS.length - 1, 'first behaviours are staggered');
});

test('consecutive behaviours never repeat, and every kind turns up', () => {
  for (const seed of SEEDS) {
    const evs = take(schedule(seed), 200);
    for (let i = 1; i < evs.length; i++) assert.notEqual(evs[i].kind, evs[i - 1].kind, `seed ${seed} #${i}`);
    assert.deepEqual(new Set(evs.map((e) => e.kind)), new Set(AMBIENT_KINDS));
  }
});

test('rarity: first one waits, gaps stay inside bounds', () => {
  for (const seed of SEEDS) {
    const evs = take(schedule(seed), 300);
    assert.ok(evs[0].start >= FIRST_MIN && evs[0].start <= FIRST_MAX);
    for (let i = 1; i < evs.length; i++) {
      const gap = evs[i].start - (evs[i - 1].start + evs[i - 1].dur);
      assert.ok(gap >= GAP_MIN && gap <= GAP_MAX, `gap ${gap}`);
    }
  }
});

test('rarity: an idle critter is up to something well under a quarter of the time', () => {
  for (const seed of SEEDS) {
    const f = busyFraction(seed, 0, 900, { status: 'idle', neighbours: NEAR });
    assert.ok(f > 0.03 && f < 0.22, `idle busy fraction ${f.toFixed(3)}`);
    const w = busyFraction(seed, 0, 900, { status: 'working', neighbours: NEAR });
    assert.ok(w < f, 'working critters are busier, so they fidget less');
  }
});

test('status gates ambient behaviours; social ones need a neighbour', () => {
  const seed = SEEDS[2];
  for (let t = 0; t < 600; t += 0.25) {
    const err = createMind(seed).at(t, { status: 'error', neighbours: NEAR });
    assert.equal(err, null, 'no fidgeting while in error');
    const b = createMind(seed).at(t, { status: 'working', neighbours: NEAR });
    if (b) assert.ok(BEHAVIOURS[b.kind].statuses.includes('working'), b.kind);
    const lonely = createMind(seed).at(t, { status: 'idle', neighbours: [] });
    if (lonely) assert.ok(!BEHAVIOURS[lonely.kind].social, `${lonely.kind} without anyone to talk to`);
  }
  // Social targets are picked from the neighbours regardless of their order.
  const mind = createMind(seed);
  for (let t = 0; t < 600; t += 0.25) {
    const a = mind.at(t, { status: 'idle', neighbours: ['x', 'y', 'z'] });
    const b = mind.at(t, { status: 'idle', neighbours: ['z', 'x', 'y'] });
    assert.deepEqual(a, b);
    if (a && BEHAVIOURS[a.kind].social) assert.ok(['x', 'y', 'z'].includes(a.target));
  }
});

test('reduced motion switches personality off, including triggered behaviours', () => {
  for (const seed of SEEDS) {
    const mind = createMind(seed);
    mind.trigger('wave', 10, { targetId: 'kid' });
    for (let t = 0; t < 600; t += 0.2)
      assert.equal(mind.at(t, { status: 'idle', reduced: true, neighbours: NEAR }), null);
  }
});

test('triggered behaviours start after their delay, aim at the target, then end', () => {
  const mind = createMind(SEEDS[1]);
  mind.trigger('wave', 5, { delay: 0.5, targetId: 'kid' });
  const ctx = { status: 'error' }; // triggered ones ignore the status gate
  assert.notEqual(mind.at(5.2, ctx)?.kind, 'wave');
  const w = mind.at(5.6, ctx);
  assert.equal(w.kind, 'wave');
  assert.equal(w.target, 'kid');
  assert.ok(Math.abs(w.age - 0.1) < 1e-9);
  assert.notEqual(mind.at(5.5 + BEHAVIOURS.wave.dur + 0.01, ctx)?.kind, 'wave');
  mind.trigger('yawn', 1); // ambient kinds can't be triggered
  assert.equal(mind.at(1.1, ctx), null);
});

test('envelope eases in and out and pose deltas vanish at the edges', () => {
  for (const kind of Object.keys(BEHAVIOURS)) {
    const dur = BEHAVIOURS[kind].dur;
    const at = (age) => ({ kind, age, dur, k: age / dur, pick: 0.2, target: null });
    assert.equal(envelope(at(0)), 0);
    assert.ok(envelope(at(dur / 2)) > 0.99);
    assert.ok(envelope(at(dur)) < 1e-9);
    const p0 = behaviourPose(at(0), 20, { x: 1, y: 0 });
    assert.ok(Math.abs(p0.rot || 0) < 1e-9 && Math.abs(p0.dy || 0) < 1e-9, `${kind} starts from rest`);
    assert.ok(Math.abs((p0.sx ?? 1) - 1) < 1e-9 && Math.abs((p0.sy ?? 1) - 1) < 0.031, `${kind} scale at rest`);
  }
});

test('applyBehaviour layers onto the status pose without mutating it', () => {
  const pose = Object.freeze({
    dx: 1,
    dy: -2,
    sx: 1,
    sy: 1,
    rot: 0.1,
    lookX: 0,
    lookY: 0,
    eyes: 'closed',
    mouth: 'small-o',
    wave: null,
  });
  assert.equal(applyBehaviour(pose, null, 20), pose);
  const b = { kind: 'chat', age: 1.5, dur: 3.2, k: 1.5 / 3.2, pick: 0.1, target: 'n1' };
  const o = applyBehaviour(pose, b, 20, { x: -1, y: 0 });
  assert.equal(o.behaviour, 'chat');
  assert.equal(o.eyes, 'open', 'chatting wakes a sleeper');
  assert.ok(o.lookX < -0.9, 'looks at whoever it talks to');
  assert.equal(o.bubble.kind, 'heart');
  assert.equal(o.bubble.side, -1);
});
