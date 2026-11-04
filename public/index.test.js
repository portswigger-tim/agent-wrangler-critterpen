import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ICON, parseActivity } from './index.js';

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
