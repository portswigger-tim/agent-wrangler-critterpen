# Critter Pen — design brief

An Agent Wrangler extension that shows every running session as a small, round,
animated creature ("critter"). Glance at the screen and you can see who is busy,
who is stuck, who needs you, and what they are poking at, without reading a card.

## Product goals

1. **Status at a glance.** A critter's body colour and animation *is* the session
   status. No legend needed after one look.
2. **Activity is visible.** When a session does something outward-facing (commits,
   opens a PR, touches Jira, runs a shell command, edits files, browses the web),
   its critter fires a little projectile at the matching **landmark** on screen.
3. **Delightful, not noisy.** Smooth 60fps, small, idle critters calm down, respects
   `prefers-reduced-motion` (swap motion for colour/opacity changes).
4. **Zero config.** Works as soon as the extension is enabled.

## Visual language

| Session state | Body colour token | Animation |
| --- | --- | --- |
| `working` | `--green` | bouncy hop, squash & stretch, little dust puffs |
| `thinking` (working, no tool for a while) | `--blue` | slow bob, orbiting "…" dots |
| `needs-you` (waiting on human / permission) | `--yellow`/amber | jumps and waves, "!" bubble, gentle pulse |
| `error` / failed checks | `--red` | wobble, puff of smoke, dizzy stars |
| `idle` / finished | `--surface-2` grey-ish | sleeps, "z z z", slow breathing |
| `archived` | — | waves goodbye and walks off-screen |

Each critter: a sphere with two eyes (blink at random), optional tiny hat/accessory
derived deterministically from the session id so a session is recognisable over time,
name label underneath (session title, truncated). Agent type tints the eyes/accessory
(Claude vs Codex). Colours come from theme CSS variables so every wrangler theme works.

**Landmarks** sit around the edge of the pen: Git (branch tree), GitHub PR (merge
icon), Jira (ticket), Terminal (`>_`), Files (folder), Web (globe), Human (a little
bell/house the critter runs to when it needs you). Projectiles: git = little commit
dots, PR = paper plane, Jira = ticket card, terminal = sparks, files = paper scraps,
web = tiny balloon. Landmark pulses when hit.

Critters belonging to the same task huddle together in a loose cluster with the task
name as a faint label. Parent/child sessions (spawned/nested) are linked by a thin
dotted "leash".

## Architecture

Two independent pieces with one contract between them.

```
 ┌──────────────── Agent Wrangler board (browser) ────────────────┐
 │  graph ticks ──► adapter/ (graph → PenState + PenEvent[]) ──┐  │
 │                                                             ▼  │
 │                     engine/ (pure renderer, no wrangler deps)  │
 │                     mounted into `view` slot (full pen) and    │
 │                     optionally `board.tray` (mini strip)       │
 └────────────────────────────────────────────────────────────────┘
```

- **`engine/`** — framework-free ES module, Canvas 2D (or SVG if it stays fast).
  Knows nothing about Agent Wrangler. Ships a standalone `demo.html` driven by a fake
  event generator so it can be developed and shown off in any browser.
- **Extension (`index.js`, `package.json`, `public/`)** — the wrangler manifest and
  client entry. Registers a `view` contribution ("Critters" rail button) and later a
  `board.tray` mini-pen. Adapter diffs successive board graphs into the contract below.

### Contract: `engine/contract.js`

```js
// Snapshot, applied on every graph tick (idempotent).
/** @typedef {{
 *   critters: Array<{
 *     id: string,            // session id, stable
 *     name: string,          // session title
 *     taskId: string, taskName: string,
 *     parentId?: string,     // spawned-by / nested parent
 *     agent: 'claude'|'codex'|string,
 *     status: 'working'|'thinking'|'needs-you'|'error'|'idle'|'archived',
 *   }>
 * }} PenState */

// Discrete things that happened since the last tick (fire-and-forget animations).
/** @typedef {{
 *   critterId: string,
 *   kind: 'git'|'pr'|'jira'|'terminal'|'files'|'web'|'human'|'spawn'|'done',
 *   label?: string,          // e.g. "PROJ-123", "#482", "git push"
 * }} PenEvent */

// Engine API
// createPen(el, { theme?: 'auto', reducedMotion?: boolean }) -> {
//   setState(PenState), emit(PenEvent), resize(), destroy()
// }
```

`spawn` makes the parent fire a "baby" critter that pops into existence; `done`
triggers a little celebration before going idle.

Either side may propose additions to the contract; change `engine/contract.js` and
`DESIGN.md` together and tell the other side.

## Data sources (adapter)

Investigate what the client-side board graph exposes; known useful fields include
session status, links (`pr`, `jira`), task membership, spawn lineage, checklist
progress and PR check status. Per-tool activity (bash/edit/web) may not be in the
graph — if not, find the cheapest honest source (e.g. a server-side extension that
watches transcripts and broadcasts via `board:broadcast`) and propose it rather than
faking events.

Reference: `../agent-wrangler/docs/extensions.md`, `../agent-wrangler/public/slots.js`,
builtin extensions under `../agent-wrangler/server/extensions/builtin/` (sounds and
checklist are good small examples).

## Milestones

1. Engine demo page with critters in every state + all projectile kinds (fake data).
2. Extension installs locally, `view` shows real sessions with correct status.
3. Real activity events from links / PR status / tool use.
4. `board.tray` mini-pen, reduced-motion polish, theme check across all themes.
