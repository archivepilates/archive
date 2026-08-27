import assert from "node:assert/strict";
import test from "node:test";
import {
  INSTRUCTOR_LESSON_EXPECTED_SESSIONS,
  INSTRUCTOR_LESSON_TICKET_NAME,
  buildInstructorMemberDocumentName,
  exactMemberCandidates,
  instructorLessonRegistrationId,
  isInstructorMemberGrade,
  normalizeInstructorLessonPhone,
  paymentMethodLabel,
  selectExactInstructorLessonTicket,
  selectInstructorLessonSessionCards,
  staleExternalActionStatus,
  validateCanonicalInstructorLessonBookings,
} from "../lib/instructor-lesson-registration-contract.mjs";

test("강사레슨 등록키는 스튜디오·전화번호·수강일이 같으면 동일하다", () => {
  assert.equal(
    instructorLessonRegistrationId("5330", "010-1234-5678", "2026-09-12"),
    instructorLessonRegistrationId("5330", "+82 10 1234 5678", "2026-09-12"),
  );
  assert.notEqual(
    instructorLessonRegistrationId("5330", "010-1234-5678", "2026-09-12"),
    instructorLessonRegistrationId("5330", "010-1234-5678", "2026-09-13"),
  );
});

test("회원 판정은 이름이 아니라 휴대폰번호 정확 일치를 사용한다", () => {
  const matches = exactMemberCandidates([
    { name: "다른 이름", phone: "010-1234-5678" },
    { name: "같은 이름", phone: "010-9999-5678" },
  ], { phone: "01012345678" });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].name, "다른 이름");
  assert.equal(normalizeInstructorLessonPhone("+82 10 1234 5678"), "01012345678");
});

test("StudioMate 강사회원 등급만 재수강 자동 처리 대상으로 인정한다", () => {
  assert.equal(isInstructorMemberGrade("강사회원"), true);
  assert.equal(isInstructorMemberGrade("강사 회원"), true);
  assert.equal(isInstructorMemberGrade("일반회원"), false);
});

test("강사레슨 수강권은 정확한 이름 한 건만 선택한다", () => {
  const ticket = selectExactInstructorLessonTicket([
    { title: "강사레슨 (2T)", id: "ticket-1" },
    { title: "강사레슨 (1T)", id: "ticket-2" },
  ]);
  assert.equal(ticket.id, "ticket-1");
  assert.equal(INSTRUCTOR_LESSON_TICKET_NAME, "강사레슨 (2T)");
  assert.throws(
    () => selectExactInstructorLessonTicket([{ title: "강사레슨 (2T)" }, { title: "강사레슨 (2T)" }]),
    /2건/,
  );
});

test("수강일의 예약 가능한 세션이 정확히 두 개일 때만 진행한다", () => {
  const sessions = selectInstructorLessonSessionCards([
    { date: "2026-09-12", time: "09:00", instructor: "A", title: "강사레슨 1" },
    { date: "2026-09-12", time: "11:00", instructor: "A", title: "강사레슨 2" },
    { date: "2026-09-13", time: "09:00", instructor: "A", title: "다른 날" },
  ], "2026-09-12");
  assert.equal(sessions.length, INSTRUCTOR_LESSON_EXPECTED_SESSIONS);
  assert.throws(
    () => selectInstructorLessonSessionCards([{ date: "2026-09-12", time: "09:00", full: true }], "2026-09-12"),
    /마감/,
  );
});

test("canonical bookings는 활성 예약 두 건과 중복 없는 키를 요구한다", () => {
  const base = {
    memberPhone: "01012345678",
    lectureDate: "2026-09-12",
    ticketName: "강사레슨 (2T)",
    appStatus: "reserved",
    staffName: "정은영",
    lectureTitle: "강사레슨",
    sourceUpdatedAt: "2026-09-12T12:00:00+09:00",
  };
  const result = validateCanonicalInstructorLessonBookings([
    { ...base, id: "b1", lectureStartAt: "2026-09-12T09:00:00+09:00" },
    { ...base, id: "b2", lectureStartAt: "2026-09-12T11:00:00+09:00" },
    { ...base, id: "b3", appStatus: "cancelled", lectureStartAt: "2026-09-12T13:00:00+09:00" },
  ], { phone: "010-1234-5678", lessonDate: "2026-09-12" });
  assert.equal(result.ok, true);
  assert.equal(result.count, 2);

  const duplicated = validateCanonicalInstructorLessonBookings([
    { ...base, id: "b1", lectureStartAt: "2026-09-12T09:00:00+09:00" },
    { ...base, id: "b2", lectureStartAt: "2026-09-12T09:00:00+09:00" },
  ], { phone: "01012345678", lessonDate: "2026-09-12" });
  assert.equal(duplicated.ok, false);
  assert.equal(duplicated.duplicate, true);

  const unsafeStatuses = validateCanonicalInstructorLessonBookings([
    { ...base, id: "b1", appStatus: "wait", lectureStartAt: "2026-09-12T09:00:00+09:00" },
    { ...base, id: "b2", appStatus: "superseded", lectureStartAt: "2026-09-12T11:00:00+09:00" },
  ], { phone: "01012345678", lessonDate: "2026-09-12" });
  assert.equal(unsafeStatuses.ok, false);
  assert.equal(unsafeStatuses.count, 0);

  const wrongTicket = validateCanonicalInstructorLessonBookings([
    { ...base, id: "b1", ticketName: "강사레슨 체험", lectureStartAt: "2026-09-12T09:00:00+09:00" },
    { ...base, id: "b2", ticketName: "강사레슨 체험", lectureStartAt: "2026-09-12T11:00:00+09:00" },
  ], { phone: "01012345678", lessonDate: "2026-09-12" });
  assert.equal(wrongTicket.count, 0);

  const expectedSessions = [
    { date: "2026-09-12", time: "09:00", instructor: "정은영", title: "강사레슨" },
    { date: "2026-09-12", time: "11:00", instructor: "정은영", title: "강사레슨" },
  ];
  const expected = validateCanonicalInstructorLessonBookings([
    { ...base, id: "b1", lectureStartAt: "2026-09-12T09:00:00+09:00" },
    { ...base, id: "b2", lectureStartAt: "2026-09-12T11:00:00+09:00" },
  ], {
    phone: "01012345678",
    lessonDate: "2026-09-12",
    expectedSessions,
    notBeforeMs: Date.parse("2026-09-12T08:00:00+09:00"),
  });
  assert.equal(expected.ok, true);
  const staleSource = validateCanonicalInstructorLessonBookings([
    { ...base, id: "b1", lectureStartAt: "2026-09-12T09:00:00+09:00", sourceUpdatedAt: "2026-09-12T07:00:00+09:00" },
    { ...base, id: "b2", lectureStartAt: "2026-09-12T11:00:00+09:00", sourceUpdatedAt: "2026-09-12T07:00:00+09:00" },
  ], {
    phone: "01012345678",
    lessonDate: "2026-09-12",
    expectedSessions,
    notBeforeMs: Date.parse("2026-09-12T08:00:00+09:00"),
  });
  assert.equal(staleSource.count, 0);
  const wrongSession = validateCanonicalInstructorLessonBookings([
    { ...base, id: "b1", lectureStartAt: "2026-09-12T09:00:00+09:00" },
    { ...base, id: "b2", lectureStartAt: "2026-09-12T10:00:00+09:00" },
  ], { phone: "01012345678", lessonDate: "2026-09-12", expectedSessions });
  assert.equal(wrongSession.ok, false);
  assert.equal(wrongSession.expectedMatch, false);
});

test("외부 최종 실행 뒤 중단된 작업은 자동 재시도하지 않는다", () => {
  assert.equal(staleExternalActionStatus({ status: "processing", attempts: 1 }), "retry");
  assert.equal(staleExternalActionStatus({ status: "sending", attempts: 1 }), "review_required");
  assert.equal(staleExternalActionStatus({ externalEffectStarted: true, attempts: 1 }), "review_required");
  assert.equal(staleExternalActionStatus({ status: "processing", attempts: 3, maxAttempts: 3 }), "failed");
});

test("결제수단과 가입서 문서명은 운영값으로 정규화한다", () => {
  assert.equal(paymentMethodLabel("card"), "카드");
  assert.equal(paymentMethodLabel("wiretransfer"), "계좌이체");
  assert.match(
    buildInstructorMemberDocumentName(
      { registrationId: "ilr_12345678", memberName: "테스트 강사" },
      new Date("2026-09-12T00:00:00+09:00"),
    ),
    /^2026-09-12_강사회원가입서_테스트 강사_12345678$/,
  );
});
