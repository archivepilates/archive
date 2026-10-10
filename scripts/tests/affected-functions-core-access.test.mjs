import assert from "node:assert/strict";
import test from "node:test";
import { codebasesForFile } from "../lib/affected-functions.mjs";

test("shared authentication guards redeploy every callable consumer", () => {
  for (const file of ["authGuards.ts", "coreInstructorAccess.ts"]) {
    assert.deepEqual(codebasesForFile(`firebase/kangsain-functions/functions/src/security/${file}`),
      ["functions-alimtalk", "functions-app", "functions-social", "functions-sync"]);
  }
});

test("instructor workspace endpoints belong only to app", () => {
  assert.deepEqual(codebasesForFile("firebase/kangsain-functions/functions/src/callable/coreInstructorAccess.ts"), ["functions-app"]);
});
