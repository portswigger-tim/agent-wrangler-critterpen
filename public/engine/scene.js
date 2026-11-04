// Scenery: floating islands, their signposts, the mainland strip and the
// landmark buildings on it. Draw-only; positions come from layout.js.

import { TAU, rng } from './util.js';
import { toCss, mix, lighten, darken, parseColor } from './color.js';
import { kindColor, roundRect, ellipse, haloText } from './art.js';

const C = (hex) => parseColor(hex);
const NATURE = {
  light: {
    grass: C('#cdc88f'), grassDark: C('#7a7646'), dirt: C('#c08a5c'), dirtDark: C('#86583a'),
    rock: C('#b3b8bf'), rockDark: C('#7d848e'), wood: C('#d2a26a'), woodDark: C('#8b6440'),
    wall: C('#f4ead8'), ink: C('#4a3020'), gold: C('#f2b51e'),
  },
  dark: {
    grass: C('#55604a'), grassDark: C('#3e4737'), dirt: C('#82603f'), dirtDark: C('#4d3626'),
    rock: C('#727a85'), rockDark: C('#4a5059'), wood: C('#a27a50'), woodDark: C('#6b4d33'),
    wall: C('#cdbfa6'), ink: C('#2b1c12'), gold: C('#f5c542'),
  },
};
/**
 * Nature colours for the theme's light/dark mode. The grass is warm straw-moss
 * in light and a low sage in dark: clearly not status green, so working
 * (--green) critters stand off it (see test/scene.test.js).
 */
export function naturePalette(pal) {
  return NATURE[pal.dark ? 'dark' : 'light'];
}

const outlines = new Map();
/** A wobbly unit outline per island seed: radius multipliers around the rim. */
function outline(seed) {
  let o = outlines.get(seed);
  if (o) return o;
  const r = rng(seed);
  const a1 = r() * TAU, a2 = r() * TAU, a3 = r() * TAU;
  o = Array.from({ length: 48 }, (_, i) => {
    const t = (i / 48) * TAU;
    return 1 + 0.05 * Math.sin(3 * t + a1) + 0.035 * Math.sin(5 * t + a2) + 0.02 * Math.sin(9 * t + a3);
  });
  const depth = 0.85 + r() * 0.35, tip = (r() - 0.5) * 0.3;
  const tufts = Array.from({ length: 9 }, () => ({ a: r() * TAU, d: 0.55 + r() * 0.4, k: r() }));
  o = { m: o, depth, tip, tufts };
  if (outlines.size > 200) outlines.clear();
  outlines.set(seed, o);
  return o;
}

function rimPath(ctx, cx, cy, rx, ry, m, dy = 0) {
  ctx.beginPath();
  for (let i = 0; i <= m.length; i++) {
    const k = i % m.length, t = (k / m.length) * TAU;
    const x = cx + Math.cos(t) * rx * m[k], y = cy + dy + Math.sin(t) * ry * m[k];
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath();
}

/**
 * One floating island: rocky underside, grassy lip, top surface and tufts.
 * @param {{cx:number,cy:number,rx:number,ry:number,seed:number,rocky?:boolean}} isl
 */
export function drawIsland(ctx, isl, pal, { bob = 0, alpha = 1 } = {}) {
  if (alpha <= 0.01) return;
  const n = naturePalette(pal);
  const o = outline(isl.seed);
  const cx = isl.cx, cy = isl.cy + bob, rx = isl.rx, ry = isl.ry;
  const lip = ry * 0.26;
  const top = isl.rocky ? n.rock : n.grass, side = isl.rocky ? n.rockDark : n.grassDark;
  const under = isl.rocky ? n.rockDark : n.dirt, underDark = isl.rocky ? darken(n.rockDark, 0.3) : n.dirtDark;
  ctx.save();
  ctx.globalAlpha *= alpha;

  // Underside: from the front rim down to a craggy tip.
  const depth = ry * (isl.rocky ? 1.5 : 2.1) * o.depth;
  ctx.beginPath();
  const N = o.m.length;
  for (let i = 0; i <= N / 2; i++) {
    const t = (i / N) * TAU, k = i % N;
    ctx.lineTo(cx + Math.cos(t) * rx * o.m[k], cy + lip + Math.sin(t) * ry * o.m[k]);
  }
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    const s = 1 - (2 * i) / steps; // -1..1, right → left after the rim ended on the left
    const f = Math.pow(1 - Math.min(1, Math.abs(s - o.tip)), 1.4);
    const jag = (i % 2 ? 0.1 : -0.06) * depth * (1 - Math.abs(s));
    ctx.lineTo(cx - s * rx * 0.96, cy + lip + ry * 0.3 + depth * f + jag);
  }
  ctx.closePath();
  const g = ctx.createLinearGradient(0, cy, 0, cy + ry + depth);
  g.addColorStop(0, toCss(under));
  g.addColorStop(1, toCss(underDark));
  ctx.fillStyle = g;
  ctx.fill();
  // Strata and a couple of dangling roots.
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = toCss(underDark, 0.45);
  ctx.lineWidth = Math.max(1, ry * 0.06);
  for (let k = 1; k <= 2; k++) {
    ctx.beginPath();
    const yy = cy + lip + ry * (0.55 + k * 0.45);
    ctx.moveTo(cx - rx, yy);
    ctx.quadraticCurveTo(cx, yy + ry * 0.25 * (k % 2 ? 1 : -1), cx + rx, yy - ry * 0.1);
    ctx.stroke();
  }
  ctx.restore();
  if (!isl.rocky) {
    ctx.strokeStyle = toCss(darken(n.grassDark, 0.2), 0.7);
    ctx.lineWidth = 1.2;
    for (let k = 0; k < 3; k++) {
      const x = cx + rx * (-0.5 + k * 0.45 + o.tip * 0.3);
      const y0 = cy + lip + ry * 0.75;
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.bezierCurveTo(x - 4, y0 + ry * 0.4, x + 4, y0 + ry * 0.6, x - 2, y0 + ry * (0.8 + k * 0.15));
      ctx.stroke();
    }
  }

  // Lip (the edge's thickness), then the walkable top.
  ctx.fillStyle = toCss(side);
  rimPath(ctx, cx, cy, rx, ry, o.m, lip);
  ctx.fill();
  const tg = ctx.createRadialGradient(cx - rx * 0.25, cy - ry * 0.5, ry * 0.2, cx, cy, rx);
  tg.addColorStop(0, toCss(lighten(top, 0.18)));
  tg.addColorStop(1, toCss(top));
  ctx.fillStyle = tg;
  rimPath(ctx, cx, cy, rx, ry, o.m);
  ctx.fill();

  // Surface details: grass tufts and flowers, or cracks and pebbles.
  for (const tf of o.tufts) {
    const x = cx + Math.cos(tf.a) * rx * tf.d * 0.92, y = cy + Math.sin(tf.a) * ry * tf.d * 0.88;
    if (isl.rocky) {
      ctx.fillStyle = toCss(darken(top, 0.18), 0.8);
      ellipse(ctx, x, y, ry * 0.07 + tf.k * 2, ry * 0.05 + tf.k * 1.4);
      ctx.fill();
    } else if (tf.k < 0.3) {
      ctx.fillStyle = toCss(tf.k < 0.15 ? pal.yellow : C('#ff9ec4'));
      ellipse(ctx, x, y, 2, 2); ctx.fill();
    } else {
      ctx.strokeStyle = toCss(n.grassDark);
      ctx.lineWidth = 1.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x - 3, y); ctx.lineTo(x - 4, y - 4);
      ctx.moveTo(x, y); ctx.lineTo(x, y - 5);
      ctx.moveTo(x + 3, y); ctx.lineTo(x + 4, y - 4);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * A little wooden sign with the task name: on a post standing at (x, y), or
 * with `hang` a plank hung on two ropes whose top edge is at (x, y).
 */
export function drawSignpost(ctx, x, y, text, pal, { scale = 1, alpha = 1, hang = false } = {}) {
  if (!text || alpha <= 0.01) return;
  const n = naturePalette(pal);
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.font = '700 10px system-ui, -apple-system, Segoe UI, sans-serif';
  const w = Math.min(150, ctx.measureText(text).width + 14);
  if (hang) {
    ctx.strokeStyle = toCss(n.woodDark);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 8, -12); ctx.lineTo(-w / 2 + 6, 1);
    ctx.moveTo(w / 2 - 8, -12); ctx.lineTo(w / 2 - 6, 1);
    ctx.stroke();
    ctx.translate(0, 38);
  } else {
    ctx.fillStyle = toCss(n.woodDark);
    ctx.fillRect(-1.5, -26, 3, 26);
  }
  roundRect(ctx, -w / 2, -38, w, 17, 4);
  ctx.fillStyle = toCss(n.wood);
  ctx.fill();
  ctx.strokeStyle = toCss(n.woodDark);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = toCss(n.ink);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let t = text;
  while (t.length > 1 && ctx.measureText(t).width > w - 10) t = t.slice(0, -2) + '…';
  ctx.fillText(t, 0, -29);
  ctx.restore();
}

// ── leashes ──────────────────────────────────────────────────────────────────

/**
 * Rope colours for a parent/child leash: an earthy rope with a contrasting
 * halo under it, so it reads on grass and on sky in either theme.
 */
export function leashStyle(pal) {
  return pal.dark
    ? { rope: C('#d9b98c'), halo: C('#1b1410'), twist: C('#a8875c'), width: 2.4, haloWidth: 5 }
    : { rope: C('#6b4a2e'), halo: C('#fffaf0'), twist: C('#a37a50'), width: 2.4, haloWidth: 5 };
}

/** The sagging midpoint control for a rope from a to b (a slight catenary). */
export function leashControl(a, b) {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  return { x: (a.x + b.x) / 2, y: Math.max(a.y, b.y) + Math.max(10, dist * 0.18) };
}

/** Draw one leash from a to b; `twist` 0..1 slides the rope's twist marks. */
export function drawLeash(ctx, a, b, pal, alpha = 1, twist = 0) {
  if (alpha <= 0.01) return;
  const st = leashStyle(pal);
  const c = leashControl(a, b);
  const path = () => { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(c.x, c.y, b.x, b.y); };
  ctx.save();
  ctx.lineCap = 'round';
  path();
  ctx.strokeStyle = toCss(st.halo, 0.45 * alpha);
  ctx.lineWidth = st.haloWidth;
  ctx.stroke();
  path();
  ctx.strokeStyle = toCss(st.rope, alpha);
  ctx.lineWidth = st.width;
  ctx.stroke();
  path();
  ctx.setLineDash([2, 4]);
  ctx.lineDashOffset = -twist * 6;
  ctx.strokeStyle = toCss(st.twist, 0.8 * alpha);
  ctx.lineWidth = st.width * 0.55;
  ctx.stroke();
  ctx.restore();
}

/** The mainland strip along the bottom: a wavy grass edge over earth. */
export function drawMainland(ctx, m, pal) {
  const n = naturePalette(pal);
  const wave = (x) => Math.sin(x * 0.02) * 4 + Math.sin(x * 0.051 + 1.3) * 2.5;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(m.x, m.y + m.h);
  for (let x = m.x; x <= m.x + m.w + 8; x += 8) ctx.lineTo(x, m.y + 10 + wave(x));
  ctx.lineTo(m.x + m.w, m.y + m.h);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, m.y, 0, m.y + m.h);
  g.addColorStop(0, toCss(n.dirt));
  g.addColorStop(1, toCss(n.dirtDark));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.beginPath();
  for (let x = m.x; x <= m.x + m.w + 8; x += 8) ctx.lineTo(x, m.y + wave(x));
  for (let x = m.x + m.w + 8; x >= m.x; x -= 8) ctx.lineTo(x, m.y + m.h * 0.6 + wave(x) * 0.5);
  ctx.closePath();
  const gg = ctx.createLinearGradient(0, m.y, 0, m.y + m.h * 0.6);
  gg.addColorStop(0, toCss(lighten(n.grass, 0.08)));
  gg.addColorStop(1, toCss(n.grassDark));
  ctx.fillStyle = gg;
  ctx.fill();
  ctx.restore();
}

// ── buildings ────────────────────────────────────────────────────────────────
// Each is drawn around its base point with u = one "unit" (r / 20).

const BUILDINGS = {
  git(ctx, u, n, col) { // a tree whose fruit are commits on a branch
    ctx.fillStyle = toCss(n.woodDark);
    roundRect(ctx, -3 * u, -18 * u, 6 * u, 18 * u, 2 * u); ctx.fill();
    ctx.fillStyle = toCss(n.grassDark);
    for (const [x, y, r] of [[-10, -24, 10], [10, -24, 10], [0, -32, 13]]) { ellipse(ctx, x * u, y * u, r * u, r * u); ctx.fill(); }
    ctx.fillStyle = toCss(lighten(n.grass, 0.1));
    ellipse(ctx, -3 * u, -35 * u, 7 * u, 5 * u); ctx.fill();
    ctx.strokeStyle = toCss(darken(col, 0.3));
    ctx.lineWidth = 1.6 * u;
    ctx.beginPath(); ctx.moveTo(-8 * u, -22 * u); ctx.lineTo(0, -30 * u); ctx.lineTo(8 * u, -24 * u); ctx.stroke();
    ctx.fillStyle = toCss(col);
    for (const [x, y] of [[-8, -22], [0, -30], [8, -24]]) { ellipse(ctx, x * u, y * u, 3.2 * u, 3.2 * u); ctx.fill(); ctx.stroke(); }
  },
  pr(ctx, u, n, col, st) { // a mailbox; the flag pops up on delivery
    ctx.fillStyle = toCss(n.woodDark);
    ctx.fillRect(-2 * u, -20 * u, 4 * u, 20 * u);
    ctx.fillStyle = toCss(col);
    ctx.strokeStyle = toCss(darken(col, 0.35));
    ctx.lineWidth = 1.4 * u;
    ctx.beginPath();
    ctx.moveTo(-12 * u, -19 * u); ctx.lineTo(-12 * u, -30 * u);
    ctx.arc(0, -30 * u, 12 * u, Math.PI, 0);
    ctx.lineTo(12 * u, -19 * u); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = toCss(darken(col, 0.4));
    roundRect(ctx, -12 * u, -28 * u, 3 * u, 7 * u, 1 * u); ctx.fill();
    const up = Math.max(st.pulse || 0, st.glow || 0);
    ctx.save();
    ctx.translate(13 * u, -22 * u);
    ctx.rotate(-Math.PI / 2 * up);
    ctx.fillStyle = toCss(darken(n.woodDark, 0.1));
    ctx.fillRect(-1 * u, -12 * u, 2 * u, 12 * u);
    ctx.fillStyle = toCss(C('#e5484d'));
    ctx.fillRect(1 * u, -12 * u, 7 * u, 5 * u);
    ctx.restore();
  },
  jira(ctx, u, n, col) { // a post office
    ctx.fillStyle = toCss(n.wall);
    ctx.strokeStyle = toCss(darken(n.wall, 0.4));
    ctx.lineWidth = 1.2 * u;
    ctx.fillRect(-15 * u, -22 * u, 30 * u, 22 * u); ctx.strokeRect(-15 * u, -22 * u, 30 * u, 22 * u);
    ctx.fillStyle = toCss(col);
    ctx.beginPath(); ctx.moveTo(-19 * u, -21 * u); ctx.lineTo(0, -37 * u); ctx.lineTo(19 * u, -21 * u); ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = toCss(darken(col, 0.35)); ctx.stroke();
    ctx.fillStyle = toCss(darken(n.wood, 0.25));
    roundRect(ctx, -4 * u, -12 * u, 8 * u, 12 * u, 2 * u); ctx.fill();
    // Envelope sign.
    ctx.fillStyle = toCss(C('#ffffff'));
    ctx.fillRect(-6 * u, -20 * u, 12 * u, 6.5 * u);
    ctx.strokeStyle = toCss(darken(col, 0.2));
    ctx.lineWidth = 1 * u;
    ctx.strokeRect(-6 * u, -20 * u, 12 * u, 6.5 * u);
    ctx.beginPath(); ctx.moveTo(-6 * u, -20 * u); ctx.lineTo(0, -16 * u); ctx.lineTo(6 * u, -20 * u); ctx.stroke();
  },
  terminal(ctx, u, n, col, st, t) { // a little forge with a chimney
    ctx.fillStyle = toCss(n.rock);
    ctx.strokeStyle = toCss(n.rockDark);
    ctx.lineWidth = 1.2 * u;
    roundRect(ctx, -15 * u, -21 * u, 30 * u, 21 * u, 3 * u); ctx.fill(); ctx.stroke();
    ctx.fillStyle = toCss(n.rockDark);
    ctx.fillRect(5 * u, -34 * u, 7 * u, 14 * u);
    ctx.fillStyle = toCss(darken(n.rockDark, 0.3));
    ctx.fillRect(-17 * u, -23 * u, 34 * u, 4 * u);
    const heat = 0.55 + 0.45 * Math.max(st.pulse || 0, st.glow || 0);
    ctx.fillStyle = toCss(C('#2a1a12'));
    roundRect(ctx, -10 * u, -15 * u, 12 * u, 9 * u, 2 * u); ctx.fill();
    ctx.fillStyle = toCss(col, heat);
    ctx.font = `800 ${Math.round(7 * u)}px ui-monospace, Menlo, monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('>_', -4 * u, -10.5 * u);
    // Lazy smoke from the chimney.
    for (let k = 0; k < 3; k++) {
      const p = ((t * 0.5 + k / 3) % 1);
      ctx.fillStyle = toCss(lighten(n.rock, 0.3), 0.35 * (1 - p));
      ellipse(ctx, 8.5 * u + Math.sin(p * 6 + k) * 2 * u, -36 * u - p * 14 * u, (2 + p * 3) * u, (2 + p * 3) * u);
      ctx.fill();
    }
  },
  web(ctx, u, n, col, st, t) { // a lattice tower with a balloon
    ctx.strokeStyle = toCss(n.woodDark);
    ctx.lineWidth = 1.6 * u;
    ctx.beginPath();
    ctx.moveTo(-10 * u, 0); ctx.lineTo(-3 * u, -24 * u); ctx.moveTo(10 * u, 0); ctx.lineTo(3 * u, -24 * u);
    for (const y of [-6, -13, -20]) {
      const k = -y / 24, half = 10 - 7 * k;
      ctx.moveTo(-half * u, y * u); ctx.lineTo(half * u, y * u);
    }
    ctx.moveTo(-8 * u, -6 * u); ctx.lineTo(6 * u, -13 * u); ctx.moveTo(8 * u, -6 * u); ctx.lineTo(-6 * u, -13 * u);
    ctx.stroke();
    const sway = Math.sin(t * 1.3) * 2 * u;
    ctx.strokeStyle = toCss(darken(n.woodDark, 0.2), 0.8);
    ctx.lineWidth = 1 * u;
    ctx.beginPath(); ctx.moveTo(0, -24 * u); ctx.quadraticCurveTo(sway, -28 * u, sway, -31 * u); ctx.stroke();
    ctx.fillStyle = toCss(col);
    ellipse(ctx, sway, -39 * u, 8 * u, 9.5 * u); ctx.fill();
    ctx.fillStyle = toCss(C('#ffffff'), 0.5);
    ellipse(ctx, sway - 3 * u, -42 * u, 2 * u, 3 * u); ctx.fill();
  },
  files(ctx, u, n) { // a shed with paper stacked outside
    ctx.fillStyle = toCss(n.wood);
    ctx.strokeStyle = toCss(n.woodDark);
    ctx.lineWidth = 1.2 * u;
    ctx.fillRect(-13 * u, -19 * u, 24 * u, 19 * u); ctx.strokeRect(-13 * u, -19 * u, 24 * u, 19 * u);
    ctx.beginPath();
    for (let x = -9; x < 11; x += 5) { ctx.moveTo(x * u, -19 * u); ctx.lineTo(x * u, 0); }
    ctx.stroke();
    ctx.fillStyle = toCss(n.woodDark);
    ctx.beginPath(); ctx.moveTo(-16 * u, -17 * u); ctx.lineTo(14 * u, -27 * u); ctx.lineTo(15 * u, -23 * u); ctx.lineTo(-15 * u, -14 * u); ctx.closePath(); ctx.fill();
    ctx.fillStyle = toCss(darken(n.woodDark, 0.25));
    ctx.fillRect(-6 * u, -12 * u, 7 * u, 12 * u);
    ctx.fillStyle = toCss(C('#fbfaf6'));
    ctx.strokeStyle = toCss(C('#9aa0a8'));
    ctx.lineWidth = 0.8 * u;
    for (let k = 0; k < 3; k++) {
      ctx.save(); ctx.translate(16 * u, -2 * u - k * 2.4 * u); ctx.rotate((k - 1) * 0.12);
      ctx.fillRect(-4 * u, -1.2 * u, 8 * u, 2.4 * u); ctx.strokeRect(-4 * u, -1.2 * u, 8 * u, 2.4 * u);
      ctx.restore();
    }
  },
  human(ctx, u, n, col, st) { // the bell you get rung with
    ctx.fillStyle = toCss(n.woodDark);
    ctx.fillRect(-13 * u, -34 * u, 3.5 * u, 34 * u);
    ctx.fillRect(9.5 * u, -34 * u, 3.5 * u, 34 * u);
    ctx.fillStyle = toCss(n.wood);
    roundRect(ctx, -16 * u, -38 * u, 32 * u, 5 * u, 2 * u); ctx.fill();
    ctx.fillStyle = toCss(darken(n.wood, 0.2));
    ctx.beginPath(); ctx.moveTo(-18 * u, -37 * u); ctx.lineTo(0, -45 * u); ctx.lineTo(18 * u, -37 * u); ctx.closePath(); ctx.fill();
    ctx.save();
    ctx.translate(0, -33 * u);
    ctx.rotate(st.wiggle || 0);
    ctx.fillStyle = toCss(n.gold);
    ctx.strokeStyle = toCss(darken(n.gold, 0.35));
    ctx.lineWidth = 1.2 * u;
    ctx.beginPath();
    ctx.moveTo(-9 * u, 14 * u);
    ctx.quadraticCurveTo(-7 * u, 12 * u, -7 * u, 6 * u);
    ctx.bezierCurveTo(-7 * u, -1 * u, 7 * u, -1 * u, 7 * u, 6 * u);
    ctx.quadraticCurveTo(7 * u, 12 * u, 9 * u, 14 * u);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = toCss(darken(n.gold, 0.4));
    ellipse(ctx, 0, 15.5 * u, 2 * u, 2 * u); ctx.fill();
    ctx.fillStyle = toCss(C('#ffffff'), 0.5);
    ellipse(ctx, -3 * u, 4 * u, 1.4 * u, 3 * u); ctx.fill();
    ctx.restore();
  },
};

/**
 * A landmark building at lm.x, standing on lm.baseY.
 * @param {object} st { pulse 0..1, ring 0..1|null, glow 0..1, wiggle radians }
 */
export function drawBuilding(ctx, lm, pal, st, caption, t, compact = false) {
  const col = kindColor(lm.kind, pal);
  const n = naturePalette(pal);
  const u = lm.r / 20;
  const baseY = lm.baseY ?? lm.y + lm.r;

  if (st.glow > 0.01) {
    const g = ctx.createRadialGradient(lm.x, lm.y, lm.r * 0.5, lm.x, lm.y, lm.r * 2.1);
    g.addColorStop(0, toCss(col, 0.45 * st.glow));
    g.addColorStop(1, toCss(col, 0));
    ctx.fillStyle = g;
    ellipse(ctx, lm.x, lm.y, lm.r * 2.1, lm.r * 2.1);
    ctx.fill();
  }
  if (st.ring != null && st.ring < 1) {
    ctx.strokeStyle = toCss(col, 1 - st.ring);
    ctx.lineWidth = 3 * (1 - st.ring) + 0.5;
    ellipse(ctx, lm.x, lm.y, lm.r * (1 + st.ring * 1.4), lm.r * (1 + st.ring * 1.4));
    ctx.stroke();
  }

  ctx.save();
  ctx.translate(lm.x, baseY);
  // Hit: a springy squash anchored on the ground.
  const p = st.pulse || 0;
  ctx.scale(1 + 0.1 * p, 1 + 0.18 * p);
  if (!compact) {
    ctx.fillStyle = toCss(darken(n.grassDark, 0.35), 0.35);
    ellipse(ctx, 0, 0, 17 * u, 3.5 * u); ctx.fill();
  }
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  BUILDINGS[lm.kind]?.(ctx, u, n, col, st, t);
  ctx.restore();

  if (caption && !compact) {
    haloText(ctx, caption, lm.x, baseY + 11, pal, 0.75, '600 10px system-ui, -apple-system, Segoe UI, sans-serif');
  }
}
