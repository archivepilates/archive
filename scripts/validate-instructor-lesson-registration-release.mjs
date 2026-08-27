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
    "신규 강사회원은 예약 전에도 발송",
    "수업 생성 전에도 접수",
    "반배정 뒤 예약이 자동 재개",
  ], ["강사 기록", "강사 테스트", "data-auth-only-dashboard"]],
  ["core/staff/index.html", ["강사 테스트", "https://in.archivepilates.com/instructor-evaluation/"], []],
  ["core/assets/app.js", [
    "operatorCreateInstructorLessonRegistration",
    "getInstructorLessonRegistrationDashboard",
    "renderInstructorLessonRegistrationDashboard",
    "handleInstructorLessonRegistrationSubmit",
    "instructorLessonRegistrationFilter",
    "waiting_class_assignment: \"반배정 대기\"",
    "[\"member\", \"ticket\", \"eformsign\", \"bookings\", \"memo\"]",
  ], []],
  ["firebase/kangsain-functions/functions/src/instructorLessonRegistration/instructorLessonRegistration.ts", [
    "instructorLessonRegistrationId",
    "paymentConfirmed",
    "seatConfirmed",
    "studiomateInstructorLessonJobs",
    "DASHBOARD_STATUSES",
    ".count().get()",
    "requireManager",
  ], []],
  ["firebase/kangsain-functions/firestore.rules", [
    "match /instructorLessonRegistrations/{registrationId}",
    "match /studiomateInstructorLessonJobs/{jobId}",
    "match /eformsignInstructorMemberJobs/{jobId}",
    "allow write: if false",
  ], []],
  ["firebase/kangsain-functions/firestore.indexes.json", [
    "instructorLessonRegistrations",
    "updatedAt",
  ], []],
  ["scripts/process-instructor-lesson-registration-jobs.mjs", [
    "exactMemberCandidates",
    "isInstructorMemberGrade",
    "selectExactInstructorLessonTicket",
    "inspectInstructorLessonSessionCards",
    "waiting_class_assignment",
    "bookings_wait_assignment",
    'status: "waiting_assignment"',
    '["pending", "retry", "waiting_assignment"]',
    "validateCanonicalInstructorLessonBookings",
    "acquireStudioMateBrowserLock",
    "eformsignInstructorMemberJobs",
  ], []],
  ["scripts/process-eformsign-instructor-member-jobs.mjs", [
    "acquireEformsignBrowserLock",
    "send_review_required",
    "instructorMemberConsents",
    "memberMemos",
    "studiomateMemoWriteJobs",
    "deriveInstructorLessonRegistrationState",
    "lastCheckedAt || a.data.sentAt",
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
    "waiting_assignment",
    "send_review_required",
  ], []],
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
    "운영자가 수업을 생성하면",
    "반배정 대기로 유지",
    "최종 발송 결과가 모호하면 자동 재발송하지 않고 확인필요",
    "두 세션 예약 검증과 StudioMate 메모 반영이 모두 끝나야",
  ], []],
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
