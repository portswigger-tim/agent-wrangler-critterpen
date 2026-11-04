// The stateful half of the adapter: remembers the previous graph's snapshot so
// each tick can be turned into { state, events }, and keeps a card that has left
// the board on the pen as 'archived' for a short while so the engine can play
// its walk-off. Everything it decides is delegated to the pure modules.
//
// `tick` is idempotent for a repeated graph (no new events), which matters: the
// board only sends a graph when something changed, so the client also re-ticks
// the last graph on a timer to let time-based states (thinking, archived expiry)
// move on.
//
// It also carries the two pieces of cross-tick knowledge the split of 'idle'
// needs (see statusFor):
//   finished — a session that went working → idle (the same transition that
//              fires 'done') stays 'finished' until the human acknowledges it:
//              clicks its critter, or selects it on the board. Persisted per
//              browser through `storage`, so a reload does not forget it.
//   dozing   — a live idle session quiet for ASLEEP_AFTER_MS reads 'asleep',
//              and wakes only on fresh activity (WAKE_WITHIN_MS), so a
//              lastActivity wobbling around the threshold cannot flicker it.

import { toPenState, boardSessions, isDormant } from './state.js';
import { snapshot, diffSnapshots } from './events.js';

export { toPenState, statusFor, THINKING_AFTER_MS, ADHOC_TASK } from './state.js';
export { snapshot, diffSnapshots } from './events.js';

export const ASLEEP_AFTER_MS = 30 * 60_000;
export const WAKE_WITHIN_MS = 25 * 60_000;

export const ARCHIVE_GRACE_MS = 8_000;

// The board reports 'unknown' when it briefly cannot read a session's status (a
// pane mid-redraw, a status file being rewritten). Hold the critter's previous
// look until it has stayed unknown this long, then let it read as idle, so a
// blip does not make a busy critter flop asleep and wake again.
export const UNKNOWN_GRACE_MS = 10_000;

// `storage` is { load() -> string[] | null, save(ids: string[]) }; both may
// throw or be absent (private mode, blocked storage) and are treated as empty.
export function createAdapter({ archiveGraceMs = ARCHIVE_GRACE_MS, unknownGraceMs = UNKNOWN_GRACE_MS, storage = null } = {}) {
  let prevSnap = null;
  let prevGraph = null;
  let lastCritters = new Map(); // id -> critter, from the previous tick
  const departing = new Map(); // id -> { critter, leftAt }
  const unknownSince = new Map(); // id -> when its status first went 'unknown'
  const finished = new Set(load(storage));
  const dozing = new Set();
  let lastSelected = null;

  const persist = () => { try { storage?.save([...finished]); } catch { /* storage is a convenience */ } };

  // Keep `finished` and `dozing` honest against this graph.
  function track(graph, events, now, selectedId) {
    const before = finished.size;
    const changed = [];
    const sessions = boardSessions(graph);
    const byId = new Map(sessions.map((s) => [s.sessionId, s]));
    for (const ev of events) {
      const s = byId.get(ev.critterId);
      if (ev.kind === 'done' && s && !isDormant(s) && !finished.has(s.sessionId)) { finished.add(s.sessionId); changed.push(s.sessionId); }
    }
    for (const id of [...finished]) {
      const s = byId.get(id);
      // Gone from the board, or no longer idle: the result has been superseded.
      if (!s || s.status === 'working' || s.status === 'needs-you') { finished.delete(id); changed.push(id); }
    }
    // Selecting a card on the board is looking at it — but only the moment the
    // selection moves there, not for as long as it stays put while the human is
    // in the pen.
    if (selectedId && selectedId !== lastSelected && finished.delete(selectedId)) changed.push(selectedId);
    lastSelected = selectedId ?? null;
    if (changed.length || finished.size !== before) persist();

    for (const id of [...dozing]) if (!byId.has(id)) dozing.delete(id);
    for (const s of sessions) {
      const last = typeof s.lastActivity === 'number' ? s.lastActivity : null;
      if (s.status !== 'idle' || isDormant(s)) { dozing.delete(s.sessionId); continue; }
      if (last === null) continue; // no reading this tick: keep what we had
      const age = now - last;
      if (dozing.has(s.sessionId)) { if (age < WAKE_WITHIN_MS) dozing.delete(s.sessionId); }
      else if (age > ASLEEP_AFTER_MS) dozing.add(s.sessionId);
    }
  }

  return {
    // `selectedId` is the board's selected card (api.selectedSessionId()).
    tick(graph, now = Date.now(), { selectedId = null } = {}) {
      // Re-diffing the very same graph object would only ever say "nothing".
      let events = [];
      if (graph !== prevGraph) {
        const snap = snapshot(graph);
        events = diffSnapshots(prevSnap, snap);
        prevSnap = snap;
        prevGraph = graph;
      }
      track(graph, events, now, selectedId);

      const state = toPenState(graph, now, { finished, quiet: dozing });
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
      return { state, events };
    },
    // The human has seen this session's result (clicked its critter).
    acknowledge(id) {
      if (finished.delete(id)) persist();
    },
    // Forget the graph history (so the next tick replays no events) but not what
    // the human has or has not seen yet.
    reset() {
      prevSnap = null;
      prevGraph = null;
      lastCritters = new Map();
      departing.clear();
    },
  };
}

function load(storage) {
  try {
    const ids = storage?.load();
    return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string' && id) : [];
  } catch {
    return [];
  }
}
