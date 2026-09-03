import { appendFileSync, existsSync, statSync, writeFileSync } from "node:fs";

export function appendIdleHeartbeatIfDue(filePath, payload, intervalMs) {
  if (!isDue(filePath, intervalMs)) return false;
  appendFileSync(filePath, `${JSON.stringify(payload)}\n`);
  return true;
}

export function writeIdleHeartbeatIfDue(filePath, payload, intervalMs) {
  if (!isDue(filePath, intervalMs)) return false;
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
  return true;
}

function isDue(filePath, intervalMs) {
  if (!existsSync(filePath)) return true;
  return Date.now() - statSync(filePath).mtimeMs >= intervalMs;
}
