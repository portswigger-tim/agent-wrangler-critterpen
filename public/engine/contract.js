// Critter Pen contract — the only thing the adapter and the engine share.
// Mirrors the "Contract" section of DESIGN.md; change both together.
// Lives in public/engine/ because the wrangler only serves <ext>/public/;
// keep every import relative and inside this folder.
// Pure module: no DOM, safe to import from Node and the browser.

/**
 * @typedef {'working'|'thinking'|'needs-you'|'error'|'idle'|'archived'} CritterStatus
 */

/**
 * @typedef {'git'|'pr'|'jira'|'terminal'|'files'|'web'|'human'|'spawn'|'done'|'error'} PenEventKind
 */

/**
 * @typedef {Object} Critter
 * @property {string} id            session id, stable
 * @property {string} name          session title
 * @property {string} taskId
 * @property {string} taskName
 * @property {string} [parentId]    spawned-by / nested parent
 * @property {'claude'|'codex'|string} agent
 * @property {CritterStatus} status
 */

/**
 * Snapshot, applied on every graph tick (idempotent).
 * @typedef {{ critters: Critter[] }} PenState
 */

/**
 * Discrete things that happened since the last tick (fire-and-forget animations).
 * @typedef {Object} PenEvent
 * @property {string} critterId
 * @property {PenEventKind} kind
 * @property {string} [label]       e.g. "PROJ-123", "#482", "git push"
 *
 * 'error' is a one-shot effect with no landmark (smoke puff + wobble); the
 * persistent red comes from status 'error'.
 */

/**
 * @typedef {Object} PenOptions
 * @property {'auto'|'light'|'dark'} [theme]   'auto' (default) reads CSS variables from the host element
 * @property {boolean} [reducedMotion]         initial mode; defaults to the `prefers-reduced-motion` media query,
 *                                             and later changes to that query always apply
 * @property {(id: string) => void} [onCritterClick]  critter clicked (el also dispatches a bubbling 'critter-click' CustomEvent, detail { id })
 */

/**
 * @typedef {Object} Pen
 * @property {(state: PenState) => void} setState
 * @property {(event: PenEvent) => void} emit
 * @property {() => void} resize
 * @property {() => void} destroy
 */

/** @type {readonly CritterStatus[]} */
export const STATUSES = Object.freeze(['working', 'thinking', 'needs-you', 'error', 'idle', 'archived']);

/** @type {readonly PenEventKind[]} */
export const EVENT_KINDS = Object.freeze(['git', 'pr', 'jira', 'terminal', 'files', 'web', 'human', 'spawn', 'done', 'error']);

/** Event kinds that fire a projectile at a landmark on the pen edge. */
export const LANDMARK_KINDS = Object.freeze(['git', 'pr', 'jira', 'terminal', 'files', 'web', 'human']);

/** @param {unknown} s @returns {s is CritterStatus} */
export const isStatus = (s) => STATUSES.includes(/** @type {any} */ (s));

/** @param {unknown} k @returns {k is PenEventKind} */
export const isEventKind = (k) => EVENT_KINDS.includes(/** @type {any} */ (k));

const isStr = (v) => typeof v === 'string';

/**
 * Validate one critter. Returns a list of human-readable problems (empty = valid).
 * @param {unknown} c
 * @param {string} [where]
 * @returns {string[]}
 */
export function validateCritter(c, where = 'critter') {
  if (!c || typeof c !== 'object') return [`${where}: not an object`];
  const o = /** @type {Record<string, unknown>} */ (c);
  const errs = [];
  for (const k of ['id', 'name', 'taskId', 'taskName', 'agent']) {
    if (!isStr(o[k])) errs.push(`${where}.${k}: expected string`);
  }
  if (isStr(o.id) && !o.id) errs.push(`${where}.id: must not be empty`);
  if (o.parentId !== undefined && !isStr(o.parentId)) errs.push(`${where}.parentId: expected string or undefined`);
  if (!isStatus(o.status)) errs.push(`${where}.status: expected one of ${STATUSES.join('|')}, got ${JSON.stringify(o.status)}`);
  return errs;
}

/**
 * Validate a PenState snapshot. Returns a list of problems (empty = valid).
 * @param {unknown} state
 * @returns {string[]}
 */
export function validatePenState(state) {
  if (!state || typeof state !== 'object') return ['state: not an object'];
  const list = /** @type {any} */ (state).critters;
  if (!Array.isArray(list)) return ['state.critters: expected array'];
  const errs = [];
  const seen = new Set();
  list.forEach((c, i) => {
    errs.push(...validateCritter(c, `critters[${i}]`));
    if (c && isStr(c.id)) {
      if (seen.has(c.id)) errs.push(`critters[${i}].id: duplicate ${JSON.stringify(c.id)}`);
      seen.add(c.id);
    }
  });
  return errs;
}

/**
 * Validate a PenEvent. Returns a list of problems (empty = valid).
 * @param {unknown} ev
 * @returns {string[]}
 */
export function validatePenEvent(ev) {
  if (!ev || typeof ev !== 'object') return ['event: not an object'];
  const o = /** @type {Record<string, unknown>} */ (ev);
  const errs = [];
  if (!isStr(o.critterId) || !o.critterId) errs.push('event.critterId: expected non-empty string');
  if (!isEventKind(o.kind)) errs.push(`event.kind: expected one of ${EVENT_KINDS.join('|')}, got ${JSON.stringify(o.kind)}`);
  if (o.label !== undefined && !isStr(o.label)) errs.push('event.label: expected string or undefined');
  return errs;
}

/** @param {unknown} state @returns {state is PenState} */
export const isPenState = (state) => validatePenState(state).length === 0;

/** @param {unknown} ev @returns {ev is PenEvent} */
export const isPenEvent = (ev) => validatePenEvent(ev).length === 0;
