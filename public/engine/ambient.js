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
    const r = rng(hash32('ambient:' + i));
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
    let bx = p.u * W, by = p.v * H, ax = 26, ay = 16;
    if (areas && areas.length) {
      const ar = areas[i % areas.length];
      bx = ar.cx + (p.u - 0.5) * 2 * ar.rx * 0.95;
      by = ar.cy - ar.ry * 0.4 - p.v * Math.max(30, ar.ry * 3);
      ax = Math.min(26, ar.rx * 0.3);
    }
    const x = bx + Math.sin(t * (0.31 + p.sp * 0.2) + p.ph) * ax + Math.sin(t * 0.83 + p.ph2) * ax * 0.35;
    const y = by + Math.cos(t * (0.27 + p.sp * 0.15) + p.ph2) * ay + Math.sin(t * 1.1 + p.ph) * ay * 0.3;
    // Slow, uneven glow: mostly dim, now and then a soft bloom.
    const s = Math.sin(t * (0.55 + p.sp * 0.5) + p.ph);
    const a = 0.12 + 0.88 * Math.pow(Math.max(0, s), 3);
    return { x: clamp(x, 2, W - 2), y: clamp(y, 2, H - 2), a, size: 1.3 + p.sz * 1.2, rot: 0, flutter: 1, kind: 'firefly' };
  }
  if (p.kind < 0.55) {
    // Petal: falls slowly on a diagonal, swaying and tumbling, then wraps.
    const span = H + 40, speed = 9 + p.sp * 9;
    const y = ((p.v * span + t * speed) % span) - 20;
    const x = (((p.u * W + t * (4 + p.sp * 5) + Math.sin(t * 0.7 + p.ph) * 22) % W) + W) % W;
    return { x, y, a: 0.55, size: 3 + p.sz * 2, rot: t * (0.6 + p.sp) + p.ph, flutter: Math.cos(t * (1.6 + p.sp) + p.ph2), kind: 'petal' };
  }
  // Mote: a speck of pollen drifting up through the light.
  const span = H + 20, speed = 3 + p.sp * 4;
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
      ctx.beginPath(); ctx.arc(q.x, q.y, R, 0, TAU); ctx.fill();
      ctx.fillStyle = toCss(lighten(glow, 0.5), 0.9 * q.a);
      ctx.beginPath(); ctx.arc(q.x, q.y, q.size * 0.7, 0, TAU); ctx.fill();
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
      ctx.beginPath(); ctx.arc(q.x, q.y, q.size, 0, TAU); ctx.fill();
    }
  }
  ctx.restore();
}
