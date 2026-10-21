import { test } from "node:test";
import assert from "node:assert/strict";
import { hashValue, matchesDigest, probeEvidence, recordShape, validProbeWindow, IMWEB_EVENTS } from "../../firebase/kangsain-functions/functions/src/sync/imwebWebhookProtocol";
const probeToken = "a".repeat(64);

test("probe capability comparison requires strong exact digest and no coercion", () => {
  const value = "0123456789abcdef0123456789abcdef";
  assert.equal(matchesDigest(value, hashValue(value)), true);
  for (const invalid of [null, false, 123, "", "short", value + "x"]) assert.equal(matchesDigest(invalid, hashValue(value)), false);
  assert.equal(matchesDigest(value, "invalid"), false);
});
test("evidence excludes raw credentials and personal body values", () => {
  const secret = "authorization-secret-test-value";
  const evidence = probeEvidence({ authorization: secret, cookie: "session-private", "x-provider-auth": secret,
    "x-forwarded-for": "192.0.2.10", "content-type": "application/json" },
  { siteCode: "example", memberUid: "sample@example.invalid", phone: "private-phone", token: secret }, probeToken);
  const serialized = JSON.stringify(evidence);
  for (const raw of [secret, "session-private", "192.0.2.10", "sample@example.invalid", "private-phone"])
    assert.equal(serialized.includes(raw), false);
  assert.equal(evidence.candidateHeaderDigests.authorization.length, 64);
  assert.notEqual(evidence.candidateHeaderDigests.authorization, hashValue(secret));
  assert.equal(Object.hasOwn(evidence.candidateHeaderDigests, "x-provider-auth"), false);
  assert.equal(Object.hasOwn(evidence.candidateHeaderDigests, "cookie"), false);
});
test("shape inspection bounds arrays and object depth", () => {
  assert.deepEqual(recordShape([{ siteCode: "never persisted" }, { memberUid: 1 }, { b: true }]),
    { type: "array", length: 3, items: [{ fields: { siteCode: "string" }, unknownFields: {}, unknownFieldCount: 0 },
      { fields: { memberUid: "number" }, unknownFields: {}, unknownFieldCount: 0 }] });
  assert.equal(JSON.stringify(recordShape({ a: { b: { c: { d: { e: { f: "private" } } } } } })).includes("private"), false);
});
test("untrusted body/header keys are not persisted raw", () => {
  const evidence = probeEvidence({ "private-member-id-string": "something", authorization: "a".repeat(32) },
    { "sample@example.invalid": "x", "private-secret-key": "y" }, probeToken);
  assert.equal(JSON.stringify(evidence).includes("sample@example.invalid"), false);
  assert.equal(JSON.stringify(evidence).includes("private-secret-key"), false);
  assert.equal(JSON.stringify(evidence).includes("private-member-id-string"), false);
});
test("probe lifetime must be finite and at most twenty minutes", () => {
  for (const end of [NaN, Infinity, -Infinity, 0, 1_200_002, "1000", null])
    assert.equal(validProbeWindow(1, end, 2), false);
  assert.equal(validProbeWindow(1, 1_200_001, 2), true);
  assert.equal(validProbeWindow(3, 1000, 2), false);
  assert.equal(validProbeWindow(1, 3, 3), false);
});
test("prototype properties are not event routes", () => {
  for (const key of ["constructor", "toString", "__proto__"]) assert.equal(Object.hasOwn(IMWEB_EVENTS, key), false);
});
