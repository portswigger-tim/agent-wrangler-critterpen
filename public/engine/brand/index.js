// Official brand marks, used only on building caption planks to name the
// service, never on critters or projectiles, never animated, recoloured,
// distorted or decorated. Each mark is drawn exactly as its owner publishes
// it, changed only in size. See ./NOTICE.md for sources, owners and licences.
//
// Only marks whose guidelines allow this use are listed. GitHub's and
// Atlassian's guidelines don't clearly allow it for this project, so the
// PRs and Jira planks stay text only.

import { GIT_MARK } from './git.js';
import { parseColor, contrast } from '../color.js';

/** Which building plank carries which mark (by landmark kind). */
export const PLANK_MARKS = Object.freeze({ git: GIT_MARK });

/**
 * The official variant with the best contrast on `background`, chosen only
 * among the variants the owner publishes (no recolouring).
 * @returns {string} variant name, e.g. 'black' | 'white'
 */
export function markVariantFor(mark, background) {
  let best = null,
    bestC = -1;
  for (const [name, v] of Object.entries(mark.variants)) {
    const c = contrast(parseColor(v.fill), background);
    if (c > bestC) {
      best = name;
      bestC = c;
    }
  }
  return best;
}

/** Parse an SVG transform made of translate(x y) and rotate(a cx cy) into steps. */
export function transformSteps(svgTransform) {
  const steps = [];
  for (const m of svgTransform.matchAll(/(translate|rotate)\(([^)]*)\)/g)) {
    const n = m[2]
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (m[1] === 'translate') steps.push({ op: 'translate', x: n[0], y: n[1] || 0 });
    else steps.push({ op: 'rotate', deg: n[0], cx: n[1] || 0, cy: n[2] || 0 });
  }
  return steps;
}

const paths = new Map();

/**
 * Draw `mark` fitted into a size×size box centred on (x, y), in one of its
 * official variants. The only change from the published SVG is the scale.
 * Returns false where Path2D is unavailable (e.g. Node tests).
 */
export function drawMark(ctx, mark, x, y, size, variant) {
  if (typeof Path2D === 'undefined') return false;
  const v = mark.variants[variant];
  if (!v) return false;
  let p = paths.get(mark);
  if (!p) {
    p = new Path2D(mark.path);
    paths.set(mark, p);
  }
  const [vx, vy, vw, vh] = mark.viewBox.split(/\s+/).map(Number);
  const k = size / Math.max(vw, vh);
  ctx.save();
  ctx.translate(x - (vw * k) / 2, y - (vh * k) / 2);
  ctx.scale(k, k);
  ctx.translate(-vx, -vy);
  for (const s of transformSteps(mark.transform)) {
    if (s.op === 'translate') ctx.translate(s.x, s.y);
    else {
      ctx.translate(s.cx, s.cy);
      ctx.rotate((s.deg * Math.PI) / 180);
      ctx.translate(-s.cx, -s.cy);
    }
  }
  ctx.fillStyle = v.fill;
  ctx.fill(p);
  ctx.restore();
  return true;
}
