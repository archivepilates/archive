import test from "node:test";
import assert from "node:assert/strict";
import { shouldRetireOnsiteRequest } from "../retire-onsite-welcome-requests.mjs";

test("retirement affects only unsent inactive requests and is idempotent", () => {
  for (const status of ["ready", "lookup_ready", "error", "pending"]) assert.equal(shouldRetireOnsiteRequest({ status }), true);
  for (const status of ["sent", "cancelled", "running", "unknown"]) assert.equal(shouldRetireOnsiteRequest({ status }), false);
  for (const field of ["alimtalkSendId", "alimtalkCandidateId", "retiredAt"]) {
    assert.equal(shouldRetireOnsiteRequest({ status: "ready", [field]: "existing" }), false);
  }
});
