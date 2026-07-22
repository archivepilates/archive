#!/bin/zsh
set -euo pipefail

ROOT="${ARCHIVE_SOURCE_REPO:-/Users/archivepilates/Documents/ARCHIVE-IN}"
WORKTREE_ROOT="/Users/archivepilates/codex-worktrees"
LAUNCH_AGENTS="/Users/archivepilates/Library/LaunchAgents"
LOCK_DIR="/Users/archivepilates/ArchiveIN/automation/locks/worktree-cleanup.lock"
LOG_DIR="/Users/archivepilates/ArchiveIN/automation/logs/worktree-cleanup"
RUN_DATE="$(date '+%Y-%m-%d')"
LOG_FILE="${LOG_DIR}/${RUN_DATE}.log"
APPLY="${WORKTREE_CLEANUP_APPLY:-0}"

mkdir -p "$LOG_DIR" "$(dirname "$LOCK_DIR")"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] another worktree cleanup is running" >> "$LOG_FILE"
  exit 0
fi

cleanup_lock() {
  rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup_lock EXIT

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

is_launchagent_runtime_path() {
  local wt="$1"
  [[ -d "$LAUNCH_AGENTS" ]] && grep -R -F -q "$wt" "$LAUNCH_AGENTS" 2>/dev/null
}

is_safe_playwright_cache() {
  local dir="$1"
  [[ -d "$dir" ]] || return 1
  local unsafe errors
  errors="$(mktemp)"
  if ! unsafe="$(find "$dir" -type f ! \( \
    -name '*.log' -o \
    -name '*.yml' -o \
    -name '*.yaml' -o \
    -name '*.json' -o \
    -name '*.png' -o \
    -name '*.jpg' -o \
    -name '*.jpeg' \
  \) -print -quit 2>"$errors")"; then
    log "keep inaccessible Playwright cache: $dir ($(head -1 "$errors"))"
    rm -f "$errors"
    return 1
  fi
  rm -f "$errors"
  [[ -z "$unsafe" ]]
}

log "daily worktree cleanup started mode=$([[ "$APPLY" == "1" ]] && echo apply || echo audit)"

if ! git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  log "failed: source repository is not accessible: $ROOT"
  exit 73
fi

if [[ "$APPLY" == "1" ]]; then
  git -C "$ROOT" worktree prune
fi

git -C "$ROOT" worktree list --porcelain | awk '/^worktree /{print substr($0,10)}' | while IFS= read -r wt; do
  [[ -n "$wt" ]] || continue

  if [[ "$wt" == "$ROOT" ]]; then
    log "keep runtime worktree: $wt"
    continue
  fi

  if [[ "$wt" != "$WORKTREE_ROOT/"* ]]; then
    log "keep non-codex worktree: $wt"
    continue
  fi

  if is_launchagent_runtime_path "$wt"; then
    log "keep LaunchAgent runtime path: $wt"
    continue
  fi

  if is_safe_playwright_cache "$wt/.playwright-cli"; then
    if [[ "$APPLY" == "1" ]]; then
      rm -rf "$wt/.playwright-cli"
      log "removed safe Playwright cache: $wt/.playwright-cli"
    else
      log "would remove safe Playwright cache: $wt/.playwright-cli"
    fi
  fi

  if [[ -n "$(git -C "$wt" status --porcelain 2>/dev/null || true)" ]]; then
    log "keep dirty worktree: $wt"
    continue
  fi

  upstream="$(git -C "$wt" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
  if [[ -z "$upstream" ]]; then
    log "keep no-upstream worktree: $wt"
    continue
  fi

  counts="$(git -C "$wt" rev-list --left-right --count "$upstream"...HEAD 2>/dev/null || true)"
  if [[ -z "$counts" ]]; then
    log "keep ambiguous-upstream worktree: $wt"
    continue
  fi

  behind="${counts%%$'\t'*}"
  ahead="${counts##*$'\t'}"
  if [[ "$ahead" != "0" ]]; then
    log "keep local-only worktree: $wt ahead=$ahead upstream=$upstream"
    continue
  fi

  if [[ "$APPLY" == "1" ]]; then
    git -C "$ROOT" worktree remove "$wt"
    log "removed clean pushed worktree: $wt behind=$behind upstream=$upstream"
  else
    log "would remove clean pushed worktree: $wt behind=$behind upstream=$upstream"
  fi
done

if [[ "$APPLY" == "1" ]]; then
  git -C "$ROOT" worktree prune
fi
log "remaining worktrees:"
git -C "$ROOT" worktree list | tee -a "$LOG_FILE"
log "daily worktree cleanup finished"
