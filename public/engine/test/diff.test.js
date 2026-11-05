import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffCritters } from '../diff.js';

const c = (id, status = 'working', extra = {}) => ({
  id,
  name: id,
  taskId: 't',
  taskName: 'T',
  agent: 'claude',
  status,
  ...extra,
});
const mapOf = (list) => new Map(list.map((x) => [x.id, x]));

test('identical snapshots produce an empty diff', () => {
  const list = [c('a'), c('b', 'idle')];
  const d = diffCritters(
    mapOf(list),
    list.map((x) => ({ ...x })),
  );
  assert.deepEqual([d.added, d.removed, d.statusChanged, d.updated], [[], [], [], []]);
});

test('detects added, removed, status and field changes', () => {
  const prev = mapOf([c('a'), c('b'), c('gone')]);
  const d = diffCritters(prev, [c('a', 'error'), c('b', 'working', { name: 'renamed', parentId: 'a' }), c('new')]);
  assert.deepEqual(
    d.added.map((x) => x.id),
    ['new'],
  );
  assert.deepEqual(d.removed, ['gone']);
  assert.deepEqual(d.statusChanged, [{ id: 'a', from: 'working', to: 'error' }]);
  assert.deepEqual(
    d.updated.map((x) => x.id),
    ['b'],
  );
  assert.equal(d.next.size, 3);
});

test('duplicate ids keep the last occurrence', () => {
  const d = diffCritters(new Map(), [c('a', 'idle'), c('a', 'error')]);
  assert.equal(d.added.length, 1);
  assert.equal(d.next.get('a').status, 'error');
});
