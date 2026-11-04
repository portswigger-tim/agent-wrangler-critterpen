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
  assert.equal(statusFor(session('a', { dormant: true }), NOW), 'idle');
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
