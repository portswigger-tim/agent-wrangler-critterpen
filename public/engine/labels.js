// Pure name-label placement: every critter's label gets a spot that doesn't
// cover another label (or a building caption), most important critters first.

import { truncateMiddle } from './util.js';

/** Who gets first pick of a clear spot: the critters you most need to read. */
export const LABEL_PRIORITY = ['needs-you', 'finished', 'working', 'thinking', 'error', 'idle', 'asleep', 'archived'];

const LABEL_H = 16;
/** Most a label above the head will rise to clear a hat or bubble (px). */
export const MAX_HEADROOM = 22;

const loose = (s) => String(s || '').toLowerCase().replace(/[\s_-]+/g, ' ').trim();

/**
 * Drop a leading copy of the island's task name from a session name: the
 * island's plank already says it, and it pushes the part that tells sessions
 * apart off the end. Compared loosely (case, and spaces/hyphens/underscores
 * as equal). A name that runs the task name into one hyphenated word
 * ("Safer-runner-action …" on "Safer Runner") loses that whole word. Never
 * returns an empty string.
 */
export function stripTaskPrefix(name, taskName) {
  const full = String(name || '');
  const want = loose(taskName);
  if (!want) return full;
  // Walk the name, matching the task name loosely character by character.
  let i = 0, j = 0;
  const sep = /[\s_-]/;
  while (i < full.length && j < want.length) {
    const c = full[i];
    if (sep.test(c)) {
      if (want[j] === ' ') j++;
      else if (j > 0) return full; // a separator the task name doesn't have
      i++;
      while (i < full.length && sep.test(full[i])) i++;
      continue;
    }
    if (c.toLowerCase() !== want[j]) return full;
    i++; j++;
  }
  if (j < want.length) return full;
  // Only at a word boundary: "Docs site: …", "Docs-site-x …", not "Docs siteful".
  if (i < full.length && !/[\s_:\-–—]/.test(full[i])) return full;
  if (i < full.length && /[_-]/.test(full[i])) while (i < full.length && !/[\s:]/.test(full[i])) i++;
  while (i < full.length && /[\s:\-–—_]/.test(full[i])) i++;
  const rest = full.slice(i);
  return rest.trim() ? rest : full;
} // line box for the 12px name font in pen.js (FONT_NAME)
const overlaps = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;

/**
 * The short form of a name for tight spots: its first meaningful whole word
 * ("Investigate…", "L7…"), or nothing if even that won't fit. Never a fragment.
 */
export function shortLabel(text, maxWidth, measure) {
  const words = String(text).trim().split(/\s+/).filter((w) => /\p{L}/u.test(w)); // a word with a letter: "L7" yes, "#2" no
  if (words.length < 2) return '';
  const t = `${words[0]}…`;
  return measure(t) <= maxWidth ? t : '';
}

/** How far (in the critter's radii) a label may move from its default spot. */
export const MAX_SHIFT = 1;

/** Where a label wants to be: under the feet, and just over the head as the second choice. */
export function anchorSpots(it) {
  const below = { x: it.x, y: it.groundY + 10 };
  const above = { x: it.x, y: it.groundY - it.r * 2 - LABEL_H / 2 - 3 - Math.min(it.headroom || 0, MAX_HEADROOM) };
  return it.above ? [above, below] : [below, above];
}

/** A label's default spot: its first anchor. */
export const homeSpot = (it) => anchorSpots(it)[0];

/** How far a label may move from an anchor: about a body radius, and at least one line. */
export const shiftLimits = (it) => ({ dx: it.r * MAX_SHIFT, dy: Math.max(it.r * MAX_SHIFT, LABEL_H + 4) });

/**
 * Candidate label centres: each anchor (under the feet, then over the head),
 * with small nudges sideways and away from the body, nearest first, so you can
 * always tell whose name it is. A name far from its critter is worse than none.
 */
function candidates(it) {
  const { dx, dy } = shiftLimits(it);
  const out = [];
  anchorSpots(it).forEach((a, i) => {
    const away = a.y > it.groundY ? 1 : -1; // never nudge into the body
    const grid = [];
    for (const fy of [0, 0.5, 0.8, 1]) {
      for (const fx of [0, -0.5, 0.5, -1, 1]) {
        if (Math.hypot(fx, fy) <= 1 + 1e-9) grid.push({ x: fx * dx, y: away * fy * dy, d: Math.hypot(fx, fy) });
      }
    }
    grid.sort((p, q) => p.d - q.d);
    for (const o of grid) out.push({ x: a.x + o.x, y: a.y + o.y, anchor: i });
  });
  return out;
}

/**
 * @param {Array<{ id: string, text: string, x: number, groundY: number, r: number, status?: string, above?: boolean, headroom?: number, parent?: boolean, short?: string, body?: {cx:number,cy:number,cr:number} }>} items
 *   `short` is a shorter form of `text` to try before giving up on a clear spot
 * @param {(text: string, item?: object) => number} measure text width in px (item carries e.g. a font)
 * @param {Array<{l:number,r:number,t:number,b:number}>} [blocked] areas labels must avoid
 * @param {{l:number,r:number,t:number,b:number}} [bounds] labels must stay inside (the pen)
 * @returns {Array<{ id: string, text: string, x: number, y: number, home: {x:number,y:number}, visible: boolean, hidden: boolean, box: {l:number,r:number,t:number,b:number} }>}
 *   in placement order; a label with no clear spot nearby stays at `home` with `visible: false`,
 *   and `hidden: true` if even a whisper there would cover something
 */
export function placeLabels(items, measure, blocked = [], bounds = null) {
  const inside = (b) => !bounds || (b.l >= bounds.l && b.r <= bounds.r && b.t >= bounds.t && b.b <= bounds.b);
  const rank = (s) => { const i = LABEL_PRIORITY.indexOf(s); return i < 0 ? LABEL_PRIORITY.length : i; };
  // Needs-you first, then parents (the ones you click), then by status, then front-most.
  const tier = (it) => (it.status === 'needs-you' ? 0 : it.parent ? 1 : 2);
  const order = [...items].sort((a, b) => tier(a) - tier(b) || rank(a.status) - rank(b.status)
    || b.groundY - a.groundY || (a.id < b.id ? -1 : 1));
  // Every critter's body is off limits too, so a name never sits on a neighbour.
  // `body` is where it is drawn this frame (hops included); else it stands on groundY.
  const bodies = items.map((it) => {
    const b = it.body || { cx: it.x, cy: it.groundY - it.r, cr: it.r };
    return { l: b.cx - b.cr, r: b.cx + b.cr, t: b.cy - b.cr, b: b.cy + b.cr };
  });
  const taken = [...blocked, ...bodies];
  const out = [];
  for (const it of order) {
    const spots = candidates(it);
    // Try the full name near its owner, then the short form (if any) near its owner.
    let placed = null;
    for (const text of it.short && it.short !== it.text ? [it.text, it.short] : [it.text]) {
      if (!text) continue;
      const w = measure(text, it) + 6;
      const boxAt = (p) => ({ l: p.x - w / 2, r: p.x + w / 2, t: p.y - LABEL_H / 2, b: p.y + LABEL_H / 2 });
      const free = spots.find((p) => inside(boxAt(p)) && !taken.some((o) => overlaps(boxAt(p), o)));
      if (free) { placed = { text, at: free, box: boxAt(free) }; break; }
    }
    if (placed) {
      taken.push(placed.box);
      out.push({ id: it.id, text: placed.text, x: placed.at.x, y: placed.at.y, home: spots[0], visible: true, hidden: false, box: placed.box });
    } else {
      // Nowhere close is clear: at the default spot, whisper it only if that
      // covers nothing at all; otherwise hide it (hover still shows the name).
      const w = measure(it.text, it) + 6, h = spots[0];
      const box = { l: h.x - w / 2, r: h.x + w / 2, t: h.y - LABEL_H / 2, b: h.y + LABEL_H / 2 };
      const ownBody = bodies[items.indexOf(it)];
      const hidden = !inside(box) || taken.some((o) => o !== ownBody && overlaps(box, o));
      out.push({ id: it.id, text: it.text, x: h.x, y: h.y, home: h, visible: false, hidden, box });
    }
  }
  return out;
}

/** Do any two visible labels overlap? (For tests and debugging.) */
export function visibleOverlaps(placed) {
  const vis = placed.filter((p) => p.visible);
  const hits = [];
  for (let i = 0; i < vis.length; i++) {
    for (let j = i + 1; j < vis.length; j++) if (overlaps(vis[i].box, vis[j].box)) hits.push([vis[i].id, vis[j].id]);
  }
  return hits;
}
