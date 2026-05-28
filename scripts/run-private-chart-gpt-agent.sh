#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCK_DIR="/Users/archivepilates/ArchiveIN/automation/locks/private-chart-gpt-agent.lock"
LOG_DIR="/Users/archivepilates/ArchiveIN/automation/logs"
PROMPT_FILE="$LOG_DIR/private-chart-gpt-agent-prompt.txt"
LAST_MESSAGE_FILE="$LOG_DIR/private-chart-gpt-agent-last-message.txt"

mkdir -p "$LOG_DIR" "$(dirname "$LOCK_DIR")"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "private chart GPT agent already running"
  exit 0
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

cd "$ROOT_DIR"
source "$ROOT_DIR/scripts/use-archivein-firebase-service-account.sh" >/dev/null

PENDING_COUNT="$(node "$ROOT_DIR/scripts/private-chart-gpt-queue.mjs" count)"
if [[ "${PENDING_COUNT:-0}" == "0" ]]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') no pending private chart GPT tasks"
  exit 0
fi

cat > "$PROMPT_FILE" <<'PROMPT'
You are the Mac mini background Codex agent for ARCHIVE PILATES private lesson chart drafts.

Task:
1. Run `node scripts/private-chart-gpt-queue.mjs claim --limit 5`.
2. If it returns an empty array, report "no pending tasks" and stop.
3. For each claimed task, read `promptBrief` and write:
   - `summary`: exactly 2 short Korean sentences for the member-facing lesson summary.
   - `nextDirection`: exactly 1 short Korean sentence for the next lesson direction.
4. Tone must be quiet, professional, warm, and minimal, matching ARCHIVE PILATES.
5. Do not expose phone numbers, medical details, diagnosis wording, pain details, internal judgment, or staff-only notes.
6. Complete each task by piping JSON to:
   `node scripts/private-chart-gpt-queue.mjs complete`
   Example:
   `printf '%s' '{"taskId":"...","summary":"...","nextDirection":"..."}' | node scripts/private-chart-gpt-queue.mjs complete`
7. If one task cannot be completed, pipe JSON to:
   `node scripts/private-chart-gpt-queue.mjs fail`
   with `taskId` and `error`, then continue to the next task.

Operating rules:
- Do not edit files.
- Do not commit, push, deploy, or change LaunchAgents.
- Use the existing Firebase service-account environment.
- Final response should be a concise processing summary.
PROMPT

codex exec \
  --cd "$ROOT_DIR" \
  --sandbox danger-full-access \
  --full-auto \
  --output-last-message "$LAST_MESSAGE_FILE" \
  "$(cat "$PROMPT_FILE")"
