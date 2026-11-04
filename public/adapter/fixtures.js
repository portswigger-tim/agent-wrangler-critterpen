// Test helpers: board graphs shaped like the wrangler's (server/state-reader.js
// session nodes + the tasks snapshot), with only the fields the adapter reads.

export const NOW = 1_800_000_000_000;

export function session(sessionId, over = {}) {
  return {
    id: `session:${sessionId}`,
    type: 'session',
    sessionId,
    label: `Session ${sessionId}`,
    agent: 'claude',
    status: 'idle',
    rawStatus: 'idle',
    waitingFor: null,
    hasBackgroundShell: false,
    parentSession: null,
    spawnedBy: null,
    offBoard: null,
    links: [],
    lastActivity: NOW,
    ...over,
  };
}

export function graph(sessions, { tasks = [], assignments = {} } = {}) {
  return {
    sessions,
    tasks: { tasks: tasks.map((t) => ({ links: [], ...t })), order: tasks.map((t) => t.id), assignments, sessionOrder: {} },
    generatedAt: NOW,
  };
}

export const pr = (number, checkStatus = 'pending') => ({ type: 'pr', url: `https://github.com/o/r/pull/${number}`, repo: 'o/r', number, checkStatus });
export const jira = (key) => ({ type: 'jira', key, url: `https://example.atlassian.net/browse/${key}` });

// The engine's contract validators when the engine is present beside the
// adapter (public/engine/contract.js), else null so contract tests can skip.
export async function loadContract() {
  try {
    return await import('../engine/contract.js');
  } catch {
    return null;
  }
}
