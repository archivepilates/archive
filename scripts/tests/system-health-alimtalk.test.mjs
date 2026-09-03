import assert from "node:assert/strict";
import test from "node:test";
import { isActionableAlimtalkFailure } from "../lib/system-health-alimtalk.mjs";

test("unresolved failed Alimtalk sends remain actionable", () => {
  assert.equal(isActionableAlimtalkFailure({ status: "failed" }), true);
  assert.equal(
    isActionableAlimtalkFailure({ status: "error", resolutionStatus: "open" }),
    true,
  );
});

test("explicitly resolved Alimtalk failures do not reopen system health actions", () => {
  for (const resolutionStatus of ["resolved", "superseded", "not_required"]) {
    assert.equal(
      isActionableAlimtalkFailure({ status: "failed", resolutionStatus }),
      false,
    );
  }
});

test("non-failure send states are never treated as failures", () => {
  assert.equal(isActionableAlimtalkFailure({ status: "done" }), false);
  assert.equal(isActionableAlimtalkFailure({ status: "queued" }), false);
});
