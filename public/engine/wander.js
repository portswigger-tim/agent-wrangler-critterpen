// Pure movement helpers: critters wandering around their island, keeping a
// little personal space, and queueing at the bell. Positions are island-local
// (u, v) in the unit disk, so a critter stays on its island however the island
// moves or grows; layout.islandPoint() maps them to the world.

import { TAU } from './util.js';

/** How far out wander targets may go (the rim is reserved for the edge). */
export const WANDER_R = 0.88;
/** Give up on a target after this long (a neighbour may be standing on it). */
const MAX_WALK = 6;

/** Uniform random point in the disk of radius maxR. */
export function randomPoint(rand, maxR = WANDER_R) {
  const a = rand() * TAU, d = Math.sqrt(rand()) * maxR;
  return { u: Math.cos(a) * d, v: Math.sin(a) * d };
}

/** Pull (u, v) back inside the disk of radius maxR. Mutates and returns p. */
export function clampDisk(p, maxR = 1) {
  const d = Math.hypot(p.u, p.v);
  if (d > maxR) { p.u *= maxR / d; p.v *= maxR / d; }
  return p;
}

/** Wander state starting at (u, v), resting for a moment before the first stroll. */
export function createWander(u, v, rand) {
  return { u, v, tu: u, tv: v, wait: 0.5 + rand() * 2.5, walk: 0 };
}

/**
 * Advance one wander step: rest, then stroll to a random point, then rest again.
 * `speed` is in disk units per second; 0 means stay put (sleeping, wobbling).
 */
export function stepWander(w, dt, rand, { speed, pauseMin = 1.2, pauseMax = 4.5 }) {
  if (!(speed > 0)) return w;
  if (w.wait > 0) {
    w.wait -= dt;
    if (w.wait <= 0) {
      const p = randomPoint(rand);
      w.tu = p.u; w.tv = p.v; w.walk = 0;
    }
    return w;
  }
  w.walk += dt;
  const du = w.tu - w.u, dv = w.tv - w.v, d = Math.hypot(du, dv), step = speed * dt;
  if (d <= step || w.walk > MAX_WALK) {
    if (d <= step) { w.u = w.tu; w.v = w.tv; }
    w.wait = pauseMin + rand() * (pauseMax - pauseMin);
  } else {
    w.u += (du / d) * step;
    w.v += (dv / d) * step;
  }
  clampDisk(w, 1);
  return w;
}

/**
 * Nudge critters sharing an island apart so they don't stand inside each
 * other. Distances are measured in world units (`ax`, `ay` = how many px one
 * disk unit spans across and deep). Mutates the states; always stays in the disk.
 * @param {Array<{u:number,v:number}>} list
 * @param {number} minDist world px
 */
export function separate(list, minDist, ax, ay, strength = 0.5) {
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      let dx = (a.u - b.u) * ax, dy = (a.v - b.v) * ay;
      let d = Math.hypot(dx, dy);
      if (d >= minDist) continue;
      if (d < 1e-6) { dx = i < j ? -1 : 1; dy = 0; d = 1; } // exactly stacked: split sideways
      const push = ((minDist - d) / 2) * strength;
      a.u += ((dx / d) * push) / ax; a.v += ((dy / d) * push) / ay;
      b.u -= ((dx / d) * push) / ax; b.v -= ((dy / d) * push) / ay;
      clampDisk(a, 1); clampDisk(b, 1);
    }
  }
  return list;
}

/** Spot i in the queue at the bell: alternating left/right, a little in front. */
export function bellSlot(i, bell, r) {
  const side = i % 2 === 0 ? -1 : 1;
  const step = Math.floor(i / 2) + 1;
  return { x: bell.x + side * step * r * 2.6, y: bell.baseY + r * 0.35 };
}

/** Wander speed (disk units/s) and pauses per status; finished, asleep and error stay put. */
export function wanderPace(status) {
  switch (status) {
    case 'working': return { speed: 0.22, pauseMin: 0.8, pauseMax: 2.5 };
    case 'thinking': return { speed: 0.1, pauseMin: 2.5, pauseMax: 6 };
    case 'idle': return { speed: 0.06, pauseMin: 4, pauseMax: 9 };
    default: return { speed: 0 };
  }
}
