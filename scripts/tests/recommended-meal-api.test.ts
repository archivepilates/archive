import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const root = new URL("../../firebase/kangsain-functions/functions/", import.meta.url);
const ts = createRequire(new URL("package.json", root))("typescript");
const compiled = new Map<string, string>();
function evaluate(file: string, dependencies: Record<string, any>, globals: Record<string, any>): any {
  if (!compiled.has(file)) compiled.set(file, ts.transpileModule(readFileSync(new URL(`src/${file}.ts`, root), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText);
  const exports = {};
  vm.runInNewContext(compiled.get(file)!, {
    exports, Error, Buffer, URL, AbortSignal,
    require: (id: string) => {
      assert.ok(Object.hasOwn(dependencies, id), `Unmocked dependency forbidden: ${id}`);
      return dependencies[id];
    }, ...globals,
  }, { timeout: 1000 });
  return exports;
}

const NOW = Date.parse("2026-10-29T02:00:00.000Z");
const ID = "meal-synthetic-20261029-000000000000";
const TOKEN = "a".repeat(48);
const REQUEST = `recommendedMealProgramRequests/${ID}`;
const RESPONSE = `recommendedMealProgramResponses/${ID}`;
const DRAFT = `recommendedMealProgramDrafts/${ID}`;
const REPORT = `recommendedMealProgramReports/${ID}`;
const ACTOR = { uid: "synthetic-staff", name: "Synthetic operator", studioId: "5330" };
const OPERATOR_CONSENT = "meal-preferences-operator-v1-20261029";
const plain = (value: any) => JSON.parse(JSON.stringify(value));

class Stamp {
  constructor(readonly ms: number) {}
  toMillis() { return this.ms; }
  toDate() { return new Date(this.ms); }
  static now() { return new Stamp(NOW); }
}
function clone(value: any): any {
  if (value instanceof Stamp) return new Stamp(value.ms);
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]));
  return value;
}

// Entire production modules run with an allowlisted require and an in-memory DB only.
function fixture() {
  let clock = NOW;
  class Clock extends Date {
    constructor(value: any = clock) { super(value); }
    static now() { return clock; }
  }
  const values = new Map<string, any>();
  const writes: any[] = [];
  const reads: string[] = [];
  const http: any[] = [];
  const credentialCalls: string[] = [];
  const commits: any[][] = [];
  const transactionReads: string[][] = [];
  let beforeTransaction: (() => void) | undefined;
  let beforeCommit: (() => void) | undefined;
  let commitFailure = false;
  let transactionTail = Promise.resolve();
  const snap = (path: string) => {
    reads.push(path);
    return { exists: values.has(path), data: () => clone(values.get(path)) };
  };
  const apply = (path: string, value: any, merge: boolean) => {
    assert.ok([REQUEST, RESPONSE, DRAFT, REPORT].includes(path) || path.startsWith(`${DRAFT}/revisions/`), `Unscoped memory write: ${path}`);
    values.set(path, merge ? { ...values.get(path), ...clone(value) } : clone(value));
    writes.push({ path, value: clone(value), merge });
  };
  const doc = (path: string) => ({ path, get: async () => snap(path),
    set: async (value: any, opts: any = {}) => apply(path, value, !!opts.merge),
    collection: (name: string) => ({ doc: (id: string) => doc(`${path}/${name}/${id}`) }) });
  const query = (name: string) => ({
    where: (..._args: any[]) => query(name), limit: (_cap: number) => query(name),
    get: async () => {
      assert.equal(name, "inbodyWebhookEvents", "No member scans or external source reads");
      return { docs: [] };
    },
  });
  const db = {
    doc,
    collection: (name: string) => ({ ...query(name), doc: (id: string) => doc(`${name}/${id}`) }),
    async runTransaction(callback: any) {
      const previous = transactionTail; let release!: () => void;
      transactionTail = new Promise<void>(resolve => { release = resolve; });
      await previous;
      const pending: any[] = [];
      const observed = new Map<string, string | undefined>();
      try {
        const hook = beforeTransaction; beforeTransaction = undefined; hook?.();
        const result = await callback({
          get: async (ref: any) => {
            assert.equal(pending.length, 0, "All transaction guards must be read before any write");
            observed.set(ref.path, JSON.stringify(values.get(ref.path)));
            return snap(ref.path);
          },
          set: (ref: any, value: any, opts: any = {}) => pending.push([ref.path, value, !!opts.merge]),
          update: (ref: any, value: any) => pending.push([ref.path, value, true]),
          create: (ref: any, value: any) => {
            assert.equal(values.has(ref.path), false, "Revision history cannot be overwritten");
            pending.push([ref.path, value, false]);
          },
        });
        const commitHook = beforeCommit; beforeCommit = undefined; commitHook?.();
        if ([...observed].some(([path, prior]) => JSON.stringify(values.get(path)) !== prior))
          throw new Error("synthetic_transaction_conflict_rollback");
        if (commitFailure) { commitFailure = false; throw new Error("synthetic_commit_failure_rollback"); }
        for (const [path, value, merge] of pending) apply(path, value, merge);
        commits.push(pending.map(([path]) => path));
        transactionReads.push([...observed.keys()]);
        return result;
      } finally { release(); }
    },
  };
  const content = {
    title: "Synthetic plan", summary: "Synthetic summary", goal: "Synthetic goal", metricsSummary: "Synthetic metrics",
    principles: ["Synthetic principle"], hydration: "Synthetic water", exerciseNutrition: "Synthetic exercise",
    weekendStrategy: "Synthetic weekend", caution: "Synthetic caution",
    days: Array.from({ length: 7 }, (_, i) => ({ day: i + 1, label: `Day ${i + 1}`, breakfast: "Synthetic breakfast",
      lunch: "Synthetic lunch", dinner: "Synthetic dinner", snack: "Synthetic snack", timingTip: "Synthetic timing" })),
  };
  const fakeFetch = async (url: any, init: any = {}) => {
    const endpoint = String(url); http.push({ url: endpoint, ...init });
    throw new Error("All network calls are forbidden in the operator-call lane");
  };
  class AppError extends Error { constructor(readonly code: string, message: string) { super(message); } }
  const globals = { Date: Clock, fetch: fakeFetch };
  const policy = evaluate("mealPlan/recommendedMealChoicePolicy", {}, globals);
  const shared = {
    "node:crypto": crypto, "firebase-admin/firestore": { Timestamp: Stamp },
    "../config/constants": { DEFAULT_STUDIO_ID: "5330" }, "../config/firebase": { db },
    "../utils/date": { nowTimestamp: () => new Stamp(clock) },
    "../utils/errors": { AppError, errorMessage: (err: any) => err.message },
    "./recommendedMealChoicePolicy": policy,
  };
  const survey = evaluate("mealPlan/recommendedMealSurvey", shared, globals);
  const hash = evaluate("utils/hash", { "node:crypto": crypto }, globals);
  const forbiddenCredential = (name: string): never => {
    credentialCalls.push(name); throw new Error(`Credential access forbidden: ${name}`);
  };
  const program = evaluate("mealPlan/recommendedMealProgram", {
    ...shared, "./recommendedMealSurvey": survey,
    "firebase-admin/app": { getApp: () => forbiddenCredential("getApp"), applicationDefault: () => forbiddenCredential("applicationDefault") },
    "../config/secrets": { geminiApiKey: { value: () => forbiddenCredential("geminiApiKey") } },
    "../utils/hash": hash,
  }, globals);
  const answers = () => ({
    ...Object.fromEntries(Object.entries(policy.MEAL_CHOICES).map(([key, choices]: any) =>
      [key, ["snackPattern", "allergies", "preferredFoods", "healthFlags"].includes(key) ? [choices[0]] : choices[0]])),
    schemaVersion: policy.MEAL_CHOICE_SCHEMA, consentVersion: OPERATOR_CONSENT,
    consent: true, aiProcessingConsent: true,
  });
  values.set(REQUEST, {
    requestId: ID, studioId: "5330", memberId: "synthetic-native-id", memberName: "PRIVATE_NAME_SENTINEL",
    memberPhone: "PRIVATE_PHONE_SENTINEL", status: "sent", accessTokenHash: survey.recommendedMealAccessTokenHash(TOKEN),
    expiresAt: new Stamp(NOW + 86400000), inbody: { status: "missing" },
  });
  const seedSubmitted = (overrides = {}) => {
    values.get(REQUEST).status = "submitted";
    values.set(RESPONSE, { requestId: ID, studioId: ACTOR.studioId, memberId: "synthetic-native-id",
      answers: { ...answers(), ...overrides }, reviewReasons: [], submittedAt: new Stamp(NOW - 1000), inbody: { status: "missing" } });
  };
  const call = async (method: string, changes: any = {}) => {
    const result: any = { statusCode: 200, headers: {}, body: undefined };
    const response: any = {
      set: (key: string, value: string) => { result.headers[key] = value; return response; },
      status: (status: number) => { result.statusCode = status; return response; },
      json: (body: any) => { result.body = plain(body); return response; }, send: () => response,
    };
    await survey.recommendedMealSurveyApiHandler({ method, query: { id: ID, token: TOKEN, ...changes.query },
      body: { requestId: ID, accessToken: TOKEN, ...answers(), ...changes.body }, get: () => "https://in.archivepilates.com" }, response);
    return result;
  };
  const sourceHash = () => program.mealResponseSourceHash(values.get(RESPONSE));
  const saveData = (changes: Record<string, any> = {}) => ({ requestId: ID, publicContent: clone(content),
    expectedRevision: values.get(DRAFT)?.revision || "", expectedResponseHash: sourceHash(), ...changes });
  return { values, writes, reads, http, credentialCalls, commits, transactionReads, content, policy, survey, program, hash, answers, seedSubmitted, call, sourceHash, saveData,
    beforeTransaction: (hook: () => void) => { beforeTransaction = hook; }, clock: (ms: number) => { clock = ms; },
    beforeCommit: (hook: () => void) => { beforeCommit = hook; }, failCommit: () => { commitFailure = true; },
    generate: (staff = ACTOR) => program.generateRecommendedMealProgramDraftHandler({ data: { requestId: ID } }, staff),
    trigger: () => program.generateRecommendedMealProgramDraftForSubmittedResponse(ID, clone(values.get(RESPONSE) || { studioId: ACTOR.studioId })),
    save: (data = saveData(), staff = ACTOR) => program.saveRecommendedMealProgramDraftHandler({ data }, staff),
  };
}

test("actual GET authenticates and returns current choice/consent versions without private source data", async () => {
  const f = fixture(); const result = await f.call("GET");
  assert.equal(result.statusCode, 200); assert.equal(result.body.ok, true);
  assert.equal(result.body.surveySchemaVersion, "meal-choice-v2");
  assert.equal(result.body.consentVersion, OPERATOR_CONSENT);
  assert.equal(result.headers["Cache-Control"], "no-store");
  for (const key of ["accessTokenHash", "memberId", "memberPhone", "answers", "inbody"]) assert.equal(Object.hasOwn(result.body, key), false);
  assert.equal(f.writes.length, 0); assert.equal(f.http.length, 0);
});

for (const method of ["GET", "POST"]) {
  for (const issue of ["wrong token", "malformed token", "missing request", "expired", "cancelled"]) {
    test(`actual ${method} denies ${issue} without persistence`, async () => {
      const f = fixture(); const changes: any = {};
      if (issue.includes("token")) {
        const token = issue === "wrong token" ? "b".repeat(48) : "malformed";
        changes.query = { token }; changes.body = { accessToken: token };
      }
      if (issue === "missing request") f.values.delete(REQUEST);
      if (issue === "expired") f.values.get(REQUEST).expiresAt = new Stamp(NOW - 1);
      if (issue === "cancelled") f.values.get(REQUEST).status = "cancelled";
      const result = await f.call(method, changes);
      assert.ok(result.statusCode >= 400); assert.equal(result.body.ok, false);
      assert.equal(f.writes.length, 0); assert.equal(f.http.length, 0);
    });
  }
}

test("actual POST persists precisely 13 choices plus consent, never injected data or forged identity", async () => {
  const f = fixture();
  const result = await f.call("POST", { body: { memberId: "FORGED", memberPhone: "FORGED", memberName: "FORGED",
    medicalConditions: "INJECTED_HEALTH", medications: "INJECTED_DRUG", additionalNote: "INJECTED_TEXT",
    inbody: { status: "available", weightKg: 123 }, payload: { approved: true } } });
  assert.equal(result.statusCode, 200); assert.equal(result.body.status, "submitted");
  const stored = f.values.get(RESPONSE);
  assert.deepEqual(plain(stored.answers), plain(f.answers()));
  assert.equal(Object.keys(stored.answers).length, 17);
  assert.equal(stored.memberId, "synthetic-native-id");
  assert.deepEqual(plain(stored.inbody), { status: "missing", eventId: "", testAt: null, memberReportUrl: "" });
  assert.doesNotMatch(JSON.stringify(stored), /FORGED|INJECTED_|weightKg|accessToken/);
  assert.equal(f.values.get(REQUEST).status, "submitted");
  assert.equal(f.http.length, 0);
});

for (const key of ["schemaVersion", "consentVersion", "consent", "aiProcessingConsent"]) {
  test(`actual POST rejects stale/missing ${key}`, async () => {
    for (const value of [undefined, false, "legacy-v1", "true"]) {
      const f = fixture(); const result = await f.call("POST", { body: { [key]: value } });
      assert.ok(result.statusCode >= 400); assert.equal(f.writes.length, 0);
    }
  });
}

for (const issue of ["cancelled", "expired", "deleted"]) {
  test(`transaction rechecks ${issue} after initial authentication`, async () => {
    const f = fixture();
    f.beforeTransaction(() => {
      if (issue === "cancelled") f.values.get(REQUEST).status = "cancelled";
      if (issue === "expired") f.values.get(REQUEST).expiresAt = new Stamp(NOW - 1);
      if (issue === "deleted") f.values.delete(REQUEST);
    });
    const result = await f.call("POST");
    assert.ok(result.statusCode >= 400); assert.equal(f.values.has(RESPONSE), false); assert.equal(f.writes.length, 0);
  });
}

test("submitted historical answers and timestamps remain untouched on authenticated retry", async () => {
  const f = fixture(); f.values.get(REQUEST).status = "submitted";
  const historical = { answers: { schemaVersion: "legacy-v1", additionalNote: "PRIVATE_LEGACY", consent: true }, submittedAt: new Stamp(NOW - 10000) };
  f.values.set(RESPONSE, clone(historical));
  const result = await f.call("POST", { body: { consent: false, schemaVersion: "obsolete" } });
  assert.equal(result.body.duplicate, true);
  assert.deepEqual(f.values.get(RESPONSE), historical); assert.equal(f.writes.length, 0);
});

test("two concurrent valid submissions preserve the first committed answer set exactly once", async () => {
  const f = fixture();
  const [first, second] = await Promise.all([
    f.call("POST", { body: { primaryGoal: "체지방 감량" } }),
    f.call("POST", { body: { primaryGoal: "현재 체중 유지" } }),
  ]);
  assert.equal(first.statusCode, 200); assert.equal(second.statusCode, 200);
  assert.equal(f.values.get(RESPONSE).answers.primaryGoal, "체지방 감량");
  assert.equal(f.writes.filter(row => row.path === RESPONSE).length, 1);
});

const assertNoExternalCalls = (f: ReturnType<typeof fixture>) => {
  assert.equal(f.http.length, 0, "No AI, metadata, email or other network requests");
  assert.deepEqual(f.credentialCalls, [], "No API key, ADC or OAuth token reads");
};
const operatorRequired = { ok: true, status: "operator_call_required", requestId: ID };

for (const entry of ["generate", "trigger"] as const) {
  test(`${entry}: automatic generation is replaced by an operator call, not a fallback draft`, async () => {
    const f = fixture(); f.seedSubmitted(); const response = clone(f.values.get(RESPONSE));
    assert.deepEqual(plain(await f[entry]()), operatorRequired);
    assert.deepEqual(f.values.get(RESPONSE), response);
    assert.equal(f.values.has(DRAFT), false); assert.equal(f.values.has(REPORT), false);
    for (const write of f.writes) {
      assert.equal(write.path, REQUEST);
      assert.equal(write.value.recommendationStatus, "operator_call_required");
      assert.ok(Object.keys(write.value).every(key => ["recommendationStatus", "updatedAt"].includes(key)));
    }
    assert.equal(f.values.get(REQUEST).status, "submitted");
    assert.equal(f.values.get(REQUEST).mealAiGenerationAttempt, undefined);
    assertNoExternalCalls(f);
  });

  test(`${entry}: historical response and existing draft/report are immutable`, async () => {
    const f = fixture(); f.seedSubmitted({ consentVersion: "legacy-v1", medicalConditions: "PRIVATE_LEGACY" });
    f.values.set(DRAFT, { revision: "legacy-draft", publicContent: clone(f.content), preserved: "synthetic" });
    f.values.set(REPORT, { publicationStatus: "draft", preserved: "synthetic-report" });
    const before = clone([...f.values]);
    assert.deepEqual(plain(await f[entry]()), operatorRequired);
    assert.deepEqual([...f.values], before); assert.equal(f.writes.length, 0); assertNoExternalCalls(f);
  });

  for (const [name, overrides] of [
    ["current choices", {}], ["allergy", { allergies: ["견과류"] }], ["health", { healthFlags: ["임신·수유"] }],
    ["malformed", { healthFlags: { diagnosis: "PRIVATE_HEALTH" }, allergies: "PRIVATE_ALLERGY", exerciseSchedule: "PRIVATE_TEXT" }],
    ["old AI consent", { consentVersion: "meal-preferences-gemini-v1-20261029" }],
    ["no AI consent", { aiProcessingConsent: false }],
  ] as const) {
    test(`${entry}: ${name} never leaves the process and never creates a draft`, async () => {
      const f = fixture(); f.seedSubmitted(overrides);
      f.values.get(RESPONSE).inbody = { eventId: "synthetic-event" };
      f.values.set("inbodyWebhookEvents/synthetic-event", { measurementId: "synthetic-measurement" });
      f.values.set("inbodyMeasurements/synthetic-measurement", { summary: { bmi: 123, weightKg: 999 } });
      const response = clone(f.values.get(RESPONSE));
      assert.deepEqual(plain(await f[entry]()), operatorRequired);
      assert.deepEqual(f.values.get(RESPONSE), response);
      assert.equal(f.values.has(DRAFT), false); assert.equal(f.values.has(REPORT), false); assertNoExternalCalls(f);
    });
  }

  for (const issue of ["missing request", "missing response", "cancelled", "not submitted", "different studio"]) {
    test(`${entry}: ${issue} cannot mutate canonical records`, async () => {
      const f = fixture(); f.seedSubmitted();
      if (issue === "missing request") f.values.delete(REQUEST);
      if (issue === "missing response") f.values.delete(RESPONSE);
      if (issue === "cancelled") f.values.get(REQUEST).status = "cancelled";
      if (issue === "not submitted") f.values.get(REQUEST).status = "queued";
      if (issue === "different studio") f.values.get(REQUEST).studioId = "synthetic-other-studio";
      await assert.rejects(() => f[entry]());
      assert.equal(f.writes.length, 0); assertNoExternalCalls(f);
    });
  }
}

test("automatic invocation cannot mark a request cancelled after the initial read", async () => {
  const f = fixture(); f.seedSubmitted();
  f.beforeTransaction(() => { f.values.get(REQUEST).status = "cancelled"; });
  await assert.rejects(() => f.trigger());
  assert.equal(f.writes.length, 0); assertNoExternalCalls(f);
});

test("operator consent supersedes old Gemini consent for all fresh submissions", async () => {
  const f = fixture();
  assert.equal(f.policy.MEAL_CHOICE_CONSENT, OPERATOR_CONSENT);
  const result = await f.call("POST", { body: { consentVersion: "meal-preferences-gemini-v1-20261029" } });
  assert.ok(result.statusCode >= 400); assert.equal(f.writes.length, 0);
});

function seedDraft(f: ReturnType<typeof fixture>) {
  f.values.set(DRAFT, {
    requestId: ID, responseId: ID, studioId: ACTOR.studioId, memberId: "synthetic-native-id",
    memberName: "PRIVATE_NAME_SENTINEL", revision: "a".repeat(64), sourceResponseHash: f.sourceHash(),
    publicContent: clone(f.content), status: "operator_edited", provider: "operator_assisted", model: "codex-chat",
    reviewReasons: [], createdAt: new Stamp(NOW - 10000), updatedAt: new Stamp(NOW - 5000),
  });
  f.values.set(REPORT, { publicationStatus: "draft", approvalStatus: "draft", reportRevision: "a".repeat(64) });
  f.values.get(REQUEST).draftRevision = "a".repeat(64);
}

test("response source hash is stable and binds answers, review reasons and submittedAt only", () => {
  const f = fixture(); f.seedSubmitted(); const response = clone(f.values.get(RESPONSE)); const hash = f.sourceHash();
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hash, f.hash.stableHash({ answers: response.answers, reviewReasons: response.reviewReasons,
    submittedAt: response.submittedAt.toDate().toISOString() }));
  assert.equal(f.program.mealResponseSourceHash(clone(response)), hash);
  assert.equal(f.program.mealResponseSourceHash({ ...response, memberId: "different", inbody: { bmi: 123 }, updatedAt: new Stamp(NOW) }), hash);
  for (const patch of [{ answers: { ...response.answers, primaryGoal: "체지방 감량" } },
    { reviewReasons: ["health_safety_review_required"] }, { submittedAt: new Stamp(NOW + 1) }]) {
    assert.notEqual(f.program.mealResponseSourceHash({ ...response, ...patch }), hash);
  }
  assertNoExternalCalls(f);
});

test("operator review exposes the same response source hash without generating or saving", async () => {
  const f = fixture(); f.seedSubmitted(); const before = clone([...f.values]);
  const result = await f.program.getRecommendedMealProgramReviewHandler({ data: { requestId: ID } }, ACTOR);
  assert.equal(result.response.sourceHash, f.sourceHash());
  assert.deepEqual(plain(result.response.answers), plain(f.values.get(RESPONSE).answers));
  assert.deepEqual([...f.values], before); assert.equal(f.writes.length, 0); assertNoExternalCalls(f);
});

test("operator save creates the first draft from a submitted response with 3 atomic canonical saves", async () => {
  const f = fixture(); f.seedSubmitted(); const response = clone(f.values.get(RESPONSE));
  const result = await f.save(f.saveData({ authoringMode: "codex_operator", provider: "forged", model: "forged", memberId: "forged" }));
  assert.equal(result.ok, true);
  const draft = f.values.get(DRAFT); const report = f.values.get(REPORT); const request = f.values.get(REQUEST);
  assert.equal(draft.provider, "operator_assisted"); assert.equal(draft.model, "codex-chat");
  assert.equal(draft.sourceResponseHash, f.sourceHash()); assert.match(draft.revision, /^[a-f0-9]{64}$/);
  assert.deepEqual(plain(draft.publicContent), f.content); assert.equal(draft.memberId, "synthetic-native-id");
  assert.equal(report.publicationStatus, "draft"); assert.notEqual(report.approvalStatus, "approved");
  assert.equal(report.reportRevision, draft.revision); assert.equal(request.draftRevision, draft.revision);
  assert.equal(request.status, "submitted"); assert.deepEqual(f.values.get(RESPONSE), response);
  assert.deepEqual([...f.commits.at(-1)!].sort(), [DRAFT, REPORT, REQUEST].sort());
  assert.deepEqual([...f.transactionReads.at(-1)!].sort(), [DRAFT, REPORT, REQUEST, RESPONSE].sort());
  assert.equal(f.writes.length, 3); assertNoExternalCalls(f);
});

test("a request's old survey invitation candidate is not a report candidate and is never invalidated", async () => {
  const f = fixture(); f.seedSubmitted();
  const invitationId = `${ID}-invite`;
  const invitationPath = `alimtalkCandidates/${invitationId}`;
  const invitation = { candidateId: invitationId, type: "recommended_meal_survey", status: "sent", sourceActionKey: ID };
  f.values.get(REQUEST).candidateId = invitationId;
  f.values.get(REQUEST).templateCode = "synthetic-survey-template";
  f.values.set(invitationPath, clone(invitation));
  f.values.set(REPORT, { publicationStatus: "draft", approvalStatus: "draft", reviewReasons: [] });
  const response = clone(f.values.get(RESPONSE));
  await f.save(f.saveData({ authoringMode: "codex_operator" }));
  assert.equal(f.values.get(REQUEST).candidateId, invitationId);
  assert.equal(f.values.get(REPORT).candidateId, undefined);
  assert.deepEqual(f.values.get(invitationPath), invitation);
  assert.equal(f.reads.includes(invitationPath), false);
  assert.equal(f.writes.some(row => row.path === invitationPath), false);
  assert.deepEqual(f.values.get(RESPONSE), response); assertNoExternalCalls(f);
});

test("saving an edited draft archives the entire prior revision inside the same transaction", async () => {
  const f = fixture(); f.seedSubmitted(); seedDraft(f); const old = clone(f.values.get(DRAFT));
  const data = f.saveData({ authoringMode: "codex_operator" }); data.publicContent.summary = "Changed operator summary";
  await f.save(data);
  const historyPath = `${DRAFT}/revisions/${old.revision}`; const history = f.values.get(historyPath);
  assert.ok(history, "Prior revision must be durably retained");
  for (const [key, value] of Object.entries(old)) assert.deepEqual(history[key], value, `History preserves ${key}`);
  assert.notEqual(f.values.get(DRAFT).revision, old.revision);
  assert.equal(f.values.get(DRAFT).createdAt.toMillis(), old.createdAt.toMillis());
  assert.deepEqual([...f.commits.at(-1)!].sort(), [DRAFT, REPORT, REQUEST, historyPath].sort());
  const before = clone([...f.values]); const writes = f.writes.length;
  await assert.rejects(() => f.save(data), undefined, "An old expectedRevision must not be replayed");
  assert.deepEqual([...f.values], before); assert.equal(f.writes.length, writes); assertNoExternalCalls(f);
});

test("identical content, source and review acknowledgement reuse the saved revision without writes", async () => {
  const f = fixture(); f.seedSubmitted(); await f.save(f.saveData({ authoringMode: "codex_operator" }));
  const before = clone([...f.values]); const writes = f.writes.length;
  const result = await f.save(f.saveData({ authoringMode: "codex_operator" }));
  assert.equal(result.reused, true); assert.equal(result.draft.revision, f.values.get(DRAFT).revision);
  assert.deepEqual([...f.values], before); assert.equal(f.writes.length, writes); assertNoExternalCalls(f);
});

test("changing review acknowledgement is a real save, and a repeated acknowledgement is reused", async () => {
  const f = fixture(); f.seedSubmitted({ healthFlags: ["임신·수유"] });
  f.values.get(RESPONSE).reviewReasons = ["health_safety_review_required"];
  const response = clone(f.values.get(RESPONSE));
  await f.save(f.saveData({ authoringMode: "codex_operator", reviewAcknowledged: false }));
  assert.equal(f.values.get(REQUEST).recommendationStatus, "review_required");
  const old = clone(f.values.get(DRAFT));
  const result = await f.save(f.saveData({ authoringMode: "codex_operator", reviewAcknowledged: true }));
  assert.equal(result.reused, false);
  assert.equal(f.values.get(DRAFT).reviewAcknowledgedByUid, ACTOR.uid);
  assert.ok(f.values.get(DRAFT).reviewAcknowledgedAt instanceof Stamp);
  assert.equal(f.values.get(REQUEST).recommendationStatus, "awaiting_operator_review");
  assert.equal(f.values.get(`${DRAFT}/revisions/${old.revision}`).reviewAcknowledgedAt, null);
  const writes = f.writes.length;
  assert.equal((await f.save(f.saveData({ authoringMode: "codex_operator", reviewAcknowledged: true }))).reused, true);
  assert.equal(f.writes.length, writes); assert.deepEqual(f.values.get(RESPONSE), response); assertNoExternalCalls(f);
});

test("preexisting revision history is preserved rather than overwritten by a later edit", async () => {
  const f = fixture(); f.seedSubmitted(); seedDraft(f);
  const path = `${DRAFT}/revisions/${f.values.get(DRAFT).revision}`;
  const historical = { ...clone(f.values.get(DRAFT)), preservedAt: new Stamp(NOW - 30000), sentinel: "keep-first-history" };
  f.values.set(path, clone(historical));
  const data = f.saveData(); data.publicContent.summary = "New edit after existing archive";
  await f.save(data);
  assert.deepEqual(f.values.get(path), historical);
  assert.equal(f.writes.filter(row => row.path === path).length, 0);
  assert.deepEqual([...f.commits.at(-1)!].sort(), [DRAFT, REPORT, REQUEST].sort()); assertNoExternalCalls(f);
});

for (const authoringMode of [undefined, "", "manual", "system", "codex", true]) {
  test(`only exact codex_operator authoring marks Codex provenance: ${String(authoringMode)}`, async () => {
    const f = fixture(); f.seedSubmitted(); await f.save(f.saveData({ authoringMode, provider: "operator_assisted", model: "codex-chat" }));
    assert.notEqual(f.values.get(DRAFT).provider, "operator_assisted");
    assert.notEqual(f.values.get(DRAFT).model, "codex-chat"); assertNoExternalCalls(f);
  });
}

for (const existingDraft of [false, true]) {
  for (const [key, value] of [["expectedResponseHash", undefined], ["expectedResponseHash", "b".repeat(64)],
    ["expectedRevision", undefined], ["expectedRevision", "stale-revision"]] as const) {
    test(`save ${existingDraft ? "revision" : "first draft"} rejects stale/missing ${key}: ${String(value)}`, async () => {
      const f = fixture(); f.seedSubmitted(); if (existingDraft) seedDraft(f);
      const before = clone([...f.values]);
      await assert.rejects(() => f.save(f.saveData({ [key]: value })));
      assert.deepEqual([...f.values], before); assert.equal(f.writes.length, 0); assertNoExternalCalls(f);
    });
  }
}

const reportGuards = [
  { publicationStatus: "published" }, { publicationStatus: "approved" }, { publicationStatus: "sent" },
  { approvalStatus: "approved" }, { approvedSnapshot: { revision: "keep" } },
  { publishedSnapshot: { revision: "keep" } }, { sentSnapshot: { revision: "keep" } },
  { approvalStatus: "sent" }, { approvedAt: new Stamp(NOW - 1000) },
  { publishedAt: new Stamp(NOW - 1000) }, { sentAt: new Stamp(NOW - 1000) },
  { sentRevision: "synthetic-sent-revision" }, { candidateId: "synthetic-queued-candidate" },
];
for (const guard of reportGuards) {
  for (const race of [false, true]) {
    test(`save blocks protected report ${JSON.stringify(guard)}${race ? " changed during transaction" : ""}`, async () => {
      const f = fixture(); f.seedSubmitted(); seedDraft(f); const data = f.saveData();
      const protect = () => { f.values.set(REPORT, { ...f.values.get(REPORT), ...clone(guard) }); };
      if (race) f.beforeTransaction(protect); else protect();
      await assert.rejects(() => f.save(data));
      assert.equal(f.writes.length, 0);
      for (const [key, value] of Object.entries(guard)) assert.deepEqual(f.values.get(REPORT)[key], value);
      assertNoExternalCalls(f);
    });
  }
}

for (const issue of ["missing request", "missing response", "cancelled", "not submitted", "different studio"]) {
  test(`operator save requires current canonical submitted source: ${issue}`, async () => {
    const f = fixture(); f.seedSubmitted(); const data = f.saveData();
    if (issue === "missing request") f.values.delete(REQUEST);
    if (issue === "missing response") f.values.delete(RESPONSE);
    if (issue === "cancelled") f.values.get(REQUEST).status = "cancelled";
    if (issue === "not submitted") f.values.get(REQUEST).status = "queued";
    if (issue === "different studio") f.values.get(REQUEST).studioId = "different-studio";
    await assert.rejects(() => f.save(data)); assert.equal(f.writes.length, 0); assertNoExternalCalls(f);
  });
}

for (const issue of ["request cancelled", "request removed", "request studio changed", "response removed", "answers changed",
  "review reasons changed", "submittedAt changed", "draft revision changed", "draft removed", "first draft appeared",
  "response studio changed", "response member changed", "request member changed"]) {
  test(`save transaction rechecks race: ${issue}`, async () => {
    const f = fixture(); f.seedSubmitted(); if (issue !== "first draft appeared") seedDraft(f);
    const data = f.saveData();
    f.beforeTransaction(() => {
      if (issue === "request cancelled") f.values.get(REQUEST).status = "cancelled";
      if (issue === "request removed") f.values.delete(REQUEST);
      if (issue === "request studio changed") f.values.get(REQUEST).studioId = "different-studio";
      if (issue === "response removed") f.values.delete(RESPONSE);
      if (issue === "answers changed") f.values.get(RESPONSE).answers.primaryGoal = "체지방 감량";
      if (issue === "review reasons changed") f.values.get(RESPONSE).reviewReasons = ["health_safety_review_required"];
      if (issue === "submittedAt changed") f.values.get(RESPONSE).submittedAt = new Stamp(NOW + 1);
      if (issue === "draft revision changed") f.values.get(DRAFT).revision = "c".repeat(64);
      if (issue === "draft removed") f.values.delete(DRAFT);
      if (issue === "first draft appeared") seedDraft(f);
      if (issue === "response studio changed") f.values.get(RESPONSE).studioId = "different-studio";
      if (issue === "response member changed") f.values.get(RESPONSE).memberId = "different-member";
      if (issue === "request member changed") f.values.get(REQUEST).memberId = "different-member";
    });
    await assert.rejects(() => f.save(data)); assert.equal(f.writes.length, 0); assertNoExternalCalls(f);
  });
}

for (const entry of ["generate", "trigger"] as const) {
  test(`${entry}: health review remains pending without automatic draft or external processing`, async () => {
    const f = fixture(); f.seedSubmitted({ healthFlags: ["임신·수유"] });
    f.values.get(RESPONSE).reviewReasons = ["health_safety_review_required"];
    const response = clone(f.values.get(RESPONSE));
    assert.deepEqual(plain(await f[entry]()), operatorRequired);
    assert.equal(f.values.get(REQUEST).recommendationStatus, "review_required");
    assert.deepEqual(f.values.get(RESPONSE), response);
    assert.equal(f.values.has(DRAFT), false); assert.equal(f.values.has(REPORT), false); assertNoExternalCalls(f);
  });
  test(`${entry}: a report-only legacy record is preserved without marking or creating a draft`, async () => {
    const f = fixture(); f.seedSubmitted();
    f.values.set(REPORT, { publicationStatus: "published", publishedSnapshot: { revision: "legacy-keep" } });
    const before = clone([...f.values]);
    assert.deepEqual(plain(await f[entry]()), operatorRequired);
    assert.deepEqual([...f.values], before); assert.equal(f.writes.length, 0); assertNoExternalCalls(f);
  });
  for (const field of ["studioId", "memberId"]) {
    test(`${entry}: mismatched canonical response ${field} is rejected`, async () => {
      const f = fixture(); f.seedSubmitted(); f.values.get(RESPONSE)[field] = "different-source";
      await assert.rejects(() => f[entry]()); assert.equal(f.writes.length, 0); assertNoExternalCalls(f);
    });
  }
}

for (const existingDraft of [false, true]) {
  test(`failed commit rolls back ${existingDraft ? "edit and history" : "first draft"} without partial canonical saves`, async () => {
    const f = fixture(); f.seedSubmitted(); if (existingDraft) seedDraft(f);
    const before = clone([...f.values]); f.failCommit();
    await assert.rejects(() => f.save(), /synthetic_commit_failure_rollback/);
    assert.deepEqual([...f.values], before); assert.equal(f.writes.length, 0); assert.equal(f.commits.length, 0);
    assertNoExternalCalls(f);
  });
}

test("a response changed after transaction reads aborts the complete staged save", async () => {
  const f = fixture(); f.seedSubmitted(); seedDraft(f); const draft = clone(f.values.get(DRAFT));
  f.beforeCommit(() => { f.values.get(RESPONSE).answers.primaryGoal = "체지방 감량"; });
  await assert.rejects(() => f.save(), /synthetic_transaction_conflict_rollback/);
  assert.deepEqual(f.values.get(DRAFT), draft); assert.equal(f.writes.length, 0); assertNoExternalCalls(f);
});

test("two concurrent first-draft saves admit at most one matching expectedRevision", async () => {
  const f = fixture(); f.seedSubmitted(); const first = f.saveData(); const second = f.saveData();
  first.publicContent.summary = "First editor"; second.publicContent.summary = "Second editor";
  const results = await Promise.allSettled([f.save(first), f.save(second)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.filter(r => r.status === "rejected").length, 1);
  const winner = results[0].status === "fulfilled" ? first : second;
  assert.equal(f.values.get(DRAFT).publicContent.summary, winner.publicContent.summary);
  assert.equal(f.commits.length, 1); assert.equal(f.writes.length, 3); assertNoExternalCalls(f);
});

for (const issue of ["missing content", "six days", "missing lunch"]) {
  test(`invalid first-draft content rejected with no writes: ${issue}`, async () => {
    const f = fixture(); f.seedSubmitted(); const data = f.saveData();
    if (issue === "missing content") delete data.publicContent;
    if (issue === "six days") data.publicContent.days.pop();
    if (issue === "missing lunch") delete data.publicContent.days[0].lunch;
    await assert.rejects(() => f.save(data)); assert.equal(f.writes.length, 0); assertNoExternalCalls(f);
  });
}

test("new legacy free-text submissions cannot bypass the required updated choice/AI consent", async () => {
  const f = fixture();
  const legacy = { schemaVersion: "legacy-v1", consentVersion: undefined, aiProcessingConsent: undefined,
    primaryGoal: "PRIVATE_FREE_TEXT", wakeTime: "07:00", sleepTime: "23:00", sleepQuality: "good",
    workType: "desk", workIntensity: "light", mealsPerDay: "3", breakfastPattern: "normal",
    lateNightFrequency: "none", eatingOutFrequency: "none", cookingAccess: "home", allergies: ["없음"],
    avoidFoods: "없음", alcoholFrequency: "none", smokingStatus: "none", medicalConditions: "없음",
    medications: "없음", pregnancyStatus: "없음", eatingDisorderHistory: "없음", consent: true };
  const result = await f.call("POST", { body: legacy });
  assert.ok(result.statusCode >= 400, "New responses must use v2; preserving submitted history must not authorize new legacy submissions");
  assert.equal(f.writes.length, 0);
});
