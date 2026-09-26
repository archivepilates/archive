import assert from "node:assert/strict";
import test from "node:test";
import { codebasesForFile } from "../lib/affected-functions.mjs";

test("온보딩 함수 변경은 functions-app 배포 대상으로 감지한다", () => {
  assert.deepEqual(
    codebasesForFile("firebase/kangsain-functions/functions/src/onboarding/instructorObservationSurvey.ts"),
    ["functions-app"],
  );
});
