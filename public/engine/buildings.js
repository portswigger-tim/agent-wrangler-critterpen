// Service buildings: the landmark each service lives in (git tree, PR mailbox,
// Jira post office, shell forge, web balloon tower, files shed, the "you" bell),
// drawn larger and with charm, plus a hit animation and a plank caption.
//
// The building is kept apart from whatever carries it, so the carrier can be
// swapped: drawServiceBuilding() draws only the building at a base point;
// drawCarrier() draws what it stands on (only 'islet' so far, provisional).
//
// Coordinates: (x, y) is the base point the building stands on. `scale` 1
// suits a ~18px critter radius. Draw-only, plus pure helpers for layout/tests.

import { TAU, clamp, hash32, rng } from './util.js';
import { toCss, mix, lighten, darken, parseColor, pastel, inkFor } from './color.js';
import { kindColor, roundRect, ellipse } from './art.js';
import { naturePalette, drawIsland, drawSignpost } from './scene.js';

export const ISLET_KINDS = ['git', 'pr', 'jira', 'terminal', 'web', 'files', 'human'];

/** Building unit in px at scale 1: buildings are ~40–52 units tall (~100px). */
export const UNIT = 2.2;

const WIDTH = { git: 48, pr: 40, jira: 48, terminal: 40, web: 30, files: 46, human: 44 }; // building, in units

/**
 * Size of a building alone, in px at `scale`, around its base point: `w` wide
 * (centred), `top` tall (balloon, smoke and bell roof included). Carrier-free.
 */
export function buildingFootprint(kind, scale = 1) {
  return { w: (WIDTH[kind] || 44) * UNIT * scale, top: ((HEIGHT[kind] || 44) * UNIT + 12) * scale };
}

const TOP = { // islet top ellipse (px at scale 1)
  service: { rx: 54, ry: 17 },
  human: { rx: 140, ry: 32 },
};
const HEIGHT = { git: 50, pr: 40, jira: 44, terminal: 46, web: 52, files: 34, human: 48 }; // building, in units

/**
 * Provisional ('islet' carrier). Space an islet needs, in px at `scale`, measured from its (x, y):
 * `rx`/`ry` the top surface, `top` how far the building (and balloon or smoke)
 * rises, `bottom` how far the underside and hanging sign fall. `r` is a
 * bounding radius around (x, y - (top - bottom) / 2), for circle packing.
 */
export function isletFootprint(kind, scale = 1) {
  const t = kind === 'human' ? TOP.human : TOP.service;
  const top = (HEIGHT[kind] || 44) * UNIT + 12;
  const bottom = t.ry * 1.3 + 4 + 38 + 20; // underside tip, then the hanging plank (as on task islands)
  const rx = t.rx, ry = t.ry;
  const r = Math.max(rx * 1.05, (top + bottom) / 2);
  return { rx: rx * scale, ry: ry * scale, top: top * scale, bottom: bottom * scale, r: r * scale, cy: -((top - bottom) / 2) * scale };
}

/** Provisional ('islet' carrier). Vertical bob at time t (each kind its own rhythm); 0 under reduced motion. */
export function isletBob(kind, t, scale = 1, reduced = false) {
  if (reduced) return 0;
  const r = rng(hash32('islet-bob:' + kind));
  const ph = r() * TAU, sp = 0.55 + r() * 0.35;
  return Math.sin(t * sp + ph) * 2.6 * scale;
}

/**
 * Pure numbers for a building's hit animation. `hit` is 1 at impact and eases
 * to 0; `p` = 1 − hit is the progress since impact.
 * @returns {{ p: number, h: number, squash: number, shake: number, flag: number, flash: number, lift: number }}
 */
export function hitPose(hit) {
  const h = clamp(hit || 0, 0, 1), p = 1 - h;
  if (h <= 0) return { p: 1, h: 0, squash: 0, shake: 0, flag: 0, flash: 0, lift: 0 };
  return {
    p, h,
    squash: Math.sin(Math.PI * Math.min(1, p * 3)) * h,            // a springy bounce right after impact
    shake: Math.sin(p * Math.PI * 7) * h,                           // decaying wobble, −1..1
    flag: clamp(p * 8, 0, 1) * clamp(h / 0.2, 0, 1) * (1 + 0.2 * Math.sin(p * Math.PI * 6) * h), // up, overshoot, down at the end
    flash: Math.pow(h, 1.5),                                        // windows / furnace brightness
    lift: Math.sin(Math.PI * p) * (0.5 + 0.5 * h),                  // balloon lift
  };
}

/**
 * Queue spots around the bell, relative to its base point: two staggered rows a
 * side, nearest the bell first, alternating right and left. Spots for a
 * critter of radius `critterR` never overlap each other or the bell.
 */
export function bellQueueSlots(scale = 1, critterR = 18, n = 8) {
  const out = [];
  const gap = critterR * 2.1;
  const bellClear = (WIDTH.human / 2) * UNIT * scale + critterR * 1.05; // half the bell frame + a body
  for (let i = 0; i < n; i++) {
    const side = i % 2 ? -1 : 1, k = Math.floor(i / 2);   // k-th spot on this side
    const col = Math.floor(k / 2), row = k % 2;          // two per column, staggered back/front
    out.push({ dx: side * (bellClear + col * gap + row * gap * 0.5), dy: row ? -critterR * 0.9 : critterR * 0.9, side });
  }
  return out;
}

const C = (hex) => parseColor(hex);
const WHITE = C('#ffffff');
const WARM = C('#ffd27a');

/** Window/opening that glows warmly in dark themes, and flashes on a hit. */
function windowPane(ctx, x, y, w, h, u, pal, n, flash = 0, round = 1.2) {
  const glow = pal.dark ? 0.75 : 0;
  const lit = Math.max(glow, flash);
  roundRect(ctx, x, y, w, h, round * u);
  ctx.fillStyle = toCss(lit > 0.01 ? mix(mix(n.ink, C('#7aa7d6'), pal.dark ? 0.3 : 0.6), WARM, lit) : mix(n.ink, C('#9cc3e6'), 0.65));
  ctx.fill();
  if (lit > 0.01) {
    const g = ctx.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, Math.max(w, h) * 1.4);
    g.addColorStop(0, toCss(WARM, 0.35 * lit));
    g.addColorStop(1, toCss(WARM, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - w, y - h, w * 3, h * 3);
  } else {
    ctx.fillStyle = toCss(WHITE, 0.55);
    ctx.fillRect(x + w * 0.15, y + h * 0.15, w * 0.22, h * 0.5);
  }
  ctx.strokeStyle = toCss(darken(n.wall, 0.45));
  ctx.lineWidth = 0.8 * u;
  roundRect(ctx, x, y, w, h, round * u);
  ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h); ctx.moveTo(x, y + h / 2); ctx.lineTo(x + w, y + h / 2); ctx.stroke();
}

const leaf = (ctx, x, y, s, rot) => { ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ellipse(ctx, 0, 0, s, s * 0.5); ctx.fill(); ctx.restore(); };

// ── buildings ── each drawn around its base point (0, 0), y up is negative,
// in units `u`. `hp` = hitPose(hit), `t` time (already 0 under reduced motion).

const BUILDINGS = {
  git(ctx, u, n, col, hp, t, pal) { // a tree whose fruit are commits on a branch
    const sway = Math.sin(t * 0.9) * 0.02 + hp.shake * 0.07;
    ctx.save();
    ctx.rotate(sway);
    ctx.fillStyle = toCss(n.woodDark);
    ctx.beginPath();
    ctx.moveTo(-4 * u, 0); ctx.quadraticCurveTo(-2 * u, -12 * u, -3 * u, -22 * u);
    ctx.lineTo(3 * u, -22 * u); ctx.quadraticCurveTo(2 * u, -12 * u, 5 * u, 0); ctx.closePath(); ctx.fill();
    const leafy = mix(n.grass, pal.green, 0.25);
    const blobs = [[-12, -27, 11], [12, -28, 11], [0, -38, 14], [-8, -42, 9], [9, -43, 9]];
    ctx.fillStyle = toCss(darken(leafy, 0.22));
    for (const [x, y, r] of blobs) { ellipse(ctx, x * u, (y + 1.5) * u, r * u, r * u); ctx.fill(); }
    const lg = ctx.createRadialGradient(-6 * u, -44 * u, 2 * u, 0, -34 * u, 22 * u);
    lg.addColorStop(0, toCss(lighten(leafy, 0.25)));
    lg.addColorStop(1, toCss(leafy));
    ctx.fillStyle = lg;
    for (const [x, y, r] of blobs) { ellipse(ctx, x * u, y * u, r * 0.92 * u, r * 0.92 * u); ctx.fill(); }
    // A few loose leaves on the canopy edge.
    ctx.fillStyle = toCss(lighten(leafy, 0.1));
    for (const [x, y, rot] of [[-21, -30, -0.6], [21, -33, 0.7], [-3, -51, 0.2]]) leaf(ctx, x * u, y * u, 3.2 * u, rot);
    // The commit graph: a branch line with commit-dot fruit.
    const fruit = [[-11, -28], [-2, -36], [7, -30], [12, -40]];
    ctx.strokeStyle = toCss(inkFor(col, 0.3), 0.9);
    ctx.lineWidth = 1.5 * u;
    ctx.beginPath(); ctx.moveTo(-11 * u, -28 * u); ctx.lineTo(-2 * u, -36 * u); ctx.lineTo(7 * u, -30 * u);
    ctx.moveTo(-2 * u, -36 * u); ctx.lineTo(12 * u, -40 * u); ctx.stroke();
    fruit.forEach(([x, y], i) => {
      const bounce = Math.sin(hp.p * Math.PI * 4 + i) * hp.h * 1.5 * u;
      ctx.fillStyle = toCss(lighten(col, 0.2 + 0.5 * hp.flash));
      ellipse(ctx, x * u, y * u - bounce, 3.6 * u, 3.6 * u); ctx.fill(); ctx.stroke();
      ctx.fillStyle = toCss(WHITE, 0.8);
      ellipse(ctx, (x - 1) * u, (y - 1.2) * u - bounce, 1 * u, 1 * u); ctx.fill();
    });
    ctx.restore();
    // Leaves shaken loose by a hit drift down.
    if (hp.h > 0) {
      ctx.fillStyle = toCss(lighten(leafy, 0.15), Math.min(1, hp.h * 2));
      for (let i = 0; i < 3; i++) {
        const q = hp.p;
        leaf(ctx, (-14 + i * 13 + Math.sin(q * 9 + i) * 3) * u, (-30 + q * 30 + i * 3) * u, 2.8 * u, q * 6 + i);
      }
    }
  },

  pr(ctx, u, n, col, hp) { // a mailbox; the flag pops up on delivery
    const body = col, edge = inkFor(col, 0.4);
    ctx.fillStyle = toCss(n.woodDark);
    roundRect(ctx, -2.5 * u, -22 * u, 5 * u, 22 * u, 1 * u); ctx.fill();
    ctx.fillStyle = toCss(darken(n.woodDark, 0.15));
    ctx.fillRect(-6 * u, -2 * u, 12 * u, 2 * u);
    // Box.
    ctx.beginPath();
    ctx.moveTo(-15 * u, -21 * u); ctx.lineTo(-15 * u, -33 * u);
    ctx.arc(0, -33 * u, 15 * u, Math.PI, 0);
    ctx.lineTo(15 * u, -21 * u); ctx.closePath();
    const g = ctx.createLinearGradient(0, -48 * u, 0, -21 * u);
    g.addColorStop(0, toCss(lighten(body, 0.3)));
    g.addColorStop(1, toCss(body));
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = toCss(edge); ctx.lineWidth = 1.4 * u; ctx.stroke();
    // Front door with its handle; a letter peeks out after a delivery.
    ctx.fillStyle = toCss(darken(body, 0.18));
    ctx.beginPath(); ctx.moveTo(-15 * u, -21 * u); ctx.lineTo(-15 * u, -33 * u); ctx.arc(-9 * u, -33 * u, 6 * u, Math.PI, 0); ctx.lineTo(-3 * u, -21 * u); ctx.closePath(); ctx.fill();
    if (hp.h > 0.05) {
      ctx.save();
      ctx.translate(-9 * u, -35 * u - hp.lift * 4 * u);
      ctx.rotate(-0.2);
      ctx.fillStyle = toCss(WHITE); ctx.strokeStyle = toCss(darken(col, 0.3)); ctx.lineWidth = 0.8 * u;
      ctx.fillRect(-5 * u, -3 * u, 10 * u, 6 * u); ctx.strokeRect(-5 * u, -3 * u, 10 * u, 6 * u);
      ctx.beginPath(); ctx.moveTo(-5 * u, -3 * u); ctx.lineTo(0, 0.5 * u); ctx.lineTo(5 * u, -3 * u); ctx.stroke();
      ctx.restore();
    }
    // Sheen.
    ctx.fillStyle = toCss(WHITE, 0.35);
    ellipse(ctx, 5 * u, -41 * u, 5 * u, 2.2 * u, -0.3); ctx.fill();
    // Flag: lowered along the side at rest, pops up (with overshoot) on a hit.
    ctx.save();
    ctx.translate(15 * u, -27 * u);
    ctx.rotate(Math.PI / 2 * (1 - hp.flag));
    ctx.fillStyle = toCss(n.woodDark);
    roundRect(ctx, -1 * u, -15 * u, 2 * u, 15 * u, 0.8 * u); ctx.fill();
    ctx.fillStyle = toCss(C('#e5484d'));
    roundRect(ctx, 0.5 * u, -15 * u, 8 * u, 5.5 * u, 1 * u); ctx.fill();
    ctx.strokeStyle = toCss(C('#a3262b')); ctx.lineWidth = 0.8 * u; ctx.stroke();
    ctx.restore();
  },

  jira(ctx, u, n, col, hp, t, pal) { // a post office with glowing windows
    const wall = n.wall, edge = darken(wall, 0.45);
    ctx.lineWidth = 1.2 * u;
    ctx.fillStyle = toCss(wall); ctx.strokeStyle = toCss(edge);
    roundRect(ctx, -19 * u, -26 * u, 38 * u, 26 * u, 1.5 * u); ctx.fill(); ctx.stroke();
    // Little chimney behind the roof.
    ctx.fillStyle = toCss(darken(wall, 0.25));
    ctx.fillRect(9 * u, -42 * u, 5 * u, 10 * u);
    // Roof.
    ctx.beginPath(); ctx.moveTo(-23 * u, -25 * u); ctx.lineTo(0, -44 * u); ctx.lineTo(23 * u, -25 * u); ctx.closePath();
    const rg = ctx.createLinearGradient(0, -44 * u, 0, -25 * u);
    rg.addColorStop(0, toCss(lighten(col, 0.2))); rg.addColorStop(1, toCss(col));
    ctx.fillStyle = rg; ctx.fill();
    ctx.strokeStyle = toCss(inkFor(col, 0.4)); ctx.stroke();
    // Round window in the gable.
    ctx.fillStyle = toCss(lighten(col, 0.5));
    ellipse(ctx, 0, -33 * u, 3.2 * u, 3.2 * u); ctx.fill(); ctx.stroke();
    // Windows either side of the door.
    windowPane(ctx, -15 * u, -20 * u, 8 * u, 8 * u, u, pal, n, hp.flash);
    windowPane(ctx, 7 * u, -20 * u, 8 * u, 8 * u, u, pal, n, hp.flash);
    // Door with an envelope sign above.
    ctx.fillStyle = toCss(darken(n.wood, 0.25));
    roundRect(ctx, -4.5 * u, -13 * u, 9 * u, 13 * u, 3 * u); ctx.fill();
    ctx.fillStyle = toCss(n.gold); ellipse(ctx, 2.5 * u, -6 * u, 0.9 * u, 0.9 * u); ctx.fill();
    const hop = Math.sin(Math.PI * Math.min(1, hp.p * 2)) * hp.h * 2 * u;
    ctx.fillStyle = toCss(WHITE);
    ctx.strokeStyle = toCss(darken(col, 0.2)); ctx.lineWidth = 1 * u;
    ctx.fillRect(-6 * u, -23.5 * u - hop, 12 * u, 7 * u); ctx.strokeRect(-6 * u, -23.5 * u - hop, 12 * u, 7 * u);
    ctx.beginPath(); ctx.moveTo(-6 * u, -23.5 * u - hop); ctx.lineTo(0, -19 * u - hop); ctx.lineTo(6 * u, -23.5 * u - hop); ctx.stroke();
  },

  terminal(ctx, u, n, col, hp, t, pal) { // a stone forge: smoke, a glowing '>_' furnace, sparks on a hit
    const stone = n.rock, edge = n.rockDark;
    ctx.lineWidth = 1.2 * u;
    // Chimney.
    ctx.fillStyle = toCss(darken(stone, 0.1)); ctx.strokeStyle = toCss(edge);
    roundRect(ctx, 7 * u, -42 * u, 8 * u, 20 * u, 1 * u); ctx.fill(); ctx.stroke();
    ctx.fillStyle = toCss(edge); ctx.fillRect(6 * u, -44 * u, 10 * u, 3 * u);
    // Body: rounded stone hut.
    ctx.beginPath();
    ctx.moveTo(-18 * u, 0); ctx.lineTo(-18 * u, -18 * u);
    ctx.quadraticCurveTo(-18 * u, -30 * u, 0, -30 * u);
    ctx.quadraticCurveTo(18 * u, -30 * u, 18 * u, -18 * u);
    ctx.lineTo(18 * u, 0); ctx.closePath();
    const g = ctx.createLinearGradient(0, -30 * u, 0, 0);
    g.addColorStop(0, toCss(lighten(stone, 0.15))); g.addColorStop(1, toCss(stone));
    ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = toCss(edge); ctx.stroke();
    // Stones.
    ctx.strokeStyle = toCss(edge, 0.5); ctx.lineWidth = 0.8 * u;
    for (const [x, y, w] of [[-14, -22, 7], [-4, -25, 8], [7, -21, 7], [-16, -8, 6], [11, -9, 6]]) { roundRect(ctx, x * u, y * u, w * u, 4 * u, 1.5 * u); ctx.stroke(); }
    // Furnace mouth.
    const heat = Math.min(1, (pal.dark ? 0.75 : 0.55) + 0.45 * hp.flash);
    ctx.fillStyle = toCss(C('#2a1a12'));
    ctx.beginPath(); ctx.moveTo(-9 * u, 0); ctx.lineTo(-9 * u, -10 * u); ctx.arc(0, -10 * u, 9 * u, Math.PI, 0); ctx.lineTo(9 * u, 0); ctx.closePath(); ctx.fill();
    const fg = ctx.createRadialGradient(0, -4 * u, 0, 0, -4 * u, 14 * u);
    fg.addColorStop(0, toCss(lighten(col, 0.4), heat)); fg.addColorStop(0.6, toCss(darken(col, 0.1), heat * 0.6)); fg.addColorStop(1, toCss(col, 0));
    ctx.fillStyle = fg; ctx.fill();
    ctx.fillStyle = toCss(lighten(col, 0.6), heat);
    ctx.font = `800 ${Math.round(8 * u)}px ui-monospace, Menlo, monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('>_', 0, -8 * u);
    // Lazy smoke from the chimney (held still when t is frozen).
    for (let k = 0; k < 4; k++) {
      const p = (t * 0.35 + k / 4) % 1;
      ctx.fillStyle = toCss(pal.dark ? lighten(stone, 0.2) : mix(stone, n.rockDark, 0.3), (pal.dark ? 0.4 : 0.45) * (1 - p));
      ellipse(ctx, 11 * u + Math.sin(p * 5 + k) * 3 * u, -46 * u - p * 22 * u, (2.5 + p * 4.5) * u, (2.5 + p * 4.5) * u);
      ctx.fill();
    }
    // Sparks fly out of the furnace on a hit.
    if (hp.h > 0) {
      for (let i = 0; i < 9; i++) {
        const r = rng(i * 7919 + 1);
        const a = -Math.PI / 2 + (r() - 0.5) * 2.2, sp = 18 + r() * 16, q = hp.p;
        const x = Math.cos(a) * sp * q * u, y = -6 * u + (Math.sin(a) * sp * q + 22 * q * q) * u;
        ctx.fillStyle = toCss(lighten(col, 0.5), hp.h);
        ellipse(ctx, x, y, 1.2 * u, 1.2 * u); ctx.fill();
      }
    }
  },

  web(ctx, u, n, col, hp, t) { // a lattice tower with a swaying balloon
    ctx.strokeStyle = toCss(n.woodDark);
    ctx.lineWidth = 1.8 * u;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-11 * u, 0); ctx.lineTo(-3 * u, -28 * u); ctx.moveTo(11 * u, 0); ctx.lineTo(3 * u, -28 * u);
    for (const y of [-7, -15, -22]) { const half = 11 - 8 * (-y / 28); ctx.moveTo(-half * u, y * u); ctx.lineTo(half * u, y * u); }
    ctx.moveTo(-9 * u, -7 * u); ctx.lineTo(7 * u, -15 * u); ctx.moveTo(9 * u, -7 * u); ctx.lineTo(-7 * u, -15 * u);
    ctx.moveTo(-7 * u, -15 * u); ctx.lineTo(4 * u, -22 * u); ctx.moveTo(7 * u, -15 * u); ctx.lineTo(-4 * u, -22 * u);
    ctx.stroke();
    // Platform.
    ctx.fillStyle = toCss(n.wood);
    roundRect(ctx, -6 * u, -30 * u, 12 * u, 3 * u, 1 * u); ctx.fill();
    // Balloon on a string.
    const sway = Math.sin(t * 1.1) * 2.2 * u + hp.shake * 3 * u, lift = hp.lift * 6 * u;
    const bx = sway, by = -45 * u - lift;
    ctx.strokeStyle = toCss(darken(n.woodDark, 0.2), 0.8); ctx.lineWidth = 0.9 * u;
    ctx.beginPath(); ctx.moveTo(0, -30 * u); ctx.quadraticCurveTo(sway * 0.3, -33 * u, bx, by + 10 * u); ctx.stroke();
    const bg = ctx.createRadialGradient(bx - 3 * u, by - 4 * u, 1 * u, bx, by, 11 * u);
    bg.addColorStop(0, toCss(lighten(col, 0.4))); bg.addColorStop(1, toCss(col));
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.moveTo(bx, by + 10.5 * u);
    ctx.bezierCurveTo(bx - 13 * u, by + 2 * u, bx - 9 * u, by - 11 * u, bx, by - 11 * u);
    ctx.bezierCurveTo(bx + 9 * u, by - 11 * u, bx + 13 * u, by + 2 * u, bx, by + 10.5 * u);
    ctx.fill();
    ctx.strokeStyle = toCss(inkFor(col, 0.35)); ctx.lineWidth = 1 * u; ctx.stroke();
    ctx.fillStyle = toCss(inkFor(col, 0.3));
    ctx.beginPath(); ctx.moveTo(bx - 1.5 * u, by + 10.5 * u); ctx.lineTo(bx + 1.5 * u, by + 10.5 * u); ctx.lineTo(bx, by + 8.5 * u); ctx.closePath(); ctx.fill();
    ctx.fillStyle = toCss(WHITE, 0.55);
    ellipse(ctx, bx - 4 * u, by - 4 * u, 2 * u, 3.4 * u, -0.4); ctx.fill();
  },

  files(ctx, u, n, col, hp, t, pal) { // a shed with its door ajar and paper stacked outside
    ctx.lineWidth = 1.2 * u;
    // Walls with planks.
    ctx.fillStyle = toCss(n.wood); ctx.strokeStyle = toCss(n.woodDark);
    ctx.fillRect(-16 * u, -22 * u, 30 * u, 22 * u); ctx.strokeRect(-16 * u, -22 * u, 30 * u, 22 * u);
    ctx.strokeStyle = toCss(n.woodDark, 0.6);
    ctx.beginPath();
    for (let x = -11; x < 14; x += 5) { ctx.moveTo(x * u, -22 * u); ctx.lineTo(x * u, 0); }
    ctx.stroke();
    // Little window.
    windowPane(ctx, 6 * u, -17 * u, 6 * u, 6 * u, u, pal, n, hp.flash * 0.6);
    // Roof (lean-to).
    ctx.fillStyle = toCss(darken(n.woodDark, 0.05));
    ctx.beginPath(); ctx.moveTo(-20 * u, -19 * u); ctx.lineTo(17 * u, -33 * u); ctx.lineTo(18 * u, -28 * u); ctx.lineTo(-19 * u, -15 * u); ctx.closePath(); ctx.fill();
    // Doorway: dark (warm-lit at night) with the door swung outward.
    const open = 0.55 + 0.35 * hp.shake * hp.h + 0.3 * hp.h;
    ctx.fillStyle = toCss(pal.dark ? mix(C('#2a1a12'), WARM, 0.45) : C('#3a2618'));
    ctx.fillRect(-11 * u, -15 * u, 9 * u, 15 * u);
    // The door, hinged on the doorway's right edge, swung out toward the viewer.
    const dw = 9 * u * (1 - open * 0.55);
    ctx.fillStyle = toCss(lighten(n.wood, 0.12)); ctx.strokeStyle = toCss(n.woodDark); ctx.lineWidth = 1.1 * u;
    ctx.beginPath();
    ctx.moveTo(-2 * u, 0); ctx.lineTo(-2 * u, -15 * u); ctx.lineTo(-2 * u + dw, -17 * u); ctx.lineTo(-2 * u + dw, 2 * u); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.strokeStyle = toCss(n.woodDark, 0.5); ctx.lineWidth = 0.7 * u;
    ctx.beginPath(); ctx.moveTo(-2 * u + dw * 0.5, -16 * u); ctx.lineTo(-2 * u + dw * 0.5, 1 * u); ctx.stroke();
    ctx.fillStyle = toCss(n.gold); ellipse(ctx, -2 * u + dw * 0.8, -7 * u, 0.9 * u, 0.9 * u); ctx.fill();
    // Paper stacks outside.
    ctx.lineWidth = 0.7 * u;
    for (let k = 0; k < 4; k++) {
      ctx.save(); ctx.translate(19 * u, -1.5 * u - k * 2.3 * u); ctx.rotate((k % 2 ? 0.08 : -0.06));
      ctx.fillStyle = toCss(C('#fbfaf6')); ctx.strokeStyle = toCss(C('#9aa0a8'));
      ctx.fillRect(-5 * u, -1.1 * u, 10 * u, 2.2 * u); ctx.strokeRect(-5 * u, -1.1 * u, 10 * u, 2.2 * u);
      ctx.restore();
    }
    // A hit sends a few sheets fluttering up out of the door.
    if (hp.h > 0) {
      for (let i = 0; i < 3; i++) {
        const q = hp.p;
        ctx.save();
        ctx.translate((-8 + i * 7 + Math.sin(q * 8 + i) * 4) * u, (-14 - q * 26 - i * 3) * u);
        ctx.rotate(q * 5 + i);
        ctx.scale(Math.cos(q * 9 + i), 1);
        ctx.fillStyle = toCss(C('#fbfaf6'), Math.min(1, hp.h * 2));
        ctx.fillRect(-3 * u, -4 * u, 6 * u, 8 * u);
        ctx.restore();
      }
    }
  },

  human(ctx, u, n, col, hp, t, pal, waiting) { // the bell you get rung with
    ctx.fillStyle = toCss(n.woodDark);
    roundRect(ctx, -15 * u, -38 * u, 4 * u, 38 * u, 1 * u); ctx.fill();
    roundRect(ctx, 11 * u, -38 * u, 4 * u, 38 * u, 1 * u); ctx.fill();
    ctx.fillStyle = toCss(n.wood);
    roundRect(ctx, -18 * u, -42 * u, 36 * u, 5 * u, 2 * u); ctx.fill();
    ctx.fillStyle = toCss(darken(n.wood, 0.2));
    ctx.beginPath(); ctx.moveTo(-21 * u, -41 * u); ctx.lineTo(0, -50 * u); ctx.lineTo(21 * u, -41 * u); ctx.closePath(); ctx.fill();
    // Lanterns on the posts: glow at night, brighter while someone waits.
    for (const sx of [-13, 13]) {
      const lit = pal.dark ? 0.6 + 0.4 * waiting : 0.25 * waiting;
      ctx.fillStyle = toCss(mix(n.ink, WARM, Math.max(0.25, lit)));
      roundRect(ctx, (sx - 2.5) * u, -30 * u, 5 * u, 6 * u, 1.5 * u); ctx.fill();
      if (lit > 0.05) {
        const lg = ctx.createRadialGradient(sx * u, -27 * u, 0, sx * u, -27 * u, 9 * u);
        lg.addColorStop(0, toCss(WARM, 0.4 * lit)); lg.addColorStop(1, toCss(WARM, 0));
        ctx.fillStyle = lg; ellipse(ctx, sx * u, -27 * u, 9 * u, 9 * u); ctx.fill();
      }
    }
    // The bell swings on a hit, with little ring arcs.
    const swing = hp.shake * 0.45;
    ctx.save();
    ctx.translate(0, -37 * u);
    ctx.rotate(swing);
    const gold = n.gold;
    ctx.beginPath();
    ctx.moveTo(-10 * u, 16 * u);
    ctx.quadraticCurveTo(-8 * u, 14 * u, -8 * u, 7 * u);
    ctx.bezierCurveTo(-8 * u, -1 * u, 8 * u, -1 * u, 8 * u, 7 * u);
    ctx.quadraticCurveTo(8 * u, 14 * u, 10 * u, 16 * u);
    ctx.closePath();
    const bg = ctx.createLinearGradient(-8 * u, 0, 8 * u, 0);
    bg.addColorStop(0, toCss(lighten(gold, 0.35))); bg.addColorStop(1, toCss(gold));
    ctx.fillStyle = bg; ctx.fill();
    ctx.strokeStyle = toCss(darken(gold, 0.35)); ctx.lineWidth = 1.2 * u; ctx.stroke();
    ctx.fillStyle = toCss(darken(gold, 0.4));
    ellipse(ctx, 0, 17.5 * u, 2.2 * u, 2.2 * u); ctx.fill();
    ctx.fillStyle = toCss(WHITE, 0.55);
    ellipse(ctx, -3.5 * u, 5 * u, 1.5 * u, 3.4 * u); ctx.fill();
    ctx.restore();
    if (hp.h > 0.05) {
      ctx.strokeStyle = toCss(gold, hp.h);
      ctx.lineWidth = 1.4 * u;
      for (const s of [-1, 1]) for (const k of [0, 1]) {
        ctx.beginPath(); ctx.arc(s * (13 + k * 4) * u, -28 * u, (3 + k * 3) * u, s > 0 ? -0.7 : Math.PI - 0.7, s > 0 ? 0.7 : Math.PI + 0.7); ctx.stroke();
      }
    }
  },
};

/** Accent colour for a building: the theme's kind colour, softened like the critters. */
export function buildingColor(kind, pal) {
  return pastel(kindColor(kind, pal), !!pal.dark);
}

/**
 * Draw one service building standing on (x, y). No carrier, no caption.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} kind one of ISLET_KINDS
 * @param {number} x base point
 * @param {number} y
 * @param {number} scale
 * @param {object} pal palette from readTheme()
 * @param {number} t seconds
 * @param {{ hit?: number, waiting?: number, reduced?: boolean, alpha?: number, shadow?: boolean }} [o]
 *   hit 1→0 after an impact; waiting 0..1 how much the bell glows (anyone queued)
 */
export function drawServiceBuilding(ctx, kind, x, y, scale, pal, t, o = {}) {
  const { hit = 0, waiting = 0, reduced = false, alpha = 1, shadow = true } = o;
  if (alpha <= 0.01 || !BUILDINGS[kind]) return;
  const n = naturePalette(pal);
  const u = UNIT * scale;
  const hp = hitPose(reduced ? 0 : hit);
  ctx.save();
  ctx.globalAlpha *= alpha;
  // The bell's waiting glow: soft, slow, no count.
  if (kind === 'human' && waiting > 0.01) {
    const pulse = reduced ? 1 : 0.8 + 0.2 * Math.sin(t * 2.4);
    const R = 64 * u;
    const g = ctx.createRadialGradient(x, y - 24 * u, 0, x, y - 24 * u, R);
    g.addColorStop(0, toCss(lighten(pal.yellow, 0.2), 0.35 * clamp(waiting, 0, 1) * pulse));
    g.addColorStop(1, toCss(pal.yellow, 0));
    ctx.fillStyle = g;
    ellipse(ctx, x, y - 24 * u, R, R);
    ctx.fill();
  }
  ctx.translate(x, y);
  if (shadow) {
    ctx.fillStyle = toCss(darken(n.grassDark, 0.4), 0.3);
    ellipse(ctx, 0, 0, 20 * u, 4 * u); ctx.fill();
  }
  // A hit squashes the building springily, anchored on its base.
  ctx.scale(1 + 0.08 * hp.squash, 1 - 0.1 * hp.squash);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  BUILDINGS[kind](ctx, u, n, buildingColor(kind, pal), hp, reduced ? 0 : t, pal, clamp(waiting, 0, 1));
  ctx.restore();
}

/** The building's caption: a small wooden plank hung from (x, y), like the task-island signs. */
export function drawCaptionPlank(ctx, x, y, text, pal, scale = 1) {
  drawSignpost(ctx, x, y, text, pal, { scale: clamp(scale, 0.8, 1.2), hang: true });
}

/**
 * Draw what a building stands on. Only 'islet' exists (provisional, pending
 * the carrier decision). Returns the base point for the building.
 * @returns {{ x: number, y: number, captionY: number }}
 */
export function drawCarrier(ctx, carrier, kind, x, y, scale, pal, t, { reduced = false, alpha = 1 } = {}) {
  const n = naturePalette(pal);
  const fp = isletFootprint(kind, scale);
  const cy = y + isletBob(kind, t, scale, reduced);
  if (carrier === 'islet' && alpha > 0.01) {
    ctx.save();
    ctx.globalAlpha *= alpha;
    drawIsland(ctx, { cx: x, cy, rx: fp.rx, ry: fp.ry, seed: hash32('islet:' + kind) }, pal);
    drawVines(ctx, x, cy, fp.rx, fp.ry, n, reduced ? 0 : t, hash32('vine:' + kind));
    ctx.restore();
  }
  return { x: kind === 'human' ? x : x - fp.rx * 0.08, y: cy + fp.ry * 0.15, captionY: cy + fp.ry * 1.3 + 4 };
}

/** Convenience: carrier ('islet'), building and caption in one call. */
export function drawIslet(ctx, kind, x, y, scale, pal, t, o = {}) {
  const base = drawCarrier(ctx, 'islet', kind, x, y, scale, pal, t, o);
  drawServiceBuilding(ctx, kind, base.x, base.y, scale, pal, t, o);
  if (o.caption) drawCaptionPlank(ctx, x, base.captionY, o.caption, pal, scale);
}

/** One or two leafy vines hanging from the islet's front lip, swaying gently. */
function drawVines(ctx, cx, cy, rx, ry, n, t, seed) {
  const r = rng(seed);
  const count = 1 + (r() < 0.6 ? 1 : 0);
  ctx.save();
  ctx.strokeStyle = toCss(darken(n.grassDark, 0.1));
  ctx.lineWidth = 1.3;
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const x0 = cx + rx * (-0.6 + r() * 1.2) * 0.8, y0 = cy + ry * 1.05;
    const len = ry * (1.6 + r() * 1.4), ph = r() * TAU;
    const sw = Math.sin(t * 0.8 + ph) * 3;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.bezierCurveTo(x0 - 3, y0 + len * 0.35, x0 + 3 + sw * 0.5, y0 + len * 0.7, x0 + sw, y0 + len);
    ctx.stroke();
    ctx.fillStyle = toCss(n.grass);
    for (let k = 1; k <= 3; k++) {
      const q = k / 3.4, lx = x0 + sw * q * q + (k % 2 ? -2 : 2), ly = y0 + len * q;
      leaf(ctx, lx, ly, 3, k % 2 ? -0.7 : 0.7);
    }
  }
  ctx.restore();
}
