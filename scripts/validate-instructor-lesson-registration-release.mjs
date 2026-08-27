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
    "신규 강사회원만 발송",
  ], ["강사 기록", "강사 테스트", "data-auth-only-dashboard"]],
  ["core/staff/index.html", ["강사 테스트", "https://in.archivepilates.com/instructor-evaluation/"], []],
  ["core/assets/app.js", [
    "operatorCreateInstructorLessonRegistration",
    "getInstructorLessonRegistrationDashboard",
    "renderInstructorLessonRegistrationDashboard",
    "handleInstructorLessonRegistrationSubmit",
    "instructorLessonRegistrationFilter",
  ], []],
  ["firebase/kangsain-functions/functions/src/instructorLessonRegistration/instructorLessonRegistration.ts", [
    "instructorLessonRegistrationId",
    "paymentConfirmed",
    "seatConfirmed",
    "studiomateInstructorLessonJobs",
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
    "selectInstructorLessonSessionCards",
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
    "memo_pending",
  ], []],
  ["scripts/process-studiomate-memo-write-jobs.mjs", [
    "updateInstructorLessonRegistrationMemoStatus",
    "completed ? \"verified\"",
    "alreadyCompleted",
  ], []],
  ["scripts/run-system-health-check.mjs", [
    "studiomateInstructorLessonJobs",
    "eformsignInstructorMemberJobs",
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
    "해당일 두 세션 예약",
    "최종 발송 결과가 모호하면 자동 재발송하지 않고 확인필요",
    "StudioMate 메모 반영까지 확인되어야 전체 등록을 완료",
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
