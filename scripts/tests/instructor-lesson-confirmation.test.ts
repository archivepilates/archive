import assert from "node:assert/strict";
import test from "node:test";
import {
  instructorLessonConfirmationCandidateId,
  instructorLessonConfirmationScheduleFor,
  instructorLessonTicketConfirmationIssue,
} from "../../firebase/kangsain-functions/functions/src/instructorLessonRegistration/instructorLessonConfirmation";
import { deriveInstructorLessonRegistrationState } from "../../firebase/kangsain-functions/functions/src/instructorLessonRegistration/instructorLessonRegistrationState";

test("승인된 강사레슨 일정은 캘린더 관리번호와 두 세션 문구를 고정한다", () => {
  const schedule = instructorLessonConfirmationScheduleFor("2026-09-19");
  assert.ok(schedule);
  assert.equal(schedule.managementNumber, "external-feedback-260919");
  assert.equal(schedule.lessonTimeText, "13:00~15:10");
  assert.equal(
    schedule.lessonComposition,
    "민진T 리포머 + 폼롤러\n은영T 바렐 + 토닝볼",
  );
  assert.equal(
    schedule.calendarUrl,
    "https://in.archivepilates.com/method/external-feedback-260919/calendar/",
  );
  assert.equal(instructorLessonConfirmationScheduleFor("2026-09-21"), null);
});

test("예약확정 후보는 전화번호 표기 차이를 정규화하고 수업일별로 분리한다", () => {
  const first = instructorLessonConfirmationCandidateId({
    phone: "010-8648-8585",
    lessonDate: "2026-09-19",
    managementNumber: "external-feedback-260919",
  });
  assert.equal(
    first,
    instructorLessonConfirmationCandidateId({
      phone: "+82 10 8648 8585",
      lessonDate: "2026-09-19",
      managementNumber: "external-feedback-260919",
    }),
  );
  assert.notEqual(
    first,
    instructorLessonConfirmationCandidateId({
      phone: "01086488585",
      lessonDate: "2026-09-20",
      managementNumber: "external-feedback-260920",
    }),
  );
});

test("예약 없이도 운영자 확인과 강사레슨 수강권 발급이 검증되면 안내 원천이 된다", () => {
  const registration = issuedTicketRegistration();
  assert.equal(instructorLessonTicketConfirmationIssue(registration), "");
  assert.equal(
    instructorLessonTicketConfirmationIssue({
      ...registration,
      steps: { ...registration.steps, ticket: { status: "pending" } },
    }),
    "강사레슨 (2T) 수강권 발급 확인 안 됨",
  );
  assert.equal(
    instructorLessonTicketConfirmationIssue({
      ...registration,
      operatorChecks: { paymentConfirmed: true, seatConfirmed: false },
    }),
    "입금·수강 접수 운영자 확인 없음",
  );
});

test("예약 상태와 무관하게 알림톡 결과가 확인되면 등록 완료가 된다", () => {
  const ready = {
    member: { status: "verified" },
    ticket: { status: "verified" },
    eformsign: { status: "not_required" },
    memo: { status: "not_required" },
    bookings: { status: "pending" },
  };
  assert.equal(
    deriveInstructorLessonRegistrationState({
      mode: "returning_member",
      steps: { ...ready, confirmation: { status: "queued" } },
    }).status,
    "confirmation_pending",
  );
  assert.equal(
    deriveInstructorLessonRegistrationState({
      mode: "returning_member",
      steps: { ...ready, confirmation: { status: "verified" } },
    }).status,
    "completed",
  );
});

function issuedTicketRegistration(): Record<string, any> {
  return {
    studioId: "5330",
    status: "processing",
    memberName: "테스트",
    memberPhone: "01012345678",
    ticketName: "강사레슨 (2T)",
    operatorChecks: { paymentConfirmed: true, seatConfirmed: true },
    steps: {
      member: { status: "verified" },
      ticket: { status: "verified" },
    },
    evidence: { studiomateMemberId: "member-1", ticketId: "ticket-1" },
  };
}
