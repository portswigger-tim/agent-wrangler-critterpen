import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyBash, classifyToolUse, classifyLine } from './classify.js';

// A transcript line shaped like Claude Code's (one assistant content block per line).
const line = (name, input) => ({
  type: 'assistant',
  cwd: '/repo',
  message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name, input }] },
});

test('git operations come out as "git <op>" from a fixed list', () => {
  assert.deepEqual(classifyBash('git push -u origin feat-x'), { kind: 'git', label: 'git push' });
  assert.deepEqual(classifyBash('cd /some/where && git -C repo commit -m "wip"'), { kind: 'git', label: 'git commit' });
  assert.deepEqual(classifyBash('GIT_TRACE=1 git checkout -b x'), { kind: 'git', label: 'git checkout' });
  assert.deepEqual(classifyBash('git my-secret-alias'), { kind: 'git', label: 'git' });
});

test('git wins over everything else on the line', () => {
  assert.deepEqual(classifyBash('npm test && git commit -am x && gh pr create'), { kind: 'git', label: 'git commit' });
});

test('gh pr subcommands are pr', () => {
  assert.deepEqual(classifyBash('gh pr create --title "x" --body "y"'), { kind: 'pr', label: 'gh pr create' });
  assert.deepEqual(classifyBash('gh -R owner/repo pr checks 12'), { kind: 'pr', label: 'gh pr checks' });
  assert.deepEqual(classifyBash('gh pr frobnicate'), { kind: 'pr', label: 'gh pr' });
});

test('network programs are web; other programs are terminal, named only when allowlisted', () => {
  assert.deepEqual(classifyBash('curl -s https://example.com/x'), { kind: 'web', label: 'curl' });
  assert.deepEqual(classifyBash('cd /x && npm test 2>&1 | tail -5'), { kind: 'terminal', label: 'npm' });
  assert.deepEqual(classifyBash('./scripts/deploy-prod-with-key.sh --fast'), { kind: 'terminal' });
  assert.deepEqual(classifyBash('gh issue list'), { kind: 'terminal', label: 'gh' });
});

test('file-changing and web tools map to their landmark; read-only tools fire nothing', () => {
  assert.deepEqual(classifyToolUse('Edit', { file_path: '/secret/path.env' }), { kind: 'files', label: 'Edit' });
  assert.deepEqual(classifyToolUse('Write', { file_path: '/x' }), { kind: 'files', label: 'Write' });
  assert.deepEqual(classifyToolUse('WebFetch', { url: 'https://internal.example.com/?token=abc' }), { kind: 'web', label: 'WebFetch' });
  for (const t of ['Read', 'Grep', 'Glob', 'TodoWrite', 'mcp__agent-wrangler__list_sessions', undefined]) {
    assert.equal(classifyToolUse(t, {}), null, String(t));
  }
});

test('Jira MCP tools are jira, labelled with a strictly-shaped key only', () => {
  assert.deepEqual(classifyToolUse('mcp__claude_ai_Atlassian__getJiraIssue', { issueIdOrKey: 'PROJ-123' }), { kind: 'jira', label: 'PROJ-123' });
  assert.deepEqual(classifyToolUse('mcp__claude_ai_Atlassian__getJiraIssue', { issueIdOrKey: 'proj-123; rm -rf' }), { kind: 'jira', label: 'Jira' });
  assert.deepEqual(classifyToolUse('mcp__jira__searchJiraIssuesUsingJql', { jql: 'project = X' }), { kind: 'jira', label: 'Jira' });
  assert.equal(classifyToolUse('mcp__claude_ai_Atlassian__getConfluencePage', { pageId: '1' }), null);
});

test('classifyLine reads every tool_use of an assistant line and ignores the rest', () => {
  assert.deepEqual(classifyLine(line('Bash', { command: 'git status' })), [{ kind: 'git', label: 'git status' }]);
  assert.deepEqual(classifyLine({ type: 'user', message: { content: [{ type: 'tool_result', content: 'git push' }] } }), []);
  assert.deepEqual(classifyLine({ type: 'assistant', message: { content: 'plain text' } }), []);
  assert.deepEqual(classifyLine(null), []);
});

test('no part of a Bash command line ever reaches a label', () => {
  const secret = 'sk-live-FAKE0123456789SECRET';
  const commands = [
    `curl -H "Authorization: Bearer ${secret}" https://api.example.com/v1`,
    `git commit -m "${secret}"`,
    `git ${secret}`,
    `${secret}`,
    `TOKEN=${secret} npm publish`,
    `gh pr create --body ${secret}`,
    `gh pr ${secret}`,
  ];
  for (const command of commands) {
    const out = JSON.stringify(classifyLine(line('Bash', { command })));
    assert.ok(!out.includes('FAKE0123456789'), `${command} → ${out}`);
    assert.ok(!out.includes('example.com'), `${command} → ${out}`);
  }
});
