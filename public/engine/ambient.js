// Ambient particles: fireflies on dark themes, drifting petals and motes on
// light ones. Stateless: each particle is a pure function of (index, time,
// canvas size), so there is nothing to update, store or clean up.

import { hash32, rng, clamp, TAU } from './util.js';
import { toCss, mix, lighten, pastel } from './color.js';

/** How many particles suit a W×H pen: sparse, never a blizzard. */
export function ambientCount(W, H) {
  return clamp(Math.round((W * H) / 30000), 4, 30);
}

const traits = [];
function trait(i) {
  if (!traits[i]) {
    const r = rng(hash32(`ambient:${i}`));
    traits[i] = { u: r(), v: r(), ph: r() * TAU, ph2: r() * TAU, sp: r(), sz: r(), kind: r() };
  }
  return traits[i];
}

/**
 * Where particle `i` is at time `t`.
 * @param {number} i
 * @param {number} t seconds
 * @param {number} W
 * @param {number} H
 * @param {boolean} dark
 * @param {Array<{cx:number, cy:number, rx:number, ry:number}>} [areas] keep fireflies around these (islands)
 * @returns {{ x: number, y: number, a: number, size: number, rot: number, flutter: number, kind: 'firefly'|'petal'|'mote' }}
 */
export function particleAt(i, t, W, H, dark, areas) {
  const p = trait(i);
  if (dark) {
    let bx = p.u * W,
      by = p.v * H,
      ax = 26,
      ay = 16;
    if (areas?.length) {
      const ar = areas[i % areas.length];
      bx = ar.cx + (p.u - 0.5) * 2 * ar.rx * 0.95;
      by = ar.cy - ar.ry * 0.4 - p.v * Math.max(30, ar.ry * 3);
      ax = Math.min(26, ar.rx * 0.3);
    }
    const x = bx + Math.sin(t * (0.31 + p.sp * 0.2) + p.ph) * ax + Math.sin(t * 0.83 + p.ph2) * ax * 0.35;
    const y = by + Math.cos(t * (0.27 + p.sp * 0.15) + p.ph2) * ay + Math.sin(t * 1.1 + p.ph) * ay * 0.3;
    // Slow, uneven glow: mostly dim, now and then a soft bloom.
    const s = Math.sin(t * (0.55 + p.sp * 0.5) + p.ph);
    const a = 0.12 + 0.88 * Math.max(0, s) ** 3;
    return {
      x: clamp(x, 2, W - 2),
      y: clamp(y, 2, H - 2),
      a,
      size: 1.3 + p.sz * 1.2,
      rot: 0,
      flutter: 1,
      kind: 'firefly',
    };
  }
  if (p.kind < 0.55) {
    // Petal: falls slowly on a diagonal, swaying and tumbling, then wraps.
    const span = H + 40,
      speed = 9 + p.sp * 9;
    const y = ((p.v * span + t * speed) % span) - 20;
    const x = (((p.u * W + t * (4 + p.sp * 5) + Math.sin(t * 0.7 + p.ph) * 22) % W) + W) % W;
    return {
      x,
      y,
      a: 0.55,
      size: 3 + p.sz * 2,
      rot: t * (0.6 + p.sp) + p.ph,
      flutter: Math.cos(t * (1.6 + p.sp) + p.ph2),
      kind: 'petal',
    };
  }
  // Mote: a speck of pollen drifting up through the light.
  const span = H + 20,
    speed = 3 + p.sp * 4;
  const y = H + 10 - ((p.v * span + t * speed) % span);
  const x = p.u * W + Math.sin(t * 0.4 + p.ph) * 14;
  const a = 0.25 + 0.25 * Math.sin(t * 0.9 + p.ph2);
  return { x: clamp(x, 2, W - 2), y, a, size: 1 + p.sz * 1.3, rot: 0, flutter: 1, kind: 'mote' };
}

/**
 * Draw the ambient layer (call after the floor, before critters).
 * Nothing at all under reduced motion.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ W: number, H: number, pal: any, time: number, reduced: boolean, areas?: Array<{cx:number, cy:number, rx:number, ry:number}> }} o
 */
export function drawAmbient(ctx, { W, H, pal, time, reduced, areas }) {
  if (reduced || W < 40 || H < 40) return;
  const n = ambientCount(W, H);
  const glow = lighten(mix(pal.yellow, pal.green, 0.3), 0.35);
  const petal = mix(pastel(pal.red, false), pal.bg, 0.25);
  const petal2 = mix(pastel(pal.accent, false), pal.bg, 0.3);
  const mote = mix(pal.yellow, pal.bg, 0.2);
  ctx.save();
  for (let i = 0; i < n; i++) {
    const q = particleAt(i, time, W, H, pal.dark, areas);
    if (q.a <= 0.02) continue;
    if (q.kind === 'firefly') {
      const R = q.size * 5;
      const g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, R);
      g.addColorStop(0, toCss(glow, 0.38 * q.a));
      g.addColorStop(1, toCss(glow, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(q.x, q.y, R, 0, TAU);
      ctx.fill();
      ctx.fillStyle = toCss(lighten(glow, 0.5), 0.9 * q.a);
      ctx.beginPath();
      ctx.arc(q.x, q.y, q.size * 0.7, 0, TAU);
      ctx.fill();
    } else if (q.kind === 'petal') {
      ctx.save();
      ctx.translate(q.x, q.y);
      ctx.rotate(q.rot);
      ctx.scale(Math.max(0.15, Math.abs(q.flutter)), 1);
      ctx.fillStyle = toCss(i % 3 ? petal : petal2, q.a);
      ctx.beginPath();
      ctx.moveTo(0, -q.size);
      ctx.quadraticCurveTo(q.size * 0.9, 0, 0, q.size);
      ctx.quadraticCurveTo(-q.size * 0.9, 0, 0, -q.size);
      ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = toCss(mote, q.a);
      ctx.beginPath();
      ctx.arc(q.x, q.y, q.size, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}

const CLOUDS = 5,
  STARS = 40;

/**
 * Where cloud `i` sits at time `t`: drifts slowly right and wraps. Puffs are
 * offsets in units of the cloud's size.
 */
export function cloudAt(i, t, W, horizon) {
  const r = rng(hash32(`cloud:${i}`));
  const size = 18 + r() * 22,
    speed = 2.5 + r() * 4;
  const span = W + size * 6;
  const x = ((r() * span + t * speed) % span) - size * 3;
  const y = 18 + r() * Math.max(10, horizon * 0.42);
  const puffs = [
    [0, 0, 1],
    [-1.1, 0.25, 0.7],
    [1.15, 0.2, 0.75],
    [0.45, -0.45, 0.72],
    [-0.5, -0.3, 0.6],
  ].map(([dx, dy, s]) => [dx * (0.85 + r() * 0.3), dy, s * (0.85 + r() * 0.3)]);
  return { x, y, size, puffs };
}

/**
 * Soft sky behind everything: a gentle gradient from the theme's blue down to
 * the background at the horizon, drifting clouds on light themes and faint
 * twinkling stars on dark ones. Clouds and stars hold still under reduced motion.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ W: number, H: number, pal: any, time: number, reduced: boolean, horizon?: number }} o
 */
export function drawSky(ctx, { W, H, pal, time, reduced, horizon = H }) {
  if (W < 40 || H < 40) return;
  const t = reduced ? 0 : time;
  const top = pal.dark ? mix(pal.bg, pal.blue, 0.1) : lighten(mix(pal.bg, pal.blue, 0.22), 0.25);
  const low = pal.dark ? mix(pal.bg, pal.accent, 0.04) : mix(pal.bg, pal.yellow, 0.06);
  ctx.save();
  const g = ctx.createLinearGradient(0, 0, 0, horizon);
  g.addColorStop(0, toCss(top));
  g.addColorStop(1, toCss(low));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, horizon);
  if (pal.dark) {
    const star = lighten(mix(pal.fg, pal.yellow, 0.2), 0.2);
    for (let i = 0; i < STARS; i++) {
      const r = rng(hash32(`star:${i}`));
      const x = r() * W,
        y = r() * horizon * 0.7,
        ph = r() * TAU,
        sp = 0.4 + r() * 1.2;
      const a = 0.15 + 0.35 * (0.5 + 0.5 * Math.sin(t * sp + ph));
      ctx.fillStyle = toCss(star, a * (1 - y / horizon));
      ctx.beginPath();
      ctx.arc(x, y, 0.6 + r() * 0.7, 0, TAU);
      ctx.fill();
    }
  } else {
    const body = lighten(pal.bg, 0.75),
      belly = mix(pal.bg, pal.blue, 0.08);
    for (let i = 0; i < CLOUDS; i++) {
      const c = cloudAt(i, t, W, horizon);
      const cg = ctx.createLinearGradient(0, c.y - c.size, 0, c.y + c.size * 0.6);
      cg.addColorStop(0, toCss(body, 0.85));
      cg.addColorStop(1, toCss(belly, 0.75));
      ctx.fillStyle = cg;
      ctx.beginPath();
      for (const [dx, dy, s] of c.puffs) {
        ctx.moveTo(c.x + dx * c.size + s * c.size, c.y + dy * c.size);
        ctx.arc(c.x + dx * c.size, c.y + dy * c.size, s * c.size, 0, TAU);
      }
      ctx.fill();
    }
  }
  ctx.restore();
}
