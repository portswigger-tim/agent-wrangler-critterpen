// Board graph → PenState. Pure: no DOM, no clock of its own (`now` is passed in),
// so it runs the same in the browser and under `node --test`.
//
// What the wrangler graph gives us (server/state-reader.js buildGraph, plus the
// `tasks` snapshot index.js adds each tick):
//   graph.sessions[]  — board cards. `status` is 'working' | 'idle' | 'needs-you'
//                       | 'unknown'; dormant cards are 'idle' with `dormant: true`.
//                       `lastActivity` is the transcript's newest line (ms).
//                       `links` holds { type: 'pr', number, checkStatus } and
//                       { type: 'jira', key } entries.
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

// One card's critter status. Precedence: needs-you > working > thinking > error
// > idle. A session busy fixing its own red CI reads as working: that is what it
// is doing, and red comes back the moment it stops.
export function statusFor(session, now = Date.now()) {
  if (session.status === 'needs-you') return 'needs-you';
  if (session.status === 'working') {
    // 'shell' is Claude running a Bash tool: definitely not just thinking.
    if (session.rawStatus === 'shell' || session.hasBackgroundShell) return 'working';
    const last = typeof session.lastActivity === 'number' ? session.lastActivity : null;
    if (last !== null && now - last > THINKING_AFTER_MS) return 'thinking';
    return 'working';
  }
  if (hasFailingPr(session.links)) return 'error';
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

export function critterFor(session, task, now) {
  const c = {
    id: session.sessionId,
    name: typeof session.label === 'string' && session.label ? session.label : session.sessionId.slice(0, 8),
    taskId: task.id,
    taskName: task.name,
    agent: session.agent || 'claude',
    status: statusFor(session, now),
  };
  const parentId = session.parentSession || session.spawnedBy;
  if (parentId) c.parentId = parentId;
  return c;
}

export function toPenState(graph, now = Date.now()) {
  const taskOf = taskIndex(graph);
  return { critters: boardSessions(graph).map((s) => critterFor(s, taskOf(s.sessionId), now)) };
}
