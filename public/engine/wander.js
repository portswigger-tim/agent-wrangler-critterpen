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
export function stepWander(w, dt, rand, { speed, pauseMin = 1.2, pauseMax = 4.5, around = null }) {
  if (!(speed > 0)) return w;
  if (w.wait > 0) {
    w.wait -= dt;
    if (w.wait <= 0) {
      // `around` keeps a stroll near a point: a parent near the middle, a child near its parent.
      const p = around ? randomPoint(rand, around.rad) : randomPoint(rand);
      const t = clampDisk({ u: (around ? around.u : 0) + p.u, v: (around ? around.v : 0) + p.v }, WANDER_R);
      w.tu = t.u; w.tv = t.v; w.walk = 0;
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
 * disk unit spans across and deep). Items that carry `rad` (their radius in px)
 * keep (a.rad + b.rad) × PERSONAL_SPACE / 2 apart, so big critters get more
 * room; otherwise `minDist` applies. An item's `m` (mobility, default 1) sets
 * how much of each push it takes, so a parent (low m) stays put while its
 * children make room. Mutates the states; always stays in the disk.
 * @param {Array<{u:number,v:number,rad?:number,m?:number}>} list
 * @param {number} minDist world px
 */
export function separate(list, minDist, ax, ay, strength = 0.5) {
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      let dx = (a.u - b.u) * ax, dy = (a.v - b.v) * ay;
      let d = Math.hypot(dx, dy);
      const need = a.rad && b.rad ? ((a.rad + b.rad) * PERSONAL_SPACE) / 2 : minDist;
      if (d >= need) continue;
      if (d < 1e-6) { dx = i < j ? -1 : 1; dy = 0; d = 1; } // exactly stacked: split sideways
      const ma = a.m ?? 1, mb = b.m ?? 1;
      const total = (need - d) * strength;
      const pa = (total * ma) / (ma + mb), pb = (total * mb) / (ma + mb);
      a.u += ((dx / d) * pa) / ax; a.v += ((dy / d) * pa) / ay;
      b.u -= ((dx / d) * pb) / ax; b.v -= ((dy / d) * pb) / ay;
      clampDisk(a, 1); clampDisk(b, 1);
    }
  }
  return list;
}

/**
 * Personal space, in critter radii, between two critters' feet. Bodies are at
 * most ~1.08r wide each (size jitter, squash, breathing), so this keeps them
 * from ever touching, and 3r also leaves room for each name to sit right
 * under its own critter.
 */
export const PERSONAL_SPACE = 3;

/** How many world px one disk unit spans across (ax) and deep (ay) on an island. */
export const islandAxes = (isl, r) => ({ ax: Math.max(1, isl.rx - r * 0.9), ay: Math.max(1, isl.ry - r * 0.4) });

/**
 * Personal space counts depth at this weight: critters one behind the other
 * keep a third more room than side by side, so a hopping front critter
 * doesn't bump the one standing behind it.
 */
export const DEPTH_WEIGHT = 0.75;

/** Spread spots out until no two are closer than minDist world px (as far as the island allows). */
export function relaxSpots(spots, ax, ay, minDist, iterations = 300) {
  const list = spots.map((p) => ({ u: p.u, v: p.v, ...(p.rad ? { rad: p.rad } : {}), ...(p.m != null ? { m: p.m } : {}) }));
  for (let i = 0; i < iterations; i++) separate(list, minDist, ax, ay, 1);
  return list;
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
