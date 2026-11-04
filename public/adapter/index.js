// The stateful half of the adapter: remembers the previous graph's snapshot so
// each tick can be turned into { state, events }, and keeps a card that has left
// the board on the pen as 'archived' for a short while so the engine can play
// its walk-off. Everything it decides is delegated to the pure modules.
//
// `tick` is idempotent for a repeated graph (no new events), which matters: the
// board only sends a graph when something changed, so the client also re-ticks
// the last graph on a timer to let time-based states (thinking, archived expiry)
// move on.

import { toPenState } from './state.js';
import { snapshot, diffSnapshots } from './events.js';

export { toPenState, statusFor, THINKING_AFTER_MS, ADHOC_TASK } from './state.js';
export { snapshot, diffSnapshots } from './events.js';

export const ARCHIVE_GRACE_MS = 8_000;

// The board reports 'unknown' when it briefly cannot read a session's status (a
// pane mid-redraw, a status file being rewritten). Hold the critter's previous
// look until it has stayed unknown this long, then let it read as idle, so a
// blip does not make a busy critter flop asleep and wake again.
export const UNKNOWN_GRACE_MS = 10_000;

export function createAdapter({ archiveGraceMs = ARCHIVE_GRACE_MS, unknownGraceMs = UNKNOWN_GRACE_MS } = {}) {
  let prevSnap = null;
  let prevGraph = null;
  let lastCritters = new Map(); // id -> critter, from the previous tick
  const departing = new Map(); // id -> { critter, leftAt }
  const unknownSince = new Map(); // id -> when its status first went 'unknown'

  return {
    tick(graph, now = Date.now()) {
      const state = toPenState(graph, now);
      const unknown = new Set((graph?.sessions || []).filter((s) => s?.status === 'unknown').map((s) => s.sessionId));
      for (const id of unknownSince.keys()) if (!unknown.has(id)) unknownSince.delete(id);
      for (const c of state.critters) {
        if (!unknown.has(c.id)) continue;
        if (!unknownSince.has(c.id)) unknownSince.set(c.id, now);
        const held = lastCritters.get(c.id);
        if (held && now - unknownSince.get(c.id) < unknownGraceMs) c.status = held.status;
      }
      const present = new Set(state.critters.map((c) => c.id));
      for (const [id, c] of lastCritters) {
        if (!present.has(id) && !departing.has(id)) departing.set(id, { critter: { ...c, status: 'archived' }, leftAt: now });
      }
      for (const [id, d] of departing) {
        if (present.has(id) || now - d.leftAt >= archiveGraceMs) departing.delete(id);
        else state.critters.push(d.critter);
      }
      lastCritters = new Map(state.critters.filter((c) => c.status !== 'archived').map((c) => [c.id, c]));

      // Re-diffing the very same graph object would only ever say "nothing".
      let events = [];
      if (graph !== prevGraph) {
        const snap = snapshot(graph);
        events = diffSnapshots(prevSnap, snap);
        prevSnap = snap;
        prevGraph = graph;
      }
      return { state, events };
    },
    reset() {
      prevSnap = null;
      prevGraph = null;
      lastCritters = new Map();
      departing.clear();
    },
  };
}
