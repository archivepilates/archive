import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXPECTED_SITE_CODE = "S20260516852c71a014d08";
const TRACKER_VERSION = "2026-09-01.1";
const TRACKER_ATTRIBUTE = "data-archive-pilates-video-watch-tracker";
const TRACKER_ASSET_URL =
  "https://core.archivepilates.com/assets/imweb-video-watch-tracker-20260901.js?v=20260901a";
const IMWEB_CLI_BIN = process.env.IMWEB_CLI_BIN || "imweb";

export function mergeVideoWatchTracker(currentContent) {
  const wrapped = `<script ${TRACKER_ATTRIBUTE}="${TRACKER_VERSION}" src="${TRACKER_ASSET_URL}"></script>`;
  const pattern = new RegExp(
    `<script\\b[^>]*${TRACKER_ATTRIBUTE}=(?:"[^"]*"|'[^']*'|[^\\s>]+)[^>]*>[\\s\\S]*?<\\/script>\\s*`,
    "gi",
  );
  const withoutPrevious = String(currentContent || "").replace(pattern, "").trimEnd();
  return `${withoutPrevious}${withoutPrevious ? "\n" : ""}${wrapped}\n`;
}

export function countVideoWatchTrackers(content) {
  const pattern = new RegExp(`<script\\b[^>]*${TRACKER_ATTRIBUTE}=`, "gi");
  return (String(content || "").match(pattern) || []).length;
}

function runImwebRaw(args) {
  return execFileSync(IMWEB_CLI_BIN, ["--output", "json", ...args], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
    maxBuffer: 24 * 1024 * 1024,
  });
}

function runImweb(args) {
  return JSON.parse(runImwebRaw(args));
}

export function findConfirmToken(value) {
  if (!value || typeof value !== "object") return "";
  for (const [key, child] of Object.entries(value)) {
    if (["confirmation_token", "confirm_token", "confirmToken"].includes(key) && typeof child === "string") return child;
    const nested = findConfirmToken(child);
    if (nested) return nested;
  }
  return "";
}

function bodyScriptRecord(scriptList) {
  const records = Array.isArray(scriptList?.data) ? scriptList.data : [];
  const body = records.find((record) => record?.position === "body");
  if (!body || typeof body.scriptContent !== "string") {
    throw new Error("Current Imweb body script was not found.");
  }
  return body;
}

function decodeTruncatedScriptPrefix(rawOutput) {
  const marker = '"scriptContent": "';
  const start = rawOutput.indexOf(marker);
  if (start < 0) return "";
  let encoded = rawOutput.slice(start + marker.length);
  for (let trim = 0; trim < 24 && encoded; trim += 1) {
    try {
      return JSON.parse(`"${encoded}"`);
    } catch {
      encoded = encoded.slice(0, -1);
    }
  }
  return "";
}

function normalizeInterScriptWhitespace(value) {
  return String(value || "").trim().replace(/<\/script>\s*<script/gi, "</script><script");
}

async function readBodyScript() {
  const raw = runImwebRaw(["script", "list", "--position", "body"]);
  try {
    return { ...bodyScriptRecord(JSON.parse(raw)), source: "imweb-cli" };
  } catch {
    const truncatedPrefix = decodeTruncatedScriptPrefix(raw);
    if (!truncatedPrefix) throw new Error("Imweb body script response was truncated before it could be verified.");

    const response = await fetch("https://archivepilates.imweb.me/", {
      headers: { "User-Agent": "ARCHIVE-PILATES-video-watch-preflight/1.0" },
    });
    if (!response.ok) throw new Error(`Public Imweb readback failed with HTTP ${response.status}.`);
    const html = await response.text();
    const tags = [...html.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi)];
    const start = tags.findIndex((match) => match[0].includes("data-archive-pilates-home-copy-patch"));
    if (start < 0) throw new Error("Public Imweb body script start marker was not found.");

    const block = [];
    for (let index = start; index < tags.length; index += 1) {
      const tag = tags[index][0];
      const openingTag = tag.slice(0, tag.indexOf(">") + 1);
      if (!/(?:data-archive|data-ap-|data-ap\b)/i.test(openingTag)) break;
      block.push(tag);
    }
    const scriptContent = block.join("\n");
    const normalizedPrefix = normalizeInterScriptWhitespace(truncatedPrefix);
    const normalizedPublic = normalizeInterScriptWhitespace(scriptContent);
    if (block.length < 10 || normalizedPublic.length <= normalizedPrefix.length || !normalizedPublic.startsWith(normalizedPrefix)) {
      throw new Error("Public Imweb script block did not match the CLI response prefix.");
    }
    return { position: "body", scriptContent, source: "public-live-html-verified-prefix" };
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const context = runImweb(["config", "context"]);
  const siteCode = context?.resolved_profile?.site_code;
  const unitCode = context?.resolved_profile?.unit_code;
  if (siteCode !== EXPECTED_SITE_CODE || !unitCode) {
    throw new Error(`Unexpected Imweb target: ${siteCode || "missing site"}`);
  }

  const current = await readBodyScript();
  const scriptContent = mergeVideoWatchTracker(current.scriptContent);
  if (countVideoWatchTrackers(scriptContent) !== 1) {
    throw new Error("The prepared body script must contain exactly one video watch tracker.");
  }

  const baseSummary = {
    mode: apply ? "apply" : "dry-run",
    siteCode,
    unitCode,
    position: "body",
    trackerVersion: TRACKER_VERSION,
    trackerCount: countVideoWatchTrackers(scriptContent),
    currentLength: current.scriptContent.length,
    preparedLength: scriptContent.length,
    source: current.source,
    applyAllowed: current.source === "imweb-cli",
  };
  if (current.source !== "imweb-cli") {
    if (apply) {
      throw new Error("Imweb CLI truncated the current body script. Apply through the authenticated admin editor to preserve the full source.");
    }
    process.stdout.write(`${JSON.stringify({
      ...baseSummary,
      dryRunReady: false,
      blocker: "Imweb CLI truncates the current body script; use the authenticated admin editor for the live append.",
    }, null, 2)}\n`);
    return;
  }

  const temporaryPath = path.join(os.tmpdir(), `archive-pilates-video-watch-${process.pid}.json`);
  fs.writeFileSync(
    temporaryPath,
    JSON.stringify({ unitCode, position: "body", scriptContent }),
    { mode: 0o600 },
  );

  try {
    const dryRun = runImweb(["script", "update", "--dry-run", "--data", `@${temporaryPath}`]);
    const confirmToken = findConfirmToken(dryRun);
    const summary = { ...baseSummary, dryRunReady: Boolean(confirmToken) };
    if (!apply) {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
      return;
    }
    if (!confirmToken) throw new Error("Imweb dry-run did not return a confirmation token.");

    runImweb([
      "script",
      "update",
      "--yes",
      "--confirm-token",
      confirmToken,
      "--data",
      `@${temporaryPath}`,
    ]);
    const verified = bodyScriptRecord(runImweb(["script", "list", "--position", "body"]));
    const liveTrackerCount = countVideoWatchTrackers(verified.scriptContent);
    if (liveTrackerCount !== 1 || !verified.scriptContent.includes(`${TRACKER_ATTRIBUTE}="${TRACKER_VERSION}"`)) {
      throw new Error("Imweb readback could not verify the tracker marker.");
    }
    process.stdout.write(`${JSON.stringify({ ...summary, applied: true, liveTrackerCount }, null, 2)}\n`);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
