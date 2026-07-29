import type {
  BookingDoc,
  PrivateLessonChartRecordDoc,
  PrivateLessonChartRequestDoc,
  PrivateLessonSessionDoc,
  PrivateLessonWorkflowStage,
} from "../types/models";
import { db } from "../config/firebase";
import { refs } from "../firestore/refs";
import { nowTimestamp } from "../utils/date";
import { currentPrivateLessonReportRevision } from "./privateLessonReportRevision";

export async function syncPrivateLessonSessionByRequestId(requestId: string): Promise<void> {
  if (!requestId) return;
  await db.runTransaction(async (tx) => {
    const requestRef = refs.privateLessonChartRequest(requestId);
    const recordRef = refs.privateLessonChartRecord(requestId);
    const sessionRef = refs.privateLessonSession(requestId);
    const [requestSnap, recordSnap, sessionSnap] = await Promise.all([
      tx.get(requestRef),
      tx.get(recordRef),
      tx.get(sessionRef),
    ]);
    const request = requestSnap.data();
    const record = recordSnap.data();
    if (!request && !record) {
      if (sessionSnap.exists) tx.delete(sessionRef);
      return;
    }
    const bookingId = String(request?.bookingId || record?.bookingId || "");
    const booking = bookingId ? (await tx.get(refs.booking(bookingId))).data() : undefined;
    const sessionNumber = positiveNumber(request?.sessionNumber || record?.sessionNumber);
    const roundVerified = privateLessonRoundVerified(booking, sessionNumber);
    const session = privateLessonSessionProjection(
      requestId,
      request,
      record,
      sessionSnap.data(),
      { roundVerified },
    );
    tx.set(sessionRef, session, { merge: true });
  });
}

export async function syncPrivateLessonSessionOnRequestWrite(event: any): Promise<void> {
  await syncPrivateLessonSessionByRequestId(String(event.params?.requestId || ""));
}

export async function syncPrivateLessonSessionOnRecordWrite(event: any): Promise<void> {
  await syncPrivateLessonSessionByRequestId(String(event.params?.recordId || ""));
}

export function privateLessonSessionProjection(
  requestId: string,
  request: PrivateLessonChartRequestDoc | undefined,
  record: PrivateLessonChartRecordDoc | undefined,
  previous?: PrivateLessonSessionDoc,
  options: { roundVerified?: boolean } = {},
): PrivateLessonSessionDoc {
  const now = nowTimestamp();
  const approvalStatus = String(record?.publicReportApproval?.status || "");
  const reportRevision = record ? currentPrivateLessonReportRevision(record) : "";
  const roundVerified = options.roundVerified ?? Boolean(
    positiveNumber(request?.sessionNumber || record?.sessionNumber) &&
    !String(request?.bookingId || record?.bookingId || "").startsWith("usage_booking_"),
  );
  const workflowStage = privateLessonWorkflowStage(request, record, roundVerified);
  const bookingId = String(request?.bookingId || record?.bookingId || previous?.bookingId || "");
  const bookingAliases = uniqueStrings([
    ...(previous?.bookingAliases || []),
    previous?.bookingId,
    request?.rescheduleCorrection?.fromBookingId,
    request?.rescheduleCorrection?.toBookingId,
    record?.rescheduleCorrection?.fromBookingId,
    record?.rescheduleCorrection?.toBookingId,
    bookingId,
  ]);
  const reportStatus = reportStatusFor(record);
  const deliveryStatus =
    approvalStatus === "sent"
      ? "sent"
      : approvalStatus === "processing"
        ? "processing"
        : approvalStatus === "queued"
          ? "queued"
          : approvalStatus === "failed"
            ? "failed"
            : "pending";

  return {
    sessionId: requestId,
    studioId: String(request?.studioId || record?.studioId || previous?.studioId || ""),
    bookingId,
    bookingAliases,
    occurrenceId: String(previous?.occurrenceId || requestId),
    memberId: String(request?.memberId || record?.memberId || previous?.memberId || ""),
    memberName: String(request?.memberName || record?.memberName || previous?.memberName || ""),
    staffId: String(request?.staffId || record?.staffId || previous?.staffId || ""),
    staffName: String(request?.staffName || record?.staffName || previous?.staffName || ""),
    lessonDate: String(request?.lessonDate || record?.lessonDate || previous?.lessonDate || ""),
    lessonStartAt: request?.lessonStartAt || record?.lessonStartAt || previous?.lessonStartAt || null,
    sessionNumber: positiveNumber(request?.sessionNumber || record?.sessionNumber || previous?.sessionNumber),
    roundVerified,
    workflowStage,
    preStatus: request?.preStatus || (record?.preSubmittedAt ? "submitted" : "pending"),
    postStatus: request?.postStatus || (record?.postSubmittedAt ? "submitted" : "pending"),
    reportStatus,
    deliveryStatus,
    reportRevision,
    approvedRevision: String(record?.approvedRevision || ""),
    sentRevision: String(record?.sentRevision || ""),
    nextAction: nextActionFor(workflowStage, request, record),
    cancellationReason: String(request?.cancellationReason || record?.cancellationReason || ""),
    lastError: String(record?.publicReportApproval?.lastError || record?.gptError || ""),
    legacyRequestId: requestId,
    legacyRecordId: String(record?.recordId || requestId),
    notionProjection: {
      status: record?.notionSync?.status || previous?.notionProjection?.status || "pending",
      pageId: record?.notionSync?.instructorPageId || previous?.notionProjection?.pageId,
      pageUrl: record?.notionSync?.instructorPageUrl || previous?.notionProjection?.pageUrl,
      updatedAt: now,
      error: record?.notionSync?.error || "",
    },
    createdAt: previous?.createdAt || request?.createdAt || record?.createdAt || now,
    updatedAt: now,
  };
}

function privateLessonWorkflowStage(
  request: PrivateLessonChartRequestDoc | undefined,
  record: PrivateLessonChartRecordDoc | undefined,
  roundVerified: boolean,
): PrivateLessonWorkflowStage {
  if (request?.status === "cancelled" || request?.cancelledAt || record?.cancelledAt) return "cancelled";
  if (!positiveNumber(request?.sessionNumber || record?.sessionNumber) || !roundVerified) return "needs_review";
  if (
    record?.publicReportApproval?.status === "sent" ||
    record?.publicReportApproval?.sentAt ||
    record?.sentRevision ||
    record?.gptStatus === "published"
  ) {
    return "delivered";
  }
  if (
    record?.postSubmittedAt ||
    request?.postStatus === "submitted" ||
    ["draft_created", "approved"].includes(String(record?.gptStatus || ""))
  ) {
    return "report_review";
  }
  if (record?.preSubmittedAt || request?.preStatus === "submitted") return "recording";
  return "preparation";
}

export function privateLessonRoundVerified(
  booking: BookingDoc | undefined,
  sessionNumber: number | null,
): boolean {
  return Boolean(
    booking &&
    booking.sessionOrder?.counted !== false &&
    positiveNumber(booking.sessionOrder?.privateCumulativeRound) === positiveNumber(sessionNumber),
  );
}

function reportStatusFor(
  record: PrivateLessonChartRecordDoc | undefined,
): PrivateLessonSessionDoc["reportStatus"] {
  const approvalStatus = String(record?.publicReportApproval?.status || "");
  if (approvalStatus === "sent") return "sent";
  if (approvalStatus === "processing") return "processing";
  if (approvalStatus === "approved" || approvalStatus === "queued") return "approved";
  if (approvalStatus === "failed" || record?.gptStatus === "failed") return "failed";
  if (record?.gptStatus === "draft_created") return "draft";
  return "pending";
}

function nextActionFor(
  stage: PrivateLessonWorkflowStage,
  request: PrivateLessonChartRequestDoc | undefined,
  record: PrivateLessonChartRecordDoc | undefined,
): string {
  if (stage === "cancelled") return "없음";
  if (stage === "needs_review") return "회차 확인";
  if (stage === "delivered") return "완료";
  if (stage === "preparation") return request?.preStatus === "submitted" ? "수업 진행" : "수업 전 계획 작성";
  if (stage === "recording") return "수업 후 기록 작성";
  if (!record?.postSubmittedAt) return "수업 후 기록 확인";
  if (record.gptStatus !== "draft_created") return "리포트 생성 확인";
  if (!["approved", "queued", "processing", "sent"].includes(String(record.publicReportApproval?.status || ""))) {
    return "리포트 검수·승인";
  }
  return "발송 상태 확인";
}

function positiveNumber(value: unknown): number | null {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}
