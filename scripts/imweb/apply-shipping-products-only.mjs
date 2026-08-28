import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const APPLY_REQUESTED = process.argv.includes("--apply");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const IMWEB = "/Users/archivepilates/.local/bin/imweb";
const UNIT_CODE = "u2026051698c99ea234719";
const SITE_CODE = "S20260516852c71a014d08";
const MARKER = "data-archive-pilates-shipping-products-only";
const INSTALLER = fs
  .readFileSync(path.join(ROOT, "scripts/imweb/install-shipping-products-only.html"), "utf8")
  .trim();

if (APPLY_REQUESTED) {
  throw new Error(
    "CLI apply is disabled: the live installer is stored in Imweb's normal Header Code field, which this command does not read back."
  );
}

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
if (!after.includes(`${MARKER}="2026-08-28c"`)) {
  throw new Error("prepared header is missing the shipping-products-only script");
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
  apply: false,
  mode: "read-only comparison",
  liveField: "Imweb admin normal Header Code",
  siteCode: SITE_CODE,
  unitCode: UNIT_CODE,
  position: "header",
  before: { length: before.length, sha256: sha256(before) },
  after: { length: after.length, sha256: sha256(after) },
  changed: before !== after
};
process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
