import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createAdapter, ASLEEP_AFTER_MS } from './index.js';
import { NOW, session, graph, pr } from './fixtures.js';

const statuses = (state) => Object.fromEntries(state.critters.map((c) => [c.id, c.status]));

test('tick returns state and the events since the previous graph', () => {
  const a = createAdapter();
  assert.deepEqual(a.tick(graph([session('x', { status: 'working' })]), NOW).events, []);
  const { state, events } = a.tick(graph([session('x', { links: [pr(3)] })]), NOW + 1000);
  assert.deepEqual(statuses(state), { x: 'finished' });
  assert.deepEqual(events, [{ critterId: 'x', kind: 'pr', label: '#3' }, { critterId: 'x', kind: 'done' }]);
});

test('re-ticking the same graph emits nothing but lets time move status on', () => {
  const a = createAdapter();
  const g = graph([session('x', { status: 'working', lastActivity: NOW })]);
  assert.deepEqual(statuses(a.tick(g, NOW).state), { x: 'working' });
  const later = a.tick(g, NOW + 60_000);
  assert.deepEqual(later.events, []);
  assert.deepEqual(statuses(later.state), { x: 'thinking' });
});

test('a card leaving the board stays as archived for the grace period, then goes', () => {
  const a = createAdapter({ archiveGraceMs: 5000 });
  a.tick(graph([session('x'), session('y', { label: 'Leaving' })]), NOW);
  const left = a.tick(graph([session('x')]), NOW + 1000).state;
  assert.deepEqual(statuses(left), { x: 'idle', y: 'archived' });
  assert.equal(left.critters.find((c) => c.id === 'y').name, 'Leaving');
  assert.deepEqual(statuses(a.tick(graph([session('x')]), NOW + 4000).state), { x: 'idle', y: 'archived' });
  assert.deepEqual(statuses(a.tick(graph([session('x')]), NOW + 6001).state), { x: 'idle' });
});

test('a restored card comes straight back from archived', () => {
  const a = createAdapter();
  a.tick(graph([session('y')]), NOW);
  a.tick(graph([]), NOW + 1000);
  assert.deepEqual(statuses(a.tick(graph([session('y', { status: 'working' })]), NOW + 2000).state), { y: 'working' });
});

test('unknown holds the previous look for the grace period, then reads idle', () => {
  const a = createAdapter({ unknownGraceMs: 10_000 });
  a.tick(graph([session('x', { status: 'working' })]), NOW);
  assert.deepEqual(statuses(a.tick(graph([session('x', { status: 'unknown' })]), NOW + 4000).state), { x: 'working' });
  assert.deepEqual(statuses(a.tick(graph([session('x', { status: 'unknown' })]), NOW + 9000).state), { x: 'working' });
  assert.deepEqual(statuses(a.tick(graph([session('x', { status: 'unknown' })]), NOW + 14_001).state), { x: 'idle' });
});

test('a card that first appears unknown reads idle straight away', () => {
  const a = createAdapter();
  assert.deepEqual(statuses(a.tick(graph([session('x', { status: 'unknown' })]), NOW).state), { x: 'idle' });
});

test('reset forgets history, so the next tick is a fresh first tick', () => {
  const a = createAdapter();
  a.tick(graph([session('x')]), NOW);
  a.reset();
  assert.deepEqual(a.tick(graph([session('x', { links: [pr(1)] })]), NOW).events, []);
});

// ── finished: waiting for the human ──────────────────────────────────────────

const memoryStorage = (initial = null) => {
  const box = { saved: initial, saves: 0 };
  return { box, storage: { load: () => box.saved, save: (ids) => { box.saved = [...ids]; box.saves++; } } };
};

test('a finished turn stays finished across ticks and time until acknowledged', () => {
  const a = createAdapter();
  a.tick(graph([session('x', { status: 'working' })]), NOW);
  assert.deepEqual(statuses(a.tick(graph([session('x')]), NOW + 1000).state), { x: 'finished' });
  assert.deepEqual(statuses(a.tick(graph([session('x', { lastActivity: NOW })]), NOW + 3 * ASLEEP_AFTER_MS).state), { x: 'finished' });
  a.acknowledge('x');
  assert.deepEqual(statuses(a.tick(graph([session('x', { lastActivity: NOW })]), NOW + 3 * ASLEEP_AFTER_MS).state), { x: 'asleep' });
});

test('selecting the card on the board acknowledges it, but only when the selection moves there', () => {
  const a = createAdapter();
  a.tick(graph([session('x', { status: 'working' }), session('y', { status: 'working' })]), NOW, { selectedId: 'x' });
  // x was already selected when it finished: the human is in the pen, not looking at it.
  let s = a.tick(graph([session('x'), session('y')]), NOW + 1000, { selectedId: 'x' }).state;
  assert.deepEqual(statuses(s), { x: 'finished', y: 'finished' });
  s = a.tick(graph([session('x'), session('y')]), NOW + 2000, { selectedId: 'y' }).state;
  assert.deepEqual(statuses(s), { x: 'finished', y: 'idle' });
});

test('going back to work or needing the human clears finished; so does leaving the board', () => {
  const a = createAdapter();
  a.tick(graph([session('x', { status: 'working' })]), NOW);
  a.tick(graph([session('x')]), NOW + 1);
  a.tick(graph([session('x', { status: 'needs-you' })]), NOW + 2);
  assert.deepEqual(statuses(a.tick(graph([session('x')]), NOW + 3).state), { x: 'idle' });
});

test('a card that went dormant as it finished is asleep, not finished', () => {
  const a = createAdapter();
  a.tick(graph([session('x', { status: 'working' })]), NOW);
  assert.deepEqual(statuses(a.tick(graph([session('x', { dormant: true, managed: false })]), NOW + 1).state), { x: 'asleep' });
});

test('finished is persisted per browser and restored on the next load', () => {
  const { box, storage } = memoryStorage();
  const a = createAdapter({ storage });
  a.tick(graph([session('x', { status: 'working' })]), NOW);
  a.tick(graph([session('x')]), NOW + 1);
  assert.deepEqual(box.saved, ['x']);
  const reloaded = createAdapter({ storage });
  assert.deepEqual(statuses(reloaded.tick(graph([session('x')]), NOW + 2).state), { x: 'finished' });
  reloaded.acknowledge('x');
  assert.deepEqual(box.saved, []);
});

test('stored ids that are gone or busy are dropped on the first tick', () => {
  const { box, storage } = memoryStorage(['gone', 'busy', 'x']);
  const a = createAdapter({ storage });
  assert.deepEqual(statuses(a.tick(graph([session('busy', { status: 'working' }), session('x')]), NOW).state), { busy: 'working', x: 'finished' });
  assert.deepEqual(box.saved, ['x']);
});

test('broken storage reads as empty and never throws', () => {
  const a = createAdapter({ storage: { load: () => { throw new Error('denied'); }, save: () => { throw new Error('denied'); } } });
  a.tick(graph([session('x', { status: 'working' })]), NOW);
  assert.deepEqual(statuses(a.tick(graph([session('x')]), NOW + 1).state), { x: 'finished' });
  assert.deepEqual(statuses(createAdapter({ storage: { load: () => 'nonsense' } }).tick(graph([session('x')]), NOW).state), { x: 'idle' });
});

test('reset forgets the graph history, not what the human has yet to see', () => {
  const a = createAdapter();
  a.tick(graph([session('x', { status: 'working' })]), NOW);
  a.tick(graph([session('x')]), NOW + 1);
  a.reset();
  assert.deepEqual(statuses(a.tick(graph([session('x')]), NOW + 2).state), { x: 'finished' });
});

// ── dozing: a long quiet spell, with hysteresis ──────────────────────────────

test('a live idle session dozes after ASLEEP_AFTER_MS quiet and only wakes on fresh activity', () => {
  const a = createAdapter();
  const at = (minutesAgo, now) => statuses(a.tick(graph([session('x', { lastActivity: now - minutesAgo * 60_000 })]), now).state).x;
  assert.equal(at(29, NOW), 'idle');
  assert.equal(at(31, NOW + 1), 'asleep');
  // lastActivity wobbling back under the threshold is not activity.
  assert.equal(at(29, NOW + 2), 'asleep');
  assert.equal(at(26, NOW + 3), 'asleep');
  assert.equal(at(1, NOW + 4), 'idle');
});

test('a missing lastActivity keeps the previous doze state rather than flickering', () => {
  const a = createAdapter();
  a.tick(graph([session('x', { lastActivity: NOW - ASLEEP_AFTER_MS - 1 })]), NOW);
  assert.deepEqual(statuses(a.tick(graph([session('x', { lastActivity: null })]), NOW + 1).state), { x: 'asleep' });
});

test('the live board\'s real shapes through the stateful adapter', async () => {
  const live = await import('./live-board.fixture.js');
  const a = createAdapter();
  const byId = statuses(a.tick(graph(live.all), NOW).state);
  assert.deepEqual(byId, {
    '0069b540': 'thinking', // its child's job is running
    '69fff775': 'working',
    '6159bca6': 'asleep', // live but quiet for 5+ hours
    db362dd0: 'asleep', // live but quiet for 81 minutes
    '3ccee247': 'asleep',
    c8e23b4d: 'asleep',
  });
  // The job finishing hands the orchestrator back to plain idle, and the job
  // itself (a turn already over) is idle, not finished: no working → idle turn.
  const after = statuses(a.tick(graph(live.all.map((s) => (s === live.job ? { ...s, hasBackgroundShell: false } : s))), NOW + 1000).state);
  assert.equal(after['0069b540'], 'idle');
  assert.equal(after['69fff775'], 'idle');
});
