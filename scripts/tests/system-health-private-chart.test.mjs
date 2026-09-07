import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  classifyPrivateChartStateIssues,
  isAutoPrivateChartCancellationReason,
  privateChartRequestStatusFromSubmissions,
  reactivatedPrivateChartAlimtalk,
} from "../lib/private-chart-consistency.mjs";

const booking = (overrides = {}) => ({
  bookingId: "booking-1",
  lessonType: "private",
  lectureDate: "2026-09-04",
  appStatus: "reserved",
  attendanceStatus: "attended",
  sessionOrder: { counted: true, privateCumulativeRound: 5 },
  ...overrides,
});
const request = (overrides = {}) => ({
  requestId: "plc_booking-1",
  bookingId: "booking-1",
  memberId: "member-1",
  lessonDate: "2026-09-04",
  status: "cancelled",
  cancellationReason: "booking_not_in_private_session_ledger",
  sessionNumber: 5,
  preStatus: "pending",
  postStatus: "pending",
  ...overrides,
});
const record = (overrides = {}) => ({
  recordId: "plc_booking-1",
  bookingId: "booking-1",
  memberId: "member-1",
  sessionNumber: 5,
  sessionStatus: "cancelled",
  cancellationReason: "booking_not_in_private_session_ledger",
  cancelledAt: { seconds: 1 },
  notionProjectionControl: { memberPageId: "member-page", reviewReason: "출석 원천 확인필요" },
  ...overrides,
});

function classify(requestValue = request(), recordValue = record(), bookingValue = booking()) {
  return classifyPrivateChartStateIssues({
    requests: [{ id: requestValue.requestId, data: requestValue }],
    recordsById: new Map([[requestValue.requestId, { id: requestValue.requestId, data: recordValue }]]),
    bookingsById: new Map([[bookingValue.bookingId, { id: bookingValue.bookingId, data: bookingValue }]]),
    options: { todayKst: "2026-09-07" },
  });
}

test("active canonical booking exposes a legacy auto-cancelled chart and stale Notion state", () => {
  const result = classify();
  assert.deepEqual(result.autoCancelledActive.map((row) => row.requestId), ["plc_booking-1"]);
  assert.deepEqual(result.staleActiveRecords.map((row) => row.requestId), ["plc_booking-1"]);
  assert.equal(result.roundMismatches.length, 0);
});

test("operator and unknown cancellations are never treated as automatic recovery", () => {
  for (const cancellationReason of ["operator_cancelled", "deleted_by_operator", "live_validation_cleanup", ""]) {
    assert.equal(isAutoPrivateChartCancellationReason(cancellationReason), false);
    assert.equal(classify(request({ cancellationReason }), {}, booking()).autoCancelledActive.length, 0);
  }
  assert.equal(isAutoPrivateChartCancellationReason("future_reason", "system_booking_reconcile"), true);
});

test("inactive or unverified bookings cannot reactivate a chart", () => {
  for (const value of [
    booking({ appStatus: "cancelled" }),
    booking({ attendanceStatus: "unchecked" }),
    booking({ sessionOrder: { counted: false, privateCumulativeRound: null } }),
  ]) {
    assert.equal(classify(request(), record(), value).autoCancelledActive.length, 0);
  }
});

test("active requests expose request or record round drift and stale record-only cancellation", () => {
  const result = classify(
    request({ status: "pending", cancellationReason: null, cancelledAt: null, sessionNumber: 4 }),
    record({ sessionNumber: 4 }),
  );
  assert.equal(result.roundMismatches.length, 1);
  assert.equal(result.staleActiveRecords.length, 1);
});

test("submission state and Alimtalk evidence survive reactivation without duplicate send", () => {
  assert.equal(privateChartRequestStatusFromSubmissions(request()), "pending");
  assert.equal(privateChartRequestStatusFromSubmissions(request({ preStatus: "submitted" })), "pre_submitted");
  assert.equal(privateChartRequestStatusFromSubmissions(request({ postStatus: "submitted" })), "post_submitted");
  assert.equal(privateChartRequestStatusFromSubmissions(request({ preStatus: "submitted", postStatus: "submitted" })), "completed");

  const sentAt = { seconds: 123 };
  const result = reactivatedPrivateChartAlimtalk({
    status: "sent",
    solapiMessageId: "message-1",
    sentAt,
    lastError: "booking_not_in_private_session_ledger",
  });
  assert.equal(result.status, "sent");
  assert.equal(result.solapiMessageId, "message-1");
  assert.equal(result.sentAt, sentAt);
  assert.equal(result.lastError, null);
});

test("ledger recompute and Function reactivation clear only automatic cancellation residue", () => {
  const root = new URL("../../", import.meta.url);
  const recompute = readFileSync(new URL("scripts/recompute-private-session-ledger.mjs", root), "utf8");
  const handler = readFileSync(new URL("firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonChart.ts", root), "utf8");
  assert.match(recompute, /requestCancelled && !autoCancelled/);
  assert.match(recompute, /if \(requestCancelled && autoCancelled\) continue;/);
  assert.match(recompute, /reactivate_chart_request_from_canonical_ledger/);
  assert.match(recompute, /notionProjectionControl\.reviewReason/);
  assert.match(recompute, /admin\.firestore\.FieldValue\.delete\(\)/);
  assert.match(handler, /cancellationSource: "system_booking_reconcile"/);
  assert.match(handler, /recordDeletePatch\.sessionStatus = FieldValue\.delete\(\)/);
  assert.match(handler, /notionProjectionControl\.reviewReason.*FieldValue\.delete\(\)/s);
});
