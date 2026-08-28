import { createHash, randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { DEFAULT_STUDIO_ID, REGION } from "../config/constants";
import { db } from "../config/firebase";
import { sendAlimtalkLogEmail } from "../google/driveDocsMailer";
import { refs } from "../firestore/refs";
import type { AlimtalkCandidateDoc } from "../types/models";
import { nowTimestamp, todayKst } from "../utils/date";
import { stableHash } from "../utils/hash";
import { alimtalkDedupeKey, findCompletedDuplicateForCandidate, normalizePhone } from "./dedupe";
import { autoSendabilityIssue } from "./eligibility";
import { normalizeInstructorLessonManagementNumber } from "./instructorLessonManagement";
import { sendSolapiAlimtalk } from "./processAlimtalkQueue";
import { rebuildAlimtalkCandidatesForRange } from "./rebuildAlimtalkCandidates";
import { alimtalkDedupePolicy, INSTRUCTOR_LESSON_ALIMTALK_TEMPLATE_CODE } from "./templates";
import { primaryAlimtalkTestRecipient } from "./testRecipients";
import {
  ensureInstructorLessonParkingPreviewShortLink,
  instructorLessonParkingPreviewLinkId,
} from "../parking/instructorLessonParkingPreRegistration";
import { shortUrlForId } from "../utils/shortLinks";

const APPROVAL_COLLECTION = "instructorLessonAlimtalkApprovals";
const BOOKING_FRESHNESS_MS = 24 * 60 * 60 * 1000;
const RESERVATION_SNAPSHOT_DOC = "studiomateReservationExcelEmergency";
const LIVE_SEND_HOUR_KST = 18;
const APPROVAL_FUNCTION_URL =
  process.env.INSTRUCTOR_LESSON_APPROVAL_FUNCTION_URL ||
  `https://${REGION}-archive-pilates.cloudfunctions.net/approveInstructorLessonAlimtalkBatch`;

type InstructorLessonApprovalStatus =
  | "sample_sending"
  | "sample_sent"
  | "sample_failed"
  | "sample_unknown"
  | "approved"
  | "sending"
  | "sent"
  | "failed"
  | "blocked_no_approval"
  | "blocked_content_changed"
  | "blocked_source_stale"
  | "no_targets";

interface InstructorLessonApprovalDoc {
  approvalId: string;
  studioId: string;
  sourceDate: string;
  lessonDate: string;
  managementNumber: string;
  status: InstructorLessonApprovalStatus;
  candidateIds: string[];
  approvedTargetKeys: string[];
  contentFingerprint: string;
  candidateCount: number;
  candidateNames: string[];
  sampleCandidateId: string;
  sampleRecipientName: string;
  sampleSolapiMessageId?: string;
  sampleSentAt?: FirebaseFirestore.Timestamp;
  approvalTokenHash?: string;
  approvalEmailSentAt?: FirebaseFirestore.Timestamp;
  reminderSentAt?: FirebaseFirestore.Timestamp;
  approvedAt?: FirebaseFirestore.Timestamp;
  approvedBy?: string;
  liveSendStartedAt?: FirebaseFirestore.Timestamp;
  liveSendCompletedAt?: FirebaseFirestore.Timestamp;
  sentCount?: number;
  skippedCount?: number;
  failedCount?: number;
  lastError?: string | null;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
}

export interface InstructorLessonSampleApprovalSummary {
  batches: number;
  sampleSent: number;
  awaitingApproval: number;
  blocked: number;
}

interface InstructorLessonCandidateGroup {
  lessonDate: string;
  managementNumber: string;
  candidates: AlimtalkCandidateDoc[];
}

export function splitInstructorLessonCandidates(candidates: AlimtalkCandidateDoc[]): {
  instructorLesson: AlimtalkCandidateDoc[];
  other: AlimtalkCandidateDoc[];
} {
  return {
    instructorLesson: candidates.filter((candidate) => candidate.type === "instructor_lesson_material"),
    other: candidates.filter((candidate) => candidate.type !== "instructor_lesson_material"),
  };
}

export function instructorLessonApprovalId(studioId: string, sourceDate: string, managementNumber: string): string {
  return `instructor_lesson_${stableHash({ studioId, sourceDate, managementNumber }).slice(0, 24)}`;
}

export function instructorLessonTargetKey(candidate: AlimtalkCandidateDoc): string {
  return `${candidate.memberId}|${normalizePhone(candidate.memberPhone)}`;
}

export function instructorLessonContentFingerprint(candidate: AlimtalkCandidateDoc): string {
  const managementNumber = normalizeInstructorLessonManagementNumber(
    String(candidate.payload?.managementNumber || candidate.payload?.materialNumber || ""),
  );
  return stableHash({
    templateCode: candidate.templateCode,
    lessonDate: String(candidate.payload?.lessonDate || candidate.payload?.lectureDate || ""),
    managementNumber,
    shortLinkId: String(candidate.payload?.shortLinkId || ""),
    materialUrl: `https://in.archivepilates.com/method/${managementNumber}`,
    assignmentUrl: `https://in.archivepilates.com/method/${managementNumber}/assignment`,
  });
}

export function instructorLessonApprovalCutoffIssue(sourceDate: string, now: Date = new Date()): string {
  const currentDate = kstDate(now);
  if (currentDate !== sourceDate) return `승인 가능일이 아닙니다: ${sourceDate}`;
  if (kstMinutes(now) >= LIVE_SEND_HOUR_KST * 60) return "D-1 18:00 KST 발송 시각이 지났습니다.";
  return "";
}

export async function prepareInstructorLessonSampleApprovals(input: {
  studioId?: string;
  sourceDate: string;
  candidates: AlimtalkCandidateDoc[];
}): Promise<InstructorLessonSampleApprovalSummary> {
  const studioId = input.studioId || DEFAULT_STUDIO_ID;
  const groups = groupInstructorLessonCandidates(input.candidates);
  const summary: InstructorLessonSampleApprovalSummary = {
    batches: groups.length,
    sampleSent: 0,
    awaitingApproval: 0,
    blocked: 0,
  };
  for (const group of groups) {
    const result = await prepareInstructorLessonSampleApproval({ studioId, sourceDate: input.sourceDate, group });
    if (result === "sample_sent") summary.sampleSent += 1;
    if (result === "awaiting_approval") summary.awaitingApproval += 1;
    if (result === "blocked") summary.blocked += 1;
  }
  return summary;
}

async function prepareInstructorLessonSampleApproval(input: {
  studioId: string;
  sourceDate: string;
  group: InstructorLessonCandidateGroup;
}): Promise<"sample_sent" | "awaiting_approval" | "blocked"> {
  const { studioId, sourceDate, group } = input;
  const approvalId = instructorLessonApprovalId(studioId, sourceDate, group.managementNumber);
  const ref = db.collection(APPROVAL_COLLECTION).doc(approvalId);
  const existing = (await ref.get()).data() as InstructorLessonApprovalDoc | undefined;
  if (existing) {
    if (existing.status === "sample_sending") {
      return recoverSampleSendingApproval(ref, existing);
    }
    if (existing.status === "sample_sent" && !existing.approvalEmailSentAt) {
      await trySendSampleApprovalEmail(ref, existing);
    }
    if (["sample_sent", "approved"].includes(existing.status)) return "awaiting_approval";
    if (["sending", "sent"].includes(existing.status)) return "awaiting_approval";
    return "blocked";
  }

  const sourceIssue = await instructorLessonGroupSourceIssue(group);
  const routeIssue = await instructorLessonRouteIssue(group.lessonDate, group.managementNumber);
  if (sourceIssue || routeIssue) {
    const issue = sourceIssue || routeIssue;
    await ref.set({
      approvalId,
      studioId,
      sourceDate,
      lessonDate: group.lessonDate,
      managementNumber: group.managementNumber,
      status: sourceIssue ? "blocked_source_stale" : "sample_failed",
      candidateIds: group.candidates.map((candidate) => candidate.candidateId),
      approvedTargetKeys: group.candidates.map(instructorLessonTargetKey),
      contentFingerprint: instructorLessonContentFingerprint(group.candidates[0]),
      candidateCount: group.candidates.length,
      candidateNames: group.candidates.map((candidate) => candidate.memberName),
      sampleCandidateId: sampleCandidateId(approvalId),
      sampleRecipientName: primaryAlimtalkTestRecipient().name,
      lastError: issue,
      createdAt: nowTimestamp(),
      updatedAt: nowTimestamp(),
    } satisfies InstructorLessonApprovalDoc);
    await sendInstructorLessonAttentionEmail({
      subject: `[알림톡][긴급] 강사레슨 샘플 발송 보류 ${group.lessonDate}`,
      lessonDate: group.lessonDate,
      managementNumber: group.managementNumber,
      issue,
    });
    return "blocked";
  }

  const testRecipient = primaryAlimtalkTestRecipient();
  await ensureInstructorLessonParkingPreviewShortLink();
  const sample = buildSampleCandidate(group.candidates[0], approvalId, testRecipient);
  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) return false;
    tx.create(ref, {
      approvalId,
      studioId,
      sourceDate,
      lessonDate: group.lessonDate,
      managementNumber: group.managementNumber,
      status: "sample_sending",
      candidateIds: group.candidates.map((candidate) => candidate.candidateId),
      approvedTargetKeys: group.candidates.map(instructorLessonTargetKey),
      contentFingerprint: instructorLessonContentFingerprint(group.candidates[0]),
      candidateCount: group.candidates.length,
      candidateNames: group.candidates.map((candidate) => candidate.memberName),
      sampleCandidateId: sample.candidateId,
      sampleRecipientName: testRecipient.name,
      lastError: null,
      createdAt: nowTimestamp(),
      updatedAt: nowTimestamp(),
    } satisfies InstructorLessonApprovalDoc);
    return true;
  });
  if (!claimed) return "awaiting_approval";

  try {
    const issue = await autoSendabilityIssue(sample, sourceDate);
    if (issue) throw new Error(issue);
    const result = await sendSolapiAlimtalk(sample);
    await writeSampleAudit(sample, result.messageId, null);
    await ref.set(
      {
        status: "sample_sent",
        sampleSolapiMessageId: result.messageId,
        sampleSentAt: nowTimestamp(),
        lastError: null,
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
  } catch (err) {
    const message = errorText(err);
    await writeSampleAudit(sample, "", message);
    await ref.set(
      {
        status: "sample_unknown",
        lastError: message,
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
    await sendInstructorLessonAttentionEmail({
      subject: `[알림톡][실패] 강사레슨 샘플 발송 실패 ${group.lessonDate}`,
      lessonDate: group.lessonDate,
      managementNumber: group.managementNumber,
      issue: message,
    });
    return "blocked";
  }
  const current = (await ref.get()).data() as InstructorLessonApprovalDoc;
  await trySendSampleApprovalEmail(ref, current);
  return "sample_sent";
}

export async function approveInstructorLessonAlimtalkBatchHandler(request: Request, response: Response): Promise<void> {
  const approvalId = String(request.query.id || request.body?.id || "");
  const token = String(request.query.token || request.body?.token || "");
  if (!approvalId || !token) {
    response.status(400).send("승인 링크 정보가 부족합니다.");
    return;
  }
  const ref = db.collection(APPROVAL_COLLECTION).doc(approvalId);
  const snap = await ref.get();
  const approval = snap.data() as InstructorLessonApprovalDoc | undefined;
  if (!approval || approval.approvalTokenHash !== tokenHash(token)) {
    response.status(403).send("승인 링크가 올바르지 않습니다.");
    return;
  }
  if (request.method === "GET") {
    response.status(200).send(approvalConfirmationHtml(approvalId, token, approval));
    return;
  }
  if (request.method !== "POST") {
    response.status(405).send("POST 방식으로만 승인할 수 있습니다.");
    return;
  }
  const cutoffIssue = instructorLessonApprovalCutoffIssue(approval.sourceDate);
  if (cutoffIssue) {
    response.status(409).send(`강사레슨 알림톡을 승인할 수 없습니다.\n\n${cutoffIssue}`);
    return;
  }
  if (approval.status === "approved") {
    response.status(200).send("이미 승인되었습니다. D-1 18:00 KST에 본 발송됩니다.");
    return;
  }
  if (approval.status !== "sample_sent") {
    response.status(409).send(`샘플 성공 상태가 아닙니다: ${approval.status}`);
    return;
  }
  await ref.set(
    {
      status: "approved",
      approvedAt: nowTimestamp(),
      approvedBy: "email-button",
      updatedAt: nowTimestamp(),
    },
    { merge: true },
  );
  response
    .status(200)
    .send(
      `ARCHIVE IN 강사레슨 D-1 알림톡 승인 완료\n\n수업일: ${approval.lessonDate}\n대상: ${approval.candidateCount}명\n본 발송: D-1 18:00 KST`,
    );
}

export async function remindPendingInstructorLessonApprovals(
  input: {
    studioId?: string;
    sourceDate?: string;
  } = {},
): Promise<{ reminded: number; blocked: number }> {
  const sourceDate = input.sourceDate || todayKst();
  const studioId = input.studioId || DEFAULT_STUDIO_ID;
  const approvals = await approvalsForSourceDate(studioId, sourceDate);
  let reminded = 0;
  let blocked = 0;
  for (const approval of approvals) {
    const ref = db.collection(APPROVAL_COLLECTION).doc(approval.approvalId);
    if (approval.status === "sample_sent") {
      if (approval.reminderSentAt) continue;
      await sendSampleApprovalEmail(ref, approval, true);
      await ref.set({ reminderSentAt: nowTimestamp(), updatedAt: nowTimestamp() }, { merge: true });
      reminded += 1;
    } else if (["sample_failed", "sample_unknown", "blocked_source_stale"].includes(approval.status)) {
      await sendInstructorLessonAttentionEmail({
        subject: `[알림톡][긴급] 강사레슨 D-1 발송 불가 ${approval.lessonDate}`,
        lessonDate: approval.lessonDate,
        managementNumber: approval.managementNumber,
        issue: approval.lastError || approval.status,
      });
      await ref.set({ reminderSentAt: nowTimestamp(), updatedAt: nowTimestamp() }, { merge: true });
      blocked += 1;
    }
  }
  return { reminded, blocked };
}

export async function sendApprovedInstructorLessonAlimtalks(
  input: {
    studioId?: string;
    sourceDate?: string;
  } = {},
): Promise<{ batches: number; sent: number; skipped: number; failed: number; blocked: number }> {
  const sourceDate = input.sourceDate || todayKst();
  const studioId = input.studioId || DEFAULT_STUDIO_ID;
  const approvals = await approvalsForSourceDate(studioId, sourceDate);
  const rebuilt = await rebuildAlimtalkCandidatesForRange({ studioId, startDate: sourceDate, endDate: sourceDate });
  const candidates = await candidatesByIds(rebuilt.candidateIds, studioId);
  const groups = groupInstructorLessonCandidates(
    candidates.filter((candidate) => ["candidate", "reviewed"].includes(candidate.status)),
  );
  const summary = { batches: approvals.length, sent: 0, skipped: 0, failed: 0, blocked: 0 };

  for (const approval of approvals) {
    const ref = db.collection(APPROVAL_COLLECTION).doc(approval.approvalId);
    if (["sent", "failed", "no_targets"].includes(approval.status)) continue;
    if (approval.status !== "approved") {
      if (approval.status !== "sending") {
        await ref.set(
          {
            status: "blocked_no_approval",
            lastError: "샘플 확인 후 명시적 승인이 없어 본 발송을 중단함",
            updatedAt: nowTimestamp(),
          },
          { merge: true },
        );
        await sendInstructorLessonAttentionEmail({
          subject: `[알림톡][긴급] 강사레슨 본 발송 승인 없음 ${approval.lessonDate}`,
          lessonDate: approval.lessonDate,
          managementNumber: approval.managementNumber,
          issue: "D-1 18:00까지 명시적 승인이 확인되지 않아 본 발송하지 않았습니다.",
        });
      }
      summary.blocked += 1;
      continue;
    }

    const group = groups.find(
      (item) => item.lessonDate === approval.lessonDate && item.managementNumber === approval.managementNumber,
    );
    if (!group?.candidates.length) {
      await ref.set(
        {
          status: "no_targets",
          lastError: "18:00 재검증 결과 현재 예약 대상 없음",
          updatedAt: nowTimestamp(),
        },
        { merge: true },
      );
      summary.blocked += 1;
      continue;
    }

    const currentFingerprint = instructorLessonContentFingerprint(group.candidates[0]);
    if (currentFingerprint !== approval.contentFingerprint) {
      await ref.set(
        {
          status: "blocked_content_changed",
          lastError: "샘플 승인 후 템플릿 또는 날짜별 링크 계약 변경",
          updatedAt: nowTimestamp(),
        },
        { merge: true },
      );
      await sendInstructorLessonAttentionEmail({
        subject: `[알림톡][긴급] 강사레슨 콘텐츠 변경 재승인 필요 ${approval.lessonDate}`,
        lessonDate: approval.lessonDate,
        managementNumber: approval.managementNumber,
        issue: "샘플 승인 후 템플릿 또는 날짜별 링크가 변경되어 본 발송을 중단했습니다.",
      });
      summary.blocked += 1;
      continue;
    }

    const sourceIssue = await instructorLessonGroupSourceIssue(group);
    const routeIssue = await instructorLessonRouteIssue(group.lessonDate, group.managementNumber);
    if (sourceIssue || routeIssue) {
      const issue = sourceIssue || routeIssue;
      await ref.set(
        {
          status: sourceIssue ? "blocked_source_stale" : "failed",
          lastError: issue,
          updatedAt: nowTimestamp(),
        },
        { merge: true },
      );
      await sendInstructorLessonAttentionEmail({
        subject: `[알림톡][실패] 강사레슨 본 발송 전 검증 실패 ${approval.lessonDate}`,
        lessonDate: approval.lessonDate,
        managementNumber: approval.managementNumber,
        issue,
      });
      summary.blocked += 1;
      continue;
    }

    const claimed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.data() as InstructorLessonApprovalDoc | undefined;
      if (!current || current.status !== "approved") return false;
      tx.set(
        ref,
        {
          status: "sending",
          candidateIds: group.candidates.map((candidate) => candidate.candidateId),
          candidateCount: group.candidates.length,
          liveSendStartedAt: nowTimestamp(),
          lastError: null,
          updatedAt: nowTimestamp(),
        },
        { merge: true },
      );
      return true;
    });
    if (!claimed) {
      summary.blocked += 1;
      continue;
    }

    const batchResult = { sent: 0, skipped: 0, failed: 0 };
    for (const candidate of group.candidates) {
      const result = await sendApprovedInstructorLessonCandidate(candidate, sourceDate);
      batchResult[result] += 1;
    }
    summary.sent += batchResult.sent;
    summary.skipped += batchResult.skipped;
    summary.failed += batchResult.failed;
    await ref.set(
      {
        status: batchResult.failed ? "failed" : "sent",
        sentCount: batchResult.sent,
        skippedCount: batchResult.skipped,
        failedCount: batchResult.failed,
        liveSendCompletedAt: nowTimestamp(),
        lastError: batchResult.failed ? `${batchResult.failed}건 발송 실패` : null,
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
    await sendInstructorLessonResultEmail(approval, batchResult);
  }

  return summary;
}

async function recoverSampleSendingApproval(
  ref: FirebaseFirestore.DocumentReference,
  approval: InstructorLessonApprovalDoc,
): Promise<"sample_sent" | "awaiting_approval" | "blocked"> {
  const send = (await refs.alimtalkSend(approval.sampleCandidateId).get()).data();
  if (send?.status === "done" && send.solapiMessageId) {
    await ref.set(
      {
        status: "sample_sent",
        sampleSolapiMessageId: send.solapiMessageId,
        sampleSentAt: send.updatedAt || nowTimestamp(),
        lastError: null,
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
    const recovered = (await ref.get()).data() as InstructorLessonApprovalDoc;
    await trySendSampleApprovalEmail(ref, recovered);
    return "sample_sent";
  }
  await ref.set(
    {
      status: "sample_unknown",
      lastError: send?.lastError || "샘플 발송 시작 후 SOLAPI 성공 증거가 없어 자동 재시도하지 않음",
      updatedAt: nowTimestamp(),
    },
    { merge: true },
  );
  return "blocked";
}

async function sendApprovedInstructorLessonCandidate(
  candidate: AlimtalkCandidateDoc,
  sourceDate: string,
): Promise<"sent" | "skipped" | "failed"> {
  const sendabilityIssue = await autoSendabilityIssue(candidate, sourceDate);
  if (sendabilityIssue) {
    await refs.alimtalkCandidate(candidate.candidateId).set(
      {
        status: "skipped",
        reasonCode: "instructor_lesson_final_guard_blocked",
        lastError: sendabilityIssue,
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
    return "skipped";
  }
  const dedupeKey = alimtalkDedupeKey(candidate);
  const dedupePolicy = alimtalkDedupePolicy(candidate.templateCode);
  const duplicate = await findCompletedDuplicateForCandidate(candidate, dedupeKey, dedupePolicy.windowDays);
  if (duplicate) {
    await refs.alimtalkCandidate(candidate.candidateId).set(
      {
        status: "skipped",
        dedupeKey,
        reasonCode: "duplicate_send_blocked",
        lastError: `중복 발송 차단(${dedupePolicy.label}): ${duplicate}`,
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
    return "skipped";
  }

  const claimed = await db.runTransaction(async (tx) => {
    const ref = refs.alimtalkCandidate(candidate.candidateId);
    const snap = await tx.get(ref);
    const current = snap.data();
    if (!current || !["candidate", "reviewed"].includes(current.status)) return null;
    const next: AlimtalkCandidateDoc = {
      ...current,
      status: "processing",
      queuedBy: "operator",
      reviewedByUid: "system:instructor-lesson-sample-approved",
      reviewedAt: nowTimestamp(),
      attempts: 0,
      maxAttempts: 1,
      dedupeKey,
      payload: {
        ...current.payload,
        deliveryMode: "approved_live",
        approvalId: instructorLessonApprovalId(
          current.studioId,
          current.sourceDate,
          normalizeInstructorLessonManagementNumber(
            String(current.payload?.managementNumber || current.payload?.materialNumber || ""),
          ),
        ),
        contentFingerprint: instructorLessonContentFingerprint(current),
      },
      lastError: null,
      updatedAt: nowTimestamp(),
    };
    tx.set(ref, next, { merge: true });
    return next;
  });
  if (!claimed) return "skipped";

  try {
    const result = await sendSolapiAlimtalk(claimed);
    const now = nowTimestamp();
    await refs
      .alimtalkCandidate(claimed.candidateId)
      .set(
        { status: "sent", attempts: 1, maxAttempts: 1, sentAt: now, lastError: null, updatedAt: now },
        { merge: true },
      );
    await refs.alimtalkSend(claimed.candidateId).set(
      {
        sendId: claimed.candidateId,
        studioId: claimed.studioId,
        candidateId: claimed.candidateId,
        memberId: claimed.memberId,
        memberName: claimed.memberName,
        memberPhone: claimed.memberPhone,
        templateCode: claimed.templateCode,
        dedupeKey,
        dedupePolicy: dedupePolicy.label,
        dedupeWindowDays: dedupePolicy.windowDays,
        status: "done",
        attempts: 1,
        maxAttempts: 1,
        nextRunAt: now,
        solapiMessageId: result.messageId,
        lastError: null,
        createdByUid: "system:instructor-lesson-sample-approved",
        createdAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
    return "sent";
  } catch (err) {
    const message = errorText(err);
    const now = nowTimestamp();
    await refs.alimtalkCandidate(claimed.candidateId).set(
      {
        status: "failed",
        attempts: 1,
        maxAttempts: 1,
        reasonCode: "instructor_lesson_provider_outcome_unknown",
        lastError: message,
        updatedAt: now,
      },
      { merge: true },
    );
    await refs.alimtalkSend(claimed.candidateId).set(
      {
        sendId: claimed.candidateId,
        studioId: claimed.studioId,
        candidateId: claimed.candidateId,
        memberId: claimed.memberId,
        memberName: claimed.memberName,
        memberPhone: claimed.memberPhone,
        templateCode: claimed.templateCode,
        dedupeKey,
        dedupePolicy: dedupePolicy.label,
        dedupeWindowDays: dedupePolicy.windowDays,
        status: "failed",
        attempts: 1,
        maxAttempts: 1,
        nextRunAt: now,
        lastError: message,
        createdByUid: "system:instructor-lesson-sample-approved",
        createdAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
    return "failed";
  }
}

function groupInstructorLessonCandidates(candidates: AlimtalkCandidateDoc[]): InstructorLessonCandidateGroup[] {
  const groups = new Map<string, InstructorLessonCandidateGroup>();
  for (const candidate of candidates) {
    if (candidate.type !== "instructor_lesson_material") continue;
    const lessonDate = String(candidate.payload?.lessonDate || candidate.payload?.lectureDate || "");
    const managementNumber = normalizeInstructorLessonManagementNumber(
      String(candidate.payload?.managementNumber || candidate.payload?.materialNumber || ""),
    );
    const phone = normalizePhone(candidate.memberPhone);
    if (!lessonDate || !managementNumber || !phone) continue;
    const key = `${lessonDate}|${managementNumber}`;
    const group = groups.get(key) || { lessonDate, managementNumber, candidates: [] };
    if (!group.candidates.some((item) => normalizePhone(item.memberPhone) === phone)) {
      group.candidates.push(candidate);
    }
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    candidates: group.candidates.sort((a, b) => a.memberName.localeCompare(b.memberName, "ko")),
  }));
}

function buildSampleCandidate(
  representative: AlimtalkCandidateDoc,
  approvalId: string,
  recipient: ReturnType<typeof primaryAlimtalkTestRecipient>,
): AlimtalkCandidateDoc {
  const now = nowTimestamp();
  const parkingLinkId = instructorLessonParkingPreviewLinkId();
  return {
    ...representative,
    candidateId: sampleCandidateId(approvalId),
    memberId: recipient.memberId,
    memberName: recipient.name,
    memberPhone: recipient.phone,
    status: "processing",
    templateCode: INSTRUCTOR_LESSON_ALIMTALK_TEMPLATE_CODE,
    title: "강사레슨 D-1 샘플",
    reason: `${recipient.reason} · ${representative.payload?.managementNumber || ""}`,
    sourceActionKey: `instructor-lesson-sample:${approvalId}`,
    payload: {
      ...representative.payload,
      memberName: recipient.name,
      deliveryMode: "sample",
      approvalId,
      parkingRequestId: "preview",
      parkingAccessToken: "",
      parkingLinkId,
      parkingShortUrl: shortUrlForId(parkingLinkId),
    },
    attempts: 0,
    maxAttempts: 1,
    queuedBy: "operator",
    reviewedByUid: "system:instructor-lesson-sample",
    reviewedAt: now,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };
}

async function writeSampleAudit(
  candidate: AlimtalkCandidateDoc,
  messageId: string,
  error: string | null,
): Promise<void> {
  const now = nowTimestamp();
  const status = error ? "failed" : "sent";
  const dedupeKey = alimtalkDedupeKey(candidate);
  await refs.alimtalkCandidate(candidate.candidateId).set({
    ...candidate,
    status,
    dedupeKey,
    attempts: 1,
    maxAttempts: 1,
    sentAt: error ? null : now,
    lastError: error,
    createdAt: candidate.createdAt,
    updatedAt: now,
  });
  await refs.alimtalkSend(candidate.candidateId).set({
    sendId: candidate.candidateId,
    studioId: candidate.studioId,
    candidateId: candidate.candidateId,
    memberId: candidate.memberId,
    memberName: candidate.memberName,
    memberPhone: candidate.memberPhone,
    templateCode: candidate.templateCode,
    dedupeKey,
    dedupePolicy: "강사레슨 D-1 운영자 샘플",
    dedupeWindowDays: null,
    status: error ? "failed" : "done",
    attempts: 1,
    maxAttempts: 1,
    nextRunAt: now,
    solapiMessageId: messageId,
    lastError: error,
    createdByUid: "system:instructor-lesson-sample",
    createdAt: now,
    updatedAt: now,
  });
}

async function instructorLessonGroupSourceIssue(group: InstructorLessonCandidateGroup): Promise<string> {
  const snapshot = (await db.collection("opsState").doc(RESERVATION_SNAPSHOT_DOC).get()).data();
  const snapshotIssue = instructorLessonReservationSnapshotIssue(snapshot, group.lessonDate);
  if (snapshotIssue) return snapshotIssue;
  for (const candidate of group.candidates) {
    const bookingId = String(candidate.payload?.bookingId || "");
    if (!bookingId) return `${candidate.memberName}: 예약 ID 없음`;
    const booking = (await refs.booking(bookingId).get()).data();
    if (!booking) return `${candidate.memberName}: 현재 예약을 찾을 수 없음`;
    if (booking.appStatus !== "reserved") return `${candidate.memberName}: 현재 예약 상태 ${booking.appStatus}`;
    if (booking.lectureDate !== group.lessonDate) return `${candidate.memberName}: 수업일 불일치`;
  }
  return "";
}

export function instructorLessonReservationSnapshotIssue(
  snapshot: FirebaseFirestore.DocumentData | undefined,
  lessonDate: string,
  nowMs = Date.now(),
): string {
  if (!snapshot?.active) return "StudioMate 최신 예약 원천 상태를 찾을 수 없음";
  if (snapshot.snapshotPolicy !== "bookings_single_source_reconcile_import_range") {
    return "StudioMate 예약 원천 정책 확인 필요";
  }
  const startDate = String(snapshot.dateRange?.startDate || "");
  const endDate = String(snapshot.dateRange?.endDate || "");
  if (!startDate || !endDate || lessonDate < startDate || lessonDate > endDate) {
    return `StudioMate 최신 예약 원천 범위에 수업일 ${lessonDate} 없음`;
  }
  const updatedAtMs = timestampMillis(snapshot.updatedAt);
  if (!updatedAtMs || nowMs - updatedAtMs > BOOKING_FRESHNESS_MS) {
    return "StudioMate 예약 원천 스냅샷이 24시간 이내 동기화되지 않음";
  }
  if (!(Number(snapshot.importedBookings || 0) > 0)) {
    return "StudioMate 최신 예약 원천에 예약 행이 없음";
  }
  return "";
}

function timestampMillis(value: unknown): number {
  if (value && typeof (value as { toMillis?: () => number }).toMillis === "function") {
    return Number((value as { toMillis: () => number }).toMillis()) || 0;
  }
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

async function instructorLessonRouteIssue(lessonDate: string, managementNumber: string): Promise<string> {
  const materialUrl = `https://in.archivepilates.com/method/${encodeURIComponent(managementNumber)}`;
  const assignmentUrl = `${materialUrl}/assignment`;
  try {
    const [materialResponse, assignmentResponse] = await Promise.all([
      fetch(materialUrl, { redirect: "follow", signal: AbortSignal.timeout(10_000) }),
      fetch(assignmentUrl, { redirect: "follow", signal: AbortSignal.timeout(10_000) }),
    ]);
    if (!materialResponse.ok) return `수업자료 링크 응답 ${materialResponse.status}`;
    if (!assignmentResponse.ok) return `수업배정 링크 응답 ${assignmentResponse.status}`;
    const html = await materialResponse.text();
    if (!html.includes(`data-method-date="${lessonDate}"`)) return "수업자료 공개일 표시 불일치";
    if (!html.includes("수업자료는 수업 당일 12시에 공개됩니다.")) return "수업자료 12시 공개 안내 없음";
    return "";
  } catch (err) {
    return `수업자료 링크 확인 실패: ${errorText(err)}`;
  }
}

async function sendSampleApprovalEmail(
  ref: FirebaseFirestore.DocumentReference,
  approval: InstructorLessonApprovalDoc,
  reminder = false,
): Promise<void> {
  const token = randomBytes(24).toString("hex");
  const approvalUrl = `${APPROVAL_FUNCTION_URL}?id=${encodeURIComponent(approval.approvalId)}&token=${token}`;
  await ref.set({ approvalTokenHash: tokenHash(token), updatedAt: nowTimestamp() }, { merge: true });
  const names = approval.candidateNames.join(", ");
  const body = [
    "ARCHIVE IN / 강사레슨 D-1 샘플 승인",
    "",
    `수업일: ${approval.lessonDate}`,
    `관리번호: ${approval.managementNumber}`,
    `샘플 수신: ${approval.sampleRecipientName}`,
    `SOLAPI 메시지 ID: ${approval.sampleSolapiMessageId || "확인필요"}`,
    `콘텐츠 지문: ${approval.contentFingerprint}`,
    `본 발송 예정: ${approval.candidateCount}명`,
    `대상: ${names}`,
    "",
    "샘플의 문구와 버튼 3개를 확인한 뒤 아래 링크로 승인해주세요.",
    "승인 전에는 본 발송되지 않으며, 승인 후에도 D-1 18:00 KST에 발송됩니다.",
    approvalUrl,
  ].join("\n");
  const htmlBody = [
    '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#171717;max-width:640px;margin:0 auto;padding:24px">',
    `<p style="font-size:13px;color:#666">ARCHIVE IN / 강사레슨 D-1 샘플 승인</p>`,
    `<h2 style="font-size:22px;margin:8px 0 20px">${escapeHtml(approval.lessonDate)} 강사레슨</h2>`,
    `<p>샘플 수신: <b>${escapeHtml(approval.sampleRecipientName)}</b><br>본 발송 예정: <b>${approval.candidateCount}명</b><br>관리번호: <code>${escapeHtml(approval.managementNumber)}</code></p>`,
    `<p style="color:#555">대상: ${escapeHtml(names)}</p>`,
    '<p style="margin-top:20px">샘플의 문구와 버튼 3개를 확인한 뒤 승인해주세요. 승인 후에도 D-1 18:00 KST에 발송됩니다.</p>',
    `<a href="${escapeHtml(approvalUrl)}" style="display:inline-block;margin-top:12px;background:#171717;color:#fff;text-decoration:none;padding:13px 18px;border-radius:6px;font-weight:700">샘플 확인 완료 · 발송 승인</a>`,
    "</div>",
  ].join("");
  await sendAlimtalkLogEmail({
    subject: `[알림톡][긴급] ${reminder ? "재확인 " : ""}강사레슨 샘플 승인 ${approval.lessonDate}`,
    body,
    htmlBody,
    status: "urgent",
  });
  await ref.set({ approvalEmailSentAt: nowTimestamp(), updatedAt: nowTimestamp() }, { merge: true });
}

async function trySendSampleApprovalEmail(
  ref: FirebaseFirestore.DocumentReference,
  approval: InstructorLessonApprovalDoc,
): Promise<void> {
  try {
    await sendSampleApprovalEmail(ref, approval);
  } catch (err) {
    await ref.set(
      {
        lastError: `샘플 발송 성공, 승인 이메일 실패: ${errorText(err)}`,
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
  }
}

async function sendInstructorLessonAttentionEmail(input: {
  subject: string;
  lessonDate: string;
  managementNumber: string;
  issue: string;
}): Promise<void> {
  await sendAlimtalkLogEmail({
    subject: input.subject,
    body: [
      "ARCHIVE IN / 강사레슨 D-1 알림톡",
      "",
      `수업일: ${input.lessonDate}`,
      `관리번호: ${input.managementNumber}`,
      `결론: ${input.issue}`,
      "",
      "본 발송은 진행되지 않았습니다.",
    ].join("\n"),
    status: "urgent",
  });
}

async function sendInstructorLessonResultEmail(
  approval: InstructorLessonApprovalDoc,
  result: { sent: number; skipped: number; failed: number },
): Promise<void> {
  const failed = result.failed > 0;
  await sendAlimtalkLogEmail({
    subject: `[알림톡][${failed ? "실패" : "성공"}] 강사레슨 D-1 발송 ${approval.lessonDate}`,
    body: [
      "ARCHIVE IN / 강사레슨 D-1 알림톡",
      "",
      `수업일: ${approval.lessonDate}`,
      `관리번호: ${approval.managementNumber}`,
      `성공: ${result.sent}건`,
      `제외: ${result.skipped}건`,
      `실패: ${result.failed}건`,
    ].join("\n"),
    status: failed ? "failure" : "success",
  });
}

async function approvalsForSourceDate(studioId: string, sourceDate: string): Promise<InstructorLessonApprovalDoc[]> {
  const snap = await db.collection(APPROVAL_COLLECTION).where("sourceDate", "==", sourceDate).limit(20).get();
  return snap.docs
    .map((doc) => doc.data() as InstructorLessonApprovalDoc)
    .filter((approval) => approval.studioId === studioId);
}

async function candidatesByIds(candidateIds: string[], studioId: string): Promise<AlimtalkCandidateDoc[]> {
  const snaps = await Promise.all(
    [...new Set(candidateIds)].map((candidateId) => refs.alimtalkCandidate(candidateId).get()),
  );
  return snaps
    .map((snap) => snap.data())
    .filter((candidate): candidate is AlimtalkCandidateDoc => Boolean(candidate?.studioId === studioId));
}

function sampleCandidateId(approvalId: string): string {
  return `${approvalId}_sample`;
}

function tokenHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function approvalConfirmationHtml(approvalId: string, token: string, approval: InstructorLessonApprovalDoc): string {
  const action = escapeHtml(APPROVAL_FUNCTION_URL);
  return [
    "<!doctype html>",
    '<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    "<title>강사레슨 알림톡 승인</title></head>",
    '<body style="font-family:Arial,sans-serif;line-height:1.6;color:#171717;max-width:560px;margin:40px auto;padding:20px">',
    '<h1 style="font-size:24px">강사레슨 D-1 알림톡 승인</h1>',
    `<p>수업일: <b>${escapeHtml(approval.lessonDate)}</b><br>관리번호: <code>${escapeHtml(approval.managementNumber)}</code><br>본 발송 예정: <b>${approval.candidateCount}명</b><br>발송 시각: D-1 18:00 KST</p>`,
    '<p style="color:#555">샘플의 문구와 버튼 3개를 직접 확인했다면 아래 버튼으로 승인해주세요. 이 화면을 여는 것만으로는 승인되지 않습니다.</p>',
    `<form method="post" action="${action}">`,
    `<input type="hidden" name="id" value="${escapeHtml(approvalId)}">`,
    `<input type="hidden" name="token" value="${escapeHtml(token)}">`,
    '<button type="submit" style="border:0;border-radius:6px;background:#171717;color:#fff;padding:14px 18px;font-size:16px;font-weight:700">샘플 확인 완료 · 발송 승인</button>',
    "</form>",
    "</body></html>",
  ].join("");
}

function kstDate(now: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(now);
}

function kstMinutes(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function escapeHtml(value: string): string {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function instructorLessonApprovalCollectionName(): string {
  return APPROVAL_COLLECTION;
}

export function instructorLessonLiveSendHourKst(): number {
  return LIVE_SEND_HOUR_KST;
}
