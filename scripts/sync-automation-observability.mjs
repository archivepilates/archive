#!/usr/bin/env node
import { createSign } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "archive-pilates";
const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || "(default)";
const SERVICE_ACCOUNT_PATH =
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  path.join(os.homedir(), "ArchiveIN/secrets/google/archive-codex-operator.json");
const CODEX_AUTOMATIONS_DIR = process.env.CODEX_AUTOMATIONS_DIR || path.join(os.homedir(), ".codex/automations");
const LAUNCH_AGENTS_DIR = process.env.LAUNCH_AGENTS_DIR || path.join(os.homedir(), "Library/LaunchAgents");
const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const includeDisabled = !args.has("--exclude-disabled");

const docs = [
  ...collectLaunchAgentDocs(),
  ...collectCodexAutomationDocs(),
].sort((a, b) => a.automationId.localeCompare(b.automationId));

if (apply) {
  const token = await accessToken();
  for (const doc of docs) await writeAutomationStatus(token, doc);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      mode: apply ? "apply" : "dry-run",
      projectId: PROJECT_ID,
      total: docs.length,
      summary: summarize(docs),
      docs,
    },
    null,
    2,
  ),
);

function collectLaunchAgentDocs() {
  const files = listFiles(LAUNCH_AGENTS_DIR)
    .filter((file) => path.basename(file).startsWith("com.archive."))
    .filter((file) => file.endsWith(".plist") || (includeDisabled && file.includes(".plist.disabled")));
  return files.map((file) => {
    const disabled = !file.endsWith(".plist");
    const plist = parsePlist(file);
    const label = plist.Label || path.basename(file).replace(/\.plist.*$/, "");
    const launch = disabled ? { loaded: false, state: "disabled", runs: 0, lastExitCode: "" } : inspectLaunchAgent(label);
    const stdoutPath = plist.StandardOutPath || "";
    const stderrPath = plist.StandardErrorPath || "";
    const logTime = latestMtime([stdoutPath, stderrPath]);
    const lastExitCode = launch.lastExitCode;
    const failed = lastExitCode !== "" && Number(lastExitCode) !== 0;
    const status = disabled ? "paused" : !launch.loaded ? "warning" : failed ? "failed" : "healthy";
    const lastError = failed ? tailText(stderrPath, 6) : "";
    return cleanDoc({
      automationId: docId(`launchagent-${label}`),
      title: label.replace(/^com\.archive\./, "").replaceAll("-", " "),
      ownerArea: ownerArea(label),
      status,
      runner: "LaunchAgent",
      source: "mac_mini_launchagent",
      enabled: !disabled && launch.loaded,
      schedule: scheduleText(plist),
      lastRunAt: logTime || "",
      checkedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastResult: disabled
        ? "LaunchAgent 파일이 disabled 상태입니다."
        : launch.loaded
          ? `launchd 등록됨 · runs ${launch.runs || 0} · exit ${lastExitCode === "" ? "unknown" : lastExitCode}`
          : "LaunchAgent 파일은 있으나 launchctl에 로드되어 있지 않습니다.",
      lastError,
      warnings: [
        !launch.loaded && !disabled ? "launchagent_not_loaded" : "",
        failed ? `last_exit_code_${lastExitCode}` : "",
      ].filter(Boolean),
      path: file,
      stdoutPath,
      stderrPath,
      runs: numberOrNull(launch.runs),
      lastExitCode: lastExitCode === "" ? null : Number(lastExitCode),
    });
  });
}

function collectCodexAutomationDocs() {
  return listFiles(CODEX_AUTOMATIONS_DIR)
    .filter((file) => path.basename(file) === "automation.toml")
    .map((file) => {
      const automation = parseSimpleToml(readFileSync(file, "utf8"));
      const status = String(automation.status || "UNKNOWN").toUpperCase();
      const active = status === "ACTIVE";
      return cleanDoc({
        automationId: docId(`codex-${automation.id || path.basename(path.dirname(file))}`),
        title: automation.name || automation.id || path.basename(path.dirname(file)),
        ownerArea: ownerArea(`${automation.id || ""} ${automation.name || ""} ${automation.prompt || ""}`),
        status: active ? "active" : status === "PAUSED" ? "paused" : "warning",
        runner: "Codex Automation",
        source: "codex_automation",
        enabled: active,
        schedule: automation.rrule || "",
        checkedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastResult: active
          ? "Codex 앱 자동화가 ACTIVE입니다. LaunchAgent와 중복 여부를 확인해야 합니다."
          : "Codex 앱 자동화가 PAUSED입니다.",
        warnings: active ? codexWarnings(automation) : [],
        path: file,
        kind: automation.kind || "",
        model: automation.model || "",
      });
    });
}

function parsePlist(file) {
  if (!existsSync(file)) return {};
  const result = spawnSync("plutil", ["-convert", "json", "-o", "-", file], { encoding: "utf8" });
  if (result.status !== 0) return {};
  try {
    return JSON.parse(result.stdout || "{}");
  } catch {
    return {};
  }
}

function inspectLaunchAgent(label) {
  const uid = String(process.getuid?.() || execFileSync("id", ["-u"], { encoding: "utf8" }).trim());
  const result = spawnSync("launchctl", ["print", `gui/${uid}/${label}`], { encoding: "utf8" });
  const text = `${result.stdout || ""}\n${result.stderr || ""}`;
  return {
    loaded: result.status === 0 && text.includes(`${label} = {`),
    state: firstMatch(text, /state = ([^\n]+)/),
    runs: firstMatch(text, /runs = (\d+)/),
    lastExitCode: firstMatch(text, /last exit code = (-?\d+)/),
  };
}

function scheduleText(plist) {
  if (plist.StartInterval) return `every ${plist.StartInterval}s`;
  if (plist.StartCalendarInterval) {
    const value = Array.isArray(plist.StartCalendarInterval) ? plist.StartCalendarInterval : [plist.StartCalendarInterval];
    return value.map((item) => calendarText(item)).join(", ");
  }
  if (plist.RunAtLoad && plist.KeepAlive) return "RunAtLoad + KeepAlive";
  if (plist.RunAtLoad) return "RunAtLoad";
  if (plist.KeepAlive) return "KeepAlive";
  return "";
}

function calendarText(item) {
  const parts = [];
  if (item.Weekday) parts.push(`weekday ${item.Weekday}`);
  if (item.Day) parts.push(`day ${item.Day}`);
  if (item.Hour !== undefined) parts.push(`${String(item.Hour).padStart(2, "0")}:${String(item.Minute || 0).padStart(2, "0")}`);
  return parts.join(" ") || JSON.stringify(item);
}

function parseSimpleToml(text) {
  const out = {};
  for (const line of text.split(/\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!match) continue;
    const [, key, raw] = match;
    out[key] = parseTomlValue(raw.trim());
  }
  return out;
}

function parseTomlValue(raw) {
  if (raw.startsWith('"')) return raw.replace(/^"|"$/g, "").replace(/\\"/g, '"').replace(/\\n/g, "\n");
  if (raw === "true") return true;
  if (raw === "false") return false;
  return raw;
}

function codexWarnings(automation) {
  const text = `${automation.id || ""} ${automation.name || ""} ${automation.prompt || ""}`.toLowerCase();
  const warnings = [];
  if (text.includes("launchagent")) warnings.push("codex_fallback_should_remain_paused_when_launchagent_active");
  if (text.includes("studiomate") || text.includes("excel") || text.includes("contacts")) warnings.push("check_launchagent_overlap");
  return warnings;
}

function ownerArea(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("smoke") || text.includes("e2e") || text.includes("integrity") || text.includes("시스템검증") || text.includes("정합성")) {
    return "system_check";
  }
  if (text.includes("youtube")) return "youtube";
  if (text.includes("studiomate") || text.includes("excel") || text.includes("reservation")) return "studiomate";
  if (text.includes("alimtalk") || text.includes("kakao")) return "alimtalk";
  if (text.includes("welcome") || text.includes("signup")) return "onsite_welcome";
  if (text.includes("settlement") || text.includes("dashboard") || text.includes("sales")) return "settlement";
  if (text.includes("private") || text.includes("chart")) return "private";
  if (text.includes("hohoyoga") || text.includes("imweb")) return "external";
  return "other";
}

function summarize(items) {
  return items.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    acc[`${item.runner}:${item.status}`] = (acc[`${item.runner}:${item.status}`] || 0) + 1;
    return acc;
  }, {});
}

async function accessToken() {
  if (existsSync(SERVICE_ACCOUNT_PATH)) return serviceAccountAccessToken(JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, "utf8")));
  return execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8" }).trim();
}

async function serviceAccountAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: "https://www.googleapis.com/auth/datastore",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const signature = createSign("RSA-SHA256").update(`${header}.${claim}`).sign(serviceAccount.private_key);
  const assertion = `${header}.${claim}.${base64url(signature)}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) throw new Error(`service account token failed ${response.status}: ${await response.text()}`);
  return (await response.json()).access_token;
}

async function writeAutomationStatus(token, doc) {
  const url = new URL(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${encodeURIComponent(DATABASE_ID)}/documents/automationStatus/${encodeURIComponent(doc.automationId)}`,
  );
  for (const key of Object.keys(doc)) url.searchParams.append("updateMask.fieldPaths", key);
  const response = await fetch(url, {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ fields: firestoreFields(doc) }),
  });
  if (!response.ok) throw new Error(`automationStatus write failed ${doc.automationId} ${response.status}: ${await response.text()}`);
}

function firestoreFields(doc) {
  return Object.fromEntries(Object.entries(doc).map(([key, value]) => [key, firestoreValue(value)]));
}

function firestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number" && Number.isFinite(value)) return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === "object") return { mapValue: { fields: firestoreFields(value) } };
  return { stringValue: String(value) };
}

function listFiles(dir) {
  try {
    return execFileSync("find", [dir, "-maxdepth", "3", "-type", "f"], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

function latestMtime(files) {
  const times = files
    .filter(Boolean)
    .filter((file) => existsSync(file))
    .map((file) => statSync(file).mtime)
    .sort((a, b) => b.getTime() - a.getTime());
  return times[0]?.toISOString() || "";
}

function tailText(file, lines = 4) {
  if (!file || !existsSync(file)) return "";
  const result = spawnSync("tail", ["-n", String(lines), file], { encoding: "utf8" });
  return sanitize(result.stdout || result.stderr || "");
}

function sanitize(value) {
  return String(value || "")
    .replace(/(token|secret|password|authorization|api[_-]?key)(\\s*[=:]\\s*)\\S+/gi, "$1$2[redacted]")
    .trim()
    .slice(0, 1000);
}

function firstMatch(text, regex) {
  return String(text || "").match(regex)?.[1]?.trim() || "";
}

function docId(value) {
  return String(value || "unknown").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120);
}

function cleanDoc(doc) {
  return Object.fromEntries(Object.entries(doc).filter(([, value]) => value !== undefined));
}

function numberOrNull(value) {
  if (value === "" || value === undefined || value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function base64url(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
