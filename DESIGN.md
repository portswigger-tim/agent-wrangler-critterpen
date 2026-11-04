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
| `working` | `--green` | bouncy hop, squash & stretch, little dust puffs; wanders its island briskly |
| `thinking` (working, no tool for a while; or idle while a child it spawned is working) | `--blue` | slow bob, orbiting "…" dots; ambles slowly |
| `needs-you` (waiting on human / permission) | `--yellow`/amber | hops to the "you" bell on the mainland and waits there waving, "!" bubble; hops home when done |
| `error` / failed checks | `--red` | wobble, puff of smoke, dizzy stars; stays put |
| `finished` (finished a turn, you haven't looked yet) | green-grey | sits, looks out at you, small ✓ bubble |
| `idle` (awake at its prompt, nothing pending) | `--surface-2` grey-ish | awake and relaxed, eyes wandering, the odd slow stroll |
| `asleep` (no live terminal, snoozed, or quiet 30+ min) | dimmer grey | sleeps where it stands, "z z z", slow breathing |
| `archived` | — | waves goodbye, hops down to the mainland and walks off-screen |

Each critter: a sphere with two eyes (blink at random), optional tiny hat/accessory
derived deterministically from the session id so a session is recognisable over time,
name label underneath (session title, truncated). Agent type tints the eyes/accessory
(Claude vs Codex). Colours come from theme CSS variables so every wrangler theme works.

### Layout: floating islands

Each **task is a floating island**: a soft, organic blob of sage/straw-moss grass (kept
clearly away from status green, so working critters stand out) with a craggy earth
underside and dangling roots, bobbing gently in the sky. The task name hangs on a
wooden plank on the island's cliff face. Islands size themselves to their critter count
(`layout.islandSize`) and are packed across the sky with gaps between them
(`layout.packIslands`): new islands go to the roomiest free spot, overlaps are relaxed
apart, and every island remembers its previous spot (`anchors`, normalised to the sky)
so islands don't jump about as critters come and go or the pen resizes. If they don't
fit, everything shrinks a little. Sessions with no task get a small **rocky islet**.

Critters **wander** their own island in island-local coordinates (`wander.js`), so a
critter can never step off it: brisk strolls when working, slow ambles when thinking or
idle, and staying put when finished, asleep or in error. **Personal space**
(`PERSONAL_SPACE`, 2.5 radii between feet, with depth weighted at 0.75 so a hopping
front critter clears the one behind) keeps bodies apart while strolling and at rest:
home spots are relaxed apart in the layout too, so reduced motion and the first frame
are just as tidy.

**Size by role** (`layout.roleScales`): a critter with at least one child on the pen is
a *parent* at 1.35×, one whose parent is on the pen is a *child* at 0.8×, the rest are
1×; a child that is itself a parent is parent-sized. Parents take the home spot nearest
the island's middle and hold it (they yield little to personal-space pushes), their
children take the spots around them and stroll near them. Size eases on change; the
hit target scales with size, so parents are the easiest to click. Islands are sized by
the room their crowd needs (Σ scale²).

**Name labels** (`labels.js`) drop a leading copy of the task name (matched loosely)
and cut long names in the middle. They are placed above everything in priority order
(needs-you > finished > working > thinking > error > idle > asleep; parents first among
equals, in bolder type; then front-most), each trying under the feet, a line lower,
sideways or above the head, avoiding building captions and name planks; a label with no
clear spot fades to a whisper.

**Leashes** are a little rope (about 2.4px, earthy: light tan on dark themes, dark brown
on light, over a contrasting halo) from parent to child, drawn above the islands and
below the critters with a slight catenary sag, across islands too.

**Landmarks are small buildings on a mainland strip** along the bottom: Git is a tree
whose fruit are commits, PRs a mailbox (its flag pops up on delivery), Jira a post
office, Terminal a little forge with a smoking chimney, Web a lattice tower with a
balloon, Files a shed with paper stacked outside, and the **"you" bell** stands front
and centre. A critter that needs you hops over and queues by the bell, waving; the bell
glows softly while anyone waits (no count: another extension shows that). Projectiles:
git = little commit dots, PR = paper plane, Jira = ticket card, terminal = sparks,
files = paper scraps, web = tiny balloon. A building squashes and rings when hit.

Below 170px tall (the `board.tray` strip) the pen falls back to a single row of task
clusters with the buildings shrunk into a strip on the right.

Reduced motion: no bobbing, no wandering, no hops; critters are placed straight onto
their island spots or the bell queue.

## Architecture

Two independent pieces with one contract between them.

```
 ┌──────────────── Agent Wrangler board (browser) ────────────────┐
 │  graph ticks ──► adapter/ (graph → PenState + PenEvent[]) ──┐  │
 │                                                             ▼  │
 │                     engine/ (pure renderer, no wrangler deps)  │
 │                     mounted into the `view` slot (Critters)    │
 └────────────────────────────────────────────────────────────────┘
```

- **`public/engine/`** — framework-free ES module, Canvas 2D (or SVG if it stays fast).
  Knows nothing about Agent Wrangler. Ships a standalone `demo.html` driven by a fake
  event generator so it can be developed and shown off in any browser.
- **Extension (`index.js`, `package.json`, `public/`)** — the wrangler manifest and
  client entry. Registers a `view` contribution ("Critters" rail button). Adapter diffs
  successive board graphs into the contract below.

### Contract: `public/engine/contract.js`

```js
// Snapshot, applied on every graph tick (idempotent).
/** @typedef {{
 *   critters: Array<{
 *     id: string,            // session id, stable
 *     name: string,          // session title
 *     taskId: string, taskName: string,
 *     parentId?: string,     // spawned-by / nested parent
 *     agent: 'claude'|'codex'|string,
 *     status: 'working'|'thinking'|'needs-you'|'error'|'finished'|'idle'|'asleep'|'archived',
 *   }>
 * }} PenState */

// Discrete things that happened since the last tick (fire-and-forget animations).
/** @typedef {{
 *   critterId: string,
 *   kind: 'git'|'pr'|'jira'|'terminal'|'files'|'web'|'human'|'spawn'|'done'|'error',
 *   label?: string,          // e.g. "PROJ-123", "#482", "git push"
 * }} PenEvent */

// Engine API
// createPen(el, { theme?: 'auto', reducedMotion?: boolean, onCritterClick?: (id) => void }) -> {
//   setState(PenState), emit(PenEvent), resize(), destroy()
// }
// reducedMotion sets the starting mode; later prefers-reduced-motion changes always apply.
```

`spawn` makes the parent fire a "baby" critter that pops into existence; `done`
triggers a little celebration before going idle; `error` is a one-shot smoke puff
and wobble with no landmark (the persistent red comes from status `error`).

Either side may propose additions to the contract; change `public/engine/contract.js` and
`DESIGN.md` together and tell the other side.

## Data sources (adapter)

The adapter lives in `public/adapter/` (the wrangler serves an extension's browser
files only from its `public/`, so the engine is at `public/engine/` for the same
reason). A `view`'s `update(el, session, graph)` gets the board's wire graph:

| Critter field / status | Graph source |
| --- | --- |
| `id`, `name`, `agent` | `graph.sessions[].sessionId`, `.label`, `.agent` (`offBoard` cards skipped) |
| `taskId`, `taskName` | `graph.tasks.assignments[sessionId]` → `graph.tasks.tasks[].name`; none = `adhoc` / "Unassigned" |
| `parentId` | `.parentSession` (board nesting), else `.spawnedBy` (launch lineage); kept while an archived parent is still walking off, then omitted once the parent has left PenState (or when it is off-board / was never on the pen), so an orphan is never drawn as a child and a child resizes once, at the end |
| `needs-you` | `.status === 'needs-you'` (permission prompts, questions, API errors; reason in `.waitingFor`) |
| `working` | `.status === 'working'` with transcript activity in the last 20 s, or `.rawStatus === 'shell'` (a Bash tool running); or idle but still busy on its own: `.hasBackgroundShell` (the board's green JOB), a `subAgents[]` entry with `status: 'running'`, or a `teammates[]` entry that is `working` |
| `thinking` | `.status === 'working'` and `.lastActivity` older than 20 s; or "busy elsewhere": idle, but a child on the pen (its `parentSession`/`spawnedBy` points here) is working or thinking (one level) |
| `error` | not working/needs-you, and one of its own PR links has `checkStatus: 'failing'` (shown even on an asleep or finished card) |
| `asleep` | no live pane (`.dormant`, or `.managed === false`: the board offers Resume), snoozed (`.snooze.until` in the future), or live but quiet for 30 min (wakes on fresh activity, under 25 min, so `lastActivity` jitter cannot flicker it) |
| `finished` | live and idle after a working → idle turn the human has not looked at: cleared by clicking the critter, selecting the card on the board, the session leaving idle, or leaving the board. Kept per browser in the extension's own storage; never dozes off |
| `idle` | awake and relaxed: live, at its prompt, nothing pending. `unknown` reads idle only after 10 s (earlier it holds the previous look) |
| `archived` | the card left `graph.sessions`; it stays 8 s as `archived` for the walk-off |

Precedence: needs-you > working > thinking > error > asleep > finished > idle.
An engine whose contract does not list `asleep`/`finished` yet gets `idle` for both
(`forEngine` in `public/adapter/state.js`).

Graph-derived events (`public/adapter/events.js`, never on the first tick): new PR link
→ `pr` (`#123`), new Jira link → `jira` (key), PR checks turning failing → `error`, a
new card whose parent is on the pen → `spawn` from the parent, working → idle →
`done`, entering needs-you → `human`. Task-level links are pinned to the task's
working member, else its most recently active one.

Tool activity (`git`, `pr`, `terminal`, `files`, `web`, `jira`) is not in the graph.
It comes from the extension's own transcript sweep (`server/sweep.js`), described in
[docs/activity-feed.md](docs/activity-feed.md).

## Milestones

1. Engine demo page with critters in every state + all projectile kinds (fake data).
2. Extension installs locally, `view` shows real sessions with correct status.
3. Real activity events from links / PR status / tool use.
4. Reduced-motion polish, theme check across all themes.
