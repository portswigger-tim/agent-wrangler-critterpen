import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePenState, validatePenEvent, isPenState, isPenEvent, STATUSES, EVENT_KINDS } from '../contract.js';

const ok = { id: 'a', name: 'A', taskId: 't', taskName: 'T', agent: 'claude', status: 'working' };

test('valid state and events pass', () => {
  assert.ok(isPenState({ critters: [] }));
  assert.ok(isPenState({ critters: STATUSES.map((status, i) => ({ ...ok, id: `c${i}`, status })) }));
  for (const kind of EVENT_KINDS) assert.ok(isPenEvent({ critterId: 'a', kind }), kind);
  assert.ok(isPenEvent({ critterId: 'a', kind: 'pr', label: '#482' }));
  assert.ok(EVENT_KINDS.includes('error'));
});

test('invalid state is explained', () => {
  assert.deepEqual(validatePenState(null), ['state: not an object']);
  assert.deepEqual(validatePenState({}), ['state.critters: expected array']);
  const errs = validatePenState({ critters: [ok, { ...ok, status: 'sleepy', parentId: 3 }] });
  assert.ok(errs.some((e) => e.includes('status')));
  assert.ok(errs.some((e) => e.includes('parentId')));
  assert.ok(errs.some((e) => e.includes('duplicate')));
});

test('invalid events are explained', () => {
  assert.ok(validatePenEvent({ critterId: '', kind: 'git' })[0].includes('critterId'));
  assert.ok(validatePenEvent({ critterId: 'a', kind: 'fax' })[0].includes('kind'));
  assert.ok(!isPenEvent({ critterId: 'a', kind: 'git', label: 5 }));
});
