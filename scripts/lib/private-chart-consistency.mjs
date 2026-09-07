import { inactivePrivateBookingReason, isPrivateBooking } from "./private-session-order-policy.mjs";

const LEGACY_AUTO_CANCELLATION_REASONS = new Set([
  "booking_not_in_private_session_ledger",
  "chart_request_not_in_private_session_ledger",
  "missing_from_latest_reservation_import",
  "stale",
  "lecture_deleted",
  "deleted",
  "source_inactive",
  "missing_booking",
  "booking_not_found",
  "rescheduled_duplicate",
  "duplicate_source",
  "fallback_source_superseded",
  "session_order_excluded",
  "not_in_private_session_ledger",
  "past_unchecked_attendance",
  "not_private_booking",
]);
const AUTO_REVIEW_REASON = /(출석|회차|예약|원천).*(확인|재검증)|booking_not_in_private_session_ledger|not_in_private_session_ledger/i;

export function isAutoPrivateChartCancellationReason(value, source = "") {
  if (String(source || "").trim() === "system_booking_reconcile") return true;
  const reason = String(value || "").trim().toLowerCase();
  return LEGACY_AUTO_CANCELLATION_REASONS.has(reason) ||
    /^booking_app_status_(cancel|cancelled|canceled)$/.test(reason) ||
    /^booking_status_(cancelled|canceled|superseded)$/.test(reason) ||
    /^attendance_status_(absent|late_cancel)$/.test(reason);
}

export function isAutoPrivateChartReviewReason(value) {
  return AUTO_REVIEW_REASON.test(String(value || "").trim());
}

export function privateChartRequestStatusFromSubmissions(request) {
  if (request?.preStatus === "submitted" && request?.postStatus === "submitted") return "completed";
  if (request?.preStatus === "submitted") return "pre_submitted";
  if (request?.postStatus === "submitted") return "post_submitted";
  return "pending";
}

export function reactivatedPrivateChartAlimtalk(alimtalk = {}, { scheduleChanged = false } = {}) {
  const sent = String(alimtalk?.status || "") === "sent";
  return {
    ...(alimtalk || {}),
    status: sent ? "sent" : "template_pending",
    ...(scheduleChanged && sent ? { reasonCode: "schedule_changed_after_send" } : {}),
    lastError: scheduleChanged && sent
      ? "강사 알림톡 발송 후 수업 일정이 변경되었습니다. 링크는 최신 일정으로 연결됩니다."
      : null,
  };
}

export function classifyPrivateChartStateIssues({ requests = [], recordsById = new Map(), bookingsById = new Map(), options = {} } = {}) {
  const autoCancelledActive = [];
  const roundMismatches = [];
  const staleActiveRecords = [];
  const workflowWarnings = [];

  for (const entry of requests) {
    const request = documentData(entry);
    const requestId = String(entry?.id || request.requestId || "");
    const bookingId = String(request.bookingId || "");
    const booking = documentData(bookingsById.get(bookingId));
    const record = documentData(recordsById.get(requestId));
    const bookingRound = positiveNumber(booking?.sessionOrder?.privateCumulativeRound);
    const activeBooking = Boolean(
      bookingId &&
      booking &&
      isPrivateBooking(booking) &&
      !inactivePrivateBookingReason(booking, options) &&
      booking.sessionOrder?.counted !== false &&
      bookingRound,
    );
    const reportGenerated = Boolean(
      ["draft_created", "approved", "published"].includes(String(record.gptStatus || "")) ||
      record.publicReportUrl ||
      record.publicReportCanonicalUrl,
    );
    const reportSent = Boolean(
      record.publicReportApproval?.status === "sent" ||
      record.publicReportApproval?.sentAt ||
      record.sentRevision,
    );
    if (
      (request.status === "cancelled" && reportGenerated) ||
      (request.status === "pre_submitted" && reportGenerated && !reportSent)
    ) {
      workflowWarnings.push({ requestId, bookingId, memberId: String(request.memberId || ""), request, record, booking });
    }
    if (!activeBooking) continue;

    const autoCancelled = request.status === "cancelled" &&
      isAutoPrivateChartCancellationReason(request.cancellationReason, request.cancellationSource);
    if (autoCancelled) {
      autoCancelledActive.push({ requestId, bookingId, memberId: String(request.memberId || ""), request, record, booking });
    }

    const requestRound = positiveNumber(request.sessionNumber);
    const recordRound = positiveNumber(record.sessionNumber);
    if (requestRound !== bookingRound || (recordRound && recordRound !== bookingRound)) {
      roundMismatches.push({ requestId, bookingId, memberId: String(request.memberId || ""), requestRound, recordRound, bookingRound });
    }

    const activeRequest = request.status !== "cancelled";
    const staleRecord = Boolean(
      record &&
      (isAutoPrivateChartCancellationReason(record.cancellationReason, record.cancellationSource) ||
        (activeRequest && (record.cancelledAt || record.sessionStatus === "cancelled")) ||
        (activeRequest && isAutoPrivateChartReviewReason(record.notionProjectionControl?.reviewReason))),
    );
    if (staleRecord) {
      staleActiveRecords.push({ requestId, bookingId, memberId: String(request.memberId || ""), request, record, booking });
    }
  }

  return { autoCancelledActive, roundMismatches, staleActiveRecords, workflowWarnings };
}

function documentData(value) {
  if (!value) return {};
  if (typeof value.data === "function") return value.data() || {};
  return value.data && typeof value.data === "object" ? value.data : value;
}

function positiveNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}
