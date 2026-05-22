#!/usr/bin/env node
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const limit = Number(valueArg("--limit") || process.env.STUDIOMATE_MEMO_WRITE_LIMIT || "10");
const jobId = valueArg("--job-id") || process.env.STUDIOMATE_MEMO_WRITE_JOB_ID || "";
const config = {
  projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "archive-pilates",
  baseUrl: process.env.STUDIOMATE_WEB_BASE_URL || "https://arcpilates.studiomate.kr",
  apiBaseUrl: process.env.STUDIOMATE_API_BASE_URL || "https://api.studiomate.kr",
  profileDir: expandHome(process.env.STUDIOMATE_EMERGENCY_PROFILE_DIR || "~/ArchiveIN/automation/browser-profile"),
  runLogPath: expandHome(process.env.STUDIOMATE_MEMO_WRITE_RUN_LOG || "~/ArchiveIN/emergency/runs/studiomate-memo-write.jsonl"),
  headless: process.env.HEADLESS !== "false",
  waitForLogin: process.env.WAIT_FOR_LOGIN === "true",
};

if (!admin.apps.length) admin.initializeApp({ projectId: config.projectId });
const db = admin.firestore();

const result = {
  ok: false,
  mode: apply ? "apply" : "dry-run",
  source: "studiomate_memo_playwright_queue",
  startedAt: new Date().toISOString(),
  processed: 0,
  written: 0,
  skipped: 0,
  failed: 0,
  jobId: jobId || null,
  jobs: [],
};

await mkdir(config.profileDir, { recursive: true });
await mkdir(path.dirname(config.runLogPath), { recursive: true });

const jobs = await loadPendingJobs(limit);
if (!jobs.length) {
  result.ok = true;
  result.finishedAt = new Date().toISOString();
  await appendFile(config.runLogPath, `${JSON.stringify(result)}\n`);
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

const { chromium } = await import("playwright");
const context = await chromium.launchPersistentContext(config.profileDir, { headless: config.headless });
const page = await context.newPage();
let capturedAuthorization = "";
page.on("request", (request) => {
  if (!request.url().includes("api.studiomate.kr")) return;
  capturedAuthorization = request.headers().authorization || capturedAuthorization;
});

try {
  await page.goto(new URL("/users", config.baseUrl).toString(), { waitUntil: "networkidle", timeout: 60000 });
  await assertLoggedIn(page);
  if (!capturedAuthorization) {
    await page.waitForTimeout(1500);
  }
  if (!capturedAuthorization) throw new Error("StudioMate browser authorization header was not captured.");

  for (const { ref, data } of jobs) {
    result.processed += 1;
    const item = { jobId: data.jobId || ref.id, memberName: data.memberName, status: "pending" };
    try {
      if (!apply) {
        item.status = "dry-run";
        result.skipped += 1;
      } else {
        await writeMemo(page, data, capturedAuthorization);
        await ref.set(
          {
            status: "done",
            attempts: Number(data.attempts || 0) + 1,
            writtenAt: admin.firestore.Timestamp.now(),
            lastError: null,
            updatedAt: admin.firestore.Timestamp.now(),
          },
          { merge: true },
        );
        await updateMemberMemoSyncStatus(data.jobId || ref.id, {
          syncStatus: "synced",
          syncedAt: admin.firestore.Timestamp.now(),
          syncError: null,
        });
        item.status = "done";
        result.written += 1;
      }
    } catch (error) {
      const attempts = Number(data.attempts || 0) + 1;
      const maxAttempts = Number(data.maxAttempts || 3);
      const message = error instanceof Error ? error.message : String(error);
      const status = attempts >= maxAttempts ? "failed" : "retry";
      await ref.set(
        {
          status,
          attempts,
          lastError: message,
          updatedAt: admin.firestore.Timestamp.now(),
        },
        { merge: true },
      );
      await updateMemberMemoSyncStatus(data.jobId || ref.id, {
        syncStatus: status,
        syncError: message,
      });
      item.status = status;
      item.error = message;
      result.failed += 1;
    }
    result.jobs.push(item);
  }
  result.ok = result.failed === 0;
} catch (error) {
  result.ok = false;
  result.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  result.finishedAt = new Date().toISOString();
  await writeFile(path.join(path.dirname(config.runLogPath), "last-studiomate-memo-write-result.json"), `${JSON.stringify(result, null, 2)}\n`);
  await appendFile(config.runLogPath, `${JSON.stringify(result)}\n`);
  console.log(JSON.stringify(result, null, 2));
  await context.close();
}

async function loadPendingJobs(max) {
  if (jobId) {
    const doc = await db.collection("studiomateMemoWriteJobs").doc(jobId).get();
    if (!doc.exists) return [];
    const data = doc.data();
    if (!["pending", "retry"].includes(String(data?.status || ""))) return [];
    return [{ ref: doc.ref, data }];
  }
  const snap = await db
    .collection("studiomateMemoWriteJobs")
    .where("status", "in", ["pending", "retry"])
    .limit(max)
    .get();
  return snap.docs.map((doc) => ({ ref: doc.ref, data: doc.data() }));
}

async function updateMemberMemoSyncStatus(memoId, patch) {
  if (!memoId) return;
  await db
    .collection("memberMemos")
    .doc(String(memoId))
    .set(
      {
        ...patch,
        updatedAt: admin.firestore.Timestamp.now(),
      },
      { merge: true },
    );
}

async function writeMemo(page, job, authorization) {
  const memberId = String(job.memberId || "");
  const content = String(job.content || "");
  if (!memberId || !content) throw new Error("memberId/content is required");
  try {
    await writeMemoViaBrowserRequest(page, memberId, content, authorization);
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/403|비정상|abnormal/i.test(message)) throw error;
  }
  await writeMemoViaUi(page, memberId, content);
}

async function writeMemoViaBrowserRequest(page, memberId, content, authorization) {
  const result = await page.evaluate(
    async ({ apiBaseUrl, authorization, memberId, content }) => {
      const response = await fetch(new URL("/v2/staff/memo", apiBaseUrl).toString(), {
        method: "POST",
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
          "web-version": "1.0.23",
        },
        body: JSON.stringify({ member_id: memberId, memo: content }),
      });
      return {
        ok: response.ok,
        status: response.status,
        text: (await response.text()).slice(0, 300),
      };
    },
    { apiBaseUrl: config.apiBaseUrl, authorization, memberId, content },
  );
  if (!result.ok) throw new Error(`StudioMate memo write failed ${result.status}: ${result.text}`);
}

async function writeMemoViaUi(page, memberId, content) {
  await page.goto(new URL(`/users/detail?id=${encodeURIComponent(memberId)}`, config.baseUrl).toString(), {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await page.getByText("메모 추가", { exact: true }).click({ timeout: 15000 });
  const textarea = page.locator("textarea").last();
  await textarea.fill(content, { timeout: 15000 });
  await page.getByText("저장", { exact: true }).last().click({ timeout: 15000 });
  await page.waitForTimeout(2500);
  const body = await page.locator("body").innerText({ timeout: 10000 });
  if (!body.includes(content.split("\n")[0]) || !body.includes(content.slice(-30))) {
    throw new Error("StudioMate memo UI save did not show the expected content after save.");
  }
}

async function assertLoggedIn(page) {
  const text = await page.locator("body").innerText({ timeout: 15000 }).catch(() => "");
  const hasPasswordInput = await page.locator('input[type="password"]').first().isVisible().catch(() => false);
  if (hasPasswordInput || (/로그인/.test(text) && /아이디|비밀번호|이메일|비번/.test(text))) {
    if (config.waitForLogin && !config.headless) {
      await waitForManualLogin(page);
      return;
    }
    throw new Error("StudioMate login required. Run HEADLESS=false WAIT_FOR_LOGIN=true node scripts/process-studiomate-memo-write-jobs.mjs, then log in manually.");
  }
  if (/captcha|보안문자|인증번호/i.test(text)) {
    throw new Error("StudioMate security/captcha/verification screen detected. Manual operator action required.");
  }
}

async function waitForManualLogin(page) {
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    if (/captcha|보안문자|인증번호/i.test(text)) throw new Error("StudioMate security screen detected.");
    if (!(await page.locator('input[type="password"]').first().isVisible().catch(() => false)) && /회원|수업|예약/.test(text)) return;
    await page.waitForTimeout(2000);
  }
  throw new Error("Timed out waiting for manual StudioMate login.");
}

function valueArg(name) {
  const prefix = `${name}=`;
  const inline = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1];
  return "";
}

function expandHome(value) {
  if (!value) return value;
  return value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
}
