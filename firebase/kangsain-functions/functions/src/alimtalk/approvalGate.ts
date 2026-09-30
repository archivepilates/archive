import { createHash, randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { logger } from "firebase-functions";
import { DEFAULT_STUDIO_ID, REGION } from "../config/constants";
import { db } from "../config/firebase";
import { sendAlimtalkLogEmail } from "../google/driveDocsMailer";
import { refs } from "../firestore/refs";
import type { AlimtalkCandidateDoc } from "../types/models";
import { nowTimestamp, todayKst } from "../utils/date";
import { autoSendabilityIssue } from "./eligibility";
import { processAlimtalkQueue } from "./processAlimtalkQueue";
import { privateSurveySendabilityIssue } from "./privateSurveySendGuard";
import { renewalCandidateSendabilityIssue } from "./renewalSendGuard";
import { longAbsenceCandidateSendabilityIssue } from "./longAbsenceSendGuard";
import {
  alimtalkApprovalId,
  alimtalkApprovalSnapshotKey,
  approvalDeltaId,
  approvedBatchForCandidate,
  partitionApprovalCandidates,
  usesAlimtalkBatchApproval,
  type ApprovalBatchSnapshot,
} from "./approvalPolicy";
import {
  alimtalkApprovalClaimIssue,
  approvalCandidateBinding,
  approvalRef,
  readApprovalBatches,
} from "./approvalStore";

export { alimtalkApprovalId } from "./approvalPolicy";

const APPROVAL_THRESHOLD = 10;
const APPROVAL_FUNCTION_URL =
  process.env.ALIMTALK_APPROVAL_FUNCTION_URL ||
  `https://${REGION}-archive-pilates.cloudfunctions.net/approveAlimtalkBatch`;

export interface AlimtalkApprovalResult {
  required: boolean;
  approved: boolean;
  approvalId?: string;
  emailed?: boolean;
  allowedCandidateIds: string[];
  pendingCandidateIds: string[];
  pendingApprovalIds: string[];
}

interface ApprovalDoc extends ApprovalBatchSnapshot {
  status: "pending" | "approved";
  candidateIds: string[];
  candidateCount: number;
  candidateLines?: string[];
  candidateSourceDates?: string[];
  tokenHash: string;
  emailSentAt?: FirebaseFirestore.Timestamp;
  emailAttemptAt?: FirebaseFirestore.Timestamp | null;
  approvedAt?: FirebaseFirestore.Timestamp;
  approvedBy?: string;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
}

export async function requireApprovalForLargeAlimtalkBatch(input: {
  studioId: string;
  today: string;
  candidates: AlimtalkCandidateDoc[];
  approvalScope?: "daily" | "reservation_open";
}): Promise<AlimtalkApprovalResult> {
  const approvalScope = input.approvalScope || "daily";
  const rootId = alimtalkApprovalId(input.studioId, input.today, approvalScope);
  const candidates = input.candidates.filter(
    (candidate) =>
      usesAlimtalkBatchApproval(candidate) &&
      candidate.studioId === input.studioId &&
      (candidate.type === "reservation_open" ? "reservation_open" : "daily") === approvalScope &&
      ["candidate", "reviewed", "failed"].includes(candidate.status),
  );
  const result = await db.runTransaction(async (tx): Promise<AlimtalkApprovalResult> => {
    const batches = await readApprovalBatches(tx, rootId);
    const partition = partitionApprovalCandidates(candidates, batches);
    if (!batches.length && partition.additions.length < APPROVAL_THRESHOLD) {
      return {
        required: false,
        approved: true,
        allowedCandidateIds: partition.additions.map((item) => item.candidateId),
        pendingCandidateIds: [],
        pendingApprovalIds: [],
      };
    }
    let createdId: string | undefined;
    if (partition.additions.length) {
      createdId = batches.length ? approvalDeltaId(rootId, partition.additions) : rootId;
      const timestamp = nowTimestamp();
      const doc: ApprovalDoc = {
        approvalId: createdId,
        studioId: input.studioId,
        sourceDate: input.today,
        approvalScope,
        status: "pending",
        snapshotVersion: 1,
        targets: partition.additions.map((candidate) => ({
          candidateId: candidate.candidateId,
          snapshotKey: alimtalkApprovalSnapshotKey(candidate),
          status: "included",
        })),
        candidateIds: partition.additions.map((candidate) => candidate.candidateId),
        candidateCount: partition.additions.length,
        candidateLines: partition.additions.map(candidateLine),
        candidateSourceDates: [...new Set(partition.additions.map((candidate) => candidate.sourceDate))],
        tokenHash: "",
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      tx.create(approvalRef(createdId), doc);
      if (batches.length) {
        // The root serializes concurrent additions; its original snapshot never changes.
        tx.update(approvalRef(rootId), { deltaApprovalIds: [...(batches[0].deltaApprovalIds || []), createdId] });
      }
    }
    const pending = [...partition.pending, ...partition.additions];
    const pendingKeys = new Set(pending.map(alimtalkApprovalSnapshotKey));
    const pendingApprovalIds = batches
      .filter(
        (batch) =>
          batch.snapshotVersion === 1 &&
          batch.status === "pending" &&
          batch.targets?.some((target) => pendingKeys.has(target.snapshotKey)),
      )
      .map((batch) => batch.approvalId);
    if (createdId) pendingApprovalIds.push(createdId);
    return {
      required: true,
      approved: pending.length === 0,
      approvalId: pendingApprovalIds[0] || rootId,
      allowedCandidateIds: partition.allowed.map((item) => item.candidateId),
      pendingCandidateIds: pending.map((item) => item.candidateId),
      pendingApprovalIds,
    };
  });
  let emailed = false;
  for (const id of result.pendingApprovalIds) {
    if (await notifyPendingApproval(id)) emailed = true;
  }
  return { ...result, emailed };
}

async function notifyPendingApproval(approvalId: string): Promise<boolean> {
  const token = randomBytes(24).toString("hex");
  const ref = approvalRef(approvalId);
  const approval = await db.runTransaction(async (tx) => {
    const current = (await tx.get(ref)).data() as ApprovalDoc | undefined;
    if (
      !current ||
      current.status !== "pending" ||
      current.snapshotVersion !== 1 ||
      current.emailSentAt ||
      (current.emailAttemptAt && Date.now() - current.emailAttemptAt.toMillis() < 300_000)
    )
      return null;
    tx.update(ref, { tokenHash: tokenHash(token), emailAttemptAt: nowTimestamp() });
    return current;
  });
  if (!approval) return false;
  try {
    await sendApprovalEmail({
      approvalId,
      token,
      date: approval.sourceDate,
      lines: approval.candidateLines || [],
      count: approval.candidateCount,
    });
    await finishAttempt({ emailSentAt: nowTimestamp() });
    return true;
  } catch (error) {
    await finishAttempt({ emailAttemptAt: null });
    throw error;
  }

  async function finishAttempt(update: FirebaseFirestore.UpdateData<ApprovalDoc>): Promise<void> {
    await db.runTransaction(async (tx) => {
      const current = (await tx.get(ref)).data() as ApprovalDoc | undefined;
      if (current?.tokenHash === tokenHash(token)) tx.update(ref, update);
    });
  }
}

export async function approveAlimtalkBatchHandler(request: Request, response: Response): Promise<void> {
  if (request.method !== "GET" && request.method !== "POST") {
    response.status(405).send("GET 또는 POST 요청만 가능합니다.");
    return;
  }
  const approvalId = String(request.query.id || request.body?.id || "");
  const token = String(request.query.token || request.body?.token || "");
  if (!approvalId || !token) {
    response.status(400).send("승인 링크 정보가 부족합니다.");
    return;
  }

  if (approvalId.includes("/")) {
    response.status(400).send("승인 링크 정보가 올바르지 않습니다.");
    return;
  }
  const ref = approvalRef(approvalId);
  const snap = await ref.get();
  const approval = snap.data() as ApprovalDoc | undefined;
  if (!approval || approval.tokenHash !== tokenHash(token)) {
    response.status(403).send("승인 링크가 올바르지 않습니다.");
    return;
  }
  if (approval.snapshotVersion !== 1 || !approval.targets?.length) {
    response.status(409).send("고정된 승인 스냅샷이 없습니다. 새 승인 요청이 필요합니다.");
    return;
  }
  if (request.method === "GET") {
    response.status(200).send(approvalConfirmationHtml(approvalId, token, approval));
    return;
  }
  const confirmed = await db.runTransaction(async (tx) => {
    const current = (await tx.get(ref)).data() as ApprovalDoc | undefined;
    if (
      !current ||
      current.tokenHash !== tokenHash(token) ||
      current.snapshotVersion !== 1 ||
      !["pending", "approved"].includes(current.status)
    )
      return null;
    if (current.status === "pending")
      tx.update(ref, {
        status: "approved",
        approvedAt: nowTimestamp(),
        approvedBy: "email-button",
        updatedAt: nowTimestamp(),
      });
    return { ...current, status: "approved" as const };
  });
  if (!confirmed) {
    response.status(409).send("승인 요청 상태가 변경되었습니다. 다시 확인해 주세요.");
    return;
  }

  const queued = await queueApprovedCandidates(confirmed);
  const processSummary = { processed: 0, sent: 0, failed: 0, deferred: 0 };
  for (let index = 0; index < 10; index += 1) {
    const result = await processAlimtalkQueue();
    processSummary.processed += result.processed;
    processSummary.sent += result.sent;
    processSummary.failed += result.failed;
    processSummary.deferred += result.deferred;
    if (!result.processed || result.processed === result.deferred) break;
  }

  logger.info("approveAlimtalkBatch completed", {
    approvalId,
    queued,
    ...processSummary,
  });
  response
    .status(200)
    .send(
      `ARCHIVE IN 알림톡 발송 승인 완료\n\n큐 전환: ${queued}건\n처리: ${processSummary.processed}건\n발송 성공: ${processSummary.sent}건\n발송 실패: ${processSummary.failed}건\n템플릿 상태 재시도 대기: ${processSummary.deferred}건`,
    );
}

async function queueApprovedCandidates(approval: ApprovalDoc): Promise<number> {
  const today = approval.sourceDate || todayKst();
  let queued = 0;
  // Both the approved content and original candidate ID must still match.
  // Regenerated IDs require review; they cannot inherit a cancelled/consumed target.
  const sourceDates = approval.candidateSourceDates || [approval.sourceDate];
  const snapshots = await Promise.all(
    sourceDates.map((date) => refs.alimtalkCandidates().where("sourceDate", "==", date).get()),
  );
  const seen = new Set<string>();
  for (const snap of snapshots.flatMap((snapshot) => snapshot.docs)) {
    const candidate = snap.data();
    if (!candidate || candidate.studioId !== approval.studioId) continue;
    if (!["candidate", "reviewed", "failed"].includes(candidate.status)) continue;
    if (!approvedBatchForCandidate(candidate, [approval])) continue;
    const key = alimtalkApprovalSnapshotKey(candidate);
    if (seen.has(key)) continue;
    if (await approvalQueueEligibilityIssue(candidate, todayKst())) continue;
    const didQueue = await queueApprovedCandidate(candidate, today);
    if (didQueue) {
      queued += 1;
      seen.add(key);
    }
  }
  return queued;
}

async function queueApprovedCandidate(candidate: AlimtalkCandidateDoc, today: string): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const ref = refs.alimtalkCandidate(candidate.candidateId);
    const snap = await tx.get(ref);
    const current = snap.data();
    if (!current) return false;
    if (!["candidate", "reviewed", "failed"].includes(current.status)) return false;
    if (alimtalkApprovalSnapshotKey(current) !== alimtalkApprovalSnapshotKey(candidate)) return false;
    if (await alimtalkApprovalClaimIssue(tx, { ...current, ...approvalCandidateBinding(current, today) }, today))
      return false;
    if (await approvalQueueEligibilityIssue(current, todayKst())) return false;
    tx.set(
      ref,
      {
        status: "queued",
        ...approvalCandidateBinding(current, today),
        queuedBy: "operator",
        reviewedByUid: "system:email-approval",
        reviewedAt: nowTimestamp(),
        attempts: current.attempts || 0,
        maxAttempts: 1,
        lastError: null,
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
    return true;
  });
}

export async function approvalQueueEligibilityIssue(candidate: AlimtalkCandidateDoc, today: string): Promise<string> {
  return (
    (await autoSendabilityIssue(candidate, today)) ||
    (await privateSurveySendabilityIssue(candidate)) ||
    (await renewalCandidateSendabilityIssue(candidate)) ||
    (await longAbsenceCandidateSendabilityIssue(candidate))
  );
}

async function sendApprovalEmail(input: {
  approvalId: string;
  token: string;
  date: string;
  lines: string[];
  count: number;
}): Promise<void> {
  const approvalUrl = `${APPROVAL_FUNCTION_URL}?id=${encodeURIComponent(input.approvalId)}&token=${encodeURIComponent(
    input.token,
  )}`;
  const lines = input.lines;
  const body = [
    "ARCHIVE IN 알림톡 대량 발송 승인 요청",
    "",
    `기준일: ${input.date}`,
    `발송 예정: ${input.count}건`,
    "",
    "발송 예정 리스트",
    ...lines,
    "",
    "아래 링크에서 고정된 대상 목록을 확인하고 승인하면 발송이 진행됩니다.",
    approvalUrl,
  ].join("\n");
  const htmlBody = approvalHtml({
    date: input.date,
    count: input.count,
    lines,
    approvalUrl,
  });
  await sendAlimtalkLogEmail({
    subject: `[알림톡][긴급] ${input.count}건 발송 승인 요청 ${input.date}`,
    body,
    htmlBody,
    status: "urgent",
  });
}

function candidateLine(candidate: AlimtalkCandidateDoc): string {
  const ticket = candidate.payload?.ticketName || candidate.payload?.ticket || "";
  const lessonDate = candidate.payload?.lectureDate || candidate.payload?.lessonDate || "";
  const detail = [templateLabel(candidate.type), ticket, lessonDate].filter(Boolean).join(" / ");
  return `- ${candidate.memberName} / ${detail}`;
}

function approvalHtml(input: { date: string; count: number; lines: string[]; approvalUrl: string }): string {
  const items = input.lines.map((line) => `<li>${escapeHtml(line.replace(/^- /, ""))}</li>`).join("");
  return [
    '<div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">',
    "<h2>ARCHIVE IN 알림톡 대량 발송 승인 요청</h2>",
    `<p>기준일: <b>${escapeHtml(input.date)}</b><br>발송 예정: <b>${input.count}건</b></p>`,
    `<ol>${items}</ol>`,
    '<div style="margin-top:24px">',
    `<a href="${escapeHtml(input.approvalUrl)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 18px;border-radius:6px;font-weight:700">발송 승인하기</a>`,
    "</div>",
    "</div>",
  ].join("");
}

function approvalConfirmationHtml(id: string, token: string, approval: ApprovalDoc): string {
  const lines = (approval.candidateLines || []).map((line) => `<li>${escapeHtml(line)}</li>`).join("");
  return (
    `<h1>ARCHIVE IN 알림톡 발송 승인</h1><p>고정 대상 ${approval.candidateCount}건 · ${escapeHtml(approval.sourceDate)}</p>` +
    `<ol>${lines}</ol><form method="post"><input type="hidden" name="id" value="${escapeHtml(id)}">` +
    `<input type="hidden" name="token" value="${escapeHtml(token)}"><button type="submit">이 목록만 발송 승인</button></form>`
  );
}

function tokenHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function templateLabel(type: string): string {
  const labels: Record<string, string> = {
    new_member: "신규회원 웰컴",
    private_survey: "프라이빗 사전설문",
    group_survey: "그룹 첫 수업 사전확인",
    instructor_lesson_material: "강사레슨 수업자료",
    ticket_expiring: "그룹 기간 만료",
    remaining_low: "그룹 횟수 부족",
    private_count_low: "프라이빗 횟수 부족",
    private_ticket_expiring: "프라이빗 기간 만료",
  };
  return labels[type] || type;
}

function escapeHtml(value: string): string {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function alimtalkApprovalThreshold(): number {
  return APPROVAL_THRESHOLD;
}

export function defaultAlimtalkApprovalStudioId(): string {
  return DEFAULT_STUDIO_ID;
}
