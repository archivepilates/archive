import { logger } from "firebase-functions";
import { DEFAULT_STUDIO_ID } from "../config/constants";
import { db } from "../config/firebase";
import { refs } from "../firestore/refs";
import type { AlimtalkCandidateDoc } from "../types/models";
import { nowTimestamp, todayKst } from "../utils/date";
import { autoSendabilityIssue } from "./eligibility";
import { rebuildAlimtalkCandidatesForRange } from "./rebuildAlimtalkCandidates";
import { approvalQueueEligibilityIssue, requireApprovalForLargeAlimtalkBatch } from "./approvalGate";
import { alimtalkApprovalSnapshotKey } from "./approvalPolicy";
import { alimtalkApprovalClaimIssue, approvalCandidateBinding } from "./approvalStore";
import { privateSurveySendabilityIssue } from "./privateSurveySendGuard";
import { renewalCandidateSendabilityIssue } from "./renewalSendGuard";
import { selectDailyAlimtalkCandidates } from "./dailyCandidateSelection";
import {
  prepareInstructorLessonSampleApprovals,
  splitInstructorLessonCandidates,
  type InstructorLessonSampleApprovalSummary,
} from "./instructorLessonSampleApproval";

export async function queueDailyAlimtalkCandidates(
  input: {
    studioId?: string;
    today?: string;
  } = {},
): Promise<{
  rebuilt: number;
  queued: number;
  blocked: number;
  approvalRequired?: boolean;
  approvalId?: string;
  pendingApprovalIds?: string[];
  instructorLessonSample?: InstructorLessonSampleApprovalSummary;
}> {
  const studioId = input.studioId || DEFAULT_STUDIO_ID;
  const today = input.today || todayKst();
  const rebuilt = await rebuildAlimtalkCandidatesForRange({
    studioId,
    startDate: today,
    endDate: today,
  });
  const candidates = await listRebuiltCandidates(rebuilt.candidateIds, studioId);

  let sendable: AlimtalkCandidateDoc[] = [];
  let blocked = 0;
  for (const candidate of candidates) {
    if (!["candidate", "reviewed", "failed"].includes(candidate.status)) {
      blocked += 1;
      continue;
    }
    const autoIssue = await autoSendabilityIssue(candidate, today);
    if (autoIssue) {
      if (autoIssue.startsWith("수강권 사실 안내 템플릿 검토 대기:")) {
        await markTicketFactTemplateReview(candidate, autoIssue);
      }
      blocked += 1;
      continue;
    }
    const privateSurveyIssue = await privateSurveySendabilityIssue(candidate);
    if (privateSurveyIssue) {
      await markDailyCandidateSkipped(candidate, "private_survey_booking_blocked", privateSurveyIssue);
      blocked += 1;
      continue;
    }
    const renewalIssue = await renewalCandidateSendabilityIssue(candidate);
    if (renewalIssue) {
      await markDailyCandidateSkipped(candidate, "renewal_source_recheck_blocked", renewalIssue);
      blocked += 1;
      continue;
    }
    sendable.push(candidate);
  }

  const selection = selectDailyAlimtalkCandidates(sendable);
  sendable = selection.selected;
  blocked += selection.suppressed.length;
  await Promise.all(
    selection.suppressed.map(({ candidate, reason }) =>
      markDailyCandidateSkipped(candidate, "same_day_message_priority", reason),
    ),
  );

  const split = splitInstructorLessonCandidates(sendable);
  const instructorLessonSample = await prepareInstructorLessonSampleApprovals({
    studioId,
    sourceDate: today,
    candidates: split.instructorLesson,
  });
  sendable = split.other;
  blocked += split.instructorLesson.length;

  const approval = await requireApprovalForLargeAlimtalkBatch({
    studioId,
    today,
    candidates: sendable,
    approvalScope: "daily",
  });
  if (approval.required && !approval.approved) {
    logger.info("queueDailyAlimtalkCandidates awaiting approval", {
      studioId,
      today,
      rebuilt: rebuilt.candidates,
      sendable: sendable.length,
      blocked,
      approvalId: approval.approvalId,
      emailed: approval.emailed,
    });
  }

  let queued = 0;
  const allowed = new Set(approval.allowedCandidateIds);
  for (const candidate of sendable) {
    if (!allowed.has(candidate.candidateId)) {
      blocked += 1;
      continue;
    }
    const didQueue = await queueCandidate(candidate, today, approval.required);
    if (didQueue) queued += 1;
    else blocked += 1;
  }

  logger.info("queueDailyAlimtalkCandidates completed", {
    studioId,
    today,
    rebuilt: rebuilt.candidates,
    queued,
    blocked,
  });
  return {
    rebuilt: rebuilt.candidates,
    queued,
    blocked,
    approvalRequired: approval.required,
    approvalId: approval.approvalId,
    pendingApprovalIds: approval.pendingApprovalIds,
    instructorLessonSample,
  };
}

async function markDailyCandidateSkipped(
  candidate: AlimtalkCandidateDoc,
  reasonCode: string,
  lastError: string,
): Promise<void> {
  await refs.alimtalkCandidate(candidate.candidateId).set(
    {
      status: "skipped",
      reasonCode,
      lastError,
      updatedAt: nowTimestamp(),
    },
    { merge: true },
  );
}

async function markTicketFactTemplateReview(candidate: AlimtalkCandidateDoc, lastError: string): Promise<void> {
  await db.runTransaction(async (tx) => {
    const ref = refs.alimtalkCandidate(candidate.candidateId);
    const current = (await tx.get(ref)).data();
    if (!current || !["candidate", "reviewed", "failed"].includes(current.status)) return;
    if (alimtalkApprovalSnapshotKey(current) !== alimtalkApprovalSnapshotKey(candidate)) return;
    tx.set(
      ref,
      { status: "reviewed", reasonCode: "ticket_fact_template_review", lastError, updatedAt: nowTimestamp() },
      { merge: true },
    );
  });
}

export async function queueReservationOpenAlimtalkCandidates(
  input: {
    studioId?: string;
    today?: string;
  } = {},
): Promise<{
  rebuilt: number;
  queued: number;
  blocked: number;
  approvalRequired?: boolean;
  approvalId?: string;
  pendingApprovalIds?: string[];
}> {
  const studioId = input.studioId || DEFAULT_STUDIO_ID;
  const today = input.today || todayKst();
  const rebuilt = await rebuildAlimtalkCandidatesForRange({
    studioId,
    startDate: today,
    endDate: today,
    mode: "reservation_open",
  });
  const candidates = await listRebuiltCandidates(rebuilt.candidateIds, studioId);

  const sendable: AlimtalkCandidateDoc[] = [];
  let blocked = 0;
  for (const candidate of candidates) {
    if (
      candidate.type !== "reservation_open" ||
      !["candidate", "reviewed", "failed"].includes(candidate.status) ||
      (await autoSendabilityIssue(candidate, today))
    ) {
      blocked += 1;
      continue;
    }
    sendable.push(candidate);
  }

  const approval = await requireApprovalForLargeAlimtalkBatch({
    studioId,
    today,
    candidates: sendable,
    approvalScope: "reservation_open",
  });
  if (approval.required && !approval.approved) {
    logger.info("queueReservationOpenAlimtalkCandidates awaiting approval", {
      studioId,
      today,
      rebuilt: rebuilt.candidates,
      sendable: sendable.length,
      blocked,
      approvalId: approval.approvalId,
      emailed: approval.emailed,
    });
  }

  let queued = 0;
  const allowed = new Set(approval.allowedCandidateIds);
  for (const candidate of sendable) {
    if (!allowed.has(candidate.candidateId)) {
      blocked += 1;
      continue;
    }
    const didQueue = await queueCandidate(candidate, today, approval.required, "system:auto-reservation-open-1230");
    if (didQueue) queued += 1;
    else blocked += 1;
  }

  logger.info("queueReservationOpenAlimtalkCandidates completed", {
    studioId,
    today,
    rebuilt: rebuilt.candidates,
    queued,
    blocked,
  });
  return {
    rebuilt: rebuilt.candidates,
    queued,
    blocked,
    approvalRequired: approval.required,
    approvalId: approval.approvalId,
    pendingApprovalIds: approval.pendingApprovalIds,
  };
}

async function listRebuiltCandidates(candidateIds: string[], studioId: string): Promise<AlimtalkCandidateDoc[]> {
  const uniqueIds = [...new Set(candidateIds)];
  const snaps = await Promise.all(uniqueIds.map((candidateId) => refs.alimtalkCandidate(candidateId).get()));
  return snaps
    .map((snap) => snap.data())
    .filter((candidate): candidate is AlimtalkCandidateDoc => Boolean(candidate && candidate.studioId === studioId));
}

async function queueCandidate(
  candidate: AlimtalkCandidateDoc,
  today: string,
  approvalRequired: boolean,
  reviewedByUid = "system:auto-daily-1130",
): Promise<boolean> {
  if (await approvalQueueEligibilityIssue(candidate, today)) return false;
  return db.runTransaction(async (tx) => {
    const ref = refs.alimtalkCandidate(candidate.candidateId);
    const snap = await tx.get(ref);
    const current = snap.data();
    if (!current) return false;
    if (!["candidate", "reviewed", "failed"].includes(current.status)) return false;
    if ((current.attempts || 0) >= (current.maxAttempts || 2)) return false;
    if (alimtalkApprovalSnapshotKey(current) !== alimtalkApprovalSnapshotKey(candidate)) return false;
    const binding = {
      ...approvalCandidateBinding(current, today),
      approvalGateMode: approvalRequired ? "snapshot" as const : "below_threshold" as const,
    };
    if (await alimtalkApprovalClaimIssue(tx, { ...current, ...binding }, today)) return false;
    if (await approvalQueueEligibilityIssue(current, today)) return false;
    tx.set(
      ref,
      {
        status: "queued",
        ...binding,
        queuedBy: "auto",
        reviewedByUid,
        reviewedAt: nowTimestamp(),
        attempts: current.attempts || 0,
        maxAttempts: current.maxAttempts || 2,
        lastError: null,
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
    return true;
  });
}
