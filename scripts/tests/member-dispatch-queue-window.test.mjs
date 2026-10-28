import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import vm from "node:vm";

const root = new URL("../../firebase/kangsain-functions/functions/", import.meta.url);
const ts = createRequire(new URL("package.json", root))("typescript");
const require = createRequire(import.meta.url);
const DAY = "2026-10-22T03:00:00.000Z";
const CLOSE = "2026-10-22T14:00:00.000Z";
const OPEN = "2026-10-23T00:00:00.000Z";
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

class Stamp {
  constructor(ms) { this.ms = ms; }
  toMillis() { return this.ms; }
  isEqual(other) { return other?.toMillis?.() === this.ms; }
  static fromDate(date) { return new Stamp(date.getTime()); }
}
function copy(value) {
  if (value instanceof Stamp) return new Stamp(value.ms);
  if (Array.isArray(value)) return Array.from(value, copy);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, copy(v)]));
  return value;
}

class Store {
  rows = new Map();
  writes = [];
  beforeTransaction;
  afterTransaction;
  failNextTransaction = false;
  seed(path, data) { this.rows.set(path, copy(data)); }
  patch(path, data) { this.seed(path, { ...this.rows.get(path), ...data }); }
  snapshot(path) { return { id: path.split("/").at(-1), ref: this.doc(path), exists: this.rows.has(path), data: () => copy(this.rows.get(path)) }; }
  doc(path) { return { path, get: async () => this.snapshot(path), set: async (data, options) => {
    this.writes.push([path, copy(data)]);
    this.seed(path, options?.merge ? { ...this.rows.get(path), ...data } : data);
  } }; }
  collection(path) {
    const query = (filters = []) => ({
      doc: id => this.doc(`${path}/${id}`),
      where: (key, op, value) => query([...filters, [key, op, value]]),
      limit: () => query(filters),
      get: async () => ({ docs: [...this.rows].filter(([key, data]) => key.startsWith(`${path}/`) &&
        filters.every(([field, op, value]) => op === "in" ? value.includes(data[field]) : data[field] === value))
        .map(([key]) => this.snapshot(key)) }),
    });
    return query();
  }
  async runTransaction(callback) {
    const before = this.beforeTransaction; this.beforeTransaction = undefined; before?.();
    if (this.failNextTransaction) { this.failNextTransaction = false; throw new Error("synthetic_transaction_failure"); }
    const writes = [];
    const tx = {
      get: async ref => { assert.equal(writes.length, 0, "reads must precede writes"); return this.snapshot(ref.path); },
      getAll: async (...refs) => { assert.equal(writes.length, 0); return refs.map(ref => this.snapshot(ref.path)); },
      create: (ref, data) => { assert.equal(this.rows.has(ref.path), false); writes.push([ref.path, copy(data)]); },
      update: (ref, data) => { assert.equal(this.rows.has(ref.path), true); writes.push([ref.path, { ...this.rows.get(ref.path), ...copy(data) }]); },
      set: (ref, data, options) => writes.push([ref.path, options?.merge ? { ...this.rows.get(ref.path), ...copy(data) } : copy(data)]),
      delete: () => assert.fail("audit records must never be deleted"),
    };
    const result = await callback(tx);
    for (const [path, data] of writes) { this.rows.set(path, copy(data)); this.writes.push([path, copy(data)]); }
    const after = this.afterTransaction; this.afterTransaction = undefined; after?.(writes);
    return result;
  }
  batch() {
    const writes = [];
    return { update: (ref, data) => writes.push([ref.path, copy(data)]), commit: async () => {
      for (const [path] of writes) assert.ok(this.rows.has(path));
      for (const [path, data] of writes) { this.patch(path, data); this.writes.push([path, data]); }
    } };
  }
}

function harness(at = DAY) {
  const h = { clock: Date.parse(at), db: new Store(), fetches: [], logs: [], reconciles: 0,
    sourceIssue: "", approvalIssue: "", duplicate: null, templateHook: null, transportError: null };
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [h.clock])); }
    static now() { return h.clock; }
  }
  const stamp = () => new Stamp(h.clock);
  // Compile whole source modules, not a rewritten guard. Firebase, secrets and network are all mocked.
  function load(relative, imports = {}, overrides = {}) {
    const source = readFileSync(new URL(`src/${relative}`, root), "utf8");
    const exports = {};
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const suffix = Object.keys(overrides).map(name => `${name} = __overrides.${name};`).join("\n");
    vm.runInNewContext(output + "\n" + suffix, {
      exports, module: { exports }, __overrides: overrides, Date: Clock, Error, URL, URLSearchParams, AbortSignal, Buffer,
      fetch: async (url, options) => {
        h.fetches.push({ url, options });
        assert.equal(options?.method, "POST", "provider evidence is mocked independently");
        if (h.transportError) throw h.transportError;
        return { ok: true, json: async () => ({ messageList: [{ messageId: "synthetic-message" }] }) };
      },
      require: id => {
        if (id === "node:crypto") return require(id);
        if (Object.hasOwn(imports, id)) return imports[id];
        throw new Error(`Forbidden runtime import: ${relative}: ${id}`);
      },
    }, { filename: relative, timeout: 2000 });
    return exports;
  }
  const hashes = load("utils/hash.ts");
  const window = load("memberSignup/memberDispatchWindow.ts");
  const recipients = load("alimtalk/testRecipients.ts");
  const history = load("memberSignup/membershipWelcomeHistory.ts", { "node:crypto": require("node:crypto") });
  const welcomePolicy = { MEMBERSHIP_WELCOME_TEMPLATE: { templateId: "synthetic-welcome" }, membershipWelcomeKey: () => "welcome" };
  const welcomeImports = {
    "./memberDispatchWindow": window, "./membershipContractPolicy": { normalizeMembershipPhone: value => value },
    "./membershipWelcomePolicy": welcomePolicy, "./membershipWelcomeReadback": { membershipWelcomeReadbackIssue: () => "" },
    "./membershipWelcomeHistory": history,
  };
  const welcome = load("memberSignup/membershipWelcomeQueue.ts", welcomeImports, {
    inspectMembershipWelcome: async (_deps, sourceId, candidate) => {
      const source = h.db.rows.get(`studiomateMembershipContracts/${sourceId}`);
      const config = h.db.rows.get("systemSettings/membershipContractAutomation");
      return { source, memberIds: [candidate.memberId, "101"], sourceHash: hash(source), configHash: hash(config) };
    }, sourceIssue: () => h.sourceIssue,
  });
  const holding = load("alimtalk/holdingNoticeQueue.ts", {
    "../memberSignup/memberDispatchWindow": window, "firebase-admin/firestore": { Timestamp: Stamp }, "./testRecipients": recipients,
  }, {
    inspect: async (_deps, sourceId) => ({ source: h.db.rows.get(`memberTicketHolds/${sourceId}`), memberHash: "synthetic-member-hash" }),
    currentReads: async (_deps, _tx, checked, _sourceId, _holdId, candidate) => {
      assert.equal(candidate.payload.holdingSourceVersion, checked.source.sourceVersion);
      if (h.sourceIssue) throw new Error(h.sourceIssue);
      return candidate.payload.variables;
    },
  });
  const scheduling = load("alimtalk/holdingNoticeScheduling.ts", {
    "./holdingNoticeQueue": holding, "../memberSignup/membershipWelcomeProvider": {}, "./holdingNoticeProvider": {},
  });
  const deps = { db: h.db, now: () => new Clock(), timestamp: stamp };
  const secret = { value: () => "synthetic-only" };
  const logger = Object.fromEntries(["error", "warn", "info"].map(name => [name, (...args) => h.logs.push([name, ...args])]));
  const runtime = load("alimtalk/holdingNoticeRuntime.ts", {
    "firebase-functions": { logger }, "../config/firebase": { db: h.db },
    "../config/secrets": { solapiApiKey: secret, solapiApiSecret: secret }, "../utils/date": { nowTimestamp: stamp },
    "../memberSignup/memberDispatchWindow": window, "../memberSignup/membershipWelcomeQueue": welcome,
    "./holdingNoticeScheduling": scheduling, "./recipientExclusion": {}, "./testRecipients": recipients,
    "./holdingNoticeProvider": { HOLDING_TEMPLATE: { channelId: "synthetic", templateId: holding.HOLDING_NOTICE_TEMPLATE_CODE },
      holdingProviderReceipt: () => ({ identityProven: true, messageId: "synthetic-message" }) },
    "./holdingNoticeQueue": holding,
  }, { dependencies: () => deps });
  const refs = { alimtalkCandidates: () => h.db.collection("alimtalkCandidates"),
    alimtalkCandidate: id => h.db.doc(`alimtalkCandidates/${id}`), alimtalkSend: id => h.db.doc(`alimtalkSends/${id}`) };
  const sourceChecks = Object.fromEntries(["targetEligibilityIssue", "privateSurveySendabilityIssue", "renewalCandidateSendabilityIssue",
    "longAbsenceCandidateSendabilityIssue", "instructorLessonConfirmationSendabilityIssue"].map(name => [name, async () => h.sourceIssue]));
  sourceChecks.targetDuplicateIssue = async () => h.duplicate;
  const requests = load("alimtalk/memberDispatchRequests.ts", {
    "../utils/hash": hashes, "./testRecipients": recipients,
  });
  const mealTestWindow = load("alimtalk/recommendedMealTestWindow.ts", {
    "../config/firebase": { db: h.db }, "firebase-admin/firestore": { Timestamp: { now: stamp } },
    "../memberSignup/memberDispatchWindow": window, "./testRecipients": recipients,
    "./templates": { ALIMTALK_TEMPLATES: { recommended_meal_survey: { code: "synthetic-meal" } } },
  });
  const queue = load("alimtalk/processAlimtalkQueue.ts", {
    "../utils/hash": hashes,
    "./memberDispatchRequests": requests,
    "./recommendedMealTestWindow": mealTestWindow,
    "../memberSignup/memberDispatchWindow": window,
    "./holdingNoticeRuntime": { ...runtime, reconcileHoldingNoticeQueue: async () => { h.reconciles++; } },
    "./holdingNoticeScheduling": scheduling,
    "./holdingQueueSelection": { selectHoldingQueueCandidates: async query => (await query.get()).docs },
    "./holdingNoticeQueue": holding,
    "../memberSignup/membershipWelcomeRuntime": { reconcileMembershipWelcomeQueue: async () => { h.reconciles++; },
      sendMembershipWelcome: (candidate, transport) => welcome.dispatchMembershipWelcome(deps, candidate, transport) },
    "../memberSignup/membershipWelcomePolicy": welcomePolicy,
    "../memberSignup/membershipWelcomeQueue": { ...welcome, membershipAutomationEnabled: () => true },
    "../memberSignup/membershipWelcomeReadback": { membershipWelcomeReadbackIssue: () => "" },
    "firebase-functions": { logger }, "../config/firebase": { db: h.db },
    "../config/secrets": { solapiApiKey: secret, solapiApiSecret: secret, solapiPfid: secret },
    "../firestore/refs": { refs }, "../utils/errors": { errorMessage: e => e.message },
    "../utils/date": { nowTimestamp: stamp, todayKst: () => new Clock(h.clock + 9 * 3600000).toISOString().slice(0, 10) },
    "../utils/shortLinks": {}, "./templates": { ALIMTALK_TEMPLATE_CHANNEL_IDS: {}, alimtalkDedupePolicy: () => ({ label: "synthetic", windowDays: 7 }) },
    "./eligibility": { isRetryableTemplateStatusIssue: () => false },
    "./dedupe": { normalizePhone: value => value, alimtalkDedupeKey: c => c.candidateId }, "./targetValidationChecks": sourceChecks,
    "./templateStatus": { isAlimtalkTemplateApproved: async () => { await h.templateHook?.(); return true; } },
    "./instructorLessonManagement": { normalizeInstructorLessonManagementNumber: value => value },
    "./instructorLessonDeliveryGuard": { genericInstructorLessonQueueBlock: () => null }, "./testRecipients": recipients,
    "../privateLessonChart/privateLessonReportRevision": {}, "./ticketNoticePolicy": { TICKET_NOTICE_POLICY: { pendingReason: "synthetic-pending" } },
    "./approvalStore": { alimtalkApprovalClaimIssue: async () => h.approvalIssue },
    "../mealPlan/recommendedMealProgram": {}, "../mealPlan/recommendedMealSurvey": {},
    "../instructorLessonRegistration/instructorLessonConfirmation": { syncInstructorLessonConfirmationOutcome: async () => {} },
  });
  h.setClock = value => { h.clock = Date.parse(value); };
  h.seed = (kind = "generic", extra = {}) => {
    const sourceId = "a".repeat(64);
    const source = { studioId: "5330", memberId: "100", ticketId: "200", sourceVersion: "b".repeat(64),
      observedAt: new Clock(h.clock - 1000).toISOString(), identityVerified: true, noticeStatus: "ready", noticeEligibleHoldIds: ["hold"] };
    const holdingSourceId = holding.holdingSourceId(source);
    const id = kind === "holding" ? holding.candidateKey(source, "hold") : kind === "welcome" ? "welcome" : "generic";
    const candidate = { candidateId: id, studioId: "5330", memberId: "100", memberPhone: "01000000100", memberName: "Synthetic Member",
      type: kind === "holding" ? "manual_review" : kind === "welcome" ? "membership_welcome" : "reservation_open",
      templateCode: kind === "holding" ? holding.HOLDING_NOTICE_TEMPLATE_CODE : kind === "welcome" ? "synthetic-welcome" : "synthetic-generic",
      status: "queued", attempts: 0, maxAttempts: kind === "generic" ? 2 : 1, dedupeKey: id, sourceActionKey: id,
      queuedBy: "operator", reviewedByUid: "synthetic-operator", reviewedAt: stamp(), createdAt: new Stamp(h.clock - 10000), updatedAt: stamp(),
      payload: kind === "holding" ? { holdingNotice: true, holdingSourceId, holdingSourceVersion: source.sourceVersion, holdId: "hold", variables: { "#{이름}": "Synthetic Member" } }
        : kind === "welcome" ? { sourceContractId: sourceId } : {}, ...extra };
    if (kind === "holding") candidate.holdingApprovalSnapshot = holding.holdingApprovalSnapshot(candidate);
    h.db.seed(`alimtalkCandidates/${id}`, candidate);
    h.db.seed(`memberTicketHolds/${holdingSourceId}`, source);
    h.db.seed("settings/holdingNotice", { mode: "live", autoSendEnabled: true, canonicalSourcePromoted: true,
      nativeE2eVerified: true, cutoverAt: new Clock(h.clock - 86400000).toISOString() });
    h.db.seed(`studiomateMembershipContracts/${sourceId}`, { contractId: sourceId, welcomeStatus: "ready", completion: { memberId: "100" } });
    h.db.seed("systemSettings/membershipContractAutomation", { enabled: true });
    return id;
  };
  h.row = id => h.db.rows.get(`alimtalkCandidates/${id}`);
  h.claims = family => [...h.db.rows].filter(([path]) => path.startsWith(`${family === "holding" ? "holdingNoticeClaims" : "membershipWelcomeClaims"}/`));
  return Object.assign(h, { queue, runtime, window, holding, welcome, deps, mealTestWindow, recipients });
}

test("one approved meal test passes real queue transport guards once at night without opening ordinary sends", async () => {
  const h = harness("2026-10-28T16:00:00Z"), p = h.mealTestWindow;
  const target = h.recipients.primaryAlimtalkTestRecipient(), id = p.MEAL_TEST_REQUEST, cid = p.MEAL_TEST_CANDIDATE;
  const token = "a".repeat(48), surveyUrl = `https://in.archivepilates.com/recommendedMealSurvey/?id=${id}&token=${token}`;
  const reportUrl = `https://in.archivepilates.com/recommendedMealPlan/?id=${id}&token=${token}`;
  const candidate = { candidateId: cid, type: "recommended_meal_survey", sourceActionKey: id, studioId: "5330",
    memberId: target.memberId, memberName: target.name, memberPhone: target.phone, templateCode: "synthetic-meal",
    status: "queued", queuedBy: "operator", reviewedByUid: "synthetic-operator", attempts: 0, maxAttempts: 1,
    createdAt: new Stamp(h.clock), updatedAt: new Stamp(h.clock), payload: { quietHoursTestCampaign: p.MEAL_TEST_CAMPAIGN,
      surveyId: id, accessToken: token, surveyUrl, reportUrl, shortLinkId: "s-test", shortUrl: "https://in.archivepilates.com/s/s-test/",
      reportLinkId: "r-test", reportShortUrl: "https://in.archivepilates.com/s/r-test/" } };
  h.db.seed(`alimtalkCandidates/${cid}`, candidate);
  h.db.seed(`recommendedMealProgramRequests/${id}`, { ...candidate, requestId: id,
    accessTokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Stamp(h.clock + 86400000),
    surveyUrl, reportUrl, shortLinkId: "s-test", shortUrl: candidate.payload.shortUrl,
    reportShortLinkId: "r-test", reportShortUrl: candidate.payload.reportShortUrl });
  h.db.seed("shortLinks/s-test", { linkId: "s-test", active: true, type: "recommended_meal_survey", targetUrl: surveyUrl, sourceId: id });
  h.db.seed("shortLinks/r-test", { linkId: "r-test", active: true, type: "recommended_meal_report", targetUrl: reportUrl, sourceId: `${id}-report` });
  h.db.seed(p.MEAL_TEST_APPROVAL, { status: "approved", approved: true, campaign: p.MEAL_TEST_CAMPAIGN,
    candidateId: cid, memberId: target.memberId, templateCode: "synthetic-meal",
    phoneSha256: createHash("sha256").update(target.phone).digest("hex"),
    notBefore: new Date(h.clock - 1000).toISOString(), expiresAt: new Date(h.clock + 3600000).toISOString() });
  const result = await h.queue.processAlimtalkCandidate(cid);
  assert.equal(result.status, "sent", result.lastError);
  assert.equal(h.fetches.length, 1);
  assert.equal(h.db.rows.get(p.MEAL_TEST_APPROVAL).status, "attempted_do_not_replay");
  assert.equal((await h.queue.processAlimtalkCandidate(cid)).status, "deferred");
  const normal = h.seed();
  assert.equal((await h.queue.processAlimtalkCandidate(normal)).status, "deferred");
  assert.equal(h.fetches.length, 1);
});

for (const [at, allowed, next] of [
  ["2026-10-22T13:59:59.999Z", true, null], [CLOSE, false, OPEN],
  ["2026-10-22T15:00:00.000Z", false, OPEN], ["2026-10-22T23:59:59.999Z", false, OPEN], [OPEN, true, null],
]) test(`actual policy and both entrypoints at ${at}`, async () => {
  const h = harness(at), id = h.seed("generic", { testOverride: true, payload: { testOverride: "true" } });
  assert.equal(h.window.memberDispatchWindow().allowed, allowed);
  assert.equal(h.window.memberDispatchWindow().nextAllowedAt, next);
  if (allowed) return;
  const result = await h.queue.processAlimtalkCandidate(id);
  assert.equal(result.status, "deferred"); assert.equal(result.nextEligibleAt, next);
  const batch = await h.queue.processAlimtalkQueue();
  assert.equal(batch.failed, 0); assert.equal(batch.sent, 0); assert.equal(batch.processed, 0); assert.equal(batch.deferred, 1);
  assert.equal(h.row(id).status, "queued"); assert.equal(h.row(id).attempts, 0); assert.equal(h.row(id).nextEligibleAt, next);
  assert.equal(h.row(id).queuedBy, "operator"); assert.equal(h.row(id).payload.testOverride, "true");
  assert.equal(h.fetches.length, 0); assert.equal(h.reconciles, 0); assert.equal(h.db.rows.has(`alimtalkSends/${id}`), false);
});

test("night guards never reclaim someone else's processing row or resurrect terminal/review rows", async () => {
  for (const status of ["processing", "sent", "failed", "reviewed", "skipped"]) {
    const h = harness(CLOSE), id = h.seed("generic", { status, queueLeaseId: "other-worker", attempts: 1 });
    const before = copy(h.row(id));
    assert.equal((await h.queue.processAlimtalkCandidate(id)).status, "deferred");
    assert.deepEqual(h.row(id), before); assert.equal(h.db.writes.length, 0);
  }
});

test("claim transaction rechecks the clock and future due field before creating a processing lease", async () => {
  const h = harness("2026-10-22T13:59:59.999Z"), id = h.seed();
  h.db.beforeTransaction = () => h.setClock(CLOSE);
  assert.equal((await h.queue.processAlimtalkCandidate(id)).status, "deferred");
  assert.equal(h.row(id).status, "queued"); assert.equal(h.row(id).nextEligibleAt, OPEN); assert.equal(h.fetches.length, 0);
  h.setClock(DAY); h.db.patch(`alimtalkCandidates/${id}`, { nextEligibleAt: OPEN });
  assert.equal(await h.queue.claimCandidate(h.row(id)), null); assert.equal(h.row(id).status, "queued");
});

for (const entry of ["candidate", "queue"]) test(`${entry}: final fetch guard at 23:00 restores own queued lease without attempt/failure`, async () => {
  const h = harness("2026-10-22T13:59:59.999Z"), id = h.seed("generic", { attempts: 1 });
  h.templateHook = () => {
    // Model an asynchronous template/short-link read, including the sender's own timestamp update.
    h.setClock(CLOSE); h.db.patch(`alimtalkCandidates/${id}`, { updatedAt: new Stamp(h.clock + 1), payload: { shortLinkId: "synthetic" } });
  };
  const result = entry === "candidate" ? await h.queue.processAlimtalkCandidate(id) : await h.queue.processAlimtalkQueue();
  assert.equal(entry === "candidate" ? result.status : result.deferred, entry === "candidate" ? "deferred" : 1);
  assert.equal(h.row(id).status, "queued"); assert.equal(h.row(id).attempts, 1); assert.equal(h.row(id).nextEligibleAt, OPEN);
  assert.equal(h.row(id).payload.shortLinkId, "synthetic"); assert.equal(h.fetches.length, 0);
  assert.equal(h.db.rows.has(`alimtalkSends/${id}`), false);
});

test("last-mile guard cannot reset a newer worker's lease", async () => {
  const h = harness("2026-10-22T13:59:59.999Z"), id = h.seed();
  h.templateHook = () => { h.setClock(CLOSE); h.db.patch(`alimtalkCandidates/${id}`, { queueLeaseId: "newer-worker" }); };
  assert.equal((await h.queue.processAlimtalkCandidate(id)).status, "deferred");
  assert.equal(h.row(id).status, "processing"); assert.equal(h.row(id).queueLeaseId, "newer-worker"); assert.equal(h.fetches.length, 0);
});

async function deferAfterPrivateClaim(h, family, id, mutation) {
  const claimed = await h.queue.claimCandidate(h.row(id));
  assert.ok(claimed);
  h.db.afterTransaction = () => { h.setClock(CLOSE); mutation?.(); };
  const result = await h.queue.sendSolapiAlimtalk(claimed).then(() => assert.fail("unexpected send"), error => error);
  assert.equal(h.window.isMemberDispatchDeferred(result), true, result?.stack);
  assert.equal(h.fetches.length, 0);
  return result;
}

for (const family of ["holding", "welcome"]) {
  test(`${family}: pure service claim uses trusted dependency clock, not the caller's selection clock`, async () => {
    const h = harness(DAY), id = h.seed(family);
    const candidate = await h.queue.claimCandidate(h.row(id));
    h.deps.now = () => new Date(CLOSE);
    const transport = async () => assert.fail("closed service window must not invoke transport");
    await assert.rejects(family === "holding" ? h.holding.dispatchHoldingNotice(h.deps, candidate, transport)
      : h.welcome.dispatchMembershipWelcome(h.deps, candidate, transport), error => h.window.isMemberDispatchDeferred(error));
    assert.equal(h.claims(family).length, 0); assert.equal(h.row(id).attempts, 0);
    assert.equal(h.fetches.length, 0);
  });

  for (const entry of ["candidate", "queue"]) test(`${family}/${entry}: outer processor preserves typed last-mile deferral without failed bookkeeping`, async () => {
    const h = harness("2026-10-22T13:59:59.999Z"), id = h.seed(family);
    h.db.afterTransaction = () => { h.db.afterTransaction = () => h.setClock(CLOSE); };
    const result = entry === "candidate" ? await h.queue.processAlimtalkCandidate(id) : await h.queue.processAlimtalkQueue();
    assert.equal(entry === "candidate" ? result.status : result.deferred, entry === "candidate" ? "deferred" : 1);
    assert.equal(h.row(id).status, "queued"); assert.equal(h.row(id).attempts, 0); assert.equal(h.fetches.length, 0);
    assert.equal(h.db.rows.get(`alimtalkSends/${id}`)?.status === "failed", false);
    for (const [, claim] of h.claims(family)) assert.equal(claim.status, "deferred_pretransport");
  });

  test(`${family}: outer processor reports hold persistence failure as review-required, not automatic completion`, async () => {
    const h = harness("2026-10-22T13:59:59.999Z"), id = h.seed(family);
    h.db.afterTransaction = () => { h.db.afterTransaction = () => { h.setClock(CLOSE); h.db.failNextTransaction = true; }; };
    const result = await h.queue.processAlimtalkCandidate(id);
    assert.equal(result.status, "deferred"); assert.match(result.lastError, /quiet_hold_review_required/);
    assert.equal(result.nextEligibleAt, null); assert.equal(h.fetches.length, 0); assert.equal(h.row(id).status, "processing");
    assert.equal(h.db.rows.get(`alimtalkSends/${id}`)?.status === "failed", false);
    for (const [, claim] of h.claims(family)) assert.equal(claim.status, "attempting");
  });

  test(`${family}: crossed-23 claim remains auditable, zero attempts, and safely resumes once after 09:00`, async () => {
    const h = harness("2026-10-22T13:59:59.999Z"), id = h.seed(family);
    await deferAfterPrivateClaim(h, family, id);
    const claims = h.claims(family);
    assert.equal(claims.length, family === "holding" ? 1 : 3);
    for (const [, claim] of claims) {
      assert.equal(claim.status, "deferred_pretransport"); assert.equal(claim.externalAttempted, false);
      assert.equal(claim.nextEligibleAt, OPEN); assert.equal(claim.pretransportDeferrals.length, 1);
      assert.ok(claim.attemptedAt); assert.ok(claim.pretransportDeferrals[0].reservedAt);
    }
    assert.equal(h.row(id).status, "queued"); assert.equal(h.row(id).attempts, 0); assert.equal(h.row(id).providerAttemptedAt, null);
    assert.equal(h.row(id).reviewedByUid, "synthetic-operator"); assert.equal(h.row(id).nextEligibleAt, OPEN);
    const keys = claims.map(([path]) => path);
    if (family === "holding") {
      const send = h.db.rows.get(`alimtalkSends/${id}`);
      assert.equal(send.status, "queued"); assert.equal(send.attempts, 0); assert.equal(send.providerOutcome, "deferred_pretransport");
      assert.equal(send.nextRunAt.toMillis(), Date.parse(OPEN));
    }
    h.setClock(OPEN);
    if (family === "holding") h.db.patch(`memberTicketHolds/${h.row(id).payload.holdingSourceId}`, { observedAt: new Date(h.clock).toISOString() });
    const resumed = await h.queue.processAlimtalkCandidate(id);
    assert.equal(resumed.status, "sent"); assert.equal(h.fetches.length, 1); assert.equal(h.row(id).attempts, 1);
    assert.deepEqual(h.claims(family).map(([path]) => path), keys);
    for (const [, claim] of h.claims(family)) {
      assert.equal(claim.status, "accepted"); assert.equal(claim.pretransportDeferrals.length, 1);
      assert.equal(claim.externalAttempted, true);
    }
    const again = await h.queue.processAlimtalkCandidate(id);
    assert.equal(again.status, "not_claimed"); assert.equal(h.fetches.length, 1);
  });

  test(`${family}: inability to record pretransport hold retains claims and typed review-required error, never unknown/failed`, async () => {
    const h = harness("2026-10-22T13:59:59.999Z"), id = h.seed(family);
    const error = await deferAfterPrivateClaim(h, family, id, () => { h.db.failNextTransaction = true; });
    assert.match(error.pretransportStateIssue, /quiet_hold_review_required/);
    for (const [, claim] of h.claims(family)) assert.equal(claim.status, "attempting");
    assert.equal(h.row(id).status, "processing"); assert.equal(h.row(id).attempts, 1);
    assert.equal(h.db.rows.get(`alimtalkSends/${id}`)?.status === "failed", false);
  });

  for (const mutation of ["accepted", "unknown", "missing-proof", "receipt", "different-event"]) {
    test(`${family}: ${mutation} claim cannot use the safe-resume exception`, async () => {
      const h = harness("2026-10-22T13:59:59.999Z"), id = h.seed(family);
      await deferAfterPrivateClaim(h, family, id);
      h.setClock(OPEN);
      const [path] = h.claims(family)[0];
      if (["accepted", "unknown"].includes(mutation)) h.db.patch(path, { status: mutation });
      if (mutation === "missing-proof") h.db.patch(path, { externalAttempted: null });
      if (mutation === "receipt") h.db.patch(path, { messageId: "prior-provider-id" });
      if (mutation === "different-event") h.db.patch(`alimtalkCandidates/${id}`, {
        payload: { ...h.row(id).payload, sourceContractId: "c".repeat(64), holdingSourceVersion: "c".repeat(64) },
      });
      const candidate = copy(h.row(id)); candidate.status = "processing";
      h.db.seed(`alimtalkCandidates/${id}`, candidate);
      await assert.rejects(h.queue.sendSolapiAlimtalk(candidate));
      assert.equal(h.fetches.length, 0); assert.equal(h.db.rows.get(path).status, ["accepted", "unknown"].includes(mutation) ? mutation : "deferred_pretransport");
    });
  }
}

test("holding reconciliation keeps proven deferred pair pending under the original canonical version", async () => {
  const h = harness("2026-10-22T13:59:59.999Z"), id = h.seed("holding");
  await deferAfterPrivateClaim(h, "holding", id);
  await h.runtime.reconcileHoldingNoticeQueue();
  const source = h.db.rows.get(`memberTicketHolds/${h.row(id).payload.holdingSourceId}`);
  assert.equal(source.noticeStatus, "ready"); assert.equal(source.noticeReason, "holding_quiet_hours_pending");
  assert.deepEqual(source.noticeProgress.completedHoldIds, []); assert.equal(h.row(id).status, "queued");
  h.db.patch(`memberTicketHolds/${h.row(id).payload.holdingSourceId}`, { sourceVersion: "c".repeat(64) });
  await h.runtime.reconcileHoldingNoticeQueue();
  const changed = h.db.rows.get(`memberTicketHolds/${h.row(id).payload.holdingSourceId}`);
  assert.equal(changed.noticeStatus, "review"); assert.equal(changed.noticeReason, "holding_deferred_source_changed_review_required");
  assert.deepEqual(changed.noticeProgress.completedHoldIds, []); assert.equal(h.fetches.length, 0);
});

test("holding reconciliation retains existing accepted/unknown terminal behavior without changing audit records", async () => {
  for (const status of ["accepted", "unknown"]) {
    const h = harness(), id = h.seed("holding");
    const path = `holdingNoticeClaims/${id}`; h.db.seed(path, { candidateId: id, status, messageId: "synthetic-prior" });
    const before = copy(h.db.rows.get(path));
    await h.runtime.reconcileHoldingNoticeQueue();
    const source = h.db.rows.get(`memberTicketHolds/${h.row(id).payload.holdingSourceId}`);
    assert.deepEqual(source.noticeProgress.completedHoldIds, ["hold"]);
    assert.deepEqual(h.db.rows.get(path), before); assert.equal(h.fetches.length, 0);
  }
});

test("09:00 opens the default clock policy for a single mocked generic dispatch", async () => {
  const h = harness(OPEN), id = h.seed();
  const result = await h.queue.processAlimtalkCandidate(id);
  assert.equal(result.status, "sent"); assert.equal(h.fetches.length, 1); assert.equal(h.row(id).attempts, 1);
});

test("daytime source, approval and duplicate guards still block before mocked POST", async () => {
  for (const guard of ["source", "approval", "duplicate"]) {
    const h = harness(), id = h.seed();
    if (guard === "source") h.sourceIssue = "canonical source changed";
    if (guard === "approval") h.approvalIssue = "approval_snapshot_changed";
    if (guard === "duplicate") h.duplicate = { candidateId: "prior" };
    const result = await h.queue.processAlimtalkCandidate(id);
    assert.notEqual(result.status, "sent"); assert.equal(h.fetches.length, 0, `${guard}: ${result.lastError}`);
    assert.equal(h.row(id).attempts, 0, `${guard}: ${result.lastError}`);
  }
});

test("ordinary transport error remains failed and ambiguous welcome/holding claims are not made resumable", async () => {
  for (const family of ["generic", "holding", "welcome"]) {
    const h = harness(), id = h.seed(family); h.transportError = new Error("synthetic_transport_unknown");
    const result = await h.queue.processAlimtalkCandidate(id);
    assert.equal(result.status, "failed"); assert.equal(h.fetches.length, 1, `${family}: ${result.lastError}`);
    assert.equal(h.row(id).attempts, 1);
    for (const [, claim] of h.claims(family)) { assert.equal(claim.status, "unknown"); assert.equal(claim.externalAttempted, true); }
  }
});

test("typed error returned after invoking fetch is an attempted/ambiguous outcome, never a harmless defer", async () => {
  for (const family of ["generic", "holding", "welcome"]) {
    const h = harness(), id = h.seed(family);
    h.transportError = new h.window.MemberDispatchDeferredError(Date.parse(CLOSE));
    const result = await h.queue.processAlimtalkCandidate(id);
    assert.equal(result.status, "failed"); assert.equal(h.fetches.length, 1); assert.equal(h.row(id).attempts, 1);
    assert.notEqual(h.row(id).status, "queued");
    for (const [, claim] of h.claims(family)) {
      assert.equal(claim.status, "unknown"); assert.equal(claim.externalAttempted, true);
      assert.equal(claim.pretransportDeferrals, undefined);
    }
  }
});
