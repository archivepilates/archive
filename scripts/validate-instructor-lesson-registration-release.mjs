#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";

const checks = [
  ["core/instructor-lessons/index.html", [
    "instructorLessonRegistrationForm",
    "instructorLessonMemberName",
    "instructorLessonMemberPhone",
    "instructorLessonDate",
    "instructorLessonPaymentMethod",
    "instructorLessonPaymentConfirmed",
    "instructorLessonSeatConfirmed",
    "instructorLessonRegistrationList",
    "instructorLessonScheduleList",
    "일정별 예약현황",
    "남은 좌석",
    "신규 강사회원에게 자동 발송",
    "수업 생성 전에도 접수",
    "수강권 발급 뒤 안내는 자동 발송되고 반배정·예약은 직접 처리",
    "수업 생성 시 StudioMate에서 직접 처리",
    "예약확정 안내",
    "수강권 발급 확인 후 자동 1회 발송",
  ], ["강사 기록", "강사 테스트", "data-auth-only-dashboard", "두 세션 자동 예약", "두 세션 예약 확인 후 CORE에서 1회 발송"]],
  ["core/staff/index.html", ["강사 테스트", "https://in.archivepilates.com/instructor-evaluation/"], []],
  ["core/assets/app.js", [
    "operatorCreateInstructorLessonRegistration",
    "getInstructorLessonRegistrationDashboard",
    "renderInstructorLessonRegistrationDashboard",
    "renderInstructorLessonSchedule",
    "instructorLessonScheduleSourceLabel",
    "handleInstructorLessonRegistrationSubmit",
    "instructorLessonRegistrationFilter",
    "[\"member\", \"ticket\", \"confirmation\", \"eformsign\", \"memo\", \"bookings\"]",
    "confirmInstructorLessonBookingAndQueueAlimtalk",
    "안내 재처리",
    "수강권 발급 증거와 캘린더",
  ], ["waiting_class_assignment", "waiting_assignment", "StudioMate 활성 예약 두 세션과 캘린더"]],
  ["firebase/kangsain-functions/functions/src/instructorLessonRegistration/instructorLessonRegistration.ts", [
    "instructorLessonRegistrationId",
    "paymentConfirmed",
    "seatConfirmed",
    "studiomateInstructorLessonJobs",
    "DASHBOARD_STATUSES",
    "MAX_DASHBOARD_QUERY_ITEMS",
    "buildInstructorLessonRegistrationCounts",
    "isInstructorLessonSyntheticTest",
    "requireManager",
    "수강권 발급 후 운영자가 StudioMate에서 직접 처리",
    "loadInstructorLessonSchedule",
    "buildInstructorLessonScheduleSummaries",
    "INSTRUCTOR_LESSON_DEFAULT_CAPACITY",
    "수강권 발급 검증 후 승인 템플릿으로 자동 1회 발송",
  ], ["waiting_class_assignment", "waiting_assignment", "expectedSessionCount", ".count().get()"]],
  ["firebase/kangsain-functions/functions/src/instructorLessonRegistration/instructorLessonConfirmation.ts", [
    "confirmInstructorLessonBookingAndQueueAlimtalkHandler",
    "queueInstructorLessonConfirmationOnTicketVerifiedHandler",
    "queueInstructorLessonConfirmationForIssuedTicket",
    "instructorLessonTicketConfirmationIssue",
    "instructorLessonConfirmationSendabilityIssue",
    "syncInstructorLessonConfirmationOutcome",
    "${TICKET_NAME} 수강권 발급 검증 완료",
    "external-feedback-260919",
    "external-feedback-260920",
    "assertCalendarReady",
  ], ["loadConfirmedBookings", "assertConfirmedBookingSet", "bookingIds"]],
  ["firebase/kangsain-functions/functions/src/alimtalk/templates.ts", [
    "KA01TP2608241233353269Jgtoiwnzi6",
    "강사레슨_예약확정 안내 v1",
    "강사레슨 예약확정 수업별 1회",
  ], []],
  ["firebase/kangsain-functions/functions/src/alimtalk/processAlimtalkQueue.ts", [
    "instructorLessonConfirmationSendabilityIssue",
    "instructor_lesson_confirmation_source_blocked",
    '"#{수업일}"',
    '"#{수업시간}"',
    '"#{수업구성}"',
  ], []],
  ["firebase/kangsain-functions/functions/src/instructorLessonRegistration/instructorLessonSchedule.ts", [
    "INSTRUCTOR_LESSON_DEFAULT_CAPACITY = 10",
    "buildInstructorLessonScheduleSummaries",
    "bookingMemberCount",
    "ticketHolderCount",
    "registrationCount",
    "capacitySource",
    "archiveBooking?.isCanonical === false",
    "currentInstructorLessonTicketDates",
    "const countSource = ticketHolderCount",
    "newMemberSimulation",
  ], ["db.collection(", "batch.set(", "transaction.set(", "excludedTicketOnlyMember(holder)"]],
  ["firebase/kangsain-functions/firestore.rules", [
    "match /instructorLessonRegistrations/{registrationId}",
    "match /studiomateInstructorLessonJobs/{jobId}",
    "match /eformsignInstructorMemberJobs/{jobId}",
    "allow write: if false",
  ], []],
  ["firebase/kangsain-functions/firestore.indexes.json", [
    "instructorLessonRegistrations",
    "updatedAt",
    '"fieldPath": "ticketName"',
    '"fieldPath": "lectureDate"',
  ], []],
  ["scripts/process-instructor-lesson-registration-jobs.mjs", [
    "exactMemberCandidates",
    "isInstructorMemberGrade",
    "--simulate-new-member-test",
    "isInstructorLessonNewMemberTestRecipient",
    ".userticket-card, .ticket-card",
    "INSTRUCTOR_LESSON_TICKET_PRICE",
    "response && !response.ok()",
    "selectExactInstructorLessonTicket",
    "completeStudioMateRegistration",
    "반배정·예약은 운영자 수동 처리",
    "수강권 발급 확인 후 알림톡 자동 등록",
    "acquireStudioMateBrowserLock",
    "eformsignInstructorMemberJobs",
  ], [
    "reserveInstructorLessonSessions",
    "verifyCanonicalBookings",
    "waiting_assignment",
    "waiting_class_assignment",
    "bulk_bookings",
    "v2/staff/booking",
    "validateCanonicalInstructorLessonBookings",
  ]],
  ["scripts/process-eformsign-instructor-member-jobs.mjs", [
    "acquireEformsignBrowserLock",
    "send_review_required",
    "instructorMemberConsents",
    "memberMemos",
    "studiomateMemoWriteJobs",
    "deriveInstructorLessonRegistrationState",
    "lastCheckedAt || a.data.sentAt",
    "INSTRUCTOR_MEMBER_EFORMSIGN_OPERATOR_FIELD_IDS",
    "Required fields",
    "Send document",
    "__archiveCheckRequiredOriginal",
  ], []],
  ["scripts/process-studiomate-memo-write-jobs.mjs", [
    "updateInstructorLessonRegistrationMemoStatus",
    "deriveInstructorLessonRegistrationState",
    "alreadyCompleted",
    "claimMemoJob",
    "studioMateMemoExists",
  ], []],
  ["scripts/run-system-health-check.mjs", [
    "studiomateInstructorLessonJobs",
    "eformsignInstructorMemberJobs",
    "send_review_required",
  ], ["waiting_assignment"]],
  ["firebase/kangsain-functions/macmini-studiomate/com.archive.instructor-lesson-registration-queue.plist", [
    "process-instructor-lesson-registration-jobs.mjs",
    "--apply",
  ], []],
  ["firebase/kangsain-functions/macmini-studiomate/com.archive.eformsign-instructor-member-queue.plist", [
    "process-eformsign-instructor-member-jobs.mjs",
    "--apply",
  ], []],
  ["core/rules/index.html", [
    "강사레슨 등록키",
    "휴대폰번호 정확 일치",
    "예약 API를 호출하지 않습니다",
    "운영자가 StudioMate에서 직접 처리",
    "최종 발송 결과가 모호하면 자동 재발송하지 않고 확인필요",
    "수동 예약 여부는 완료 조건에 포함하지 않습니다",
    "수강권 발급 고유 인원을 우선",
    "스텝·운영자도 실제 수강권이 발급되면 좌석에 포함",
    "기본 정원은 10명",
    "현재 활성 강사레슨 (2T) 수강권의 시작일",
    "합성 테스트는 접수·완료·좌석 카운트에서 제외",
  ], ["예약을 자동 재개", "반배정 대기로 유지"]],
];

const failures = [];
for (const [file, required, forbidden] of checks) {
  if (!existsSync(file)) {
    failures.push(`missing ${file}`);
    continue;
  }
  const source = readFileSync(file, "utf8");
  for (const marker of required) if (!source.includes(marker)) failures.push(`${file} missing ${marker}`);
  for (const marker of forbidden) if (source.includes(marker)) failures.push(`${file} contains forbidden ${marker}`);
}

if (failures.length) {
  console.error(`validate-instructor-lesson-registration-release failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log("validate-instructor-lesson-registration-release passed");
