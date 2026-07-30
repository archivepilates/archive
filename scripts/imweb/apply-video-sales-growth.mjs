import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const APPLY = process.argv.includes("--apply");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const IMWEB = "/Users/archivepilates/.local/bin/imweb";
const UNIT_CODE = "u2026051698c99ea234719";
const SITE_CODE = "S20260516852c71a014d08";
const MARKER = "data-archive-pilates-video-sales-growth";
const INSTALLER = fs
  .readFileSync(path.join(ROOT, "scripts/imweb/install-video-sales-growth.html"), "utf8")
  .trim();

function run(args, input) {
  const result = spawnSync(IMWEB, args, {
    cwd: ROOT,
    encoding: "utf8",
    input,
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `imweb command failed: ${args.join(" ")}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`imweb command did not return JSON: ${args.join(" ")}`);
  }
}

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function replaceMarkedScript(content) {
  const escaped = MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<script\\b[^>]*\\b${escaped}="[^"]+"[^>]*>[\\s\\S]*?<\\/script>\\s*`,
    "g"
  );
  const matches = content.match(pattern) || [];
  if (matches.length > 1) throw new Error(`found ${matches.length} ${MARKER} scripts`);
  if (matches.length === 1) return content.replace(pattern, INSTALLER + "\n\n");
  return content.trimEnd() + "\n\n" + INSTALLER + "\n";
}

const context = run(["--output", "json", "config", "context"]);
const contextText = JSON.stringify(context);
if (!contextText.includes(SITE_CODE) || !contextText.includes(UNIT_CODE)) {
  throw new Error("Imweb context does not match the ARCHIVE PILATES production site.");
}

const listing = run(["--output", "json", "script", "list", "--position", "header"]);
const rows = Array.isArray(listing.data) ? listing.data : [];
if (rows.length !== 1 || rows[0].position !== "header") {
  throw new Error(`expected one header script, received ${rows.length}`);
}

const before = String(rows[0].scriptContent || "");
if (!before.includes('data-archive-pilates-site-improvements="2026-07-28b"')) {
  throw new Error("current header is missing the active site-improvements loader");
}
const after = replaceMarkedScript(before);
if (!after.includes(`${MARKER}="2026-07-30b"`)) {
  throw new Error("prepared header is missing the video-sales loader");
}

const payload = JSON.stringify({
  unitCode: UNIT_CODE,
  position: "header",
  scriptContent: after
});
const dryRun = run(
  ["--output", "json", "script", "update", "--dry-run", "--data", "@-"],
  payload
);
if (!dryRun.confirmation_token) throw new Error("Imweb dry-run returned no confirmation token.");

const summary = {
  apply: APPLY,
  siteCode: SITE_CODE,
  unitCode: UNIT_CODE,
  position: "header",
  before: { length: before.length, sha256: sha256(before) },
  after: { length: after.length, sha256: sha256(after) },
  changed: before !== after
};

if (!APPLY) {
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
  process.exit(0);
}

const backupDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "archive-imweb-video-sales-"));
fs.writeFileSync(path.join(backupDirectory, "header-before.html"), before);
fs.writeFileSync(path.join(backupDirectory, "header-after.html"), after);

run(
  [
    "--output",
    "json",
    "script",
    "update",
    "--yes",
    "--confirm-token",
    dryRun.confirmation_token,
    "--data",
    "@-"
  ],
  payload
);

const verify = run(["--output", "json", "script", "list", "--position", "header"]);
const saved = String((verify.data || [])[0]?.scriptContent || "");
if (saved !== after) throw new Error("saved Imweb header does not match the prepared header");

summary.backupDirectory = backupDirectory;
summary.saved = {
  exactMatch: true,
  length: saved.length,
  sha256: sha256(saved)
};
process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
