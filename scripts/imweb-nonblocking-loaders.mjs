import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { findConfirmToken } from "./prepare-imweb-video-watch-tracker.mjs";

export const LOADERS = Object.freeze({
  tracker: '<script data-archive-pilates-video-watch-tracker="2026-09-19.1" src="https://core.archivepilates.com/assets/imweb-video-watch-tracker-20260901.js?v=20260919a">',
  knitido: '<script src="https://archivepilates.com/assets/imweb-knitido-images-20260906.js">',
});

export function makeLoaderAsync(content, name) {
  if (typeof content !== "string" || !Object.hasOwn(LOADERS, name)) throw new Error("Unsupported loader input.");
  const before = LOADERS[name];
  const after = before.replace("<script ", "<script async ");
  const count = (value) => content.split(value).length - 1;
  if (count(before) + count(after) !== 1) throw new Error("Expected exactly one unchanged loader; inspect source drift.");
  return content.replace(before, after);
}

const digest = (value) => createHash("sha256").update(value).digest("hex");
export function executionBlocker(preflight) {
  const units = Number(preflight?.safety?.bulk_units);
  const limit = Number(preflight?.safety?.single_request_hard_limit);
  return Number.isFinite(units) && Number.isFinite(limit) && units > limit
    ? "CLI write unit limit exceeded; preserve the complete script and do not bypass the guard."
    : "";
}
function cli(args) {
  try {
    return JSON.parse(execFileSync("imweb", ["--output", "json", ...args], { encoding: "utf8", maxBuffer: 4e6 }));
  } catch (error) {
    const output = String(error.stdout || error.stderr || "");
    let detail;
    try { detail = JSON.parse(output); } catch { /* Do not print commands containing confirmation tokens. */ }
    throw new Error(JSON.stringify({ command: args.slice(0, 2).join(" "), code: detail?.error?.code || detail?.code, message: detail?.error?.message || detail?.message || "CLI failed; inspect the response without exposing tokens." }));
  }
}
function readBody() {
  const result = cli(["script", "list", "--position", "body"]);
  const body = result.data?.find((row) => row.position === "body")?.scriptContent;
  if (typeof body !== "string" || body.length < 50000) throw new Error("Complete body script unavailable; no write allowed.");
  return body;
}

async function main() {
  const context = cli(["config", "context"]).resolved_profile;
  if (context?.site_code !== "S20260516852c71a014d08" || context.unit_code !== "u2026051698c99ea234719") {
    throw new Error("Unexpected Imweb site or unit.");
  }
  const before = readBody();
  const after = makeLoaderAsync(before, "tracker");
  if (before === after) {
    console.log(JSON.stringify({ alreadyApplied: true, sha256: digest(after) }));
    return;
  }
  const payload = JSON.stringify({ unitCode: context.unit_code, position: "body", scriptContent: after });
  // Keep complete rollback material outside Git; never reconstruct a truncated script.
  const directory = path.join(os.homedir(), "Library/Application Support/ARCHIVE PILATES/imweb-nonblocking", new Date().toISOString().replaceAll(":", "-"));
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(directory, "body-before.txt"), before, { mode: 0o600 });
  const inputPath = path.join(directory, "body-after.json");
  fs.writeFileSync(inputPath, payload, { mode: 0o600 });
  const dryRun = cli(["script", "update", "--dry-run", "--data", `@${inputPath}`]);
  const token = findConfirmToken(dryRun);
  if (!token) throw new Error("No confirmation token; no write performed.");
  const blocker = executionBlocker(dryRun);
  const summary = { position: "body", beforeSha256: digest(before), afterSha256: digest(after), addedBytes: after.length - before.length, backupDirectory: directory, applyAllowed: !blocker, blocker };
  if (!process.argv.includes("--apply")) {
    console.log(JSON.stringify({ ...summary, dryRun: true }));
    return;
  }
  if (blocker) throw new Error(blocker);
  if (readBody() !== before) throw new Error("Body script changed during preparation; no write performed.");
  cli(["script", "update", "--yes", "--confirm-token", token, "--data", `@${inputPath}`]);
  if (readBody() !== after) throw new Error("Write result is uncertain; inspect live script before retrying.");
  console.log(JSON.stringify({ ...summary, applied: true, exactReadback: true }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
