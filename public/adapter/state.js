// Board graph → PenState. Pure: no DOM, no clock of its own (`now` is passed in),
// so it runs the same in the browser and under `node --test`.
//
// What the wrangler graph gives us (server/state-reader.js buildGraph, plus the
// `tasks` snapshot index.js adds each tick):
//   graph.sessions[]  — board cards. `status` is 'working' | 'idle' | 'needs-you'
//                       | 'unknown'; dormant cards are 'idle' with `dormant: true`.
//                       `lastActivity` is the transcript's newest line (ms).
//                       `links` holds { type: 'pr', number, checkStatus } and
//                       { type: 'jira', key } entries. `managed` is false and
//                       `dormant` true when there is no live pane;
//                       `hasBackgroundShell`, `subAgents[].status` and
//                       `teammates[].status` say it is still busy after its turn.
//   graph.tasks       — { tasks: [{ id, name }], assignments: { sessionId: taskId } }.
// Archived cards are simply absent: there is no flag on a live node.

export const ADHOC_TASK = { id: 'adhoc', name: 'Unassigned' };

// A working session that has written nothing to its transcript for this long is
// generating (thinking) rather than running tools.
export const THINKING_AFTER_MS = 20_000;

// PR check states that paint a critter red.
const FAILING_CHECKS = new Set(['failing']);

export function hasFailingPr(links) {
  return (links || []).some((l) => l?.type === 'pr' && FAILING_CHECKS.has(l.checkStatus));
}

// Is a session doing something of its own right now, even if its turn has
// ended? The board shows idle + a background shell as a green JOB
// (displayStatus in agent-wrangler public/util.js); a running sub-agent or a
// working agent-team member is the same kind of "still busy".
export function busyOnItsOwn(session) {
  if (session.hasBackgroundShell) return true;
  if ((session.subAgents || []).some((a) => a?.status === 'running')) return true;
  return (session.teammates || []).some((t) => t?.status === 'working');
}

// No live pane to talk to: a dormant (resumable) card, or one the board marks
// unmanaged. These are the only cards that are asleep whatever else is true.
export function isDormant(session) {
  return Boolean(session.dormant) || session.managed === false;
}

export function isSnoozed(session, now) {
  const until = session.snooze?.until;
  return typeof until === 'number' && until > now;
}

// One card's critter status, from its own fields plus what the stateful adapter
// knows across ticks (`ctx`):
//   finished    Set of ids that finished a turn the human has not looked at yet
//   quiet       Set of ids live but quiet long enough to doze (with hysteresis)
//   busyChildren Set of ids with a child on the pen that is working or thinking
//
// Precedence: needs-you > working > thinking > error > asleep > finished > idle.
// A session busy fixing its own red CI reads as working: that is what it is
// doing, and red comes back the moment it stops. A result you have not seen yet
// never dozes off; only a dormant or snoozed card sleeps through it.
export function statusFor(session, now = Date.now(), ctx = {}) {
  if (session.status === 'needs-you') return 'needs-you';
  if (session.status === 'working') {
    // 'shell' is Claude running a Bash tool: definitely not just thinking.
    if (session.rawStatus === 'shell' || session.hasBackgroundShell) return 'working';
    const last = typeof session.lastActivity === 'number' ? session.lastActivity : null;
    if (last !== null && now - last > THINKING_AFTER_MS) return 'thinking';
    return 'working';
  }
  if (busyOnItsOwn(session)) return 'working';
  // Busy elsewhere: its own turn is over, but a session it spawned or nests is
  // still at it. Calm 'thinking', not asleep.
  if (ctx.busyChildren?.has(session.sessionId)) return 'thinking';
  if (hasFailingPr(session.links)) return 'error';
  if (isDormant(session) || isSnoozed(session, now)) return 'asleep';
  if (ctx.finished?.has(session.sessionId)) return 'finished';
  if (ctx.quiet?.has(session.sessionId)) return 'asleep';
  return 'idle';
}

export function taskIndex(graph) {
  const names = new Map((graph?.tasks?.tasks || []).filter((t) => !t.archivedAt).map((t) => [t.id, t.name]));
  const assignments = graph?.tasks?.assignments || {};
  return (sessionId) => {
    const id = assignments[sessionId];
    return id && names.has(id) ? { id, name: names.get(id) } : ADHOC_TASK;
  };
}

// Sessions that belong on the pen: the same set the board draws. `offBoard`
// cards are hosted by an extension's own view, not the board.
export function boardSessions(graph) {
  return (graph?.sessions || []).filter((s) => s && s.sessionId && !s.offBoard);
}

export const parentOf = (session) => session.parentSession || session.spawnedBy || null;

export function critterFor(session, task, now, ctx) {
  const c = {
    id: session.sessionId,
    name: typeof session.label === 'string' && session.label ? session.label : session.sessionId.slice(0, 8),
    taskId: task.id,
    taskName: task.name,
    agent: session.agent || 'claude',
    status: statusFor(session, now, ctx),
  };
  const parentId = parentOf(session);
  if (parentId) c.parentId = parentId;
  return c;
}

// Parents with at least one child on the pen whose own status (without the
// busy-elsewhere rule, so it is one level deep and order-free) is working or
// thinking.
export function busyParents(sessions, now, ctx = {}) {
  const out = new Set();
  for (const s of sessions) {
    const parent = parentOf(s);
    if (!parent) continue;
    const own = statusFor(s, now, { ...ctx, busyChildren: null });
    if (own === 'working' || own === 'thinking') out.add(parent);
  }
  return out;
}

// `ctx` is the stateful adapter's cross-tick knowledge (see statusFor); without
// it nothing is finished or dozing, which is the honest first-tick answer.
export function toPenState(graph, now = Date.now(), ctx = {}) {
  const taskOf = taskIndex(graph);
  const sessions = boardSessions(graph);
  const full = { ...ctx, busyChildren: busyParents(sessions, now, ctx) };
  const critters = sessions.map((s) => critterFor(s, taskOf(s.sessionId), now, full));
  return { critters: dropOrphanParents(critters, ctx.lingering) };
}

// A parent that is not on the pen (off-board, never adopted, or gone for good)
// has no critter to leash to, and the engine sizes a critter with a parent as a
// child, so an orphan keeps no parentId. `alsoPresent` are ids the caller will
// still emit although they are not board cards: the stateful adapter keeps an
// archived parent walking off for a few seconds, and its children keep their
// leash (and their size) until it has gone.
export function dropOrphanParents(critters, alsoPresent = null) {
  const onPen = new Set(critters.map((c) => c.id));
  for (const c of critters) {
    if (c.parentId && !onPen.has(c.parentId) && !alsoPresent?.has(c.parentId)) delete c.parentId;
  }
  return critters;
}

// What an older engine can draw: a status its contract does not list yet falls
// back to the nearest one it knows, so the adapter can ship ahead of the
// engine. 'asleep' and 'finished' were both 'idle' (drawn asleep) before idle
// was split; once the engine lists them this is a no-op.
const FALLBACK = { asleep: 'idle', finished: 'idle' };
export function forEngine(state, statuses) {
  if (!Array.isArray(statuses) || !statuses.length) return state;
  const known = new Set(statuses);
  if (state.critters.every((c) => known.has(c.status))) return state;
  return { ...state, critters: state.critters.map((c) => (known.has(c.status) || !known.has(FALLBACK[c.status]) ? c : { ...c, status: FALLBACK[c.status] })) };
}
