import assert from "node:assert/strict";
import test from "node:test";
import { instructorLessonMaterialCandidatesForDate } from "../../firebase/kangsain-functions/functions/src/alimtalk/rebuildAlimtalkCandidates";
import { instructorLessonCandidateSourceIssue } from "../../firebase/kangsain-functions/functions/src/alimtalk/instructorLessonSampleApproval";
import { genericInstructorLessonQueueBlock } from "../../firebase/kangsain-functions/functions/src/alimtalk/instructorLessonDeliveryGuard";
import type { BookingDoc, LectureDoc, MemberProfileDoc } from "../../firebase/kangsain-functions/functions/src/types/models";

const profile = { memberId: "synthetic-member", name: "합성 검증", studioId: "5330", phone: "01000000000" } as MemberProfileDoc;
function fixtures() {
  const bookings = [0, 1].map(i => ({
    bookingId: `synthetic-booking-${i}`, lectureId: `synthetic-lecture-${i}`,
    studioId: profile.studioId, memberId: profile.memberId, memberPhone: profile.phone,
    appStatus: "reserved", ticketName: "Team 강사레슨", lectureDate: "2026-11-21",
    lectureStartAt: { toDate: () => new Date(`2026-11-21T${i ? "14:30" : "13:30"}:00+09:00`) },
  } as BookingDoc));
  const lectures = new Map(bookings.map(b => [b.lectureId, {
    lectureId: b.lectureId, studioId: b.studioId, date: b.lectureDate,
    status: "open", title: "강사레슨 (Team)",
  } as LectureDoc]));
  return { bookings, lectures };
}

test("Team consecutive sessions produce one approval-only candidate per participant and date", () => {
  const { bookings, lectures } = fixtures();
  const candidates = instructorLessonMaterialCandidatesForDate(profile, "2026-11-20", new Map([[profile.memberId, bookings]]), lectures);
  assert.equal(candidates.length, 1);
  const [candidate] = candidates;
  assert.equal(candidate.payload?.managementNumber, "team-261121");
  assert.equal(candidate.payload?.lessonDate, "2026-11-21");
  assert.equal(candidate.sourceDate, "2026-11-20");
  assert.equal(candidate.payload?.parkingBookingIds, bookings.map(b => b.bookingId).join(","));
  assert.equal(instructorLessonCandidateSourceIssue(candidate, bookings[0], lectures.get(bookings[0].lectureId)), "");
  assert.equal(genericInstructorLessonQueueBlock(candidate)?.reasonCode, "instructor_lesson_sample_approval_required");
  assert.equal(instructorLessonMaterialCandidatesForDate(profile, "2026-11-20", new Map([[profile.memberId, bookings]]), lectures)[0].candidateId, candidate.candidateId);
});

test("Team source changes cannot reuse the existing candidate approval", () => {
  const { bookings, lectures } = fixtures();
  const [candidate] = instructorLessonMaterialCandidatesForDate(profile, "2026-11-20", new Map([[profile.memberId, bookings]]), lectures);
  for (const patch of [{ ticketName: "강사레슨 (2T)" }, { appStatus: "cancel" }, { memberId: "other" }]) {
    assert.notEqual(instructorLessonCandidateSourceIssue(candidate, { ...bookings[0], ...patch } as BookingDoc, lectures.get(bookings[0].lectureId)), "");
  }
});

test("Team label alone, cancelled bookings and wrong-day bookings do not create candidates", () => {
  const { bookings, lectures } = fixtures();
  for (const patch of [{ ticketName: "일반 그룹" }, { appStatus: "cancel" }, { lectureDate: "2026-11-22" }]) {
    const rows = bookings.map(b => ({ ...b, ...patch } as BookingDoc));
    assert.deepEqual(instructorLessonMaterialCandidatesForDate(profile, "2026-11-20", new Map([[profile.memberId, rows]]), lectures), []);
  }
});
