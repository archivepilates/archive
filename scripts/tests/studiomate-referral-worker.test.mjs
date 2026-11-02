import { test } from "node:test";
import assert from "node:assert/strict";
import { runStudioMateReferralPoints, firestorePointLedger, firstQualifyingReferralTicket, loadReferralBatch } from "../lib/studiomate-referral-worker.mjs";
import { digest } from "../lib/studiomate-referral-points.mjs";

test("earlier unpaid/cancelled/refunded/unusable/shared purchase cannot mask a later paid eligible purchase", () => {
  const paid = { userTicketId: "2", title: "정규 그룹권", issuedAt: "2026-11-02T00:00:00Z", usable: true,
    isShared: false, status: "active", cancelled: false, refunded: false,
    payment: { verified: true, complete: true, status: "paid", outstandingAmount: 0, paidAmount: 300000, totalAmount: 300000 } };
  for (const patch of [
    { payment: { ...paid.payment, status: "unpaid", paidAmount: 0, outstandingAmount: 300000 } },
    { cancelled: true }, { refunded: true }, { usable: false }, { isShared: true }, { title: "체험 1회권" },
  ]) assert.equal(firstQualifyingReferralTicket([{ ...paid, ...patch, userTicketId: "1", issuedAt: "2026-11-01T00:00:00Z" }, paid]).userTicketId, "2");
});
test("fair cursor visits held requests then later documents and wraps without changing receipt eligibility", async () => {
  const ids = Array.from({ length: 12 }, (_, i) => i.toString(16).padStart(64, "0"));
  let lastRequestId = "";
  const query = (after = "", limit = 10) => ({
    where: () => query(after, limit), orderBy: () => query(after, limit),
    startAfter: cursor => query(cursor, limit), limit: n => query(after, n),
    get: async () => { const docs = ids.filter(id => !after || id > after).slice(0, limit).map(id => ({ id })); return { empty: !docs.length, docs }; },
  });
  const db = { doc: () => ({ get: async () => ({ data: () => ({ lastRequestId }) }) }), collection: () => query() };
  let batch = await loadReferralBatch(db); assert.equal(batch.docs.length, 10);
  lastRequestId = batch.docs.at(-1).id;
  batch = await loadReferralBatch(db); assert.deepEqual(batch.docs.map(d => d.id), ids.slice(10));
  lastRequestId = batch.docs.at(-1).id;
  batch = await loadReferralBatch(db); assert.deepEqual(batch.docs.map(d => d.id), ids.slice(0, 10));
});

test("emergency-disabled worker never accesses DB or browser", async () => {
  const saved = process.env.STUDIOMATE_REFERRAL_POINTS; process.env.STUDIOMATE_REFERRAL_POINTS = "disabled";
  try {
    const result = await runStudioMateReferralPoints({ db: new Proxy({}, { get() { throw new Error("unexpected db access"); } }) });
    assert.equal(result.status, "disabled"); assert.equal(result.pointWrites, 0);
  } finally { if (saved === undefined) delete process.env.STUDIOMATE_REFERRAL_POINTS; else process.env.STUDIOMATE_REFERRAL_POINTS = saved; }
});
test("missing/unapproved promotion does not open a browser or process receipts", async () => {
  const saved = process.env.STUDIOMATE_REFERRAL_POINTS; process.env.STUDIOMATE_REFERRAL_POINTS = "enabled";
  try {
    for (const config of [undefined, { enabled: true }, { enabled: true, purchaseThresholdConfirmed: true, sourcePromoted: true, pointWriterE2eVerified: false, studioId: "5330" }]) {
      const result = await runStudioMateReferralPoints({ db: { doc: () => ({ get: async () => ({ data: () => config }) }) }, sessionFactory: () => { throw new Error("unexpected browser"); } });
      assert.equal(result.status, "disabled");
    }
  } finally { if (saved === undefined) delete process.env.STUDIOMATE_REFERRAL_POINTS; else process.env.STUDIOMATE_REFERRAL_POINTS = saved; }
});
test("stale export cannot authorize native work even with payout flags", async () => {
  const saved = process.env.STUDIOMATE_REFERRAL_POINTS; process.env.STUDIOMATE_REFERRAL_POINTS = "enabled";
  try {
    const config = { enabled: true, purchaseThresholdConfirmed: true, sourcePromoted: true, pointWriterE2eVerified: true, studioId: "5330" };
    const result = await runStudioMateReferralPoints({ db: { doc: () => ({ get: async () => ({ data: () => config }) }) },
      rows: [], source: { complete: true, applied: true, sourceImportId: "fixture", downloadedAt: "2020-01-01T00:00:00Z" },
      sessionFactory: () => { throw new Error("unexpected browser"); } });
    assert.equal(result.reason, "fresh_complete_excel_required");
  } finally { if (saved === undefined) delete process.env.STUDIOMATE_REFERRAL_POINTS; else process.env.STUDIOMATE_REFERRAL_POINTS = saved; }
});
test("claim transaction rechecks current receipt and config; never overwrites existing claim", async () => {
  const fields = { newMemberName: "신규", newMemberPhone: "01000000001", referrerName: "추천", referrerPhone: "01000000002" };
  const request = { ...fields, inputHash: digest(fields), studioId: "5330", status: "verification_required" }, config = { enabled: true };
  let prior = false, changedRequest = false, changedConfig = false, cancelled = false, changedFields = false, writes = 0;
  const ref = { id: "fixture" };
  const db = {
    collection: () => ({ doc: () => ({ kind: "claim" }) }), doc: () => ({ kind: "settings" }),
    runTransaction: async fn => fn({ get: async r => r === ref ? { data: () => ({ ...request,
      ...(changedRequest ? { inputHash: "different" } : {}), ...(changedFields ? { referrerName: "변경" } : {}),
      ...(cancelled ? { status: "cancelled" } : {}) }) }
      : r.kind === "settings" ? { data: () => changedConfig ? { enabled: false } : config }
      : { exists: prior }, create: () => { writes++; }, update: () => {} }),
  };
  const ledger = firestorePointLedger(db, ref, request, digest(config));
  assert.equal(await ledger.claim("key", {}), true); assert.equal(writes, 1);
  prior = true; assert.equal(await ledger.claim("key", {}), false); assert.equal(writes, 1);
  prior = false; changedRequest = true; await assert.rejects(ledger.claim("key", {}));
  changedRequest = false; changedConfig = true; await assert.rejects(ledger.claim("key", {}));
  changedConfig = false; cancelled = true; await assert.rejects(ledger.claim("key", {}));
  cancelled = false; changedFields = true; await assert.rejects(ledger.claim("key", {})); assert.equal(writes, 1);
});

test("dispatch transaction blocks configuration disabled after earlier source verification", async () => {
  const fields = { newMemberName: "신규", newMemberPhone: "01000000001", referrerName: "추천", referrerPhone: "01000000002" };
  const request = { ...fields, inputHash: digest(fields), studioId: "5330", status: "claimed", claimKey: "key" };
  const ref = { id: "fixture" }; let writes = 0;
  const db = {
    collection: () => ({ doc: () => ({ kind: "claim" }) }), doc: () => ({ kind: "settings" }),
    runTransaction: async fn => fn({ get: async r => r === ref ? { data: () => request }
      : r.kind === "settings" ? { data: () => ({ enabled: false }) }
      : { exists: true, data: () => ({ requestId: ref.id }) }, update: () => { writes++; } }),
  };
  const ledger = firestorePointLedger(db, ref, request, digest({ enabled: true }));
  await assert.rejects(ledger.update("key", { status: "dispatching" }), /settings_changed/);
  assert.equal(writes, 0);
});
