#!/usr/bin/env node
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { acquireStudioMateBrowserLock } from "./lib/studiomate-browser-lock.mjs";
import { ensureStudioMateLoggedIn } from "./lib/studiomate-login.mjs";

const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const limit = Number(valueArg("--limit") || process.env.STUDIOMATE_PROFILE_WRITE_LIMIT || "10");
const jobId = valueArg("--job-id") || process.env.STUDIOMATE_PROFILE_WRITE_JOB_ID || "";
const config = {
  projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "archive-pilates",
  baseUrl: process.env.STUDIOMATE_WEB_BASE_URL || "https://arcpilates.studiomate.kr",
  profileDir: expandHome(process.env.STUDIOMATE_EMERGENCY_PROFILE_DIR || "~/ArchiveIN/automation/browser-profile"),
  runLogPath: expandHome(
    process.env.STUDIOMATE_PROFILE_WRITE_RUN_LOG || "~/ArchiveIN/emergency/runs/studiomate-profile-write.jsonl",
  ),
  headless: process.env.HEADLESS !== "false",
  waitForLogin: process.env.WAIT_FOR_LOGIN === "true",
};

if (!admin.apps.length) admin.initializeApp({ projectId: config.projectId });
const db = admin.firestore();

const result = {
  ok: false,
  mode: apply ? "apply" : "dry-run",
  source: "studiomate_member_profile_write_queue",
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

try {
  if (apply) {
    releaseBrowserLock = await acquireStudioMateBrowserLock({ owner: "studiomate-member-profile-write-queue" });
    const { chromium } = await importPlaywright();
    context = await chromium.launchPersistentContext(config.profileDir, { headless: config.headless });
  }

  for (const { ref, data } of jobs) {
    result.processed += 1;
    const item = { jobId: data.jobId || ref.id, memberName: data.memberName, status: "pending" };
    try {
      validateProfilePayload(data);
      if (!apply) {
        item.status = "dry-run";
        item.payload = data.payload || {};
        result.skipped += 1;
      } else {
        await ref.set(
          { status: "running", startedAt: admin.firestore.Timestamp.now(), updatedAt: admin.firestore.Timestamp.now() },
          { merge: true },
        );
        await updateContractProfileStatus(data.contractId, { profileWriteStatus: "running", profileWriteLastError: null });
        const page = await context.newPage();
        try {
          const writeResult = await writeProfileViaUi(page, data);
          await ref.set(
            {
              status: "done",
              attempts: Number(data.attempts || 0) + 1,
              studiomateMemberId: writeResult.studiomateMemberId,
              writtenAt: admin.firestore.Timestamp.now(),
              updatedAt: admin.firestore.Timestamp.now(),
              lastError: null,
            },
            { merge: true },
          );
          await updateContractProfileStatus(data.contractId, {
            profileWriteStatus: "done",
            profileWriteLastError: null,
          });
          item.status = "done";
          item.studiomateMemberId = writeResult.studiomateMemberId;
          result.written += 1;
        } finally {
          await page.close().catch(() => {});
        }
      }
    } catch (error) {
      const attempts = Number(data.attempts || 0) + 1;
      const maxAttempts = Number(data.maxAttempts || 3);
      const message = error instanceof Error ? error.message : String(error);
      const status = attempts >= maxAttempts ? "failed" : "retry";
      if (apply) {
        await ref.set(
          {
            status,
            attempts,
            lastError: message,
            updatedAt: admin.firestore.Timestamp.now(),
          },
          { merge: true },
        );
        await updateContractProfileStatus(data.contractId, {
          profileWriteStatus: status,
          profileWriteLastError: message,
        });
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
  process.exitCode = 1;
} finally {
  result.finishedAt = new Date().toISOString();
  await writeFile(
    path.join(path.dirname(config.runLogPath), "last-studiomate-profile-write-result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  await appendFile(config.runLogPath, `${JSON.stringify(result)}\n`);
  console.log(JSON.stringify(result, null, 2));
  if (context) await context.close();
  if (releaseBrowserLock) await releaseBrowserLock();
}

async function loadPendingJobs(max) {
  if (jobId) {
    const doc = await db.collection("studiomateMemberProfileWriteJobs").doc(jobId).get();
    if (!doc.exists) return [];
    const data = doc.data();
    if (!["pending", "retry"].includes(String(data?.status || ""))) return [];
    return [{ ref: doc.ref, data }];
  }
  const snap = await db
    .collection("studiomateMemberProfileWriteJobs")
    .where("status", "in", ["pending", "retry"])
    .limit(max)
    .get();
  return snap.docs.map((doc) => ({ ref: doc.ref, data: doc.data() }));
}

function validateProfilePayload(job) {
  const payload = job.payload || {};
  if (!String(job.memberId || "")) throw new Error("memberId is required");
  if (!digitsOnly(job.memberPhone || "") && !String(job.memberName || "").trim())
    throw new Error("memberPhone or memberName is required");
  if (!String(payload.address || "").trim()) throw new Error("address is required");
  if (!normalizeBirthDate(payload.birthDate)) throw new Error("birthDate is required");
  if (!normalizeGender(payload.gender)) throw new Error("gender is required");
}

async function writeProfileViaUi(page, job) {
  const studiomateMemberId = await resolveStudioMateMemberId(page, job);
  const payload = job.payload || {};
  const birthDate = normalizeBirthDate(payload.birthDate);
  const gender = normalizeGender(payload.gender);
  const address = String(payload.address || "").trim();

  await page.goto(new URL(`/users/detail?id=${encodeURIComponent(studiomateMemberId)}`, config.baseUrl).toString(), {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await assertLoggedIn(page);
  await page.getByText("회원정보 수정", { exact: true }).click({ timeout: 15000 });
  await page.waitForTimeout(1200);

  await setGender(page, gender);
  await page.locator('input[placeholder="생년월일 (YYYY-MM-DD)"]').first().fill(birthDate, { timeout: 10000 });
  await page.locator('input[placeholder="주소를 입력해 주세요"]').first().fill(address, { timeout: 10000 });

  await page.getByText("회원 수정 완료", { exact: true }).click({ timeout: 15000 });
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1800);

  const body = await page.locator("body").innerText({ timeout: 10000 });
  if (!body.includes(birthDate.replace(/-/g, "년 ").slice(0, 6)) && !body.includes(birthDate)) {
    throw new Error("StudioMate member profile save did not show the updated birth date.");
  }
  if (!body.includes(gender)) throw new Error("StudioMate member profile save did not show the updated gender.");
  return { studiomateMemberId };
}

async function setGender(page, gender) {
  const genderInput = page.locator('input[placeholder="선택"]').nth(1);
  await genderInput.click({ timeout: 10000 });
  await page.waitForTimeout(400);
  const option = page.locator(".el-select-dropdown:visible .el-select-dropdown__item").filter({ hasText: gender }).last();
  if (await option.isVisible().catch(() => false)) {
    await option.click({ timeout: 10000 });
    return;
  }
  await genderInput.fill(gender, { timeout: 10000 });
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
  if (!clicked) throw new Error(`StudioMate member search result not found for ${name || "-"} ${phone || "-"}.`);
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1000);

  const url = new URL(page.url());
  const resolved = url.searchParams.get("id") || "";
  if (!/^\d+$/.test(resolved)) throw new Error(`StudioMate member search did not open a detail page: ${page.url()}`);
  return resolved;
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

async function updateContractProfileStatus(contractId, patch) {
  if (!contractId) return;
  await db
    .collection("memberSignupContracts")
    .doc(String(contractId))
    .set(
      {
        ...patch,
        profileWriteUpdatedAt: admin.firestore.Timestamp.now(),
        updatedAt: admin.firestore.Timestamp.now(),
      },
      { merge: true },
    );
}

async function assertLoggedIn(page) {
  await ensureStudioMateLoggedIn(page, { headless: config.headless, waitForLogin: config.waitForLogin });
}

function normalizeGender(value) {
  const raw = String(value || "").trim();
  const lowered = raw.toLowerCase();
  if (["female", "f", "woman", "여", "여성"].includes(lowered) || raw === "여성") return "여성";
  if (["male", "m", "man", "남", "남성"].includes(lowered) || raw === "남성") return "남성";
  if (["other", "기타"].includes(lowered) || raw === "기타") return "기타";
  if (["none", "unknown", "응답하지 않음"].includes(lowered) || raw === "응답하지 않음") return "응답하지 않음";
  return "";
}

function normalizeBirthDate(value) {
  const raw = String(value || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
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

async function importPlaywright() {
  try {
    return await import("playwright");
  } catch {
    const runtimeRequire = createRequire(
      "/Users/archivepilates/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json",
    );
    return runtimeRequire("playwright");
  }
}
