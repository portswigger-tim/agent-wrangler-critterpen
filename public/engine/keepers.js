// Service keepers: one small creature per service building that catches and
// eats what critters throw at it. They must never be mistaken for sessions:
// not spheres (flat-bottomed, ticket, flame, balloon, worm shapes), muted
// earthy colours kept clear of every status colour, small bead eyes, no name
// label, no click and no wandering. The phone box ('human') has no keeper.
//
// (x, y) for every function here is the building's base point, the same as
// for drawServiceBuilding(); each keeper sits at a fixed spot relative to it.

import { TAU, clamp, hash32, rng } from './util.js';
import { toCss, mix, lighten, darken, rgbToHsl, hslToRgb } from './color.js';
import { ellipse, roundRect } from './art.js';
import { naturePalette } from './scene.js';

export const KEEPER_KINDS = ['git', 'pr', 'jira', 'terminal', 'web', 'files'];

/** Hover text (keepers have no name label and no click). */
export const KEEPER_NAMES = Object.freeze({
  git: 'git keeper', pr: 'PRs keeper', jira: 'Jira keeper', terminal: 'shell keeper', web: 'web keeper', files: 'files keeper',
});

const UNIT = 2.2; // same building unit as buildings.js
/** Keeper bodies are drawn in their own units, KSIZE building units each (~32px tall at scale 1). */
export const KSIZE = 1.85;

/**
 * Catch timeline: the engine starts it CATCH.lead seconds before the
 * projectile lands, and it runs for CATCH.dur seconds. In progress terms the
 * mouth opens over [0, LAND), the projectile lands at LAND, the chomp runs
 * over [LAND, CHOMP_END) and a happy wiggle fills the rest.
 */
export const CATCH = Object.freeze({ lead: 0.3, dur: 1.3 });
export const LAND = CATCH.lead / CATCH.dur;
const CHOMP_END = LAND + 0.32;
/** Catches within this many seconds count towards the "full" pose. */
export const FULL_WINDOW = 1;
/** This many recent catches makes a keeper round-bellied and full. */
export const FULL_AT = 3;

/** Catch progress 0..1 at time `now` for a projectile landing at `landAt`, or null outside it. */
export function catchProgress(now, landAt) {
  const p = (now - (landAt - CATCH.lead)) / CATCH.dur;
  return p >= 0 && p <= 1 ? p : null;
}

/** How many landings fall within FULL_WINDOW seconds before `now` (later ones not counted). */
export function recentCatches(landTimes, now, window = FULL_WINDOW) {
  let n = 0;
  for (const at of landTimes) if (at <= now && now - at <= window) n++;
  return n;
}

const SPOT = { // keeper ground point relative to the building base, in building units (in front of it)
  git: [13, 3.5], pr: [-14, 3.5], jira: [12, 4], terminal: [0, -2], web: [13, 4], files: [14, 4],
};
const MOUTH = { // mouth relative to the keeper's ground point, in keeper units
  git: [0, -5.2], pr: [0, -5.8], jira: [0, -6.2], terminal: [0, -5.8], web: [0, -9.4], files: [3.6, -4.2],
};

/** Where a keeper stands, relative to its building's base point (px). */
export function keeperSpot(kind, scale = 1) {
  const s = SPOT[kind];
  return s ? { dx: s[0] * UNIT * scale, dy: s[1] * UNIT * scale } : null;
}

/** Where projectiles should land: the keeper's mouth, relative to the building's base point (px). */
export function keeperMouth(kind, scale = 1) {
  const s = SPOT[kind], m = MOUTH[kind];
  return s ? { dx: (s[0] + m[0] * KSIZE) * UNIT * scale, dy: (s[1] + m[1] * KSIZE) * UNIT * scale } : null;
}

/** Hover circle around the keeper, relative to the building's base point (px). */
export function keeperHitbox(kind, scale = 1) {
  const s = SPOT[kind];
  return s ? { dx: s[0] * UNIT * scale, dy: (s[1] - 4.5 * KSIZE) * UNIT * scale, r: 6.5 * KSIZE * UNIT * scale } : null;
}

const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

/**
 * Pure pose for a keeper. `catchState.progress` is from catchProgress() (or
 * null), `catchState.recent` from recentCatches().
 * @returns {{ open: number, rot: number, sx: number, sy: number, dy: number, eyes: 'open'|'closed'|'happy', full: number, stamp: number, flicker: number }}
 */
export function keeperPose(kind, t, catchState = {}, reduced = false) {
  const p = catchState.progress, recent = catchState.recent || 0;
  const full = smooth((recent - (FULL_AT - 1)) / 1);
  const r = rng(hash32('keeper:' + kind));
  const ph = r() * TAU, blinkEvery = 3.2 + r() * 2.4;
  const out = { open: 0, rot: 0, sx: 1 + 0.18 * full, sy: 1 - 0.06 * full, dy: 0, eyes: full > 0.5 ? 'happy' : 'open', full, stamp: 0, flicker: 0 };
  if (reduced) {
    // Still: no sway, blink, chomp or wiggle. Only the expression changes while it eats.
    if (p != null && p >= LAND) out.eyes = 'happy';
    if (kind === 'jira' && p != null && p >= LAND) out.stamp = 1;
    return out;
  }
  // Idle: a slow sway and an occasional blink (flames flicker instead).
  out.rot = Math.sin(t * 0.9 + ph) * 0.04;
  out.flicker = Math.sin(t * 7 + ph) * 0.5 + Math.sin(t * 11.3 + ph * 2) * 0.5;
  if (((t + ph) % blinkEvery) < 0.14 && out.eyes === 'open') out.eyes = 'closed';
  if (p == null) return out;
  if (p < LAND) {
    // Anticipation: mouth opens wide as the snack arrives, a little lean back.
    const k = smooth(p / LAND);
    out.open = k;
    out.sy *= 1 + 0.08 * k;
    out.sx *= 1 - 0.04 * k;
    out.rot += -0.06 * k;
    out.eyes = 'open';
  } else if (p < CHOMP_END) {
    // Chomp: snap shut, then two quick munches with a squash.
    const q = (p - LAND) / (CHOMP_END - LAND);
    out.open = Math.abs(Math.sin(q * Math.PI * 2)) * 0.45 * (1 - q);
    const sq = Math.sin(q * Math.PI * 4) * 0.08 * (1 - q * 0.5);
    out.sx *= 1 + sq; out.sy *= 1 - sq;
    out.eyes = 'happy';
  } else {
    // Happy wiggle, settling.
    const q = (p - CHOMP_END) / (1 - CHOMP_END);
    out.rot += Math.sin(q * Math.PI * 5) * 0.16 * (1 - q);
    out.dy = -Math.abs(Math.sin(q * Math.PI * 2)) * 1.2 * (1 - q);
    out.eyes = 'happy';
  }
  if (kind === 'jira' && p >= LAND + 0.08) out.stamp = smooth((p - LAND - 0.08) / 0.1);
  return out;
}

/**
 * Soft light rim for dark themes (null on light ones): a pale glow of the
 * keeper's own colour around its silhouette.
 */
export function keeperRim(kind, pal) {
  if (!pal.dark) return null;
  const c = keeperColors(kind, pal);
  return c ? { color: lighten(c.body, 0.6), alpha: 0.55, blur: 7 } : null;
}

/** Muted earthy colours for each keeper, from the scene's nature palette. */
export function keeperColors(kind, pal) {
  const n = naturePalette(pal);
  const mute = (c, s = 0.28) => { const h = rgbToHsl(c); return hslToRgb(h.h, Math.min(h.s, s), h.l, 1); };
  switch (kind) {
    case 'git': return { body: mute(n.wood, 0.4), dark: n.woodDark, accent: n.grass };              // acorn-brown forager, leaf hat
    case 'pr': return { // a postie in oatmeal (dark themes) or khaki (light, where oatmeal sits too close to idle grey), brown cap
      body: pal.dark ? mute(lighten(n.wall, 0.05)) : mute(mix(n.wood, n.wall, 0.4), 0.35), dark: darken(n.wall, 0.45), accent: mute(n.woodDark),
    };
    case 'jira': { // our own deep slate blue (theme --blue's hue), well apart from thinking, idle, asleep and finished
      const slate = hslToRgb(rgbToHsl(pal.blue).h, 0.28, pal.dark ? 0.4 : 0.44);
      return { body: slate, dark: darken(slate, 0.4), accent: lighten(n.wall, 0.2) };
    }
    case 'terminal': return { body: mute(mix(n.dirt, n.gold, 0.35), 0.45), dark: n.dirtDark, accent: lighten(n.gold, 0.4) }; // coal-ember
    case 'web': return { body: mute(mix(n.dirt, n.wall, 0.35), 0.35), dark: n.dirtDark, accent: n.woodDark }; // dusty terracotta balloon
    case 'files': return { // a bookworm in paper cream (dark themes) or old parchment (light, clear of idle grey)
      body: pal.dark ? mute(n.wall, 0.3) : mute(darken(mix(n.wall, n.gold, 0.3), 0.08), 0.4), dark: darken(n.wall, 0.4), accent: n.woodDark,
    };
    default: return null;
  }
}

function beadEyes(ctx, u, x, y, gap, eyes, ink) {
  ctx.fillStyle = toCss(ink);
  ctx.strokeStyle = toCss(ink);
  ctx.lineWidth = 0.6 * u;
  ctx.lineCap = 'round';
  for (const s of [-1, 1]) {
    const ex = x + s * gap;
    if (eyes === 'happy') { ctx.beginPath(); ctx.arc(ex, y + 0.4 * u, 0.8 * u, 1.15 * Math.PI, 1.85 * Math.PI); ctx.stroke(); }
    else if (eyes === 'closed') { ctx.beginPath(); ctx.moveTo(ex - 0.7 * u, y); ctx.lineTo(ex + 0.7 * u, y); ctx.stroke(); }
    else {
      ellipse(ctx, ex, y, 0.75 * u, 0.85 * u); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ellipse(ctx, ex - 0.25 * u, y - 0.3 * u, 0.25 * u, 0.25 * u); ctx.fill();
      ctx.fillStyle = toCss(ink);
    }
  }
}

/** Mouth: a small line when shut, a dark oval when open (0..1). */
function mouth(ctx, u, x, y, open, ink, wide = 1) {
  if (open > 0.05) {
    // An eager "D": flat top, round bottom, a pink tongue.
    const rx = (1.1 + 0.9 * open) * u * wide, ry = (0.35 + 1.0 * open) * u;
    ctx.beginPath();
    ctx.moveTo(x - rx, y - ry * 0.35);
    ctx.lineTo(x + rx, y - ry * 0.35);
    ctx.ellipse(x, y - ry * 0.35, rx, ry * 1.35, 0, 0, Math.PI);
    ctx.closePath();
    ctx.fillStyle = toCss(darken(ink, 0.2)); ctx.fill();
    ctx.save(); ctx.clip();
    ctx.fillStyle = 'rgba(240,120,140,0.95)';
    ellipse(ctx, x, y + ry * 0.95, rx * 0.65, ry * 0.55); ctx.fill();
    ctx.restore();
  } else {
    ctx.strokeStyle = toCss(ink); ctx.lineWidth = 0.55 * u; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(x, y - 0.5 * u, 0.9 * u * wide, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke();
  }
}

// Each body is drawn around the keeper's ground point (0, 0), up is negative, in units u.
const BODIES = {
  git(ctx, u, c, ps, ink) { // a flat-bottomed acorn forager with a leaf hat
    ctx.beginPath();
    ctx.moveTo(-3.6 * u, 0);
    ctx.bezierCurveTo(-4.2 * u, -4 * u, -3 * u, -7.2 * u, 0, -7.2 * u);
    ctx.bezierCurveTo(3 * u, -7.2 * u, 4.2 * u, -4 * u, 3.6 * u, 0);
    ctx.closePath();
    ctx.fillStyle = toCss(c.body); ctx.fill();
    ctx.strokeStyle = toCss(c.dark); ctx.lineWidth = 0.6 * u; ctx.stroke();
    // Leaf hat.
    ctx.save(); ctx.translate(0.4 * u, -7 * u); ctx.rotate(-0.35);
    ellipse(ctx, 0, -1 * u, 3.4 * u, 1.4 * u); ctx.fillStyle = toCss(c.accent); ctx.fill();
    ctx.strokeStyle = toCss(darken(c.accent, 0.3)); ctx.lineWidth = 0.4 * u;
    ctx.beginPath(); ctx.moveTo(-3 * u, -1 * u); ctx.lineTo(3 * u, -1 * u); ctx.stroke();
    ctx.restore();
    beadEyes(ctx, u, 0, -4.4 * u, 1.3 * u, ps.eyes, ink);
    mouth(ctx, u, 0, -2.6 * u, ps.open, ink);
  },
  pr(ctx, u, c, ps, ink) { // a boxy postie in a little peaked cap, with a satchel
    roundRect(ctx, -3.4 * u, -7 * u, 6.8 * u, 7 * u, 2 * u);
    ctx.fillStyle = toCss(c.body); ctx.fill();
    ctx.strokeStyle = toCss(c.dark); ctx.lineWidth = 0.6 * u; ctx.stroke();
    // Satchel strap and bag.
    ctx.strokeStyle = toCss(c.accent); ctx.lineWidth = 0.6 * u;
    ctx.beginPath(); ctx.moveTo(-2.8 * u, -6.2 * u); ctx.lineTo(2.6 * u, -1.6 * u); ctx.stroke();
    ctx.fillStyle = toCss(c.accent); roundRect(ctx, 1.4 * u, -2.4 * u, 2.6 * u, 2 * u, 0.5 * u); ctx.fill();
    // Cap.
    ctx.fillStyle = toCss(c.accent);
    ctx.beginPath(); ctx.moveTo(-3 * u, -7 * u); ctx.quadraticCurveTo(0, -9.6 * u, 3 * u, -7 * u); ctx.closePath(); ctx.fill();
    roundRect(ctx, -0.6 * u, -7.4 * u, 4.6 * u, 0.9 * u, 0.4 * u); ctx.fill();
    beadEyes(ctx, u, 0, -5.4 * u, 1.3 * u, ps.eyes, ink);
    mouth(ctx, u, 0, -3.4 * u, ps.open, ink);
  },
  jira(ctx, u, c, ps, ink) { // a ticket stub with perforated edges; stamps itself after a meal
    const w = 4.2, h = 8;
    ctx.beginPath();
    ctx.moveTo(-w * u, 0); ctx.lineTo(-w * u, -h * u); ctx.lineTo(w * u, -h * u); ctx.lineTo(w * u, 0); ctx.closePath();
    ctx.fillStyle = toCss(c.body); ctx.fill();
    ctx.strokeStyle = toCss(c.dark); ctx.lineWidth = 0.6 * u; ctx.stroke();
    // Perforation notches on both sides and a dashed tear line.
    ctx.fillStyle = toCss(c.dark, 0.9);
    for (const s of [-1, 1]) for (let k = 1; k < 4; k++) { ellipse(ctx, s * w * u, -k * 2 * u, 0.55 * u, 0.55 * u); ctx.fill(); }
    ctx.setLineDash([0.8 * u, 0.8 * u]);
    ctx.strokeStyle = toCss(c.dark, 0.7); ctx.lineWidth = 0.4 * u;
    ctx.beginPath(); ctx.moveTo(-w * u, -1.6 * u); ctx.lineTo(w * u, -1.6 * u); ctx.stroke();
    ctx.setLineDash([]);
    beadEyes(ctx, u, 0, -5.8 * u, 1.4 * u, ps.eyes, ink);
    mouth(ctx, u, 0, -3.8 * u, ps.open, ink);
    if (ps.stamp > 0.01) {
      // A round "eaten" stamp, pressed on at an angle.
      ctx.save(); ctx.translate(2.2 * u, -2.6 * u); ctx.rotate(-0.3);
      ctx.globalAlpha *= ps.stamp * 0.85;
      ctx.strokeStyle = toCss(c.accent); ctx.lineWidth = 0.45 * u;
      ellipse(ctx, 0, 0, 1.5 * u, 1.5 * u); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-0.7 * u, 0); ctx.lineTo(-0.15 * u, 0.55 * u); ctx.lineTo(0.75 * u, -0.6 * u); ctx.stroke();
      ctx.restore();
    }
  },
  terminal(ctx, u, c, ps, ink) { // an ember sprite: a flickering flame with a coal core
    const f = ps.flicker;
    ctx.beginPath();
    ctx.moveTo(-3.2 * u, 0);
    ctx.bezierCurveTo(-4 * u, -3.5 * u, -1.5 * u, -5 * u, (0.8 + f * 0.8) * u, -9.5 * u);
    ctx.bezierCurveTo(2.2 * u, -5.6 * u, 4 * u, -3.5 * u, 3.2 * u, 0);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, -9 * u, 0, 0);
    g.addColorStop(0, toCss(c.accent)); g.addColorStop(1, toCss(c.body));
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = toCss(c.dark, 0.8); ctx.lineWidth = 0.5 * u; ctx.stroke();
    beadEyes(ctx, u, 0, -4.2 * u, 1.2 * u, ps.eyes, ink);
    mouth(ctx, u, 0, -2.4 * u, ps.open, ink);
  },
  web(ctx, u, c, ps, ink) { // a balloon-bodied critter on a string
    ctx.strokeStyle = toCss(c.accent, 0.8); ctx.lineWidth = 0.4 * u;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(0.8 * u, -1.8 * u, 0, -3.4 * u); ctx.stroke();
    // A tiny weight on the ground keeps it in place.
    ctx.fillStyle = toCss(c.accent); roundRect(ctx, -0.9 * u, -0.8 * u, 1.8 * u, 0.8 * u, 0.3 * u); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -3.4 * u);
    ctx.bezierCurveTo(-5 * u, -5 * u, -4.4 * u, -12.6 * u, 0, -12.6 * u);
    ctx.bezierCurveTo(4.4 * u, -12.6 * u, 5 * u, -5 * u, 0, -3.4 * u);
    ctx.fillStyle = toCss(c.body); ctx.fill();
    ctx.strokeStyle = toCss(c.dark); ctx.lineWidth = 0.6 * u; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ellipse(ctx, -1.6 * u, -10 * u, 0.8 * u, 1.3 * u, -0.4); ctx.fill();
    beadEyes(ctx, u, 0, -8.6 * u, 1.4 * u, ps.eyes, ink);
    mouth(ctx, u, 0, -6.4 * u, ps.open, ink);
  },
  files(ctx, u, c, ps, ink) { // a bookworm: three flat segments, head on the right, round glasses
    for (let k = 0; k < 3; k++) {
      const x = (-3.4 + k * 2.6) * u, r = (1.7 + k * 0.25) * u;
      ellipse(ctx, x, -r, r, r);
      ctx.fillStyle = toCss(k === 2 ? c.body : darken(c.body, 0.06 * (2 - k))); ctx.fill();
      ctx.strokeStyle = toCss(c.dark); ctx.lineWidth = 0.5 * u; ctx.stroke();
    }
    // Head on the last segment, facing right toward the papers.
    const hx = 3.2 * u, hy = -3.6 * u;
    ellipse(ctx, hx, hy, 2.6 * u, 2.4 * u);
    ctx.fillStyle = toCss(c.body); ctx.fill(); ctx.stroke();
    beadEyes(ctx, u, hx + 0.2 * u, hy - 0.6 * u, 1 * u, ps.eyes, ink);
    ctx.strokeStyle = toCss(c.accent); ctx.lineWidth = 0.35 * u;
    for (const s of [-1, 1]) { ellipse(ctx, hx + 0.2 * u + s * 1 * u, hy - 0.6 * u, 0.95 * u, 0.95 * u); ctx.stroke(); }
    mouth(ctx, u, hx + 0.4 * u, hy + 1.1 * u, ps.open, ink, 0.8);
  },
};

/**
 * Draw a service keeper beside its building.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} kind one of KEEPER_KINDS ('human' has none: nothing is drawn)
 * @param {number} x building base point (as for drawServiceBuilding)
 * @param {number} y
 * @param {number} scale
 * @param {object} pal palette from readTheme()
 * @param {number} t seconds
 * @param {{ progress?: number|null, recent?: number }} [catchState] from catchProgress() / recentCatches()
 * @param {{ reduced?: boolean, alpha?: number }} [o]
 */
export function drawKeeper(ctx, kind, x, y, scale, pal, t, catchState = {}, { reduced = false, alpha = 1 } = {}) {
  const body = BODIES[kind];
  if (!body || alpha <= 0.01) return;
  const c = keeperColors(kind, pal);
  const n = naturePalette(pal);
  const u = UNIT * scale * KSIZE;
  const s = keeperSpot(kind, scale);
  const ps = keeperPose(kind, reduced ? 0 : t, catchState, reduced);
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(x + s.dx, y + s.dy);
  if (kind !== 'terminal') { // the ember lives in the furnace and casts no shadow
    ctx.fillStyle = toCss(darken(n.grassDark, 0.4), 0.3);
    ellipse(ctx, 0, 0, 4 * u, 1 * u); ctx.fill();
  }
  ctx.translate(0, ps.dy * u);
  ctx.rotate(ps.rot);
  ctx.scale(ps.sx, ps.sy);
  ctx.lineJoin = 'round';
  // Dark themes: a soft pale rim so earthy keepers don't sink into a dark islet.
  const rim = keeperRim(kind, pal);
  if (rim) { ctx.shadowColor = toCss(rim.color, rim.alpha); ctx.shadowBlur = rim.blur * scale; }
  body(ctx, u, c, ps, n.ink);
  ctx.restore();
}
