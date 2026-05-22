#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "archive-pilates";
const REGION = "asia-northeast3";
const SCHEDULER_JOB = "firebase-schedule-scheduledProcessContactSyncJobs-asia-northeast3";
const KEY_FILE =
  process.env.GOOGLE_APPLICATION_CREDENTIALS || "/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json";
const SERVICE_ACCOUNT = "archive-codex-operator@archive-pilates.iam.gserviceaccount.com";
const GCLOUD = process.env.GCLOUD_BIN || "/opt/homebrew/bin/gcloud";
const NODE = process.execPath;
const REPORT_DIR = path.join(os.homedir(), "ArchiveIN/automation/reports/emergency-contacts-sync");
const MAX_PROCESS_ITERATIONS = Number(process.env.EMERGENCY_CONTACTS_MAX_PROCESS_ITERATIONS || "40");
const PROCESS_WAIT_MS = Number(process.env.EMERGENCY_CONTACTS_PROCESS_WAIT_MS || "12000");

process.env.GOOGLE_APPLICATION_CREDENTIALS = KEY_FILE;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;

if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const steps = [];
let pausedAtEnd = false;

try {
  runRequired("auth", [
    GCLOUD,
    "auth",
    "activate-service-account",
    SERVICE_ACCOUNT,
    `--key-file=${KEY_FILE}`,
    `--project=${PROJECT_ID}`,
  ]);
  runRequired("setProject", [GCLOUD, "config", "set", "project", PROJECT_ID]);

  const importStep = runRequired("importMemberExcelAndQueueContacts", [
    NODE,
    "scripts/emergency-import-studiomate-member-excel.mjs",
    "--apply",
    "--queue-contact-sync",
  ]);

  runRequired("resumeContactScheduler", [
    GCLOUD,
    "scheduler",
    "jobs",
    "resume",
    SCHEDULER_JOB,
    `--location=${REGION}`,
    `--project=${PROJECT_ID}`,
  ]);

  const processing = await processContactQueue();
  runRequired("pauseContactScheduler", [
    GCLOUD,
    "scheduler",
    "jobs",
    "pause",
    SCHEDULER_JOB,
    `--location=${REGION}`,
    `--project=${PROJECT_ID}`,
  ]);
  pausedAtEnd = true;

  const latestJobs = await latestContactJobs();
  const summary = {
    ok: processing.openHomeJobs === 0,
    mode: "apply",
    source: "studiomate_excel_emergency_contacts_hourly",
    importSummary: importStep.stdout,
    processing,
    latestJobs,
    finishedAt: new Date().toISOString(),
  };
  writeReport(summary);
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exitCode = 1;
} catch (err) {
  const pauseResult = pausedAtEnd
    ? { skipped: "already paused" }
    : runOptional("pauseContactSchedulerAfterFailure", [
        GCLOUD,
        "scheduler",
        "jobs",
        "pause",
        SCHEDULER_JOB,
        `--location=${REGION}`,
        `--project=${PROJECT_ID}`,
      ]);
  const summary = {
    ok: false,
    mode: "apply",
    source: "studiomate_excel_emergency_contacts_hourly",
    error: err instanceof Error ? err.message : String(err),
    pauseResult,
    steps,
    finishedAt: new Date().toISOString(),
  };
  writeReport(summary);
  console.error(JSON.stringify(summary, null, 2));
  process.exitCode = 1;
}

async function processContactQueue() {
  const iterations = [];
  for (let index = 1; index <= MAX_PROCESS_ITERATIONS; index += 1) {
    const openHomeJobs = await countOpenHomeJobs();
    iterations.push({ index, openHomeJobs });
    if (openHomeJobs === 0) return { openHomeJobs, iterations };
    runRequired(`runContactScheduler:${index}`, [
      GCLOUD,
      "scheduler",
      "jobs",
      "run",
      SCHEDULER_JOB,
      `--location=${REGION}`,
      `--project=${PROJECT_ID}`,
    ]);
    await sleep(PROCESS_WAIT_MS);
  }
  return { openHomeJobs: await countOpenHomeJobs(), iterations };
}

async function countOpenHomeJobs() {
  const snap = await db
    .collection("contactSyncJobs")
    .where("target", "==", "home_archivepilates")
    .where("status", "in", ["pending", "retry", "processing"])
    .limit(500)
    .get();
  return snap.size;
}

async function latestContactJobs() {
  const snap = await db.collection("contactSyncJobs").orderBy("updatedAt", "desc").limit(10).get();
  return snap.docs.map((doc) => {
    const data = doc.data();
    return {
      jobId: doc.id,
      status: data.status || "",
      sourceReason: data.sourceReason || "",
      displayName: data.contactDisplayName || data.memberName || "",
      result: data.result?.action || null,
      updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() || null,
      lastError: data.lastError || null,
    };
  });
}

function runRequired(name, command) {
  const step = runCommand(name, command);
  if (step.exitCode !== 0) {
    throw new Error(`${name} failed: ${step.stderr || JSON.stringify(step.stdout)}`);
  }
  return step;
}

function runOptional(name, command) {
  try {
    return runCommand(name, command);
  } catch (err) {
    return { name, error: err instanceof Error ? err.message : String(err) };
  }
}

function runCommand(name, command) {
  const result = spawnSync(command[0], command.slice(1), {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      GOOGLE_APPLICATION_CREDENTIALS: KEY_FILE,
      GOOGLE_CLOUD_PROJECT: PROJECT_ID,
      GCLOUD_PROJECT: PROJECT_ID,
      TZ: "Asia/Seoul",
    },
    maxBuffer: 64 * 1024 * 1024,
  });
  const step = {
    name,
    command,
    exitCode: result.status ?? 0,
    stdout: parseJsonOrText(result.stdout),
    stderr: result.stderr.trim(),
  };
  steps.push(step);
  return step;
}

function parseJsonOrText(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function writeReport(summary) {
  mkdirSync(REPORT_DIR, { recursive: true });
  const file = `${new Date().toISOString().replace(/[:.]/g, "-")}-emergency-contacts-hourly-sync.json`;
  writeFileSync(path.join(REPORT_DIR, file), `${JSON.stringify(summary, null, 2)}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
