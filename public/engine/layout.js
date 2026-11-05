// Pure layout: where landmarks sit, how tasks are tiled, where each critter lives.

import { hash32, clamp } from './util.js';
import { relaxSpots, islandAxes, PERSONAL_SPACE, DEPTH_WEIGHT } from './wander.js';

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
  git: 'git',
  pr: 'PRs',
  jira: 'Jira',
  terminal: 'shell',
  files: 'files',
  web: 'web',
  human: 'you',
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
    const r = clamp(h * 0.14, 9, 15);
    // Narrow trays stack the landmark strip into two rows.
    const rows = LANDMARK_SPOTS.length * (r * 2 + 8) > w * 0.4 && h >= 4 * r + 20 ? 2 : 1;
    const perRow = Math.ceil(LANDMARK_SPOTS.length / rows);
    const gap = r * 2 + 8;
    const stripW = perRow * gap + 8;
    const x0 = w - stripW + gap / 2;
    const landmarks = LANDMARK_SPOTS.map((s, i) => ({
      kind: s.kind,
      side: 'right',
      r,
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
  const out = [],
    seen = new Set();
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
    const cw = W / cols,
      ch = H / rows;
    const fits = counts.map((k) => fitCluster(k, cw, ch, maxR));
    const r = Math.min(...fits.map((f) => f.r));
    // The radius is capped, so many grids tie. Among those, prefer cells whose
    // shape matches the clusters' natural shape: that fills the pen in both
    // directions instead of leaving a band of empty space.
    const miss =
      fits.reduce((sum, f) => {
        const sp = spacingFor(f.r);
        const aspect = (f.cols * sp.col) / (f.rows * sp.row + TASK_LABEL_H + f.r * 1.6);
        return sum + Math.abs(Math.log(cw / ch / aspect));
      }, 0) / n;
    if (r > best.r + 0.01 || (Math.abs(r - best.r) <= 0.01 && miss < best.miss)) best = { cols, rows, r, miss };
  }
  return { cols: best.cols, rows: best.rows, r: best.r };
}

/**
 * Full layout for a set of (non-departing) critters: task islands and service
 * islets floating in the sky, or a single row when the pen is a short tray.
 * Pass `footprint(kind, scale)` to size service islets for the carrier drawn.
 * Pass the previous result's `anchors` back in to keep islands where they were.
 * @param {{ width: number, height: number, critters: Array<{id:string,taskId:string,taskName:string,parentId?:string}>, anchors?: Map<string,{nx:number,ny:number}>, footprint?: Function }} input
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
    : chooseGrid(
        groups.map((g) => g.members.length),
        inner.w,
        inner.h,
        maxR,
      );

  // Weight compact columns by member count so big tasks get room.
  const total = critters.length;
  let radius = Infinity,
    labelWidth = Infinity;
  let cxCursor = inner.x;
  groups.forEach((g, gi) => {
    const col = gi % grid.cols,
      row = Math.floor(gi / grid.cols);
    const rowsUsed = Math.ceil(groups.length / grid.cols);
    const inLastRow = row === rowsUsed - 1;
    const lastCount = groups.length - (rowsUsed - 1) * grid.cols;
    let cw, cx0, cy0, ch;
    if (compact) {
      cw = inner.w * (g.members.length / total);
      cx0 = cxCursor;
      cxCursor += cw;
      ch = inner.h;
      cy0 = inner.y;
    } else {
      cw = inner.w / grid.cols;
      ch = inner.h / grid.rows;
      // Centre a short last row.
      const offset = inLastRow ? ((grid.cols - lastCount) * cw) / 2 : 0;
      cx0 = inner.x + col * cw + offset;
      cy0 = inner.y + row * ch;
    }
    const fit = compact ? fitCompact(g.members.length, cw, ch) : fitCluster(g.members.length, cw, ch, maxR);
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
      const jx = ((h & 0xff) / 255 - 0.5) * fit.r * JITTER_X;
      const jy = (((h >>> 8) & 0xff) / 255 - 0.5) * fit.r * 0.35;
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
      taskId: g.taskId,
      taskName: g.taskName,
      cell: { x: cx0, y: cy0, w: cw, h: ch },
      block: { x: left, y: top, w: blockW, h: blockH },
      cx: left + blockW / 2,
      cy: top + blockH / 2,
      labelY: compact ? cy0 + ch : top - fit.r * 1.45,
      count: g.members.length,
    });
  });
  return { landmarks, inner, compact, clusters, slots, labelWidth, radius };
}

/** Single-row fit used by the compact tray. */
function fitCompact(k, cw, ch) {
  const r = clamp(Math.min((ch - TASK_LABEL_H - NAME_LABEL_H) / 2.7, cw / k / 3.1), 6, 16);
  return { r, cols: k, rows: 1 };
}

// ── islands ──────────────────────────────────────────────────────────────────

/**
 * Where each service islet would like to float, as a fraction of the sky: a
 * fixed mental map (git top-left, PRs top, Jira top-right, shell right, files
 * bottom-right, the bell front and centre, web bottom-left). Islets lean
 * toward these spots but may shift to make room for task islands.
 */
export const SERVICE_SPOTS = Object.freeze({
  git: { fx: 0.06, fy: 0.06 },
  pr: { fx: 0.5, fy: 0.03 },
  jira: { fx: 0.94, fy: 0.06 },
  terminal: { fx: 0.97, fy: 0.5 },
  files: { fx: 0.92, fy: 0.96 },
  human: { fx: 0.5, fy: 0.99 },
  web: { fx: 0.08, fy: 0.96 },
});

/**
 * A carrier-free footprint for a service spot when the host supplies none
 * (the engine passes buildings.js's isletFootprint). Measured from the spot's
 * top-surface centre: `rx`/`ry` the surface, `top` how far its building rises,
 * `bottom` how far its underside and caption hang.
 */
export function defaultFootprint(kind, scale = 1) {
  const rx = (kind === 'human' ? 140 : 54) * scale,
    ry = (kind === 'human' ? 32 : 17) * scale;
  return { rx, ry, top: 112 * scale, bottom: ry * 1.3 + 62 * scale };
}

/** How big service islets are drawn for critters of radius r. */
export const isletScale = (r) => clamp(r / 20, 0.55, 1);

/**
 * The fixed parts of the scene: the sky (the whole pen) and each service's
 * preferred spot, before packing. Each landmark has `baseY` (where the building
 * stands) and `x`/`y` (its middle, which projectiles aim at).
 */
export function sceneFrame(w, h, footprint = defaultFootprint, scale = 1) {
  const sky = { x: 8, y: 6, w: Math.max(40, w - 16), h: Math.max(60, h - 12) };
  const landmarks = Object.entries(SERVICE_SPOTS).map(([kind, { fx, fy }]) => {
    const fp = footprint(kind, scale);
    const x = clamp(sky.x + fx * sky.w, sky.x + fp.rx, sky.x + sky.w - fp.rx);
    const y = clamp(sky.y + fy * sky.h, sky.y + fp.top, sky.y + sky.h - fp.bottom);
    return serviceLandmark(kind, x, y, scale, fp, sky);
  });
  return { landmarks, sky };
}

/** A landmark record for the service at islet spot (x, y). */
function serviceLandmark(kind, x, y, scale, fp, sky) {
  const baseY = y + fp.ry * 0.15;
  return {
    kind,
    x,
    baseY,
    y: baseY - fp.top * 0.45,
    r: 20 * scale,
    side: y < sky.y + sky.h / 2 ? 'top' : 'bottom',
    islet: { x, y, scale, fp },
  };
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
  const rx = r * (2.3 + 2.1 * Math.sqrt(Math.max(1, k)));
  return islandBox(rx, Math.max(rx * 0.46, r * 1.8), r);
}

/** An island's packing box from its top ellipse. */
const islandBox = (rx, ry, r) => ({ rx, ry, half: rx + r * 0.6, top: ry + r * 3, bottom: ry * 2.2 + r + 14 });

const ISLAND_GAP = 14;

/** The free spot (on a grid over the sky) where a box of size `s` has the most clearance from `taken`. */
function roomiestSpot(s, sky, taken) {
  const NX = 28,
    NY = 18;
  let best = null,
    bestC = -Infinity;
  for (let j = 0; j <= NY; j++) {
    for (let i = 0; i <= NX; i++) {
      const x = clamp(sky.x + (sky.w * i) / NX, sky.x + s.half, sky.x + sky.w - s.half);
      const y = clamp(sky.y + (sky.h * j) / NY, sky.y + s.top, sky.y + sky.h - s.bottom);
      const b = boxAt(s, x, y);
      let c = Math.min(b.l - sky.x, sky.x + sky.w - b.r, b.t - sky.y, sky.y + sky.h - b.b) * 0.6 + ISLAND_GAP;
      for (const o of taken) c = Math.min(c, separation(b, o));
      if (c > bestC + 1e-6) {
        bestC = c;
        best = { x, y };
      }
    }
  }
  return { p: best, clearance: bestC };
}
const boxAt = (s, x, y) => ({ l: x - s.half, r: x + s.half, t: y - s.top, b: y + s.bottom });
/** Signed separation of two boxes: > 0 apart by that much, < 0 overlapping. */
const separation = (a, b) => Math.max(a.l - b.r, b.l - a.r, a.t - b.b, b.t - a.b);

/**
 * Place island boxes in the sky without overlaps. Islands with an anchor
 * (their previous spot, normalised to the sky) start there and resist moving
 * (`m`, default 0.35; `m: 0` pins one exactly); new islands go to the spot
 * with the most clearance; then a relaxation pass pushes apart any that
 * overlap. Deterministic for the same inputs.
 * @param {Array<{id:string, half:number, top:number, bottom:number, anchor?:{nx:number,ny:number}, m?:number}>} specs
 * @param {{x:number,y:number,w:number,h:number}} sky
 * @param {Map<string,{nx:number,ny:number}>} [anchors]
 * @returns {{ pos: Map<string,{x:number,y:number}>, ok: boolean }}
 */
export function packIslands(specs, sky, anchors = new Map()) {
  const pos = new Map();
  const fit = (s, p) => {
    const xl = sky.x + s.half,
      xh = sky.x + sky.w - s.half;
    const yl = sky.y + s.top,
      yh = sky.y + sky.h - s.bottom;
    p.x = xl > xh ? sky.x + sky.w / 2 : clamp(p.x, xl, xh);
    p.y = yl > yh ? sky.y + sky.h / 2 : clamp(p.y, yl, yh);
    return p;
  };
  // Anchored specs first: a spec's own `anchor` (service islets' fixed spots)
  // or its previous spot; `m` is how readily it moves when pushed.
  for (const s of specs) {
    const a = s.anchor || anchors.get(s.id);
    if (!a) continue;
    const raw = { x: sky.x + a.nx * sky.w, y: sky.y + a.ny * sky.h };
    const p = s.m === 0 ? raw : fit(s, raw); // pinned: exactly where it was
    pos.set(s.id, { ...p, ax: p.x, ay: p.y, m: s.m ?? 0.35 });
  }
  // New islands, biggest first, into the roomiest free spot.
  const fresh = specs
    .filter((s) => !pos.has(s.id))
    .sort((a, b) => b.half * (b.top + b.bottom) - a.half * (a.top + a.bottom));
  const NX = 16,
    NY = 10;
  for (const s of fresh) {
    let best = null,
      bestC = -Infinity;
    for (let j = 0; j <= NY; j++) {
      for (let i = 0; i <= NX; i++) {
        const p = fit(s, { x: sky.x + (sky.w * i) / NX, y: sky.y + (sky.h * j) / NY });
        const b = boxAt(s, p.x, p.y);
        let c = Math.min(b.l - sky.x, sky.x + sky.w - b.r, b.t - sky.y, sky.y + sky.h - b.b) * 0.6;
        for (const [id, q] of pos)
          c = Math.min(
            c,
            separation(
              b,
              boxAt(
                specs.find((x) => x.id === id),
                q.x,
                q.y,
              ),
            ),
          );
        if (c > bestC + 1e-6) {
          bestC = c;
          best = p;
        }
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
        const A = list[i],
          B = list[j];
        const a = boxAt(A.s, A.p.x, A.p.y),
          b = boxAt(B.s, B.p.x, B.p.y);
        const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l) + ISLAND_GAP;
        const oy = Math.min(a.b, b.b) - Math.max(a.t, b.t) + ISLAND_GAP;
        if (ox <= 0 || oy <= 0) continue;
        clashes++;
        if (A.p.m + B.p.m === 0) continue; // two pinned islands: nothing may move
        const share = A.p.m / (A.p.m + B.p.m);
        if (ox / Math.max(1, sky.w) < oy / Math.max(1, sky.h)) {
          const dir = A.p.x < B.p.x || (A.p.x === B.p.x && i < j) ? -1 : 1;
          A.p.x += dir * ox * share;
          B.p.x -= dir * ox * (1 - share);
        } else {
          const dir = A.p.y < B.p.y || (A.p.y === B.p.y && i < j) ? -1 : 1;
          A.p.y += dir * oy * share;
          B.p.y -= dir * oy * (1 - share);
        }
      }
    }
    for (const { s, p } of list) {
      if (p.m === 0) continue; // pinned: exactly where it is
      // A gentle pull home keeps settled islands from drifting.
      if (it < 80) {
        p.x += (p.ax - p.x) * 0.04;
        p.y += (p.ay - p.y) * 0.04;
      }
      fit(s, p);
    }
    if (!clashes && it >= 80) {
      ok = true;
      break;
    }
    if (!clashes && it < 80) ok = true;
  }
  // Final verdict on the settled positions.
  ok = list.every((A, i) =>
    list.every((B, j) => j <= i || separation(boxAt(A.s, A.p.x, A.p.y), boxAt(B.s, B.p.x, B.p.y)) >= ISLAND_GAP - 0.5),
  );
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

// ── size by role ─────────────────────────────────────────────────────────────

/** Size multipliers: parents are big and easy to click, children small. */
export const ROLE_SCALE = Object.freeze({ parent: 1.35, child: 0.8, solo: 1 });

/**
 * Each critter's role from parentId links among the critters present: a
 * parent has at least one child here (even if it is itself someone's child),
 * a child has its parent here, everyone else is solo.
 * @returns {Map<string, { role: 'parent'|'child'|'solo', scale: number, kids: number }>}
 */
export function roleScales(critters) {
  const ids = new Set(critters.map((c) => c.id));
  const kids = new Map();
  for (const c of critters) {
    if (c.parentId && c.parentId !== c.id && ids.has(c.parentId)) kids.set(c.parentId, (kids.get(c.parentId) || 0) + 1);
  }
  const out = new Map();
  for (const c of critters) {
    const role = kids.has(c.id)
      ? 'parent'
      : c.parentId && c.parentId !== c.id && ids.has(c.parentId)
        ? 'child'
        : 'solo';
    out.set(c.id, { role, scale: ROLE_SCALE[role], kids: kids.get(c.id) || 0 });
  }
  return out;
}

/**
 * Which critter (if any) is under (x, y): the nearest whose body, with a little
 * slack, contains the point. Bigger critters have bigger targets.
 * @param {Iterable<{id:string, cx:number, cy:number, cr:number}>} list
 */
export function pickAt(list, x, y) {
  let best = null,
    bestD = Infinity;
  for (const s of list) {
    const d = Math.hypot(x - s.cx, y - s.cy);
    if (d < s.cr * 1.25 && d < bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

/**
 * Hand out home spots (centre-first spiral) so parents sit nearest the middle
 * and each parent's children take the free spots closest to it.
 */
function assignSpots(members, spots, roles) {
  const free = spots.map((p, i) => ({ ...p, i }));
  const take = (near) => {
    let bi = 0,
      bd = Infinity;
    free.forEach((p, i) => {
      const d = Math.hypot(p.u - near.u, p.v - near.v);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    });
    return free.splice(bi, 1)[0];
  };
  const at = new Map();
  const parents = members
    .filter((c) => roles.get(c.id).role === 'parent')
    .sort((a, b) => roles.get(b.id).kids - roles.get(a.id).kids);
  for (const p of parents) at.set(p.id, take({ u: 0, v: 0 }));
  for (const p of parents) {
    for (const c of members) if (c.parentId === p.id && !at.has(c.id)) at.set(c.id, take(at.get(p.id)));
  }
  for (const c of members) if (!at.has(c.id)) at.set(c.id, take({ u: 0, v: 0 }));
  return at;
}

function computeIslandLayout({ width, height, critters, prev = null, anchors = null, footprint = defaultFootprint }) {
  const { sky } = sceneFrame(width, height, footprint);
  const groups = groupByTask(critters);
  const roles = roleScales(critters);
  // Islands are sized by the room their crowd takes: a parent counts for more.
  const weight = (g) => g.members.reduce((a, c) => a + roles.get(c.id).scale ** 2, 0);
  const base = { compact: false, sky, inner: sky, clusters: [], width, height };
  // Service islets: fixed preferred spots, slow to move, sized to the critters.
  const isletSpecs = (r) =>
    Object.entries(SERVICE_SPOTS).map(([kind, { fx, fy }]) => {
      const fp = footprint(kind, isletScale(r));
      return {
        id: `svc:${kind}`,
        kind,
        fp,
        half: fp.rx + 6,
        top: fp.top,
        bottom: fp.bottom,
        anchor: { nx: fx, ny: fy },
        m: 0.12,
      };
    });
  const norm = (p) => ({ nx: (p.x - sky.x) / sky.w, ny: (p.y - sky.y) / sky.h });

  // Events must never change the view: unless the pen was resized (or this is
  // the first layout), everything already placed is pinned exactly where it is.
  // (An empty pen has nothing to keep still, so the first critters lay out afresh.)
  const pinned =
    prev &&
    !prev.compact &&
    prev.width === width &&
    prev.height === height &&
    prev.pins &&
    (prev.islands?.length || prev.ghosts?.length);
  let r,
    specs,
    pos,
    ghosts = [];
  if (pinned) {
    r = prev.radius;
    const others = []; // pinned boxes an island must not grow into
    const isl = isletSpecs(r).map((x) => ({ ...x, m: 0 }));
    const here = new Set(groups.map((g) => g.taskId));
    // A removed task's island fades where it is; its space stays reserved until a resize.
    ghosts = [...(prev.ghosts || []), ...(prev.islands || []).filter((i) => !here.has(i.taskId))].filter(
      (gh) => !here.has(gh.taskId),
    );
    for (const gh of ghosts) others.push(gh.box);
    for (const x of isl) {
      const p = prev.pins.get(x.id);
      others.push(boxAt(x, p.x, p.y));
    }
    const known = groups.filter((g) => prev.pins.has(g.taskId));
    for (const g of known) {
      const p = prev.pins.get(g.taskId);
      others.push({ id: g.taskId, ...boxAt(prev.specs.get(g.taskId), p.x, p.y) });
    }
    const islandSpecs = groups.map((g) => {
      const want = islandSize(weight(g), r);
      const p = prev.pins.get(g.taskId);
      if (!p) return { id: g.taskId, ...want }; // a new task: free space, nothing moves for it
      // Grow (or shrink) in place: the centre stays; growth stops at the neighbours.
      const clear = (k) => {
        const b = boxAt(islandBox(want.rx * k, want.ry * k, r), p.x, p.y);
        return others.every((o) => o.id === g.taskId || separation(b, o) >= ISLAND_GAP - 0.5);
      };
      let k = 1;
      if (!clear(1)) {
        let lo = 0.3,
          hi = 1;
        for (let i = 0; i < 20; i++) {
          const mid = (lo + hi) / 2;
          if (clear(mid)) lo = mid;
          else hi = mid;
        }
        k = Math.max(lo, Math.min(1, (prev.specs.get(g.taskId)?.rx || want.rx) / want.rx)); // never smaller than it was
      }
      return { id: g.taskId, ...islandBox(want.rx * k, want.ry * k, r), m: 0 };
    });
    specs = [...isl, ...islandSpecs];
    // Everything placed stays exactly where it was (no round trip through the sky).
    pos = new Map();
    for (const x of specs) if (prev.pins.has(x.id)) pos.set(x.id, prev.pins.get(x.id));
    const taken = [
      ...ghosts.map((gh) => gh.box),
      ...specs.filter((x) => pos.has(x.id)).map((x) => boxAt(x, pos.get(x.id).x, pos.get(x.id).y)),
    ];
    // A new task's island goes into the roomiest free spot, shrinking if it must; nothing moves for it.
    const fresh = specs
      .filter((x) => !pos.has(x.id))
      .sort((a, b) => b.half * (b.top + b.bottom) - a.half * (a.top + a.bottom));
    for (const x of fresh) {
      let placed = null;
      for (let k = 1; k >= 0.3 && !placed; k *= 0.9) {
        const sz = islandBox(x.rx * k, x.ry * k, r);
        const spot = roomiestSpot(sz, sky, taken);
        if (spot.clearance >= ISLAND_GAP || k * 0.9 < 0.3) placed = { sz, p: spot.p };
      }
      Object.assign(x, placed.sz);
      pos.set(x.id, placed.p);
      taken.push(boxAt(x, placed.p.x, placed.p.y));
    }
  } else {
    const maxR = clamp(Math.min(width, height) / 21, 12, 30),
      minR = 7;
    const was = anchors || prev?.anchors || new Map();
    r = maxR;
    for (;;) {
      specs = [...isletSpecs(r), ...groups.map((g) => ({ id: g.taskId, ...islandSize(weight(g), r) }))];
      const area = specs.reduce((a, x) => a + 2 * x.half * (x.top + x.bottom), 0);
      if (area <= sky.w * sky.h * 0.8 || r <= minR) {
        const packed = packIslands(specs, sky, was);
        pos = packed.pos;
        if (packed.ok || r <= minR) break;
      }
      r = Math.max(minR, r * 0.95);
    }
  }

  const specOf = new Map(specs.map((x) => [x.id, x]));
  const islets = specs
    .filter((x) => x.kind)
    .map((x) => {
      const p = pos.get(x.id);
      return { kind: x.kind, x: p.x, y: p.y, scale: isletScale(r), fp: x.fp, box: boxAt(x, p.x, p.y) };
    });
  const islands = [],
    spots = new Map(),
    slots = new Map(),
    nextAnchors = new Map(),
    pins = new Map();
  for (const i of islets) pins.set(`svc:${i.kind}`, { x: i.x, y: i.y });
  for (const g of groups) {
    const sp = specOf.get(g.taskId),
      p = pos.get(g.taskId);
    const isl = {
      taskId: g.taskId,
      taskName: g.taskName,
      rocky: isUnassigned(g.taskId, g.taskName),
      cx: p.x,
      cy: p.y,
      rx: sp.rx,
      ry: sp.ry,
      count: g.members.length,
      box: boxAt(sp, p.x, p.y),
      seed: hash32(g.taskId),
    };
    islands.push(isl);
    pins.set(g.taskId, { x: p.x, y: p.y });
    nextAnchors.set(g.taskId, norm(p));
    // Parents in the middle, their children around them; then spread the
    // resting spots so bodies never touch, even with no wandering to push them
    // apart (reduced motion, or the very first frame).
    const ordered = familyOrder(g.members);
    const at = assignSpots(ordered, homeSpots(ordered.length, isl.seed), roles);
    const { ax, ay } = islandAxes(isl, r);
    const relaxed = relaxSpots(
      ordered.map((c) => {
        const { role, scale } = roles.get(c.id);
        return { ...at.get(c.id), rad: r * scale, m: role === 'parent' ? 0.05 : 1 }; // parents hold the middle
      }),
      ax,
      ay * DEPTH_WEIGHT,
      r * PERSONAL_SPACE,
    );
    ordered.forEach((c, i) => {
      const { role, scale } = roles.get(c.id);
      spots.set(c.id, { taskId: g.taskId, u: relaxed[i].u, v: relaxed[i].v });
      const cr = r * scale;
      const pt = islandPoint(isl, relaxed[i].u, relaxed[i].v, cr);
      slots.set(c.id, { x: pt.x, y: pt.y - cr, r, scale, role }); // body centre, like the row layout
    });
  }
  return {
    ...base,
    islets,
    landmarks: islets.map((i) => serviceLandmark(i.kind, i.x, i.y, i.scale, i.fp, sky)),
    islands,
    ghosts,
    spots,
    slots,
    anchors: nextAnchors,
    pins,
    specs: new Map(islands.map((i) => [i.taskId, specOf.get(i.taskId)])),
    radius: r,
    labelWidth: clamp(r * 6, 110, 150),
  };
}
