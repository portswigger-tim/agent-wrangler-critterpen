# Activity feed: where critters' projectiles come from

## The gap

The board graph tells the adapter a session's **status**, its **links** (PR, Jira),
PR **check status**, task and parent. That covers `pr`, `jira`, `error`, `human`,
`spawn` and `done` (see `public/adapter/events.js`).

It says nothing about **what a session is doing**: there is no per-tool signal
(shell command, file edit, web fetch, git operation) anywhere an extension can
reach:

- `graph.sessions[]` carries `status`, `rawStatus` (`shell` while a Bash tool
  runs) and `lastActivity` (newest transcript line). Those are timestamps and
  flags, not tool names.
- `host.sessions` (`sessions:read`) projects the mapping entry and deliberately
  leaves out the live conversation id (`server/host-api/project.js`), so an
  extension cannot ask core where a card's transcript is.
- `host.events` has no core tool event, and core is not changing for this.

## Design: a transcript sweep in the extension

The server half of this extension (`server/`, wired in `index.js`) runs a sweep
every 2 s using only today's host API:

1. **Which cards.** `host.sessions.list()` gives each active card's `sessionId`,
   `agent` and `cwd`. Only `agent: 'claude'` cards are watched; Codex can come
   later.
2. **Which transcript.** Claude writes a session's transcript to
   `~/.claude/projects/<slug>/<conversation>.jsonl`, where `<slug>` is the cwd
   with every character outside `[A-Za-z0-9]` replaced by `-`. A slug over 200
   characters is cut to 200 and gets `-` plus the base-36 Java-style string hash of the
   cwd, which worktree paths reach easily. `$CLAUDE_CONFIG_DIR` replaces `~/.claude`
   when it's set. The newest `.jsonl` in that
   folder is the card's live conversation, including after a resume, which
   starts a new file.
3. **Honest attribution.** If two active cards share a cwd, which happens
   whenever sessions are not in their own worktree, the transcript could belong
   to either, so that cwd is **skipped**: no event beats an event on the wrong
   critter. Each line's own `cwd` must also equal the card's cwd, which guards
   against two cwds that map to the same slug.
4. **Incremental and bounded.** Each file is read from a remembered byte offset.
   A file seen for the first time starts at its end, so history is never
   replayed. At most 256 KB is read per file per tick. A file that has run more
   than 1 MB ahead jumps to its tail. A partial last line is carried over to the
   next tick, but never past 1 MB. State is one small record per watched file,
   and it is pruned when the card leaves.
5. **Classify, never forward.** Each `tool_use` block becomes at most one
   `{ kind, label }` (`server/classify.js`):

   | Tool | Kind | Label |
   | --- | --- | --- |
   | `Bash` with a `git <op>` segment | `git` | `git <op>` from a fixed list, else `git` |
   | `Bash` with `gh pr <op>` | `pr` | `gh pr <op>` from a fixed list |
   | `Bash` with `curl`/`wget`/`http` | `web` | the program name |
   | other `Bash` | `terminal` | program name if on a fixed allowlist, else none |
   | `Edit`, `MultiEdit`, `Write`, `NotebookEdit` | `files` | tool name |
   | `WebFetch`, `WebSearch` | `web` | tool name |
   | Jira MCP tools (`mcp__*atlassian*`/`*jira*`, tool name containing `Jira`) | `jira` | issue key if it matches `^[A-Z][A-Z0-9]+-\d+$`, else `Jira` |

   Read-only tools (`Read`, `Grep`, `Glob`, ...) fire nothing, to keep the pen calm.
   The Bash command text is parsed only to pick a label out of a fixed vocabulary.
   **Command text, arguments, file paths, URLs and tool output are never put in
   the payload**, because command lines carry tokens and the board is shared.
   Tests feed a Bash line that contains a fake secret and assert that it does not
   reach the broadcast.
6. **Broadcast.** Events go out with `host.broadcast` (`board:broadcast`). The
   frame is `{ type: 'ext:critter-pen', kind: 'activity', events: [{ sessionId,
   kind, label? }] }`, with at most 8 events per card per tick (the newest are
   kept). The client re-checks kind and label shape before emitting them as
   `PenEvent`s to the critters on the pen (`public/index.js`).
7. **Off means off.** The host stops the sweep when the extension is disabled.
   `deactivate` drops every offset, so turning it back on starts fresh from each
   file's end.

## What it costs

On each tick: one `readdir` and a few `stat`s per watched card, and a read of only
the new bytes. An idle board reads nothing. No hooks, no settings changes, and
nothing is written into users' repos or Claude config.

## Limits, stated honestly

- Cards that share a cwd get no tool activity. They still get every graph-derived
  event (status, links, checks, spawn, done).
- Activity lags by up to one sweep (about 2 s) plus Claude's own write delay.
- Codex sessions get no tool activity yet. Their rollout files
  (`~/.codex/sessions/**/rollout-*.jsonl`) carry `cwd` in `session_meta`, so the
  same design applies.
- The transcript layout is Claude Code's, not a public API. If it changes, the
  sweep quietly finds nothing, and the graph-derived events keep working.
