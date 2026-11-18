import { test } from "node:test";
import assert from "node:assert/strict";
import { assessStudioMateReferral, digest, executePointAction, phone, referralClaimKey } from "../lib/studiomate-referral-points.mjs";
import { parsePointSummary } from "../lib/studiomate-point-ui.mjs";
import { readExactStudioMateMember } from "../lib/studiomate-native-contract-source.mjs";

const now = Date.parse("2026-11-02T11:00:00Z");
const request = { newMemberName: "테스트 신규", newMemberPhone: "01000000001", referrerName: "테스트 추천", referrerPhone: "01000000002" };
const policy = { enabled: true, purchaseThresholdConfirmed: true, startsAt: "2026-11-02T00:00:00Z", rewardPoints: 20000, minimumPurchaseWon: 300000 };
const source = {
  live: true, complete: true, studioId: "5330", checkedAt: new Date(now).toISOString(),
  newcomer: { memberId: "1", name: request.newMemberName, phone: request.newMemberPhone, registeredAt: "2026-11-02T01:00:00Z", memberGrade: "일반회원" },
  referrer: { memberId: "2", name: request.referrerName, phone: request.referrerPhone, registeredAt: "2026-01-01T00:00:00Z" },
  purchase: { memberId: "1", userTicketId: "11", title: "그룹 50회권", firstQualifyingPurchase: true, cancelled: false, refunded: false, totalWon: 300000, paidWon: 300000, unpaidWon: 0, paidAt: "2026-11-02T02:00:00Z" },
};
const decide = patch => assessStudioMateReferral({ request, source, policy, now, ...patch });

test("explicit native unassigned grade qualifies without changing identity or lifetime duplicate key", async () => {
  const nativeMember = { id: 1, name: request.newMemberName, mobile: request.newMemberPhone,
    registered_at: "2026-11-02 10:00:00", user_grade: null };
  const read = await readExactStudioMateMember({ get: async path => path === "/staff/member/1"
    ? { member: nativeMember } : { members: [nativeMember] } }, request.newMemberPhone);
  const actual = { ...source, newcomer: read.member };
  assert.equal(actual.newcomer.memberGrade, undefined);
  assert.equal(decide({ source: actual }).eligible, true);
  assert.equal(decide({ source: actual }).claimKey, referralClaimKey("1"));
  for (const status of ["claimed", "dispatching", "review", "verified"])
    assert.equal(decide({ source: actual, existingClaim: { status } }).reason, "already_claimed");
  assert.equal(decide({ source: { ...actual, purchase: { ...actual.purchase, refunded: true } } }).eligible, false);
  assert.equal(decide({ source: { ...actual, purchase: { ...actual.purchase, paidWon: 299999 } } }).eligible, false);
});

test("missing, malformed, conflicting or untrusted grade observations do not authorize points", () => {
  for (const patch of [
    { memberGrade: undefined }, { memberGrade: "" }, { memberGrade: null },
    { memberGrade: 1 }, { memberGrade: "   " },
    { memberGrade: undefined, memberGradeReadback: { status: "unassigned" } },
    { memberGrade: undefined, memberGradeReadback: { source: "mirror", status: "unassigned" } },
    { memberGrade: undefined, memberGradeReadback: { source: "native_member_detail_user_grade_v1", status: "unverified" } },
    { memberGrade: "일반회원", memberGradeReadback: { source: "native_member_detail_user_grade_v1", status: "unverified" } },
    { memberGrade: "일반회원", memberGradeReadback: { source: "native_member_detail_user_grade_v1", status: "unassigned" } },
    { memberGradeReadback: "garbage" }, { memberGradeReadback: {} }, { memberGradeReadback: null },
    { memberGradeReadback: { source: "native_member_detail_user_grade_v1", status: "bogus" } },
    ...["UNKNOWN", "null", "undefined", "[object Object]"].map(memberGrade => ({ memberGrade })),
  ]) assert.equal(decide({ source: { ...source, newcomer: { ...source.newcomer, ...patch } } }).eligible, false);
});

test("trial, instructor and staff native grades remain excluded", async () => {
  for (const name of ["체험회원", "강사회원", "스텝", "스태프", "직원", "체 험 회 원", "강 사 회 원", "스 태 프"]) {
    const member = { id: 1, name: request.newMemberName, mobile: request.newMemberPhone,
      registered_at: "2026-11-02 10:00:00", user_grade: { name } };
    const read = await readExactStudioMateMember({ get: async path => path === "/staff/member/1"
      ? { member } : { members: [member] } }, request.newMemberPhone);
    assert.equal(decide({ source: { ...source, newcomer: read.member } }).eligible, false, name);
  }
});
test("native usage is displayed as a negative counter, not a negative balance", () => {
  assert.deepEqual(parsePointSummary("잔여 포인트\n100P\n적립 포인트\n20,100P\n사용 포인트\n-20,000P"),
    { remaining: 100, earned: 20100, used: 20000 });
  assert.throws(() => parsePointSummary("잔여 포인트\n-100P\n적립 포인트\n0P\n사용 포인트\n0P"));
  assert.throws(() => parsePointSummary("포인트 불러오는 중"));
});
test("StudioMate reward is 20,000; phone normalization is strict", () => {
  assert.equal(phone("010-0000-0001"), "01000000001"); assert.equal(phone("0001"), "");
  assert.equal(decide({}).amount, 20000);
  assert.equal(referralClaimKey("1"), decide({}).claimKey);
  assert.throws(() => referralClaimKey("excel_1")); assert.throws(() => referralClaimKey("1", "other"));
});
for (const [name, change] of [
  ["disabled", { enabled: false }], ["unconfirmed financial rule", { purchaseThresholdConfirmed: false }],
  ["wrong amount", { rewardPoints: 3000 }], ["wrong threshold", { minimumPurchaseWon: 0 }],
  ["missing rollout", { startsAt: null }],
]) test(`policy fails closed: ${name}`, () => assert.equal(decide({ policy: { ...policy, ...change } }).eligible, false));
for (const [name, change] of [
  ["partial", { complete: false }], ["snapshot", { live: false }], ["wrong studio", { studioId: "1" }],
  ["stale", { checkedAt: new Date(now - 120001).toISOString() }], ["future", { checkedAt: new Date(now + 1).toISOString() }],
]) test(`source fails closed: ${name}`, () => assert.equal(decide({ source: { ...source, ...change } }).eligible, false));
for (const [name, change] of [
  ["partial payment", { paidWon: 299999, unpaidWon: 1 }], ["under threshold", { paidWon: 299999, totalWon: 299999 }],
  ["cancelled", { cancelled: true }], ["refund", { refunded: true }], ["unknown refund", { refunded: undefined }],
  ["trial", { title: "체험 1회권" }], ["outdoor", { title: "야외 1회권" }], ["instructor", { title: "강사레슨" }],
  ["wrong member", { memberId: "9" }], ["not first", { firstQualifyingPurchase: false }],
]) test(`purchase excluded: ${name}`, () => assert.equal(decide({ source: { ...source, purchase: { ...source.purchase, ...change } } }).eligible, false));
test("changed referrer/policy/purchase cannot bypass existing native newcomer claim", () => {
  for (const status of ["claimed", "dispatching", "review", "verified"]) assert.equal(decide({ existingClaim: { status } }).reason, "already_claimed");
});
test("self referral, mismatched attribution and historical member rejected", () => {
  assert.equal(decide({ source: { ...source, referrer: { ...source.referrer, memberId: "1" } } }).reason, "self_referral");
  assert.equal(decide({ request: { ...request, referrerName: "다른사람" } }).eligible, false);
  assert.equal(decide({ source: { ...source, newcomer: { ...source.newcomer, registeredAt: "2026-11-01T00:00:00Z" } } }).eligible, false);
  assert.equal(decide({ source: { ...source, newcomer: { ...source.newcomer, memberGrade: undefined } } }).reason, "member_classification_unverified");
});

function fixture({ unknown = false, changed = false, noHistory = false, wrongIdentity = false } = {}) {
  const records = new Map(); let confirms = 0;
  const target = { memberId: "2", name: "테스트 추천", phone: "01000000002" };
  let state = { ...target, remaining: 100, earned: 100, used: 0, history: [] };
  const ledger = {
    get: async key => records.get(key),
    async claim(key, row) { if (records.has(key)) return false; records.set(key, structuredClone(row)); return true; },
    async update(key, patch) { Object.assign(records.get(key), patch); },
  };
  const native = {
    read: async () => structuredClone({ ...state, ...(wrongIdentity ? { memberId: "9" } : {}) }),
    prepare: async () => { if (changed) state.remaining++; },
    readCurrent: async () => structuredClone(state),
    async confirm(_, action, gate) {
      await gate();
      confirms++; if (unknown) throw new Error("unknown_transport");
      state.remaining += action.direction === "credit" ? action.points : -action.points;
      state.earned += action.direction === "credit" ? action.points : 0;
      state.used += action.direction === "debit" ? action.points : 0;
      if (!noHistory) state.history.push({ reason: action.reason });
    }, cancel: async () => {},
  };
  const action = { key: digest(["test", "credit"]), direction: "credit", points: 20000, reason: "TEST_REFERRAL_A" };
  return { records, target, ledger, native, action, confirms: () => confirms };
}
test("preserve baseline; real delta, native history and duplicate suppression required", async () => {
  const f = fixture();
  const a = await executePointAction(f); assert.equal(a.after, 20100);
  assert.equal((await executePointAction(f)).status, "duplicate"); assert.equal(f.confirms(), 1);
  const reverse = { ...f.action, key: digest(["test", "debit"]), direction: "debit", reason: "TEST_REFERRAL_R" };
  assert.equal((await executePointAction({ ...f, action: reverse })).after, 100);
});
test("parallel workers share one atomic claim", async () => {
  const f = fixture(); const results = await Promise.all([executePointAction(f), executePointAction(f)]);
  assert.equal(results.filter(r => r.status === "verified").length, 1); assert.equal(f.confirms(), 1);
});
for (const fault of ["unknown", "changed", "noHistory", "wrongIdentity"]) test(`stop safely: ${fault}`, async () => {
  const f = fixture({ [fault]: true }); await assert.rejects(executePointAction(f));
  if (fault === "wrongIdentity") assert.equal(f.records.size, 0);
  else { assert.equal((await executePointAction(f)).status, "duplicate"); assert.equal(f.records.get(f.action.key).status, "review"); }
});
test("fresh source must pass twice; stale approval never dispatches", async () => {
  const f = fixture(); let times = 0;
  await assert.rejects(executePointAction({ ...f, revalidate: async () => ++times < 2 })); assert.equal(f.confirms(), 0);
});
test("unassigned grade evidence lost at the final gate blocks confirmation and retains the claim", async () => {
  const f = fixture(); let reads = 0;
  await assert.rejects(executePointAction({ ...f, revalidate: async () => {
    const current = { ...source, newcomer: { ...source.newcomer, memberGrade: undefined,
      ...(++reads === 1 ? { memberGradeReadback: { source: "native_member_detail_user_grade_v1", status: "unassigned" } } : {}) } };
    return decide({ source: current }).eligible;
  } }), /source_changed_before_dispatch/);
  assert.equal(f.confirms(), 0);
  assert.equal(f.records.get(f.action.key).status, "review");
  assert.equal((await executePointAction(f)).status, "duplicate");
});
test("final gate runs after slow browser confirmation preparation and can stop a newly disabled policy", async () => {
  const f = fixture(); let enabled = true;
  const confirm = f.native.confirm;
  f.native.confirm = async (...args) => { enabled = false; return confirm(...args); };
  await assert.rejects(executePointAction({ ...f, revalidate: async () => enabled }), /source_changed/);
  assert.equal(f.confirms(), 0); assert.equal(f.records.get(f.action.key).status, "review");
});
