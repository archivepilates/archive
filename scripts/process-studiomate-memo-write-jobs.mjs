#!/usr/bin/env node
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createSign } from "node:crypto";
import { acquireStudioMateBrowserLock } from "./lib/studiomate-browser-lock.mjs";
import { ensureStudioMateLoggedIn } from "./lib/studiomate-login.mjs";

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
  operatorEmail: process.env.ARCHIVE_OPERATOR_EMAIL || "home@archivepilates.com",
  delegatedUser: process.env.GOOGLE_DELEGATED_USER || "home@archivepilates.com",
  googleCredentialsPath:
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    "/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json",
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

let releaseBrowserLock = null;
let context = null;
let capturedAuthorization = "";

try {
  releaseBrowserLock = await acquireStudioMateBrowserLock({ owner: "studiomate-memo-write-queue" });
  const { chromium } = await import("playwright");
  context = await chromium.launchPersistentContext(config.profileDir, { headless: config.headless });
  const page = await context.newPage();
  page.on("request", (request) => {
    if (!request.url().includes("api.studiomate.kr")) return;
    capturedAuthorization = request.headers().authorization || capturedAuthorization;
  });
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
      if (isMemberSignupMemoJob(data)) {
        item.status = "skipped";
        item.reason = "member_signup_profile_fields_use_dedicated_queue";
        result.skipped += 1;
        if (apply) {
          await ref.set(
            {
              status: "skipped",
              skipReason: "회원가입서 주소/생년월일/성별은 StudioMate 메모가 아니라 회원정보 쓰기 큐에서 처리합니다.",
              updatedAt: admin.firestore.Timestamp.now(),
            },
            { merge: true },
          );
          await updateMemberMemoSyncStatus(data.jobId || ref.id, {
            syncStatus: "skipped",
            syncError: "회원가입서 정보는 메모 자동화에서 제외됨",
          });
        }
        result.jobs.push(item);
        continue;
      }
      if (!apply) {
        item.status = "dry-run";
        result.skipped += 1;
      } else {
        const writeResult = await writeMemo(page, data, capturedAuthorization);
        await ref.set(
          {
            status: "done",
            attempts: Number(data.attempts || 0) + 1,
            ...(writeResult.studiomateMemberId ? { studiomateMemberId: writeResult.studiomateMemberId } : {}),
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
        await markMemberIdLookupDone(data, writeResult.studiomateMemberId);
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
      if (status === "failed") {
        await sendMemoWriteFailureEmailOnce(ref, data, message);
      }
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
  await markLoadedJobsFailed(result.error);
  process.exitCode = 1;
} finally {
  result.finishedAt = new Date().toISOString();
  await writeFile(path.join(path.dirname(config.runLogPath), "last-studiomate-memo-write-result.json"), `${JSON.stringify(result, null, 2)}\n`);
  await appendFile(config.runLogPath, `${JSON.stringify(result)}\n`);
  console.log(JSON.stringify(result, null, 2));
  if (context) await context.close();
  if (releaseBrowserLock) await releaseBrowserLock();
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

async function markLoadedJobsFailed(message) {
  for (const { ref, data } of jobs) {
    const attempts = Number(data.attempts || 0) + 1;
    await ref.set(
      {
        status: "failed",
        attempts,
        lastError: message,
        updatedAt: admin.firestore.Timestamp.now(),
      },
      { merge: true },
    );
    await updateMemberMemoSyncStatus(data.jobId || ref.id, {
      syncStatus: "failed",
      syncError: message,
    });
    try {
      await sendMemoWriteFailureEmailOnce(ref, { ...data, attempts }, message);
    } catch (emailError) {
      result.error = `${message}; failure email failed: ${
        emailError instanceof Error ? emailError.message : String(emailError)
      }`;
    }
  }
}

async function sendMemoWriteFailureEmailOnce(ref, job, message) {
  const latest = (await ref.get()).data() || {};
  if (latest.failureEmailSentAt) return;
  const jobId = String(job.jobId || ref.id);
  const subject = `[ARCHIVE IN] StudioMate 메모쓰기 실패: ${job.memberName || jobId}`;
  const body = [
    "StudioMate 회원메모 쓰기 작업이 실패했습니다.",
    "",
    `작업ID: ${jobId}`,
    `회원: ${job.memberName || "-"}`,
    `회원ID: ${job.memberId || "-"}`,
    `수업일: ${job.lectureDate || "-"}`,
    `출처: ${job.source || "-"}`,
    `시도횟수: ${Number(latest.attempts || job.attempts || 0)}/${Number(latest.maxAttempts || job.maxAttempts || 3)}`,
    "",
    "오류:",
    message,
    "",
    "조치:",
    "StudioMate 로그인/회원 상세 화면의 메모 버튼 상태를 확인한 뒤 작업을 retry 상태로 되돌려 재시도하세요.",
  ].join("\n");
  await sendGmail({
    to: config.operatorEmail,
    subject,
    body,
  });
  await ref.set(
    {
      failureEmailSentAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
    },
    { merge: true },
  );
}

async function sendGmail({ to, subject, body }) {
  const accessToken = await googleAccessToken(["https://www.googleapis.com/auth/gmail.send"]);
  const raw = Buffer.from(
    [
      `From: ARCHIVE IN <${config.delegatedUser}>`,
      `To: ${to}`,
      `Subject: ${encodeMimeHeader(subject)}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      body,
    ].join("\r\n"),
  ).toString("base64url");
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });
  if (!response.ok) {
    throw new Error(`Gmail failure email send failed ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
}

async function googleAccessToken(scopes) {
  const key = JSON.parse(await readFile(config.googleCredentialsPath, "utf8"));
  const now = Math.floor(Date.now() / 1000);
  const assertion = signJwt(
    {
      alg: "RS256",
      typ: "JWT",
    },
    {
      iss: key.client_email,
      scope: scopes.join(" "),
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
      sub: config.delegatedUser,
    },
    key.private_key,
  );
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Google token failed ${response.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data.access_token;
}

function signJwt(header, payload, privateKey) {
  const input = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(input);
  signer.end();
  return `${input}.${signer.sign(privateKey, "base64url")}`;
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function encodeMimeHeader(value) {
  return `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;
}

async function writeMemo(page, job, authorization) {
  const memberId = String(job.memberId || "");
  const content = String(job.content || "");
  if (!memberId || !content) throw new Error("memberId/content is required");
  const studiomateMemberId = await resolveStudioMateMemberId(page, job);
  try {
    await writeMemoViaBrowserRequest(page, studiomateMemberId, content, authorization);
    return { studiomateMemberId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/403|비정상|abnormal/i.test(message)) throw error;
  }
  await writeMemoViaUi(page, studiomateMemberId, content);
  return { studiomateMemberId };
}

async function resolveStudioMateMemberId(page, job) {
  const current = String(job.studiomateMemberId || job.memberId || "");
  if (/^\d+$/.test(current)) return current;

  const phone = digitsOnly(job.memberPhone || "");
  const name = String(job.memberName || "").trim();
  const query = phone || name;
  if (!query) throw new Error("StudioMate member id lookup requires memberPhone or memberName.");

  await page.goto(new URL("/users", config.baseUrl).toString(), { waitUntil: "networkidle", timeout: 60000 });
  await assertLoggedIn(page);
  const search = page.locator('input[placeholder="이름 또는 전화번호로 검색"]').first();
  if (!(await search.isVisible().catch(() => false))) throw new Error("StudioMate member search input was not found.");
  await search.fill(query);
  await page.waitForTimeout(1200);

  const clicked = await clickSearchResult(page, { phone, name });
  if (!clicked) {
    throw new Error(`StudioMate member search result not found for ${name || "-"} ${phone || "-"}.`);
  }
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1000);

  const url = new URL(page.url());
  const resolved = url.searchParams.get("id") || "";
  if (!/^\d+$/.test(resolved)) {
    throw new Error(`StudioMate member search did not open a member detail page: ${page.url()}`);
  }
  return resolved;
}

async function markMemberIdLookupDone(job, studiomateMemberId) {
  const memberId = String(job.memberId || "");
  if (!memberId || !studiomateMemberId || !memberId.startsWith("excel_")) return;
  const now = admin.firestore.Timestamp.now();
  await Promise.all([
    db.collection("memberProfiles").doc(memberId).set(
      {
        studiomateMemberId,
        studiomateMemberIdResolvedAt: now,
        updatedAt: now,
      },
      { merge: true },
    ),
    db.collection("studiomateMemberIdLookupJobs").doc(`studiomate_member_id_lookup_${memberId}`).set(
      {
        jobId: `studiomate_member_id_lookup_${memberId}`,
        studioId: job.studioId || "5330",
        memberId,
        memberName: job.memberName || "",
        memberPhone: job.memberPhone || "",
        status: "done",
        attempts: admin.firestore.FieldValue.increment(1),
        studiomateMemberId,
        resolvedAt: now,
        updatedAt: now,
        lastError: null,
        source: "studiomate_memo_write_resolution",
      },
      { merge: true },
    ),
  ]);
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
  const beforeBody = await page.locator("body").innerText({ timeout: 10000 });
  if (bodyContainsMemoContent(beforeBody, content)) return;
  await page.getByText("메모 추가", { exact: true }).click({ timeout: 15000 });
  const textarea = page.locator("textarea").last();
  await textarea.fill(content, { timeout: 15000 });
  await page.getByText("저장", { exact: true }).last().click({ timeout: 15000 });
  await page.waitForTimeout(2500);
  const body = await page.locator("body").innerText({ timeout: 10000 });
  if (!bodyContainsMemoContent(body, content)) {
    throw new Error("StudioMate memo UI save did not show the expected content after save.");
  }
}

function bodyContainsMemoContent(body, content) {
  const normalizedBody = normalizeMemoText(body);
  const normalizedContent = normalizeMemoText(content);
  if (!normalizedContent) return false;
  const firstLine = normalizeMemoText(content.split("\n")[0] || "");
  const tail = normalizedContent.slice(-30);
  return Boolean(firstLine && normalizedBody.includes(firstLine) && tail && normalizedBody.includes(tail));
}

function isMemberSignupMemoJob(job) {
  const source = String(job.source || "");
  const content = String(job.content || "");
  return source === "member_signup_backfill" || content.includes("[ARCHIVE IN 회원가입서 제출]");
}

function normalizeMemoText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .trim();
}

async function clickSearchResult(page, { phone, name }) {
  const results = page.locator(".members .member");
  const count = await results.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const candidate = results.nth(index);
    if (!(await candidate.isVisible().catch(() => false))) continue;
    const text = await candidate.innerText().catch(() => "");
    const textPhone = digitsOnly(text);
    const matchesPhone = phone && textPhone.includes(phone.slice(-8));
    const matchesName = name && text.includes(name);
    if (matchesPhone || matchesName) {
      await candidate.click({ timeout: 5000 });
      return true;
    }
  }
  return false;
}

async function assertLoggedIn(page) {
  await ensureStudioMateLoggedIn(page, { headless: config.headless, waitForLogin: config.waitForLogin });
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

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}
