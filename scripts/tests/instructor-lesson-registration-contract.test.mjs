import assert from "node:assert/strict";
import test from "node:test";
import {
  INSTRUCTOR_LESSON_TICKET_NAME,
  INSTRUCTOR_LESSON_TICKET_PRICE,
  INSTRUCTOR_MEMBER_EFORMSIGN_OPERATOR_FIELD_IDS,
  buildInstructorMemberDocumentName,
  deriveInstructorLessonRegistrationState,
  exactMemberCandidates,
  instructorLessonRegistrationId,
  isInstructorMemberGrade,
  isInstructorLessonNewMemberTestRecipient,
  normalizeInstructorLessonPhone,
  paymentMethodLabel,
  selectExactInstructorLessonTicket,
  staleExternalActionStatus,
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

test("신규회원 시뮬레이션은 김기효 테스트 계정에만 허용한다", () => {
  assert.equal(isInstructorLessonNewMemberTestRecipient({ memberName: "김기효", memberPhone: "010-8648-8585" }), true);
  assert.equal(isInstructorLessonNewMemberTestRecipient({ memberName: "김기효", memberPhone: "010-1111-2222" }), false);
  assert.equal(isInstructorLessonNewMemberTestRecipient({ memberName: "다른 회원", memberPhone: "010-8648-8585" }), false);
});

test("강사레슨 수강권은 정확한 이름 한 건만 선택한다", () => {
  const ticket = selectExactInstructorLessonTicket([
    { title: "강사레슨 (2T)", id: "ticket-1" },
    { title: "강사레슨 (1T)", id: "ticket-2" },
  ]);
  assert.equal(ticket.id, "ticket-1");
  assert.equal(INSTRUCTOR_LESSON_TICKET_NAME, "강사레슨 (2T)");
  assert.equal(INSTRUCTOR_LESSON_TICKET_PRICE, 70_000);
  assert.deepEqual(INSTRUCTOR_MEMBER_EFORMSIGN_OPERATOR_FIELD_IDS, {
    ticketName: "ozinput_33",
    paymentAmount: "ozinput_34",
  });
  assert.throws(
    () => selectExactInstructorLessonTicket([{ title: "강사레슨 (2T)" }, { title: "강사레슨 (2T)" }]),
    /2건/,
  );
});

test("수강권과 신규 가입서 메모가 끝나면 등록을 완료한다", () => {
  const baseSteps = {
    member: { status: "verified" },
    ticket: { status: "verified" },
    eformsign: { status: "verified" },
    memo: { status: "verified" },
  };
  assert.equal(
    deriveInstructorLessonRegistrationState({
      mode: "new_member",
      steps: baseSteps,
    }).status,
    "completed",
  );
  assert.equal(
    deriveInstructorLessonRegistrationState({
      mode: "returning_member",
      steps: {
        member: { status: "verified" },
        ticket: { status: "verified" },
        bookings: { status: "review_required" },
        eformsign: { status: "not_required" },
        memo: { status: "not_required" },
      },
    }).status,
    "completed",
  );
  assert.equal(
    deriveInstructorLessonRegistrationState({
      mode: "new_member",
      steps: {
        ...baseSteps,
        eformsign: { status: "review_required" },
      },
    }).status,
    "action_required",
  );
  assert.equal(
    deriveInstructorLessonRegistrationState({
      mode: "unresolved",
      steps: baseSteps,
    }).status,
    "processing",
  );
  assert.equal(
    deriveInstructorLessonRegistrationState({
      mode: "returning_member",
      steps: {
        member: { status: "pending" },
        ticket: { status: "verified" },
      },
    }).status,
    "processing",
  );
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
