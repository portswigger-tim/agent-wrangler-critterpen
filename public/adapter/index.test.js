import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createAdapter } from './index.js';
import { NOW, session, graph, pr } from './fixtures.js';

const statuses = (state) => Object.fromEntries(state.critters.map((c) => [c.id, c.status]));

test('tick returns state and the events since the previous graph', () => {
  const a = createAdapter();
  assert.deepEqual(a.tick(graph([session('x', { status: 'working' })]), NOW).events, []);
  const { state, events } = a.tick(graph([session('x', { links: [pr(3)] })]), NOW + 1000);
  assert.deepEqual(statuses(state), { x: 'idle' });
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
