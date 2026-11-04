import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ICON, parseActivity, penOptions } from './index.js';

test('the rail icon is an svg with class="icon", which core sizes on the rail', () => {
  assert.match(ICON, /^<svg class="icon"[\s>]/);
});

test('parseActivity keeps known kinds and short labels only', () => {
  assert.deepEqual(parseActivity({ kind: 'activity', events: [
    { sessionId: 'a', kind: 'git', label: 'git push' },
    { sessionId: 'a', kind: 'terminal' },
    { sessionId: 'a', kind: 'spawn' },
    { sessionId: 'a', kind: 'web', label: 'x'.repeat(41) },
    { sessionId: '', kind: 'files' },
  ] }), [
    { critterId: 'a', kind: 'git', label: 'git push' },
    { critterId: 'a', kind: 'terminal' },
  ]);
  assert.deepEqual(parseActivity({ kind: 'other' }), []);
});

test('renderer options leave reducedMotion unset so the engine follows the media query live', () => {
  const opts = penOptions({ openSession() {} });
  assert.equal('reducedMotion' in opts, false);
  assert.equal(opts.theme, 'auto');
});

test('clicking a critter opens that session on the board', () => {
  const opened = [];
  penOptions({ openSession: (id) => opened.push(id) }).onCritterClick('sess-1');
  assert.deepEqual(opened, ['sess-1']);
  assert.doesNotThrow(() => penOptions(undefined).onCritterClick('x'));
});
