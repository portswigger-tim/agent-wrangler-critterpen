import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createActivitySweep, cwdSlug, watchableCards, READ_CAP, SKIP_AHEAD, MAX_EVENTS_PER_CARD } from './sweep.js';

const SECRET = 'ghp_FAKEFAKEFAKE0123456789secret';

let projects;
beforeEach(() => {
  projects = fs.mkdtempSync(path.join(os.tmpdir(), 'critter-sweep-'));
});
afterEach(() => {
  fs.rmSync(projects, { recursive: true, force: true });
});

const toolLine = (cwd, name, input) =>
  `${JSON.stringify({
    type: 'assistant',
    cwd,
    sessionId: 'live-uuid',
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_x', name, input }] },
  })}\n`;

function transcript(cwd, name = 'live-uuid.jsonl') {
  const dir = path.join(projects, cwdSlug(cwd));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, `${JSON.stringify({ type: 'user', cwd, message: { content: 'hi' } })}\n`);
  return file;
}

function fakeHost(sessions) {
  const sent = [];
  return { sent, host: { sessions: { list: () => sessions }, broadcast: (p) => sent.push(p) } };
}

// realpath is the identity here: temp paths are not what the test is about.
const sweepFor = () => createActivitySweep({ projectsDir: projects, realpath: async (p) => p });

test("cwdSlug matches Claude Code's project folder naming", () => {
  assert.equal(cwdSlug('/Users/a.b/.agent-wrangler/x_y'), '-Users-a-b--agent-wrangler-x-y');
});

test('cwdSlug shortens long paths the way Claude Code does (observed folder names)', () => {
  const base =
    '/private/tmp/claude-501/-Users-tim-birkett-Projects-portswigger-tim-worktrees-noindex-agent-wrangler-workshop-feat-critter-extension/157da3d0-327e-4857-ac8e-7b488535a280/scratchpad/aw-data/sessions/';
  const prefix =
    '-private-tmp-claude-501--Users-tim-birkett-Projects-portswigger-tim-worktrees-noindex-agent-wrangler-workshop-feat-critter-extension-157da3d0-327e-4857-ac8e-7b488535a280-scratchpad-aw-data-sessions-20';
  assert.equal(cwdSlug(`${base}20261104154405`), `${prefix}-uzxg9h`);
  assert.equal(cwdSlug(`${base}20261104154405-17`), `${prefix}-ae37vm`);
  assert.equal(cwdSlug(`${base}20261104154416`), `${prefix}-uzxgad`);
});

test('watchableCards keeps Claude cards with a cwd of their own', () => {
  assert.deepEqual(
    watchableCards([
      { sessionId: 'a', agent: 'claude', cwd: '/one' },
      { sessionId: 'b', agent: 'claude', cwd: '/shared' },
      { sessionId: 'c', agent: 'claude', cwd: '/shared' },
      { sessionId: 'd', agent: 'codex', cwd: '/two' },
      { sessionId: 'e', agent: 'claude', cwd: '/three', archived: true },
      { sessionId: 'f', agent: 'claude', cwd: null },
    ]),
    [{ sessionId: 'a', cwd: '/one' }],
  );
});

test('first sight starts at the end; new tool lines are broadcast as activity', async () => {
  const file = transcript('/repo');
  fs.appendFileSync(file, toolLine('/repo', 'Bash', { command: 'git push' })); // history: never replayed
  const sweep = sweepFor();
  const { sent, host } = fakeHost([{ sessionId: 'card-1', agent: 'claude', cwd: '/repo' }]);
  assert.deepEqual(await sweep.run({ host }), []);
  fs.appendFileSync(
    file,
    toolLine('/repo', 'Edit', { file_path: '/repo/a.js' }) + toolLine('/repo', 'Bash', { command: 'git commit -m x' }),
  );
  await sweep.run({ host });
  assert.deepEqual(sent, [
    {
      kind: 'activity',
      events: [
        { sessionId: 'card-1', kind: 'files', label: 'Edit' },
        { sessionId: 'card-1', kind: 'git', label: 'git commit' },
      ],
    },
  ]);
  await sweep.run({ host });
  assert.equal(sent.length, 1, 'nothing new, nothing sent');
});

test('a partial line waits for the rest of it', async () => {
  const file = transcript('/repo');
  const sweep = sweepFor();
  const { sent, host } = fakeHost([{ sessionId: 'c', agent: 'claude', cwd: '/repo' }]);
  await sweep.run({ host });
  const whole = toolLine('/repo', 'WebFetch', { url: 'https://x' });
  fs.appendFileSync(file, whole.slice(0, 20));
  await sweep.run({ host });
  assert.equal(sent.length, 0);
  fs.appendFileSync(file, whole.slice(20));
  await sweep.run({ host });
  assert.deepEqual(sent[0].events, [{ sessionId: 'c', kind: 'web', label: 'WebFetch' }]);
});

test('a secret in a Bash command never reaches the broadcast payload', async () => {
  const file = transcript('/repo');
  const sweep = sweepFor();
  const { sent, host } = fakeHost([{ sessionId: 'c', agent: 'claude', cwd: '/repo' }]);
  await sweep.run({ host });
  fs.appendFileSync(
    file,
    [
      toolLine('/repo', 'Bash', { command: `curl -H "Authorization: token ${SECRET}" https://api.github.com/user` }),
      toolLine('/repo', 'Bash', { command: `GH_TOKEN=${SECRET} gh pr create --title t` }),
      toolLine('/repo', 'Bash', { command: `git -c http.extraheader="AUTHORIZATION: ${SECRET}" push` }),
      toolLine('/repo', 'Bash', { command: `echo ${SECRET} > ~/.netrc` }),
    ].join(''),
  );
  await sweep.run({ host });
  const payload = JSON.stringify(sent);
  assert.ok(!payload.includes('FAKEFAKE'), payload);
  assert.ok(!payload.includes('github.com'), payload);
  assert.deepEqual(
    sent[0].events.map((e) => e.label),
    ['curl', 'gh pr create', 'git push', undefined],
  );
});

test('a cwd two cards share is skipped, however busy its transcript', async () => {
  const file = transcript('/shared');
  const sweep = sweepFor();
  const { sent, host } = fakeHost([
    { sessionId: 'a', agent: 'claude', cwd: '/shared' },
    { sessionId: 'b', agent: 'claude', cwd: '/shared' },
  ]);
  await sweep.run({ host });
  fs.appendFileSync(file, toolLine('/shared', 'Bash', { command: 'git push' }));
  await sweep.run({ host });
  assert.deepEqual(sent, []);
  assert.equal(sweep.watching, 0);
});

test("a transcript that started in another cwd is not the card's (lossy slugs)", async () => {
  // /a/b/c and /a/b-c share a project folder; this transcript began in /a/b/c.
  const dir = path.join(projects, cwdSlug('/a/b-c'));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'other.jsonl');
  fs.writeFileSync(file, `${JSON.stringify({ type: 'user', cwd: '/a/b/c', message: { content: 'hi' } })}\n`);
  const sweep = sweepFor();
  const { sent, host } = fakeHost([{ sessionId: 'c', agent: 'claude', cwd: '/a/b-c' }]);
  await sweep.run({ host });
  fs.appendFileSync(file, toolLine('/a/b/c', 'Bash', { command: 'git push' }));
  await sweep.run({ host });
  assert.deepEqual(sent, []);
});

test("lines written after the agent cd'd elsewhere still count", async () => {
  const file = transcript('/repo');
  const sweep = sweepFor();
  const { sent, host } = fakeHost([{ sessionId: 'c', agent: 'claude', cwd: '/repo' }]);
  await sweep.run({ host });
  fs.appendFileSync(
    file,
    toolLine('/repo/sub', 'Bash', { command: 'git commit -m x' }) + toolLine('/elsewhere', 'Write', {}),
  );
  await sweep.run({ host });
  assert.deepEqual(sent[0].events, [
    { sessionId: 'c', kind: 'git', label: 'git commit' },
    { sessionId: 'c', kind: 'files', label: 'Write' },
  ]);
});

test('a brand-new transcript with no cwd yet is looked at again next tick', async () => {
  const dir = path.join(projects, cwdSlug('/repo'));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'fresh.jsonl');
  fs.writeFileSync(file, `${JSON.stringify({ type: 'permission-mode', permissionMode: 'auto' })}\n`);
  const sweep = sweepFor();
  const { sent, host } = fakeHost([{ sessionId: 'c', agent: 'claude', cwd: '/repo' }]);
  await sweep.run({ host });
  assert.equal(sweep.watching, 0);
  fs.appendFileSync(file, `${JSON.stringify({ type: 'user', cwd: '/repo', message: { content: 'go' } })}\n`);
  await sweep.run({ host }); // first sight now: starts at the end
  fs.appendFileSync(file, toolLine('/repo', 'Edit', {}));
  await sweep.run({ host });
  assert.deepEqual(sent[0].events, [{ sessionId: 'c', kind: 'files', label: 'Edit' }]);
});

test('the newest transcript in the folder is the live one (a resume starts a new file)', async () => {
  const old = transcript('/repo', 'old.jsonl');
  const sweep = sweepFor();
  const { sent, host } = fakeHost([{ sessionId: 'c', agent: 'claude', cwd: '/repo' }]);
  await sweep.run({ host });
  const fresh = transcript('/repo', 'new.jsonl');
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(fresh, later, later);
  await sweep.run({ host }); // first sight of the new file
  fs.appendFileSync(fresh, toolLine('/repo', 'Edit', {}));
  fs.utimesSync(fresh, new Date(Date.now() + 6000), new Date(Date.now() + 6000));
  fs.appendFileSync(old, toolLine('/repo', 'Bash', { command: 'git push' }));
  await sweep.run({ host });
  assert.deepEqual(sent[0].events, [{ sessionId: 'c', kind: 'files', label: 'Edit' }]);
});

test('reads are capped per tick and a file far ahead jumps to its tail', async () => {
  const file = transcript('/repo');
  const sweep = sweepFor();
  const { sent, host } = fakeHost([{ sessionId: 'c', agent: 'claude', cwd: '/repo' }]);
  await sweep.run({ host });
  const filler = toolLine('/repo', 'Read', { file_path: 'x'.repeat(2000) });
  fs.appendFileSync(file, filler.repeat(Math.ceil((SKIP_AHEAD + READ_CAP) / filler.length)));
  fs.appendFileSync(file, toolLine('/repo', 'Write', {}));
  await sweep.run({ host });
  assert.deepEqual(sent[0].events, [{ sessionId: 'c', kind: 'files', label: 'Write' }]);
});

test('at most MAX_EVENTS_PER_CARD per card per tick, newest kept', async () => {
  const file = transcript('/repo');
  const sweep = sweepFor();
  const { sent, host } = fakeHost([{ sessionId: 'c', agent: 'claude', cwd: '/repo' }]);
  await sweep.run({ host });
  for (let i = 0; i < MAX_EVENTS_PER_CARD + 5; i++) fs.appendFileSync(file, toolLine('/repo', 'Edit', {}));
  fs.appendFileSync(file, toolLine('/repo', 'WebSearch', {}));
  await sweep.run({ host });
  assert.equal(sent[0].events.length, MAX_EVENTS_PER_CARD);
  assert.deepEqual(sent[0].events.at(-1), { sessionId: 'c', kind: 'web', label: 'WebSearch' });
});

test('state is dropped when a card leaves, and reset forgets everything', async () => {
  transcript('/repo');
  const sweep = sweepFor();
  const sessions = [{ sessionId: 'c', agent: 'claude', cwd: '/repo' }];
  const { host } = fakeHost(sessions);
  await sweep.run({ host });
  assert.equal(sweep.watching, 1);
  sessions.pop();
  await sweep.run({ host });
  assert.equal(sweep.watching, 0);
  sessions.push({ sessionId: 'c', agent: 'claude', cwd: '/repo' });
  await sweep.run({ host });
  sweep.reset();
  assert.equal(sweep.watching, 0);
});

test('a run that overlaps a slow one does nothing rather than read twice', async () => {
  const file = transcript('/repo');
  const sweep = sweepFor();
  const { sent, host } = fakeHost([{ sessionId: 'c', agent: 'claude', cwd: '/repo' }]);
  await sweep.run({ host });
  fs.appendFileSync(file, toolLine('/repo', 'Write', {}));
  const [a, b] = await Promise.all([sweep.run({ host }), sweep.run({ host })]);
  assert.deepEqual([a.length, b.length].sort(), [0, 1]);
  assert.equal(sent.length, 1);
});

test('a missing projects folder or transcript is quiet, not an error', async () => {
  const sweep = createActivitySweep({ projectsDir: path.join(projects, 'nope') });
  const { sent, host } = fakeHost([{ sessionId: 'c', agent: 'claude', cwd: '/does/not/exist' }]);
  assert.deepEqual(await sweep.run({ host }), []);
  assert.deepEqual(sent, []);
});
