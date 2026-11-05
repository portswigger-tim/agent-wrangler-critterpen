// Real-shaped board cards, copied from a live Agent Wrangler graph (status
// fields only: no paths, prompts or costs; ids shortened). Every 'idle' here
// meant something different on the human's board, which is why idle is split.
//
//   orchestrator   live, at its prompt, a completed sub-agent, children below
//   job            idle + a background shell still running (board: green JOB)
//   childIdle      a spawned child, live at its prompt, quiet for hours
//   childQuiet     a spawned child, live, quiet for 81 minutes
//   dormant        no live pane: the board offers Resume
//   dormantSub     no live pane, with a completed sub-agent

import { NOW } from './fixtures.js';

const MIN = 60_000;
const live = {
  status: 'idle',
  rawStatus: null,
  hasBackgroundShell: false,
  waitingFor: null,
  managed: true,
  restarting: false,
  snooze: null,
  parentSession: null,
  spawnedBy: null,
  teammates: [],
  links: [],
  agent: 'claude',
};

export const orchestrator = {
  ...live,
  sessionId: '0069b540',
  label: 'Safer runner orchestration',
  lastActivity: NOW - 7 * MIN,
  subAgents: [{ kind: 'background', status: 'completed' }],
};
export const job = {
  ...live,
  sessionId: '69fff775',
  label: 'L7 mitmproxy egress spike',
  hasBackgroundShell: true,
  spawnedBy: '0069b540',
  lastActivity: NOW - 1 * MIN,
  subAgents: [],
};
export const childIdle = {
  ...live,
  sessionId: '6159bca6',
  label: 'Ubuntu 26.04 support',
  spawnedBy: '0069b540',
  lastActivity: NOW - 324 * MIN,
  subAgents: [],
};
export const childQuiet = {
  ...live,
  sessionId: 'db362dd0',
  label: 'Security critique',
  spawnedBy: '0069b540',
  lastActivity: NOW - 81 * MIN,
  subAgents: [],
};
export const dormant = {
  ...live,
  sessionId: '3ccee247',
  label: 'Review PR #2',
  managed: false,
  dormant: true,
  spawnedBy: '0069b540',
  lastActivity: NOW - 1438 * MIN,
  subAgents: [],
};
export const dormantSub = {
  ...live,
  sessionId: 'c8e23b4d',
  label: 'Node 24 runtime migration',
  managed: false,
  dormant: true,
  spawnedBy: '0069b540',
  lastActivity: NOW - 1438 * MIN,
  subAgents: [{ kind: 'background', status: 'completed' }],
};

export const all = [orchestrator, job, childIdle, childQuiet, dormant, dormantSub];
