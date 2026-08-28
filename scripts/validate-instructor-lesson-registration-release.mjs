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
    "수강권 발급 뒤 반배정·예약은 직접 처리",
    "수업 생성 시 StudioMate에서 직접 처리",
  ], ["강사 기록", "강사 테스트", "data-auth-only-dashboard", "두 세션 자동 예약"]],
  ["core/staff/index.html", ["강사 테스트", "https://in.archivepilates.com/instructor-evaluation/"], []],
  ["core/assets/app.js", [
    "operatorCreateInstructorLessonRegistration",
    "getInstructorLessonRegistrationDashboard",
    "renderInstructorLessonRegistrationDashboard",
    "renderInstructorLessonSchedule",
    "instructorLessonScheduleSourceLabel",
    "handleInstructorLessonRegistrationSubmit",
    "instructorLessonRegistrationFilter",
    "[\"member\", \"ticket\", \"eformsign\", \"memo\"]",
  ], ["waiting_class_assignment", "waiting_assignment"]],
  ["firebase/kangsain-functions/functions/src/instructorLessonRegistration/instructorLessonRegistration.ts", [
    "instructorLessonRegistrationId",
    "paymentConfirmed",
    "seatConfirmed",
    "studiomateInstructorLessonJobs",
    "DASHBOARD_STATUSES",
    ".count().get()",
    "requireManager",
    "수업 생성 시 운영자가 StudioMate에서 직접 처리",
    "loadInstructorLessonSchedule",
    "buildInstructorLessonScheduleSummaries",
    "INSTRUCTOR_LESSON_DEFAULT_CAPACITY",
  ], ["waiting_class_assignment", "waiting_assignment", "expectedSessionCount"]],
  ["firebase/kangsain-functions/functions/src/instructorLessonRegistration/instructorLessonSchedule.ts", [
    "INSTRUCTOR_LESSON_DEFAULT_CAPACITY = 10",
    "buildInstructorLessonScheduleSummaries",
    "bookingMemberCount",
    "ticketHolderCount",
    "registrationCount",
    "capacitySource",
    "archiveBooking?.isCanonical === false",
  ], ["db.collection(", "batch.set(", "transaction.set("]],
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
    "실제 활성 예약의 고유 인원을 우선",
    "기본 정원은 10명",
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
