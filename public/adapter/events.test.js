import { test } from 'node:test';
import assert from 'node:assert/strict';

import { snapshot, diffSnapshots } from './events.js';
import { session, graph, pr, jira, loadContract } from './fixtures.js';

const diff = (a, b) => diffSnapshots(a && snapshot(a), snapshot(b));

test('first tick emits nothing, however much is already linked', () => {
  assert.deepEqual(diff(null, graph([session('a', { links: [pr(1), jira('PROJ-1')], status: 'needs-you' })])), []);
});

test('an unchanged graph emits nothing', () => {
  const g = graph([session('a', { status: 'working', links: [pr(1)] })]);
  assert.deepEqual(diff(g, g), []);
});

test('a new PR link on a session fires pr with its number', () => {
  const before = graph([session('a')]);
  const after = graph([session('a', { links: [pr(482)] })]);
  assert.deepEqual(diff(before, after), [{ critterId: 'a', kind: 'pr', label: '#482' }]);
});

test('a new Jira link fires jira with its key', () => {
  const before = graph([session('a', { links: [jira('PROJ-1')] })]);
  const after = graph([session('a', { links: [jira('PROJ-1'), jira('PROJ-2')] })]);
  assert.deepEqual(diff(before, after), [{ critterId: 'a', kind: 'jira', label: 'PROJ-2' }]);
});

test('PR checks turning failing fire error once', () => {
  const pending = graph([session('a', { links: [pr(7, 'pending')] })]);
  const failing = graph([session('a', { links: [pr(7, 'failing')] })]);
  assert.deepEqual(diff(pending, failing), [{ critterId: 'a', kind: 'error', label: '#7 checks failing' }]);
  assert.deepEqual(diff(failing, failing), []);
});

test('a PR that arrives already failing fires both pr and error', () => {
  const after = graph([session('a', { links: [pr(9, 'failing')] })]);
  assert.deepEqual(diff(graph([session('a')]), after), [
    { critterId: 'a', kind: 'pr', label: '#9' },
    { critterId: 'a', kind: 'error', label: '#9 checks failing' },
  ]);
});

test('a new card with a parent on the pen makes the parent fire spawn', () => {
  const before = graph([session('p')]);
  const after = graph([session('p'), session('kid', { spawnedBy: 'p', label: 'Little one' })]);
  assert.deepEqual(diff(before, after), [{ critterId: 'p', kind: 'spawn', label: 'Little one' }]);
});

test('a new card whose parent is not on the pen spawns nothing', () => {
  assert.deepEqual(diff(graph([]), graph([session('kid', { spawnedBy: 'gone' })])), []);
  assert.deepEqual(diff(graph([]), graph([session('solo')])), []);
});

test('working → idle fires done; needs-you → idle does not', () => {
  assert.deepEqual(diff(graph([session('a', { status: 'working' })]), graph([session('a')])), [{ critterId: 'a', kind: 'done' }]);
  assert.deepEqual(diff(graph([session('a', { status: 'needs-you' })]), graph([session('a')])), []);
});

test('an unknown blip between working and idle is still a finish', () => {
  const working = snapshot(graph([session('a', { status: 'working' })]));
  const blip = snapshot(graph([session('a', { status: 'unknown' })]));
  const idle = snapshot(graph([session('a')]));
  assert.deepEqual(diffSnapshots(working, blip), []);
  assert.deepEqual(diffSnapshots(blip, idle), [{ critterId: 'a', kind: 'done' }]);
});

test('entering needs-you fires human with the reason', () => {
  const after = graph([session('a', { status: 'needs-you', waitingFor: 'Bash permission' })]);
  assert.deepEqual(diff(graph([session('a', { status: 'working' })]), after), [{ critterId: 'a', kind: 'human', label: 'Bash permission' }]);
  const noReason = graph([session('a', { status: 'needs-you' })]);
  assert.deepEqual(diff(graph([session('a')]), noReason), [{ critterId: 'a', kind: 'human' }]);
});

test('task-level links are pinned to the task\'s working member, else its most recent', () => {
  const tasks = (links) => ({ tasks: [{ id: 't', name: 'T', links }], assignments: { a: 't', b: 't', c: 't' } });
  const members = (statusB) => [
    session('a', { lastActivity: 100 }),
    session('b', { lastActivity: 50, status: statusB }),
    session('c', { lastActivity: 200 }),
  ];
  assert.deepEqual(diff(graph(members('working'), tasks([])), graph(members('working'), tasks([jira('T-1')]))),
    [{ critterId: 'b', kind: 'jira', label: 'T-1' }]);
  assert.deepEqual(diff(graph(members('idle'), tasks([])), graph(members('idle'), tasks([pr(5)]))),
    [{ critterId: 'c', kind: 'pr', label: '#5' }]);
});

test('a task link change with no member on the pen is dropped', () => {
  const t = (links) => ({ tasks: [{ id: 't', name: 'T', links }], assignments: {} });
  assert.deepEqual(diff(graph([session('a')], t([])), graph([session('a')], t([pr(1)]))), []);
});

test('every emitted event satisfies the engine contract', async (t) => {
  const contract = await loadContract();
  if (!contract) return t.skip('public/engine/contract.js not present');
  const before = graph([session('p', { status: 'working', links: [pr(1, 'pending')] })]);
  const after = graph([
    session('p', { status: 'needs-you', waitingFor: 'input', links: [pr(1, 'failing'), pr(2), jira('PROJ-9')] }),
    session('kid', { parentSession: 'p' }),
  ]);
  const events = diff(before, after);
  assert.deepEqual(new Set(events.map((e) => e.kind)), new Set(['spawn', 'pr', 'error', 'jira', 'human']));
  for (const ev of events) {
    if (ev.kind === 'error' && !contract.EVENT_KINDS.includes('error')) {
      t.todo('engine contract does not list the approved "error" kind yet');
      continue;
    }
    assert.deepEqual(contract.validatePenEvent(ev), [], JSON.stringify(ev));
  }
});
