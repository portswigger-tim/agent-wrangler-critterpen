// A stand-in renderer with the engine's API (createPen → setState/emit/resize/
// destroy), used until public/engine/pen.js is present. Deliberately plain: one
// coloured dot per critter grouped by task, and a log of recent events, so the
// adapter's output can be checked end to end against real sessions.

const MAX_LOG = 40;

export function createPen(el) {
  const doc = el.ownerDocument;
  const root = doc.createElement('div');
  root.className = 'cp-placeholder';
  const note = doc.createElement('p');
  note.className = 'cp-note';
  note.textContent = 'Critter engine not loaded: showing the placeholder pen.';
  const groups = doc.createElement('div');
  groups.className = 'cp-groups';
  const logTitle = doc.createElement('h3');
  logTitle.textContent = 'Events';
  const log = doc.createElement('ol');
  log.className = 'cp-log';
  log.setAttribute('aria-live', 'polite');
  root.append(note, groups, logTitle, log);
  el.append(root);

  let names = new Map();

  return {
    setState(state) {
      names = new Map(state.critters.map((c) => [c.id, c.name]));
      const byTask = new Map();
      for (const c of state.critters) {
        if (!byTask.has(c.taskId)) byTask.set(c.taskId, { name: c.taskName, critters: [] });
        byTask.get(c.taskId).critters.push(c);
      }
      groups.replaceChildren(
        ...[...byTask.values()].map((t) => {
          const box = doc.createElement('section');
          box.className = 'cp-task';
          const h = doc.createElement('h3');
          h.textContent = t.name;
          const ul = doc.createElement('ul');
          for (const c of t.critters) {
            const li = doc.createElement('li');
            li.className = `cp-critter cp-${c.status}`;
            li.dataset.id = c.id;
            const dot = doc.createElement('span');
            dot.className = 'cp-dot';
            const label = doc.createElement('span');
            label.className = 'cp-name';
            label.textContent = c.name;
            const meta = doc.createElement('span');
            meta.className = 'cp-meta';
            meta.textContent = [
              c.status,
              c.agent,
              c.parentId ? `↳ ${names.get(c.parentId) || c.parentId.slice(0, 8)}` : '',
            ]
              .filter(Boolean)
              .join(' · ');
            li.append(dot, label, meta);
            ul.append(li);
          }
          box.append(h, ul);
          return box;
        }),
      );
    },
    emit(ev) {
      const li = doc.createElement('li');
      li.className = `cp-ev cp-ev-${ev.kind}`;
      const time = new Date().toLocaleTimeString();
      li.textContent = `${time}  ${names.get(ev.critterId) || ev.critterId.slice(0, 8)}  ${ev.kind}${ev.label ? `  ${ev.label}` : ''}`;
      log.prepend(li);
      while (log.children.length > MAX_LOG) log.lastElementChild.remove();
      const critter = groups.querySelector(`[data-id="${CSS.escape(ev.critterId)}"]`);
      if (critter) {
        critter.classList.remove('cp-hit');
        void critter.offsetWidth; // restart the flash animation
        critter.classList.add('cp-hit');
      }
    },
    resize() {},
    destroy() {
      root.remove();
    },
  };
}
