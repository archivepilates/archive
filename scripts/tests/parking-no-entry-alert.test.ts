import assert from "node:assert/strict";
import test from "node:test";
import { PARKING_APPLY_AFTER_START_MINUTES } from "../../firebase/kangsain-functions/functions/src/parking/parkingDiscountPolicy";
import { buildParkingNoEntryAlertEmail } from "../../firebase/kangsain-functions/functions/src/parking/parkingOperatorAlerts";

test("checks parking entry once at 30 minutes after lesson start", () => {
  assert.equal(PARKING_APPLY_AFTER_START_MINUTES, 30);
});

test("builds a privacy-minimal no-entry attention email", () => {
  const email = buildParkingNoEntryAlertEmail({
    jobId: "parking_job_1",
    lessonDate: "2026-09-19",
    lectureStartAt: new Date("2026-09-19T04:00:00.000Z"),
    memberName: "테스트 강사",
    carNumberLast4: "1234",
    requestedDiscountHours: 4,
  });

  assert.equal(
    email.subject,
    "[주차등록][확인필요] 입차기록 없음 · 2026-09-19",
  );
  assert.match(email.body, /수업 시작 30분 후/);
  assert.match(email.body, /2026-09-19 13:00/);
  assert.match(email.body, /\*\*\*\*1234/);
  assert.match(email.body, /iParking 입차 조회: 1회/);
  assert.match(email.body, /자동 재조회는 실행하지 않습니다/);
  assert.match(email.body, /parking_job_1/);
});
