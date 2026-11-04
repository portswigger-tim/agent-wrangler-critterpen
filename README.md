# agent-wrangler-workshop

Critter Pen: an [Agent Wrangler](https://github.com/portswigger-tim/agent-wrangler)
extension that shows every session as an animated critter. See [DESIGN.md](DESIGN.md)
for the product and the contract, and [docs/activity-feed.md](docs/activity-feed.md)
for where tool activity comes from.

## Layout

| Path | What |
| --- | --- |
| `package.json`, `index.js` | Extension declaration and manifest (`critter-pen`): the Critters `view`, the activity sweep |
| `public/index.js` | Browser entry: feeds each board graph through the adapter into the renderer |
| `public/adapter/` | Pure graph → `PenState` / `PenEvent[]` diffing (runs in the browser and under `node --test`) |
| `public/engine/` | The renderer (`pen.js`), built separately; `public/placeholder-pen.js` stands in until it is present |
| `server/` | The activity sweep: transcript tool use → classified events, broadcast to the browser |

## Local install and development

Develop against an **isolated** wrangler, never your real `~/.agent-wrangler`.

```bash
# 1. Copy the extension into a scratch data dir (the script refuses ~/.agent-wrangler).
export AW_DATA_DIR=/tmp/aw-critters
scripts/dev-install.sh

# 2. Start a second wrangler on that data dir and its own port, from your
#    agent-wrangler checkout.
cd ../agent-wrangler
AW_DEV=1 AW_DATA_DIR=/tmp/aw-critters AW_PORT=7991 node server/index.js
```

Open <http://localhost:7991>. **Critters** is on the rail, and the extension is listed
under Settings → Extensions → Installed.
Dispatch a session or two on that board to see critters. Sessions on your main board
don't show up there.

Hand-placed extensions load at boot, so after changing code, run
`scripts/dev-install.sh` again and restart the dev wrangler. There's no build step.

## Tests

```bash
npm test   # node --test: adapter, activity classifier and sweep
```

The contract tests validate the adapter's output with the engine's
`public/engine/contract.js` and are skipped when the engine is not present.
