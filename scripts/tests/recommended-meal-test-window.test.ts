import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";

const root = new URL("../../firebase/kangsain-functions/functions/", import.meta.url);
const ts = createRequire(new URL("package.json", root))("typescript");
const compiled = new Map<string, string>();
function evaluate(file: string, dependencies: Record<string, any>, globals = {}): any {
  if (!compiled.has(file)) compiled.set(file, ts.transpileModule(readFileSync(new URL(`src/${file}.ts`, root), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText);
  const exports = {};
  vm.runInNewContext(compiled.get(file)!, {
    exports, Error, Buffer, process: { env: {} },
    require: (id: string) => {
      assert.ok(Object.hasOwn(dependencies, id), `Unmocked import forbidden: ${id}`);
      return dependencies[id];
    },
    ...globals,
  }, { timeout: 1000 });
  return exports;
}
const recipients = evaluate("alimtalk/testRecipients", {});
const templates = evaluate("alimtalk/templates", {
  "../memberSignup/membershipWelcomePolicy": { MEMBERSHIP_WELCOME_TEMPLATE: { templateId: "synthetic-welcome", name: "synthetic", channelId: "synthetic" } },
});
const target = recipients.primaryAlimtalkTestRecipient();
const TEMPLATE = templates.ALIMTALK_TEMPLATES.recommended_meal_survey.code;
const NOW = Date.parse("2026-10-29T14:30:00.000Z");
const plain = (value: any) => JSON.parse(JSON.stringify(value));

function fixture() {
  let clock = NOW;
  class Clock extends Date {
    constructor(value: any = clock) { super(value); }
    static now() { return clock; }
  }
  const normal = evaluate("memberSignup/memberDispatchWindow", {}, { Date: Clock });
  const values = new Map<string, any>();
  const reads: string[] = [];
  const writes: any[] = [];
  const clone = (value: any) => value === undefined ? undefined : structuredClone(value);
  let tail = Promise.resolve();
  const snapshot = (path: string) => {
    reads.push(path);
    return { exists: values.has(path), data: () => clone(values.get(path)) };
  };
  const db = {
    doc(path: string) { return { path, get: async () => snapshot(path) }; },
    async runTransaction(callback: any) {
      const previous = tail; let release!: () => void;
      tail = new Promise<void>(resolve => { release = resolve; });
      await previous;
      const pending: any[] = [];
      try {
        const result = await callback({
          get: async (ref: any) => { assert.equal(pending.length, 0); return snapshot(ref.path); },
          update: (ref: any, patch: any) => pending.push({ path: ref.path, patch }),
        });
        for (const write of pending) {
          assert.equal(write.path, api.MEAL_TEST_APPROVAL, "Only the once-only approval can be claimed");
          values.set(write.path, { ...values.get(write.path), ...write.patch }); writes.push(write);
        }
        return result;
      } finally { release(); }
    },
  };
  const api = evaluate("alimtalk/recommendedMealTestWindow", {
    "node:crypto": { createHash },
    "firebase-admin/firestore": { Timestamp: { now: () => "synthetic-claimed-at" } },
    "../config/firebase": { db },
    "../memberSignup/memberDispatchWindow": normal,
    "./testRecipients": recipients, "./templates": templates,
  }, { Date: Clock });
  const candidate: any = {
    candidateId: api.MEAL_TEST_CANDIDATE, memberId: target.memberId, memberName: target.name,
    memberPhone: target.phone, templateCode: TEMPLATE, type: "recommended_meal_survey",
    sourceActionKey: api.MEAL_TEST_REQUEST, queuedBy: "operator", reviewedByUid: "synthetic-human-reviewer",
    payload: { surveyId: api.MEAL_TEST_REQUEST, quietHoursTestCampaign: api.MEAL_TEST_CAMPAIGN },
    status: "processing", queueLeaseId: "synthetic-lease",
  };
  const approval: any = {
    approved: true, status: "approved", campaign: api.MEAL_TEST_CAMPAIGN, candidateId: api.MEAL_TEST_CANDIDATE,
    memberId: target.memberId, templateCode: TEMPLATE,
    phoneSha256: createHash("sha256").update(target.phone).digest("hex"),
    notBefore: new Date(NOW - 60000).toISOString(), expiresAt: new Date(NOW + 60000).toISOString(),
  };
  const save = () => {
    values.set(api.MEAL_TEST_APPROVAL, clone(approval));
    values.set(`alimtalkCandidates/${candidate.candidateId}`, clone(candidate));
    values.set(`recommendedMealProgramRequests/${api.MEAL_TEST_REQUEST}`, {
      status: "queued", memberId: target.memberId, memberPhone: target.phone,
      candidateId: candidate.candidateId, templateCode: candidate.templateCode,
    });
  };
  save();
  return { api, normal, candidate, approval, values, reads, writes, save, clock: (ms: number) => { clock = ms; } };
}

test("one-off constants and canonical native test identity are pinned", () => {
  const f = fixture();
  assert.equal(f.api.MEAL_TEST_CAMPAIGN, "meal-choice-test-20261029");
  assert.equal(f.api.MEAL_TEST_REQUEST, "meal-test-20261029-3minute-v2");
  assert.equal(f.api.MEAL_TEST_CANDIDATE, "meal-test-20261029-3minute-v2-invite");
  assert.equal(f.api.MEAL_TEST_APPROVAL, "systemSettings/recommendedMealTestWindow20261029");
  assert.equal(target.name, "김기효");
  assert.ok(!target.memberId.startsWith("excel_"));
  assert.equal(f.api.mealTestWindowApprovalValid(f.candidate, f.approval, NOW), true);
});

const candidateChanges: [string, (candidate: any) => void][] = [
  ...["candidateId", "memberId", "memberName", "memberPhone", "templateCode", "type", "sourceActionKey", "queuedBy", "reviewedByUid"].map(key =>
    [`missing ${key}`, (c: any) => { delete c[key]; }] as [string, (c: any) => void]),
  ...["candidateId", "memberId", "memberName", "memberPhone", "templateCode", "type", "sourceActionKey", "queuedBy"].map(key =>
    [`wrong ${key}`, (c: any) => { c[key] = "synthetic-other"; }] as [string, (c: any) => void]),
  ["Excel fallback identity", c => { c.memberId = `excel_${c.memberId}`; }],
  ["missing payload", c => { delete c.payload; }],
  ["wrong survey", c => { c.payload.surveyId = "meal-other"; }],
  ["missing survey", c => { delete c.payload.surveyId; }],
  ["wrong campaign", c => { c.payload.quietHoursTestCampaign = "other"; }],
  ["missing campaign", c => { delete c.payload.quietHoursTestCampaign; }],
];
for (const [name, change] of candidateChanges) {
  test(`exception rejects ${name}`, () => {
    const f = fixture(); change(f.candidate);
    assert.equal(f.api.mealTestWindowApprovalValid(f.candidate, f.approval, NOW), false);
  });
}
for (const key of ["approved", "campaign", "candidateId", "memberId", "templateCode", "phoneSha256", "notBefore", "expiresAt"]) {
  test(`approval requires exact ${key}`, () => {
    const f = fixture();
    for (const value of [undefined, null, false, "synthetic-wrong", {}, []]) {
      assert.equal(f.api.mealTestWindowApprovalValid(f.candidate, { ...f.approval, [key]: value }, NOW), false);
    }
  });
}

test("normalized domestic/international phone formats bind only to the canonical hash", () => {
  const f = fixture();
  for (const phone of [`${target.phone.slice(0, 3)}-${target.phone.slice(3, 7)}-${target.phone.slice(7)}`, `+82${target.phone.slice(1)}`]) {
    assert.equal(f.api.mealTestWindowApprovalValid({ ...f.candidate, memberPhone: phone }, f.approval, NOW), true);
  }
  assert.equal(f.api.mealTestWindowApprovalValid(f.candidate, { ...f.approval, phoneSha256: createHash("sha256").update("synthetic-other-phone").digest("hex") }, NOW), false);
});

test("approval interval is [from, expiry), at most 24 hours, and a finite clock is mandatory", () => {
  const f = fixture(); const from = Date.parse(f.approval.notBefore); const until = Date.parse(f.approval.expiresAt);
  for (const [now, expected] of [[from - 1, false], [from, true], [until - 1, true], [until, false], [NaN, false], [Infinity, false]] as const) {
    assert.equal(f.api.mealTestWindowApprovalValid(f.candidate, f.approval, now), expected);
  }
  assert.equal(f.api.mealTestWindowApprovalValid(f.candidate, { ...f.approval, notBefore: new Date(NOW).toISOString(), expiresAt: new Date(NOW + 86400000).toISOString() }, NOW), true);
  for (const expiresAt of [new Date(from).toISOString(), new Date(from - 1).toISOString(), new Date(from + 86400001).toISOString()]) {
    assert.equal(f.api.mealTestWindowApprovalValid(f.candidate, { ...f.approval, expiresAt }, NOW), false);
  }
});

test("missing, spent, malformed and ambiguous approvals cannot authorize a retry", () => {
  const f = fixture();
  for (const approval of [undefined, null, {}, { ...f.approval, attemptStartedAt: "unknown-transport" },
    { ...f.approval, attemptStartedAt: { seconds: 1 } }]) {
    assert.equal(f.api.mealTestWindowApprovalValid(f.candidate, approval, NOW), false);
  }
});

test("ordinary candidates preserve exact quiet-hour boundaries and never read approval state", async () => {
  const f = fixture(); const ordinary = { ...f.candidate, payload: {} };
  for (const [iso, allowed] of [["2026-10-28T23:59:59.999Z", false], ["2026-10-29T00:00:00.000Z", true],
    ["2026-10-29T13:59:59.999Z", true], ["2026-10-29T14:00:00.000Z", false]] as const) {
    f.clock(Date.parse(iso));
    assert.deepEqual(plain(await f.api.candidateDispatchWindow(ordinary)), plain(f.normal.memberDispatchWindow()));
    assert.equal((await f.api.candidateDispatchWindow(ordinary)).allowed, allowed);
    if (allowed) await f.api.assertCandidateDispatchAllowed(ordinary, true);
    else await assert.rejects(() => f.api.assertCandidateDispatchAllowed(ordinary, true), /member_dispatch_quiet_hours/);
  }
  assert.equal(f.reads.length, 0); assert.equal(f.writes.length, 0);
});

test("approved test opens only itself and validation alone does not consume approval", async () => {
  const f = fixture();
  assert.equal(f.normal.memberDispatchWindow().allowed, false);
  assert.equal((await f.api.candidateDispatchWindow(f.candidate)).reason, "approved_single_meal_test");
  await f.api.assertCandidateDispatchAllowed(f.candidate, false);
  assert.equal(f.writes.length, 0);
  assert.equal((await f.api.candidateDispatchWindow({ ...f.candidate, payload: {} })).allowed, false);
  f.values.delete(f.api.MEAL_TEST_APPROVAL);
  assert.equal((await f.api.candidateDispatchWindow(f.candidate)).allowed, false);
});

test("valid pretransport claim is durable and sequential/concurrent replay is denied", async () => {
  const f = fixture();
  const results = await Promise.allSettled([
    f.api.assertCandidateDispatchAllowed(f.candidate, true), f.api.assertCandidateDispatchAllowed(f.candidate, true),
  ]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.filter(r => r.status === "rejected").length, 1);
  assert.equal(f.writes.length, 1);
  assert.equal(f.values.get(f.api.MEAL_TEST_APPROVAL).status, "attempted_do_not_replay");
  assert.equal(f.values.get(f.api.MEAL_TEST_APPROVAL).queueLeaseId, "synthetic-lease");
  assert.equal((await f.api.candidateDispatchWindow(f.candidate)).allowed, false);
  await assert.rejects(() => f.api.assertCandidateDispatchAllowed(f.candidate, true));
});

for (const issue of ["missing source", "not processing", "changed lease", "missing lease", "existing send", "expired after precheck", "revoked after precheck"]) {
  test(`claim fails closed: ${issue}`, async () => {
    const f = fixture();
    await f.api.assertCandidateDispatchAllowed(f.candidate, false);
    const path = `alimtalkCandidates/${f.candidate.candidateId}`;
    if (issue === "missing source") f.values.delete(path);
    if (issue === "not processing") f.values.get(path).status = "queued";
    if (issue === "changed lease") f.values.get(path).queueLeaseId = "other-lease";
    if (issue === "missing lease") delete f.values.get(path).queueLeaseId;
    if (issue === "existing send") f.values.set(`alimtalkSends/${f.candidate.candidateId}`, { status: "unknown" });
    if (issue === "expired after precheck") f.clock(Date.parse(f.approval.expiresAt));
    if (issue === "revoked after precheck") f.values.get(f.api.MEAL_TEST_APPROVAL).approved = false;
    await assert.rejects(() => f.api.assertCandidateDispatchAllowed(f.candidate, true));
    assert.equal(f.writes.length, 0);
  });
}

test("claim revalidates canonical source identity, not just an unchanged lease", async () => {
  const f = fixture();
  f.values.get(`alimtalkCandidates/${f.candidate.candidateId}`).memberId = "synthetic-other-native-member";
  await assert.rejects(() => f.api.assertCandidateDispatchAllowed(f.candidate, true));
  assert.equal(f.writes.length, 0);
});

for (const [name, change] of candidateChanges) {
  test(`current source is revalidated inside consume transaction: ${name}`, async () => {
    const f = fixture();
    const current = f.values.get(`alimtalkCandidates/${f.candidate.candidateId}`);
    change(current);
    await assert.rejects(() => f.api.assertCandidateDispatchAllowed(f.candidate, true));
    assert.equal(f.writes.length, 0);
  });
}

for (const issue of ["missing request", "cancelled", "submitted", "sent", "wrong member", "wrong phone", "wrong candidate", "wrong template", "submittedAt", "cancelledAt"]) {
  test(`canonical request must still bind the queued invitation: ${issue}`, async () => {
    const f = fixture();
    const path = `recommendedMealProgramRequests/${f.api.MEAL_TEST_REQUEST}`;
    const request = f.values.get(path);
    if (issue === "missing request") f.values.delete(path);
    if (["cancelled", "submitted", "sent"].includes(issue)) request.status = issue;
    if (issue === "wrong member") request.memberId = "synthetic-other-native-member";
    if (issue === "wrong phone") request.memberPhone = "01000000000";
    if (issue === "wrong candidate") request.candidateId = "synthetic-other-candidate";
    if (issue === "wrong template") request.templateCode = "synthetic-other-template";
    if (issue === "submittedAt") request.submittedAt = "synthetic-submitted";
    if (issue === "cancelledAt") request.cancelledAt = "synthetic-cancelled";
    await assert.rejects(() => f.api.assertCandidateDispatchAllowed(f.candidate, true));
    assert.equal(f.writes.length, 0);
  });
}

test("canonical queued request accepts the same normalized phone and reads all guards before claim", async () => {
  const f = fixture();
  f.values.get(`recommendedMealProgramRequests/${f.api.MEAL_TEST_REQUEST}`).memberPhone = `+82${target.phone.slice(1)}`;
  await f.api.assertCandidateDispatchAllowed(f.candidate, true);
  assert.deepEqual(f.reads, [f.api.MEAL_TEST_APPROVAL, `alimtalkCandidates/${f.candidate.candidateId}`,
    `alimtalkSends/${f.candidate.candidateId}`, `recommendedMealProgramRequests/${f.api.MEAL_TEST_REQUEST}`]);
  assert.equal(f.writes.length, 1);
});

test("attempted status with missing timestamp still cannot be replayed", () => {
  const f = fixture();
  for (const status of [undefined, null, true, "", "revoked", "attempted_do_not_replay"]) {
    assert.equal(f.api.mealTestWindowApprovalValid(f.candidate, { ...f.approval, status }, NOW), false);
  }
});
