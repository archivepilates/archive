import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { selectNativeMembershipContractCandidate } from "./studiomate-membership-contract-native-selection.mjs";
import {
  CONTRACT_LANE,
  contractObservationGroups,
  isFreshContractDiscoverySource,
  observeMembershipContractHints,
  membershipContractDiscoveryWarning,
} from "./studiomate-membership-contract-observer.mjs";

const now = "2026-09-14T07:00:00.000Z";
const row = {
  이름: "테스트",
  전화번호: "01000000000",
  수강권명: "정규 그룹",
  수강권발급일: "2026-09-14",
  결제금액: "400000",
};
const source = {
  sourceImportId: "test-import",
  downloadedAt: "2026-09-14T06:55:00.000Z",
  complete: true,
  applied: true,
};
const nextSource = {
  ...source,
  downloadedAt: "2026-09-14T06:58:00Z",
  sourceImportId: "new-import",
};
const restoredSource = {
  ...source,
  downloadedAt: "2026-09-14T06:59:00Z",
  sourceImportId: "restored-import",
};
const stateKey = `workLanes/${CONTRACT_LANE}/state/excelBaseline`;

function fakeDb() {
  const records = new Map();
  const ref = (key) => ({
    key,
    id: key.split("/").at(-1),
    collection: (name) => ({ doc: (id) => ref(`${key}/${name}/${id}`) }),
    get: async () => ({
      exists: records.has(key),
      data: () => records.get(key),
    }),
  });
  return {
    records,
    collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }),
    runTransaction: async (fn) => {
      const pending = [];
      const value = await fn({
        get: (r) => r.get(),
        set: (r, data) => pending.push([r.key, data]),
      });
      for (const [key, data] of pending) records.set(key, data);
      return value;
    },
  };
}

function memberRows(count = 100) {
  return Array.from({ length: count }, (_, index) => ({
    ...row,
    전화번호: `010${String(index).padStart(8, "0")}`,
  }));
}

test("one missing member out of 100 does not block an unrelated new candidate", async () => {
  const db = fakeDb();
  const rows = memberRows();
  await observeMembershipContractHints({ db, rows, source, now });
  const before = structuredClone(db.records.get(stateKey));
  const [held] = contractObservationGroups([rows[0]]);
  const newcomer = { ...row, 전화번호: "01000000100" };
  const [added] = contractObservationGroups([newcomer]);
  const result = await observeMembershipContractHints({
    db, rows: [...rows.slice(1), newcomer], source: nextSource, now,
  });
  assert.equal(result.ok, true);
  assert.equal(result.candidates, 1);
  assert.deepEqual(result.candidateFingerprints, [added.id]);
  assert.deepEqual(result.coverageLossIds, [held.id]);
  assert.equal(result.coverageReviewCount, 1);
  assert.equal(result.sends, 0);
  const baseline = db.records.get(stateKey);
  assert.equal(baseline.fingerprints[held.id], before.fingerprints[held.id]);
  assert.equal(baseline.rowCounts[held.id], before.rowCounts[held.id]);
  assert.equal(baseline.observedAtByMember[held.id], source.downloadedAt);
  assert.equal(baseline.observedAtByMember[added.id], nextSource.downloadedAt);
  assert.equal(baseline.downloadedAt, nextSource.downloadedAt);
  assert.equal(db.records.size, 2);
});

test("restoring a quarantined ticket row preserves identity and emits no duplicate hint", async () => {
  const db = fakeDb();
  const rows = memberRows();
  const extra = { ...rows[0], 수강권명: "Second regular ticket" };
  const complete = [...rows, extra];
  const [held] = contractObservationGroups([rows[0], extra]);
  await observeMembershipContractHints({ db, rows: complete, source, now });
  const partial = await observeMembershipContractHints({ db, rows, source: nextSource, now });
  assert.equal(partial.ok, true);
  assert.deepEqual(partial.coverageLossIds, [held.id]);
  assert.equal(partial.candidates, 0);
  assert.equal(db.records.get(stateKey).fingerprints[held.id], held.fingerprint);
  assert.equal(db.records.get(stateKey).rowCounts[held.id], 2);
  const restored = await observeMembershipContractHints({
    db, rows: complete, source: restoredSource, now,
  });
  assert.equal(restored.ok, true);
  assert.equal(restored.candidates, 0);
  assert.deepEqual(restored.coverageLossIds, []);
  assert.equal(db.records.get(stateKey).fingerprints[held.id], held.fingerprint);
  assert.equal(db.records.get(stateKey).observedAtByMember[held.id], restoredSource.downloadedAt);
  assert.equal(db.records.size, 1);
});

test("repeated quarantine retains the old member bound and selects an issuance from the gap", async () => {
  const db = fakeDb();
  const rows = memberRows();
  const extra = { ...rows[0], 수강권명: "Old extra ticket" };
  const purchase = { ...rows[0], 수강권명: "New regular ticket" };
  const [held] = contractObservationGroups([rows[0], extra]);
  await observeMembershipContractHints({ db, rows: [...rows, extra], source, now });
  for (const downloadedAt of [nextSource.downloadedAt, "2026-09-14T06:58:30Z"]) {
    const partial = await observeMembershipContractHints({
      db, rows, source: { ...nextSource, downloadedAt }, now,
    });
    assert.equal(partial.ok, true);
    assert.deepEqual(partial.coverageLossIds, [held.id]);
    assert.equal(db.records.get(stateKey).observedAtByMember[held.id], source.downloadedAt);
    assert.equal(db.records.get(stateKey).downloadedAt, downloadedAt);
  }
  const restored = await observeMembershipContractHints({
    db, rows: [...rows, extra, purchase], source: restoredSource, now,
  });
  assert.equal(restored.candidates, 1);
  const [candidate] = restored.candidateHints;
  assert.equal(candidate.phoneFingerprint, held.id);
  assert.equal(candidate.previousDownloadedAt, source.downloadedAt);
  const persisted = db.records.get(`workLanes/${CONTRACT_LANE}/purchaseHints/${candidate.hintId}`);
  assert.equal(persisted.previousDownloadedAt, source.downloadedAt);
  assert.equal(db.records.get(stateKey).observedAtByMember[held.id], restoredSource.downloadedAt);
  const input = {
    group: { phone: rows[0].전화번호, rows: [rows[0], extra, purchase] },
    member: { memberId: "100", phone: rows[0].전화번호 },
    ticketRead: {
      status: "verified",
      tickets: [{
        memberId: "100", userTicketId: "200", productId: "300",
        title: purchase.수강권명, issuedAt: "2026-09-14T06:57:00.000Z",
        status: "active", refunded: false, cancelled: false,
        payment: {
          verified: true, complete: true, status: "paid",
          totalAmount: 400000, paidAmount: 400000, outstandingAmount: 0, refundedAmount: 0,
          transactions: [{
            paymentId: "synthetic-payment", method: "card", status: "paid",
            amount: 400000, paidAt: "2026-09-14T06:57:00.000Z",
          }],
        },
      }],
    },
    contractHistory: { status: "verified", records: [] },
    previousDownloadedAt: candidate.previousDownloadedAt,
    sourceDownloadedAt: restored.sourceDownloadedAt,
    config: {
      studioId: "5330", regularProductIds: ["300"], termsVersion: "synthetic-v1",
      cutoverAt: "2026-09-14T00:00:00.000Z", maxSourceAgeMs: 3600000,
      maxIssuanceAgeMs: 3600000,
    },
  };
  const selected = selectNativeMembershipContractCandidate(input);
  assert.equal(selected.status, "eligible");
  assert.equal(selected.selection.userTicketId, "200");
  assert.equal(selectNativeMembershipContractCandidate({
    ...input, previousDownloadedAt: restored.previousDownloadedAt,
  }).reason, "no_fresh_native_issuance");
  const repeated = await observeMembershipContractHints({
    db, rows: [...rows, extra, purchase], source: { ...restoredSource, downloadedAt: now }, now,
  });
  assert.equal(repeated.candidates, 0);
  assert.equal(db.records.size, 2);
});

test("coverage loss above five percent of members or rows blocks all writes", async (t) => {
  for (const kind of ["members", "rows"]) {
    await t.test(kind, async () => {
      const db = fakeDb();
      const rows = memberRows();
      const extras = Array.from({ length: 6 }, (_, index) => ({
        ...rows[0], 수강권명: `Extra ticket ${index}`,
      }));
      await observeMembershipContractHints({
        db, rows: kind === "rows" ? [...rows, ...extras] : rows, source, now,
      });
      const before = structuredClone([...db.records]);
      const partial = await observeMembershipContractHints({
        db,
        rows: [...(kind === "rows" ? rows : rows.slice(6)), { ...row, 전화번호: "01000000100" }],
        source: nextSource, now,
      });
      assert.equal(partial.ok, false);
      assert.equal(partial.reason, "export_coverage_loss_explicit_review_required");
      assert.equal(partial.candidates, 0);
      assert.deepEqual([...db.records], before);
    });
  }
});

test("source guard rejects dry runs, missing import, stale and future downloads", () => {
  assert.equal(isFreshContractDiscoverySource(source, Date.parse(now)), true);
  for (const change of [
    { applied: false },
    { complete: false },
    { sourceImportId: "" },
    { downloadedAt: "2026-09-14T05:00:00Z" },
    { downloadedAt: "2026-09-15T00:00:00Z" },
  ]) {
    assert.equal(
      isFreshContractDiscoverySource({ ...source, ...change }, Date.parse(now)),
      false,
    );
  }
});
test("usage, status and holding expiry edits are not purchase discovery", () => {
  assert.deepEqual(
    contractObservationGroups([row]),
    contractObservationGroups([
      { ...row, 잔여횟수: "5", 수강권상태: "정지", 수강권종료일: "2027-01-01" },
    ]),
  );
});
test("phone normalized; same phone ambiguous names held; multiplicity preserved", () => {
  const [a] = contractObservationGroups([row]);
  const [b] = contractObservationGroups([
    { ...row, 전화번호: "+82 10 0000 0000" },
  ]);
  assert.equal(a.id, b.id);
  const [c] = contractObservationGroups([row, { ...row, 이름: "다른 이름" }]);
  assert.equal(c.ambiguousNames, true);
  assert.equal(c.hints.length, 2);
  assert.notEqual(a.fingerprint, c.fingerprint);
});
test("baseline has zero hints; changes create review-only hints; retries no sends", async () => {
  const db = fakeDb();
  const first = await observeMembershipContractHints({
    db,
    rows: [row],
    source,
    now,
  });
  assert.equal(first.baseline, true);
  assert.equal(first.candidates, 0);
  const nextSource = {
    ...source,
    downloadedAt: "2026-09-14T06:58:00Z",
    sourceImportId: "new-import",
  };
  const changed = await observeMembershipContractHints({
    db,
    rows: [row, { ...row, 수강권명: "두 번째 수강권" }],
    source: nextSource,
    now,
  });
  assert.equal(changed.candidates, 1);
  const hint = [...db.records.values()].find((x) => x.status);
  assert.equal(hint.allowedAction, "read_only_review");
  assert.ok(hint.prohibitedActions.includes("contract_send"));
  assert.equal(JSON.stringify(hint).includes("01000000000"), false);
  const retry = await observeMembershipContractHints({
    db,
    rows: [row],
    source: nextSource,
    now,
  });
  assert.equal(retry.candidates, 0);
  assert.equal(retry.sends, 0);
});
test("invalid source never reads or writes DB", async () => {
  const result = await observeMembershipContractHints({
    db: {},
    rows: [row],
    source: { ...source, applied: false },
    now,
  });
  assert.equal(result.ok, false);
  assert.equal(result.sends, 0);
});

test("partial member export preserves baseline and restoration produces no new hints", async () => {
  const db = fakeDb();
  const other = { ...row, 전화번호: "01000000001" };
  await observeMembershipContractHints({ db, rows: [row, other], source, now });
  const before = structuredClone([...db.records]);
  const partial = await observeMembershipContractHints({
    db,
    rows: [row],
    source: nextSource,
    now,
  });
  assert.equal(partial.reason, "export_coverage_loss_explicit_review_required");
  assert.deepEqual([...db.records], before);
  const restored = await observeMembershipContractHints({
    db,
    rows: [row, other],
    source: restoredSource,
    now,
  });
  assert.equal(restored.candidates, 0);
  assert.equal(db.records.size, 1);
});

test("partial ticket rows for an existing member also preserve baseline", async () => {
  const db = fakeDb();
  const second = { ...row, 수강권명: "다른 정규 수강권" };
  await observeMembershipContractHints({
    db,
    rows: [row, second],
    source,
    now,
  });
  const before = structuredClone([...db.records]);
  const partial = await observeMembershipContractHints({
    db,
    rows: [row],
    source: nextSource,
    now,
  });
  assert.equal(partial.ok, false);
  assert.deepEqual([...db.records], before);
  assert.equal(
    (
      await observeMembershipContractHints({
        db,
        rows: [row, second],
        source: restoredSource,
        now,
      })
    ).candidates,
    0,
  );
});

test("blank values cannot bootstrap or erase the purchase baseline", async () => {
  const db = fakeDb();
  const blank = { 전화번호: "", 수강권명: "" };
  assert.equal(
    (await observeMembershipContractHints({ db, rows: [blank], source, now }))
      .ok,
    false,
  );
  assert.equal(db.records.size, 0);
  await observeMembershipContractHints({ db, rows: [row], source, now });
  const before = structuredClone([...db.records]);
  assert.equal(
    (
      await observeMembershipContractHints({
        db,
        rows: [blank],
        source: nextSource,
        now,
      })
    ).ok,
    false,
  );
  assert.deepEqual([...db.records], before);
});

test("malformed persisted baselines require recovery and never generate historical hints", async () => {
  const db = fakeDb();
  await observeMembershipContractHints({ db, rows: [row], source, now });
  const valid = db.records.get(stateKey);
  const [id] = Object.keys(valid.fingerprints);
  const invalidStates = [
    null,
    {},
    { downloadedAt: "invalid" },
    { ...valid, schemaVersion: 0 },
    { ...valid, downloadedAt: "invalid" },
    { ...valid, initializedAt: "invalid" },
    { ...valid, sourceImportId: "" },
    { ...valid, fingerprints: [] },
    { ...valid, fingerprints: {} },
    { ...valid, rowCounts: {} },
    { ...valid, rowCounts: { [id]: 0 } },
    { ...valid, fingerprints: { [id]: "not-sha256" } },
  ];
  for (const invalid of invalidStates) {
    db.records.set(stateKey, invalid);
    const before = structuredClone([...db.records]);
    const result = await observeMembershipContractHints({
      db,
      rows: [row],
      source: nextSource,
      now,
    });
    assert.equal(result.reason, "invalid_baseline_explicit_recovery_required");
    assert.equal(result.candidates, 0);
    assert.deepEqual([...db.records], before);
  }
});

test("source timestamp must be a real UTC time and cannot gain freshness after a slow download", () => {
  for (const downloadedAt of [
    "2026-09-14",
    "2026-09-14T06:55:00",
    "2026-02-30T06:55:00Z",
    "invalid",
  ]) {
    assert.equal(
      isFreshContractDiscoverySource(
        { ...source, downloadedAt },
        Date.parse(now),
      ),
      false,
    );
  }
  assert.equal(
    isFreshContractDiscoverySource(source, Date.parse("2026-09-14T07:30:00Z")),
    false,
  );
  const runner = readFileSync(
    new URL("../run-studiomate-excel-emergency-mode.mjs", import.meta.url),
    "utf8",
  );
  const capture = runner.indexOf(
    "const downloadStartedAt = new Date().toISOString()",
  );
  assert.ok(
    capture >= 0 &&
      capture < runner.indexOf('const downloadStep = runStep("download"'),
  );
  assert.ok(runner.includes("contractSourceDownloadedAt = downloadStartedAt"));
});

test("observer failures appear as independent warnings without failing good member imports", () => {
  assert.equal(membershipContractDiscoveryWarning({ ok: true }), null);
  assert.equal(
    membershipContractDiscoveryWarning({
      ok: true,
      membershipContractDiscovery: { ok: true },
    }),
    null,
  );
  const summary = {
    ok: true,
    membershipContractDiscovery: { ok: false, reason: "partial export" },
  };
  const warning = membershipContractDiscoveryWarning(summary);
  assert.equal(summary.ok, true);
  assert.equal(warning.name, "membershipContractDiscovery");
  assert.equal(warning.stdoutOk, false);
  assert.equal(warning.exitCode, 0);
  assert.equal(warning.requiredFailed, false);
  assert.equal(warning.stderr, "partial export");
  assert.equal(
    membershipContractDiscoveryWarning({ membershipContractDiscovery: null })
      .stdoutOk,
    false,
  );
});
