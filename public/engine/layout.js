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
  const { landmarks, sky } = sceneFrame(w, h);
  return { landmarks, inner: sky, compact };
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
 * Full layout for a set of (non-departing) critters: floating islands in the
 * sky over a mainland strip, or a single row when the pen is a short tray.
 * Pass the previous result's `anchors` back in to keep islands where they were.
 * @param {{ width: number, height: number, critters: Array<{id:string,taskId:string,taskName:string,parentId?:string}>, anchors?: Map<string,{nx:number,ny:number}> }} input
 */
export function computeLayout(input) {
  return input.height < COMPACT_HEIGHT ? computeRowLayout(input) : computeIslandLayout(input);
}

/** The compact tray: tasks side by side in one row, landmarks in a strip. */
function computeRowLayout({ width, height, critters }) {
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

// ── islands ──────────────────────────────────────────────────────────────────

/** Buildings along the mainland, left to right; the bell stands front and centre. */
const MAINLAND_ORDER = ['git', 'pr', 'jira', 'human', 'terminal', 'web', 'files'];

/**
 * The fixed parts of the scene: a mainland strip along the bottom carrying the
 * landmark buildings, and the sky above it where the islands float.
 * Each landmark has `baseY` (where the building stands) and `x`/`y` (its middle,
 * which is what projectiles aim at).
 */
export function sceneFrame(w, h) {
  const mh = clamp(h * 0.17, 74, 120);
  const mainland = { x: 0, y: h - mh, w, h: mh };
  const r = clamp(Math.min((w / MAINLAND_ORDER.length) * 0.3, mh * 0.3), 12, 28);
  const margin = Math.max(r * 1.8, w * 0.06);
  const step = (w - 2 * margin) / (MAINLAND_ORDER.length - 1);
  const baseY = mainland.y + mh * 0.52;
  const landmarks = MAINLAND_ORDER.map((kind, i) => ({
    kind, side: 'bottom', r, x: margin + i * step, baseY, y: baseY - r * 1.1,
  }));
  const sky = { x: 8, y: 6, w: Math.max(40, w - 16), h: Math.max(60, mainland.y - 12) };
  return { landmarks, mainland, sky };
}

/** Sessions without a task get a small rocky islet instead of a grassy island. */
export const isUnassigned = (taskId, taskName) =>
  !taskId || taskId === 'adhoc' || /^unassigned$/i.test(String(taskName || '').trim());

/**
 * Island size for k critters of radius r. `rx`/`ry` are the walkable top
 * ellipse; `half`/`top`/`bottom` are the full box including hats above and
 * the cliff + name labels below, used for packing.
 */
export function islandSize(k, r) {
  const rx = r * (2.2 + 2.0 * Math.sqrt(Math.max(1, k)));
  const ry = Math.max(rx * 0.38, r * 1.6);
  return { rx, ry, half: rx + r * 0.6, top: ry + r * 3, bottom: ry * 2.2 + r + 14 };
}

const ISLAND_GAP = 14;
const boxAt = (s, x, y) => ({ l: x - s.half, r: x + s.half, t: y - s.top, b: y + s.bottom });
/** Signed separation of two boxes: > 0 apart by that much, < 0 overlapping. */
const separation = (a, b) => Math.max(a.l - b.r, b.l - a.r, a.t - b.b, b.t - a.b);

/**
 * Place island boxes in the sky without overlaps. Islands with an anchor
 * (their previous spot, normalised to the sky) start there and resist moving;
 * new islands go to the spot with the most clearance; then a relaxation pass
 * pushes apart any that overlap. Deterministic for the same inputs.
 * @param {Array<{id:string, half:number, top:number, bottom:number}>} specs
 * @param {{x:number,y:number,w:number,h:number}} sky
 * @param {Map<string,{nx:number,ny:number}>} [anchors]
 * @returns {{ pos: Map<string,{x:number,y:number}>, ok: boolean }}
 */
export function packIslands(specs, sky, anchors = new Map()) {
  const pos = new Map();
  const fit = (s, p) => {
    const xl = sky.x + s.half, xh = sky.x + sky.w - s.half;
    const yl = sky.y + s.top, yh = sky.y + sky.h - s.bottom;
    p.x = xl > xh ? sky.x + sky.w / 2 : clamp(p.x, xl, xh);
    p.y = yl > yh ? sky.y + sky.h / 2 : clamp(p.y, yl, yh);
    return p;
  };
  for (const s of specs) {
    const a = anchors.get(s.id);
    if (!a) continue;
    const p = fit(s, { x: sky.x + a.nx * sky.w, y: sky.y + a.ny * sky.h });
    pos.set(s.id, { ...p, ax: p.x, ay: p.y, m: 0.35 });
  }
  // New islands, biggest first, into the roomiest free spot.
  const fresh = specs.filter((s) => !pos.has(s.id)).sort((a, b) => b.half * (b.top + b.bottom) - a.half * (a.top + a.bottom));
  const NX = 16, NY = 10;
  for (const s of fresh) {
    let best = null, bestC = -Infinity;
    for (let j = 0; j <= NY; j++) {
      for (let i = 0; i <= NX; i++) {
        const p = fit(s, { x: sky.x + (sky.w * i) / NX, y: sky.y + (sky.h * j) / NY });
        const b = boxAt(s, p.x, p.y);
        let c = Math.min(b.l - sky.x, sky.x + sky.w - b.r, b.t - sky.y, sky.y + sky.h - b.b) * 0.6;
        for (const [id, q] of pos) c = Math.min(c, separation(b, boxAt(specs.find((x) => x.id === id), q.x, q.y)));
        if (c > bestC + 1e-6) { bestC = c; best = p; }
      }
    }
    pos.set(s.id, { ...best, ax: best.x, ay: best.y, m: 1 });
  }

  const list = specs.map((s) => ({ s, p: pos.get(s.id) }));
  let ok = false;
  for (let it = 0; it < 160; it++) {
    let clashes = 0;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const A = list[i], B = list[j];
        const a = boxAt(A.s, A.p.x, A.p.y), b = boxAt(B.s, B.p.x, B.p.y);
        const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l) + ISLAND_GAP;
        const oy = Math.min(a.b, b.b) - Math.max(a.t, b.t) + ISLAND_GAP;
        if (ox <= 0 || oy <= 0) continue;
        clashes++;
        const share = A.p.m / (A.p.m + B.p.m);
        if (ox / Math.max(1, sky.w) < oy / Math.max(1, sky.h)) {
          const dir = A.p.x < B.p.x || (A.p.x === B.p.x && i < j) ? -1 : 1;
          A.p.x += dir * ox * share; B.p.x -= dir * ox * (1 - share);
        } else {
          const dir = A.p.y < B.p.y || (A.p.y === B.p.y && i < j) ? -1 : 1;
          A.p.y += dir * oy * share; B.p.y -= dir * oy * (1 - share);
        }
      }
    }
    for (const { s, p } of list) {
      // A gentle pull home keeps settled islands from drifting.
      if (it < 80) { p.x += (p.ax - p.x) * 0.04; p.y += (p.ay - p.y) * 0.04; }
      fit(s, p);
    }
    if (!clashes && it >= 80) { ok = true; break; }
    if (!clashes && it < 80) ok = true;
  }
  // Final verdict on the settled positions.
  ok = list.every((A, i) => list.every((B, j) => j <= i
    || separation(boxAt(A.s, A.p.x, A.p.y), boxAt(B.s, B.p.x, B.p.y)) >= ISLAND_GAP - 0.5));
  return { pos: new Map(list.map(({ s, p }) => [s.id, { x: p.x, y: p.y }])), ok };
}

/** Where island-local (u, v) in the unit disk lands in the world, as a ground point. */
export function islandPoint(isl, u, v, r) {
  return { x: isl.cx + u * Math.max(1, isl.rx - r * 0.9), y: isl.cy + v * Math.max(1, isl.ry - r * 0.4) };
}

/** Home spots for k critters in the unit disk: a sunflower spread, centre first. */
export function homeSpots(k, seed = 0) {
  const out = [];
  const turn = (seed % 628) / 100;
  for (let i = 0; i < k; i++) {
    const rad = k === 1 ? 0 : 0.86 * Math.sqrt((i + 0.35) / k);
    const a = i * 2.39996 + turn;
    out.push({ u: rad * Math.cos(a), v: rad * Math.sin(a) });
  }
  return out;
}

function computeIslandLayout({ width, height, critters, anchors = new Map() }) {
  const { landmarks, mainland, sky } = sceneFrame(width, height);
  const groups = groupByTask(critters);
  const base = { compact: false, landmarks, mainland, sky, inner: sky, clusters: [] };
  if (!groups.length) return { ...base, islands: [], spots: new Map(), slots: new Map(), anchors: new Map(), radius: 18, labelWidth: 80 };

  const maxR = clamp(Math.min(width, height) / 21, 12, 30), minR = 7;
  let r = maxR, packed, specs;
  for (;;) {
    specs = groups.map((g) => ({ id: g.taskId, ...islandSize(g.members.length, r) }));
    const area = specs.reduce((a, s) => a + 2 * s.half * (s.top + s.bottom), 0);
    if (area <= sky.w * sky.h * 0.8 || r <= minR) {
      packed = packIslands(specs, sky, anchors);
      if (packed.ok || r <= minR) break;
    }
    r = Math.max(minR, r * 0.9);
  }

  const islands = [], spots = new Map(), slots = new Map(), nextAnchors = new Map();
  groups.forEach((g, gi) => {
    const sp = specs[gi], p = packed.pos.get(g.taskId);
    const isl = {
      taskId: g.taskId, taskName: g.taskName, rocky: isUnassigned(g.taskId, g.taskName),
      cx: p.x, cy: p.y, rx: sp.rx, ry: sp.ry, count: g.members.length,
      box: boxAt(sp, p.x, p.y), seed: hash32(g.taskId),
    };
    islands.push(isl);
    nextAnchors.set(g.taskId, { nx: (p.x - sky.x) / sky.w, ny: (p.y - sky.y) / sky.h });
    const home = homeSpots(g.members.length, isl.seed);
    familyOrder(g.members).forEach((c, i) => {
      spots.set(c.id, { taskId: g.taskId, ...home[i] });
      const pt = islandPoint(isl, home[i].u, home[i].v, r);
      slots.set(c.id, { x: pt.x, y: pt.y - r, r }); // body centre, like the row layout
    });
  });
  return { ...base, islands, spots, slots, anchors: nextAnchors, radius: r, labelWidth: clamp(r * 4.4, 56, 120) };
}
