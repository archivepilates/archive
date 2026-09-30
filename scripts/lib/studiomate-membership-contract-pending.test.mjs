import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  CONTRACT_LANE,
  observeMembershipContractHints,
} from "./studiomate-membership-contract-observer.mjs";
import { loadPendingContractDiscovery } from "./studiomate-membership-contract-pending.mjs";

const ROOT = `workLanes/${CONTRACT_LANE}/purchaseHints`;
const NOW = Date.parse("2026-09-30T01:00:00.000Z");
const SOURCE = {
  sourceImportId: "synthetic-current-import",
  downloadedAt: "2026-09-30T00:55:00.000Z",
  applied: true,
  complete: true,
};
const DISCOVERY = {
  ok: true, mode: "shadow", candidates: 0,
  candidateFingerprints: [], candidateHints: [], sends: 0,
};
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function hint(index, overrides = {}) {
  const data = {
    phoneFingerprint: hash(`synthetic-phone-${index}`),
    fingerprint: hash(`synthetic-purchase-${index}`),
    previousDownloadedAt: "2026-09-29T00:00:00.000Z",
    sourceDownloadedAt: new Date(Date.parse("2026-09-29T00:10:00.000Z") + index * 60000).toISOString(),
    status: "native_verification_required",
    ...overrides,
  };
  return { id: hash([data.phoneFingerprint, data.fingerprint]), data };
}

function fakeDb(seeds = []) {
  const records = new Map(seeds.map(({ id, data }) => [`${ROOT}/${id}`, structuredClone(data)]));
  const reads = [];
  const batches = [];
  const ref = (key) => ({
    key,
    id: key.split("/").at(-1),
    collection: (name) => collection(`${key}/${name}`),
    get: async () => ({ exists: records.has(key), data: () => structuredClone(records.get(key)) }),
  });
  const collection = (key) => ({
    doc: (id) => ref(`${key}/${id}`),
    where: (field, operator, value) => {
      assert.equal(key, ROOT);
      assert.equal(field, "status");
      assert.equal(operator, "==");
      assert.equal(value, "native_verification_required");
      return {
        limit: (count) => ({
          get: async () => {
            assert.equal(count, 200);
            const docs = [...records.entries()]
              .filter(([path, data]) => path.startsWith(`${key}/`) && data[field] === value)
              .sort(([a], [b]) => a.localeCompare(b))
              .slice(0, count)
              .map(([path, data]) => ({ id: path.split("/").at(-1), data: () => structuredClone(data) }));
            reads.push(docs.map((doc) => doc.id));
            return { docs, size: docs.length };
          },
        }),
      };
    },
  });
  return {
    records, reads, batches, collection, doc: ref,
    runTransaction: async (fn) => {
      const writes = [];
      const result = await fn({
        get: (target) => target.get(),
        set: (target, data) => writes.push([target.key, structuredClone(data)]),
      });
      for (const [key, data] of writes) records.set(key, data);
      return result;
    },
    batch: () => {
      const updates = [];
      return {
        update: (target, fields) => updates.push([target.key, structuredClone(fields)]),
        commit: async () => {
          for (const [key] of updates) assert.ok(records.has(key));
          for (const [key, fields] of updates) records.set(key, { ...records.get(key), ...fields });
          batches.push(updates);
        },
      };
    },
  };
}

const load = (db, discovery = DISCOVERY) => loadPendingContractDiscovery({
  db, discovery, source: SOURCE, now: NOW,
});

test("persisted hints are reread when the observer reports zero new candidates", async () => {
  const db = fakeDb();
  const row = { "\uC774\uB984": "Synthetic", "\uC804\uD654\uBC88\uD638": "01000000000", "\uC218\uAC15\uAD8C\uBA85": "Regular" };
  const initial = { ...SOURCE, downloadedAt: "2026-09-30T00:40:00.000Z" };
  await observeMembershipContractHints({ db, rows: [row], source: initial, now: new Date(NOW).toISOString() });
  const rows = [row, { ...row, "\uC218\uAC15\uAD8C\uBA85": "New regular" }];
  const first = await observeMembershipContractHints({ db, rows, source: SOURCE, now: new Date(NOW).toISOString() });
  assert.equal(first.candidates, 1);
  const retry = await observeMembershipContractHints({ db, rows, source: SOURCE, now: new Date(NOW).toISOString() });
  assert.equal(retry.candidates, 0);
  assert.equal(retry.reason, "already_observed_or_older_download");
  assert.equal(retry.previousDownloadedAt, undefined);
  const before = structuredClone([...db.records]);
  const pending = await load(db, retry);
  assert.equal(pending.candidates, 1);
  assert.deepEqual(pending.candidateHints, first.candidateHints);
  assert.equal(pending.candidateHints[0].previousDownloadedAt, initial.downloadedAt);
  assert.equal(pending.sourceDownloadedAt, SOURCE.downloadedAt);
  assert.deepEqual([...db.records], before);
  assert.equal(db.batches.length, 0);
});

test("pending selection caps at five and advances after processed statuses", async () => {
  const seeds = Array.from({ length: 8 }, (_, index) => hint(index));
  const db = fakeDb([...seeds].reverse());
  const first = await load(db);
  assert.equal(first.candidates, 5);
  assert.equal(first.pendingCount, 8);
  assert.equal(first.pendingScanLimited, false);
  assert.deepEqual(first.candidateHints.map((item) => item.hintId), seeds.slice(0, 5).map((item) => item.id));
  assert.equal(new Set(first.candidateFingerprints).size, 5);
  for (const { hintId } of first.candidateHints) db.records.get(`${ROOT}/${hintId}`).status = "processed";
  const second = await load(db);
  assert.equal(second.candidates, 3);
  assert.equal(second.pendingCount, 3);
  assert.deepEqual(second.candidateHints.map((item) => item.hintId), seeds.slice(5).map((item) => item.id));
  for (const { hintId } of second.candidateHints) db.records.get(`${ROOT}/${hintId}`).status = "processed";
  const empty = await load(db);
  assert.equal(empty.candidates, 0);
  assert.equal(empty.pendingCount, 0);
  assert.equal(db.records.size, 8);
  assert.equal(db.batches.length, 0);
});

test("200 invalid pending hints move to review so the next scan reaches valid work", async () => {
  const valid = hint(1);
  const invalid = Array.from({ length: 200 }, (_, index) => ({
    id: index.toString(16).padStart(64, "0"),
    data: { ...valid.data, fingerprint: "invalid", reason: "synthetic-invalid" },
  }));
  const db = fakeDb([...invalid, valid]);
  const first = await load(db);
  assert.equal(first.candidates, 0);
  assert.equal(first.invalidPendingCount, 200);
  assert.equal(first.pendingScanLimited, true);
  assert.equal(db.reads[0].length, 200);
  assert.equal(db.reads[0].includes(valid.id), false);
  assert.equal(db.batches.length, 1);
  assert.equal(db.batches[0].length, 200);
  for (const { id, data } of invalid) {
    assert.deepEqual(db.records.get(`${ROOT}/${id}`), {
      ...data, status: "review", reason: "invalid_pending_contract_hint", updatedAt: new Date(NOW),
    });
  }
  assert.deepEqual(db.records.get(`${ROOT}/${valid.id}`), valid.data);
  const second = await load(db);
  assert.equal(second.candidates, 1);
  assert.equal(second.invalidPendingCount, 0);
  assert.equal(second.pendingScanLimited, false);
  assert.equal(second.candidateHints[0].hintId, valid.id);
  assert.equal(db.batches.length, 1);
});

test("freshness uses the current clock and current export, not a persisted hint clock", async (t) => {
  t.mock.method(Date, "now", () => NOW);
  const old = hint(0);
  const db = fakeDb([old]);
  const current = await loadPendingContractDiscovery({ db, discovery: DISCOVERY, source: SOURCE });
  assert.equal(current.candidates, 1);
  assert.equal(current.sourceDownloadedAt, SOURCE.downloadedAt);
  assert.equal(current.candidateHints[0].previousDownloadedAt, old.data.previousDownloadedAt);
  for (const downloadedAt of [old.data.sourceDownloadedAt, "2026-09-30T00:29:59.999Z", "2026-09-30T01:00:00.001Z"]) {
    const result = await loadPendingContractDiscovery({
      db: {}, discovery: DISCOVERY, source: { ...SOURCE, downloadedAt },
    });
    assert.equal(result, DISCOVERY);
  }
  assert.equal(db.reads.length, 1);
});

test("coverage-held groups are skipped without consuming their pending hints", async () => {
  const held = hint(0);
  const allowed = hint(1);
  const db = fakeDb([held, allowed]);
  const before = structuredClone([...db.records]);
  const partial = await load(db, { ...DISCOVERY, coverageLossIds: [held.data.phoneFingerprint] });
  assert.equal(partial.candidates, 1);
  assert.deepEqual(partial.candidateFingerprints, [allowed.data.phoneFingerprint]);
  assert.equal(partial.invalidPendingCount, 0);
  assert.deepEqual([...db.records], before);
  assert.equal(db.batches.length, 0);
  db.records.get(`${ROOT}/${allowed.id}`).status = "processed";
  const restored = await load(db, { ...DISCOVERY, coverageLossIds: [] });
  assert.equal(restored.candidates, 1);
  assert.equal(restored.candidateHints[0].hintId, held.id);
  assert.equal(restored.candidateHints[0].previousDownloadedAt, held.data.previousDownloadedAt);
});

test("multiple hints for one phone occupy only one slot and preserve the oldest bound", async () => {
  const oldest = hint(0);
  const newer = hint(1, { phoneFingerprint: oldest.data.phoneFingerprint });
  const other = hint(2);
  const db = fakeDb([newer, other, oldest]);
  const result = await load(db);
  assert.equal(result.candidates, 2);
  assert.deepEqual(result.candidateHints.map((item) => item.hintId), [oldest.id, other.id]);
  assert.equal(result.candidateHints[0].previousDownloadedAt, oldest.data.previousDownloadedAt);
  assert.equal(db.records.get(`${ROOT}/${newer.id}`).status, "native_verification_required");
});

test("failed discovery and incomplete or unapplied sources never access the database", async () => {
  const failed = { ...DISCOVERY, ok: false };
  assert.equal(await loadPendingContractDiscovery({ db: {}, discovery: failed, source: SOURCE, now: NOW }), failed);
  for (const change of [{ complete: false }, { applied: false }, { sourceImportId: "" }]) {
    assert.equal(await loadPendingContractDiscovery({
      db: {}, discovery: DISCOVERY, source: { ...SOURCE, ...change }, now: NOW,
    }), DISCOVERY);
  }
});
