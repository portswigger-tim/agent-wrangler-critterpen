// Critter Pen, client half: the "Critters" view. Each board graph goes through
// the adapter into the renderer; tool activity arrives separately from the
// server half's sweep (index.js) as `activity` frames.
//
// The renderer is the engine's public/engine/pen.js when it is present, else a
// placeholder with the same API, so the view works before the engine lands.

import { createAdapter } from './adapter/index.js';
import { createPen as createPlaceholderPen } from './placeholder-pen.js';

// Re-tick the last graph this often: the board only sends a graph when something
// changed, and thinking/archived/unknown move on with time alone.
const RETICK_MS = 3000;

// Activity kinds the server half may send, and the shape a label must have.
// The server already restricts both; this is the browser's own check on a frame.
const ACTIVITY_KINDS = new Set(['git', 'pr', 'jira', 'terminal', 'files', 'web']);
const MAX_LABEL = 40;

// `class="icon"` is what sizes it on the rail (core's `#nav-rail .icon`); without it the button draws it smaller.
export const ICON = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="8"/><circle cx="9.5" cy="12" r="1" fill="currentColor"/><circle cx="14.5" cy="12" r="1" fill="currentColor"/><path d="M8 4.5 10 6M16 4.5 14 6"/></svg>';

let enginePromise = null;
function loadEngine() {
  enginePromise ??= import('./engine/pen.js')
    .then((m) => (typeof m.createPen === 'function' ? m.createPen : null))
    .catch(() => null);
  return enginePromise;
}

// The options every renderer gets. `reducedMotion` is deliberately absent: left
// undefined, the engine follows prefers-reduced-motion live, where a boolean
// captured at mount would pin it to whatever it was then. A click on a critter
// opens its session on the board, the same as a #session= link.
export function penOptions(api) {
  return {
    theme: 'auto',
    onCritterClick: (id) => { api?.openSession?.(id); },
  };
}

function needsYouCount(graph) {
  return (graph?.sessions || []).filter((s) => s && !s.offBoard && s.status === 'needs-you').length;
}

export function parseActivity(msg) {
  if (msg?.kind !== 'activity' || !Array.isArray(msg.events)) return [];
  return msg.events.filter((e) => e && typeof e.sessionId === 'string' && e.sessionId && ACTIVITY_KINDS.has(e.kind)
    && (e.label === undefined || (typeof e.label === 'string' && e.label.length <= MAX_LABEL)))
    .map((e) => (e.label ? { critterId: e.sessionId, kind: e.kind, label: e.label } : { critterId: e.sessionId, kind: e.kind }));
}

export default {
  register(slots) {
    const pens = new Map(); // view element -> { pen, adapter, graph, critters, timer, observer }

    const render = (st, graph) => {
      if (graph) st.graph = graph;
      if (!st.graph) return;
      const { state, events } = st.adapter.tick(st.graph);
      st.critters = new Set(state.critters.map((c) => c.id));
      st.pen.setState(state);
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
      badge: needsYouCount,
      mount(el, api) {
        el.classList.add('critter-pen');
        const opts = penOptions(api);
        const st = { pen: createPlaceholderPen(el, opts), adapter: createAdapter(), graph: null, critters: new Set(), timer: null, observer: null };
        pens.set(el, st);
        st.timer = setInterval(() => render(st), RETICK_MS);
        if (typeof ResizeObserver === 'function') {
          st.observer = new ResizeObserver(() => st.pen.resize());
          st.observer.observe(el);
        }
        loadEngine().then((createPen) => {
          if (!createPen || pens.get(el) !== st) return;
          st.pen.destroy();
          st.pen = createPen(el, opts);
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
  },
};
