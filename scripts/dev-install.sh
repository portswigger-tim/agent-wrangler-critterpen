#!/usr/bin/env bash
# Copy this extension into an ISOLATED Agent Wrangler data dir for local dev:
#   AW_DATA_DIR=/tmp/aw-critters scripts/dev-install.sh
# then (re)start that wrangler. Refuses the default ~/.agent-wrangler so a dev
# copy never lands in your real board.
set -euo pipefail
: "${AW_DATA_DIR:?set AW_DATA_DIR to an isolated wrangler data dir}"
data_dir="$(cd "$(dirname "$AW_DATA_DIR")" && pwd)/$(basename "$AW_DATA_DIR")"
if [ "$data_dir" = "$HOME/.agent-wrangler" ]; then
  echo "refusing to install into the default data dir ($data_dir); use an isolated AW_DATA_DIR" >&2
  exit 1
fi
src="$(cd "$(dirname "$0")/.." && pwd)"
dest="$data_dir/extensions/critter-pen"
mkdir -p "$dest"
rsync -a --delete --exclude .git --exclude node_modules --exclude '*.test.js' "$src/" "$dest/"
echo "installed critter-pen into $dest (restart the wrangler to load it)"
