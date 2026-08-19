#!/usr/bin/env node
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { acquireEformsignBrowserLock } from "./lib/eformsign-browser-lock.mjs";
import {
  assertRefundJobStillWithinValidity,
  assertRefundSourceUnchanged,
  buildRefundDocumentName,
  buildRefundRecipientMessage,
  EFORMSIGN_REFUND_FIELD_IDS,
  EFORMSIGN_REFUND_TEMPLATE_URL,
  extractEformsignDocumentId,
  formatInputWon,
  isUnambiguousSendSuccess,
  normalizeRefundJob,
  staleRefundJobRecoveryStatus,
} from "./lib/eformsign-refund-browser-contract.mjs";
import { appendIdleHeartbeatIfDue } from "./lib/idle-heartbeat.mjs";
import { recordAutomationStatus } from "./lib/archive-core-ops-logging.mjs";

const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");
const args = parseArgs(process.argv.slice(2));
const apply = Boolean(args.apply);
const config = {
  projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "archive-pilates",
  profileDir: expandHome(process.env.EFORMSIGN_BROWSER_PROFILE_DIR || "~/ArchiveIN/automation/eformsign-browser-profile"),
  runLogPath: expandHome(process.env.EFORMSIGN_REFUND_RUN_LOG || "~/ArchiveIN/emergency/runs/eformsign-refund.jsonl"),
  lastResultPath: expandHome(
    process.env.EFORMSIGN_REFUND_LAST_RESULT || "~/ArchiveIN/automation/reports/eformsign-refund-queue/latest.json",
  ),
  headless: process.env.HEADLESS !== "false",
  waitForLogin: process.env.WAIT_FOR_LOGIN === "true",
  loginOnly: Boolean(args["login-only"]),
  jobId: String(args["job-id"] || process.env.EFORMSIGN_REFUND_JOB_ID || ""),
  limit: Math.max(1, Math.min(3, Number(args.limit || process.env.EFORMSIGN_REFUND_LIMIT || "1"))),
  staleLeaseMs: Math.max(5 * 60 * 1000, Number(process.env.EFORMSIGN_REFUND_STALE_LEASE_MS || 15 * 60 * 1000)),
};

if (!admin.apps.length) admin.initializeApp({ projectId: config.projectId });
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const summary = {
  ok: false,
  mode: config.loginOnly ? "login-only" : apply ? "apply" : "dry-run",
  source: "eformsign_refund_playwright_queue",
  startedAt: new Date().toISOString(),
  processed: 0,
  sent: 0,
  retried: 0,
  reviewRequired: 0,
  failed: 0,
  jobs: [],
};

await mkdir(config.profileDir, { recursive: true });
await mkdir(path.dirname(config.runLogPath), { recursive: true });
await mkdir(path.dirname(config.lastResultPath), { recursive: true });

if (apply && !config.loginOnly) await recoverStaleJobs();
const candidates = await loadCandidates(config.limit);
if (!candidates.length && !config.loginOnly) {
  summary.ok = true;
  summary.finishedAt = new Date().toISOString();
  appendIdleHeartbeatIfDue(config.runLogPath, summary, 30 * 60 * 1000);
  await persistSummary();
  process.exit(0);
}

if (!apply && !config.loginOnly) {
  summary.ok = true;
  summary.jobs = candidates.map(({ ref, data }) => ({ jobId: ref.id, status: data.status, dryRun: true }));
  summary.finishedAt = new Date().toISOString();
  await persistSummary();
  process.exit(0);
}

let context = null;
let releaseLock = null;
try {
  releaseLock = await acquireEformsignBrowserLock();
  const { chromium } = await import("playwright");
  context = await chromium.launchPersistentContext(config.profileDir, {
    headless: config.headless,
    viewport: { width: 1280, height: 900 },
  });
  const page = context.pages()[0] || await context.newPage();
  await ensureLoggedIn(page);

  if (config.loginOnly) {
    summary.ok = true;
    summary.authenticated = true;
  } else {
    for (const candidate of candidates) {
      const claimed = await claimJob(candidate.ref);
      if (!claimed) continue;
      summary.processed += 1;
      const item = { jobId: candidate.ref.id, status: "processing" };
      let finalSendClicked = false;
      try {
        const job = normalizeRefundJob({ ...claimed, jobId: candidate.ref.id });
        await assertLiveRefundSource(job);
        const sendResult = await sendRefundAgreement(page, job, async () => {
          await assertLiveRefundSource(job);
          finalSendClicked = true;
          await markSending(candidate.ref, job);
        });
        await markSent(candidate.ref, job, sendResult);
        item.status = "done";
        item.documentUrl = sendResult.documentUrl;
        summary.sent += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const outcome = await markFailure(candidate.ref, claimed, message, finalSendClicked);
        item.status = outcome.status;
        item.error = message;
        if (outcome.status === "send_review_required") summary.reviewRequired += 1;
        else if (outcome.status === "retry") summary.retried += 1;
        else summary.failed += 1;
      }
      summary.jobs.push(item);
    }
    summary.ok = summary.failed === 0 && summary.reviewRequired === 0;
  }
} catch (error) {
  summary.ok = false;
  summary.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await context?.close().catch(() => {});
  await releaseLock?.().catch(() => {});
  summary.finishedAt = new Date().toISOString();
  await persistSummary();
}

if (!summary.ok) process.exitCode = 1;

async function loadCandidates(limit) {
  if (config.jobId) {
    const snapshot = await db.collection("eformsignRefundJobs").doc(config.jobId).get();
    if (!snapshot.exists || !["pending", "retry"].includes(String(snapshot.data()?.status || ""))) return [];
    return [{ ref: snapshot.ref, data: snapshot.data() }];
  }
  const snapshots = await Promise.all(
    ["pending", "retry"].map((status) => db.collection("eformsignRefundJobs").where("status", "==", status).limit(limit).get()),
  );
  return snapshots.flatMap((snapshot) => snapshot.docs.map((doc) => ({ ref: doc.ref, data: doc.data() })))
    .sort((a, b) => timestampMillis(a.data.createdAt) - timestampMillis(b.data.createdAt))
    .slice(0, limit);
}

async function recoverStaleJobs() {
  const snapshots = await Promise.all(
    ["processing", "sending"].map((status) =>
      db.collection("eformsignRefundJobs").where("status", "==", status).limit(20).get()),
  );
  const nowMs = Date.now();
  for (const snapshot of snapshots) {
    for (const doc of snapshot.docs) {
      const data = doc.data();
      const leaseAt = timestampMillis(data.updatedAt || data.claimedAt);
      if (!leaseAt || nowMs - leaseAt < config.staleLeaseMs) continue;
      const status = staleRefundJobRecoveryStatus(data);
      const message = status === "send_review_required"
        ? "이전 실행이 최종 전송 단계에서 중단되었습니다. 이폼싸인 발송 문서를 확인하세요."
        : status === "retry"
          ? "이전 실행이 전송 버튼 클릭 전에 중단되어 안전하게 재시도합니다."
          : "이전 실행이 반복 중단되어 자동 재시도를 종료했습니다.";
      const now = FieldValue.serverTimestamp();
      const caseId = String(data.caseId || doc.id);
      const batch = db.batch();
      batch.set(doc.ref, { status, lastError: message, recoveredAt: now, updatedAt: now }, { merge: true });
      batch.set(db.collection("refundCases").doc(caseId), { status, lastError: message, updatedAt: now }, { merge: true });
      await batch.commit();
    }
  }
}

async function assertLiveRefundSource(job) {
  const snapshot = await db.collection("memberProfiles").doc(job.memberId).get();
  if (!snapshot.exists) throw new Error("환불 대상 회원 원천이 없어 발송을 중단했습니다.");
  return assertRefundSourceUnchanged(job, snapshot.data());
}

async function claimJob(ref) {
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || !["pending", "retry"].includes(String(snapshot.data()?.status || ""))) return null;
    const data = snapshot.data();
    const attempts = Number(data.attempts || 0) + 1;
    transaction.set(
      ref,
      {
        status: "processing",
        attempts,
        claimedBy: os.hostname(),
        claimedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        lastError: null,
      },
      { merge: true },
    );
    transaction.set(
      db.collection("refundCases").doc(String(data.caseId || ref.id)),
      { status: "sending", updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    return { ...data, attempts };
  });
}

async function ensureLoggedIn(page) {
  await page.goto(EFORMSIGN_REFUND_TEMPLATE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  if (await page.getByRole("button", { name: "입력 시작", exact: true }).isVisible().catch(() => false)) return;
  if (!config.waitForLogin) {
    throw new Error("eformsign 전용 브라우저 프로필 로그인이 필요합니다.");
  }
  console.log("eformsign 로그인 후 환불동의서 템플릿 화면이 열릴 때까지 기다립니다.");
  await page.waitForFunction(
    () => [...document.querySelectorAll("button")].some((button) => button.textContent?.trim() === "입력 시작"),
    undefined,
    { timeout: 5 * 60 * 1000 },
  );
}

async function sendRefundAgreement(page, job, beforeFinalSend) {
  assertRefundJobStillWithinValidity(job);
  await page.goto(EFORMSIGN_REFUND_TEMPLATE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  const startButton = page.getByRole("button", { name: "입력 시작", exact: true });
  await startButton.waitFor({ state: "visible", timeout: 30000 });
  const documentName = buildRefundDocumentName(job);
  const titleInput = page.locator("h1 input").first();
  if (await titleInput.isVisible().catch(() => false)) await titleInput.fill(documentName);
  await startButton.click();

  const frame = page.frameLocator("#viewer_frame");
  await fillFrameField(page, frame, EFORMSIGN_REFUND_FIELD_IDS.memberName, job.memberName);
  await fillFrameField(page, frame, EFORMSIGN_REFUND_FIELD_IDS.memberPhone, formatPhone(job.memberPhone));
  await fillFrameField(page, frame, EFORMSIGN_REFUND_FIELD_IDS.paymentAmount, formatInputWon(job.paymentAmount));
  await fillFrameField(page, frame, EFORMSIGN_REFUND_FIELD_IDS.penaltyAmount, formatInputWon(job.penaltyAmount));
  await fillFrameField(page, frame, EFORMSIGN_REFUND_FIELD_IDS.usedAmount, formatInputWon(job.usedAmount));
  await fillFrameField(page, frame, EFORMSIGN_REFUND_FIELD_IDS.refundAmount, formatInputWon(job.refundAmount));
  await clickNext(page);
  await fillFrameField(page, frame, EFORMSIGN_REFUND_FIELD_IDS.companySignerName, "배민진");
  await clickFrameControl(frame, EFORMSIGN_REFUND_FIELD_IDS.companySignature);
  await page.getByText(/필수 입력 항목\(8\/8\)/).waitFor({ state: "visible", timeout: 30000 });

  await page.getByRole("button", { name: "전송", exact: true }).first().click();
  const sendHeading = page.getByRole("heading", { name: "문서 전송", exact: true });
  await sendHeading.waitFor({ state: "visible", timeout: 30000 });
  const sendModal = sendHeading.locator("xpath=ancestor::*[.//button[normalize-space()='취소']][1]");
  const checkboxes = sendModal.locator('input[type="checkbox"]');
  const emailCheckbox = checkboxes.nth(0);
  const smsCheckbox = checkboxes.nth(1);
  if (await emailCheckbox.isChecked().catch(() => false)) await emailCheckbox.uncheck();
  if (!(await smsCheckbox.isChecked().catch(() => false))) await smsCheckbox.check();
  await sendModal.getByRole("textbox", { name: "이름" }).first().fill(job.memberName);
  const phoneInput = sendModal.locator('input[type="tel"], input[placeholder*="휴대"], input[placeholder*="연락처"]').first();
  await phoneInput.waitFor({ state: "visible", timeout: 10000 });
  await phoneInput.fill(job.memberPhone);
  const messageBox = sendModal.getByRole("textbox", { name: "수신자에게 전달할 메시지를 입력하세요." });
  if (await messageBox.isVisible().catch(() => false)) await messageBox.fill(buildRefundRecipientMessage());

  assertRefundJobStillWithinValidity(job);
  await beforeFinalSend();
  await sendModal.getByRole("button", { name: "전송", exact: true }).click();
  const sendEvidence = await waitForSendEvidence(page, documentName);
  if (!isUnambiguousSendSuccess({ ...sendEvidence, documentName })) {
    throw new Error("최종 전송 버튼 이후 성공 여부를 명확히 확인하지 못했습니다.");
  }
  return {
    documentName,
    documentId: sendEvidence.documentId,
    documentUrl: sendEvidence.url,
    evidence: sendEvidence.bodyText.slice(0, 500),
  };
}

async function fillFrameField(page, frame, fieldId, value) {
  const field = frame.locator(`#${fieldId}`);
  await field.waitFor({ state: "visible", timeout: 30000 });
  try {
    await field.fill(String(value));
  } catch {
    await field.click({ force: true });
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.type(String(value));
  }
  await field.press("Tab").catch(() => {});
}

async function clickFrameControl(frame, fieldId) {
  const control = frame.locator(`#${fieldId}`);
  await control.waitFor({ state: "visible", timeout: 30000 });
  await control.click({ force: true });
}

async function clickNext(page) {
  const button = page.getByRole("button", { name: "다음", exact: true }).last();
  await button.waitFor({ state: "visible", timeout: 30000 });
  await button.click();
}

async function waitForSendEvidence(page, documentName) {
  const deadline = Date.now() + 30000;
  let last = { url: page.url(), bodyText: "", documentId: "" };
  while (Date.now() < deadline) {
    last = {
      url: page.url(),
      bodyText: await page.locator("body").innerText().catch(() => ""),
      documentId: await findDocumentIdOnPage(page, documentName),
    };
    if (isUnambiguousSendSuccess({ ...last, documentName })) return last;
    await sleep(500);
  }
  return last;
}

async function findDocumentIdOnPage(page, documentName) {
  const evidence = await page.evaluate((expectedName) => {
    const nodes = [...document.querySelectorAll("a[href], [data-document-id], [data-doc-id]")];
    for (const node of nodes) {
      const container = node.closest("tr, [role='row'], li, article, .document-item, .list-item") || node;
      if (!String(container.textContent || "").includes(expectedName)) continue;
      return node.getAttribute("data-document-id")
        || node.getAttribute("data-doc-id")
        || node.getAttribute("href")
        || "";
    }
    return "";
  }, documentName).catch(() => "");
  if (!evidence) return extractEformsignDocumentId(page.url());
  if (!evidence.includes("/") && !evidence.includes("?")) return String(evidence).slice(0, 160);
  return extractEformsignDocumentId(new URL(evidence, page.url()).toString());
}

async function markSending(ref, job) {
  const now = FieldValue.serverTimestamp();
  const batch = db.batch();
  batch.set(ref, { status: "sending", sendClickedAt: now, updatedAt: now }, { merge: true });
  batch.set(db.collection("refundCases").doc(job.caseId), { status: "sending", sendClickedAt: now, updatedAt: now }, { merge: true });
  await batch.commit();
}

async function markSent(ref, job, sendResult) {
  const now = FieldValue.serverTimestamp();
  const batch = db.batch();
  batch.set(
    ref,
    {
      status: "done",
      documentId: sendResult.documentId,
      documentName: sendResult.documentName,
      documentUrl: sendResult.documentUrl,
      sendEvidence: sendResult.evidence,
      sentAt: now,
      completedAt: now,
      updatedAt: now,
      lastError: null,
    },
    { merge: true },
  );
  batch.set(
    db.collection("refundCases").doc(job.caseId),
    {
      status: "agreement_sent",
      eformsignDocumentName: sendResult.documentName,
      eformsignDocumentId: sendResult.documentId,
      eformsignDocumentUrl: sendResult.documentUrl,
      agreementSentAt: now,
      updatedAt: now,
    },
    { merge: true },
  );
  await batch.commit();
}

async function markFailure(ref, data, message, finalSendClicked) {
  const attempts = Number(data.attempts || 0);
  const maxAttempts = Number(data.maxAttempts || 3);
  const status = finalSendClicked ? "send_review_required" : attempts >= maxAttempts ? "failed" : "retry";
  const now = FieldValue.serverTimestamp();
  const caseId = String(data.caseId || ref.id);
  const batch = db.batch();
  batch.set(ref, { status, lastError: message.slice(0, 1200), updatedAt: now }, { merge: true });
  batch.set(db.collection("refundCases").doc(caseId), { status, lastError: message.slice(0, 1200), updatedAt: now }, { merge: true });
  await batch.commit();
  return { status };
}

async function persistSummary() {
  await writeFile(config.lastResultPath, `${JSON.stringify(summary, null, 2)}\n`);
  await appendFile(config.runLogPath, `${JSON.stringify(summary)}\n`);
  await recordAutomationStatus(db, {
    automationId: "eformsign-refund-queue",
    title: "이폼싸인 환불동의서 발송 큐",
    ownerArea: "refunds",
    status: summary.ok ? "healthy" : summary.reviewRequired ? "warning" : "failed",
    lastRunAt: summary.finishedAt || new Date().toISOString(),
    lastResult: summary.ok
      ? `처리 ${summary.processed}건 · 발송 ${summary.sent}건`
      : `실패 ${summary.failed}건 · 확인필요 ${summary.reviewRequired}건`,
    warnings: [summary.error, ...summary.jobs.filter((job) => job.error).map((job) => `${job.jobId}: ${job.error}`)].filter(Boolean),
  }).catch(() => {});
  console.log(JSON.stringify(summary, null, 2));
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
    const [name, inline] = value.slice(2).split("=", 2);
    if (inline !== undefined) parsed[name] = inline;
    else if (argv[index + 1] && !argv[index + 1].startsWith("--")) parsed[name] = argv[++index];
    else parsed[name] = true;
  }
  return parsed;
}

function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  const seconds = Number(value.seconds ?? value._seconds);
  return Number.isFinite(seconds) ? seconds * 1000 : Date.parse(String(value)) || 0;
}

function formatPhone(phone) {
  return String(phone).replace(/^(\d{3})(\d{4})(\d{4})$/, "$1-$2-$3");
}

function expandHome(value) {
  return value?.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
