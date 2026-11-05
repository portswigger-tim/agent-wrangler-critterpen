// Invariant: Critter Pen never changes the human's view on its own. Only a
// human click on a critter (the engine's onCritterClick) may call openSession;
// graph ticks, activity frames, status transitions and timers never navigate,
// select, focus or scroll. The board api and the view element are Proxies that
// record every property the view touches, so anything new that reaches for the
// view fails here, not on someone's board.

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

import { registerCritters } from './index.js';
import { NOW, session, graph, pr, jira } from './adapter/fixtures.js';

// What the view may touch on the board api without a click: its own storage,
// and READING the selection. `openSession` is only looked up at click time.
const ALLOWED_API = new Set(['storage', 'selectedSessionId']);

function harness() {
  const touched = []; // every api / element property touched, in order
  const opened = [];
  let selected = null;
  const storage = new Map();
  const api = new Proxy(
    {
      storage: {
        get: (k) => storage.get(k) ?? null,
        set: (k, v) => storage.set(k, v),
        remove: (k) => storage.delete(k),
      },
      selectedSessionId: () => selected,
      openSession: (id) => opened.push(id),
    },
    {
      get(target, key) {
        if (typeof key === 'string') touched.push(`api.${key}`);
        return target[key];
      },
    },
  );
  const el = new Proxy(
    { classList: { add() {} } },
    {
      get(target, key) {
        if (typeof key === 'string') touched.push(`el.${key}`);
        return (
          target[key] ??
          (() => {
            touched.push(`el.${String(key)}()`);
          })
        );
      },
    },
  );

  const pens = [];
  const createPen = (_el, opts) => {
    const pen = {
      opts,
      states: [],
      events: [],
      setState(s) {
        this.states.push(s);
      },
      emit(e) {
        this.events.push(e);
      },
      resize() {},
      destroy() {},
    };
    pens.push(pen);
    return pen;
  };
  let onMessage = null;
  let view = null;
  const slots = {
    api: {
      onMessage: (fn) => {
        onMessage = fn;
      },
    },
    register: (slot, c) => {
      assert.equal(slot, 'view');
      view = c;
    },
  };
  registerCritters(slots, { loadRenderer: async () => ({ createPen, statuses: null }), createFallbackPen: createPen });
  return {
    api,
    el,
    pens,
    opened,
    touched,
    select: (id) => {
      selected = id;
    },
    view: () => view,
    message: (m) => onMessage(m),
  };
}

const nav = (touched) => touched.filter((t) => !ALLOWED_API.has(t.replace(/^api\./, '')) && t !== 'el.classList');

test('no graph tick, activity frame, status change or timer ever navigates; one click opens exactly one session', async () => {
  mock.timers.enable({ apis: ['setInterval', 'Date'], now: NOW });
  try {
    const h = harness();
    const v = h.view();
    v.mount(h.el, h.api);
    await new Promise((r) => setImmediate(r)); // the renderer swap
    const tick = (sessions, opts) => v.update(h.el, null, graph(sessions, opts));
    const wait = (ms) => mock.timers.tick(ms); // runs the view's re-tick timer too
    const now = () => Date.now();
    const tasks = { tasks: [{ id: 't1', name: 'Task', links: [] }], assignments: { a: 't1', k: 't1' } };

    // Every status and event kind the adapter knows, in a long scripted run.
    tick(
      [
        session('a', { status: 'working', lastActivity: now() }),
        session('b'),
        session('c', { status: 'needs-you', waitingFor: 'Bash' }),
      ],
      tasks,
    );
    wait(25_000); // a goes quiet: thinking
    tick(
      [
        session('a', { status: 'working', lastActivity: now() - 25_000 }),
        session('b'),
        session('c', { status: 'working' }),
      ],
      tasks,
    );
    tick(
      [
        session('a', { status: 'working', lastActivity: now() }),
        session('k', { status: 'working', spawnedBy: 'a', lastActivity: now() }),
        session('b', { links: [pr(482)] }),
        session('c', { status: 'needs-you', waitingFor: 'question' }),
      ],
      tasks,
    );
    tick(
      [
        session('a', { lastActivity: now() }),
        session('k', { status: 'working', spawnedBy: 'a', lastActivity: now() }),
        session('b', { links: [pr(482, 'failing'), jira('PROJ-1')] }),
        session('c', { status: 'working' }),
      ],
      tasks,
    );
    tick(
      [
        session('a', { lastActivity: now() }),
        session('k', { spawnedBy: 'a', lastActivity: now() }),
        session('b', { links: [pr(482, 'failing'), jira('PROJ-1')], hasBackgroundShell: true }),
        session('c'),
      ],
      tasks,
    );
    h.select('c'); // the human selects a finished card on the board: read, never written
    wait(3000);
    tick(
      [
        session('a', { lastActivity: now(), snooze: { until: now() + 3_600_000 } }),
        session('k', { spawnedBy: 'a', status: 'unknown' }),
        session('b', { dormant: true, managed: false, subAgents: [{ status: 'running' }] }),
        session('c'),
      ],
      tasks,
    );
    tick(
      [
        session('a', { lastActivity: now() }),
        session('k', { spawnedBy: 'a', teammates: [{ status: 'working' }] }),
        session('b', { dormant: true, managed: false }),
      ],
      tasks,
    );
    for (const kind of ['git', 'pr', 'jira', 'terminal', 'files', 'web'])
      h.message({
        kind: 'activity',
        events: [{ sessionId: 'a', kind, label: kind === 'jira' ? 'PROJ-1' : undefined }],
      });
    h.message({
      kind: 'activity',
      events: [
        { sessionId: 'k', kind: 'human' },
        { sessionId: 'nobody', kind: 'git' },
      ],
    });
    h.message({ kind: 'something-else', open: 'b' });
    wait(10_000); // c walks off and goes; timers keep re-ticking
    wait(31 * 60_000); // long quiet: dozing
    tick(
      [
        session('a', { lastActivity: now() - 31 * 60_000 }),
        session('k', { spawnedBy: 'a', lastActivity: now() - 40 * 60_000 }),
        session('b', { dormant: true, managed: false }),
      ],
      tasks,
    );
    h.select('a');
    wait(3000);

    // The run really did go through everything it claims to.
    const pen = h.pens.at(-1);
    const seen = new Set(pen.states.flatMap((s) => s.critters.map((c) => c.status)));
    for (const s of ['working', 'thinking', 'needs-you', 'error', 'finished', 'asleep', 'idle', 'archived'])
      assert.ok(seen.has(s), `status ${s} never reached`);
    const kinds = new Set(pen.events.map((e) => e.kind));
    for (const k of ['pr', 'jira', 'error', 'spawn', 'done', 'human', 'git', 'terminal', 'files', 'web'])
      assert.ok(kinds.has(k), `event ${k} never emitted`);

    // ...and never touched anything that changes the view.
    assert.deepEqual(nav(h.touched), [], `touched without a click: ${nav(h.touched).join(', ')}`);
    assert.deepEqual(h.opened, []);
    assert.ok(h.touched.includes('api.selectedSessionId'), 'selection is read to acknowledge finished cards');

    // One human click: exactly one openSession, for that critter, and nothing else.
    const before = h.touched.length;
    pen.opts.onCritterClick('b');
    assert.deepEqual(h.opened, ['b']);
    assert.deepEqual(h.touched.slice(before), ['api.openSession']);

    v.unmount(h.el);
  } finally {
    mock.timers.reset();
  }
});

test('the engine fires onCritterClick only from its canvas click handler', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('./engine/pen.js', import.meta.url), 'utf8');
  const calls = src
    .split('\n')
    .filter(
      (l) => /onCritterClick\?\.\(|onCritterClick\(/.test(l) && !l.trim().startsWith('*') && !l.trim().startsWith('//'),
    );
  assert.equal(calls.length, 1, calls.join('\n'));
  const handler = src.slice(
    src.indexOf('const onClick = (ev) =>'),
    src.indexOf("canvas.addEventListener('click', onClick)"),
  );
  assert.match(handler, /opts\.onCritterClick\?\.\(s\.id\)/);
  assert.match(src, /canvas\.addEventListener\('click', onClick\)/);
});
