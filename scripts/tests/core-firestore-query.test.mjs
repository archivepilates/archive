import assert from "node:assert/strict";
import vm from "node:vm";
import test from "node:test";
import { initializeApp, deleteApp } from "firebase/app";
import { collection, getFirestore, query, where, documentId, Timestamp } from "firebase/firestore";
import { createRealmSafeWhere } from "../../core/assets/firestore-query.js";

test("shared parent SDK rejects the original child-frame status array", async () => {
  const app = initializeApp({ projectId: "synthetic-query-test" }, "unpatched-query");
  try {
    const foreign = vm.runInNewContext('["failed", "queued", "review"]');
    assert.equal(Array.isArray(foreign), true);
    assert.equal(foreign instanceof Array, false);
    assert.throws(() => query(collection(getFirestore(app), "alimtalkCandidates"), where("status", "in", foreign)), /custom Array/);
  } finally { await deleteApp(app); }
});

test("owner-frame wrapper preserves each foreign status list without a network read", async () => {
  const app = initializeApp({ projectId: "synthetic-query-test" }, "fixed-query");
  const safeWhere = createRealmSafeWhere(where);
  try {
    for (const name of ["alimtalkCandidates", "alimtalkSends", "onsiteWelcomeRequests", "memberSignupContracts", "pricingInquiryAlimtalkRequests"]) {
      const foreign = vm.runInNewContext('["failed", "error", "critical", "blocked"]');
      assert.doesNotThrow(() => query(collection(getFirestore(app), name), safeWhere("status", "in", foreign)));
      assert.equal(foreign instanceof Array, false);
      assert.equal(foreign.length, 4);
    }
    const ids = vm.runInNewContext('["member_1", "member_2"]');
    assert.doesNotThrow(() => query(collection(getFirestore(app), "memberProfiles"), safeWhere(documentId(), "in", ids)));
  } finally { await deleteApp(app); }
});

test("query adaptation leaves scalar and SDK field values unchanged", () => {
  const safeWhere = createRealmSafeWhere((...args) => args);
  const field = documentId();
  const stamp = Timestamp.fromMillis(123456);
  for (const value of ["failed", null, 42, true, stamp]) {
    assert.equal(safeWhere(field, "==", value)[0], field);
    assert.equal(safeWhere(field, "==", value)[2], value);
  }
  const original = ["failed", "queued"];
  const adapted = safeWhere("status", "in", original)[2];
  assert.notEqual(adapted, original);
  assert.deepEqual(adapted, original);
});
