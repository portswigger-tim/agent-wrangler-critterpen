// Vector art: critters, accessories, landmarks, projectiles, particles.
// Every function draws with the given ctx and leaves its state as it found it.

import { TAU } from './util.js';
import { toCss, mix, lighten, darken, parseColor } from './color.js';

export const ACCESSORIES = ['none', 'party', 'tophat', 'beanie', 'bow', 'antenna', 'sprout', 'crown', 'propeller', 'headphones'];

const INK = parseColor('#1d2026');
const WHITE = parseColor('#ffffff');
const BLUSH = parseColor('#ff7a9a');

/** HSL (0..360, 0..1, 0..1) → RGBA. */
export function hsl(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255, a: 1 };
}

/** Tint for eyes/accessory by agent type (Claude warm, Codex teal, others by hash). */
export function agentTint(agent, seed) {
  const a = String(agent || '').toLowerCase();
  if (a.includes('claude')) return parseColor('#d97757');
  if (a.includes('codex')) return parseColor('#22a699');
  return hsl(seed % 360, 0.55, 0.55);
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

/** Soft ground shadow. `lift` 0..1 shrinks/fades it while airborne. */
export function drawShadow(ctx, x, y, r, lift, pal, alpha = 1) {
  const s = 1 - Math.min(0.6, lift * 0.6);
  ctx.fillStyle = toCss(pal.dark ? { r: 0, g: 0, b: 0, a: 1 } : darken(pal.bg, 0.5), (pal.dark ? 0.45 : 0.18) * s * alpha);
  ellipse(ctx, x, y + 1, r * 0.85 * s, r * 0.22 * s);
  ctx.fill();
}

/**
 * Draw one critter. Origin = ground contact point; body centre is (0, -r).
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

  const shade = darken(color, 0.28);

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
  ctx.fillStyle = toCss(shade);
  ellipse(ctx, -r * 0.4 + fs * r * 0.12, -r * 0.08 + fd * r * 0.25 - Math.max(0, fs) * r * 0.1, r * 0.27, r * 0.17);
  ctx.fill();
  ellipse(ctx, r * 0.4 + fs * r * 0.12, -r * 0.08 + fd * r * 0.25 - Math.max(0, -fs) * r * 0.1, r * 0.27, r * 0.17);
  ctx.fill();

  // Back arm (the waving hand sits behind on the far side when not waving).
  if (p.wave != null) drawArm(ctx, r, p.wave, shade, color);

  // Body sphere.
  const grad = ctx.createRadialGradient(-r * 0.38, -r * 1.42, r * 0.08, 0, -r, r * 1.08);
  grad.addColorStop(0, toCss(lighten(color, 0.45)));
  grad.addColorStop(0.5, toCss(color));
  grad.addColorStop(1, toCss(darken(color, 0.16)));
  ctx.fillStyle = grad;
  ellipse(ctx, 0, -r, r, r);
  ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.06);
  ctx.strokeStyle = toCss(shade, 0.55);
  ctx.stroke();
  // Specular highlight.
  ctx.fillStyle = toCss(WHITE, 0.55);
  ellipse(ctx, -r * 0.4, -r * 1.5, r * 0.2, r * 0.12, -0.6);
  ctx.fill();

  // Face, nudged toward where the critter is looking.
  const lx = (p.lookX || 0) * r * 0.16, ly = (p.lookY || 0) * r * 0.1;
  ctx.save();
  ctx.translate(lx, ly);
  if (p.cheeks !== false) {
    ctx.fillStyle = toCss(BLUSH, 0.32);
    ellipse(ctx, -r * 0.56, -r * 0.86, r * 0.16, r * 0.09); ctx.fill();
    ellipse(ctx, r * 0.56, -r * 0.86, r * 0.16, r * 0.09); ctx.fill();
  }
  drawEyes(ctx, r, p, t);
  drawMouth(ctx, r, p.mouth || 'smile', p.eyeInk || INK);
  ctx.restore();

  drawAccessory(ctx, p.accessory || 'none', r, p.tint || color, t, p);
  ctx.restore();
}

function drawArm(ctx, r, angle, shade, color) {
  ctx.save();
  ctx.translate(r * 0.82, -r * 0.95);
  ctx.rotate(angle);
  ctx.fillStyle = toCss(color);
  ctx.strokeStyle = toCss(shade, 0.7);
  ctx.lineWidth = Math.max(1, r * 0.05);
  ellipse(ctx, r * 0.1, -r * 0.32, r * 0.17, r * 0.3, 0.2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawEyes(ctx, r, p, t) {
  const ink = p.eyeInk || INK;
  const ex = r * 0.32, ey = -r * 1.1;
  const eyes = p.eyes || 'open';
  ctx.strokeStyle = toCss(ink);
  ctx.fillStyle = toCss(ink);
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1.1, r * 0.075);
  for (const side of [-1, 1]) {
    const cx = side * ex;
    if (eyes === 'closed') {
      ctx.beginPath();
      ctx.arc(cx, ey - r * 0.06, r * 0.13, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    } else if (eyes === 'happy') {
      ctx.beginPath();
      ctx.arc(cx, ey + r * 0.06, r * 0.13, 1.15 * Math.PI, 1.85 * Math.PI);
      ctx.stroke();
    } else if (eyes === 'spiral') {
      ctx.save();
      ctx.translate(cx, ey);
      ctx.rotate(t * 5 * side);
      ctx.lineWidth = Math.max(0.9, r * 0.05);
      ctx.beginPath();
      for (let a = 0; a <= 3.2 * Math.PI; a += 0.25) {
        const rr = (a / (3.2 * Math.PI)) * r * 0.17;
        const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
        a === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.restore();
    } else {
      const open = p.blink == null ? 1 : p.blink;
      const big = eyes === 'wide' ? 1.2 : 1;
      ellipse(ctx, cx, ey, r * 0.13 * big, r * 0.19 * big * Math.max(0.08, open));
      ctx.fill();
      if (open > 0.4) {
        ctx.fillStyle = toCss(WHITE, 0.95);
        ellipse(ctx, cx - r * 0.04 + (p.lookX || 0) * r * 0.03, ey - r * 0.07, r * 0.05 * big, r * 0.05 * big);
        ctx.fill();
        ctx.fillStyle = toCss(ink);
      }
    }
  }
}

function drawMouth(ctx, r, mouth, ink) {
  const my = -r * 0.78;
  ctx.strokeStyle = toCss(ink);
  ctx.fillStyle = toCss(ink);
  ctx.lineWidth = Math.max(1, r * 0.06);
  ctx.lineCap = 'round';
  ctx.beginPath();
  switch (mouth) {
    case 'smile': ctx.arc(0, my - r * 0.08, r * 0.13, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke(); break;
    case 'grin':
      ctx.arc(0, my - r * 0.06, r * 0.18, 0, Math.PI); ctx.closePath();
      ctx.fillStyle = toCss(darken(BLUSH, 0.45)); ctx.fill(); break;
    case 'o': ellipse(ctx, 0, my, r * 0.07, r * 0.09); ctx.fill(); break;
    case 'small-o': ellipse(ctx, 0, my, r * 0.045, r * 0.05); ctx.fill(); break;
    case 'wavy':
      for (let i = 0; i <= 4; i++) {
        const px = -r * 0.16 + i * r * 0.08, py = my + (i % 2 ? -1 : 1) * r * 0.035;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.stroke(); break;
    case 'flat': ctx.moveTo(-r * 0.08, my); ctx.lineTo(r * 0.08, my); ctx.stroke(); break;
    default: break;
  }
}

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

/** Simple vector landmark icons drawn inside radius s, centred at origin. */
const ICONS = {
  git(ctx, s) {
    const d = s * 0.17;
    ctx.beginPath(); ctx.moveTo(-s * 0.3, s * 0.55); ctx.lineTo(-s * 0.3, -s * 0.55); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-s * 0.3, s * 0.25); ctx.bezierCurveTo(-s * 0.3, -s * 0.05, s * 0.35, s * 0.05, s * 0.35, -s * 0.3); ctx.stroke();
    for (const [px, py] of [[-0.3, 0.6], [-0.3, -0.6], [0.35, -0.35]]) {
      ellipse(ctx, px * s, py * s, d, d); ctx.fill(); ctx.stroke();
    }
  },
  pr(ctx, s) {
    const d = s * 0.16;
    ctx.beginPath(); ctx.moveTo(-s * 0.35, -s * 0.45); ctx.lineTo(-s * 0.35, s * 0.45); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s * 0.35, s * 0.45); ctx.lineTo(s * 0.35, -s * 0.15);
    ctx.quadraticCurveTo(s * 0.35, -s * 0.45, s * 0.05, -s * 0.45); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s * 0.18, -s * 0.62); ctx.lineTo(s * 0.0, -s * 0.45); ctx.lineTo(s * 0.18, -s * 0.28); ctx.stroke();
    for (const [px, py] of [[-0.35, -0.6], [-0.35, 0.6], [0.35, 0.6]]) {
      ellipse(ctx, px * s, py * s, d, d); ctx.fill(); ctx.stroke();
    }
  },
  jira(ctx, s) {
    const w = s * 1.3, h = s * 0.85;
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h / 2); ctx.lineTo(w / 2, -h / 2); ctx.lineTo(w / 2, -h * 0.15);
    ctx.arc(w / 2, 0, h * 0.15, -Math.PI / 2, Math.PI / 2, true);
    ctx.lineTo(w / 2, h / 2); ctx.lineTo(-w / 2, h / 2); ctx.lineTo(-w / 2, h * 0.15);
    ctx.arc(-w / 2, 0, h * 0.15, Math.PI / 2, -Math.PI / 2, true);
    ctx.closePath(); ctx.stroke();
    ctx.setLineDash([s * 0.1, s * 0.1]);
    ctx.beginPath(); ctx.moveTo(-w * 0.18, -h / 2 + 2); ctx.lineTo(-w * 0.18, h / 2 - 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(w * 0.0, -h * 0.12); ctx.lineTo(w * 0.3, -h * 0.12);
    ctx.moveTo(w * 0.0, h * 0.15); ctx.lineTo(w * 0.22, h * 0.15); ctx.stroke();
  },
  terminal(ctx, s) {
    roundRect(ctx, -s * 0.7, -s * 0.55, s * 1.4, s * 1.1, s * 0.18); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-s * 0.4, -s * 0.2); ctx.lineTo(-s * 0.12, s * 0.02); ctx.lineTo(-s * 0.4, s * 0.24); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s * 0.02, s * 0.28); ctx.lineTo(s * 0.4, s * 0.28); ctx.stroke();
  },
  files(ctx, s) {
    ctx.beginPath();
    ctx.moveTo(-s * 0.7, -s * 0.45); ctx.lineTo(-s * 0.22, -s * 0.45); ctx.lineTo(-s * 0.08, -s * 0.3);
    ctx.lineTo(s * 0.7, -s * 0.3); ctx.lineTo(s * 0.7, s * 0.5); ctx.lineTo(-s * 0.7, s * 0.5); ctx.closePath();
    ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-s * 0.7, -s * 0.12); ctx.lineTo(s * 0.7, -s * 0.12); ctx.stroke();
  },
  web(ctx, s) {
    ellipse(ctx, 0, 0, s * 0.65, s * 0.65); ctx.stroke();
    ellipse(ctx, 0, 0, s * 0.28, s * 0.65); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-s * 0.65, 0); ctx.lineTo(s * 0.65, 0);
    ctx.moveTo(-s * 0.55, -s * 0.33); ctx.lineTo(s * 0.55, -s * 0.33);
    ctx.moveTo(-s * 0.55, s * 0.33); ctx.lineTo(s * 0.55, s * 0.33); ctx.stroke();
  },
  human(ctx, s) {
    // A little bell.
    ctx.beginPath();
    ctx.moveTo(-s * 0.55, s * 0.35);
    ctx.quadraticCurveTo(-s * 0.4, s * 0.25, -s * 0.4, -s * 0.05);
    ctx.bezierCurveTo(-s * 0.4, -s * 0.6, s * 0.4, -s * 0.6, s * 0.4, -s * 0.05);
    ctx.quadraticCurveTo(s * 0.4, s * 0.25, s * 0.55, s * 0.35);
    ctx.closePath(); ctx.stroke();
    ellipse(ctx, 0, s * 0.5, s * 0.12, s * 0.12); ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, -s * 0.48); ctx.lineTo(0, -s * 0.62); ctx.stroke();
  },
};

/**
 * Landmark badge with icon, pulse and caption.
 * @param {object} st { pulse 0..1, ring 0..1|null, glow 0..1, wiggle radians, badge number }
 */
export function drawLandmark(ctx, lm, pal, st, caption, compact) {
  const col = kindColor(lm.kind, pal);
  const base = pal['surface-2'];
  const scale = 1 + 0.22 * (st.pulse || 0);
  ctx.save();
  ctx.translate(lm.x, lm.y);

  // Expanding hit ring.
  if (st.ring != null && st.ring < 1) {
    ctx.strokeStyle = toCss(col, 1 - st.ring);
    ctx.lineWidth = 3 * (1 - st.ring) + 0.5;
    ellipse(ctx, 0, 0, lm.r * (1 + st.ring * 1.4), lm.r * (1 + st.ring * 1.4));
    ctx.stroke();
  }
  if (st.glow > 0.01) {
    const g = ctx.createRadialGradient(0, 0, lm.r * 0.7, 0, 0, lm.r * 2);
    g.addColorStop(0, toCss(col, 0.45 * st.glow));
    g.addColorStop(1, toCss(col, 0));
    ctx.fillStyle = g;
    ellipse(ctx, 0, 0, lm.r * 2, lm.r * 2);
    ctx.fill();
  }

  ctx.rotate(st.wiggle || 0);
  ctx.scale(scale, scale);
  const g = ctx.createLinearGradient(0, -lm.r, 0, lm.r);
  g.addColorStop(0, toCss(lighten(base, pal.dark ? 0.12 : 0.35)));
  g.addColorStop(1, toCss(base));
  ctx.fillStyle = g;
  roundRect(ctx, -lm.r, -lm.r, lm.r * 2, lm.r * 2, lm.r * 0.55);
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = toCss(mix(base, col, 0.35 + 0.65 * (st.pulse || 0)), 0.9);
  ctx.stroke();

  const icon = mix(pal.fg, col, 0.25 + 0.75 * Math.max(st.pulse || 0, st.glow || 0));
  ctx.strokeStyle = toCss(icon, 0.9);
  ctx.fillStyle = toCss(lighten(base, pal.dark ? 0.15 : 0.5));
  ctx.lineWidth = Math.max(1.4, lm.r * 0.09);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ICONS[lm.kind]?.(ctx, lm.r * 0.62);
  ctx.restore();

  if (st.badge) {
    const bx = lm.x + lm.r * 0.85, by = lm.y - lm.r * 0.85;
    ctx.fillStyle = toCss(pal.red);
    ellipse(ctx, bx, by, 8, 8); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '700 10px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(st.badge), bx, by + 0.5);
  }

  if (caption && !compact) {
    ctx.font = '600 10px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = toCss(pal.fg, 0.5);
    ctx.fillText(caption, lm.x, lm.y + lm.r + 5);
  }
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
