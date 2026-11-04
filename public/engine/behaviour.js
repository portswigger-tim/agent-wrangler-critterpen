// Personality: small, rare, varied behaviours layered over the status pose.
// Pure and deterministic. A critter's ambient schedule is a function of its
// seed alone, so the same (seed, time, context) always gives the same answer,
// and triggered behaviours depend only on when they were triggered.

import { rng, clamp, lerp } from './util.js';

/**
 * Behaviour catalogue. `statuses` = when an ambient behaviour may play;
 * `social` ones need a neighbour to look at. Triggered ones play on events.
 */
export const BEHAVIOURS = {
  yawn: { dur: 2.6, statuses: ['idle', 'asleep'] },
  stretch: { dur: 2.2, statuses: ['idle'] },
  lookAround: { dur: 2.8, statuses: ['idle', 'working', 'thinking', 'finished'] },
  chat: { dur: 3.2, statuses: ['idle', 'working', 'thinking'], social: true },
  glance: { dur: 1.6, statuses: ['idle', 'working', 'thinking', 'needs-you', 'finished'], social: true },
  hum: { dur: 3.0, statuses: ['idle', 'thinking'] },
  wave: { dur: 1.8, triggered: true },
  wiggle: { dur: 1.4, triggered: true },
};
export const AMBIENT_KINDS = Object.keys(BEHAVIOURS).filter((k) => !BEHAVIOURS[k].triggered);

/** Quiet time between ambient behaviours, and before the first one (seconds). */
export const GAP_MIN = 8, GAP_MAX = 26;
export const FIRST_MIN = 2, FIRST_MAX = 16;
const EASE = 0.3; // seconds to ease into / out of a behaviour

/**
 * Endless ambient schedule for one critter: { kind, start, dur, pick }.
 * Consecutive behaviours never share a kind, and gaps sit in [GAP_MIN, GAP_MAX].
 * @param {number} seed
 */
export function* schedule(seed) {
  const r = rng((seed ^ 0x5bd1e995) >>> 0);
  const n = AMBIENT_KINDS.length;
  let t = FIRST_MIN + r() * (FIRST_MAX - FIRST_MIN);
  let prev = -1;
  for (;;) {
    const i = prev < 0 ? Math.floor(r() * n) : (prev + 1 + Math.floor(r() * (n - 1))) % n;
    const kind = AMBIENT_KINDS[i];
    const ev = { kind, start: t, dur: BEHAVIOURS[kind].dur, pick: r() };
    yield ev;
    prev = i;
    t += ev.dur + GAP_MIN + r() * (GAP_MAX - GAP_MIN);
  }
}

/**
 * Per-critter behaviour state. `at(t, ctx)` answers "what is this critter doing
 * for fun at time t", or null.
 * @param {number} seed
 */
export function createMind(seed) {
  let gen = schedule(seed);
  let cur = gen.next().value, next = gen.next().value;
  let triggered = null;

  function ambientAt(t) {
    if (t < cur.start) { gen = schedule(seed); cur = gen.next().value; next = gen.next().value; } // time went back
    while (t >= next.start) { cur = next; next = gen.next().value; }
    return t >= cur.start && t < cur.start + cur.dur ? cur : null;
  }

  return {
    /**
     * Play a triggered behaviour ('wave', 'wiggle'), optionally after a delay
     * and aimed at another critter. Replaces any triggered one still pending.
     */
    trigger(kind, t, { delay = 0, targetId = null } = {}) {
      const def = BEHAVIOURS[kind];
      if (!def || !def.triggered) return;
      triggered = { kind, start: t + delay, dur: def.dur, pick: (seed % 997) / 997, target: targetId };
    },
    /**
     * @param {number} t pen time, seconds
     * @param {{ status?: string, reduced?: boolean, neighbours?: string[] }} [ctx]
     *   neighbours: ids of critters close enough to chat with (sorted by the caller or not; we sort)
     * @returns {null | { kind: string, age: number, dur: number, k: number, target: string|null, pick: number }}
     */
    at(t, ctx = {}) {
      if (ctx.reduced) { triggered = null; return null; }
      if (triggered && t >= triggered.start) {
        if (t < triggered.start + triggered.dur) return describe(triggered, t, triggered.target);
        triggered = null;
      }
      const ev = ambientAt(t);
      if (!ev) return null;
      const def = BEHAVIOURS[ev.kind];
      if (ctx.status && !def.statuses.includes(ctx.status)) return null;
      let target = null;
      if (def.social) {
        const n = [...(ctx.neighbours || [])].sort();
        if (!n.length) return null;
        target = n[Math.floor(ev.pick * n.length)];
      }
      return describe(ev, t, target);
    },
  };
}

function describe(ev, t, target) {
  const age = t - ev.start;
  return { kind: ev.kind, age, dur: ev.dur, k: age / ev.dur, target, pick: ev.pick };
}

const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

/** 0→1→0 envelope that eases in and out over EASE seconds. */
export function envelope(b) {
  return smooth(b.age / EASE) * smooth((b.dur - b.age) / EASE);
}

/**
 * Pose modifiers for a behaviour. Numbers are deltas (dx, dy, rot) or
 * multipliers (sx, sy); everything else overrides the status pose.
 * @param {{kind:string, age:number, dur:number, k:number, pick:number}} b
 * @param {number} r body radius
 * @param {{x:number, y:number}|null} dir unit vector toward the target critter
 */
export function behaviourPose(b, r, dir = null) {
  const e = envelope(b), on = e > 0.5, a = b.age, k = b.k;
  const m = { w: e };
  switch (b.kind) {
    case 'yawn': {
      // Breathe in, big yawn with a lean back, settle with drowsy lids.
      const open = smooth((k - 0.15) / 0.2) * smooth((0.78 - k) / 0.15);
      m.sy = 1 + 0.1 * open * e - 0.03 * smooth(k / 0.15) * (1 - open);
      m.sx = 1 - 0.04 * open * e;
      m.rot = -0.06 * open;
      m.dy = -open * r * 0.05;
      if (on) { m.mouth = open > 0.15 ? 'yawn' : 'small-o'; m.mouthOpen = open; m.lidTop = lerp(0.55, 1, open); m.lidBot = 0.25 * open; }
      break;
    }
    case 'stretch': {
      const up = smooth(k / 0.3) * smooth((1 - k) / 0.25);
      m.sy = 1 + 0.14 * up;
      m.sx = 1 - 0.07 * up;
      m.dy = -up * r * 0.08;
      m.rot = Math.sin(a * 3.2) * 0.05 * up;
      if (on) { m.eyes = 'happy'; m.mouth = 'o'; m.arms = 0.25 - 0.15 * up; m.armsUp = up; }
      break;
    }
    case 'lookAround': {
      // Left, hold, right, hold, back to centre.
      const gx = k < 0.35 ? -smooth(k / 0.15) : k < 0.75 ? lerp(-1, 1, smooth((k - 0.35) / 0.15)) : lerp(1, 0, smooth((k - 0.75) / 0.2));
      m.lookX = gx * 0.95; m.lookY = -0.15;
      m.dx = gx * r * 0.04 * e;
      if (on) { m.lidTop = 0; m.wake = true; }
      break;
    }
    case 'chat': {
      const talk = Math.sin(a * 13) > 0;
      if (dir) { m.lookX = dir.x; m.lookY = clamp(dir.y, -0.5, 0.5); m.rot = dir.x * 0.08 * e; }
      m.dy = -Math.abs(Math.sin(a * 6.5)) * r * 0.05 * e;
      if (on) {
        m.mouth = talk ? 'o' : 'smile'; m.lidTop = 0; m.wake = true;
        if (k > 0.12 && k < 0.88) m.bubble = { kind: b.pick < 0.35 ? 'heart' : 'dots', k: (k - 0.12) / 0.76, side: dir && dir.x < 0 ? -1 : 1 };
      }
      break;
    }
    case 'glance': {
      const look = smooth(k / 0.15) * smooth((0.85 - k) / 0.15);
      if (dir) { m.lookX = dir.x * look; m.lookY = clamp(dir.y, -0.5, 0.5) * look; }
      m.w = look;
      if (on) { m.lidTop = 0; m.wake = true; }
      break;
    }
    case 'hum': {
      m.rot = Math.sin(a * 3.4) * 0.09 * e;
      m.dx = Math.sin(a * 3.4) * r * 0.05 * e;
      if (on) { m.eyes = 'happy'; m.mouth = 'small-o'; m.bubble = { kind: 'note', k, side: Math.sin(a * 3.4) < 0 ? -1 : 1 }; }
      break;
    }
    case 'wave': {
      const hop = a < 0.4 ? Math.sin(Math.PI * a / 0.4) : 0;
      m.dy = -hop * r * 0.25;
      if (dir) { m.lookX = dir.x; m.lookY = clamp(dir.y, -0.5, 0.5); }
      if (on) { m.eyes = 'happy'; m.mouth = 'grin'; m.wave = -0.5 + Math.sin(a * 11) * 0.65; m.wake = true; }
      break;
    }
    case 'wiggle': {
      const s = Math.sin(a * 16) * (1 - k);
      m.rot = s * 0.16 * e;
      m.sx = 1 + s * 0.06 * e;
      m.sy = 1 - s * 0.06 * e;
      if (on) { m.eyes = 'happy'; m.mouth = 'grin'; m.bubble = { kind: 'heart', k, side: 1 }; m.wake = true; }
      break;
    }
  }
  return m;
}

const OVERRIDES = ['eyes', 'mouth', 'mouthOpen', 'wave', 'arms', 'armsUp', 'bubble'];

/**
 * Layer a behaviour over a status pose (returns a new pose; null b = unchanged).
 * @param {object} pose
 * @param {ReturnType<ReturnType<typeof createMind>['at']>} b
 * @param {number} r
 * @param {{x:number, y:number}|null} [dir]
 */
export function applyBehaviour(pose, b, r, dir = null) {
  if (!b) return pose;
  const m = behaviourPose(b, r, dir);
  const o = { ...pose, behaviour: b.kind };
  o.dx = (o.dx || 0) + (m.dx || 0);
  o.dy = (o.dy || 0) + (m.dy || 0);
  o.rot = (o.rot || 0) + (m.rot || 0);
  o.sx = (o.sx ?? 1) * (m.sx ?? 1);
  o.sy = (o.sy ?? 1) * (m.sy ?? 1);
  if (m.lookX !== undefined) o.lookX = lerp(o.lookX || 0, m.lookX, m.w);
  if (m.lookY !== undefined) o.lookY = lerp(o.lookY || 0, m.lookY, m.w);
  if (m.lidTop !== undefined) o.lidTop = m.lidTop;
  if (m.lidBot !== undefined) o.lidBot = m.lidBot;
  if (m.wake && o.eyes === 'closed') o.eyes = 'open';
  for (const key of OVERRIDES) if (m[key] !== undefined) o[key] = m[key];
  return o;
}

/** Fraction of [t0, t1) a mind spends in ambient behaviours (for tuning and tests). */
export function busyFraction(seed, t0, t1, ctx = {}, step = 0.1) {
  const mind = createMind(seed);
  let busy = 0, n = 0;
  for (let t = t0; t < t1; t += step, n++) if (mind.at(t, ctx)) busy++;
  return n ? busy / n : 0;
}

