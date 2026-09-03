import { logger } from "firebase-functions";
import { DEFAULT_STUDIO_ID } from "../config/constants";
import { db } from "../config/firebase";
import { refs } from "../firestore/refs";
import type { AlimtalkCandidateDoc } from "../types/models";
import { nowTimestamp, todayKst } from "../utils/date";
import { autoSendabilityIssue } from "./eligibility";
import { rebuildAlimtalkCandidatesForRange } from "./rebuildAlimtalkCandidates";
import { requireApprovalForLargeAlimtalkBatch } from "./approvalGate";
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
    return {
      rebuilt: rebuilt.candidates,
      queued: 0,
      blocked: blocked + sendable.length,
      approvalRequired: true,
      approvalId: approval.approvalId,
      instructorLessonSample,
    };
  }

  let queued = 0;
  for (const candidate of sendable) {
    const didQueue = await queueCandidate(candidate, today);
    if (didQueue) queued += 1;
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

export async function queueReservationOpenAlimtalkCandidates(
  input: {
    studioId?: string;
    today?: string;
  } = {},
): Promise<{ rebuilt: number; queued: number; blocked: number; approvalRequired?: boolean; approvalId?: string }> {
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
    return {
      rebuilt: rebuilt.candidates,
      queued: 0,
      blocked: blocked + sendable.length,
      approvalRequired: true,
      approvalId: approval.approvalId,
    };
  }

  let queued = 0;
  for (const candidate of sendable) {
    const didQueue = await queueCandidate(candidate, today, "system:auto-reservation-open-1230");
    if (didQueue) queued += 1;
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
  reviewedByUid = "system:auto-daily-1130",
): Promise<boolean> {
  if (await autoSendabilityIssue(candidate, today)) return false;
  return db.runTransaction(async (tx) => {
    const ref = refs.alimtalkCandidate(candidate.candidateId);
    const snap = await tx.get(ref);
    const current = snap.data();
    if (!current) return false;
    if (!["candidate", "reviewed", "failed"].includes(current.status)) return false;
    if ((current.attempts || 0) >= (current.maxAttempts || 2)) return false;
    tx.set(
      ref,
      {
        status: "queued",
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
