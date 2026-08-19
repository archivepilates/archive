import assert from "node:assert/strict";
import test from "node:test";
import { codebasesForFile } from "../lib/affected-functions.mjs";

test("환불 함수 변경은 functions-app 배포 대상으로 감지한다", () => {
  assert.deepEqual(
    codebasesForFile("firebase/kangsain-functions/functions/src/refund/refundOperations.ts"),
    ["functions-app"],
  );
  assert.deepEqual(
    codebasesForFile("firebase/kangsain-functions/functions/src/refund/refundPolicy.ts"),
    ["functions-app"],
  );
});
