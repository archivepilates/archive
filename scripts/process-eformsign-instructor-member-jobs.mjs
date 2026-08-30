#!/usr/bin/env node

import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { recordAutomationStatus } from "./lib/archive-core-ops-logging.mjs";
import { acquireEformsignBrowserLock } from "./lib/eformsign-browser-lock.mjs";
import { appendIdleHeartbeatIfDue } from "./lib/idle-heartbeat.mjs";
import {
  EFORMSIGN_COMPLETED_DOCUMENTS_URL,
  EFORMSIGN_PROGRESS_DOCUMENTS_URL,
  INSTRUCTOR_LESSON_TICKET_NAME,
  INSTRUCTOR_LESSON_TICKET_PRICE,
  INSTRUCTOR_MEMBER_EFORMSIGN_OPERATOR_FIELD_IDS,
  INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_URL,
  buildInstructorMemberDocumentName,
  buildInstructorMemberRecipientMessage,
  deriveInstructorLessonRegistrationState,
  isInstructorMemberEformOrphan,
  normalizeInstructorLessonName,
  normalizeInstructorLessonPhone,
  selectInstructorMemberEformDocument,
  staleExternalActionStatus,
} from "./lib/instructor-lesson-registration-contract.mjs";

const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");
const args = parseArgs(process.argv.slice(2));
const apply = Boolean(args.apply);
const config = {
  projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "archive-pilates",
  profileDir: expandHome(process.env.EFORMSIGN_BROWSER_PROFILE_DIR || "~/ArchiveIN/automation/eformsign-browser-profile"),
  runLogPath: expandHome(
    process.env.EFORMSIGN_INSTRUCTOR_MEMBER_RUN_LOG
      || "~/ArchiveIN/automation/runs/eformsign-instructor-member.jsonl",
  ),
  lastResultPath: expandHome(
    process.env.EFORMSIGN_INSTRUCTOR_MEMBER_LAST_RESULT
      || "~/ArchiveIN/automation/reports/eformsign-instructor-member/latest.json",
  ),
  headless: process.env.HEADLESS !== "false",
  waitForLogin: process.env.WAIT_FOR_LOGIN === "true",
  loginOnly: Boolean(args["login-only"]),
  jobId: String(args["job-id"] || process.env.EFORMSIGN_INSTRUCTOR_MEMBER_JOB_ID || ""),
  limit: Math.max(1, Math.min(3, Number(args.limit || process.env.EFORMSIGN_INSTRUCTOR_MEMBER_LIMIT || "1"))),
  staleLeaseMs: Math.max(5 * 60 * 1000, Number(process.env.EFORMSIGN_INSTRUCTOR_MEMBER_STALE_LEASE_MS || 15 * 60 * 1000)),
};

if (!admin.apps.length) admin.initializeApp({ projectId: config.projectId });
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const summary = {
  ok: false,
  mode: config.loginOnly ? "login-only" : apply ? "apply" : "dry-run",
  source: "eformsign_instructor_member_playwright_queue",
  startedAt: new Date().toISOString(),
  processed: 0,
  sent: 0,
  completed: 0,
  waiting: 0,
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
  summary.jobs = candidates.map(({ ref, data }) => ({
    jobId: ref.id,
    status: data.status,
    lessonDate: data.lessonDate,
    phoneLast4: String(data.memberPhone || "").slice(-4),
  }));
  summary.finishedAt = new Date().toISOString();
  await persistSummary();
  process.exit(0);
}

let context = null;
let releaseLock = null;
try {
  releaseLock = await acquireEformsignBrowserLock({ owner: "eformsign-instructor-member-queue" });
  const { chromium } = await import("playwright");
  context = await chromium.launchPersistentContext(config.profileDir, {
    headless: config.headless,
    viewport: { width: 1280, height: 900 },
  });
  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(20_000);
  await ensureLoggedIn(page);

  if (config.loginOnly) {
    summary.ok = true;
    summary.authenticated = true;
  } else {
    for (const candidate of candidates) await processCandidate(page, candidate);
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

async function processCandidate(page, candidate) {
  const item = { jobId: candidate.ref.id, status: candidate.data.status };
  try {
    if (candidate.type === "orphan_registration") {
      summary.processed += 1;
      const outcome = await reconcileOrphanRegistration(page, candidate.ref, candidate.data);
      item.status = outcome.status;
      item.detail = outcome.detail;
      if (outcome.status === "completed") summary.completed += 1;
      else if (outcome.status === "review_required") summary.reviewRequired += 1;
      else summary.waiting += 1;
      summary.jobs.push(item);
      return;
    }
    if (["sent", "waiting_completion"].includes(String(candidate.data.status || ""))) {
      const claimed = await claimCompletionCheck(candidate.ref);
      if (!claimed) return;
      summary.processed += 1;
      const completion = await inspectCompletion(page, candidate.ref, claimed);
      item.status = completion.status;
      item.detail = completion.detail;
      if (completion.status === "completed") summary.completed += 1;
      else if (completion.status === "review_required") summary.reviewRequired += 1;
      else summary.waiting += 1;
      summary.jobs.push(item);
      return;
    }

    const claimed = await claimJob(candidate.ref);
    if (!claimed) return;
    if (claimed.blocked) {
      summary.processed += 1;
      summary.reviewRequired += 1;
      item.status = "send_review_required";
      item.error = "이폼싸인 전송 실행 흔적이 있어 자동 재발송을 차단했습니다.";
      summary.jobs.push(item);
      return;
    }
    summary.processed += 1;
    let finalSendClicked = false;
    try {
      const sendResult = await sendInstructorMemberForm(page, { ...claimed, jobId: candidate.ref.id }, async () => {
        finalSendClicked = true;
        await markSending(candidate.ref, claimed);
      });
      await markSent(candidate.ref, claimed, sendResult);
      item.status = "waiting_completion";
      item.documentId = sendResult.documentId;
      summary.sent += 1;
      summary.waiting += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const outcome = await markFailure(candidate.ref, claimed, message, finalSendClicked);
      item.status = outcome.status;
      item.error = message;
      if (outcome.status === "send_review_required") summary.reviewRequired += 1;
      else if (outcome.status === "retry") summary.retried += 1;
      else summary.failed += 1;
    }
  } catch (error) {
    item.status = "failed";
    item.error = error instanceof Error ? error.message : String(error);
    summary.failed += 1;
  }
  summary.jobs.push(item);
}

async function loadCandidates(limit) {
  if (config.jobId) {
    const [snapshot, registrationSnapshot] = await Promise.all([
      db.collection("eformsignInstructorMemberJobs").doc(config.jobId).get(),
      db.collection("instructorLessonRegistrations").doc(config.jobId).get(),
    ]);
    if (snapshot.exists && ["pending", "retry", "sent", "waiting_completion"].includes(String(snapshot.data()?.status || ""))) {
      return [{ ref: snapshot.ref, data: snapshot.data(), type: "job" }];
    }
    if (registrationSnapshot.exists && isInstructorMemberEformOrphan(registrationSnapshot.data(), snapshot.exists)) {
      return [{ ref: registrationSnapshot.ref, data: registrationSnapshot.data(), type: "orphan_registration" }];
    }
    return [];
  }
  const [pendingSnapshot, retrySnapshot, sentSnapshot, waitingSnapshot] = await Promise.all([
    db.collection("eformsignInstructorMemberJobs").where("status", "==", "pending").get(),
    db.collection("eformsignInstructorMemberJobs").where("status", "==", "retry").get(),
    db.collection("eformsignInstructorMemberJobs").where("status", "==", "sent").get(),
    db.collection("eformsignInstructorMemberJobs").where("status", "==", "waiting_completion").get(),
  ]);
  const sortOldest = (docs) => docs
    .map((doc) => ({ ref: doc.ref, data: doc.data() }))
    .sort((a, b) => timestampMillis(a.data.createdAt) - timestampMillis(b.data.createdAt));
  const sends = sortOldest([...pendingSnapshot.docs, ...retrySnapshot.docs]).slice(0, limit);
  const checks = [...sentSnapshot.docs, ...waitingSnapshot.docs]
    .map((doc) => ({ ref: doc.ref, data: doc.data() }))
    .sort((a, b) => timestampMillis(a.data.lastCheckedAt || a.data.sentAt || a.data.createdAt)
      - timestampMillis(b.data.lastCheckedAt || b.data.sentAt || b.data.createdAt))
    .slice(0, limit);
  const jobs = [...sends, ...checks].map((candidate) => ({ ...candidate, type: "job" }));
  if (jobs.length) return jobs;
  return loadOrphanRegistrationCandidates(limit);
}

async function loadOrphanRegistrationCandidates(limit) {
  const registrationSnapshot = await db
    .collection("instructorLessonRegistrations")
    .where("mode", "==", "new_member")
    .get();
  const possible = registrationSnapshot.docs
    .filter((doc) => isInstructorMemberEformOrphan(doc.data(), false))
    .sort((a, b) => timestampMillis(a.data().updatedAt || a.data().createdAt)
      - timestampMillis(b.data().updatedAt || b.data().createdAt));
  if (!possible.length) return [];
  const jobSnapshots = await db.getAll(
    ...possible.map((doc) => db.collection("eformsignInstructorMemberJobs").doc(doc.id)),
  );
  const existing = new Set(jobSnapshots.filter((doc) => doc.exists).map((doc) => doc.id));
  return possible
    .filter((doc) => !existing.has(doc.id) && isInstructorMemberEformOrphan(doc.data(), false))
    .slice(0, limit)
    .map((doc) => ({ ref: doc.ref, data: doc.data(), type: "orphan_registration" }));
}

async function recoverStaleJobs() {
  const snapshots = await Promise.all(
    ["processing", "sending", "checking_completion"].map((status) =>
      db.collection("eformsignInstructorMemberJobs").where("status", "==", status).limit(20).get()),
  );
  const now = Date.now();
  for (const snapshot of snapshots) {
    for (const doc of snapshot.docs) {
      const data = doc.data();
      if (now - timestampMillis(data.updatedAt || data.claimedAt) < config.staleLeaseMs) continue;
      if (data.status === "checking_completion") {
        await doc.ref.set({
          status: "waiting_completion",
          claimToken: null,
          claimedAt: null,
          claimedBy: null,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        continue;
      }
      const status = staleExternalActionStatus(data, "send_review_required");
      await updateFailureState(doc.ref, data, "작업자 중단 후 이폼싸인 상태를 확정하지 못했습니다.", status);
    }
  }
}

async function claimJob(ref) {
  return db.runTransaction(async (transaction) => {
    const registrationRef = db.collection("instructorLessonRegistrations").doc(ref.id);
    const [snapshot, registrationSnapshot] = await Promise.all([
      transaction.get(ref),
      transaction.get(registrationRef),
    ]);
    if (!snapshot.exists || !["pending", "retry"].includes(String(snapshot.data()?.status || ""))) return null;
    const data = snapshot.data();
    if (data.externalEffectStarted || data.effectStartedAt || data.sendClickedAt) {
      const message = "이폼싸인 전송 실행 흔적이 있어 자동 재발송을 차단했습니다.";
      transaction.set(ref, { status: "send_review_required", lastError: message, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      transaction.update(registrationRef, {
        status: "action_required",
        nextAction: "이폼싸인 발송 결과 운영자 확인",
        lastError: message,
        "steps.eformsign": stepValue("review_required", "강사회원 가입서", message),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { ...data, blocked: true };
    }
    if (!registrationSnapshot.exists) throw new Error("강사레슨 등록 원본을 찾지 못했습니다.");
    const attempts = Number(data.attempts || 0) + 1;
    const claimToken = randomUUID();
    transaction.set(ref, {
      status: "processing",
      attempts,
      claimToken,
      claimedBy: `${os.hostname()}:${process.pid}`,
      claimedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      lastError: null,
    }, { merge: true });
    const registrationData = registrationSnapshot.data() || {};
    transaction.update(registrationRef, deriveRegistrationPatch(registrationData, {
      "steps.eformsign": stepValue("processing", "강사회원 가입서", "이폼싸인 문서 준비 중"),
      updatedAt: FieldValue.serverTimestamp(),
    }));
    return { ...data, attempts, claimToken };
  });
}

async function claimCompletionCheck(ref) {
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || !["sent", "waiting_completion"].includes(String(snapshot.data()?.status || ""))) return null;
    const data = snapshot.data();
    const claimToken = randomUUID();
    transaction.set(ref, {
      status: "checking_completion",
      claimToken,
      claimedBy: `${os.hostname()}:${process.pid}`,
      claimedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { ...data, claimToken };
  });
}

async function ensureLoggedIn(page) {
  await page.goto(EFORMSIGN_PROGRESS_DOCUMENTS_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  if (await eformsignSessionAuthenticated(page)) return;
  if (!config.waitForLogin) throw new Error("eformsign 전용 브라우저 프로필 로그인이 필요합니다.");
  console.log("archivepilates@gmail.com으로 로그인 후 강사회원가입서 템플릿 화면이 열릴 때까지 기다립니다.");
  await page.goto(INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForFunction(
    () => [...document.querySelectorAll("button")]
      .some((button) => /^(입력 시작|Fill in)$/.test(button.textContent?.trim() || "")),
    undefined,
    { timeout: 5 * 60 * 1000 },
  );
  await page.goto(EFORMSIGN_PROGRESS_DOCUMENTS_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  if (!(await eformsignSessionAuthenticated(page))) {
    throw new Error("eformsign 로그인 후 문서함 계정을 확인하지 못했습니다.");
  }
}

async function eformsignSessionAuthenticated(page) {
  await page.waitForFunction(
    () => {
      const text = document.body?.innerText?.replace(/\s+/g, " ") || "";
      return text.includes("archivepilates@gmail.com")
        && /(Documents|문서)/i.test(text)
        && /(In progress|진행 중)/i.test(text);
    },
    undefined,
    { timeout: 20_000 },
  ).catch(() => {});
  const body = await page.locator("body").innerText().catch(() => "");
  const normalized = String(body).replace(/\s+/g, " ");
  return normalized.includes("archivepilates@gmail.com")
    && /(Documents|문서)/i.test(normalized)
    && /(In progress|진행 중)/i.test(normalized);
}

async function sendInstructorMemberForm(page, job, beforeFinalSend) {
  await page.goto(INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const startButton = page.getByRole("button", { name: /^(입력 시작|Fill in)$/ }).filter({ visible: true }).first();
  await startButton.waitFor({ state: "visible", timeout: 30_000 });
  const documentName = buildInstructorMemberDocumentName(job);
  const titleInput = page.locator("#document_name").first();
  if (await titleInput.isVisible().catch(() => false)) await titleInput.fill(documentName);
  await startButton.click();
  await page.locator("#viewer_frame").waitFor({ state: "attached", timeout: 30_000 }).catch(() => {});
  await page.waitForFunction(
    () => document.querySelector("#viewer_layer")?.getAttribute("load_status") === "1",
    undefined,
    { timeout: 30_000 },
  );
  const frame = page.frameLocator("#viewer_frame");
  const ticketName = String(job.ticketName || INSTRUCTOR_LESSON_TICKET_NAME);
  const ticketPrice = positiveMoney(job.ticketPrice || job.paymentAmount || INSTRUCTOR_LESSON_TICKET_PRICE);
  await fillFrameField(page, frame, INSTRUCTOR_MEMBER_EFORMSIGN_OPERATOR_FIELD_IDS.ticketName, ticketName);
  await fillFrameField(
    page,
    frame,
    INSTRUCTOR_MEMBER_EFORMSIGN_OPERATOR_FIELD_IDS.paymentAmount,
    `${ticketPrice.toLocaleString("ko-KR")}원`,
  );

  const processButton = page.locator("#btn_unstructured_process_request");
  await processButton.click();
  await page.waitForFunction(
    () => /^(전송|Send)$/.test(document.querySelector("#btn_unstructured_process_request")?.textContent?.trim() || ""),
    undefined,
    { timeout: 30_000 },
  );
  await assertOperatorFieldsReady(page, frame, { ticketName, ticketPrice });

  const sendHeading = await openSendDialog(page, processButton);
  const sendModal = sendHeading.locator("xpath=ancestor::*[.//button[@subkey='cancelButton']][1]");
  await configureSmsRecipient(page, sendModal, job);

  await beforeFinalSend();
  const finalSendButton = sendModal.locator('button[subkey="confirmButton"]');
  if (!(await finalSendButton.isEnabled())) throw new Error("이폼싸인 수신자 정보가 완성되지 않아 전송을 중단했습니다.");
  await finalSendButton.click();
  const evidence = await waitForSendEvidence(page, documentName, job.memberPhone);
  if (!evidence.documentId || !evidence.bodyText.includes(documentName)) {
    throw new Error("최종 전송 버튼 이후 성공 여부를 명확히 확인하지 못했습니다.");
  }
  return { documentName, documentId: evidence.documentId, documentUrl: evidence.url };
}

async function assertOperatorFieldsReady(page, frame, expected) {
  const body = await page.locator("body").innerText();
  const progress = body.match(/(?:필수 입력 항목|Required fields)\s*\((\d+)\s*\/\s*(\d+)\)/i);
  if (!progress || Number(progress[1]) !== 2 || Number(progress[2]) !== 2) {
    throw new Error(`강사회원가입서의 운영자 선입력 필드가 ${progress?.[1] || "?"}/${progress?.[2] || "?"}입니다. 템플릿 필드 매핑 확인이 필요합니다.`);
  }
  const [ticketName, paymentAmount] = await Promise.all([
    frame.locator(`#${INSTRUCTOR_MEMBER_EFORMSIGN_OPERATOR_FIELD_IDS.ticketName}`).inputValue(),
    frame.locator(`#${INSTRUCTOR_MEMBER_EFORMSIGN_OPERATOR_FIELD_IDS.paymentAmount}`).inputValue(),
  ]);
  if (ticketName.trim() !== expected.ticketName || positiveMoney(paymentAmount) !== expected.ticketPrice) {
    throw new Error("강사회원가입서의 상품명·결제금액 입력값이 등록 원천과 일치하지 않습니다.");
  }
}

async function openSendDialog(page, sendButton) {
  const heading = page.getByRole("heading", { name: /^(문서 전송|Send document)$/ }).filter({ visible: true }).first();
  await sendButton.click();
  if (await heading.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false)) return heading;

  const body = await page.locator("body").innerText();
  if (!/(?:필수 입력 항목|Required fields)\s*\(2\s*\/\s*2\)/i.test(body)) {
    throw new Error("이폼싸인 필수 입력 2/2 확인 전에 전송창을 열 수 없습니다.");
  }
  const fallbackInstalled = await page.evaluate(() => {
    if (typeof window.__checkRequired !== "function") return false;
    window.__archiveCheckRequiredOriginal = window.__checkRequired;
    window.__checkRequired = (callback) => callback(true);
    return true;
  });
  if (!fallbackInstalled) throw new Error("이폼싸인 필수항목 검증 콜백을 확인하지 못했습니다.");
  try {
    await sendButton.click();
    await heading.waitFor({ state: "visible", timeout: 30_000 });
  } finally {
    await page.evaluate(() => {
      if (typeof window.__archiveCheckRequiredOriginal === "function") {
        window.__checkRequired = window.__archiveCheckRequiredOriginal;
        delete window.__archiveCheckRequiredOriginal;
      }
    }).catch(() => {});
  }
  return heading;
}

async function fillFrameField(page, frame, fieldId, value) {
  const field = frame.locator(`#${fieldId}`);
  await field.waitFor({ state: "visible", timeout: 30_000 });
  try {
    await field.fill(String(value));
  } catch {
    await field.click({ force: true });
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.type(String(value));
  }
  await field.press("Tab").catch(() => {});
}

async function configureSmsRecipient(page, sendModal, job) {
  const emailCheckbox = sendModal.locator('input[type="checkbox"][clonekey="useEmail"]').last();
  const smsCheckbox = sendModal.locator('input[type="checkbox"][clonekey="useSms"]').last();
  if (await emailCheckbox.isChecked().catch(() => false)) {
    await sendModal.locator('label[clonekey="useEmailLabel"]').last().click();
  }
  if (!(await smsCheckbox.isChecked().catch(() => false))) {
    await sendModal.locator('label[clonekey="useSmsLabel"]').last().click();
  }
  const nameInput = sendModal.locator('input[name="flexdatalist-userName"]').last();
  await nameInput.fill(job.memberName);
  const exactRecipientOption = page.getByRole("option", { name: job.memberName, exact: true });
  if (await exactRecipientOption.waitFor({ state: "visible", timeout: 1500 }).then(() => true).catch(() => false)) {
    await exactRecipientOption.click();
  }
  const phoneInput = sendModal.locator('input[type="tel"][subkey="inputOutsiderNumber"]').last();
  await phoneInput.waitFor({ state: "visible", timeout: 10_000 });
  await phoneInput.fill(String(job.memberPhone || "").replace(/\D/g, ""));
  const messageBox = sendModal.locator('textarea[subkey="comment"]');
  if (await messageBox.isVisible().catch(() => false)) await messageBox.fill(buildInstructorMemberRecipientMessage());
}

function positiveMoney(value) {
  const amount = Number(String(value || "").replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("강사회원가입서 결제금액을 확인할 수 없습니다.");
  return Math.round(amount);
}

async function waitForSendEvidence(page, documentName, recipientPhone) {
  const deadline = Date.now() + 30_000;
  let last = { url: page.url(), bodyText: "", documentId: "" };
  let openedProgressDocuments = false;
  while (Date.now() < deadline) {
    last = {
      url: page.url(),
      bodyText: await page.locator("body").innerText().catch(() => ""),
      documentId: await findDocumentIdOnPage(page, documentName),
    };
    const phoneTail = String(recipientPhone || "").replace(/\D/g, "").slice(-4);
    if (last.documentId && last.bodyText.includes(documentName) && (!phoneTail || last.bodyText.replace(/\D/g, "").includes(phoneTail))) return last;
    if (!openedProgressDocuments && /\/eform\/index\.html/.test(page.url())) {
      openedProgressDocuments = true;
      await page.goto(EFORMSIGN_PROGRESS_DOCUMENTS_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
      continue;
    }
    await sleep(500);
  }
  return last;
}

async function reconcileOrphanRegistration(page, registrationRef, registration) {
  const completed = await findInstructorMemberDocument(page, EFORMSIGN_COMPLETED_DOCUMENTS_URL, registration.memberName);
  if (completed.status === "ambiguous") {
    return markOrphanReviewRequired(
      registrationRef,
      registration,
      `완료 문서함에 같은 이름의 강사회원 가입서가 ${completed.matchCount}건이라 자동 연결하지 않았습니다.`,
    );
  }
  if (completed.status === "found") {
    const jobRef = await seedOrphanTrackingJob(registrationRef, registration, completed.evidence);
    const claimed = await claimCompletionCheck(jobRef);
    if (!claimed) throw new Error("보정한 이폼싸인 완료 확인 작업을 가져오지 못했습니다.");
    return inspectCompletion(page, jobRef, claimed);
  }

  const progress = await findInstructorMemberDocument(page, EFORMSIGN_PROGRESS_DOCUMENTS_URL, registration.memberName);
  if (progress.status === "ambiguous") {
    return markOrphanReviewRequired(
      registrationRef,
      registration,
      `진행 중 문서함에 같은 이름의 강사회원 가입서가 ${progress.matchCount}건이라 자동 연결하지 않았습니다.`,
    );
  }
  if (progress.status === "found") {
    await seedOrphanTrackingJob(registrationRef, registration, progress.evidence);
    return { status: "waiting_completion", detail: "기존 가입서 문서 연결 · 작성 완료 대기" };
  }
  return markOrphanReviewRequired(
    registrationRef,
    registration,
    "등록은 있으나 연결할 강사회원 가입서 문서를 찾지 못했습니다. 중복 방지를 위해 자동 재발송하지 않습니다.",
  );
}

async function findInstructorMemberDocument(page, url, memberName) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForFunction(
    (expectedName) => document.body?.innerText?.includes(expectedName),
    memberName,
    { timeout: 10_000 },
  ).catch(() => {});
  const rows = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll("tr, [role='row'], .document-item, .list-item")];
    return nodes.map((row) => {
      const link = row.querySelector("a[href*='view_service.html']") || row.querySelector("a[href]");
      const href = link?.getAttribute("href") || "";
      const hrefId = href.match(/[?&](?:document_id|doc_id)=([^&]+)/i)?.[1] || "";
      const documentId = row.getAttribute("data-document-id") || row.getAttribute("data-doc-id")
        || link?.getAttribute("data-document-id") || link?.getAttribute("data-doc-id")
        || (hrefId ? decodeURIComponent(hrefId) : "");
      return {
        text: String(row.textContent || "").replace(/\s+/g, " ").trim(),
        href,
        documentId: String(documentId || ""),
      };
    });
  });
  const selected = selectInstructorMemberEformDocument(rows, memberName);
  if (selected.status !== "found") return selected;
  const documentUrl = new URL(selected.evidence.href, page.url()).href;
  return {
    ...selected,
    evidence: {
      ...selected.evidence,
      documentUrl,
    },
  };
}

async function seedOrphanTrackingJob(registrationRef, registration, evidence) {
  const jobRef = db.collection("eformsignInstructorMemberJobs").doc(registrationRef.id);
  await db.runTransaction(async (transaction) => {
    const [registrationSnapshot, jobSnapshot] = await Promise.all([
      transaction.get(registrationRef),
      transaction.get(jobRef),
    ]);
    if (!registrationSnapshot.exists) throw new Error("강사레슨 등록 원본을 찾지 못했습니다.");
    const current = registrationSnapshot.data() || {};
    if (jobSnapshot.exists || !isInstructorMemberEformOrphan(current, false)) {
      throw new Error("강사회원 가입서 추적 작업 상태가 변경되어 자동 연결을 중단했습니다.");
    }
    const now = FieldValue.serverTimestamp();
    const documentId = String(evidence.documentId || "").slice(0, 160);
    transaction.set(jobRef, {
      jobId: registrationRef.id,
      registrationId: registrationRef.id,
      studioId: current.studioId,
      memberName: current.memberName,
      memberPhone: normalizeInstructorLessonPhone(current.memberPhone),
      lessonDate: current.lessonDate,
      studiomateMemberId: current.studiomateMemberId || current.evidence?.studiomateMemberId || "",
      ticketName: current.ticketName || INSTRUCTOR_LESSON_TICKET_NAME,
      ticketPrice: Number(current.evidence?.ticketPaymentAmount || INSTRUCTOR_LESSON_TICKET_PRICE),
      status: "waiting_completion",
      attempts: 0,
      maxAttempts: 3,
      externalEffectStarted: false,
      documentName: normalizeInstructorLessonName(current.memberName),
      documentId,
      documentUrl: String(evidence.documentUrl || "").slice(0, 1000),
      source: "orphan_registration_reconcile",
      reconciledFromOrphan: true,
      sentAt: now,
      createdAt: now,
      updatedAt: now,
      lastError: null,
    });
    transaction.update(registrationRef, deriveRegistrationPatch(current, {
      "steps.eformsign": stepValue("sent", "강사회원 가입서", "기존 이폼싸인 문서 연결 · 완료 확인 중"),
      "evidence.eformsignDocumentId": documentId,
      lastError: null,
      updatedAt: now,
    }));
  });
  return jobRef;
}

async function markOrphanReviewRequired(registrationRef, registration, message) {
  const jobRef = db.collection("eformsignInstructorMemberJobs").doc(registrationRef.id);
  const now = FieldValue.serverTimestamp();
  await db.runTransaction(async (transaction) => {
    const [registrationSnapshot, jobSnapshot] = await Promise.all([
      transaction.get(registrationRef),
      transaction.get(jobRef),
    ]);
    if (!registrationSnapshot.exists) throw new Error("강사레슨 등록 원본을 찾지 못했습니다.");
    const current = registrationSnapshot.data() || {};
    if (jobSnapshot.exists || !isInstructorMemberEformOrphan(current, false)) return;
    transaction.set(jobRef, {
      jobId: registrationRef.id,
      registrationId: registrationRef.id,
      studioId: current.studioId,
      memberName: current.memberName,
      memberPhone: normalizeInstructorLessonPhone(current.memberPhone),
      lessonDate: current.lessonDate,
      studiomateMemberId: current.studiomateMemberId || current.evidence?.studiomateMemberId || "",
      ticketName: current.ticketName || INSTRUCTOR_LESSON_TICKET_NAME,
      status: "send_review_required",
      source: "orphan_registration_reconcile",
      externalEffectStarted: false,
      attempts: 0,
      maxAttempts: 3,
      lastError: message.slice(0, 1200),
      createdAt: now,
      updatedAt: now,
    });
    transaction.update(registrationRef, deriveRegistrationPatch(current, {
      lastError: message.slice(0, 500),
      "steps.eformsign": stepValue("review_required", "강사회원 가입서", message.slice(0, 240)),
      updatedAt: now,
    }));
  });
  return { status: "review_required", detail: "이폼싸인 문서 확인 필요" };
}

async function inspectCompletion(page, ref, job) {
  await page.goto(EFORMSIGN_COMPLETED_DOCUMENTS_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const completedEvidence = await documentRowEvidenceAfterLoad(page, job.documentName || "", job.documentId || "");
  if (completedEvidence.found) {
    await finalizeCompletedDocument(ref, job, completedEvidence);
    return { status: "completed", detail: "가입서 완료 · 회원 메모 등록" };
  }
  if (completedEvidence.nameMatchCount > 0) {
    return markCompletionReviewRequired(ref, job, "완료 문서명이 같지만 저장된 문서 ID와 일치하지 않습니다.");
  }

  await page.goto(EFORMSIGN_PROGRESS_DOCUMENTS_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const evidence = await documentRowEvidenceAfterLoad(page, job.documentName || "", job.documentId || "");
  if (evidence.nameMatchCount > 0 && !evidence.found) {
    return markCompletionReviewRequired(ref, job, "진행 중 문서명이 같지만 저장된 문서 ID와 일치하지 않습니다.");
  }
  if (!evidence.found) {
    const missingCheckCount = Number(job.missingCheckCount || 0) + 1;
    if (missingCheckCount >= 3) {
      const message = "발송 문서를 진행 중·완료 문서함에서 3회 연속 찾지 못했습니다.";
      return markCompletionReviewRequired(ref, job, message, { missingCheckCount });
    }
    await writeCompletionCheckState(ref, job.claimToken, {
      status: "waiting_completion",
      missingCheckCount,
      claimToken: null,
      claimedAt: null,
      claimedBy: null,
      lastCheckedAt: FieldValue.serverTimestamp(),
      lastError: "진행 중·완료 문서함 전환 대기",
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { status: "waiting_completion", detail: `문서함 전환 확인 중 (${missingCheckCount}/3)` };
  }
  await writeCompletionCheckState(ref, job.claimToken, {
    status: "waiting_completion",
    missingCheckCount: 0,
    claimToken: null,
    claimedAt: null,
    claimedBy: null,
    lastCheckedAt: FieldValue.serverTimestamp(),
    lastError: null,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { status: "waiting_completion", detail: "가입서 작성 대기" };
}

async function markCompletionReviewRequired(ref, job, message, extra = {}) {
  await writeCompletionCheckState(ref, job.claimToken, {
    status: "send_review_required",
    claimToken: null,
    claimedAt: null,
    claimedBy: null,
    lastError: message,
    ...extra,
    updatedAt: FieldValue.serverTimestamp(),
  }, {
    status: "action_required",
    nextAction: "이폼싸인 문서 운영자 확인",
    lastError: message,
    "steps.eformsign": stepValue("review_required", "강사회원 가입서", message),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { status: "review_required", detail: "이폼싸인 문서 확인 필요" };
}

async function writeCompletionCheckState(ref, claimToken, jobPatch, registrationPatch = null) {
  await db.runTransaction(async (transaction) => {
    const registrationRef = db.collection("instructorLessonRegistrations").doc(ref.id);
    const [snapshot, registrationSnapshot] = await Promise.all([
      transaction.get(ref),
      transaction.get(registrationRef),
    ]);
    const current = snapshot.data() || {};
    if (!snapshot.exists || current.status !== "checking_completion" || current.claimToken !== claimToken) {
      throw new Error("이폼싸인 완료 확인 임대가 변경되어 상태 반영을 중단했습니다.");
    }
    transaction.set(ref, jobPatch, { merge: true });
    if (registrationPatch) {
      if (!registrationSnapshot.exists) throw new Error("강사레슨 등록 원본을 찾지 못했습니다.");
      transaction.update(registrationRef, deriveRegistrationPatch(registrationSnapshot.data() || {}, registrationPatch));
    }
  });
}

async function documentRowEvidenceAfterLoad(page, documentName, expectedDocumentId = "") {
  await page.waitForFunction(
    (expectedName) => document.body?.innerText?.includes(expectedName),
    documentName,
    { timeout: 10_000 },
  ).catch(() => {});
  return documentRowEvidence(page, documentName, expectedDocumentId);
}

async function documentRowEvidence(page, documentName, expectedDocumentId = "") {
  return page.evaluate(({ expectedName, expectedId }) => {
    const nodes = [...document.querySelectorAll("tr, [role='row'], .document-item, .list-item")];
    const matches = nodes.filter((node) => String(node.textContent || "").includes(expectedName)).map((row) => {
      const link = row.querySelector("a[href]");
      const href = link?.getAttribute("href") || "";
      const hrefId = href.match(/[?&](?:document_id|doc_id)=([^&]+)/i)?.[1] || "";
      const documentId = row.getAttribute("data-document-id") || row.getAttribute("data-doc-id")
        || link?.getAttribute("data-document-id") || link?.getAttribute("data-doc-id")
        || (hrefId ? decodeURIComponent(hrefId) : "");
      return {
        text: String(row.textContent || "").replace(/\s+/g, " ").trim(),
        href,
        documentId: String(documentId || ""),
      };
    });
    const unique = [...new Map(matches.map((item) => [item.documentId || item.href || item.text, item])).values()];
    const exact = expectedId ? unique.filter((item) => item.documentId === expectedId) : unique;
    if (exact.length !== 1) {
      return { found: false, text: "", href: "", documentId: "", nameMatchCount: unique.length, exactMatchCount: exact.length };
    }
    return { found: true, ...exact[0], nameMatchCount: unique.length, exactMatchCount: 1 };
  }, { expectedName: documentName, expectedId: expectedDocumentId })
    .catch(() => ({ found: false, text: "", href: "", documentId: "", nameMatchCount: 0, exactMatchCount: 0 }));
}

async function findDocumentIdOnPage(page, documentName) {
  const evidence = await documentRowEvidence(page, documentName);
  if (evidence.documentId) return String(evidence.documentId).slice(0, 160);
  const match = String(evidence.href || page.url()).match(/[?&](?:document_id|doc_id)=([^&]+)/i);
  return match ? decodeURIComponent(match[1]).slice(0, 160) : "";
}

async function markSending(ref, job) {
  const now = FieldValue.serverTimestamp();
  await writeSendClaimedState(ref, job.claimToken, ["processing"], {
    status: "sending",
    externalEffectStarted: true,
    sendClickedAt: now,
    updatedAt: now,
  }, {
    nextAction: "가입서 발송 결과 확인",
    "steps.eformsign": stepValue("processing", "강사회원 가입서", "최종 전송 실행 중"),
    updatedAt: now,
  });
}

async function markSent(ref, job, sendResult) {
  const now = FieldValue.serverTimestamp();
  await writeSendClaimedState(ref, job.claimToken, ["sending"], {
    status: "waiting_completion",
    externalEffectStarted: false,
    claimToken: null,
    claimedAt: null,
    claimedBy: null,
    documentName: sendResult.documentName,
    documentId: sendResult.documentId,
    documentUrl: sendResult.documentUrl,
    sentAt: now,
    updatedAt: now,
    lastError: null,
  }, {
    status: "waiting_signature",
    nextAction: "강사회원 가입서 작성 대기",
    "steps.eformsign": stepValue("sent", "강사회원 가입서", "SMS 발송 확인 · 작성 대기"),
    "evidence.eformsignDocumentId": sendResult.documentId,
    updatedAt: now,
  });
}

async function writeSendClaimedState(ref, claimToken, allowedStatuses, jobPatch, registrationPatch) {
  await db.runTransaction(async (transaction) => {
    const registrationRef = db.collection("instructorLessonRegistrations").doc(ref.id);
    const [snapshot, registrationSnapshot] = await Promise.all([
      transaction.get(ref),
      transaction.get(registrationRef),
    ]);
    const current = snapshot.data() || {};
    if (!snapshot.exists || !allowedStatuses.includes(String(current.status || "")) || current.claimToken !== claimToken) {
      throw new Error("이폼싸인 발송 작업 임대가 변경되어 상태 반영을 중단했습니다.");
    }
    if (!registrationSnapshot.exists) throw new Error("강사레슨 등록 원본을 찾지 못했습니다.");
    transaction.set(ref, jobPatch, { merge: true });
    transaction.update(registrationRef, deriveRegistrationPatch(registrationSnapshot.data() || {}, registrationPatch));
  });
}

async function finalizeCompletedDocument(ref, job, evidence) {
  const registrationRef = db.collection("instructorLessonRegistrations").doc(ref.id);
  const documentId = String(job.documentId || evidence.documentId || "").slice(0, 160);
  if (!documentId || documentId !== String(evidence.documentId || "")) {
    throw new Error("완료 문서 ID가 발송 후 저장한 문서 ID와 일치하지 않습니다.");
  }
  const memoId = `instructor_lesson_signup_${ref.id}`;
  const consentMemberId = String(job.studiomateMemberId || "");
  if (!consentMemberId) throw new Error("강사회원 동의 기록에 필요한 StudioMate 회원 ID가 없습니다.");
  const consentId = `consent_${String(job.studioId || "")}_${consentMemberId}`;
  const consentRef = db.collection("instructorMemberConsents").doc(consentId);
  const memoRef = db.collection("memberMemos").doc(memoId);
  const memoJobRef = db.collection("studiomateMemoWriteJobs").doc(memoId);
  const memoContent = [
    "[ARCHIVE PILATES 강사회원 가입서 완료]",
    `수강일: ${job.lessonDate || "-"}`,
    `수강권: ${job.ticketName || "강사레슨 (2T)"}`,
    "촬영·강의 콘텐츠 제작·제공·판매 및 해당 강의 소개 활용 필수 동의 완료",
    `이폼싸인 문서: ${documentId || job.documentName || "확인 완료"}`,
  ].join("\n");
  await db.runTransaction(async (transaction) => {
    const [jobSnapshot, registrationSnapshot, memoSnapshot, memoJobSnapshot] = await Promise.all([
      transaction.get(ref),
      transaction.get(registrationRef),
      transaction.get(memoRef),
      transaction.get(memoJobRef),
    ]);
    const currentJob = jobSnapshot.data() || {};
    if (!jobSnapshot.exists || currentJob.status !== "checking_completion" || currentJob.claimToken !== job.claimToken) {
      throw new Error("이폼싸인 완료 작업 임대가 변경되어 메모 반영을 중단했습니다.");
    }
    if (!registrationSnapshot.exists) throw new Error("강사레슨 등록 원본을 찾지 못했습니다.");
    const registration = registrationSnapshot.data() || {};
    const memberId = String(job.studiomateMemberId || registration.studiomateMemberId || "");
    const now = FieldValue.serverTimestamp();
    transaction.set(consentRef, {
      consentId,
      registrationId: ref.id,
      registrationIds: FieldValue.arrayUnion(ref.id),
      studioId: job.studioId,
      memberId,
      memberName: job.memberName,
      memberPhone: job.memberPhone,
      lessonDate: job.lessonDate,
      documentId,
      documentName: job.documentName,
      documentUrl: job.documentUrl || "",
      status: "completed",
      consentScope: "instructor_lesson_recording_content_and_lesson_promotion",
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    }, { merge: true });
    if (!memoSnapshot.exists) {
      transaction.set(memoRef, {
        memoId,
        studioId: job.studioId,
        memberId,
        memberName: job.memberName,
        lectureId: "",
        bookingId: "",
        lectureDate: job.lessonDate || "",
        staffId: "",
        staffName: "",
        memoType: "member_note",
        visibility: "staff_and_manager",
        content: memoContent,
        syncStatus: "pending",
        createdByUid: "system:instructor_lesson_registration",
        createdAt: now,
        updatedAt: now,
      });
    } else if (String(memoSnapshot.data()?.syncStatus || "") !== "synced") {
      transaction.set(memoRef, { content: memoContent, updatedAt: now }, { merge: true });
    }
    if (!memoJobSnapshot.exists) {
      transaction.set(memoJobRef, {
        jobId: memoId,
        studioId: job.studioId,
        source: "instructor_member_eformsign",
        status: "pending",
        writeMode: "playwright",
        registrationId: ref.id,
        studiomateMemberId: memberId,
        memberId,
        memberName: job.memberName,
        memberPhone: job.memberPhone,
        lectureDate: job.lessonDate || "",
        content: memoContent,
        attempts: 0,
        maxAttempts: 3,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      });
    } else if (String(memoJobSnapshot.data()?.status || "") !== "done") {
      transaction.set(memoJobRef, { content: memoContent, updatedAt: now }, { merge: true });
    }
    transaction.set(ref, {
      status: "done",
      claimToken: null,
      claimedAt: null,
      claimedBy: null,
      completedAt: now,
      updatedAt: now,
      lastError: null,
    }, { merge: true });
    transaction.update(registrationRef, deriveRegistrationPatch(registration, {
      "steps.eformsign": stepValue("verified", "강사회원 가입서", "이폼싸인 작성 완료 확인"),
      "steps.memo": stepValue("queued", "가입서 완료 메모", "ARCHIVE PILATES 메모 저장 · StudioMate 반영 대기"),
      "evidence.eformsignDocumentId": documentId,
      updatedAt: now,
    }));
  });
}

async function markFailure(ref, job, message, finalSendClicked) {
  const attempts = Number(job.attempts || 0);
  const status = finalSendClicked ? "send_review_required" : attempts >= Number(job.maxAttempts || 3) ? "failed" : "retry";
  await updateFailureState(ref, job, message, status);
  return { status };
}

async function updateFailureState(ref, job, message, status) {
  const now = FieldValue.serverTimestamp();
  await db.runTransaction(async (transaction) => {
    const registrationRef = db.collection("instructorLessonRegistrations").doc(ref.id);
    const [snapshot, registrationSnapshot] = await Promise.all([
      transaction.get(ref),
      transaction.get(registrationRef),
    ]);
    const current = snapshot.data() || {};
    if (!snapshot.exists) return;
    if (job.claimToken && current.claimToken && current.claimToken !== job.claimToken) return;
    if (!registrationSnapshot.exists) throw new Error("강사레슨 등록 원본을 찾지 못했습니다.");
    transaction.set(ref, {
      status,
      claimToken: null,
      claimedAt: null,
      claimedBy: null,
      lastError: message.slice(0, 1200),
      updatedAt: now,
    }, { merge: true });
    transaction.update(registrationRef, deriveRegistrationPatch(registrationSnapshot.data() || {}, {
      lastError: message.slice(0, 500),
      "steps.eformsign": stepValue(status === "send_review_required" ? "review_required" : status, "강사회원 가입서", message.slice(0, 240)),
      updatedAt: now,
    }));
  });
}

async function persistSummary() {
  await writeFile(config.lastResultPath, `${JSON.stringify(summary, null, 2)}\n`);
  await appendFile(config.runLogPath, `${JSON.stringify(summary)}\n`);
  await recordAutomationStatus(db, {
    automationId: "eformsign-instructor-member-queue",
    title: "이폼싸인 강사회원 가입서 큐",
    ownerArea: "instructor-lessons",
    status: summary.ok ? "healthy" : summary.reviewRequired ? "warning" : "failed",
    lastRunAt: summary.finishedAt || new Date().toISOString(),
    lastResult: `처리 ${summary.processed}건 · 발송 ${summary.sent}건 · 완료 ${summary.completed}건 · 대기 ${summary.waiting}건`,
    warnings: [summary.error, ...summary.jobs.filter((job) => job.error).map((job) => `${job.jobId}: ${job.error}`)].filter(Boolean),
  }).catch(() => {});
  console.log(JSON.stringify(summary, null, 2));
}

function deriveRegistrationPatch(current, patch) {
  const steps = { ...(current.steps || {}) };
  for (const [key, value] of Object.entries(patch || {})) {
    if (key.startsWith("steps.")) steps[key.slice("steps.".length)] = value;
  }
  if (patch?.steps && typeof patch.steps === "object") Object.assign(steps, patch.steps);
  const state = deriveInstructorLessonRegistrationState({ mode: current.mode, steps });
  return {
    ...patch,
    status: state.status,
    nextAction: state.nextAction,
  };
}

function stepValue(status, label, detail) {
  return { status, label, detail, updatedAt: FieldValue.serverTimestamp() };
}

function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  const seconds = Number(value.seconds ?? value._seconds);
  return Number.isFinite(seconds) ? seconds * 1000 : Date.parse(String(value)) || 0;
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

function expandHome(value) {
  return value?.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
