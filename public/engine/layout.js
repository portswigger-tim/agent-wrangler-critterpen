// Pure layout: where landmarks sit, how tasks are tiled, where each critter lives.

import { hash32, clamp } from './util.js';

/** Clockwise from top-left. `fx`/`fy` are fractions of the pen size. */
const LANDMARK_SPOTS = [
  { kind: 'git', side: 'top', f: 0.2 },
  { kind: 'pr', side: 'top', f: 0.5 },
  { kind: 'jira', side: 'top', f: 0.8 },
  { kind: 'terminal', side: 'right', f: 0.5 },
  { kind: 'files', side: 'bottom', f: 0.72 },
  { kind: 'web', side: 'bottom', f: 0.28 },
  { kind: 'human', side: 'left', f: 0.5 },
];

export const LANDMARK_LABELS = {
  git: 'git', pr: 'PRs', jira: 'Jira', terminal: 'shell', files: 'files', web: 'web', human: 'you',
};

/** Below this height the pen switches to a single-row "tray" layout. */
export const COMPACT_HEIGHT = 170;

/**
 * Landmark positions around the pen edge (or in a strip on the right when compact).
 * @param {number} w
 * @param {number} h
 * @returns {{ landmarks: Array<{kind:string,x:number,y:number,r:number,side:string}>, inner: {x:number,y:number,w:number,h:number}, compact: boolean }}
 */
export function landmarkSlots(w, h) {
  const compact = h < COMPACT_HEIGHT;
  if (compact) {
    let r = clamp(h * 0.14, 9, 15);
    // Narrow trays stack the landmark strip into two rows.
    const rows = LANDMARK_SPOTS.length * (r * 2 + 8) > w * 0.4 && h >= 4 * r + 20 ? 2 : 1;
    const perRow = Math.ceil(LANDMARK_SPOTS.length / rows);
    const gap = r * 2 + 8;
    const stripW = perRow * gap + 8;
    const x0 = w - stripW + gap / 2;
    const landmarks = LANDMARK_SPOTS.map((s, i) => ({
      kind: s.kind, side: 'right', r,
      x: x0 + (i % perRow) * gap,
      y: rows === 1 ? h / 2 - 4 : h / 2 + (Math.floor(i / perRow) - 0.5) * gap,
    }));
    return { landmarks, inner: { x: 6, y: 4, w: Math.max(40, w - stripW - 10), h: h - 8 }, compact };
  }
  const r = clamp(Math.min(w, h) * 0.05, 15, 24);
  const pad = r + 10;
  const landmarks = LANDMARK_SPOTS.map(({ kind, side, f }) => {
    const x = side === 'left' ? pad : side === 'right' ? w - pad : w * f;
    const y = side === 'top' ? pad : side === 'bottom' ? h - pad - 8 : h * f;
    return { kind, side, r, x, y };
  });
  // Leave a band for landmarks (and their captions) on every side.
  const band = 2 * r + 30;
  const inner = { x: band, y: band + 4, w: Math.max(60, w - 2 * band), h: Math.max(60, h - 2 * band - 12) };
  return { landmarks, inner, compact };
}

const TASK_LABEL_H = 18;
const JITTER_X = 0.24; // total horizontal jitter, as a fraction of radius
const NAME_LABEL_H = 16;

/** Horizontal / vertical spacing between critters of radius r. */
export const spacingFor = (r) => ({ col: Math.max(r * 3.3, 62), row: r * 2.9 + NAME_LABEL_H + 6 });

/**
 * Largest critter radius (and column count) so k critters fit a cw×ch cell.
 * @returns {{ r: number, cols: number, rows: number }}
 */
export function fitCluster(k, cw, ch, maxR = 24, minR = 7) {
  maxR = Math.max(maxR, minR);
  for (let r = maxR; r >= minR; r -= 0.5) {
    const sp = spacingFor(r);
    const cols = Math.max(1, Math.min(k, Math.floor((cw - 8) / sp.col)));
    const rows = Math.ceil(k / cols);
    if (rows * sp.row + TASK_LABEL_H + r * 1.6 <= ch && (cols * sp.col <= cw || cols === 1)) return { r, cols, rows };
  }
  const sp = spacingFor(minR);
  const cols = Math.max(1, Math.min(k, Math.floor((cw - 8) / sp.col)));
  return { r: minR, cols, rows: Math.ceil(k / cols) };
}

/**
 * Order critters within a task: parents first, each followed by its children
 * (depth-first), otherwise preserving input order. Keeps leashed pairs adjacent.
 * @template {{id:string,parentId?:string}} T
 * @param {T[]} list
 * @returns {T[]}
 */
export function familyOrder(list) {
  const ids = new Set(list.map((c) => c.id));
  const kids = new Map();
  const roots = [];
  for (const c of list) {
    if (c.parentId && ids.has(c.parentId) && c.parentId !== c.id) {
      if (!kids.has(c.parentId)) kids.set(c.parentId, []);
      kids.get(c.parentId).push(c);
    } else roots.push(c);
  }
  const out = [], seen = new Set();
  const visit = (c) => {
    if (seen.has(c.id)) return;
    seen.add(c.id);
    out.push(c);
    for (const k of kids.get(c.id) || []) visit(k);
  };
  roots.forEach(visit);
  list.forEach(visit); // cycles: anything not reached from a root
  return out;
}

/**
 * Group critters by task (first-appearance order).
 * @template {{taskId:string, taskName:string}} T
 * @param {T[]} critters
 */
export function groupByTask(critters) {
  const groups = new Map();
  for (const c of critters) {
    if (!groups.has(c.taskId)) groups.set(c.taskId, { taskId: c.taskId, taskName: c.taskName, members: [] });
    groups.get(c.taskId).members.push(c);
  }
  return [...groups.values()];
}

/**
 * Choose a column count for n cells in a W×H area that maximises the radius
 * the most crowded cluster can have.
 */
export function chooseGrid(counts, W, H, maxR = 24) {
  const n = counts.length;
  let best = { cols: 1, rows: n, r: -1, miss: Infinity };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cw = W / cols, ch = H / rows;
    const fits = counts.map((k) => fitCluster(k, cw, ch, maxR));
    const r = Math.min(...fits.map((f) => f.r));
    // The radius is capped, so many grids tie. Among those, prefer cells whose
    // shape matches the clusters' natural shape: that fills the pen in both
    // directions instead of leaving a band of empty space.
    const miss = fits.reduce((sum, f) => {
      const sp = spacingFor(f.r);
      const aspect = (f.cols * sp.col) / (f.rows * sp.row + TASK_LABEL_H + f.r * 1.6);
      return sum + Math.abs(Math.log((cw / ch) / aspect));
    }, 0) / n;
    if (r > best.r + 0.01 || (Math.abs(r - best.r) <= 0.01 && miss < best.miss)) best = { cols, rows, r, miss };
  }
  return { cols: best.cols, rows: best.rows, r: best.r };
}

/**
 * Full layout for a set of (non-departing) critters.
 * @param {{ width: number, height: number, critters: Array<{id:string,taskId:string,taskName:string,parentId?:string}> }} input
 */
export function computeLayout({ width, height, critters }) {
  const { landmarks, inner, compact } = landmarkSlots(width, height);
  const groups = groupByTask(critters);
  /** @type {Map<string, {x:number,y:number,r:number}>} */
  const slots = new Map();
  const clusters = [];
  if (!groups.length) return { landmarks, inner, compact, clusters, slots, labelWidth: 60, radius: 20 };

  // Critters grow a little on big screens, but never become beach balls.
  const maxR = clamp(Math.min(width, height) / 24, 16, 30);
  const grid = compact
    ? { cols: groups.length, rows: 1 }
    : chooseGrid(groups.map((g) => g.members.length), inner.w, inner.h, maxR);

  // Weight compact columns by member count so big tasks get room.
  const total = critters.length;
  let radius = Infinity, labelWidth = Infinity;
  let cxCursor = inner.x;
  groups.forEach((g, gi) => {
    const col = gi % grid.cols, row = Math.floor(gi / grid.cols);
    const rowsUsed = Math.ceil(groups.length / grid.cols);
    const inLastRow = row === rowsUsed - 1;
    const lastCount = groups.length - (rowsUsed - 1) * grid.cols;
    let cw, cx0, cy0, ch;
    if (compact) {
      cw = inner.w * (g.members.length / total);
      cx0 = cxCursor;
      cxCursor += cw;
      ch = inner.h; cy0 = inner.y;
    } else {
      cw = inner.w / grid.cols;
      ch = inner.h / grid.rows;
      // Centre a short last row.
      const offset = inLastRow ? ((grid.cols - lastCount) * cw) / 2 : 0;
      cx0 = inner.x + col * cw + offset;
      cy0 = inner.y + row * ch;
    }
    const fit = compact
      ? fitCompact(g.members.length, cw, ch)
      : fitCluster(g.members.length, cw, ch, maxR);
    const sp = spacingFor(fit.r);
    // Spread columns out (up to a point) when there is room, so names fit.
    const colSp = compact
      ? Math.min(sp.col, cw / Math.max(1, fit.cols))
      : clamp((cw * 0.9) / fit.cols, sp.col, Math.max(sp.col, 130));
    const rowSp = sp.row;
    const blockW = fit.cols * colSp;
    const blockH = fit.rows * rowSp;
    // Headroom above the first row for the task label plus hats and hops.
    const head = compact ? 0 : TASK_LABEL_H + fit.r * 1.6;
    const top = cy0 + (ch - blockH - head) / 2 + head;
    const left = cx0 + (cw - blockW) / 2;
    const ordered = familyOrder(g.members);
    ordered.forEach((c, i) => {
      const rIdx = Math.floor(i / fit.cols);
      const inRow = Math.min(fit.cols, ordered.length - rIdx * fit.cols);
      const rowLeft = left + ((fit.cols - inRow) * colSp) / 2;
      const h = hash32(c.id);
      const jx = (((h & 0xff) / 255) - 0.5) * fit.r * JITTER_X;
      const jy = ((((h >>> 8) & 0xff) / 255) - 0.5) * fit.r * 0.35;
      slots.set(c.id, {
        x: rowLeft + colSp * ((i % fit.cols) + 0.5) + jx,
        y: top + rIdx * rowSp + fit.r * 1.45 + jy,
        r: fit.r,
      });
    });
    radius = Math.min(radius, fit.r);
    // Neighbours can jitter toward each other; keep their labels apart.
    labelWidth = Math.min(labelWidth, colSp - 8 - fit.r * JITTER_X);
    clusters.push({
      taskId: g.taskId, taskName: g.taskName,
      cell: { x: cx0, y: cy0, w: cw, h: ch },
      block: { x: left, y: top, w: blockW, h: blockH },
      cx: left + blockW / 2, cy: top + blockH / 2,
      labelY: compact ? cy0 + ch : top - fit.r * 1.45,
      count: g.members.length,
    });
  });
  return { landmarks, inner, compact, clusters, slots, labelWidth, radius };
}

/** Single-row fit used by the compact tray. */
function fitCompact(k, cw, ch) {
  const r = clamp(Math.min((ch - TASK_LABEL_H - NAME_LABEL_H) / 2.7, (cw / k) / 3.1), 6, 16);
  return { r, cols: k, rows: 1 };
}
