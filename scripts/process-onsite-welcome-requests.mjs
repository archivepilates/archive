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
        status: "lookup_ready",
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
      status: "lookup_ready",
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
  await search.fill("");
  await search.fill(phone);
  const match = await waitAndClickSingleSearchResult(page, { phone, name: request.memberNameHint || "" });
  if (!match.clicked) throw new Error(match.error || "전화번호와 일치하는 StudioMate 회원을 찾지 못했습니다.");
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  const body = await waitForMatchingMemberDetail(page, { phone, name: request.memberNameHint || "" });
  const url = new URL(page.url());
  const memberId = url.searchParams.get("id") || "";
  validateMemberDetail(body, { phone, name: request.memberNameHint || "" });
  const activeTicket = extractActiveTicketInfo(body);
  const profile = extractMemberProfileInfo(body);
  return {
    source: "studiomate_playwright_lookup",
    memberId,
    memberName: extractName(body, request.memberNameHint),
    memberPhone: phone,
    gender: profile.gender,
    birthDate: profile.birthDate,
    email: profile.email,
    address: profile.address,
    ticketName: activeTicket.ticketName || "",
    startDate: activeTicket.startDate || extractNearDate(body, ["시작", "이용시작", "사용시작"]),
    endDate: activeTicket.endDate || extractNearDate(body, ["종료", "만료", "이용종료"]),
    paidAmount: activeTicket.paidAmount || "",
    rawTextPreview: body.slice(0, 1200),
  };
}

async function waitAndClickSingleSearchResult(page, { phone, name }) {
  const deadline = Date.now() + 8000;
  let lastResult = { matches: [], visibleCount: 0 };
  while (Date.now() < deadline) {
    lastResult = await findSearchResultMatches(page, { phone, name });
    if (lastResult.matches.length === 1) {
      await lastResult.matches[0].candidate.click({ timeout: 5000 });
      return { clicked: true };
    }
    if (lastResult.matches.length > 1) {
      return { clicked: false, error: "검색 결과가 2명 이상입니다. 회원명을 더 정확히 입력해주세요." };
    }
    await page.waitForTimeout(250);
  }
  return {
    clicked: false,
    error: `전화번호와 회원명이 일치하는 StudioMate 회원을 찾지 못했습니다. 검색결과 ${lastResult.visibleCount}건`,
  };
}

async function findSearchResultMatches(page, { phone, name }) {
  const results = page.locator(".members .member");
  const matches = [];
  const phoneTail = phone.slice(-8);
  const normalizedName = String(name || "").trim();
  const count = await results.count().catch(() => 0);
  let visibleCount = 0;
  for (let index = 0; index < count; index += 1) {
    const candidate = results.nth(index);
    if (!(await candidate.isVisible().catch(() => false))) continue;
    visibleCount += 1;
    const text = await candidate.innerText().catch(() => "");
    const textPhone = digitsOnly(text);
    const phoneMatches = phoneTail && textPhone.includes(phoneTail);
    const nameMatches = !normalizedName || text.includes(normalizedName);
    if (phoneMatches && nameMatches) matches.push({ candidate, text });
  }
  return { matches, visibleCount };
}

async function waitForMatchingMemberDetail(page, { phone, name }) {
  const phoneTail = digitsOnly(phone).slice(-8);
  const normalizedName = String(name || "").trim();
  const deadline = Date.now() + 8000;
  let lastBody = "";
  while (Date.now() < deadline) {
    lastBody = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
    const detailPage = page.url().includes("/users/detail");
    const phoneMatches = !phoneTail || digitsOnly(lastBody).includes(phoneTail);
    const nameMatches = !normalizedName || lastBody.includes(normalizedName);
    if (detailPage && phoneMatches && nameMatches) return lastBody;
    await page.waitForTimeout(250);
  }
  return lastBody;
}

function validateMemberDetail(body, { phone, name }) {
  const text = String(body || "");
  const phoneTail = digitsOnly(phone).slice(-8);
  const normalizedName = String(name || "").trim();
  if (phoneTail && !digitsOnly(text).includes(phoneTail)) {
    throw new Error("StudioMate 상세 화면의 전화번호가 요청값과 다릅니다. 가입서 생성을 중단했습니다.");
  }
  if (normalizedName && !text.includes(normalizedName)) {
    throw new Error("StudioMate 상세 화면의 회원명이 요청값과 다릅니다. 가입서 생성을 중단했습니다.");
  }
}

async function createSignupContract(request, lookup) {
  const token = randomBytes(24).toString("base64url");
  const memberKey = lookup.memberId || `onsite_${sha256(`${request.phone}|${lookup.memberName || ""}`).slice(0, 16)}`;
  const contractId = `msc-${memberKey}-${Date.now().toString(36)}`.replace(/[^a-zA-Z0-9-]/g, "-");
  const now = admin.firestore.Timestamp.now();
  if (apply) await cancelActiveUnsignedContracts(memberKey, now);
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
      gender: lookup.gender || "",
      birthDate: lookup.birthDate || "",
      email: lookup.email || "",
      address: lookup.address || "",
      visitRoute: "",
      exercisePurpose: "",
      recommender: "",
    },
    purchase: {
      ticketName: lookup.ticketName || "",
      startDate: lookup.startDate || "",
      endDate: lookup.endDate || "",
      paymentMethod: "",
      paidAmount: lookup.paidAmount || "",
      unpaidAmount: "0원",
    },
    termsVersion: "archive-member-signup-2026-06",
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

async function cancelActiveUnsignedContracts(memberId, now) {
  const purgeAfter = admin.firestore.Timestamp.fromMillis(now.toMillis() + 1000 * 60 * 60 * 24 * 7);
  const snap = await db
    .collection("memberSignupContracts")
    .where("memberId", "==", memberId)
    .where("status", "in", ["draft", "opened"])
    .limit(20)
    .get();
  const batch = db.batch();
  let count = 0;
  for (const docSnap of snap.docs) {
    const contract = docSnap.data();
    if (contract.signature || contract.submittedAt || contract.status === "submitted") continue;
    batch.set(
      docSnap.ref,
      {
        status: "cancelled",
        expiresAt: now,
        cancelledAt: now,
        cancelReason: "replaced_by_new_onsite_signup",
        purgeAfter,
        updatedAt: now,
      },
      { merge: true },
    );
    count += 1;
  }
  if (count) await batch.commit();
}

function extractName(body, fallback) {
  const compact = String(body || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (fallback && body.includes(fallback)) return fallback;
  return compact.find((line) => /^[가-힣]{2,5}$/.test(line)) || fallback || "";
}

function extractMemberProfileInfo(body) {
  const lines = String(body || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  return {
    gender: extractInlineOrNext(lines, "성별"),
    birthDate: normalizeDateText(extractInlineOrNext(lines, "생년월일")),
    email: extractEmail(lines),
    address: extractAddress(lines),
  };
}

function extractInlineOrNext(lines, label) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.includes(label)) continue;
    const inline = line.replace(new RegExp(`^${label}\\s*[:：]?\\s*`), "").trim();
    if (inline && inline !== label) return inline;
    return lines[index + 1] || "";
  }
  return "";
}

function extractEmail(lines) {
  const text = lines.join(" ");
  const match = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return match ? match[0] : "";
}

function extractAddress(lines) {
  const address = extractInlineOrNext(lines, "주소");
  if (!address || /주소\s*검색|검색|수정|저장/.test(address)) return "";
  return address;
}

function extractTicketName(body) {
  const lines = String(body || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const activeTicketIndex = lines.findIndex((line) => /사용중인\s*수강권/.test(line));
  if (activeTicketIndex >= 0) {
    const activeTicket = lines
      .slice(activeTicketIndex + 1, activeTicketIndex + 24)
      .find((line) => isLikelyTicketName(line) && !isTicketMetaLine(line) && !/^\+|새로운|이전\s*수강권|클릭하시면|확인하실|예약가능|취소가능|잔여|결제|회당/.test(line));
    if (activeTicket) return activeTicket;
  }
  const labelIndex = lines.findIndex((line) => /^(보유\s*)?(수강권|이용권|회원권)$/.test(line));
  if (labelIndex >= 0) {
    const near = lines.slice(labelIndex + 1, labelIndex + 8).find((line) => isLikelyTicketName(line));
    if (near) return near;
  }
  return lines.find((line) => isLikelyTicketName(line)) || "";
}

function extractActiveTicketInfo(body) {
  const lines = String(body || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const activeTicketIndex = lines.findIndex((line) => /사용중인\s*수강권/.test(line));
  if (activeTicketIndex < 0) return {};
  const windowLines = lines.slice(activeTicketIndex + 1, activeTicketIndex + 32);
  const ticketName = windowLines.find((line) => isLikelyTicketName(line) && !isTicketMetaLine(line) && !/^\+|새로운|이전\s*수강권|클릭하시면|확인하실|예약가능|취소가능|잔여|결제|회당/.test(line)) || "";
  const periodLine = windowLines.find((line) => /20\d{2}[.\-/년]\s*\d{1,2}[.\-/월]\s*\d{1,2}/.test(line) && /[~～-]/.test(line)) || "";
  const periodMatch = periodLine.match(/(20\d{2}[.\-/년 ]+\d{1,2}[.\-/월 ]+\d{1,2}\.?)[\s.]*[~～-]\s*(20\d{2}[.\-/년 ]+\d{1,2}[.\-/월 ]+\d{1,2}\.?)/);
  const paidLine = windowLines.find((line) => /결제\s*금액/.test(line)) || "";
  const paidMatch = paidLine.match(/결제\s*금액\s*([0-9,]+\s*원|[0-9,]+)/);
  return {
    ticketName,
    startDate: periodMatch ? normalizeDateText(periodMatch[1]) : "",
    endDate: periodMatch ? normalizeDateText(periodMatch[2]) : "",
    paidAmount: paidMatch ? normalizeMoneyText(paidMatch[1]) : "",
  };
}

function normalizeDateText(value) {
  return String(value || "").replace(/[년월]/g, ".").replace(/[\/-]/g, ".").replace(/\s+/g, " ").replace(/\.+$/, "").trim();
}

function normalizeMoneyText(value) {
  const raw = String(value || "").trim();
  return raw.endsWith("원") ? raw.replace(/\s+/g, "") : `${raw.replace(/\s+/g, "")}원`;
}

function isLikelyTicketName(line) {
  const value = String(line || "").trim();
  if (!value || value.length > 80) return false;
  if (isTicketMetaLine(value)) return false;
  if (/^\[[^\]]+\]/.test(value) || /ARCHIVE IN|사전확인|알림톡|리포트/.test(value)) return false;
  if (/첫\s*프라이빗|체험|상담/.test(value) && /20\d{2}|AM|PM|오전|오후|[:：]/.test(value)) return false;
  if (/20\d{2}/.test(value) && /(AM|PM|오전|오후|\/|:|：)/.test(value)) return false;
  if (/(예약했습니다|예약\s*완료|수업에\s*예약|잔여\s*횟수|잔여횟수|남았습니다|출석|결석|노쇼|취소했습니다)/.test(value)) return false;
  if (/\[[^\]]+\]\s*회원님이/.test(value)) return false;
  if (/(강사|수업|바렐|리포머|체어|캐딜락)/.test(value) && /20\d{2}[.\-/년]/.test(value)) return false;
  return /(그룹|프라이빗|개인|듀엣|트리플|수강권|회원권|회권|\d+\s*회|\d+\s*개월|\d+\s*주)/.test(value);
}

function isTicketMetaLine(line) {
  const value = String(line || "").trim();
  return /^(횟수제|기간제|월정액|그룹형|개인형|듀엣형|트리플형|프라이빗형|듀엣|트리플|프라이빗|그룹|\d+\s*:\s*\d+)(\s*[·ㆍ|/,-]\s*(횟수제|기간제|월정액|그룹형|개인형|듀엣형|트리플형|프라이빗형|듀엣|트리플|프라이빗|그룹|\d+\s*:\s*\d+))*$/.test(value);
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
