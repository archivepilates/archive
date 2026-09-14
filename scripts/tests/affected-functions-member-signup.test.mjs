import assert from "node:assert/strict";
import test from "node:test";
import { codebasesForFile } from "../lib/affected-functions.mjs";

test("member signup handlers deploy with the private chart codebase", () => {
  for (const file of ["onsiteWelcomeRequest.ts", "memberSignupContract.ts"]) {
    assert.deepEqual(
      codebasesForFile(`firebase/kangsain-functions/functions/src/memberSignup/${file}`),
      ["functions-private-chart"],
    );
  }
});
