// Critter Pen: every board session as an animated critter. The browser half
// (public/index.js) draws the "Critters" view from the board graph.
//
// The server half (server/sweep.js) tails Claude transcripts for tool activity
// and broadcasts it to the browser half: see docs/activity-feed.md.
//
// Leaf-safe like every extension manifest: imports nothing from the wrangler,
// reaches it only through the capability-gated `host`.

import { createActivitySweep } from './server/sweep.js';

const activity = createActivitySweep();

export default {
  id: 'critter-pen',
  label: 'Critter Pen',
  description: 'Shows every session as an animated critter whose colour and antics are its status.',
  help: 'Adds a Critters view to the rail. Each session is a critter: green and hopping while it works, blue while it thinks, amber when it needs you, red when its PR checks fail, asleep when idle.',
  author: 'PortSwigger',
  requires: ['sessions:read', 'board:broadcast'],
  engines: { wranglerApi: '^1.35.0' },
  defaultEnabled: true,
  client: 'public/index.js',
  styles: 'public/styles.css',
  sweeps: [{ id: 'activity', everyMs: 2000, run: (ctx) => activity.run(ctx) }],
  // The host stops the sweep; forgetting every offset means turning the
  // extension back on starts from each transcript's end, not from stale state.
  deactivate: () => activity.reset(),
};
