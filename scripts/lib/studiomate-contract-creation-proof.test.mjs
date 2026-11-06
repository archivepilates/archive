import assert from "node:assert/strict";
import test from "node:test";
import { validateContractCreationVerification } from "./studiomate-contract-creation-proof.mjs";

const now = Date.parse("2026-11-06T07:00:00.000Z");
const valid = () => ({
  policy: "studiomate_join_create_v1",
  schemaVersion: 1,
  source: "studiomate_native_create",
  studioId: "5330",
  categoryId: 1,
  signType: 1,
  status: "verified",
  contractId: "a".repeat(64),
  payloadHash: "b".repeat(64),
  createdAt: "2026-11-06T06:00:00.000Z",
  verifiedAt: "2026-11-06T06:01:00.000Z",
  independentReloadVerified: true,
  originalMemberAndPassesPreserved: true,
  termsUnchecked: true,
});
const check = value => validateContractCreationVerification(value, { now });

test("accepts the exact shared creation proof with optional audit path without mutation", () => {
  for (const extra of [{}, { auditPath: "workLanes/contract-test/reports/create-proof" }]) {
    const value = Object.freeze({ ...valid(), ...extra });
    const before = structuredClone(value);
    assert.equal(check(value), true);
    assert.deepEqual(value, before);
  }
  assert.equal(check(Object.assign(Object.create(null), valid())), true);
  assert.equal(validateContractCreationVerification({ ...valid(), createdAt: "2020-01-01T00:00:00Z",
    verifiedAt: "2020-01-01T00:01:00Z" }), true);
});

test("every proof field is mandatory and strictly scoped", async t => {
  for (const [key, value] of Object.entries(valid())) await t.test(key, () => {
    const missing = valid();
    delete missing[key];
    assert.equal(check(missing), false);
    for (const replacement of [undefined, null, false, "", typeof value === "string" ? 1 : String(value)])
      assert.equal(check({ ...valid(), [key]: replacement }), false);
  });
  for (const extra of [{ policy: "studiomate_center_seal_upload_v1" }, { source: "studiomate_native_contract" },
    { studioId: "5331" }, { categoryId: 2 }, { signType: 2 }, { status: "pending" }])
    assert.equal(check({ ...valid(), ...extra }), false);
});

test("rejects seal-only evidence, historical flags and all extra keys including hidden secrets", () => {
  assert.equal(check({ status: "verified", policy: "studiomate_center_seal_upload_v1" }), false);
  assert.equal(check({ nativeE2eVerified: true, contractCreationVerified: true }), false);
  for (const key of ["nativeE2eVerified", "sealUploadVerification", "templateId", "token", "authorization", "secret"]) {
    assert.equal(check({ ...valid(), [key]: true }), false);
    assert.equal(check(Object.defineProperty(valid(), key, { value: "synthetic-secret" })), false);
  }
  assert.equal(check({ ...valid(), [Symbol("secret")]: "synthetic-secret" }), false);
});

test("requires exact lowercase 64-hex contract and payload bindings", () => {
  for (const key of ["contractId", "payloadHash"]) {
    for (const value of ["a".repeat(63), "a".repeat(65), "g".repeat(64), "A".repeat(64),
      ` ${"a".repeat(64)}`, `${"a".repeat(64)}\n`, 123])
      assert.equal(check({ ...valid(), [key]: value }), false);
  }
});

test("validates timezone-bearing ISO dates, actual calendar days and bounded offsets", () => {
  assert.equal(check({ ...valid(), createdAt: "2026-11-06T15:00:00+09:00",
    verifiedAt: "2026-11-06T06:00:00.001Z" }), true);
  assert.equal(check({ ...valid(), createdAt: "2024-02-29T00:00:00Z" }), true);
  assert.equal(check({ ...valid(), createdAt: "2000-02-29T00:00:00Z" }), true);
  for (const key of ["createdAt", "verifiedAt"]) {
    for (const value of ["2026-11-06", "2026-11-06T06:00:00", "2026-11-06 06:00:00Z",
      "2026-02-29T00:00:00Z", "1900-02-29T00:00:00Z", "2026-04-31T00:00:00Z",
      "2026-00-01T00:00:00Z", "2026-13-01T00:00:00Z", "2026-01-00T00:00:00Z",
      "2026-11-06T24:00:00Z", "2026-11-06T00:60:00Z", "2026-11-06T00:00:60Z",
      "2026-11-06T06:00:00+14:01", "2026-11-06T06:00:00+15:00", "2026-11-06T06:00:00+09:60",
      "2026-11-06T06:00:00.0001Z", "not-a-date", 0, new Date(now)])
      assert.equal(check({ ...valid(), [key]: value }), false);
  }
});

test("enforces inclusive creation, verification and current-time ordering", () => {
  const equal = { ...valid(), createdAt: new Date(now).toISOString(), verifiedAt: new Date(now).toISOString() };
  assert.equal(check(equal), true);
  assert.equal(check({ ...equal, verifiedAt: new Date(now - 1).toISOString() }), false);
  assert.equal(check({ ...equal, verifiedAt: new Date(now + 1).toISOString() }), false);
  assert.equal(check({ ...equal, createdAt: new Date(now + 1).toISOString() }), false);
  for (const invalidNow of [NaN, Infinity, -Infinity, "2026-11-06T07:00:00Z", () => now, null])
    assert.equal(validateContractCreationVerification(valid(), { now: invalidNow }), false);
});

test("rejects malformed records and audit paths without invoking getters or trusting inherited proof", () => {
  for (const value of [null, undefined, false, 1, "verified", [], new Date(now), Object.create(valid())])
    assert.equal(check(value), false);
  for (const auditPath of [undefined, null, false, 1, [], {}, "", "  "])
    assert.equal(check({ ...valid(), auditPath }), false);
  const accessor = Object.defineProperty(valid(), "status", { get: () => assert.fail("must not invoke a getter") });
  assert.equal(check(accessor), false);
});
