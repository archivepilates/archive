import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const APPLY_REQUESTED = process.argv.includes("--apply");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const IMWEB = "/Users/archivepilates/.local/bin/imweb";
const SITE_CODE = "S20260516852c71a014d08";
const UNIT_CODE = "u2026051698c99ea234719";
const MARKER = "data-archive-pilates-site-improvements-p1";
const VERSION = "2026-08-30d";
const ARTIFACT_DIR = path.join(ROOT, "artifacts", "imweb-site-improvements-20260830");
const INSTALLER = fs
  .readFileSync(path.join(ROOT, "scripts", "imweb", "install-site-improvements-p1.html"), "utf8")
  .trim();

if (APPLY_REQUESTED) {
  throw new Error(
    "CLI apply is disabled because the complete Imweb script set exceeds the local write safety limit. " +
      "Use the authenticated Imweb SEO common-code editor and verify the saved Header/Footer values instead."
  );
}

function run(args, input) {
  const result = spawnSync(IMWEB, args, {
    cwd: ROOT,
    encoding: "utf8",
    input,
    maxBuffer: 32 * 1024 * 1024
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

function optimizeKnitidoCards(content) {
  const before =
    `'<img src="'+p.img+'" alt="'+p.title+'" loading="eager" decoding="async">'+`;
  const after =
    `'<img src="'+p.img+'" alt="'+p.title+'" loading="lazy" decoding="async" fetchpriority="low" width="960" height="960">'+`;
  const beforeCount = content.split(before).length - 1;
  const afterCount = content.split(after).length - 1;
  if (beforeCount === 1 && afterCount === 0) return content.replace(before, after);
  if (beforeCount === 0 && afterCount === 1) return content;
  throw new Error(`unexpected Knitido image template state: eager=${beforeCount}, optimized=${afterCount}`);
}

function listScripts() {
  const listing = run(["--output", "json", "script", "list"]);
  const rows = Array.isArray(listing.data) ? listing.data : [];
  const byPosition = Object.fromEntries(rows.map((row) => [row.position, String(row.scriptContent || "")]));
  for (const position of ["header", "body", "footer"]) {
    if (!byPosition[position]) throw new Error(`missing live ${position} script`);
  }
  return byPosition;
}

function dryRunUpdate(position, content) {
  const payload = JSON.stringify({
    unitCode: UNIT_CODE,
    position,
    scriptContent: content
  });
  const dryRun = run(
    ["--output", "json", "script", "update", "--dry-run", "--data", "@-"],
    payload
  );
  if (!dryRun.confirmation_token) throw new Error(`${position} dry-run returned no confirmation token`);
  return { payload, dryRun };
}

const context = run(["--output", "json", "config", "context"]);
const contextText = JSON.stringify(context);
if (!contextText.includes(SITE_CODE) || !contextText.includes(UNIT_CODE)) {
  throw new Error("Imweb context does not match the ARCHIVE PILATES production site");
}

const before = listScripts();
const after = {
  ...before,
  header: replaceMarkedScript(before.header),
  footer: optimizeKnitidoCards(before.footer)
};

if (!after.header.includes(`${MARKER}="${VERSION}"`)) {
  throw new Error("prepared header is missing the P1 installer marker");
}
if (!after.footer.includes('loading="lazy" decoding="async" fetchpriority="low" width="960" height="960"')) {
  throw new Error("prepared footer is missing the optimized Knitido image template");
}

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
for (const position of ["header", "body", "footer"]) {
  fs.writeFileSync(path.join(ARTIFACT_DIR, `${position}-before.html`), before[position]);
  fs.writeFileSync(path.join(ARTIFACT_DIR, `${position}-after.html`), after[position]);
}

const prepared = {
  header: dryRunUpdate("header", after.header),
  footer: dryRunUpdate("footer", after.footer)
};

const summary = {
  apply: false,
  siteCode: SITE_CODE,
  unitCode: UNIT_CODE,
  version: VERSION,
  artifactDirectory: ARTIFACT_DIR,
  positions: Object.fromEntries(
    ["header", "body", "footer"].map((position) => [
      position,
      {
        before: { length: before[position].length, sha256: sha256(before[position]) },
        after: { length: after[position].length, sha256: sha256(after[position]) },
        changed: before[position] !== after[position]
      }
    ])
  )
};

fs.writeFileSync(path.join(ARTIFACT_DIR, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
