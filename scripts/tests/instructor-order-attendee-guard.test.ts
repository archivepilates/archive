import assert from "node:assert/strict";
import test from "node:test";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { createInstructorOrderAttendeeResolution } from "../lib/imweb-instructor-order-policy.mjs";

const root = new URL("../../firebase/kangsain-functions/functions/", import.meta.url);
const ts = createRequire(new URL("package.json", root))("typescript");
const NOW = "2026-10-27T01:00:00.000Z";
const ORDER = "209901010000001";
const DATE = "2099-11-28";
const LEDGER = `imwebInstructorLessonOrders/imweb_${ORDER}`;
const clone = <T>(value: T): T => value === undefined ? value : structuredClone(value);
const fail = (name: string): never => { throw new Error(`Unmocked operation: ${name}`); };
const compiled = new Map<string, string>();

function evaluate(file: string, dependencies: Record<string, any>, globals: Record<string, any> = {}) {
  if (!compiled.has(file)) compiled.set(file, ts.transpileModule(readFileSync(new URL(`src/${file}.ts`, root), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText);
  const exports: any = {};
  vm.runInNewContext(compiled.get(file)!, {
    exports, Error, URL, AbortSignal, Intl,
    require: (id: string) => Object.hasOwn(dependencies, id) ? dependencies[id] : fail(`import ${id}`),
    ...globals,
  });
  return exports;
}

function fixture(quantity = 2) {
  const attendees = Array.from({ length: quantity }, (_, i) => ({
    memberName: `Synthetic ${i + 1}`, memberPhone: `0100000${String(i + 1).padStart(4, "0")}`, paidAmount: 70000,
  }));
  const order = {
    orderNo: ORDER, ordererName: attendees[0].memberName, ordererCall: attendees[0].memberPhone,
    isGift: "N", currency: "KRW", saleChannel: "IMWEB", orderType: "SHOPPING", orderStatus: "OPEN",
    totalPaymentPrice: quantity * 70000, totalDeliveryPrice: 0, totalPoint: 0,
    totalRefundPendingPrice: 0, totalRefundedPrice: 0, totalRefundPendingPoint: 0, totalRefundedPoint: 0,
    payments: [{ paymentStatus: "PAYMENT_COMPLETE", isCancel: "N", method: "CARD",
      paidPrice: quantity * 70000, paymentCompleteTime: "2026-10-26T01:00:00.000Z" }],
    sections: [{ orderSectionStatus: "SHIPPING_READY", returnInfo: { isRefund: "N", isExchange: "N" },
      sectionItems: [{ orderSectionItemNo: `${ORDER}-1`, qty: quantity, productInfo: {
        prodNo: 1, prodName: "[오프라인] ARCHIVE METHOD 강사레슨", optionInfo: { 수강일: "2099년 11월 28일" },
      } }] }],
  };
  const manifest = createInstructorOrderAttendeeResolution(order, attendees, {
    actor: "synthetic-operator", basis: "synthetic identity approval", now: new Date(NOW),
  });
  const registrations = manifest.attendees.map((a: any, i: number) => ({
    registrationId: a.registrationId, studioId: "5330", memberName: a.memberName, memberPhone: a.memberPhone,
    lessonDate: DATE, ticketName: "강사레슨 (2T)", ticketPrice: 70000, status: "processing", mode: "returning_member",
    source: { type: "imweb_paid_order", sourceId: ORDER, itemNo: manifest.itemNo },
    externalOrder: { ...a, orderNo: ORDER, itemNo: manifest.itemNo, lessonDate: DATE,
      totalPaidAmount: quantity * 70000, quantity, attendeeResolutionKey: manifest.resolutionKey },
    orderAllocation: { resolutionKey: manifest.resolutionKey },
    operatorChecks: { paymentConfirmed: true, seatConfirmed: true },
    evidence: { studiomateMemberId: `member-${i}`, ticketId: `ticket-${i}` },
    steps: { member: { status: "verified" }, ticket: { status: "verified" },
      eformsign: { status: "not_required" }, memo: { status: "not_required" }, bookings: { status: "pending" } },
  }));
  return { manifest, registrations, ledger: { orderNo: ORDER, itemNo: manifest.itemNo, status: "queued",
    fingerprint: manifest.sourceFingerprint, paymentAmount: quantity * 70000, attendeeResolution: manifest,
    registrationIds: registrations.map((r: any) => r.registrationId) } };
}

function harness(quantity = 2) {
  const f = fixture(quantity);
  const values = new Map<string, any>();
  const reads: string[] = [], writes: string[] = [], posts: any[] = [];
  const versions = new Map<string, number>();
  let clock = Date.parse(NOW), beforeCommit: (() => void) | undefined, beforeProvider: (() => void) | undefined;
  let readFailure = "", preflightThrow = false, providerThrow: (() => Error) | undefined;
  const seed = (path: string, value: any) => {
    if (value === undefined) values.delete(path); else values.set(path, clone(value));
    versions.set(path, (versions.get(path) || 0) + 1);
  };
  const get = (path: string) => clone(values.get(path));
  const set = (ref: any, value: any, options?: any) => {
    assert.ok(/^(instructorLessonRegistrations|alimtalkCandidates|alimtalkSends)\/[^/]+$/.test(ref.path));
    seed(ref.path, options?.merge ? { ...get(ref.path), ...clone(value) } : value);
    writes.push(ref.path);
  };
  const snap = (path: string) => {
    reads.push(path);
    assert.ok(path === LEDGER || /^(instructorLessonRegistrations|alimtalkCandidates|alimtalkSends)\/[^/]+$/.test(path));
    if (readFailure && path.startsWith(readFailure)) throw new Error("private raw failure must not escape");
    const data = get(path);
    return { exists: data !== undefined, id: path.split("/").at(-1), ref: doc(path), data: () => clone(data) };
  };
  const doc = (path: string): any => ({ path, get: async () => snap(path),
    set: async (value: any, options: any) => set({ path }, value, options) });
  const collection = (name: string): any => ({ doc: (id: string) => doc(`${name}/${id}`),
    where: () => collection(name) });
  const db = { doc, collection, runTransaction: async (callback: any) => {
    for (let retry = 0; retry < 4; retry++) {
      const observed = new Map<string, number>(), pending: any[] = [];
      const result = await callback({ get: async (ref: any) => {
        assert.equal(pending.length, 0, "all transaction reads must precede writes");
        const result = snap(ref.path); observed.set(ref.path, versions.get(ref.path) || 0); return result;
      }, set: (ref: any, value: any, options: any) => pending.push([ref, value, options]),
      update: (ref: any, value: any) => pending.push([ref, value, { merge: true }]) });
      const hook = beforeCommit; beforeCommit = undefined; hook?.();
      if ([...observed].some(([path, version]) => (versions.get(path) || 0) !== version)) continue;
      for (const args of pending) set(args[0], args[1], args[2]);
      return result;
    }
    throw new Error("synthetic transaction retry exhausted");
  } };
  seed(LEDGER, f.ledger);
  for (const r of f.registrations) seed(`instructorLessonRegistrations/${r.registrationId}`, r);
  class Clock extends Date {
    constructor(...args: any[]) { super(args.length ? args[0] : clock); }
    static now() { return clock; }
  }
  const crypto = { createHash, createHmac, randomBytes };
  const hash = evaluate("utils/hash", { "node:crypto": crypto });
  const state = evaluate("instructorLessonRegistration/instructorLessonRegistrationState", {});
  const cancellation = evaluate("instructorLessonRegistration/instructorLessonCancellationPolicy", {
    "node:crypto": crypto, "../utils/errors": { AppError: Error },
  });
  const window = evaluate("memberSignup/memberDispatchWindow", {}, { Date: Clock });
  const refs = { alimtalkCandidate: (id: string) => doc(`alimtalkCandidates/${id}`),
    alimtalkSend: (id: string) => doc(`alimtalkSends/${id}`), alimtalkCandidates: () => collection("alimtalkCandidates") };
  const schedule = { lessonDate: DATE, managementNumber: "synthetic-991128", lessonDateText: "Synthetic date",
    lessonTimeText: "13:00~15:10", lessonComposition: "Synthetic classes", calendarUrl: "https://synthetic.invalid/calendar/",
    icsUrl: "https://synthetic.invalid/calendar/file.ics", icsStart: "20991128T040000Z", icsEnd: "20991128T061000Z" };
  const confirmation = evaluate("instructorLessonRegistration/instructorLessonConfirmation", {
    "node:crypto": crypto, "../config/firebase": { db }, "../firestore/refs": { refs },
    "../security/authGuards": { requireManager: () => fail("manager"), requireStaff: () => fail("staff") },
    "../utils/date": { nowTimestamp: () => ({ millis: clock }), todayKst: () => "2026-10-27" },
    "../utils/errors": { AppError: Error }, "../utils/hash": hash,
    "../alimtalk/templates": { ALIMTALK_TEMPLATES: { instructor_lesson_confirmation: { code: "SYNTHETIC" } },
      ALIMTALK_MEMBER_EXCLUSION_REASONS: {} },
    "../alimtalk/testRecipients": { hasExplicitAlimtalkTestOverride: () => false, isAlimtalkTestRecipient: () => false },
    "./instructorLessonRegistration": { instructorLessonRegistrationId: (studio: string, phone: string, date: string) =>
      `ilr_${createHash("sha256").update(`${studio}|${phone}|${date}`).digest("hex").slice(0, 24)}` },
    "./instructorLessonRegistrationState": state, "./instructorLessonCancellationPolicy": cancellation,
    "./instructorLessonNotionSchedule": { resolveNotionLessonSchedule: async () => schedule },
  }, { Date: Clock, fetch: async () => ({ ok: true, text: async () =>
    `BEGIN:VCALENDAR\nDTSTART:${schedule.icsStart}\nDTEND:${schedule.icsEnd}\nLOCATION:ARCHIVE PILATES 명지` }) });
  const candidateId = confirmation.instructorLessonConfirmationCandidateId({ phone: f.registrations[0].memberPhone,
    lessonDate: DATE, managementNumber: schedule.managementNumber });
  const candidatePath = `alimtalkCandidates/${candidateId}`;
  const regPath = `instructorLessonRegistrations/${f.registrations[0].registrationId}`;
  const siblingPath = `instructorLessonRegistrations/${f.registrations[1].registrationId}`;
  const candidate = { candidateId, studioId: "5330", memberId: f.registrations[0].evidence.studiomateMemberId,
    memberName: f.registrations[0].memberName, memberPhone: f.registrations[0].memberPhone,
    type: "instructor_lesson_confirmation", templateCode: "SYNTHETIC", status: "queued", attempts: 0, maxAttempts: 2,
    payload: { registrationId: f.registrations[0].registrationId, memberName: f.registrations[0].memberName,
      lessonDate: DATE, ...schedule, ticketId: f.registrations[0].evidence.ticketId,
      attendeeResolutionKey: f.manifest.resolutionKey } };
  seed(candidatePath, candidate);
  const dependencies: Record<string, any> = {
    "node:crypto": crypto, "firebase-functions": { logger: { error: () => {}, warn: () => {}, info: () => {} } },
    "../config/firebase": { db }, "../config/secrets": { solapiApiKey: { value: () => "synthetic" },
      solapiApiSecret: { value: () => "synthetic" }, solapiPfid: { value: () => "synthetic" } },
    "../firestore/refs": { refs }, "../utils/errors": { errorMessage: (e: Error) => e.message }, "../utils/hash": hash,
    "../utils/date": { nowTimestamp: () => ({ millis: clock }), todayKst: () => "2026-10-27" },
    "../utils/shortLinks": { ensureShortLink: () => fail("short link") },
    "./memberDispatchRequests": { assertMemberDispatchRequestAllowed: async () => {
      const hook = beforeProvider; beforeProvider = undefined; hook?.();
    }, MemberDispatchRequestBlockedError: class extends Error {}, reconcileQueuedMemberDispatchRequests: async () => {} },
    "../memberSignup/memberDispatchWindow": window,
    "./holdingNoticeRuntime": { reconcileHoldingNoticeQueue: async () => {} }, "./holdingNoticeScheduling": {},
    "./holdingQueueSelection": { selectHoldingQueueCandidates: async () => [snap(candidatePath)] },
    "./holdingNoticeQueue": { isHoldingNoticeCandidate: () => false },
    "../memberSignup/membershipWelcomeRuntime": { reconcileMembershipWelcomeQueue: async () => {} },
    "../memberSignup/membershipWelcomePolicy": { MEMBERSHIP_WELCOME_TEMPLATE: { templateId: "OTHER" } },
    "../memberSignup/membershipWelcomeQueue": { isMembershipWelcomeCandidate: () => false, MembershipWelcomePreflightError: class extends Error {} },
    "../memberSignup/membershipWelcomeReadback": {},
    "./templates": { ALIMTALK_TEMPLATE_CHANNEL_IDS: {}, alimtalkDedupePolicy: () => ({ windowDays: 365, label: "synthetic" }) },
    "./eligibility": { isRetryableTemplateStatusIssue: () => false },
    "./dedupe": { normalizePhone: (value: string) => value.replace(/\D/g, ""), alimtalkDedupeKey: () => "synthetic" },
    "./targetValidationChecks": { targetEligibilityIssue: async () => "", targetDuplicateIssue: async () => "",
      privateSurveySendabilityIssue: async () => "", renewalCandidateSendabilityIssue: async () => "",
      longAbsenceCandidateSendabilityIssue: async () => "",
      instructorLessonConfirmationSendabilityIssue: confirmation.instructorLessonConfirmationSendabilityIssue },
    "./templateStatus": { isAlimtalkTemplateApproved: async () => true },
    "./instructorLessonManagement": { normalizeInstructorLessonManagementNumber: (s: string) => s },
    "./instructorLessonDeliveryGuard": { genericInstructorLessonQueueBlock: () => null },
    "./testRecipients": { hasExplicitAlimtalkTestOverride: () => false },
    "../privateLessonChart/privateLessonReportRevision": {}, "./ticketNoticePolicy": { TICKET_NOTICE_POLICY: { pendingReason: "pending" } },
    "./approvalStore": { alimtalkApprovalClaimIssue: async () => "" },
    "../mealPlan/recommendedMealProgram": {}, "../mealPlan/recommendedMealSurvey": {},
    "../instructorLessonRegistration/instructorLessonConfirmation": { ...confirmation,
      instructorLessonConfirmationAllocationSendabilityIssue: async (c: any) => {
        if (preflightThrow) throw new Error("private connection details");
        return confirmation.instructorLessonConfirmationAllocationSendabilityIssue(c);
      } },
  };
  const runtime = evaluate("alimtalk/processAlimtalkQueue", dependencies, { Date: Clock, fetch: async (url: string, options: any) => {
    assert.equal(url, "https://api.solapi.com/messages/v4/send-many/detail");
    posts.push(JSON.parse(options.body));
    if (providerThrow) throw providerThrow();
    return { ok: true, json: async () => ({ messageList: [{ messageId: "synthetic-message" }] }) };
  } });
  return { ...f, confirmation, runtime, seed, get, reads, writes, posts, candidate, candidatePath, regPath, siblingPath,
    guard: () => confirmation.instructorOrderAttendeeGuard(f.registrations[0].registrationId, get(regPath), async (path: string) => get(path) || null),
    run: (batch = false) => batch ? runtime.processAlimtalkQueue() : runtime.processAlimtalkCandidate(candidateId),
    at: (at: string) => { clock = Date.parse(at); }, conflict: (hook: () => void) => { beforeCommit = hook; },
    beforeProvider: (hook: () => void) => { beforeProvider = hook; }, readFailure: (path: string) => { readFailure = path; },
    preflightThrow: () => { preflightThrow = true; }, providerThrow: (hook: () => Error) => { providerThrow = hook; } };
}

const absentTicketId = Symbol("absent ticket ID");
const emptyTicketIds: Array<[string, unknown]> = [
  ["absent", absentTicketId], ["undefined", undefined], ["empty", ""],
  ["whitespace", " \t\n "], ["null", null], ["numeric zero", 0],
];
function setTicketId(target: Record<string, any>, value: unknown) {
  if (value === absentTicketId) delete target.ticketId;
  else target.ticketId = value;
}
function followupAttention(f: ReturnType<typeof harness>, path: string, step = "confirmation", status = "review_required") {
  const registration = f.get(path);
  registration.status = "action_required";
  registration.steps[step] = { status, detail: "Synthetic follow-up attention only" };
  f.seed(path, registration);
}

for (const quantity of [2, 3, 10]) test(`canonical policy manifest agrees with Functions for ${quantity} attendees`, async () => {
  const f = harness(quantity);
  assert.equal((await f.guard()).issue, "");
  assert.equal((await f.guard()).resolutionKey, f.manifest.resolutionKey);
  f.seed(f.siblingPath, { ...f.get(f.siblingPath), steps: { ticket: { status: "pending" } } });
  assert.equal((await f.guard()).issue, "", "sibling ticket issuance is not a family prerequisite");
});

const mutations: Array<[string, (f: ReturnType<typeof harness>) => void]> = [
  ["manifest removed", f => { const l = f.get(LEDGER); delete l.attendeeResolution; f.seed(LEDGER, l); }],
  ["manifest unapproved", f => { const l = f.get(LEDGER); l.attendeeResolution.status = "blocked"; f.seed(LEDGER, l); }],
  ["manifest key changed", f => { const l = f.get(LEDGER); l.attendeeResolution.resolutionKey = "0".repeat(64); f.seed(LEDGER, l); }],
  ["manifest policy changed", f => { const l = f.get(LEDGER); l.attendeeResolution.policy = "other"; f.seed(LEDGER, l); }],
  ["manifest version changed", f => { const l = f.get(LEDGER); l.attendeeResolution.version = 2; f.seed(LEDGER, l); }],
  ["fingerprint changed", f => { f.seed(LEDGER, { ...f.get(LEDGER), fingerprint: "0".repeat(64) }); }],
  ["ledger held", f => { f.seed(LEDGER, { ...f.get(LEDGER), status: "review_required" }); }],
  ["total changed", f => { f.seed(LEDGER, { ...f.get(LEDGER), paymentAmount: 70000 }); }],
  ["extra ledger registration", f => { f.seed(LEDGER, { ...f.get(LEDGER), registrationIds: [...f.ledger.registrationIds, "ilr_extra"] }); }],
  ["sibling missing", f => f.seed(f.siblingPath, undefined)],
  ...["externalOrderReviewRequired", "cancellation_pending", "cancellation_review", "cancelled", "canceled"].map(name =>
    [name, (f: ReturnType<typeof harness>) => f.seed(f.siblingPath, { ...f.get(f.siblingPath),
      ...(name === "externalOrderReviewRequired" ? { externalOrderReviewRequired: true } : { status: name }) })] as [string, (f: ReturnType<typeof harness>) => void]),
  ["sibling cancellation job", f => f.seed(f.siblingPath, { ...f.get(f.siblingPath), cancellation: { jobId: "synthetic" } })],
  ["sibling name", f => f.seed(f.siblingPath, { ...f.get(f.siblingPath), memberName: "Another person" })],
  ["sibling phone", f => f.seed(f.siblingPath, { ...f.get(f.siblingPath), memberPhone: "01099999999" })],
  ["sibling studio", f => f.seed(f.siblingPath, { ...f.get(f.siblingPath), studioId: "other" })],
  ["sibling date", f => f.seed(f.siblingPath, { ...f.get(f.siblingPath), lessonDate: "2099-11-29" })],
  ["sibling ticket amount", f => f.seed(f.siblingPath, { ...f.get(f.siblingPath), ticketPrice: 140000 })],
  ["sibling external amount", f => { const r = f.get(f.siblingPath); r.externalOrder.paidAmount = 140000; f.seed(f.siblingPath, r); }],
  ["sibling key", f => { const r = f.get(f.siblingPath); delete r.externalOrder.attendeeResolutionKey; f.seed(f.siblingPath, r); }],
];
for (const [name, change] of mutations) test(`family guard rejects ${name}`, async () => {
  const f = harness(); change(f); assert.ok((await f.guard()).issue); assert.equal(f.writes.length, 0);
});

for (const target of ["own", "sibling"] as const) {
  const blockers: Array<[string, (r: any) => void]> = [
    ["unexplained action_required", r => { r.steps.confirmation = { status: "pending" }; }],
    ["unknown follow-up status", r => { r.steps.confirmation = { status: "unknown" }; }],
    ["unrelated bookings failure", r => { r.steps.confirmation = { status: "pending" }; r.steps.bookings = { status: "failed" }; }],
    ...["review_required", "failed", "rejected"].map(status =>
      [`registration ${status}`, (r: any) => { r.status = status; }] as [string, (r: any) => void]),
    ...["member", "ticket"].flatMap(step => ["failed", "review_required", "pending", "missing"].map(status =>
      [`${step} ${status}`, (r: any) => { if (status === "missing") delete r.steps[step]; else r.steps[step] = { status }; }] as [string, (r: any) => void])),
    ["payment approval missing", r => { delete r.operatorChecks.paymentConfirmed; }],
    ["seat approval revoked", r => { r.operatorChecks.seatConfirmed = false; }],
    ["source identity changed", r => { r.source.sourceId = "209901010000002"; }],
    ["external identity changed", r => { r.externalOrder.registrationId = "ilr_wrong"; }],
    ["allocation approval changed", r => { r.orderAllocation.resolutionKey = "0".repeat(64); }],
  ];
  for (const [name, change] of blockers) test(`${target} follow-up attention cannot bypass ${name}`, async () => {
    const f = harness(), path = target === "own" ? f.regPath : f.siblingPath;
    followupAttention(f, path);
    const registration = f.get(path); change(registration); f.seed(path, registration);
    assert.ok((await f.guard()).issue);
    await assert.rejects(f.confirmation.queueInstructorLessonConfirmationForIssuedTicket(
      f.registrations[0].registrationId, { source: "ticket_verified_trigger" }));
    assert.equal(f.writes.length, 0); assert.equal(f.posts.length, 0);
  });
}

test("missing allocation key never falls back even after local allocation markers are stripped", async () => {
  const f = harness(), r = f.get(f.regPath);
  delete r.externalOrder.attendeeResolutionKey; delete r.externalOrder.quantity;
  delete r.externalOrder.totalPaidAmount; delete r.orderAllocation;
  f.seed(f.regPath, r);
  assert.ok((await f.guard()).issue);
});

test("queue transaction pins actual recipient and allocation key; preserves candidate dedupe ID", async () => {
  const f = harness(); f.seed(f.candidatePath, undefined);
  const result = await f.confirmation.queueInstructorLessonConfirmationForIssuedTicket(f.registrations[0].registrationId, { source: "ticket_verified_trigger" });
  assert.equal(result.candidateId, f.candidate.candidateId);
  const candidate = f.get(f.candidatePath);
  assert.equal(candidate.payload.attendeeResolutionKey, f.manifest.resolutionKey);
  assert.equal(candidate.memberName, f.registrations[0].memberName);
  assert.equal(candidate.memberPhone, f.registrations[0].memberPhone);
});

test("queue transaction rechecks sibling after a commit conflict, without writing a candidate", async () => {
  const f = harness(); f.seed(f.candidatePath, undefined);
  f.conflict(() => f.seed(f.siblingPath, { ...f.get(f.siblingPath), externalOrderReviewRequired: true }));
  await assert.rejects(f.confirmation.queueInstructorLessonConfirmationForIssuedTicket(f.registrations[0].registrationId, { source: "ticket_verified_trigger" }));
  assert.equal(f.get(f.candidatePath), undefined); assert.equal(f.writes.length, 0);
});

for (const key of ["memberName", "memberPhone", "studioId", "memberId", "payloadName", "payloadKey", "ticketId"]) {
  test(`sendability rejects allocated candidate ${key} mismatch`, async () => {
    const f = harness(), c = clone(f.candidate);
    if (key === "payloadName") c.payload.memberName = "wrong";
    else if (key === "payloadKey") delete c.payload.attendeeResolutionKey;
    else if (key === "ticketId") c.payload.ticketId = "wrong";
    else (c as any)[key] = "wrong";
    assert.ok(await f.confirmation.instructorLessonConfirmationSendabilityIssue(c));
  });
}

for (const [candidateLabel, candidateId] of emptyTicketIds.slice(0, 3)) {
  for (const [evidenceLabel, evidenceId] of emptyTicketIds.slice(0, 3)) {
    test(`sendability normalizes absent IDs: candidate ${candidateLabel}, evidence ${evidenceLabel}`, async () => {
      const f = harness(), registration = f.get(f.regPath), candidate = clone(f.candidate);
      setTicketId(registration.evidence, evidenceId); setTicketId(candidate.payload, candidateId);
      f.seed(f.regPath, registration);
      assert.equal(await f.confirmation.instructorLessonConfirmationSendabilityIssue(candidate), "");
      assert.equal(f.writes.length, 0); assert.equal(f.posts.length, 0);
    });
  }
}

for (const batch of [false, true]) {
  const label = batch ? "batch" : "single";
  for (const [kind, ticketId] of emptyTicketIds) {
    test(`${label}: real queue normalizes ${kind} ticket evidence and mocked provider accepts only once`, async () => {
      const f = harness(), registration = f.get(f.regPath);
      setTicketId(registration.evidence, ticketId); f.seed(f.regPath, registration); f.seed(f.candidatePath, undefined);
      await f.confirmation.queueInstructorLessonConfirmationForIssuedTicket(
        f.registrations[0].registrationId, { source: "ticket_verified_trigger" });
      const queued = f.get(f.candidatePath);
      assert.equal(queued.payload.ticketId, "");
      assert.equal(queued.candidateId, f.candidate.candidateId);
      assert.equal(await f.confirmation.instructorLessonConfirmationSendabilityIssue(queued), "");
      await f.run(batch); await f.run(batch);
      assert.equal(f.posts.length, 1); assert.equal(f.posts[0].messages[0].to, registration.memberPhone);
      assert.equal(f.get(f.candidatePath).status, "sent"); assert.equal(f.get(f.candidatePath).attempts, 1);
      assert.equal(f.get(f.regPath).steps.ticket.status, "verified");
      assert.deepEqual(f.get(f.regPath).evidence.ticketId, ticketId === absentTicketId ? undefined : ticketId);
    });
  }
  for (const [name, candidateId, evidenceId] of [
    ["known mismatch", "wrong", "ticket-0"], ["candidate only", "ticket-0", absentTicketId],
    ["evidence only", "", "ticket-0"], ["undefined candidate", undefined, "ticket-0"],
    ["blank evidence", "ticket-0", " \t "], ["string zero is an ID", "0", undefined],
  ] as Array<[string, unknown, unknown]>) {
    test(`${label}: allocated ticket IDs fail closed for ${name}`, async () => {
      const f = harness(), registration = f.get(f.regPath), candidate = clone(f.candidate);
      setTicketId(registration.evidence, evidenceId); setTicketId(candidate.payload, candidateId);
      f.seed(f.regPath, registration); f.seed(f.candidatePath, candidate);
      assert.ok(await f.confirmation.instructorLessonConfirmationSendabilityIssue(candidate));
      await f.run(batch);
      assert.equal(f.posts.length, 0); assert.equal(f.get(f.candidatePath).attempts, 0);
      assert.equal(f.get(`alimtalkSends/${candidate.candidateId}`), undefined);
    });
  }
  test(`${label}: known ticket IDs compare after cleanText normalization`, async () => {
    const f = harness(), registration = f.get(f.regPath), candidate = clone(f.candidate);
    registration.evidence.ticketId = " ticket-0 "; candidate.payload.ticketId = "ticket-0";
    f.seed(f.regPath, registration); f.seed(f.candidatePath, candidate);
    assert.equal(await f.confirmation.instructorLessonConfirmationSendabilityIssue(candidate), "");
    await f.run(batch); await f.run(batch);
    assert.equal(f.posts.length, 1); assert.equal(f.get(f.candidatePath).attempts, 1);
  });
  for (const target of ["own", "sibling"] as const) {
    for (const step of ["eformsign", "memo", "confirmation"]) for (const status of ["failed", "review_required"]) {
      test(`${label}: ${target} ${step} ${status} does not poison verified confirmation or replay it`, async () => {
        const f = harness(), path = target === "own" ? f.regPath : f.siblingPath;
        const registration = f.get(f.regPath); delete registration.evidence.ticketId; f.seed(f.regPath, registration);
        followupAttention(f, path, step, status);
        const before = f.get(path);
        assert.equal((await f.guard()).issue, "");
        assert.equal(f.writes.length, 0);
        f.seed(f.candidatePath, undefined);
        await f.confirmation.queueInstructorLessonConfirmationForIssuedTicket(
          f.registrations[0].registrationId, { source: "ticket_verified_trigger" });
        await f.run(batch); await f.run(batch);
        assert.equal(f.posts.length, 1); assert.equal(f.posts[0].messages[0].to, registration.memberPhone);
        assert.equal(f.get(f.candidatePath).status, "sent"); assert.equal(f.get(f.candidatePath).attempts, 1);
        const after = f.get(path);
        assert.deepEqual(after.steps.member, before.steps.member); assert.deepEqual(after.steps.ticket, before.steps.ticket);
        if (step !== "confirmation" || target === "sibling") assert.deepEqual(after.steps[step], before.steps[step]);
        assert.deepEqual(after.externalOrder, before.externalOrder); assert.deepEqual(after.operatorChecks, before.operatorChecks);
      });
    }
  }
  test(`${label}: actual provider function sends valid allocation once`, async () => {
    const f = harness(); await f.run(batch);
    assert.equal(f.posts.length, 1); assert.equal(f.posts[0].messages[0].to, f.candidate.memberPhone);
    assert.equal(f.get(f.candidatePath).attempts, 1); assert.equal(f.get(f.candidatePath).status, "sent");
  });
  for (const [name, change] of mutations) test(`${label}: final POST guard blocks late ${name} without attempts or send ledger`, async () => {
    const f = harness(); f.beforeProvider(() => change(f)); await f.run(batch);
    assert.equal(f.posts.length, 0); assert.equal(f.get(f.candidatePath).attempts, 0);
    assert.equal(f.get(f.candidatePath).status, "skipped");
    assert.equal(f.get(f.candidatePath).reasonCode, "instructor_lesson_confirmation_source_blocked");
    assert.equal(f.get(`alimtalkSends/${f.candidate.candidateId}`), undefined);
  });
  for (const [name, change] of mutations) test(`${label}: follow-up exception still blocks late ${name}`, async () => {
    const f = harness(); followupAttention(f, f.regPath, "memo", "failed"); followupAttention(f, f.siblingPath);
    assert.equal((await f.guard()).issue, "");
    f.beforeProvider(() => change(f)); await f.run(batch);
    assert.equal(f.posts.length, 0); assert.equal(f.get(f.candidatePath).attempts, 0);
    assert.equal(f.get(f.candidatePath).status, "skipped");
    assert.equal(f.get(f.candidatePath).reasonCode, "instructor_lesson_confirmation_source_blocked");
    assert.equal(f.get(`alimtalkSends/${f.candidate.candidateId}`), undefined);
  });
  for (const status of ["sent", "unknown"]) test(`${label}: follow-up exception cannot replay ${status} provider history`, async () => {
    const f = harness(); followupAttention(f, f.regPath); followupAttention(f, f.siblingPath, "memo", "failed");
    const prior = { status, messageId: "synthetic-existing-message" };
    f.beforeProvider(() => f.seed(`alimtalkSends/${f.candidate.candidateId}`, prior));
    await f.run(batch); await f.run(batch);
    assert.equal(f.posts.length, 0); assert.equal(f.get(f.candidatePath).attempts, 0);
    assert.deepEqual(f.get(`alimtalkSends/${f.candidate.candidateId}`), prior);
  });
  for (const throwsOutsideWrapper of [false, true]) test(`${label}: final canonical read failure is pretransport (${throwsOutsideWrapper})`, async () => {
    const f = harness(); f.beforeProvider(() => throwsOutsideWrapper ? f.preflightThrow() : f.readFailure(LEDGER));
    await f.run(batch);
    assert.equal(f.posts.length, 0); assert.equal(f.get(f.candidatePath).status, "skipped");
    assert.equal(f.get(f.candidatePath).attempts, 0); assert.equal(f.get(`alimtalkSends/${f.candidate.candidateId}`), undefined);
    assert.doesNotMatch(f.get(f.candidatePath).lastError, /private/);
  });
  test(`${label}: final guard does not overwrite a replacement lease`, async () => {
    const f = harness(); f.beforeProvider(() => f.seed(f.candidatePath, { ...f.get(f.candidatePath), queueLeaseId: "replacement" }));
    await f.run(batch); assert.equal(f.posts.length, 0); assert.equal(f.get(f.candidatePath).queueLeaseId, "replacement");
    assert.equal(f.get(f.candidatePath).status, "processing"); assert.equal(f.get(f.candidatePath).attempts, 0);
  });
  for (const changed of ["attempts", "payload", "send"]) test(`${label}: preflight preserves changed ${changed} state`, async () => {
    const f = harness(); f.beforeProvider(() => {
      if (changed === "send") f.seed(`alimtalkSends/${f.candidate.candidateId}`, { status: "unknown" });
      else {
        const current = f.get(f.candidatePath);
        if (changed === "attempts") current.attempts = 1;
        else current.payload.memberName = "changed";
        f.seed(f.candidatePath, current);
      }
    });
    await f.run(batch); assert.equal(f.posts.length, 0); assert.equal(f.get(f.candidatePath).status, "processing");
    if (changed === "send") assert.equal(f.get(`alimtalkSends/${f.candidate.candidateId}`).status, "unknown");
  });
  test(`${label}: final clock at 23:00 defers without transport; 09:00 resumes with fresh family validation`, async () => {
    const f = harness(); f.beforeProvider(() => f.at("2026-10-27T14:00:00.000Z")); await f.run(batch);
    assert.equal(f.posts.length, 0); assert.equal(f.get(f.candidatePath).status, "queued");
    assert.equal(f.get(f.candidatePath).attempts, 0);
    f.at("2026-10-28T00:00:00.000Z");
    f.seed(f.siblingPath, { ...f.get(f.siblingPath), externalOrderReviewRequired: true });
    await f.run(batch); assert.equal(f.posts.length, 0); assert.equal(f.get(f.candidatePath).status, "skipped");
  });
  test(`${label}: preflight-shaped error after provider invocation is a transport failure, not a skip`, async () => {
    const f = harness(); f.providerThrow(() => new f.runtime.InstructorOrderAttendeePreflightError("synthetic-provider-error"));
    await f.run(batch); assert.equal(f.posts.length, 1); assert.equal(f.get(f.candidatePath).status, "failed");
    assert.equal(f.get(f.candidatePath).attempts, 1); assert.ok(f.get(`alimtalkSends/${f.candidate.candidateId}`));
  });
}

test("manual single registration keeps existing queue/send path and nonconfirmation preflight is a no-op", async () => {
  const f = harness(), r = f.get(f.regPath), c = clone(f.candidate);
  delete r.source; delete r.externalOrder; delete r.orderAllocation; delete c.payload.attendeeResolutionKey;
  f.seed(f.regPath, r); f.seed(f.candidatePath, c);
  await f.run(); assert.equal(f.posts.length, 1);
  f.readFailure("instructorLessonRegistrations/");
  assert.equal(await f.confirmation.instructorLessonConfirmationAllocationSendabilityIssue({ type: "other" }), "");
});

test("noninstructor provider path does not call the allocation wrapper or read canonical registrations", async () => {
  const f = harness(); f.preflightThrow(); f.readFailure("instructorLessonRegistrations/");
  await f.runtime.sendSolapiAlimtalk({ ...f.candidate, type: "ticket_notice" });
  assert.equal(f.posts.length, 1); assert.equal(f.reads.length, 0);
});

test("Firestore map property ordering does not change the deterministic manifest key", async () => {
  const f = harness(), ledger = f.get(LEDGER);
  ledger.attendeeResolution.attendees = ledger.attendeeResolution.attendees.map((a: any) => ({
    registrationId: a.registrationId, paidAmount: a.paidAmount, memberPhone: a.memberPhone, memberName: a.memberName,
  }));
  f.seed(LEDGER, ledger); assert.equal((await f.guard()).issue, "");
});
