import assert from "node:assert/strict";
import test from "node:test";
import { buildInstructorLessonScheduleSummaries as summarize } from "../../firebase/kangsain-functions/functions/src/instructorLessonRegistration/instructorLessonSchedule";
const date = "2026-10-24";
const registration = { id: "r1", lessonDate: date, memberName: "Synthetic", memberPhone: "01000000000", status: "cancelled",
  cancellation: { memberId: "101", status: "completed", nativeVerified: true } };
const holder = { id: "101", memberId: "101", name: "Synthetic", phone: "01000000000", activeTicketNames: ["강사레슨 (2T)"],
  activeTickets: [{ name: "강사레슨 (2T)", availableFrom: date }] };
const booking = { id: "b1", memberId: "101", memberName: "Synthetic", lectureDate: date, startTime: "13:00",
  ticketName: "강사레슨 (2T)", appStatus: "reserved" };
test("verified cancellation excludes stale ticket and booking counts by native member even without phone", () => {
  const result = summarize({ startDate: date, endDate: date, registrations: [registration], ticketHolders: [holder], bookings: [booking] });
  assert.equal(result.reduce((n, item) => n + item.occupiedCount, 0), 0);
});
test("pending/review or unverified cancellations never free seats", () => {
  for (const status of ["pending", "processing", "review_required"]) {
    const [s] = summarize({ startDate: date, endDate: date,
      registrations: [{ ...registration, status: "cancellation_pending", cancellation: { ...registration.cancellation, status, nativeVerified: false } }],
      ticketHolders: [holder], bookings: [booking] });
    assert.equal(s.occupiedCount, 1);
  }
});
test("same-phone different native member and other lesson dates remain occupied", () => {
  const result = summarize({ startDate: date, endDate: "2026-10-25", registrations: [registration],
    ticketHolders: [{ ...holder, id: "102", memberId: "102" }, { ...holder, activeTickets: [{ name: "강사레슨 (2T)", availableFrom: "2026-10-25" }] }] });
  assert.equal(result.length, 2); assert.deepEqual(result.map(item => item.occupiedCount), [1, 1]);
});
