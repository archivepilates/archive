import assert from "node:assert/strict";
import test from "node:test";
import { isMacMiniAdminSyncRequest } from "../../firebase/kangsain-functions/functions/src/sync/adminSyncRequestRouting";

test("routes browser-owned admin sync requests only to the Mac mini runner", () => {
  assert.equal(isMacMiniAdminSyncRequest("emergency_excel"), true);
  assert.equal(isMacMiniAdminSyncRequest("membership_contract_readback"), true);
  assert.equal(isMacMiniAdminSyncRequest("dashboard"), false);
  assert.equal(isMacMiniAdminSyncRequest(undefined), false);
});
