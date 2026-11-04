// Pure name-label placement: every critter's label gets a spot that doesn't
// cover another label (or a building caption), most important critters first.

/** Who gets first pick of a clear spot: the critters you most need to read. */
export const LABEL_PRIORITY = ['needs-you', 'finished', 'working', 'thinking', 'error', 'idle', 'asleep', 'archived'];

const LABEL_H = 16;

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
 * Candidate label centres for a critter standing at (x, groundY) with radius r:
 * under its feet, a little lower, nudged sideways, and above its head (clear of
 * `headroom` px of hat or bubble). Queuers at the bell try above first, so they
 * don't sit on the building captions.
 */
function candidates(it, w) {
  const below = [
    { x: it.x, y: it.groundY + 10 },
    { x: it.x, y: it.groundY + 10 + LABEL_H },
    { x: it.x - w * 0.35, y: it.groundY + 10 },
    { x: it.x + w * 0.35, y: it.groundY + 10 },
  ];
  const above = [{ x: it.x, y: it.groundY - it.r * 2.3 - 12 - (it.headroom || 0) }];
  return it.above ? [...above, ...below] : [...below, ...above];
}

/**
 * @param {Array<{ id: string, text: string, x: number, groundY: number, r: number, status?: string, above?: boolean, headroom?: number, parent?: boolean }>} items
 * @param {(text: string, item?: object) => number} measure text width in px (item carries e.g. a font)
 * @param {Array<{l:number,r:number,t:number,b:number}>} [blocked] areas labels must avoid
 * @returns {Array<{ id: string, text: string, x: number, y: number, visible: boolean, box: {l:number,r:number,t:number,b:number} }>}
 *   in placement order; a label with no clear spot keeps its first choice and `visible: false`
 */
export function placeLabels(items, measure, blocked = []) {
  const rank = (s) => { const i = LABEL_PRIORITY.indexOf(s); return i < 0 ? LABEL_PRIORITY.length : i; };
  // Same status: parents first (they're the ones you click), then front-most.
  const order = [...items].sort((a, b) => rank(a.status) - rank(b.status) || (b.parent ? 1 : 0) - (a.parent ? 1 : 0)
    || b.groundY - a.groundY || (a.id < b.id ? -1 : 1));
  const taken = [...blocked];
  const out = [];
  for (const it of order) {
    const w = measure(it.text, it) + 6;
    const boxAt = (p) => ({ l: p.x - w / 2, r: p.x + w / 2, t: p.y - LABEL_H / 2, b: p.y + LABEL_H / 2 });
    const spots = candidates(it, w);
    const free = spots.find((p) => !taken.some((o) => overlaps(boxAt(p), o)));
    const at = free || spots[0];
    const box = boxAt(at);
    if (free) taken.push(box);
    out.push({ id: it.id, text: it.text, x: at.x, y: at.y, visible: !!free, box });
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
