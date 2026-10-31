#!/usr/bin/env node
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { memberDispatchWindow, assertMemberDispatchAllowed, isMemberDispatchDeferred } from "./lib/member-dispatch-window.mjs";
import os from "node:os";
import { readNativeRefundSource, refundNativeMemberPointer } from "./lib/studiomate-refund-native-source.mjs";
import path from "node:path";
import { acquireStudioMateBrowserLock } from "./lib/studiomate-browser-lock.mjs";
import { ensureStudioMateLoggedIn } from "./lib/studiomate-login.mjs";
import { appendIdleHeartbeatIfDue } from "./lib/idle-heartbeat.mjs";
import { recordAutomationStatus } from "./lib/archive-core-ops-logging.mjs";
import { sendMemberSms, memberSmsReceiptFields } from "./lib/member-sms-solapi.mjs";
import {
  assertRefundSmsSourceUnchanged,
  classifyStudioMateSmsSendEvidence,
  normalizeRefundSmsJob,
  staleRefundSmsJobRecoveryStatus,
} from "./lib/studiomate-refund-sms-contract.mjs";

const args = parseArgs(process.argv.slice(2));
const apply = Boolean(args.apply);
const config = {
  projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "archive-pilates",
  baseUrl: process.env.STUDIOMATE_WEB_BASE_URL || "https://arcpilates.studiomate.kr",
  profileDir: expandHome(process.env.STUDIOMATE_EMERGENCY_PROFILE_DIR || "~/ArchiveIN/automation/browser-profile"),
  runLogPath: expandHome(process.env.STUDIOMATE_REFUND_SMS_RUN_LOG || "~/ArchiveIN/emergency/runs/studiomate-refund-sms.jsonl"),
  lastResultPath: expandHome(
    process.env.STUDIOMATE_REFUND_SMS_LAST_RESULT || "~/ArchiveIN/automation/reports/studiomate-refund-sms/latest.json",
  ),
  headless: process.env.HEADLESS !== "false",
  waitForLogin: process.env.WAIT_FOR_LOGIN === "true",
  jobId: String(args["job-id"] || process.env.STUDIOMATE_REFUND_SMS_JOB_ID || ""),
  limit: Math.max(1, Math.min(3, Number(args.limit || process.env.STUDIOMATE_REFUND_SMS_LIMIT || "1"))),
  staleLeaseMs: Math.max(5 * 60 * 1000, Number(process.env.STUDIOMATE_REFUND_SMS_STALE_LEASE_MS || 15 * 60 * 1000)),
};

const summary = {
  ok: false,
  mode: apply ? "apply" : "dry-run",
  source: "solapi_refund_sms_queue",
  startedAt: new Date().toISOString(),
  processed: 0,
  sent: 0,
  retried: 0,
  reviewRequired: 0,
  failed: 0,
  jobs: [],
};

await mkdir(path.dirname(config.runLogPath), { recursive: true });
await mkdir(path.dirname(config.lastResultPath), { recursive: true });
const dispatchWindow = memberDispatchWindow();
if (!dispatchWindow.allowed) {
  Object.assign(summary, dispatchWindow, { ok: true, status: "deferred", finishedAt: new Date().toISOString() });
  await writeFile(config.lastResultPath, `${JSON.stringify(summary, null, 2)}\n`);
  appendIdleHeartbeatIfDue(config.runLogPath, summary, 30 * 60 * 1000);
  console.log(JSON.stringify(summary));
  process.exit(0);
}

const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: config.projectId });
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
await mkdir(config.profileDir, { recursive: true });

if (apply) await recoverStaleJobs();
const candidates = await loadCandidates(config.limit);
if (!candidates.length) {
  summary.ok = true;
  summary.finishedAt = new Date().toISOString();
  appendIdleHeartbeatIfDue(config.runLogPath, summary, 30 * 60 * 1000);
  await persistSummary();
  process.exit(0);
}

if (!apply) {
  summary.ok = true;
  summary.jobs = candidates.map(({ ref, data }) => ({ jobId: ref.id, status: data.status, dryRun: true }));
  summary.finishedAt = new Date().toISOString();
  await persistSummary();
  process.exit(0);
}

let context = null;
let releaseLock = null;
try {
  releaseLock = await acquireStudioMateBrowserLock({ owner: "studiomate-refund-sms-queue" });
  const { chromium } = await import("playwright");
  context = await chromium.launchPersistentContext(config.profileDir, {
    headless: config.headless,
    viewport: { width: 1280, height: 900 },
  });
  await context.route('**/*', route => ['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) ? route.continue() : route.abort());
  const page = context.pages()[0] || await context.newPage();
  await page.goto(new URL("/users", config.baseUrl).toString(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await ensureStudioMateLoggedIn(page, { headless: config.headless, waitForLogin: config.waitForLogin });

  for (const candidate of candidates) {
    if (!memberDispatchWindow().allowed) { Object.assign(summary, memberDispatchWindow(), { status: "deferred" }); break; }
    const claimed = await claimJob(candidate.ref);
    if (!claimed) continue;
    summary.processed += 1;
    const item = { jobId: candidate.ref.id, status: "processing" };
    let finalSendClicked = false;
    try {
      const job = normalizeRefundSmsJob({ ...claimed, jobId: candidate.ref.id });
      const live = await assertLiveRefundSource(job, page);
      const sendResult = await sendRefundSms(page, job, live.nativeSource.studiomateMemberId, async () => {
        const fresh = await assertLiveRefundSource(job, page);
        if (fresh.nativeSource.studiomateMemberId !== live.nativeSource.studiomateMemberId) throw new Error("발송 직전 회원 원본 ID가 변경되어 문자를 중단했습니다.");
        assertMemberDispatchAllowed();
        await markSending(candidate.ref, { ...job, dispatchToken: claimed.dispatchToken });
        return () => { finalSendClicked = true; };
      });
      await markSent(candidate.ref, job, sendResult);
      item.status = "sent";
      item.evidence = sendResult.evidence;
      summary.sent += 1;
    } catch (error) {
      if (isMemberDispatchDeferred(error) && (!finalSendClicked || error.providerPostCount === 0)) {
        await deferClaim(candidate.ref, claimed);
        summary.processed -= 1;
        summary.deferred = (summary.deferred || 0) + 1;
        Object.assign(summary, memberDispatchWindow(), { status: "deferred" });
        Object.assign(item, memberDispatchWindow(), { status: "deferred" });
        summary.jobs.push(item);
        continue;
      }
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
    const snapshot = await db.collection("studiomateRefundSmsJobs").doc(config.jobId).get();
    if (!snapshot.exists || !["pending", "retry"].includes(String(snapshot.data()?.status || ""))) return [];
    return [{ ref: snapshot.ref, data: snapshot.data() }];
  }
  const snapshots = await Promise.all(
    ["pending", "retry"].map((status) =>
      db.collection("studiomateRefundSmsJobs").where("status", "==", status).limit(limit).get()),
  );
  return snapshots.flatMap((snapshot) => snapshot.docs.map((doc) => ({ ref: doc.ref, data: doc.data() })))
    .sort((a, b) => timestampMillis(a.data.queuedAt || a.data.createdAt) - timestampMillis(b.data.queuedAt || b.data.createdAt))
    .slice(0, limit);
}

async function recoverStaleJobs() {
  const snapshots = await Promise.all(
    ["processing", "sending"].map((status) =>
      db.collection("studiomateRefundSmsJobs").where("status", "==", status).limit(20).get()),
  );
  const nowMs = Date.now();
  for (const snapshot of snapshots) {
    for (const doc of snapshot.docs) {
      const data = doc.data();
      const leaseAt = timestampMillis(data.updatedAt || data.claimedAt);
      if (!leaseAt || nowMs - leaseAt < config.staleLeaseMs) continue;
      const status = staleRefundSmsJobRecoveryStatus(data);
      const message = status === "send_review_required"
        ? "이전 실행이 최종 문자 발송 단계에서 중단되었습니다. 정본·SOLAPI 및 기존 StudioMate 발송 이력을 확인하세요."
        : status === "retry"
          ? "이전 실행이 발송 버튼 클릭 전에 중단되어 안전하게 재시도합니다."
          : "이전 실행이 반복 중단되어 자동 재시도를 종료했습니다.";
      await updateJobAndCase(doc.ref, data.caseId, status, { lastError: message, recoveredAt: FieldValue.serverTimestamp() });
    }
  }
}

async function claimJob(ref) {
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || !["pending", "retry"].includes(String(snapshot.data()?.status || ""))) return null;
    const data = snapshot.data();
    if (data.sendClickedAt || data.externalEffectStarted) return null;
    const caseRef = db.collection("refundCases").doc(String(data.caseId));
    const caseData = (await transaction.get(caseRef)).data() || {};
    if (!memberDispatchWindow().allowed) return null;
    const dispatchToken = randomUUID();
    const attempts = Number(data.attempts || 0) + 1;
    transaction.set(ref, {
      status: "processing",
      dispatchToken,
      attempts,
      claimedBy: os.hostname(),
      claimedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      lastError: null,
    }, { merge: true });
    transaction.update(db.collection("refundCases").doc(String(data.caseId)), {
      "smsNotice.status": "processing",
      "smsNotice.updatedAt": FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { ...data, attempts, dispatchToken, dispatchUndo: {
      job: restoreFields(data, ["status", "attempts", "dispatchToken", "claimedBy", "claimedAt", "updatedAt", "lastError", "sendClickedAt", "transportProvider"]),
      case: restoreFields(caseData, ["smsNotice.status", "smsNotice.sendClickedAt", "smsNotice.updatedAt", "updatedAt"]),
    } };
  });
}

async function assertLiveRefundSource(job, page) {
  const [memberSnapshot, caseSnapshot] = await Promise.all([
    db.collection("memberProfiles").doc(job.memberId).get(),
    db.collection("refundCases").doc(job.caseId).get(),
  ]);
  if (!memberSnapshot.exists) throw new Error("환불 대상 회원 원천이 없어 문자 발송을 중단했습니다.");
  if (!caseSnapshot.exists) throw new Error("환불 케이스 원천이 없어 문자 발송을 중단했습니다.");
  assertRefundSmsSourceUnchanged(job, memberSnapshot.data(), caseSnapshot.data());
  const profile = memberSnapshot.data();
  const nativeSource = await readNativeRefundSource({ ...job, studiomateMemberId: refundNativeMemberPointer(job, profile) }, { page });
  return { profile, refundCase: caseSnapshot.data(), nativeSource };
}

async function sendRefundSms(page, job, studiomateMemberId, beforeFinalSend) {
  if (!/^[1-9]\d*$/.test(studiomateMemberId)) throw new Error("검증된 StudioMate 회원 ID가 없어 문자를 중단했습니다.");
  const plan = { ...job, key: job.jobId };
  const receipt = await sendMemberSms(plan, beforeFinalSend, { assertAllowed: () => assertMemberDispatchAllowed() });
  return {
    studiomateMemberId,
    ...memberSmsReceiptFields(receipt, plan),
    evidence: 'SOLAPI accepted; final delivery not verified',
    deliveryStatus: 'not_verified',
  };
}

async function assertRefundSmsRecipient(dialog, memberName) {
  const recipient = await textboxWithPlaceholder(dialog, "받는 사람을 선택해주세요.");
  if (await recipient.getAttribute("readonly") === null || await recipient.inputValue() !== memberName) {
    throw new Error("StudioMate 문자 수신자가 대상 회원과 일치하지 않습니다.");
  }
}

async function refundSmsConfirmation(page) {
  const confirmation = page.getByRole("dialog")
    .filter({ hasText: "메시지를 보내시겠습니까?" }).filter({ visible: true });
  await confirmation.waitFor({ state: "visible", timeout: 15000 });
  const text = await confirmation.innerText();
  const counts = text.match(/\d+\s*건/g) || [];
  if (await confirmation.count() !== 1 || !/^(?:메시지\s*보내기\s*)?1\s*건을\s*즉시\s*발송합니다!/.test(text.trim())
    || counts.length === 0 || counts.some((count) => count.replace(/\s/g, "") !== "1건")) {
    throw new Error("StudioMate 문자 발송 확인이 정확히 1건이 아니므로 중단했습니다.");
  }
  return confirmation;
}

function assertRefundSmsResponse(result, job, studiomateMemberId) {
  const body = result?.body;
  const payload = result?.requestPayload;
  if (result?.url !== "https://api.studiomate.kr/v2/staff/sms"
    || result.status !== 200 || !Number.isSafeInteger(body?.id) || body.id <= 0
    || String(body.studio_id) !== job.studioId || body.type !== "send"
    || (Object.hasOwn(body, "is_sent") && body.is_sent !== 1)
    || body.title !== job.smsTitle || body.message !== job.smsMessage
    || !Array.isArray(payload?.users) || payload.users.length !== 1
    || String(payload.users[0]) !== studiomateMemberId
    || payload.title !== job.smsTitle || payload.message !== job.smsMessage) {
    throw new Error("StudioMate 문자 응답의 발송 ID·스튜디오·제목·본문을 검증하지 못했습니다.");
  }
}

async function textboxWithPlaceholder(container, expected) {
  const boxes = container.getByRole("textbox");
  const count = await boxes.count();
  for (let index = 0; index < count; index += 1) {
    const box = boxes.nth(index);
    if ((await box.getAttribute("placeholder")) === expected) return box;
  }
  throw new Error(`StudioMate 입력란을 찾지 못했습니다: ${expected}`);
}

async function markSending(ref, job) {
  const now = FieldValue.serverTimestamp();
  await db.runTransaction(async tx => {
    const current = (await tx.get(ref)).data();
    if (!job.dispatchToken || current?.dispatchToken !== job.dispatchToken || current.status !== 'processing'
      || current.sendClickedAt || current.externalEffectStarted || current.providerMessageId)
      throw new Error('member_sms_refund_claim_changed');
    assertMemberDispatchAllowed();
    tx.set(ref, { status: 'sending', transportProvider: 'solapi', sendClickedAt: now, updatedAt: now }, { merge: true });
    tx.update(db.collection('refundCases').doc(job.caseId), {
      'smsNotice.status': 'sending', 'smsNotice.sendClickedAt': now, 'smsNotice.updatedAt': now, updatedAt: now,
    });
  });
}

function restoreFields(data, fields) {
  return Object.fromEntries(fields.map(field => {
    const value = field.split(".").reduce((row, key) => row?.[key], data);
    return [field, value === undefined ? FieldValue.delete() : value];
  }));
}

async function deferClaim(ref, job) {
  await db.runTransaction(async tx => {
    const current = (await tx.get(ref)).data();
    if (current?.dispatchToken !== job.dispatchToken || !["processing", "sending"].includes(current.status))
      throw new Error("refund_sms_quiet_claim_changed");
    const nextAllowedAt = memberDispatchWindow().nextAllowedAt;
    tx.update(ref, { ...job.dispatchUndo.job, nextAllowedAt,
      dispatchDeferrals: [...(current.dispatchDeferrals || []), { dispatchToken: job.dispatchToken, claimedAt: current.claimedAt,
        sendPreparedAt: current.sendClickedAt || null, deferredAt: new Date().toISOString(), providerPostCount: 0, nextAllowedAt }] });
    tx.update(db.collection("refundCases").doc(String(job.caseId)), job.dispatchUndo.case);
  });
}

async function markSent(ref, job, result) {
  const now = FieldValue.serverTimestamp();
  const batch = db.batch();
  batch.set(ref, {
    status: "sent",
    studiomateMemberId: result.studiomateMemberId,
    sendEvidence: result.evidence,
    ...(result.smsId ? { smsId: result.smsId } : {}),
    provider: result.provider,
    providerMessageId: result.providerMessageId,
    providerGroupId: result.providerGroupId,
    providerReceipt: result.providerReceipt,
    deliveryStatus: result.deliveryStatus,
    sentAt: now,
    completedAt: now,
    updatedAt: now,
    lastError: null,
  }, { merge: true });
  batch.update(db.collection("refundCases").doc(job.caseId), {
    "smsNotice.status": "sent",
    "smsNotice.provider": result.provider,
    "smsNotice.sentAt": now,
    "smsNotice.providerMessageId": result.providerMessageId,
    "smsNotice.deliveryStatus": result.deliveryStatus,
    "smsNotice.updatedAt": now,
    updatedAt: now,
  });
  await batch.commit();
}

async function markFailure(ref, data, message, finalSendClicked) {
  const attempts = Number(data.attempts || 0);
  const maxAttempts = Number(data.maxAttempts || 3);
  const status = finalSendClicked ? "send_review_required" : attempts >= maxAttempts ? "failed" : "retry";
  await updateJobAndCase(ref, data.caseId, status, { lastError: message.slice(0, 1200) });
  return { status };
}

async function updateJobAndCase(ref, caseId, status, patch = {}) {
  const now = FieldValue.serverTimestamp();
  const batch = db.batch();
  batch.set(ref, { status, ...patch, updatedAt: now }, { merge: true });
  batch.update(db.collection("refundCases").doc(String(caseId)), {
    "smsNotice.status": status,
    "smsNotice.lastError": patch.lastError || null,
    "smsNotice.updatedAt": now,
    updatedAt: now,
  });
  await batch.commit();
}

async function persistSummary() {
  await writeFile(config.lastResultPath, `${JSON.stringify(summary, null, 2)}\n`);
  await appendFile(config.runLogPath, `${JSON.stringify(summary)}\n`);
  await recordAutomationStatus(db, {
    automationId: "studiomate-refund-sms-queue",
    title: "SOLAPI 환불계산 문자 발송 큐",
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

function expandHome(value) {
  return String(value || "").startsWith("~/") ? path.join(os.homedir(), String(value).slice(2)) : String(value || "");
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}
