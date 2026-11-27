import test from "node:test";
import assert from "node:assert/strict";
import { planInstructorPairedBooking as plan, verifyInstructorPairedBooking as verify } from "../lib/instructor-lesson-paired-booking.mjs";
import { matchesPairedBookingPost, matchesApprovedDailyLimitConfirmation } from "../lib/instructor-lesson-paired-booking-browser.mjs";

const date = "2099-11-28";
const sessions = (group, one, two, booked = [3, 3]) => [one, two].map((id, slot) => ({
  id, type: "G", title: "11월 강사레슨 " + group, staff: { name: "Synthetic " + slot },
  start_on: date + (slot ? " 14:10:00" : " 13:00:00"), end_on: date + (slot ? " 15:00:00" : " 13:50:00"),
  max_trainee: 5, current_trainee_count: booked[slot],
}));
const A = sessions("A", 11, 12, [4, 3]), B = sessions("B", 21, 22);
const input = patch => ({ lessonDate: date, memberId: "900", userTicketId: "901", lectures: [...A, ...B],
  ticketBookings: [], memberLectures: [], usableCoupons: 2, now: Date.parse(date + "T11:00:00+09:00"), ...patch });
const booked = (key, lectureId, status = "reserved") => ({ date, key: String(key), lectureId: String(lectureId), status });

test("chooses a full same-group two-session pair, preferring the stronger bottleneck and stable tie", () => {
  assert.deepEqual(plan(input()).missing.map(l => l.lectureId), ["21", "22"]);
  const tie = plan(input({ lectures: [...B, ...sessions("A", 11, 12)] }));
  assert.deepEqual(tie.missing.map(l => l.lectureId), ["11", "12"]);
});

test("does not mix groups or reserve when a pair is full, inconsistent, past, team-only or short of coupons", () => {
  for (const patch of [
    { lectures: [...sessions("A", 11, 12, [4, 5]), ...sessions("B", 21, 22, [5, 4])] },
    { lectures: [A[0], B[1]] },
    { lectures: A.map(row => ({ ...row, title: "Team 강사레슨" })) },
    { usableCoupons: 1 }, { now: Date.parse(date + "T13:00:00+09:00") },
    { memberLectures: A }, { ticketBookings: [booked(201, 11, "waiting")] },
  ]) assert.throws(() => plan(input(patch)));
});

test("preserves an exact prior booking and verifies both original surfaces without guessing", () => {
  const existing = booked(201, 11);
  const p = plan(input({ memberLectures: [A[0]], ticketBookings: [existing], usableCoupons: 1 }));
  assert.deepEqual(p.missing.map(l => l.lectureId), ["12"]);
  assert.deepEqual(verify(p, [booked(202, 12), existing], A).bookingIds, ["201", "202"]);
  for (const [bookings, readback] of [
    [[existing], [A[0]]], [[existing, booked(202, 22)], [A[0], B[1]]],
    [[existing, booked(202, 12)], [A[0]]], [[booked(202, 11), booked(203, 12)], A],
    [[existing, booked(202, 12, "waiting")], A],
  ]) assert.throws(() => verify(p, bookings, readback));
});

test("intercepts only the observed native batch shape, exact pass and exact missing sessions", () => {
  const p = plan(input());
  assert.ok(matchesPairedBookingPost({ lecture_ids: [22, 21], user_ticket_ids: [901] }, p));
  for (const body of [{ lecture_ids: [21, 22], user_ticket_ids: [902] },
    { lecture_ids: [12, 21], user_ticket_ids: [901] }, { lecture_ids: [21, 21], user_ticket_ids: [901] },
    { lecture_ids: [21, 22], user_ticket_ids: [901], force: true }]) assert.ok(!matchesPairedBookingPost(body, p));
});

test("only explicitly approved daily-limit warning for this pair is actionable", () => {
  const p = plan(input());
  const observed = "예약 가능 횟수 초과\n\n일일 예약 가능 횟수를 초과했습니다.\n계속 하시겠습니까?\n\n취소확인";
  const approved = { bookingDailyLimitAcknowledged: true };
  assert.ok(matchesApprovedDailyLimitConfirmation(observed, approved, p, []));
  assert.ok(!matchesApprovedDailyLimitConfirmation(observed, {}, p, []));
  assert.ok(!matchesApprovedDailyLimitConfirmation(observed, approved, p, [A[0]]));
  assert.ok(!matchesApprovedDailyLimitConfirmation(observed.replace("일일", "월간"), approved, p, []));
});
