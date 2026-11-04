// Pure name-label placement: every critter's label gets a spot that doesn't
// cover another label (or a building caption), most important critters first.

/** Who gets first pick of a clear spot: the critters you most need to read. */
export const LABEL_PRIORITY = ['needs-you', 'finished', 'working', 'thinking', 'error', 'idle', 'asleep', 'archived'];

const LABEL_H = 14;
const overlaps = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;

/**
 * Candidate label centres for a critter standing at (x, groundY) with radius r:
 * under its feet, a little lower, nudged sideways, and above its head. Queuers
 * at the bell try above first, so they don't sit on the building captions.
 */
function candidates(it, w) {
  const below = [
    { x: it.x, y: it.groundY + 10 },
    { x: it.x, y: it.groundY + 10 + LABEL_H },
    { x: it.x - w * 0.35, y: it.groundY + 10 },
    { x: it.x + w * 0.35, y: it.groundY + 10 },
  ];
  const above = [{ x: it.x, y: it.groundY - it.r * 2.3 - 12 }];
  return it.above ? [...above, ...below] : [...below, ...above];
}

/**
 * @param {Array<{ id: string, text: string, x: number, groundY: number, r: number, status?: string, above?: boolean }>} items
 * @param {(text: string) => number} measure text width in px
 * @param {Array<{l:number,r:number,t:number,b:number}>} [blocked] areas labels must avoid
 * @returns {Array<{ id: string, text: string, x: number, y: number, visible: boolean, box: {l:number,r:number,t:number,b:number} }>}
 *   in placement order; a label with no clear spot keeps its first choice and `visible: false`
 */
export function placeLabels(items, measure, blocked = []) {
  const rank = (s) => { const i = LABEL_PRIORITY.indexOf(s); return i < 0 ? LABEL_PRIORITY.length : i; };
  const order = [...items].sort((a, b) => rank(a.status) - rank(b.status) || b.groundY - a.groundY || (a.id < b.id ? -1 : 1));
  const taken = [...blocked];
  const out = [];
  for (const it of order) {
    const w = measure(it.text) + 6;
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
