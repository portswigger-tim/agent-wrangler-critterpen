// One transcript tool_use block → at most one { kind, label } for the pen.
//
// The rule that shapes everything here: a label is chosen FROM a fixed
// vocabulary (or a strict pattern), never copied out of the input. Bash command
// lines carry tokens, file paths and URLs, and the pen is drawn on a shared
// board, so the command text is only ever parsed to pick a word we already know.

const GIT_OPS = new Set([
  'add', 'branch', 'checkout', 'cherry-pick', 'clone', 'commit', 'diff', 'fetch', 'init', 'log', 'merge',
  'pull', 'push', 'rebase', 'reset', 'restore', 'revert', 'show', 'stash', 'status', 'switch', 'tag', 'worktree',
]);
// How outward-facing a git op is; ties keep the first on the line.
const GIT_RANK = { push: 3, commit: 2, merge: 1, rebase: 1, pull: 1, fetch: 1, clone: 1, checkout: 1, switch: 1, 'cherry-pick': 1, revert: 1, reset: 1, tag: 1 };
const gitRank = (op) => (op === null ? -1 : GIT_RANK[op] ?? 0);
const GH_PR_OPS = new Set(['checks', 'checkout', 'close', 'comment', 'create', 'diff', 'edit', 'list', 'merge', 'ready', 'review', 'status', 'view']);
const WEB_PROGRAMS = new Set(['curl', 'wget', 'http', 'https']);
const TERMINAL_PROGRAMS = new Set([
  'awk', 'bash', 'bun', 'cargo', 'cat', 'cp', 'deno', 'docker', 'find', 'gh', 'go', 'grep', 'head', 'jq', 'kubectl',
  'ls', 'make', 'mkdir', 'mv', 'node', 'npm', 'npx', 'pip', 'pnpm', 'pytest', 'python', 'python3', 'rg', 'rm',
  'rsync', 'sed', 'sh', 'sleep', 'sort', 'tail', 'terraform', 'tmux', 'touch', 'tsc', 'uv', 'wc', 'yarn', 'zsh',
]);
const FILE_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const WEB_TOOLS = new Set(['WebFetch', 'WebSearch']);
const JIRA_KEY = /^[A-Z][A-Z0-9]+-\d+$/;

// Words of one shell segment, quotes stripped. Good enough to find the program
// and its subcommand; nothing it returns is ever emitted as-is.
function words(segment) {
  return (segment.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []).map((w) => w.replace(/["']/g, ''));
}

// The program and remaining words of each simple command in a command line:
// split on control operators, skip leading env assignments and wrappers.
function commands(line) {
  const out = [];
  for (const segment of String(line).split(/&&|\|\||[;|\n()]/)) {
    const w = words(segment);
    while (w.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]) || ['sudo', 'time', 'env', 'exec', 'command', 'then', 'do', 'else'].includes(w[0]))) w.shift();
    if (!w.length) continue;
    out.push({ program: w[0].split('/').pop(), args: w.slice(1) });
  }
  return out;
}

// The first subcommand word after a program's options (`git -C dir push` → push).
function subcommand(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-C' || a === '-c' || a === '--git-dir' || a === '--work-tree' || a === '-R' || a === '--repo') { i++; continue; }
    if (a.startsWith('-')) continue;
    return a;
  }
  return null;
}

export function classifyBash(command) {
  const cmds = commands(command);
  // The most outward-facing thing the line does wins: git, then a PR, then the
  // web. Among git ops, `git add && git commit && git push` reads as the push.
  const gitOps = cmds.filter((c) => c.program === 'git').map((c) => subcommand(c.args)).map((op) => (GIT_OPS.has(op) ? op : null));
  if (gitOps.length) {
    const op = gitOps.reduce((best, o) => (gitRank(o) > gitRank(best) ? o : best));
    return { kind: 'git', label: op ? `git ${op}` : 'git' };
  }
  for (const { program, args } of cmds) {
    if (program !== 'gh' || subcommand(args) !== 'pr') continue;
    const op = subcommand(args.slice(args.indexOf('pr') + 1));
    return { kind: 'pr', label: GH_PR_OPS.has(op) ? `gh pr ${op}` : 'gh pr' };
  }
  for (const { program } of cmds) {
    if (WEB_PROGRAMS.has(program)) return { kind: 'web', label: program };
  }
  const first = cmds.find((c) => c.program !== 'cd');
  return first && TERMINAL_PROGRAMS.has(first.program) ? { kind: 'terminal', label: first.program } : { kind: 'terminal' };
}

function jiraKeyIn(input) {
  for (const k of ['issueIdOrKey', 'issueKey', 'key', 'issue']) {
    const v = input?.[k];
    if (typeof v === 'string' && JIRA_KEY.test(v)) return v;
  }
  return null;
}

export function classifyToolUse(name, input) {
  if (typeof name !== 'string') return null;
  if (name === 'Bash') return typeof input?.command === 'string' ? classifyBash(input.command) : { kind: 'terminal' };
  if (FILE_TOOLS.has(name)) return { kind: 'files', label: name };
  if (WEB_TOOLS.has(name)) return { kind: 'web', label: name };
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  if (mcp && /atlassian|jira/i.test(mcp[1]) && /jira/i.test(mcp[2])) return { kind: 'jira', label: jiraKeyIn(input) || 'Jira' };
  return null;
}

// Every tool_use in one parsed transcript line, classified. Only assistant
// messages carry tool_use blocks; sidechain (sub-agent) lines are the same
// session's work, so they count too.
export function classifyLine(entry) {
  const content = entry?.type === 'assistant' ? entry.message?.content : null;
  if (!Array.isArray(content)) return [];
  const out = [];
  for (const block of content) {
    if (block?.type !== 'tool_use') continue;
    const c = classifyToolUse(block.name, block.input);
    if (c) out.push(c);
  }
  return out;
}
