import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  classifyCoverageReconciliationTransition as classify,
  contractHintRowCounts,
  validateCoverageReconciliations,
} from "./studiomate-contract-coverage-reconciliation.mjs";

const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const a = hash("a"), b = hash("b"), c = hash("c"), member = hash("member");
const entry = {
  schemaVersion: 1, reviewId: hash("review"), reviewedAt: "2026-11-02T01:00:00Z",
  originalObservedAt: "2026-10-30T01:00:00Z",
  historicalRows: { [a]: 1, [b]: 2 }, minimumRows: { [a]: 1 }, lastRows: { [a]: 1 },
};

test("row hashes retain multiplicity and use exact normalized hint JSON", () => {
  const hint = { productName: "Synthetic", issuedAtText: "2026-10-30" };
  assert.deepEqual(contractHintRowCounts([hint, hint]), { [hash(hint)]: 2 });
  assert.deepEqual(contractHintRowCounts([]), {});
});

test("optional reconciliation validation rejects malformed keys, counts, bounds and timestamps", () => {
  assert.equal(validateCoverageReconciliations(undefined), true);
  assert.equal(validateCoverageReconciliations({}), true);
  assert.equal(validateCoverageReconciliations({ [member]: entry }), true);
  for (const value of [null, [], { invalid: entry }]) {
    assert.equal(validateCoverageReconciliations(value), false);
  }
  for (const override of [
    { schemaVersion: 0 }, { reviewId: "invalid" }, { reviewedAt: "2026-02-30T01:00:00Z" },
    { originalObservedAt: "2026-11-03T01:00:00Z" }, { historicalRows: null },
    { historicalRows: { [a]: 0 } }, { minimumRows: { [a]: -1 } },
    { lastRows: { [a]: 1.5 } }, { minimumRows: { [c]: 1 } }, { lastRows: {} },
  ]) assert.equal(validateCoverageReconciliations({ [member]: { ...entry, ...override } }), false);
});

test("restoration and re-disappearance of historical rows are safe and hintless", () => {
  const restored = { [a]: 1, [b]: 2 };
  const before = structuredClone(entry);
  assert.equal(classify(entry, restored).suppressHint, true);
  assert.equal(classify({ ...entry, lastRows: restored }, { [a]: 1, [b]: 1 }).waiveCoverageLoss, true);
  assert.equal(classify({ ...entry, lastRows: restored }, { [a]: 1 }).suppressHint, true);
  assert.deepEqual(entry, before);
});

test("new rows, including duplicate multiplicity beyond history, require normal discovery", () => {
  for (const current of [{ [a]: 1, [c]: 1 }, { [a]: 1, [b]: 3 }]) {
    const result = classify(entry, current);
    assert.equal(result.hasNovelAdditions, true);
    assert.equal(result.suppressHint, false);
  }
});

test("restoration after a novel observation is hintless, but novel loss is never excused", () => {
  const observed = { ...entry, lastRows: { [a]: 1, [c]: 1 } };
  assert.equal(classify(observed, { [a]: 1, [b]: 1, [c]: 1 }).suppressHint, true);
  assert.equal(classify(observed, { [a]: 1, [b]: 1 }).waiveCoverageLoss, false);
  const duplicate = { ...entry, lastRows: { [a]: 1, [b]: 3 } };
  assert.equal(classify(duplicate, { [a]: 1, [b]: 2 }).lossIsHistorical, false);
});

test("minimum loss and invalid inputs fail closed; reviewed empty member can restore and disappear", () => {
  assert.equal(classify(entry, { [b]: 2 }).waiveCoverageLoss, false);
  assert.equal(classify(null, {}).valid, false);
  assert.equal(classify(entry, { [a]: 0 }).valid, false);
  const empty = { ...entry, minimumRows: {}, lastRows: {} };
  assert.equal(classify(empty, {}).suppressHint, true);
  assert.equal(classify(empty, { [b]: 1 }).suppressHint, true);
  assert.equal(classify({ ...empty, lastRows: { [b]: 1 } }, {}).waiveCoverageLoss, true);
  assert.equal(classify(empty, { [c]: 1 }).hasNovelAdditions, true);
});
