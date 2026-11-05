// Successive board graphs → PenEvent[]. Pure: `snapshot(graph)` reduces a graph
// to just what the diff compares, and `diffSnapshots(prev, next)` says what
// happened between two of them. The first tick has no `prev` and yields nothing,
// so opening the pen does not replay every PR and Jira link as if it were new
// (the same rule core's "finished" cue follows on a fresh board load).

import { boardSessions, taskIndex } from './state.js';

function linkSets(links) {
  const prs = new Map(); // url -> { number, checkStatus }
  const jiras = new Set();
  for (const l of links || []) {
    if (l?.type === 'pr' && l.url) prs.set(l.url, { number: l.number, checkStatus: l.checkStatus || null });
    else if (l?.type === 'jira' && (l.key || l.url)) jiras.add(l.key || l.url);
  }
  return { prs, jiras };
}

export function snapshot(graph) {
  const taskOf = taskIndex(graph);
  const sessions = new Map();
  for (const s of boardSessions(graph)) {
    sessions.set(s.sessionId, {
      name: s.label || s.sessionId.slice(0, 8),
      status: s.status,
      waitingFor: s.waitingFor || null,
      parentId: s.parentSession || s.spawnedBy || null,
      taskId: taskOf(s.sessionId).id,
      lastActivity: typeof s.lastActivity === 'number' ? s.lastActivity : 0,
      ...linkSets(s.links),
    });
  }
  const tasks = new Map();
  for (const t of graph?.tasks?.tasks || []) {
    if (!t.archivedAt) tasks.set(t.id, linkSets(t.links));
  }
  return { sessions, tasks };
}

const prLabel = (pr) => (Number.isInteger(pr.number) ? `#${pr.number}` : 'PR');

// Link changes on one owner (a session, or a task) as event kinds + labels,
// before they are pinned to a critter.
function linkChanges(prev, next) {
  const out = [];
  for (const [url, pr] of next.prs) {
    const was = prev.prs.get(url);
    if (!was) out.push({ kind: 'pr', label: prLabel(pr) });
    if (pr.checkStatus === 'failing' && was?.checkStatus !== 'failing')
      out.push({ kind: 'error', label: `${prLabel(pr)} checks failing` });
  }
  for (const key of next.jiras) {
    if (!prev.jiras.has(key)) out.push({ kind: 'jira', label: key });
  }
  return out;
}

// A task-level link has no author on the graph, so it is pinned to the task's
// busiest-looking member: a working one if any, else the most recently active.
function taskSpokesperson(sessions, taskId) {
  let best = null;
  for (const [id, s] of sessions) {
    if (s.taskId !== taskId) continue;
    const rank = [s.status === 'working' ? 1 : 0, s.lastActivity];
    if (!best || rank[0] > best.rank[0] || (rank[0] === best.rank[0] && rank[1] > best.rank[1])) best = { id, rank };
  }
  return best?.id ?? null;
}

export function diffSnapshots(prev, next) {
  if (!prev) return [];
  const events = [];
  for (const [id, s] of next.sessions) {
    const was = prev.sessions.get(id);
    if (!was) {
      // A card that appears with a parent already on the pen was spawned (or
      // forked) by it. A parent that is not on the pen has nobody to fire from.
      if (s.parentId && next.sessions.has(s.parentId))
        events.push({ critterId: s.parentId, kind: 'spawn', label: s.name });
      continue;
    }
    // An 'unknown' blip carries the last known status forward (into `next`, so
    // the following diff compares against it too): working → unknown → idle is
    // still a finish.
    if (s.status === 'unknown') s.status = was.status;
    for (const ch of linkChanges(was, s)) events.push({ critterId: id, ...ch });
    if (s.status === 'needs-you' && was.status !== 'needs-you') {
      events.push(
        s.waitingFor ? { critterId: id, kind: 'human', label: String(s.waitingFor) } : { critterId: id, kind: 'human' },
      );
    }
    // working → idle is core's "finished" transition. A needs-you → idle is the
    // human answering "no", not the agent finishing.
    if (was.status === 'working' && s.status === 'idle') events.push({ critterId: id, kind: 'done' });
  }
  for (const [taskId, links] of next.tasks) {
    const was = prev.tasks.get(taskId);
    if (!was) continue;
    const changes = linkChanges(was, links);
    if (!changes.length) continue;
    const critterId = taskSpokesperson(next.sessions, taskId);
    if (critterId) for (const ch of changes) events.push({ critterId, ...ch });
  }
  return events;
}
