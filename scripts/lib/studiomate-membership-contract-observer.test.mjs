import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
