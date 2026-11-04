// Standalone demo: fake sessions + a fake event generator driving two pens.
import { createPen } from './pen.js';
import { STATUSES, EVENT_KINDS } from './contract.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
if (params.get('theme')) document.documentElement.dataset.theme = params.get('theme');

const TASKS = {
  t1: 'Checkout revamp',
  t2: 'Docs site',
  t3: 'Critter Pen',
};

/** @type {import('./contract.js').Critter[]} */
let critters = [
  { id: 's-cart', name: 'Refactor cart service', taskId: 't1', taskName: TASKS.t1, agent: 'claude', status: 'working' },
  { id: 's-pay', name: 'Fix flaky payment tests', taskId: 't1', taskName: TASKS.t1, agent: 'codex', status: 'error' },
  { id: 's-ci', name: 'Investigate CI timeouts', taskId: 't1', taskName: TASKS.t1, agent: 'claude', status: 'thinking', parentId: 's-cart' },
  { id: 's-api', name: 'Write API reference', taskId: 't2', taskName: TASKS.t2, agent: 'claude', status: 'needs-you' },
  { id: 's-astro', name: 'Migrate docs to Astro', taskId: 't2', taskName: TASKS.t2, agent: 'codex', status: 'working' },
  { id: 's-links', name: 'Fix broken links', taskId: 't2', taskName: TASKS.t2, agent: 'claude', status: 'idle' },
  { id: 's-pm', name: 'Critter Pen PM', taskId: 't3', taskName: TASKS.t3, agent: 'claude', status: 'thinking' },
  { id: 's-engine', name: 'Build animation engine', taskId: 't3', taskName: TASKS.t3, agent: 'claude', status: 'working', parentId: 's-pm' },
  { id: 's-adapter', name: 'Wrangler adapter', taskId: 't3', taskName: TASKS.t3, agent: 'gemini', status: 'working', parentId: 's-pm' },
];

const LABELS = {
  git: ['git commit', 'git push', 'rebase main', 'fixup!', 'git stash'],
  pr: ['#482 opened', '#17 ✓ checks', '#93 review', '#205 merged'],
  jira: ['PROJ-123', 'WEB-88', 'DOCS-7', 'PEN-1'],
  terminal: ['npm test', 'make build', 'cargo check', 'node --test'],
  files: ['pen.js', 'README.md', 'layout.ts', 'styles.css'],
  web: ['MDN', 'stackoverflow', 'docs.rs', 'caniuse'],
  human: ['needs approval', 'question?', 'permission'],
  spawn: ['new helper', 'sub-agent'],
  done: ['shipped!', 'all green', 'done ✓'],
  error: ['tests failed', 'exit 1', 'timeout'],
};
const NAMES = ['Tidy logging', 'Bump deps', 'Write e2e tests', 'Profile hot path', 'Port to ESM', 'Add dark mode', 'Triage bugs', 'Explore cache bug'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

let selected = 's-engine';
const pens = [];
const state = () => ({ critters: critters.map((c) => ({ ...c })) });
const push = () => { const s = state(); pens.forEach((p) => p.setState(s)); renderWho(); };
const emit = (ev) => { pens.forEach((p) => p.emit(ev)); log(ev); };

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
pens.push(createPen($('#pen'), { onCritterClick: (id) => { selected = id; renderWho(); } }));
pens.push(createPen($('#tray'), { onCritterClick: (id) => { selected = id; renderWho(); } }));
window.pens = pens; // handy for poking from the console
push();

// ── panel ────────────────────────────────────────────────────────────────────
const STATUS_TOKEN = { working: '--green', thinking: '--blue', 'needs-you': '--yellow', error: '--red', idle: '--surface-2', archived: '--surface-2' };
for (const s of STATUSES) {
  const b = document.createElement('button');
  b.innerHTML = `<span class="swatch" style="background:var(${STATUS_TOKEN[s]})"></span>${s}`;
  b.onclick = () => setStatus(selected, s);
  $('#statuses').append(b);
}
const ICON = { git: '⑂', pr: '✈', jira: '🎫', terminal: '>_', files: '📁', web: '🎈', human: '🔔', spawn: '🐣', done: '🎉', error: '💥' };
for (const k of EVENT_KINDS) {
  const b = document.createElement('button');
  b.textContent = `${ICON[k] || ''} ${k}`;
  b.onclick = () => fire(selected, k);
  $('#events').append(b);
}

function renderWho() {
  const c = critters.find((x) => x.id === selected) || critters.find((x) => x.status !== 'archived');
  if (!c) { $('#who').textContent = '—'; return; }
  selected = c.id;
  $('#who').innerHTML = '';
  $('#who').append(c.name);
  const small = document.createElement('small');
  small.textContent = `${c.taskName} · ${c.agent} · ${c.status}`;
  $('#who').append(small);
}

function log(ev) {
  const c = critters.find((x) => x.id === ev.critterId);
  const li = document.createElement('li');
  li.innerHTML = `<b></b> → ${ev.kind}${ev.label ? ' · ' : ''}<span></span>`;
  li.querySelector('b').textContent = c ? c.name : ev.critterId;
  li.querySelector('span').textContent = ev.label || '';
  $('#log').prepend(li);
  while ($('#log').children.length > 12) $('#log').lastChild.remove();
}

// ── actions ──────────────────────────────────────────────────────────────────
function setStatus(id, status) {
  critters = critters.map((c) => (c.id === id ? { ...c, status } : c));
  push();
  if (status === 'archived') setTimeout(() => { critters = critters.filter((c) => c.id !== id); push(); }, 4000);
}

let nextId = 1;
function addCritter(parent) {
  const live = critters.filter((c) => c.status !== 'archived');
  if (live.length >= 14) return null;
  const taskId = parent ? parent.taskId : pick(Object.keys(TASKS));
  const c = {
    id: `s-new-${nextId++}`, name: pick(NAMES), taskId, taskName: TASKS[taskId],
    agent: pick(['claude', 'claude', 'codex']), status: 'working',
    ...(parent ? { parentId: parent.id } : {}),
  };
  critters = [...critters, c];
  return c;
}

function fire(id, kind) {
  const c = critters.find((x) => x.id === id);
  if (!c) return;
  const label = Math.random() < 0.8 ? pick(LABELS[kind]) : undefined;
  emit({ critterId: id, kind, label });
  if (kind === 'spawn') setTimeout(() => { if (addCritter(c)) push(); }, 650);
  if (kind === 'done') setTimeout(() => setStatus(id, 'idle'), 900);
  if (kind === 'human') setStatus(id, 'needs-you');
}

$('#add').onclick = () => { addCritter(); push(); };
$('#theme').onclick = () => {
  const root = document.documentElement;
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
};
$('#motion').setAttribute('aria-pressed', String(reduced));
$('#motion').onclick = (e) => {
  const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
  e.currentTarget.setAttribute('aria-pressed', String(on));
  pens.forEach((p) => p.setOptions({ reducedMotion: on }));
};

// ── fake generator ───────────────────────────────────────────────────────────
const BY_STATUS = {
  working: ['git', 'git', 'terminal', 'terminal', 'files', 'files', 'web', 'pr', 'jira'],
  thinking: ['web', 'files', 'jira'],
  'needs-you': ['human'],
  error: ['terminal', 'error'],
};
let playing = params.get('play') !== '0';
$('#play').setAttribute('aria-pressed', String(playing));
$('#play').onclick = (e) => {
  playing = !playing;
  e.currentTarget.setAttribute('aria-pressed', String(playing));
  e.currentTarget.textContent = playing ? '▶ Live' : '❚❚ Paused';
};

function tickEvents() {
  if (playing && !document.hidden) {
    const active = critters.filter((c) => BY_STATUS[c.status] && (c.status !== 'needs-you' || Math.random() < 0.15));
    if (active.length) {
      const c = pick(active);
      fire(c.id, pick(BY_STATUS[c.status]));
    }
  }
  setTimeout(tickEvents, 700 + Math.random() * 1100);
}

const NEXT = {
  working: ['thinking', 'thinking', 'needs-you', 'error', 'done'],
  thinking: ['working', 'working', 'needs-you'],
  'needs-you': ['working', 'working'],
  error: ['working', 'thinking'],
  idle: ['working'],
};
function tickStatus() {
  if (playing && !document.hidden) {
    const live = critters.filter((c) => c.status !== 'archived');
    const c = pick(live);
    const to = pick(NEXT[c.status] || ['working']);
    if (to === 'done') fire(c.id, 'done');
    else setStatus(c.id, to);
    // Occasionally spawn a helper, or retire a finished one.
    const r = Math.random();
    if (r < 0.12) {
      const parent = pick(critters.filter((x) => x.status === 'working'));
      if (parent) fire(parent.id, 'spawn');
    } else if (r < 0.2) {
      const extra = critters.filter((x) => x.id.startsWith('s-new-') && x.status === 'idle');
      if (extra.length) setStatus(pick(extra).id, 'archived');
    }
  }
  setTimeout(tickStatus, 2600 + Math.random() * 2400);
}
setTimeout(tickEvents, 900);
setTimeout(tickStatus, 3000);
