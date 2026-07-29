#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLED_NODE="/Users/archivepilates/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
BUNDLED_MODULES="/Users/archivepilates/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules"

if [[ -x "${ARCHIVE_NODE_BIN:-$BUNDLED_NODE}" ]] &&
  [[ -d "${ARCHIVE_NODE_MODULES:-$BUNDLED_MODULES}/playwright" ]]; then
  ARCHIVE_NODE_MODULES="${ARCHIVE_NODE_MODULES:-$BUNDLED_MODULES}" \
    "${ARCHIVE_NODE_BIN:-$BUNDLED_NODE}" \
    "$ROOT/scripts/verify-video-sales-growth-ui.mjs"
  exit
fi

node "$ROOT/scripts/verify-video-sales-growth-ui.mjs"
