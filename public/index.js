// Critter Pen, client half: the "Critters" view. Each board graph goes through
// the adapter into the renderer; tool activity arrives separately from the
// server half's sweep (index.js) as `activity` frames.
//
// The renderer is the engine's public/engine/pen.js when it is present, else a
// placeholder with the same API, so the view works before the engine lands.

import { createAdapter } from './adapter/index.js';
import { forEngine } from './adapter/state.js';
import { createPen as createPlaceholderPen } from './placeholder-pen.js';

// Re-tick the last graph this often: the board only sends a graph when something
// changed, and thinking/archived/unknown move on with time alone.
const RETICK_MS = 3000;

// Activity kinds the server half may send, and the shape a label must have.
// The server already restricts both; this is the browser's own check on a frame.
const ACTIVITY_KINDS = new Set(['git', 'pr', 'jira', 'terminal', 'files', 'web']);
const MAX_LABEL = 40;

// `class="icon"` is what sizes it on the rail (core's `#nav-rail .icon`); without it the button draws it smaller.
export const ICON =
  '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="8"/><circle cx="9.5" cy="12" r="1" fill="currentColor"/><circle cx="14.5" cy="12" r="1" fill="currentColor"/><path d="M8 4.5 10 6M16 4.5 14 6"/></svg>';

// The engine's renderer and the statuses its contract can draw (an older engine
// lacks the newer ones; see forEngine).
let enginePromise = null;
function loadEngine() {
  enginePromise ??= Promise.all([import('./engine/pen.js'), import('./engine/contract.js').catch(() => null)])
    .then(([pen, contract]) =>
      typeof pen.createPen === 'function' ? { createPen: pen.createPen, statuses: contract?.STATUSES ?? null } : null,
    )
    .catch(() => null);
  return enginePromise;
}

// The options every renderer gets. `reducedMotion` is deliberately absent: left
// undefined, the engine follows prefers-reduced-motion live, where a boolean
// captured at mount would pin it to whatever it was then. A click on a critter
// is the human looking at it (`onSeen`, which clears 'finished') and opens its
// session on the board, the same as a #session= link.
export function penOptions(api, onSeen = () => {}) {
  return {
    theme: 'auto',
    onCritterClick: (id) => {
      onSeen(id);
      api?.openSession?.(id);
    },
  };
}

// Which sessions finished a turn the human has not looked at yet, per browser,
// in the extension's own namespaced storage (never the board's private keys).
const FINISHED_KEY = 'finished';
export function finishedStorage(storage) {
  return {
    load: () => JSON.parse(storage?.get(FINISHED_KEY) ?? 'null'),
    save: (ids) => storage?.set(FINISHED_KEY, JSON.stringify(ids)),
  };
}

export function parseActivity(msg) {
  if (msg?.kind !== 'activity' || !Array.isArray(msg.events)) return [];
  return msg.events
    .filter(
      (e) =>
        e &&
        typeof e.sessionId === 'string' &&
        e.sessionId &&
        ACTIVITY_KINDS.has(e.kind) &&
        (e.label === undefined || (typeof e.label === 'string' && e.label.length <= MAX_LABEL)),
    )
    .map((e) =>
      e.label ? { critterId: e.sessionId, kind: e.kind, label: e.label } : { critterId: e.sessionId, kind: e.kind },
    );
}

// Critter Pen never changes the human's view on its own. Nothing here (a
// graph tick, an activity frame, a status change, a timer) may navigate,
// select, focus or scroll; the only call that moves the board is openSession,
// and it is made only from the engine's onCritterClick, i.e. a human click on
// a critter. The selection is only ever READ (to notice the human has looked
// at a finished card). index.test.js holds this as an invariant.
//
// `loadRenderer` and `createFallbackPen` are the engine and the placeholder;
// they are parameters only so that invariant can be tested without a DOM.
export function registerCritters(slots, { loadRenderer = loadEngine, createFallbackPen = createPlaceholderPen } = {}) {
  const pens = new Map(); // view element -> { pen, adapter, api, statuses, graph, critters, timer, observer }

  const render = (st, graph) => {
    if (graph) st.graph = graph;
    if (!st.graph) return;
    const { state, events } = st.adapter.tick(st.graph, Date.now(), {
      selectedId: st.api?.selectedSessionId?.() ?? null,
    });
    st.critters = new Set(state.critters.map((c) => c.id));
    st.pen.setState(forEngine(state, st.statuses));
    for (const ev of events) st.pen.emit(ev);
  };

  slots.api.onMessage((msg) => {
    const events = parseActivity(msg);
    if (!events.length) return;
    for (const st of pens.values()) {
      for (const ev of events) if (st.critters.has(ev.critterId)) st.pen.emit(ev);
    }
  });

  slots.register('view', {
    id: 'critters',
    label: 'Critters',
    icon: ICON,
    mount(el, api) {
      el.classList.add('critter-pen');
      const adapter = createAdapter({ storage: finishedStorage(api?.storage) });
      const opts = penOptions(api, (id) => adapter.acknowledge(id));
      const st = {
        pen: createFallbackPen(el, opts),
        adapter,
        api,
        statuses: null,
        graph: null,
        critters: new Set(),
        timer: null,
        observer: null,
      };
      pens.set(el, st);
      st.timer = setInterval(() => render(st), RETICK_MS);
      if (typeof ResizeObserver === 'function') {
        st.observer = new ResizeObserver(() => st.pen.resize());
        st.observer.observe(el);
      }
      loadRenderer().then((engine) => {
        if (!engine || pens.get(el) !== st) return;
        st.pen.destroy();
        st.pen = engine.createPen(el, opts);
        st.statuses = engine.statuses;
        // A fresh renderer has seen nothing: give it the current state, without
        // replaying events it would draw as new.
        st.adapter.reset();
        render(st);
      });
    },
    update(el, _session, graph) {
      const st = pens.get(el);
      if (st) render(st, graph);
    },
    unmount(el) {
      const st = pens.get(el);
      if (!st) return;
      pens.delete(el);
      clearInterval(st.timer);
      st.observer?.disconnect();
      st.pen.destroy();
    },
  });
}

export default {
  register(slots) {
    registerCritters(slots);
  },
};
