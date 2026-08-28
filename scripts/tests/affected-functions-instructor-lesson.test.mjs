import assert from "node:assert/strict";
import test from "node:test";
import { codebasesForFile } from "../lib/affected-functions.mjs";

test("강사레슨 예약확정 원천 변경은 앱과 알림톡 함수에 함께 배포한다", () => {
  assert.deepEqual(
    codebasesForFile(
      "firebase/kangsain-functions/functions/src/instructorLessonRegistration/instructorLessonConfirmation.ts",
    ),
    ["functions-alimtalk", "functions-app"],
  );
  assert.deepEqual(
    codebasesForFile(
      "firebase/kangsain-functions/functions/src/instructorLessonRegistration/instructorLessonRegistration.ts",
    ),
    ["functions-app"],
  );
});
