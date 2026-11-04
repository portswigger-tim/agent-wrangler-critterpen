import { test } from 'node:test';
import assert from 'node:assert/strict';

import { toPenState, statusFor, THINKING_AFTER_MS } from './state.js';
import { NOW, session, graph, pr, loadContract } from './fixtures.js';

test('statusFor: needs-you wins over everything', () => {
  assert.equal(statusFor(session('a', { status: 'needs-you', links: [pr(1, 'failing')] }), NOW), 'needs-you');
});

test('statusFor: working with recent transcript activity is working', () => {
  assert.equal(statusFor(session('a', { status: 'working', lastActivity: NOW - 1000 }), NOW), 'working');
});

test('statusFor: working but quiet for a while is thinking', () => {
  assert.equal(statusFor(session('a', { status: 'working', lastActivity: NOW - THINKING_AFTER_MS - 1 }), NOW), 'thinking');
});

test('statusFor: a running Bash tool is never thinking, however quiet the transcript', () => {
  const quiet = NOW - 10 * THINKING_AFTER_MS;
  assert.equal(statusFor(session('a', { status: 'working', rawStatus: 'shell', lastActivity: quiet }), NOW), 'working');
  assert.equal(statusFor(session('b', { status: 'working', hasBackgroundShell: true, lastActivity: quiet }), NOW), 'working');
});

test('statusFor: idle with a background job still running is working (the board\'s green JOB)', () => {
  // Shape copied from a live board card ("L7 mitmproxy egress spike"): the turn
  // ended, a background shell it started is still running.
  const job = session('69fff775', {
    status: 'idle', rawStatus: null, hasBackgroundShell: true, managed: true, dormant: false,
    waitingFor: null, spawnedBy: '0069b540', subAgents: [], teammates: [], lastActivity: NOW - 60_000,
  });
  assert.equal(statusFor(job, NOW), 'working');
  assert.equal(statusFor({ ...job, links: [pr(1, 'failing')] }, NOW), 'working');
  assert.equal(statusFor({ ...job, hasBackgroundShell: false }, NOW), 'idle');
});

test('statusFor: working with no lastActivity at all is working', () => {
  assert.equal(statusFor(session('a', { status: 'working', lastActivity: null }), NOW), 'working');
});

test('statusFor: idle with a failing PR is error; working on it is still working', () => {
  assert.equal(statusFor(session('a', { links: [pr(1, 'failing')] }), NOW), 'error');
  assert.equal(statusFor(session('a', { status: 'working', links: [pr(1, 'failing')] }), NOW), 'working');
});

test('statusFor: other PR states and plain idle are idle', () => {
  for (const s of ['passing', 'pending', 'none', 'awaiting-review', 'changes-requested', undefined]) {
    assert.equal(statusFor(session('a', { links: [pr(1, s)] }), NOW), 'idle', String(s));
  }
  assert.equal(statusFor(session('a', { status: 'unknown' }), NOW), 'idle');
});

test('toPenState: maps task membership, falling back to Unassigned', () => {
  const g = graph([session('a'), session('b'), session('c')], {
    tasks: [{ id: 't1', name: 'Critters' }, { id: 't2', name: 'Old', archivedAt: 1 }],
    assignments: { a: 't1', c: 't2' },
  });
  const byId = Object.fromEntries(toPenState(g, NOW).critters.map((c) => [c.id, c]));
  assert.deepEqual([byId.a.taskId, byId.a.taskName], ['t1', 'Critters']);
  assert.deepEqual([byId.b.taskId, byId.b.taskName], ['adhoc', 'Unassigned']);
  assert.deepEqual([byId.c.taskId, byId.c.taskName], ['adhoc', 'Unassigned']);
});

test('toPenState: parentId prefers board nesting, then spawn lineage, else absent', () => {
  const g = graph([
    session('p'),
    session('nested', { parentSession: 'p', spawnedBy: 'x' }),
    session('spawned', { spawnedBy: 'p' }),
  ]);
  const byId = Object.fromEntries(toPenState(g, NOW).critters.map((c) => [c.id, c]));
  assert.equal(byId.nested.parentId, 'p');
  assert.equal(byId.spawned.parentId, 'p');
  assert.equal('parentId' in byId.p, false);
});

test('toPenState: skips off-board cards and keeps name/agent', () => {
  const g = graph([session('a', { label: 'Fix login', agent: 'codex' }), session('hidden', { offBoard: { ext: 'x' } })]);
  assert.deepEqual(toPenState(g, NOW).critters, [
    { id: 'a', name: 'Fix login', taskId: 'adhoc', taskName: 'Unassigned', agent: 'codex', status: 'idle' },
  ]);
});

test('toPenState: an empty or partial graph is an empty pen', () => {
  assert.deepEqual(toPenState(null, NOW), { critters: [] });
  assert.deepEqual(toPenState({}, NOW), { critters: [] });
});

test('toPenState output satisfies the engine contract', async (t) => {
  const contract = await loadContract();
  if (!contract) return t.skip('public/engine/contract.js not present');
  const g = graph([
    session('a', { status: 'working' }),
    session('b', { status: 'needs-you', parentSession: 'a' }),
    session('c', { links: [pr(3, 'failing')] }),
    session('d', { status: 'working', lastActivity: 0 }),
    session('e', { label: '' }),
  ], { tasks: [{ id: 't1', name: 'T' }], assignments: { a: 't1' } });
  assert.deepEqual(contract.validatePenState(toPenState(g, NOW)), []);
});

// ── the split of 'idle' ──────────────────────────────────────────────────────

test('statusFor: no live pane (dormant or unmanaged) or snoozed is asleep', () => {
  assert.equal(statusFor(session('a', { dormant: true, managed: false }), NOW), 'asleep');
  assert.equal(statusFor(session('a', { managed: false }), NOW), 'asleep');
  assert.equal(statusFor(session('a', { snooze: { until: NOW + 60_000 } }), NOW), 'asleep');
  assert.equal(statusFor(session('a', { snooze: { until: NOW - 1 } }), NOW), 'idle');
});

test('statusFor: idle with a running sub-agent or a working teammate is working', () => {
  assert.equal(statusFor(session('a', { subAgents: [{ status: 'completed' }, { status: 'running' }] }), NOW), 'working');
  assert.equal(statusFor(session('a', { subAgents: [{ status: 'completed' }] }), NOW), 'idle');
  assert.equal(statusFor(session('a', { teammates: [{ status: 'idle' }, { status: 'working' }] }), NOW), 'working');
});

test('statusFor: finished until acknowledged; dormant or snoozed still sleeps; dozing never hides a result', () => {
  const finished = new Set(['a']);
  assert.equal(statusFor(session('a'), NOW, { finished }), 'finished');
  assert.equal(statusFor(session('a'), NOW, { finished, quiet: new Set(['a']) }), 'finished');
  assert.equal(statusFor(session('a', { dormant: true, managed: false }), NOW, { finished }), 'asleep');
  assert.equal(statusFor(session('a'), NOW, { quiet: new Set(['a']) }), 'asleep');
});

test('statusFor: a failing PR still shows red on a sleeping or finished card', () => {
  const failing = { links: [pr(1, 'failing')] };
  assert.equal(statusFor(session('a', { ...failing, dormant: true, managed: false }), NOW), 'error');
  assert.equal(statusFor(session('a', failing), NOW, { finished: new Set(['a']) }), 'error');
});

test('toPenState: a parent whose child is working or thinking is busy elsewhere (thinking)', () => {
  const kid = (status, over = {}) => session('kid', { status, spawnedBy: 'p', ...over });
  const parentStatus = (...kids) => toPenState(graph([session('p'), ...kids]), NOW).critters.find((c) => c.id === 'p').status;
  assert.equal(parentStatus(kid('working')), 'thinking');
  assert.equal(parentStatus(kid('working', { lastActivity: NOW - 10 * THINKING_AFTER_MS })), 'thinking');
  assert.equal(parentStatus(kid('idle', { hasBackgroundShell: true })), 'thinking');
  assert.equal(parentStatus(kid('idle')), 'idle');
  assert.equal(parentStatus(kid('needs-you')), 'idle');
  assert.equal(parentStatus(session('kid', { status: 'working', parentSession: 'p' })), 'thinking');
});

test('toPenState: busy elsewhere is one level deep (a grandchild working does not wake the grandparent)', () => {
  const g = graph([session('gp'), session('p', { spawnedBy: 'gp' }), session('kid', { status: 'working', spawnedBy: 'p' })]);
  const byId = Object.fromEntries(toPenState(g, NOW).critters.map((c) => [c.id, c.status]));
  assert.deepEqual(byId, { gp: 'idle', p: 'thinking', kid: 'working' });
});

test('toPenState on the live board\'s real shapes', async () => {
  const live = await import('./live-board.fixture.js');
  const byId = Object.fromEntries(toPenState(graph(live.all), NOW).critters.map((c) => [c.id, c.status]));
  assert.deepEqual(byId, {
    '0069b540': 'thinking', // orchestrator: its child's background job is running
    '69fff775': 'working', // the green JOB
    '6159bca6': 'idle', // live at its prompt (dozing is the stateful adapter's call)
    db362dd0: 'idle',
    '3ccee247': 'asleep', // dormant: Resume on the board
    c8e23b4d: 'asleep',
  });
});

test('every new status satisfies the engine contract (todo until it lists them)', async (t) => {
  const contract = await loadContract();
  if (!contract) return t.skip('public/engine/contract.js not present');
  for (const status of ['finished', 'asleep']) {
    if (!contract.STATUSES.includes(status)) { t.todo(`engine contract does not list "${status}" yet`); continue; }
    assert.deepEqual(contract.validateCritter({ id: 'a', name: 'A', taskId: 't', taskName: 'T', agent: 'claude', status }), []);
  }
});

test('forEngine: statuses an older engine does not know fall back to idle; a newer engine gets them as-is', async () => {
  const { forEngine } = await import('./state.js');
  const state = { critters: [{ id: 'a', status: 'asleep' }, { id: 'b', status: 'finished' }, { id: 'c', status: 'working' }] };
  const old = ['working', 'thinking', 'needs-you', 'error', 'idle', 'archived'];
  assert.deepEqual(forEngine(state, old).critters.map((c) => c.status), ['idle', 'idle', 'working']);
  assert.equal(forEngine(state, [...old, 'asleep', 'finished']), state);
  assert.equal(forEngine(state, undefined), state);
});

test('toPenState: a parentId pointing at a card not on the pen is dropped (archived or off-board parent)', () => {
  const g = graph([
    session('p'),
    session('kid', { spawnedBy: 'p' }),
    session('orphan', { spawnedBy: 'archived-parent' }),
    session('hidden', { offBoard: { ext: 'x' } }),
    session('kid-of-hidden', { parentSession: 'hidden' }),
  ]);
  const byId = Object.fromEntries(toPenState(g, NOW).critters.map((c) => [c.id, c]));
  assert.equal(byId.kid.parentId, 'p');
  assert.equal('parentId' in byId.orphan, false);
  assert.equal('parentId' in byId['kid-of-hidden'], false);
});
