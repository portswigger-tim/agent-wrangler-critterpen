// Pure state diffing: what changed between two PenState snapshots.

/**
 * @typedef {import('./contract.js').Critter} Critter
 * @typedef {{
 *   added: Critter[],
 *   removed: string[],
 *   statusChanged: Array<{ id: string, from: string, to: string }>,
 *   updated: Critter[],
 *   next: Map<string, Critter>,
 * }} CritterDiff
 */

const SAME_FIELDS = ['name', 'taskId', 'taskName', 'parentId', 'agent'];

/**
 * Diff the previous snapshot (by id) against the next list of critters.
 * `updated` lists critters whose non-status fields changed (name, task, parent, agent).
 * Duplicate ids in `next` keep the last occurrence.
 * @param {Map<string, Critter>} prev
 * @param {Critter[]} next
 * @returns {CritterDiff}
 */
export function diffCritters(prev, next) {
  const nextMap = new Map();
  for (const c of next) nextMap.set(c.id, c);
  const added = [],
    updated = [],
    statusChanged = [],
    removed = [];
  for (const c of nextMap.values()) {
    const old = prev.get(c.id);
    if (!old) {
      added.push(c);
      continue;
    }
    if (old.status !== c.status) statusChanged.push({ id: c.id, from: old.status, to: c.status });
    if (SAME_FIELDS.some((k) => old[k] !== c[k])) updated.push(c);
  }
  for (const id of prev.keys()) if (!nextMap.has(id)) removed.push(id);
  return { added, removed, statusChanged, updated, next: nextMap };
}
