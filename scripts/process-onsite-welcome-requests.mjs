#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { acquireStudioMateBrowserLock } from "./lib/studiomate-browser-lock.mjs";
import { ensureStudioMateLoggedIn } from "./lib/studiomate-login.mjs";

const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const config = {
  projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "archive-pilates",
  baseUrl: process.env.STUDIOMATE_WEB_BASE_URL || "https://arcpilates.studiomate.kr",
  profileDir: expandHome(process.env.STUDIOMATE_EMERGENCY_PROFILE_DIR || "~/ArchiveIN/automation/browser-profile"),
  headless: process.env.HEADLESS !== "false",
  waitForLogin: process.env.WAIT_FOR_LOGIN === "true",
  limit: Number(process.env.ONSITE_WELCOME_LIMIT || "1"),
  runLogPath: expandHome(process.env.ONSITE_WELCOME_RUN_LOG || "~/ArchiveIN/emergency/runs/onsite-welcome.jsonl"),
};

if (!admin.apps.length) admin.initializeApp({ projectId: config.projectId });
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const summary = {
  ok: false,
  mode: apply ? "apply" : "dry-run",
  source: "onsite_welcome_playwright_runner",
  processed: 0,
  ready: 0,
  failed: 0,
  startedAt: new Date().toISOString(),
  requests: [],
};

await mkdir(path.dirname(config.runLogPath), { recursive: true });
const claimed = [];
for (let index = 0; index < config.limit; index += 1) {
  const request = await claimNextRequest();
  if (!request) break;
  claimed.push(request);
}

if (!claimed.length) {
  summary.ok = true;
  summary.finishedAt = new Date().toISOString();
  await appendFile(config.runLogPath, `${JSON.stringify(summary)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

let releaseBrowserLock = null;
let context = null;

try {
  releaseBrowserLock = await acquireStudioMateBrowserLock({ owner: "onsite-welcome-lookup", waitMs: 5 * 60 * 1000 });
  const { chromium } = await import("playwright");
  context = await chromium.launchPersistentContext(config.profileDir, { headless: config.headless });
  const page = await context.newPage();
  await page.goto(new URL("/users", config.baseUrl).toString(), { waitUntil: "networkidle", timeout: 60000 });
  await ensureStudioMateLoggedIn(page, { headless: config.headless, waitForLogin: config.waitForLogin });

  for (const request of claimed) {
    summary.processed += 1;
    const result = await processRequest(page, request).catch(async (err) => {
      const message = err instanceof Error ? err.message : String(err);
      await request.ref.set(
        {
          status: "error",
          progressPercent: 100,
          progressLabel: "StudioMate 단건 조회 실패",
          lastError: message,
          completedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      summary.failed += 1;
      return { requestId: request.id, ok: false, error: message };
    });
    summary.requests.push(result);
    if (result.ok) summary.ready += 1;
  }
  summary.ok = summary.failed === 0;
} finally {
  await context?.close().catch(() => {});
  await releaseBrowserLock?.().catch(() => {});
}

summary.finishedAt = new Date().toISOString();
await appendFile(config.runLogPath, `${JSON.stringify(summary)}\n`);
console.log(JSON.stringify(summary, null, 2));
if (!summary.ok) process.exitCode = 1;

async function claimNextRequest() {
  const snap = await db.collection("onsiteWelcomeRequests").where("status", "==", "pending").limit(10).get();
  const docSnap = snap.docs.sort((a, b) => timestampMillis(a.data().createdAt) - timestampMillis(b.data().createdAt))[0];
  if (!docSnap) return null;
  return db.runTransaction(async (tx) => {
    const fresh = await tx.get(docSnap.ref);
    if (!fresh.exists || fresh.data()?.status !== "pending") return null;
    tx.set(
      docSnap.ref,
      {
        status: "running",
        progressPercent: 20,
        progressLabel: "StudioMate 회원 검색 시작",
        claimedBy: os.hostname(),
        startedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { id: docSnap.id, ref: docSnap.ref, data: fresh.data() };
  });
}

async function processRequest(page, request) {
  const lookup = await lookupStudioMateMember(page, request.data);
  const signup = await createSignupContract(request.data, lookup);
  if (!apply) {
    await request.ref.set(
      {
        status: "ready",
        progressPercent: 85,
        progressLabel: "드라이런: 가입서 링크 생성 예정",
        lookup,
        contractId: signup.contractId,
        signupUrl: signup.signupUrl,
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { requestId: request.id, ok: true, dryRun: true, lookup, signupUrl: signup.signupUrl };
  }
  await request.ref.set(
    {
      status: "ready",
      progressPercent: 92,
      progressLabel: "가입서 링크 준비 완료",
      lookup,
      contractId: signup.contractId,
      signupUrl: signup.signupUrl,
      lastError: null,
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return { requestId: request.id, ok: true, lookup, signupUrl: signup.signupUrl };
}

async function lookupStudioMateMember(page, request) {
  const phone = digitsOnly(request.phone);
  await page.goto(new URL("/users", config.baseUrl).toString(), { waitUntil: "networkidle", timeout: 60000 });
  const search = page.locator('input[placeholder="이름 또는 전화번호로 검색"]').first();
  if (!(await search.isVisible().catch(() => false))) throw new Error("StudioMate 회원 검색창을 찾지 못했습니다.");
  await search.fill(phone);
  await page.waitForTimeout(1200);
  const match = await clickSingleSearchResult(page, { phone, name: request.memberNameHint || "" });
  if (!match.clicked) throw new Error(match.error || "전화번호와 일치하는 StudioMate 회원을 찾지 못했습니다.");
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(900);
  const url = new URL(page.url());
  const memberId = url.searchParams.get("id") || "";
  const body = await page.locator("body").innerText({ timeout: 10000 });
  return {
    source: "studiomate_playwright_lookup",
    memberId,
    memberName: extractName(body, request.memberNameHint),
    memberPhone: phone,
    ticketName: extractTicketName(body),
    startDate: extractNearDate(body, ["시작", "이용시작", "사용시작"]),
    endDate: extractNearDate(body, ["종료", "만료", "이용종료"]),
    rawTextPreview: body.slice(0, 1200),
  };
}

async function clickSingleSearchResult(page, { phone, name }) {
  const results = page.locator(".members .member");
  const matches = [];
  const count = await results.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const candidate = results.nth(index);
    if (!(await candidate.isVisible().catch(() => false))) continue;
    const text = await candidate.innerText().catch(() => "");
    const textPhone = digitsOnly(text);
    if (textPhone.includes(phone.slice(-8)) || (name && text.includes(name))) matches.push({ candidate, text });
  }
  if (matches.length !== 1) {
    return { clicked: false, error: matches.length ? "검색 결과가 2명 이상입니다. 회원명을 함께 입력해주세요." : "" };
  }
  await matches[0].candidate.click({ timeout: 5000 });
  return { clicked: true };
}

async function createSignupContract(request, lookup) {
  const token = randomBytes(24).toString("base64url");
  const memberKey = lookup.memberId || `onsite_${sha256(`${request.phone}|${lookup.memberName || ""}`).slice(0, 16)}`;
  const contractId = `msc-${memberKey}-${Date.now().toString(36)}`.replace(/[^a-zA-Z0-9-]/g, "-");
  const now = admin.firestore.Timestamp.now();
  const doc = {
    contractId,
    studioId: request.studioId || "5330",
    memberId: memberKey,
    memberName: lookup.memberName || request.memberNameHint || "",
    memberPhone: digitsOnly(request.phone),
    memberPhoneLast4: digitsOnly(request.phone).slice(-4),
    status: "draft",
    accessTokenHash: sha256(token),
    source: "studiomate_playwright_lookup",
    member: {
      name: lookup.memberName || request.memberNameHint || "",
      phone: digitsOnly(request.phone),
      gender: "",
      birthDate: "",
      email: "",
      address: "",
      visitRoute: "",
      exercisePurpose: "",
      recommender: "",
    },
    purchase: {
      ticketName: lookup.ticketName || "",
      startDate: lookup.startDate || "",
      endDate: lookup.endDate || "",
      paymentMethod: "",
      paidAmount: "",
      unpaidAmount: "0원",
    },
    termsVersion: "archive-member-signup-2026-05",
    openedAt: null,
    submittedAt: null,
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 1000 * 60 * 60 * 24 * 14),
    createdAt: now,
    updatedAt: now,
  };
  if (apply) await db.collection("memberSignupContracts").doc(contractId).set(doc, { merge: true });
  return {
    contractId,
    signupUrl: `https://in.archivepilates.com/memberSignup/?id=${encodeURIComponent(contractId)}&token=${encodeURIComponent(token)}`,
  };
}

function extractName(body, fallback) {
  const compact = String(body || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (fallback && body.includes(fallback)) return fallback;
  return compact.find((line) => /^[가-힣]{2,5}$/.test(line)) || fallback || "";
}

function extractTicketName(body) {
  const lines = String(body || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  return lines.find((line) => /(그룹|프라이빗|수강권|회권|개월|주)/.test(line) && line.length <= 80) || "";
}

function extractNearDate(body, labels) {
  const lines = String(body || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    if (!labels.some((label) => lines[index].includes(label))) continue;
    const windowText = lines.slice(index, index + 4).join(" ");
    const match = windowText.match(/20\d{2}[.\-/년 ]+\d{1,2}[.\-/월 ]+\d{1,2}/);
    if (match) return match[0].replace(/[년월]/g, ".").replace(/[\/-]/g, ".").replace(/\s+/g, " ").trim();
  }
  return "";
}

function timestampMillis(value) {
  return value?.toMillis?.() || 0;
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function expandHome(value) {
  return value?.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
}
