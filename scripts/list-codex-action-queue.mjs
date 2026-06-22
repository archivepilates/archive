#!/usr/bin/env node
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");

const HOME = os.homedir();
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "archive-pilates";
const KEY_FILE =
  process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(HOME, "ArchiveIN/secrets/google/archive-codex-operator.json");
const args = parseArgs(process.argv.slice(2));
const LIMIT = Number(args.limit || 20);
const INCLUDE_RESOLVED = Boolean(args.resolved);

process.env.GOOGLE_APPLICATION_CREDENTIALS = KEY_FILE;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;

if (!existsSync(KEY_FILE)) throw new Error(`Google credentials not found: ${KEY_FILE}`);
if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const rows = await loadQueue();
const output = {
  ok: true,
  projectId: PROJECT_ID,
  status: INCLUDE_RESOLVED ? "all" : "open/in_progress/blocked",
  count: rows.length,
  rows: rows.map(formatRow),
};

console.log(JSON.stringify(output, null, 2));

async function loadQueue() {
  let snap;
  if (INCLUDE_RESOLVED) {
    snap = await db.collection("codexActionQueue").orderBy("updatedAt", "desc").limit(LIMIT).get();
  } else {
    snap = await db.collection("codexActionQueue")
      .where("status", "in", ["open", "in_progress", "blocked"])
      .limit(LIMIT)
      .get();
  }
  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .sort(compareRows);
}

function formatRow(row) {
  return {
    id: row.id,
    status: row.status || "",
    priority: row.priority || "",
    area: row.area || "",
    title: row.title || "",
    cause: row.cause || "",
    suggestedAction: row.suggestedAction || "",
    sourceRunId: row.sourceRunId || "",
    sourceRefs: Array.isArray(row.sourceRefs) ? row.sourceRefs.slice(0, 5) : [],
    lastSeenAt: timestampText(row.lastSeenAt),
    updatedAt: timestampText(row.updatedAt),
  };
}

function compareRows(a, b) {
  const priority = { high: 0, normal: 1, low: 2 };
  const status = { open: 0, blocked: 1, in_progress: 2, resolved: 3 };
  return (priority[a.priority] ?? 9) - (priority[b.priority] ?? 9) ||
    (status[a.status] ?? 9) - (status[b.status] ?? 9) ||
    String(b.updatedAt?.toDate?.()?.toISOString?.() || b.updatedAt || "").localeCompare(String(a.updatedAt?.toDate?.()?.toISOString?.() || a.updatedAt || ""));
}

function timestampText(value) {
  if (!value) return "";
  if (value.toDate) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    if (arg.includes("=")) {
      const [key, ...rest] = arg.slice(2).split("=");
      parsed[key] = rest.join("=");
    } else if (argv[i + 1] && !argv[i + 1].startsWith("--")) {
      parsed[arg.slice(2)] = argv[++i];
    } else {
      parsed[arg.slice(2)] = true;
    }
  }
  return parsed;
}
