// The activity sweep: tails each live Claude card's transcript and broadcasts
// what its tools did, classified (classify.js), to the browser half. Design and
// limits: docs/activity-feed.md.
//
// Uses only today's host API — `host.sessions.list()` (sessions:read) to find
// cards and `host.broadcast` (board:broadcast) to publish. The card → transcript
// link is the cwd: Claude keeps a session's transcript under
// <claude config>/projects/<cwd slug>/, and a cwd two cards share is skipped
// rather than guessed.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { classifyLine } from './classify.js';

export const READ_CAP = 256 * 1024; // bytes read per file per tick
export const SKIP_AHEAD = 1024 * 1024; // further behind than this jumps to the tail
export const MAX_LINE = 1024 * 1024; // a partial line longer than this is dropped
export const MAX_EVENTS_PER_CARD = 8; // per tick; the newest are kept

export function claudeProjectsDir(env = process.env) {
  return path.join(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
}

// Claude Code's project folder name for a cwd: every non-alphanumeric becomes
// '-', and a name over 200 characters is cut to 200 plus '-' and the base-36
// Java-style string hash of the cwd itself (worktree and session paths reach
// that length easily).
const MAX_SLUG = 200;
function javaHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}
export function cwdSlug(cwd) {
  const slug = cwd.replace(/[^A-Za-z0-9]/g, '-');
  return slug.length <= MAX_SLUG ? slug : `${slug.slice(0, MAX_SLUG)}-${Math.abs(javaHash(cwd)).toString(36)}`;
}

// Cards worth watching: live Claude cards whose cwd no other active card shares.
export function watchableCards(sessions) {
  const byCwd = new Map();
  for (const s of sessions || []) {
    if (!s?.sessionId || !s.cwd || s.archived) continue;
    if (!byCwd.has(s.cwd)) byCwd.set(s.cwd, []);
    byCwd.get(s.cwd).push(s);
  }
  const out = [];
  for (const [cwd, cards] of byCwd) {
    if (cards.length === 1 && (cards[0].agent ?? 'claude') === 'claude') out.push({ sessionId: cards[0].sessionId, cwd });
  }
  return out;
}

async function newestTranscript(dir) {
  let names;
  try { names = await fs.readdir(dir); } catch { return null; }
  let best = null;
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue;
    const file = path.join(dir, name);
    try {
      const st = await fs.stat(file);
      if (st.isFile() && (!best || st.mtimeMs > best.mtimeMs)) best = { file, size: st.size, mtimeMs: st.mtimeMs };
    } catch { /* vanished between readdir and stat */ }
  }
  return best;
}

async function readRange(file, start, length) {
  const fh = await fs.open(file, 'r');
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buf, 0, length, start);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

export function createActivitySweep({ projectsDir = claudeProjectsDir(), realpath = fs.realpath } = {}) {
  const tails = new Map(); // transcript path -> { offset, leftover, sessionId }

  // New complete lines of one transcript since the last tick.
  async function newLines(file, size, sessionId) {
    let t = tails.get(file);
    if (!t || t.sessionId !== sessionId) {
      // First sight: start at the end, so opening the board never replays history.
      tails.set(file, { offset: size, leftover: '', sessionId });
      return [];
    }
    if (size < t.offset) { t.offset = size; t.leftover = ''; return []; } // truncated/rewritten
    if (size - t.offset > SKIP_AHEAD) { t.offset = size - READ_CAP; t.leftover = ''; t.skipPartial = true; }
    if (size === t.offset) return [];
    const chunk = await readRange(file, t.offset, Math.min(READ_CAP, size - t.offset));
    t.offset += chunk.length;
    const lines = (t.leftover + chunk.toString('utf8')).split('\n');
    t.leftover = lines.pop();
    if (t.leftover.length > MAX_LINE) t.leftover = '';
    // After a jump the first "line" is the tail of one we never saw the start of.
    if (t.skipPartial) { lines.shift(); t.skipPartial = false; }
    return lines;
  }

  async function cardEvents(card) {
    const cwds = new Set([card.cwd]);
    try { cwds.add(await realpath(card.cwd)); } catch { /* cwd gone: the plain path is all we have */ }
    let found = null;
    for (const cwd of cwds) {
      const t = await newestTranscript(path.join(projectsDir, cwdSlug(cwd)));
      if (t && (!found || t.mtimeMs > found.mtimeMs)) found = t;
    }
    if (!found) return { file: null, events: [] };
    const events = [];
    for (const line of await newLines(found.file, found.size, card.sessionId)) {
      if (!line.trim()) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      // The slug is lossy (a/b-c and a/b/c share one); the line's own cwd is not.
      if (entry.cwd && !cwds.has(entry.cwd)) continue;
      for (const c of classifyLine(entry)) events.push(c.label ? { sessionId: card.sessionId, kind: c.kind, label: c.label } : { sessionId: card.sessionId, kind: c.kind });
    }
    return { file: found.file, events: events.slice(-MAX_EVENTS_PER_CARD) };
  }

  return {
    async run({ host }) {
      const cards = watchableCards(host.sessions.list());
      const live = new Set();
      const events = [];
      for (const card of cards) {
        try {
          const r = await cardEvents(card);
          if (r.file) live.add(r.file);
          events.push(...r.events);
        } catch { /* one unreadable transcript must not stop the others */ }
      }
      for (const file of tails.keys()) if (!live.has(file)) tails.delete(file);
      if (events.length) host.broadcast({ kind: 'activity', events });
      return events;
    },
    reset() { tails.clear(); },
    get watching() { return tails.size; },
  };
}
