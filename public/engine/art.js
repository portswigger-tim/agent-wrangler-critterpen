// Vector art: critters, accessories, landmarks, projectiles, particles.
// Every function draws with the given ctx and leaves its state as it found it.

import { TAU } from './util.js';
import { toCss, mix, lighten, darken, parseColor, hslToRgb, inkFor } from './color.js';

export const ACCESSORIES = ['none', 'party', 'tophat', 'beanie', 'bow', 'antenna', 'sprout', 'crown', 'propeller', 'headphones'];

const INK = parseColor('#1d2026');
const WHITE = parseColor('#ffffff');
const BLUSH = parseColor('#ff6f91');
const ROSE = parseColor('#7a2438');
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clampN = (v) => (v < -1 ? -1 : v > 1 ? 1 : v);

/** HSL (0..360, 0..1, 0..1) → RGBA. */
export const hsl = (h, s, l) => hslToRgb(h, s, l);

/** Tint for eyes/accessory by agent type (Claude warm, Codex teal, others by `hue`). */
export function agentTint(agent, hue) {
  const a = String(agent || '').toLowerCase();
  if (a.includes('claude')) return parseColor('#d97757');
  if (a.includes('codex')) return parseColor('#22a699');
  return hsl(hue % 360, 0.55, 0.55);
}

/** Projectile / ring colour per event kind. */
export function kindColor(kind, pal) {
  switch (kind) {
    case 'git': return pal.accent;
    case 'pr': return pal.green;
    case 'jira': return pal.blue;
    case 'terminal': return pal.yellow;
    case 'files': return pal.dark ? lighten(pal.fg, 0.1) : mix(pal.bg, WHITE, 0.6);
    case 'web': return pal.red;
    case 'human': return pal.yellow;
    default: return pal.accent;
  }
}

const ellipse = (ctx, x, y, rx, ry, rot = 0) => {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, TAU);
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Soft contact shadow. `lift` 0..1 shrinks/fades it while airborne. */
export function drawShadow(ctx, x, y, r, lift, pal, alpha = 1) {
  const s = 1 - Math.min(0.6, lift * 0.6);
  const base = pal.dark ? { r: 0, g: 0, b: 0, a: 1 } : darken(pal.bg, 0.6);
  const a = (pal.dark ? 0.55 : 0.26) * s * alpha;
  const R = r * 0.95 * s;
  ctx.save();
  ctx.translate(x, y + 1);
  ctx.scale(1, 0.26);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
  g.addColorStop(0, toCss(base, a));
  g.addColorStop(0.5, toCss(base, a * 0.75));
  g.addColorStop(1, toCss(base, 0));
  ctx.fillStyle = g;
  ellipse(ctx, 0, 0, R, R);
  ctx.fill();
  ctx.restore();
}

/**
 * Draw one critter. Origin = ground contact point; body centre is (0, -r).
 * Pose fields beyond the basics: lidTop/lidBot 0..1 (eyelids), lidTilt
 * (radians-ish, + = determined inner corners), lookX/lookY −1..1 (gaze),
 * mouthOpen 0..1 (yawn), armsUp 0..1 (both arms raised).
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} p pose / appearance
 */
export function drawCritter(ctx, p, pal, t) {
  const { x, y, r, sx = 1, sy = 1, rot = 0, color, alpha = 1 } = p;
  if (alpha <= 0.01 || r <= 0.5) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(sx, sy);
  if (p.flip) ctx.scale(-1, 1);

  const line = inkFor(color);
  const lw = Math.max(1.1, r * 0.07);

  // Glow ring (needs-you pulse, selection, hits).
  if (p.glow > 0.01) {
    const g = ctx.createRadialGradient(0, -r, r * 0.8, 0, -r, r * 1.9);
    g.addColorStop(0, toCss(p.glowColor || color, 0.55 * p.glow));
    g.addColorStop(1, toCss(p.glowColor || color, 0));
    ctx.fillStyle = g;
    ellipse(ctx, 0, -r, r * 1.9, r * 1.9);
    ctx.fill();
  }

  // Feet: little ovals that peek out under the body.
  const fd = p.feetDrop || 0, fs = p.feetStep || 0;
  ctx.fillStyle = toCss(mix(color, line, 0.35));
  ctx.strokeStyle = toCss(line, 0.6);
  ctx.lineWidth = lw * 0.8;
  ellipse(ctx, -r * 0.4 + fs * r * 0.12, -r * 0.08 + fd * r * 0.25 - Math.max(0, fs) * r * 0.1, r * 0.27, r * 0.17);
  ctx.fill(); ctx.stroke();
  ellipse(ctx, r * 0.4 + fs * r * 0.12, -r * 0.08 + fd * r * 0.25 - Math.max(0, -fs) * r * 0.1, r * 0.27, r * 0.17);
  ctx.fill(); ctx.stroke();

  // Arms sit behind the body: both up for a stretch, else the waving one.
  if (p.armsUp > 0.01) {
    const a = 0.6 - 0.3 * p.armsUp;
    drawArm(ctx, r, a, line, color, 1);
    drawArm(ctx, r, a, line, color, -1);
  } else if (p.wave != null) drawArm(ctx, r, p.wave, line, color, 1);

  drawBody(ctx, r, color, line, lw, pal);

  // Face, nudged toward where the critter is looking.
  const gx = clampN(p.lookX || 0), gy = clampN(p.lookY || 0);
  ctx.save();
  ctx.translate(gx * r * 0.14, gy * r * 0.08);
  if (p.cheeks !== false) drawBlush(ctx, r, p.eyes === 'happy' || p.mouth === 'grin' ? 1.25 : 1);
  drawEyes(ctx, r, p, t, color, gx, gy);
  drawMouth(ctx, r, p.mouth || 'smile', p.eyeInk || INK, p.mouthOpen);
  ctx.restore();

  drawAccessory(ctx, p.accessory || 'none', r, p.tint || color, t, p);
  ctx.restore();
}

/** Body sphere: soft radial shading, under-shade, rim light, gentle outline, gloss. */
function drawBody(ctx, r, color, line, lw, pal) {
  const grad = ctx.createRadialGradient(-r * 0.35, -r * 1.45, r * 0.05, 0, -r * 0.95, r * 1.15);
  grad.addColorStop(0, toCss(lighten(color, 0.5)));
  grad.addColorStop(0.32, toCss(lighten(color, 0.14)));
  grad.addColorStop(0.75, toCss(color));
  grad.addColorStop(1, toCss(mix(color, line, 0.3)));
  ctx.fillStyle = grad;
  ellipse(ctx, 0, -r, r, r);
  ctx.fill();

  ctx.save();
  ellipse(ctx, 0, -r, r, r);
  ctx.clip();
  // Ambient occlusion toward the ground.
  const ao = ctx.createLinearGradient(0, -r * 0.75, 0, 0);
  ao.addColorStop(0, toCss(line, 0));
  ao.addColorStop(1, toCss(line, 0.32));
  ctx.fillStyle = ao;
  ctx.fillRect(-r, -r * 0.8, r * 2, r * 0.8);
  // Rim light: a crescent of bounced light along the lower right edge.
  ctx.beginPath();
  ctx.ellipse(0, -r, r, r, 0, 0, TAU);
  ctx.ellipse(-r * 0.13, -r * 1.1, r * 1.02, r * 1.02, 0, 0, TAU);
  ctx.fillStyle = toCss(lighten(color, pal.dark ? 0.55 : 0.7), pal.dark ? 0.6 : 0.75);
  ctx.fill('evenodd');
  ctx.restore();

  ellipse(ctx, 0, -r, r, r);
  ctx.lineWidth = lw;
  ctx.strokeStyle = toCss(line, pal.dark ? 0.75 : 0.7);
  ctx.stroke();

  // Soft sheen with a small glint: velvety, not glassy.
  const gl = ctx.createRadialGradient(-r * 0.42, -r * 1.48, 0, -r * 0.42, -r * 1.48, r * 0.36);
  gl.addColorStop(0, toCss(WHITE, 0.5));
  gl.addColorStop(1, toCss(WHITE, 0));
  ctx.fillStyle = gl;
  ellipse(ctx, -r * 0.42, -r * 1.48, r * 0.36, r * 0.26, -0.6);
  ctx.fill();
  ctx.fillStyle = toCss(WHITE, 0.6);
  ellipse(ctx, -r * 0.5, -r * 1.56, r * 0.075, r * 0.045, -0.6);
  ctx.fill();
}

function drawBlush(ctx, r, amount) {
  for (const side of [-1, 1]) {
    const cx = side * r * 0.6, cy = -r * 0.74;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, 0.6);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.22);
    g.addColorStop(0, toCss(BLUSH, Math.min(0.85, 0.6 * amount)));
    g.addColorStop(0.55, toCss(BLUSH, 0.32 * amount));
    g.addColorStop(1, toCss(BLUSH, 0));
    ctx.fillStyle = g;
    ellipse(ctx, 0, 0, r * 0.22, r * 0.22);
    ctx.fill();
    ctx.restore();
  }
}

function drawArm(ctx, r, angle, line, color, side) {
  ctx.save();
  if (side < 0) ctx.scale(-1, 1);
  ctx.translate(r * 0.82, -r * 0.95);
  ctx.rotate(angle);
  ctx.fillStyle = toCss(color);
  ctx.strokeStyle = toCss(line, 0.7);
  ctx.lineWidth = Math.max(1, r * 0.06);
  ellipse(ctx, r * 0.1, -r * 0.32, r * 0.17, r * 0.3, 0.2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawEyes(ctx, r, p, t, body, gx, gy) {
  const ink = p.eyeInk || INK;
  const ex = r * 0.38, ey = -r * 0.99;
  const eyes = p.eyes || 'open';
  const blink = p.blink == null ? 1 : p.blink;
  const lidTop = clamp01(Math.max(p.lidTop || 0, 1 - blink));
  const lidBot = clamp01(p.lidBot || 0);
  ctx.strokeStyle = toCss(ink);
  ctx.fillStyle = toCss(ink);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1.1, r * 0.075);
  for (const side of [-1, 1]) {
    const cx = side * ex;
    if (eyes === 'spiral') {
      ctx.save();
      ctx.translate(cx, ey);
      ctx.rotate(t * 5 * side);
      ctx.lineWidth = Math.max(0.9, r * 0.055);
      ctx.beginPath();
      for (let a = 0; a <= 3.2 * Math.PI; a += 0.25) {
        const rr = (a / (3.2 * Math.PI)) * r * 0.19;
        const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
        a === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.restore();
    } else if (eyes === 'happy') {
      ctx.beginPath();
      ctx.arc(cx, ey + r * 0.05, r * 0.155, 1.12 * Math.PI, 1.88 * Math.PI);
      ctx.stroke();
    } else if (eyes === 'closed' || lidTop > 0.9) {
      // Sleeping curve with a little lash at the outer corner.
      ctx.beginPath();
      ctx.arc(cx, ey - r * 0.03, r * 0.155, 0.12 * Math.PI, 0.88 * Math.PI);
      ctx.stroke();
      ctx.lineWidth = Math.max(0.8, r * 0.045);
      const lx = cx + side * r * 0.13, ly = ey + r * 0.03;
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + side * r * 0.07, ly - r * 0.03); ctx.stroke();
      ctx.lineWidth = Math.max(1.1, r * 0.075);
    } else {
      drawOpenEye(ctx, r, p, cx, ey, side, eyes === 'wide' ? 1.12 : 1, lidTop, lidBot, gx, gy, ink, body, t);
    }
  }
}

/** A big glossy eye: dark iris, agent-tinted glow, two highlights, optional lids. */
function drawOpenEye(ctx, r, p, cx, ey, side, big, lidTop, lidBot, gx, gy, ink, body, t) {
  const rx = r * 0.185 * big, ry = r * 0.24 * big;
  const tint = p.tint || body;
  const px = cx + gx * rx * 0.3, py = ey + gy * ry * 0.25;
  // Lid edges: the top one droops a touch in the middle and tilts toward the
  // nose; the bottom one is a cheek pushing up. The eye is clipped between
  // them, so the skin simply shows through (no painted lid to mismatch).
  const tilt = (p.lidTilt || 0) * ry;
  const xOut = cx + side * rx * 1.1, xIn = cx - side * rx * 1.1;
  const yT = ey - ry + 2 * ry * lidTop, yB = ey + ry - 2 * ry * lidBot;
  const topEdge = () => { ctx.moveTo(xOut, yT - tilt); ctx.quadraticCurveTo(cx, yT + ry * 0.16, xIn, yT + tilt); };
  const botEdge = () => { ctx.moveTo(cx + rx * 1.1, yB + ry * 0.1); ctx.quadraticCurveTo(cx, yB - ry * 0.18, cx - rx * 1.1, yB + ry * 0.1); };
  ctx.save();
  ellipse(ctx, cx, ey, rx, ry);
  ctx.clip();
  if (lidTop > 0.01) {
    ctx.beginPath(); topEdge(); ctx.lineTo(xIn, ey + ry + 2); ctx.lineTo(xOut, ey + ry + 2); ctx.closePath(); ctx.clip();
  }
  if (lidBot > 0.01) {
    ctx.beginPath(); botEdge(); ctx.lineTo(cx - rx * 1.1, ey - ry - 2); ctx.lineTo(cx + rx * 1.1, ey - ry - 2); ctx.closePath(); ctx.clip();
  }
  ctx.fillStyle = toCss(ink);
  ctx.fillRect(cx - rx, ey - ry, rx * 2, ry * 2);
  const g = ctx.createRadialGradient(px, py + ry * 0.8, 0, px, py + ry * 0.8, ry * 1.05);
  g.addColorStop(0, toCss(lighten(tint, 0.3), 0.9));
  g.addColorStop(1, toCss(tint, 0));
  ctx.fillStyle = g;
  ctx.fillRect(cx - rx, ey - ry, rx * 2, ry * 2);
  ctx.fillStyle = toCss(darken(ink, 0.6));
  ellipse(ctx, px, py - ry * 0.05, rx * 0.5, ry * 0.5);
  ctx.fill();
  // Highlights drift a little with the gaze (they're reflections of the sky).
  const hx = gx * rx * 0.12, hy = gy * ry * 0.08 + Math.max(0, lidTop - 0.25) * ry;
  ctx.fillStyle = toCss(WHITE, 0.96);
  ellipse(ctx, cx - rx * 0.28 + hx, ey - ry * 0.36 + hy, rx * 0.4, ry * 0.32, -0.3);
  ctx.fill();
  ctx.fillStyle = toCss(WHITE, 0.85);
  ellipse(ctx, cx + rx * 0.34 + hx, ey + ry * 0.34 + hy, rx * 0.17, rx * 0.17);
  ctx.fill();
  if (big > 1) {
    // Wide eyes sparkle.
    const tw = 0.6 + 0.4 * Math.sin(t * 6 + side);
    ctx.fillStyle = toCss(WHITE, 0.9 * tw);
    sparkle(ctx, cx + rx * 0.05 + hx, ey - ry * 0.05 + hy, rx * 0.22 * tw);
  }
  ctx.restore();
  // Ink line along a heavy top lid, clipped to the eye's width. Light lids
  // stay unlined: a line there reads as a frowning brow.
  if (lidTop > 0.3) {
    ctx.save();
    ctx.globalAlpha *= Math.min(1, (lidTop - 0.3) / 0.15);
    ellipse(ctx, cx, ey, rx * 1.12, ry * 1.12);
    ctx.clip();
    ctx.lineWidth = Math.max(0.9, r * 0.055);
    ctx.strokeStyle = toCss(ink);
    ctx.beginPath(); topEdge(); ctx.stroke();
    ctx.restore();
  }
  // Sleepy lids get a lash flick at the outer corner.
  if (lidTop > 0.35) {
    const lx = cx + side * rx * 0.95, ly = yT - tilt;
    ctx.lineWidth = Math.max(0.8, r * 0.045);
    ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + side * r * 0.07, ly - r * 0.04); ctx.stroke();
  }
}

/** Four-point twinkle. */
function sparkle(ctx, x, y, s) {
  if (s <= 0.05) return;
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.quadraticCurveTo(x, y, x + s, y);
  ctx.quadraticCurveTo(x, y, x, y + s);
  ctx.quadraticCurveTo(x, y, x - s, y);
  ctx.quadraticCurveTo(x, y, x, y - s);
  ctx.fill();
}

function drawMouth(ctx, r, mouth, ink, open = 0) {
  const my = -r * 0.72;
  ctx.strokeStyle = toCss(ink);
  ctx.fillStyle = toCss(ink);
  ctx.lineWidth = Math.max(1, r * 0.06);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  switch (mouth) {
    case 'smile': ctx.arc(0, my - r * 0.08, r * 0.12, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke(); break;
    case 'cat':
      ctx.arc(-r * 0.065, my - r * 0.03, r * 0.065, 0.1 * Math.PI, 0.95 * Math.PI);
      ctx.moveTo(r * 0.13, my - r * 0.02);
      ctx.arc(r * 0.065, my - r * 0.03, r * 0.065, 0.05 * Math.PI, 0.9 * Math.PI);
      ctx.stroke(); break;
    case 'grin':
      ctx.arc(0, my - r * 0.06, r * 0.17, 0, Math.PI); ctx.closePath();
      ctx.fillStyle = toCss(ROSE); ctx.fill();
      ctx.save(); ctx.clip();
      ctx.fillStyle = toCss(BLUSH, 0.9); ellipse(ctx, 0, my + r * 0.1, r * 0.1, r * 0.07); ctx.fill();
      ctx.restore(); break;
    case 'yawn': {
      const k = open || 0.6;
      const rx = r * (0.07 + 0.05 * k), ry = r * (0.05 + 0.13 * k);
      ellipse(ctx, 0, my + ry * 0.2, rx, ry);
      ctx.fillStyle = toCss(ROSE); ctx.fill();
      ctx.save(); ctx.clip();
      ctx.fillStyle = toCss(BLUSH, 0.9); ellipse(ctx, 0, my + ry * 1.05, rx * 0.8, ry * 0.5); ctx.fill();
      ctx.restore(); break;
    }
    case 'o': ellipse(ctx, 0, my, r * 0.07, r * 0.085); ctx.fillStyle = toCss(ROSE); ctx.fill(); break;
    case 'small-o': ellipse(ctx, 0, my, r * 0.045, r * 0.05); ctx.fillStyle = toCss(ROSE); ctx.fill(); break;
    case 'wavy':
      for (let i = 0; i <= 4; i++) {
        const px = -r * 0.16 + i * r * 0.08, py = my + (i % 2 ? -1 : 1) * r * 0.035;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.stroke(); break;
    case 'flat': ctx.moveTo(-r * 0.07, my); ctx.lineTo(r * 0.07, my - r * 0.015); ctx.stroke(); break;
    case 'hmm': ctx.moveTo(-r * 0.02, my + r * 0.01); ctx.quadraticCurveTo(r * 0.06, my - r * 0.03, r * 0.12, my - r * 0.01); ctx.stroke(); break;
    default: break;
  }
}

/**
 * Little social bubble beside the head: 'dots' (chatting), 'heart', 'note'
 * (humming). `b.k` 0..1 is progress; `b.side` which side of the head.
 */
export function drawChatBubble(ctx, x, y, b, pal, r) {
  const k = b.k;
  const pop = ease3(Math.min(1, k / 0.15)) * Math.min(1, (1 - k) / 0.15);
  if (pop <= 0.01) return;
  const side = b.side || 1;
  const s = Math.max(0.6, Math.min(1.2, r / 18));
  ctx.save();
  ctx.translate(x + side * r * 0.95, y);
  ctx.scale(s, s);
  if (b.kind === 'dots') {
    ctx.scale(pop, pop);
    const fill = pal.dark ? lighten(pal['surface-2'], 0.15) : WHITE;
    roundRect(ctx, -12, -18, 24, 14, 7);
    ctx.fillStyle = toCss(fill, 0.95);
    ctx.fill();
    ctx.beginPath(); ctx.moveTo(-side * 6, -5); ctx.lineTo(-side * 10, 0); ctx.lineTo(-side * 1, -5); ctx.closePath(); ctx.fill();
    for (let i = 0; i < 3; i++) {
      const on = (k * 6 - i * 0.35) % 1.2 < 0.8;
      ctx.fillStyle = toCss(pal.fg, on ? 0.75 : 0.3);
      ellipse(ctx, -6 + i * 6, -11, 1.8, 1.8); ctx.fill();
    }
  } else if (b.kind === 'heart') {
    // Rises and fades, swaying.
    ctx.translate(Math.sin(k * 9) * 2, -k * 14 - 6);
    ctx.scale(pop * 0.9, pop * 0.9);
    ctx.fillStyle = toCss(BLUSH, 0.95);
    ctx.beginPath();
    ctx.moveTo(0, 5);
    ctx.bezierCurveTo(-8, -1, -4, -8, 0, -3);
    ctx.bezierCurveTo(4, -8, 8, -1, 0, 5);
    ctx.fill();
    ctx.fillStyle = toCss(WHITE, 0.7);
    ellipse(ctx, -2.8, -3, 1.3, 1, -0.6); ctx.fill();
  } else if (b.kind === 'note') {
    const q = (k * 2) % 1;
    ctx.translate(Math.sin(q * 6) * 3, -q * 12 - 4);
    ctx.globalAlpha *= pop * Math.min(1, (1 - q) * 3);
    ctx.fillStyle = toCss(mix(pal.fg, pal.accent, 0.5), 0.9);
    ctx.font = '700 13px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(k < 0.5 ? '♪' : '♫', 0, 0);
  }
  ctx.restore();
}

const ease3 = (t) => 1 - Math.pow(1 - t, 3);

/** Accessory sitting on the head top (0, -2r), squashing with the body. */
export function drawAccessory(ctx, kind, r, tint, t, p = {}) {
  if (kind === 'none') return;
  const top = -2 * r;
  const dark = darken(tint, 0.3), light = lighten(tint, 0.45);
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1, r * 0.05);
  ctx.strokeStyle = toCss(dark);
  switch (kind) {
    case 'party': {
      ctx.translate(r * 0.18, top + r * 0.2);
      ctx.rotate(0.22);
      ctx.beginPath();
      ctx.moveTo(-r * 0.36, 0); ctx.lineTo(0, -r * 0.95); ctx.lineTo(r * 0.36, 0); ctx.closePath();
      ctx.fillStyle = toCss(tint); ctx.fill(); ctx.stroke();
      ctx.save(); ctx.clip();
      ctx.strokeStyle = toCss(light); ctx.lineWidth = r * 0.1;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(-r, -r * (0.15 + i * 0.3)); ctx.lineTo(r, -r * (0.35 + i * 0.3)); ctx.stroke(); }
      ctx.restore();
      ctx.fillStyle = toCss(light); ellipse(ctx, 0, -r * 0.97, r * 0.13, r * 0.13); ctx.fill();
      break;
    }
    case 'tophat': {
      ctx.translate(0, top + r * 0.16);
      ctx.fillStyle = toCss(dark);
      ellipse(ctx, 0, 0, r * 0.55, r * 0.11); ctx.fill();
      roundRect(ctx, -r * 0.32, -r * 0.62, r * 0.64, r * 0.62, r * 0.06);
      ctx.fillStyle = toCss(darken(tint, 0.45)); ctx.fill();
      ctx.fillStyle = toCss(tint);
      ctx.fillRect(-r * 0.32, -r * 0.2, r * 0.64, r * 0.12);
      break;
    }
    case 'beanie': {
      ctx.translate(0, top + r * 0.42);
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.74, r * 0.56, 0, Math.PI, TAU);
      ctx.closePath();
      ctx.fillStyle = toCss(tint); ctx.fill(); ctx.stroke();
      roundRect(ctx, -r * 0.76, -r * 0.08, r * 1.52, r * 0.2, r * 0.1);
      ctx.fillStyle = toCss(dark); ctx.fill();
      ctx.fillStyle = toCss(light); ellipse(ctx, 0, -r * 0.6, r * 0.16, r * 0.16); ctx.fill();
      break;
    }
    case 'bow': {
      ctx.translate(r * 0.5, top + r * 0.32);
      ctx.rotate(0.35);
      ctx.fillStyle = toCss(tint);
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(0, 0); ctx.lineTo(s * r * 0.36, -r * 0.2); ctx.lineTo(s * r * 0.36, r * 0.2); ctx.closePath();
        ctx.fill(); ctx.stroke();
      }
      ctx.fillStyle = toCss(dark); ellipse(ctx, 0, 0, r * 0.09, r * 0.09); ctx.fill();
      break;
    }
    case 'antenna': {
      const sway = Math.sin(t * 3 + (p.phase || 0)) * r * 0.15 + (p.antennaLag || 0) * r;
      ctx.beginPath();
      ctx.moveTo(0, top + r * 0.05);
      ctx.quadraticCurveTo(sway * 0.3, top - r * 0.35, sway, top - r * 0.65);
      ctx.stroke();
      const g = ctx.createRadialGradient(sway, top - r * 0.7, 0, sway, top - r * 0.7, r * 0.3);
      g.addColorStop(0, toCss(light)); g.addColorStop(0.5, toCss(tint)); g.addColorStop(1, toCss(tint, 0));
      ctx.fillStyle = g; ellipse(ctx, sway, top - r * 0.7, r * 0.3, r * 0.3); ctx.fill();
      ctx.fillStyle = toCss(tint); ellipse(ctx, sway, top - r * 0.7, r * 0.13, r * 0.13); ctx.fill();
      break;
    }
    case 'sprout': {
      const sway = Math.sin(t * 2 + (p.phase || 0)) * 0.15;
      ctx.translate(0, top + r * 0.05);
      ctx.rotate(sway);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -r * 0.4); ctx.stroke();
      ctx.fillStyle = toCss(tint);
      ellipse(ctx, -r * 0.2, -r * 0.42, r * 0.22, r * 0.1, -0.5); ctx.fill(); ctx.stroke();
      ellipse(ctx, r * 0.2, -r * 0.48, r * 0.22, r * 0.1, 0.5); ctx.fill(); ctx.stroke();
      break;
    }
    case 'crown': {
      ctx.translate(0, top + r * 0.2);
      ctx.beginPath();
      ctx.moveTo(-r * 0.38, 0); ctx.lineTo(-r * 0.42, -r * 0.4); ctx.lineTo(-r * 0.18, -r * 0.18);
      ctx.lineTo(0, -r * 0.5); ctx.lineTo(r * 0.18, -r * 0.18); ctx.lineTo(r * 0.42, -r * 0.4); ctx.lineTo(r * 0.38, 0);
      ctx.closePath();
      ctx.fillStyle = toCss(parseColor('#f5c542')); ctx.fill();
      ctx.strokeStyle = toCss(parseColor('#b8860b')); ctx.stroke();
      ctx.fillStyle = toCss(tint); ellipse(ctx, 0, -r * 0.14, r * 0.07, r * 0.07); ctx.fill();
      break;
    }
    case 'propeller': {
      ctx.translate(0, top + r * 0.3);
      ctx.beginPath(); ctx.ellipse(0, 0, r * 0.55, r * 0.36, 0, Math.PI, TAU); ctx.closePath();
      ctx.fillStyle = toCss(tint); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -r * 0.36); ctx.lineTo(0, -r * 0.55); ctx.stroke();
      const spin = (p.spin || 0);
      const w = Math.cos(spin) * r * 0.5;
      ctx.fillStyle = toCss(light);
      ellipse(ctx, w / 2, -r * 0.58, Math.abs(w) / 2 + 0.5, r * 0.07); ctx.fill();
      ellipse(ctx, -w / 2, -r * 0.58, Math.abs(w) / 2 + 0.5, r * 0.07); ctx.fill();
      ctx.fillStyle = toCss(dark); ellipse(ctx, 0, -r * 0.58, r * 0.06, r * 0.06); ctx.fill();
      break;
    }
    case 'headphones': {
      ctx.lineWidth = r * 0.12;
      ctx.beginPath(); ctx.arc(0, -r, r * 1.04, 1.1 * Math.PI, 1.9 * Math.PI); ctx.stroke();
      ctx.fillStyle = toCss(tint);
      for (const s of [-1, 1]) {
        ctx.lineWidth = Math.max(1, r * 0.05);
        roundRect(ctx, s * r * 0.98 - r * 0.14, -r * 1.25, r * 0.28, r * 0.42, r * 0.1);
        ctx.fill(); ctx.stroke();
      }
      break;
    }
  }
  ctx.restore();
}

/** Speech bubble with a glyph ("!"), anchored at its tail tip (x, y). */
export function drawBubble(ctx, x, y, text, pal, color, scale = 1) {
  if (scale <= 0.01) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  const w = 18, h = 20;
  const fill = pal.dark ? lighten(pal['surface-2'], 0.1) : WHITE;
  ctx.beginPath();
  ctx.moveTo(-3, -6); ctx.lineTo(0, 0); ctx.lineTo(4, -6);
  roundRect(ctx, -w / 2, -h - 5, w, h, 7);
  ctx.fillStyle = toCss(fill);
  ctx.strokeStyle = toCss(color);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-w / 2 + 7, -5);
  ctx.arcTo(-w / 2, -5, -w / 2, -h - 5, 7);
  ctx.arcTo(-w / 2, -h - 5, w / 2, -h - 5, 7);
  ctx.arcTo(w / 2, -h - 5, w / 2, -5, 7);
  ctx.arcTo(w / 2, -5, -w / 2, -5, 7);
  ctx.lineTo(3, -5); ctx.lineTo(0, 1); ctx.lineTo(-3, -5);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = toCss(darken(color, 0.25));
  ctx.font = '800 14px system-ui, -apple-system, Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, -h / 2 - 4);
  ctx.restore();
}

/** Three dots orbiting above the head ("…" thinking). */
export function drawThinkingDots(ctx, x, y, r, t, color) {
  for (let i = 0; i < 3; i++) {
    const a = t * 2.2 + (i * TAU) / 3;
    const depth = (Math.sin(a) + 1) / 2;
    ctx.fillStyle = toCss(color, 0.45 + 0.55 * depth);
    ellipse(ctx, x + Math.cos(a) * r * 0.85, y + Math.sin(a) * r * 0.22, r * (0.09 + 0.05 * depth), r * (0.09 + 0.05 * depth));
    ctx.fill();
  }
}

function starPath(ctx, x, y, R, rot) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 ? R * 0.45 : R;
    const a = rot + (i * Math.PI) / 5 - Math.PI / 2;
    i ? ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}

/** Dizzy stars circling the head. */
export function drawDizzyStars(ctx, x, y, r, t, color, still = false) {
  for (let i = 0; i < 3; i++) {
    const a = (still ? 0.6 : t * 3.2) + (i * TAU) / 3;
    const depth = (Math.sin(a) + 1) / 2;
    ctx.fillStyle = toCss(color, 0.55 + 0.45 * depth);
    starPath(ctx, x + Math.cos(a) * r * 0.95, y + Math.sin(a) * r * 0.25, r * (0.13 + 0.07 * depth), t * 2);
    ctx.fill();
  }
}

export function drawStar(ctx, x, y, R, rot, color, alpha = 1) {
  ctx.fillStyle = toCss(color, alpha);
  starPath(ctx, x, y, R, rot);
  ctx.fill();
}

/** Projectile glyph per kind, at (x, y) heading `angle`, age `t` seconds. */
export function drawProjectile(ctx, kind, x, y, angle, t, pal, s = 1) {
  const col = kindColor(kind, pal);
  const edge = darken(col, 0.35);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.lineWidth = 1.2;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = toCss(edge);
  ctx.fillStyle = toCss(col);
  switch (kind) {
    case 'git': {
      ellipse(ctx, 0, 0, 4.5, 4.5); ctx.fill(); ctx.stroke();
      ctx.fillStyle = toCss(lighten(col, 0.7)); ellipse(ctx, 0, 0, 1.8, 1.8); ctx.fill();
      break;
    }
    case 'pr': {
      ctx.rotate(angle);
      ctx.fillStyle = toCss(pal.dark ? lighten(col, 0.6) : WHITE);
      ctx.strokeStyle = toCss(darken(col, 0.2));
      ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-7, -6); ctx.lineTo(-3, 0); ctx.lineTo(-7, 6); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-3, 0); ctx.stroke();
      break;
    }
    case 'jira': {
      ctx.rotate(Math.sin(t * 9) * 0.5);
      roundRect(ctx, -7, -4.5, 14, 9, 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = toCss(lighten(col, 0.7)); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-3, -1.5); ctx.lineTo(4, -1.5); ctx.moveTo(-3, 1.5); ctx.lineTo(2, 1.5); ctx.stroke();
      break;
    }
    case 'terminal': {
      ctx.rotate(t * 12);
      drawStar(ctx, 0, 0, 5.5, 0, lighten(col, 0.2));
      ctx.fillStyle = toCss(WHITE, 0.9); ellipse(ctx, 0, 0, 1.8, 1.8); ctx.fill();
      break;
    }
    case 'files': {
      ctx.rotate(t * 7);
      ctx.fillStyle = toCss(col); ctx.strokeStyle = toCss(mix(col, pal.fg, 0.5), 0.8);
      ctx.fillRect(-4, -5, 8, 10); ctx.strokeRect(-4, -5, 8, 10);
      ctx.beginPath(); ctx.moveTo(-2, -2); ctx.lineTo(2, -2); ctx.moveTo(-2, 0.5); ctx.lineTo(2, 0.5); ctx.stroke();
      break;
    }
    case 'web': {
      ctx.rotate(Math.sin(t * 4) * 0.2);
      ctx.strokeStyle = toCss(mix(pal.fg, pal.bg, 0.3), 0.8); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, 7); ctx.quadraticCurveTo(-3, 11, 0, 15); ctx.stroke();
      ctx.fillStyle = toCss(col); ellipse(ctx, 0, 0, 6, 7.5); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-1.5, 7.5); ctx.lineTo(1.5, 7.5); ctx.lineTo(0, 5.5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = toCss(WHITE, 0.6); ellipse(ctx, -2, -3, 1.6, 2.4, -0.4); ctx.fill();
      break;
    }
    case 'human': {
      // A tiny heart.
      ctx.rotate(Math.sin(t * 6) * 0.25);
      ctx.beginPath();
      ctx.moveTo(0, 5);
      ctx.bezierCurveTo(-8, -1, -4, -8, 0, -3);
      ctx.bezierCurveTo(4, -8, 8, -1, 0, 5);
      ctx.fill(); ctx.stroke();
      break;
    }
    default: {
      ellipse(ctx, 0, 0, 4, 4); ctx.fill();
    }
  }
  ctx.restore();
}

/** Text with a background-coloured halo so it reads over anything. */
export function haloText(ctx, text, x, y, pal, alpha = 1, font = '600 11px system-ui, -apple-system, Segoe UI, sans-serif', color = pal.fg) {
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = toCss(pal.bg, 0.85 * alpha);
  ctx.strokeText(text, x, y);
  ctx.fillStyle = toCss(color, alpha);
  ctx.fillText(text, x, y);
}

export { roundRect, ellipse };
