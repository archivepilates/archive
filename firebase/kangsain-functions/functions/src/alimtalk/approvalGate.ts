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

const APPROVAL_THRESHOLD = 10;
const APPROVAL_COLLECTION = "alimtalkSendApprovals";
const APPROVAL_FUNCTION_URL =
  process.env.ALIMTALK_APPROVAL_FUNCTION_URL ||
  `https://${REGION}-archive-pilates.cloudfunctions.net/approveAlimtalkBatch`;

export interface AlimtalkApprovalResult {
  required: boolean;
  approved: boolean;
  approvalId?: string;
  emailed?: boolean;
}

interface ApprovalDoc {
  approvalId: string;
  studioId: string;
  sourceDate: string;
  approvalScope?: "daily" | "reservation_open";
  status: "pending" | "approved";
  candidateIds: string[];
  candidateCount: number;
  tokenHash: string;
  emailSentAt?: FirebaseFirestore.Timestamp;
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
  if (input.candidates.length < APPROVAL_THRESHOLD) return { required: false, approved: true };
  const approvalScope = input.approvalScope || "daily";
  const approvalId = alimtalkApprovalId(input.studioId, input.today, approvalScope);
  const ref = db.collection(APPROVAL_COLLECTION).doc(approvalId);
  const existing = (await ref.get()).data() as ApprovalDoc | undefined;
  if (existing?.status === "approved") return { required: true, approved: true, approvalId };

  let token = "";
  let emailed = false;
  if (!existing?.emailSentAt) {
    token = randomBytes(24).toString("hex");
    await ref.set(
      {
        approvalId,
        studioId: input.studioId,
        sourceDate: input.today,
        approvalScope,
        status: "pending",
        candidateIds: input.candidates.map((candidate) => candidate.candidateId),
        candidateCount: input.candidates.length,
        tokenHash: tokenHash(token),
        emailSentAt: nowTimestamp(),
        createdAt: existing?.createdAt || nowTimestamp(),
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
    await sendApprovalEmail({
      approvalId,
      token,
      date: input.today,
      candidates: input.candidates,
    });
    emailed = true;
  } else {
    await ref.set(
      {
        candidateIds: input.candidates.map((candidate) => candidate.candidateId),
        candidateCount: input.candidates.length,
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
  }

  return { required: true, approved: false, approvalId, emailed };
}

export async function approveAlimtalkBatchHandler(request: Request, response: Response): Promise<void> {
  const approvalId = String(request.query.id || request.body?.id || "");
  const token = String(request.query.token || request.body?.token || "");
  if (!approvalId || !token) {
    response.status(400).send("승인 링크 정보가 부족합니다.");
    return;
  }

  const ref = db.collection(APPROVAL_COLLECTION).doc(approvalId);
  const snap = await ref.get();
  const approval = snap.data() as ApprovalDoc | undefined;
  if (!approval || approval.tokenHash !== tokenHash(token)) {
    response.status(403).send("승인 링크가 올바르지 않습니다.");
    return;
  }
  if (approval.status !== "approved") {
    await ref.set(
      {
        status: "approved",
        approvedAt: nowTimestamp(),
        approvedBy: "email-button",
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
  }

  const queued = await queueApprovedCandidates(approval);
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
  const snaps = await Promise.all(
    approval.candidateIds.map((candidateId) => refs.alimtalkCandidate(candidateId).get()),
  );
  for (const snap of snaps) {
    const candidate = snap.data();
    if (!candidate || candidate.studioId !== approval.studioId) continue;
    if (candidate.sourceDate !== today) continue;
    if (!["candidate", "reviewed", "failed"].includes(candidate.status)) continue;
    if (await autoSendabilityIssue(candidate, today)) continue;
    const didQueue = await queueApprovedCandidate(candidate);
    if (didQueue) queued += 1;
  }
  return queued;
}

async function queueApprovedCandidate(candidate: AlimtalkCandidateDoc): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const ref = refs.alimtalkCandidate(candidate.candidateId);
    const snap = await tx.get(ref);
    const current = snap.data();
    if (!current) return false;
    if (!["candidate", "reviewed", "failed"].includes(current.status)) return false;
    tx.set(
      ref,
      {
        status: "queued",
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

async function sendApprovalEmail(input: {
  approvalId: string;
  token: string;
  date: string;
  candidates: AlimtalkCandidateDoc[];
}): Promise<void> {
  const approvalUrl = `${APPROVAL_FUNCTION_URL}?id=${encodeURIComponent(input.approvalId)}&token=${encodeURIComponent(
    input.token,
  )}`;
  const lines = input.candidates.map(candidateLine);
  const body = [
    "ARCHIVE IN 알림톡 대량 발송 승인 요청",
    "",
    `기준일: ${input.date}`,
    `발송 예정: ${input.candidates.length}건`,
    "",
    "발송 예정 리스트",
    ...lines,
    "",
    "아래 링크를 누르면 승인 후 발송이 진행됩니다.",
    approvalUrl,
  ].join("\n");
  const htmlBody = approvalHtml({
    date: input.date,
    count: input.candidates.length,
    lines,
    approvalUrl,
  });
  await sendAlimtalkLogEmail({
    subject: `[알림톡][긴급] ${input.candidates.length}건 발송 승인 요청 ${input.date}`,
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

export function alimtalkApprovalId(
  studioId: string,
  date: string,
  approvalScope: "daily" | "reservation_open" = "daily",
): string {
  return approvalScope === "daily" ? `${studioId}_${date}` : `${studioId}_${date}_${approvalScope}`;
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
