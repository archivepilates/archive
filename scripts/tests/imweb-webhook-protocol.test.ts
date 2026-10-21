import { test } from "node:test";
import assert from "node:assert/strict";
import { hashValue, matchesDigest, probeEvidence, recordShape, validProbeWindow, IMWEB_EVENTS, IMWEB_SITE, IMWEB_UNIT, normalizeImwebWire } from "../../firebase/kangsain-functions/functions/src/sync/imwebWebhookProtocol";
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
const baseEvent = () => ({ eventType: "END_USER_SIGN_UP", eventTime: 1792594000,
  data: { siteCode: IMWEB_SITE, unitCode: IMWEB_UNIT, memberUid: "synthetic@example.invalid" } });
test("verified wire is a shadow lookup hint, never a grant", () => {
  const event = normalizeImwebWire(baseEvent(), "signup");
  assert.equal(event.grantsAllowed, false);
  assert.equal(event.providerSample, false);
  assert.deepEqual(event.memberUids, ["synthetic@example.invalid"]);
});
test("receipt ignores JSON key ordering and does not merge distinct arrivals", () => {
  const a = baseEvent();
  const b = { data: { memberUid: a.data.memberUid, unitCode: IMWEB_UNIT, siteCode: IMWEB_SITE }, eventTime: a.eventTime, eventType: a.eventType };
  assert.equal(normalizeImwebWire(a, "signup").receiptKey, normalizeImwebWire(b, "signup").receiptKey);
  b.eventTime += 1;
  assert.notEqual(normalizeImwebWire(a, "signup").receiptKey, normalizeImwebWire(b, "signup").receiptKey);
});
for (const field of ["eventType", "eventTime", "data"]) test(`wire rejects missing ${field}`, () => {
  const event: Record<string, unknown> = baseEvent(); delete event[field];
  assert.throws(() => normalizeImwebWire(event, "signup"));
});
for (const time of [NaN, Infinity, -1, 0, 1.5, "1000", null]) test(`wire rejects invalid time ${String(time)}`, () => {
  assert.throws(() => normalizeImwebWire({ ...baseEvent(), eventTime: time }, "signup"));
});
test("wrong site or unit is not saved, including valid-looking synthetic UIDs", () => {
  for (const data of [{ ...baseEvent().data, siteCode: "other" }, { ...baseEvent().data, unitCode: "other" }])
    assert.throws(() => normalizeImwebWire({ ...baseEvent(), data }, "signup"));
});
test("route and payload type must agree and inherited keys are rejected", () => {
  for (const route of ["constructor", "__proto__", "grade", "signup-bulk", "unknown"])
    assert.throws(() => normalizeImwebWire(baseEvent(), route));
});
test("unknown fields and malformed identities fail closed", () => {
  assert.throws(() => normalizeImwebWire({ ...baseEvent(), extra: "private" }, "signup"));
  for (const memberUid of [null, 123, "", "a b", "a\nb", "x".repeat(257)])
    assert.throws(() => normalizeImwebWire({ ...baseEvent(), data: { ...baseEvent().data, memberUid } }, "signup"));
});
test("bulk max fifty and exact list schema are enforced before dedupe", () => {
  const event = { ...baseEvent(), eventType: "END_USER_SIGN_UP_BULK", data: {
    siteCode: IMWEB_SITE, unitCode: IMWEB_UNIT, memberUidList: ["synthetic@example.invalid", "synthetic@example.invalid"] } };
  assert.deepEqual(normalizeImwebWire(event, "signup-bulk").memberUids, ["synthetic@example.invalid"]);
  for (const memberUidList of [[], null, Array(51).fill("synthetic@example.invalid")])
    assert.throws(() => normalizeImwebWire({ ...event, data: { ...event.data, memberUidList } }, "signup-bulk"));
});
test("grade payload accepts removal hints but cannot authorize removal", () => {
  const event = { ...baseEvent(), eventType: "END_USER_GRADE_UPDATE", data: { ...baseEvent().data, gradeCodes: [] } };
  assert.equal(normalizeImwebWire(event, "grade").grantsAllowed, false);
  assert.throws(() => normalizeImwebWire({ ...event, data: { ...event.data, gradeCodes: ["admin"] } }, "grade"));
});
test("only the actual provider sample identity is accepted as nonproduction", () => {
  const event = { ...baseEvent(), data: { siteCode: "S2025012450f7813d2ddau", unitCode: "u2025012465b0fbe8ce0dy", memberUid: "test_member@imweb.me" } };
  assert.equal(normalizeImwebWire(event, "signup").providerSample, true);
  assert.throws(() => normalizeImwebWire({ ...event, data: { ...event.data, memberUid: "other@imweb.me" } }, "signup"));
});
test("sample fixtures reject changed grades and duplicated bulk sample rows", () => {
  const sample = { siteCode: "S2025012450f7813d2ddau", unitCode: "u2025012465b0fbe8ce0dy" };
  const bulk = { ...baseEvent(), eventType: "END_USER_SIGN_UP_BULK", data: { ...sample,
    memberUidList: ["test_member1@imweb.me", "test_member2@imweb.me", "test_member3@imweb.me", "test_member1@imweb.me"] } };
  assert.throws(() => normalizeImwebWire(bulk, "signup-bulk"));
  const grade = { ...baseEvent(), eventType: "END_USER_GRADE_UPDATE", data: { ...sample, memberUid: "test_member@imweb.me", gradeCodes: [] } };
  assert.throws(() => normalizeImwebWire(grade, "grade"));
  assert.equal(normalizeImwebWire({ ...grade, data: { ...grade.data, gradeCodes: ["g20250124563854a652d54", "g20250124563844c752d51"] } }, "grade").providerSample, true);
});
