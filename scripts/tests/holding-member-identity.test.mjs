import test from "node:test";
import assert from "node:assert/strict";
import { holdingProfileNativeId, readHoldingMemberProfile } from "../lib/holding-member-identity.mjs";

const NATIVE_ID = "701";
const EXCEL_ID = "excel_synthetic_member_701";
const RESOLVED_AT = "2026-10-07T10:00:00.000Z";
const PROFILE_PATH = `memberProfiles/${EXCEL_ID}`;
const LOOKUP_PATH = `studiomateMemberIdLookupJobs/studiomate_member_id_lookup_${EXCEL_ID}`;
const nativeProfile = (patch = {}) => ({
  memberId: NATIVE_ID, studioId: "5330", name: "Synthetic Identity Member", phone: "01000000701", ...patch,
});
const linkedProfile = (patch = {}) => nativeProfile({
  memberId: EXCEL_ID, studiomateMemberId: NATIVE_ID, studiomateMemberIdResolvedAt: RESOLVED_AT, ...patch,
});
const lookupProof = (patch = {}) => ({
  jobId: `studiomate_member_id_lookup_${EXCEL_ID}`, memberId: EXCEL_ID, studioId: "5330",
  memberName: "Synthetic Identity Member", memberPhone: "01000000701", studiomateMemberId: NATIVE_ID,
  status: "done", resolvedAt: RESOLVED_AT, ...patch,
});

function memoryDb({ linked = true, profile = linkedProfile(), lookup = lookupProof() } = {}) {
  const docs = new Map(linked ? [[PROFILE_PATH, profile], [LOOKUP_PATH, lookup]] : []);
  const reads = [], writes = [];
  const denyWrite = (path, operation) => () => {
    writes.push({ path, operation });
    assert.fail(`identity reads must not ${operation} ${path}`);
  };
  const snapshot = path => ({
    id: path.split("/").at(-1), exists: docs.has(path), data: () => docs.get(path),
  });
  const get = async ref => {
    reads.push(ref);
    if (!ref.query) return snapshot(ref.path);
    assert.equal(ref.collection, "memberProfiles");
    assert.equal(ref.operator, "==");
    assert.equal(ref.n, 2, "identity ambiguity queries must be bounded to two records");
    const matches = [...docs].filter(([path, row]) => path.startsWith(`${ref.collection}/`) && row?.[ref.field] === ref.value)
      .slice(0, ref.n).map(([path]) => snapshot(path));
    return { size: matches.length, empty: matches.length === 0, docs: matches };
  };
  const document = path => ({
    path, id: path.split("/").at(-1), get() { return get(this); },
    ...Object.fromEntries(["set", "create", "update", "delete"].map(operation => [operation, denyWrite(path, operation)])),
  });
  const db = {
    docs, reads, writes,
    doc: document,
    collection: collection => ({
      doc: id => document(`${collection}/${id}`), add: denyWrite(collection, "add"),
      where: (field, operator, value) => ({ limit: n => ({
        query: true, collection, field, operator, value, n, get() { return get(this); },
      }) }),
    }),
    batch: denyWrite("database", "batch"), runTransaction: denyWrite("database", "runTransaction"),
  };
  return { db, reader: { get } };
}

async function assertBlocked(db, expected) {
  const before = [...db.docs];
  await assert.rejects(readHoldingMemberProfile({ db, memberId: NATIVE_ID }), expected);
  assert.deepEqual([...db.docs], before, "blocked resolution must preserve source records");
  assert.deepEqual(db.writes, []);
}

test("native identity stays authoritative and uses no fallback queries or lookup proof", async () => {
  const { db } = memoryDb();
  const original = nativeProfile({ isStaff: true, excludeFromAlimtalk: true });
  db.docs.set(`memberProfiles/${NATIVE_ID}`, original);
  assert.equal(holdingProfileNativeId(original), NATIVE_ID);
  assert.deepEqual(await readHoldingMemberProfile({ db, memberId: NATIVE_ID }), original);
  assert.deepEqual(db.reads.map(ref => ref.path), [`memberProfiles/${NATIVE_ID}`]);
  assert.deepEqual(db.writes, []);
});

test("a unique verified Excel pointer resolves in memory and preserves every exclusion and source field", async () => {
  const original = linkedProfile({ isStaff: true, excludeFromAlimtalk: true, alimtalkExcluded: true,
    exclusionReason: "Synthetic staff exclusion", tags: ["synthetic-staff"], source: "synthetic-excel" });
  const { db } = memoryDb({ profile: original });
  assert.equal(holdingProfileNativeId(original), NATIVE_ID);
  const result = await readHoldingMemberProfile({ db, memberId: NATIVE_ID });
  assert.deepEqual(result, { ...original, memberId: NATIVE_ID });
  assert.notEqual(result, original);
  assert.equal(original.memberId, EXCEL_ID);
  assert.equal(db.docs.has(`memberProfiles/${NATIVE_ID}`), false);
  assert.deepEqual(db.writes, []);
  assert.deepEqual(db.reads.filter(ref => ref.query).map(({ field, value, n }) => ({ field, value, n })), [
    { field: "studiomateMemberId", value: NATIVE_ID, n: 2 }, { field: "phone", value: original.phone, n: 2 },
  ]);
});

test("ISO and Timestamp resolution proofs compare by positive millisecond instant", async t => {
  const millis = Date.parse(RESOLVED_AT);
  for (const [label, profileTime, jobTime] of [
    ["ISO", RESOLVED_AT, RESOLVED_AT],
    ["Timestamp", { toMillis: () => millis }, { toMillis: () => millis }],
    ["Timestamp profile and ISO job", { toMillis: () => millis }, RESOLVED_AT],
    ["ISO profile and Timestamp job", RESOLVED_AT, { toMillis: () => millis }],
    ["same ISO instant with offset", "2026-10-07T19:00:00.000+09:00", RESOLVED_AT],
  ]) {
    await t.test(label, async () => {
      const original = linkedProfile({ studiomateMemberIdResolvedAt: profileTime });
      const { db } = memoryDb({ profile: original, lookup: lookupProof({ resolvedAt: jobTime }) });
      assert.equal(holdingProfileNativeId(original), NATIVE_ID);
      assert.deepEqual(await readHoldingMemberProfile({ db, memberId: NATIVE_ID }), { ...original, memberId: NATIVE_ID });
      assert.deepEqual(db.writes, []);
    });
  }
});

test("invalid input IDs never enter profile discovery", async t => {
  for (const memberId of [undefined, null, 701, "", "0", "0701", "-701", "701.0", "701 ", EXCEL_ID]) {
    await t.test(String(memberId), async () => {
      const { db } = memoryDb();
      await assert.rejects(readHoldingMemberProfile({ db, memberId }), /holding_native_member_id_required/);
      assert.deepEqual(db.reads, []);
      assert.deepEqual(db.writes, []);
    });
  }
});

test("unverified, malformed, merged or action-ineligible pointers are never discovery identities", async t => {
  for (const [label, patch] of [
    ["no pointer", { studiomateMemberId: undefined }],
    ["numeric pointer value", { studiomateMemberId: 701 }],
    ["zero pointer", { studiomateMemberId: "0" }],
    ["leading-zero pointer", { studiomateMemberId: "0701" }],
    ["fallback-shaped pointer", { studiomateMemberId: "excel_701" }],
    ["missing resolution", { studiomateMemberIdResolvedAt: undefined }],
    ["invalid resolution", { studiomateMemberIdResolvedAt: "invalid" }],
    ["non-ISO resolution", { studiomateMemberIdResolvedAt: "October 7, 2026 10:00:00 GMT" }],
    ["zero resolution", { studiomateMemberIdResolvedAt: { toMillis: () => 0 } }],
    ["negative resolution", { studiomateMemberIdResolvedAt: { toMillis: () => -1 } }],
    ["infinite resolution", { studiomateMemberIdResolvedAt: { toMillis: () => Infinity } }],
    ["fractional resolution", { studiomateMemberIdResolvedAt: { toMillis: () => 1.5 } }],
    ["numeric resolution", { studiomateMemberIdResolvedAt: Date.parse(RESOLVED_AT) }],
    ["wrong studio", { studioId: "9001" }],
    ["numeric studio", { studioId: 5330 }],
    ["empty name", { name: "" }],
    ["blank name", { name: "  " }],
    ["numeric name", { name: 701 }],
    ["empty phone", { phone: "" }],
    ["nonmobile phone", { phone: "0200000701" }],
    ["unnormalized local phone", { phone: "010-0000-0701" }],
    ["international phone", { phone: "+82 10 0000 0701" }],
    ["malformed Excel ID", { memberId: "excel_synthetic/member" }],
    ["uppercase Excel ID", { memberId: "excel_Synthetic_701" }],
    ["non-Excel ID", { memberId: "usage_member_701" }],
    ["merged target", { mergedInto: "702" }],
    ["canonical target", { canonicalMemberId: "702" }],
    ["merged status", { status: "merged" }],
    ["external actions disabled", { externalActionEligible: false }],
  ]) {
    await t.test(label, async () => {
      const original = linkedProfile(patch);
      assert.equal(holdingProfileNativeId(original), "");
      const { db } = memoryDb({ profile: original });
      await assertBlocked(db, /holding_verified_member_link_required|operator_member_changed/);
    });
  }
  for (const value of [null, undefined, {}, [], nativeProfile({ memberId: 701 }), nativeProfile({ memberId: "0" })]) {
    assert.equal(holdingProfileNativeId(value), "");
  }
});

test("Excel document ID and embedded member ID must be exactly equal and lowercase", async t => {
  for (const [label, docId, memberId] of [
    ["different embedded Excel ID", EXCEL_ID, "excel_other_701"],
    ["missing embedded ID", EXCEL_ID, undefined],
    ["non-Excel document ID", "synthetic_member_701", "synthetic_member_701"],
    ["uppercase document and embedded ID", "excel_Synthetic_701", "excel_Synthetic_701"],
  ]) {
    await t.test(label, async () => {
      const { db } = memoryDb({ linked: false });
      db.docs.set(`memberProfiles/${docId}`, linkedProfile({ memberId }));
      db.docs.set(`studiomateMemberIdLookupJobs/studiomate_member_id_lookup_${docId}`, lookupProof({ memberId }));
      await assertBlocked(db, /holding_verified_member_link_required/);
    });
  }
});

test("fresh lookup proof must match status, Excel identity, studio, name, exact phone, native ID and timestamp", async t => {
  for (const [label, patch] of [
    ["pending", { status: "pending" }], ["failed", { status: "failed" }], ["missing status", { status: undefined }],
    ["wrong Excel ID", { memberId: "excel_other_701" }], ["native instead of Excel ID", { memberId: NATIVE_ID }],
    ["wrong studio", { studioId: "9001" }], ["wrong name", { memberName: "Synthetic Other Member" }],
    ["name whitespace mismatch", { memberName: "Synthetic Identity Member " }],
    ["wrong phone", { memberPhone: "01000000702" }], ["same last four", { memberPhone: "01099990701" }],
    ["formatted phone", { memberPhone: "010-0000-0701" }], ["wrong native ID", { studiomateMemberId: "702" }],
    ["numeric native ID", { studiomateMemberId: 701 }], ["missing timestamp", { resolvedAt: undefined }],
    ["invalid timestamp", { resolvedAt: "invalid" }], ["non-ISO timestamp", { resolvedAt: "October 7, 2026 10:00:00 GMT" }],
    ["one millisecond mismatch", { resolvedAt: "2026-10-07T10:00:00.001Z" }],
    ["zero Timestamp", { resolvedAt: { toMillis: () => 0 } }],
  ]) {
    await t.test(label, async () => {
      const { db } = memoryDb({ lookup: lookupProof(patch) });
      await assertBlocked(db, /holding_member_lookup_proof_mismatch/);
    });
  }
  await t.test("lookup receipt missing at exact canonical job path", async () => {
    const { db } = memoryDb();
    db.docs.delete(LOOKUP_PATH);
    db.docs.set(`${LOOKUP_PATH}_other`, lookupProof());
    await assertBlocked(db, /holding_member_lookup_proof_mismatch/);
  });
});

test("zero or duplicate pointer matches and duplicate phone profiles fail closed", async t => {
  await t.test("no linked profile", async () => {
    const { db } = memoryDb({ linked: false });
    await assertBlocked(db, /operator_member_changed/);
  });
  for (const [label, extra] of [
    ["another valid pointer", linkedProfile({ memberId: "excel_synthetic_other_701", phone: "01000000702" })],
    ["another unverified pointer", linkedProfile({ memberId: "excel_synthetic_other_701", studiomateMemberIdResolvedAt: undefined })],
    ["same phone unresolved Excel", nativeProfile({ memberId: "excel_synthetic_other_701" })],
    ["same phone different native", nativeProfile({ memberId: "702" })],
    ["same phone wrong studio", nativeProfile({ memberId: "702", studioId: "9001" })],
  ]) {
    await t.test(label, async () => {
      const { db } = memoryDb();
      db.docs.set(`memberProfiles/${extra.memberId}`, extra);
      await assertBlocked(db, extra.studiomateMemberId === NATIVE_ID
        ? /holding_unique_linked_member_required/ : /holding_member_phone_ambiguity/);
    });
  }
  await t.test("same-phone query must return the linked document, not merely one other document", async () => {
    const { db, reader } = memoryDb();
    const originalGet = reader.get;
    reader.get = async ref => ref.query && ref.field === "phone"
      ? { size: 1, docs: [{ id: "excel_synthetic_other_701", data: () => linkedProfile() }] }
      : originalGet(ref);
    await assert.rejects(readHoldingMemberProfile({ db, memberId: NATIVE_ID, reader }), /holding_member_phone_ambiguity/);
    assert.deepEqual(db.writes, []);
  });
});

test("invalid direct native documents never fall back to an otherwise verified Excel link", async t => {
  for (const patch of [{ memberId: "702" }, { memberId: EXCEL_ID }, { memberId: undefined }, { studioId: "9001" }]) {
    await t.test(JSON.stringify(patch), async () => {
      const { db } = memoryDb();
      db.docs.set(`memberProfiles/${NATIVE_ID}`, nativeProfile(patch));
      await assertBlocked(db, /operator_member_changed/);
      assert.deepEqual(db.reads.map(ref => ref.path), [`memberProfiles/${NATIVE_ID}`]);
    });
  }
});

test("a provided transaction reader owns all document and bounded query reads", async () => {
  const { db, reader } = memoryDb();
  const defaultDoc = db.doc, defaultCollection = db.collection;
  db.doc = path => ({ ...defaultDoc(path), get: () => assert.fail("reader must own document read") });
  db.collection = name => {
    const original = defaultCollection(name);
    return { ...original, where: (...args) => {
      const query = original.where(...args);
      return { limit: n => ({ ...query.limit(n), get: () => assert.fail("reader must own query read") }) };
    } };
  };
  const result = await readHoldingMemberProfile({ db, memberId: NATIVE_ID, reader });
  assert.equal(result.memberId, NATIVE_ID);
  assert.equal(db.reads.length, 4);
  assert.deepEqual(db.writes, []);
});

test("a resolved pointer or receipt changed after discovery is rechecked through the preclaim reader", async t => {
  for (const [label, mutate] of [
    ["pointer changed", db => { db.docs.get(PROFILE_PATH).studiomateMemberId = "702"; }],
    ["receipt revoked", db => { db.docs.get(LOOKUP_PATH).status = "pending"; }],
    ["receipt time changed", db => { db.docs.get(LOOKUP_PATH).resolvedAt = "2026-10-07T10:00:00.001Z"; }],
    ["profile time changed", db => { db.docs.get(PROFILE_PATH).studiomateMemberIdResolvedAt = "2026-10-07T10:00:00.001Z"; }],
  ]) {
    await t.test(label, async () => {
      const { db, reader } = memoryDb();
      assert.equal((await readHoldingMemberProfile({ db, memberId: NATIVE_ID })).memberId, NATIVE_ID);
      mutate(db);
      const readsBefore = db.reads.length;
      await assert.rejects(readHoldingMemberProfile({ db, memberId: NATIVE_ID, reader }),
        /operator_member_changed|holding_member_lookup_proof_mismatch/);
      assert.ok(db.reads.length > readsBefore);
      assert.equal(db.docs.has(`memberProfiles/${NATIVE_ID}`), false);
      assert.deepEqual(db.writes, []);
    });
  }
});
