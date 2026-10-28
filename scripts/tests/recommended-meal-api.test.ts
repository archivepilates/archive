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
function fixture(options: Record<string, any> = {}) {
  let clock = NOW;
  class Clock extends Date {
    constructor(value: any = clock) { super(value); }
    static now() { return clock; }
  }
  const values = new Map<string, any>();
  const writes: any[] = [];
  const reads: string[] = [];
  const http: any[] = [];
  const commits: any[][] = [];
  let afterGeneration: (() => void) | undefined;
  let beforeTransaction: (() => void) | undefined;
  let transactionTail = Promise.resolve();
  const snap = (path: string) => {
    reads.push(path);
    return { exists: values.has(path), data: () => clone(values.get(path)) };
  };
  const apply = (path: string, value: any, merge: boolean) => {
    assert.ok([REQUEST, RESPONSE, DRAFT, REPORT].includes(path), `Unscoped memory write: ${path}`);
    values.set(path, merge ? { ...values.get(path), ...clone(value) } : clone(value));
    writes.push({ path, value: clone(value), merge });
  };
  const doc = (path: string) => ({ path, get: async () => snap(path),
    set: async (value: any, opts: any = {}) => apply(path, value, !!opts.merge) });
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
      try {
        const hook = beforeTransaction; beforeTransaction = undefined; hook?.();
        const result = await callback({
          get: async (ref: any) => { assert.equal(pending.length, 0); return snap(ref.path); },
          set: (ref: any, value: any, opts: any = {}) => pending.push([ref.path, value, !!opts.merge]),
          update: (ref: any, value: any) => pending.push([ref.path, value, true]),
        });
        for (const [path, value, merge] of pending) apply(path, value, merge);
        commits.push(pending.map(([path]) => path));
        return result;
      } finally { release(); }
    },
  };
  const generated = {
    title: "Synthetic plan", summary: "Synthetic summary", goal: "Synthetic goal", metricsSummary: "Synthetic metrics",
    principles: ["Synthetic principle"], hydration: "Synthetic water", exerciseNutrition: "Synthetic exercise",
    weekendStrategy: "Synthetic weekend", caution: "Synthetic caution",
    days: Array.from({ length: 7 }, (_, i) => ({ day: i + 1, label: `Day ${i + 1}`, breakfast: "Synthetic breakfast",
      lunch: "Synthetic lunch", dinner: "Synthetic dinner", snack: "Synthetic snack", timingTip: "Synthetic timing" })),
  };
  const fakeFetch = async (url: any, init: any = {}) => {
    const endpoint = String(url); http.push({ url: endpoint, ...init });
    if (endpoint.startsWith("https://apikeys.googleapis.com/")) {
      const status = options.lookupStatus || 200;
      return { ok: status === 200, status, json: async () => Object.hasOwn(options, "identity") ? options.identity
        : { parent: "projects/123456789/locations/global", name: "projects/123456789/locations/global/keys/synthetic" } };
    }
    if (endpoint === "https://cloudbilling.googleapis.com/v1/projects/123456789/billingInfo") {
      const status = options.billingStatus || 200;
      return { ok: status === 200, status, json: async () => Object.hasOwn(options, "billing") ? options.billing : { billingEnabled: false } };
    }
    assert.equal(endpoint, "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent", "Never use a paid/alternate model");
    assert.equal(init.method, "POST");
    return { ok: !options.generationFailure, status: options.generationFailure ? 503 : 200,
      text: async () => {
        afterGeneration?.();
        return JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(generated) }] } }] });
      } };
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
  const credential = { getAccessToken: async () => ({ access_token: "synthetic-bearer-never-real" }) };
  const program = evaluate("mealPlan/recommendedMealProgram", {
    ...shared, "./recommendedMealSurvey": survey,
    "firebase-admin/app": { getApp: () => ({ options: { credential } }), applicationDefault: () => { throw new Error("ADC forbidden in pure tests"); } },
    "../config/secrets": { geminiApiKey: { value: () => "synthetic-key-never-real" } },
    "../utils/hash": hash,
  }, globals);
  const answers = () => ({
    ...Object.fromEntries(Object.entries(policy.MEAL_CHOICES).map(([key, choices]: any) =>
      [key, ["snackPattern", "allergies", "preferredFoods", "healthFlags"].includes(key) ? [choices[0]] : choices[0]])),
    schemaVersion: policy.MEAL_CHOICE_SCHEMA, consentVersion: policy.MEAL_CHOICE_CONSENT,
    consent: true, aiProcessingConsent: true,
  });
  values.set(REQUEST, {
    requestId: ID, studioId: "5330", memberId: "synthetic-native-id", memberName: "PRIVATE_NAME_SENTINEL",
    memberPhone: "PRIVATE_PHONE_SENTINEL", status: "sent", accessTokenHash: survey.recommendedMealAccessTokenHash(TOKEN),
    expiresAt: new Stamp(NOW + 86400000), inbody: { status: "missing" },
  });
  const seedSubmitted = (overrides = {}) => {
    values.get(REQUEST).status = "submitted";
    values.set(RESPONSE, { requestId: ID, answers: { ...answers(), ...overrides }, reviewReasons: [], inbody: { status: "missing" } });
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
  return { values, writes, reads, http, commits, policy, survey, program, hash, answers, seedSubmitted, call,
    beforeTransaction: (hook: () => void) => { beforeTransaction = hook; }, clock: (ms: number) => { clock = ms; },
    afterGeneration: (hook: () => void) => { afterGeneration = hook; },
    generate: () => program.generateRecommendedMealProgramDraftHandler({ data: { requestId: ID } }, ACTOR),
    generationCalls: () => http.filter(row => row.url.includes(":generateContent")),
  };
}

test("actual GET authenticates and returns current choice/consent versions without private source data", async () => {
  const f = fixture(); const result = await f.call("GET");
  assert.equal(result.statusCode, 200); assert.equal(result.body.ok, true);
  assert.equal(result.body.surveySchemaVersion, "meal-choice-v2");
  assert.equal(result.body.consentVersion, "meal-preferences-gemini-v1-20261029");
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

for (const [name, options] of [
  ["lookup403", { lookupStatus: 403 }], ["invalid key", { lookupStatus: 400 }],
  ["unknown key project", { identity: {} }], ["billing403", { billingStatus: 403 }],
  ["paid", { billing: { billingEnabled: true, billingAccountName: "billingAccounts/synthetic" } }],
  ["unknown billing", { billing: {} }],
] as const) {
  test(`actual program: ${name} free-gate failure makes zero generation calls and no paid fallback`, async () => {
    const f = fixture(options); f.seedSubmitted();
    await f.generate();
    assert.equal(f.generationCalls().length, 0);
    assert.equal(f.values.get(DRAFT).provider, "safe_fallback");
    assert.equal(f.values.get(DRAFT).model, "rule-based-v1");
    assert.match(f.values.get(DRAFT).generationError, /^gemini_/);
  });
}

test("actual external generation body excludes health, InBody, identity and legacy free text", async () => {
  const f = fixture(); f.seedSubmitted({ medicalConditions: "PRIVATE_HEALTH_SENTINEL", medications: "PRIVATE_DRUG_SENTINEL",
    additionalNote: "PRIVATE_TEXT_SENTINEL", inbody: { bmi: 123, weightKg: 999 }, memberId: "PRIVATE_ID_SENTINEL" });
  f.values.get(RESPONSE).inbody = { eventId: "synthetic-event" };
  f.values.set("inbodyWebhookEvents/synthetic-event", { measurementId: "synthetic-measurement" });
  f.values.set("inbodyMeasurements/synthetic-measurement", { summary: { bmi: 123, weightKg: 999, bodyFatPercent: 88 } });
  await f.generate();
  assert.equal(f.generationCalls().length, 1);
  const call = f.generationCalls()[0]; const body = JSON.parse(call.body);
  assert.equal(call.headers["X-goog-api-key"], "synthetic-key-never-real");
  assert.doesNotMatch(call.body, /PRIVATE_|weightKg|bodyFatPercent|"bmi"|medicalConditions|medications|additionalNote|allergies|healthFlags|consentVersion/);
  assert.ok(body.contents[0].parts[0].text.includes("식사 습관 개선"));
  assert.equal(f.values.get(DRAFT).provider, "gemini");
  assert.equal(f.values.get(DRAFT).model, "gemini-2.5-flash-lite");
  assert.deepEqual(f.commits.at(-1), [DRAFT, REPORT, REQUEST], "Final draft/report/request saves are atomic");
});

for (const issue of ["published", "sent", "cancelled", "missing request", "no longer submitted"]) {
  test(`final generation save rechecks ${issue} and never overwrites a changed live state`, async () => {
    const f = fixture(); f.seedSubmitted();
    f.values.set(DRAFT, { preserved: "synthetic-existing-draft" });
    f.afterGeneration(() => {
      if (["published", "sent"].includes(issue)) f.values.set(REPORT, { publicationStatus: issue, approvedRevision: "synthetic-keep" });
      if (issue === "cancelled") f.values.get(REQUEST).status = "cancelled";
      if (issue === "missing request") f.values.delete(REQUEST);
      if (issue === "no longer submitted") f.values.get(REQUEST).status = "queued";
    });
    await assert.rejects(() => f.generate());
    assert.deepEqual(f.values.get(DRAFT), { preserved: "synthetic-existing-draft" });
    assert.equal(f.writes.filter(row => [DRAFT, REPORT].includes(row.path)).length, 0);
    assert.equal(f.generationCalls().length, 1);
    if (["published", "sent"].includes(issue)) assert.equal(f.values.get(REPORT).publicationStatus, issue);
  });
}

test("failed free generation does not try another model or overwrite the daily claim", async () => {
  const f = fixture({ generationFailure: true }); f.seedSubmitted();
  await f.generate();
  assert.equal(f.generationCalls().length, 1);
  assert.match(f.values.get(DRAFT).generationError, /gemini_generation_http_503/);
  const claim = clone(f.values.get(REQUEST).mealAiGenerationAttempt);
  f.values.get(RESPONSE).answers.primaryGoal = "체지방 감량";
  const before = f.writes.length; const draft = clone(f.values.get(DRAFT));
  const result = await f.generate();
  assert.equal(result.status, "generation_in_progress_or_daily_limit");
  assert.deepEqual(f.values.get(DRAFT), draft); assert.equal(f.writes.length, before);
  assert.deepEqual(f.values.get(REQUEST).mealAiGenerationAttempt, claim);
  assert.equal(f.generationCalls().length, 1);
});

test("matching draft sourceHash is reused without any metadata/generation requests or writes", async () => {
  const f = fixture({ lookupStatus: 403 }); f.seedSubmitted();
  await f.generate(); const draft = clone(f.values.get(DRAFT));
  const httpBefore = f.http.length; const writesBefore = f.writes.length;
  const result = await f.generate();
  assert.equal(result.reused, true);
  assert.deepEqual(f.values.get(DRAFT), draft); assert.equal(f.http.length, httpBefore); assert.equal(f.writes.length, writesBefore);
});

for (const [name, overrides] of [
  ["allergy", { allergies: ["견과류"] }], ["health", { healthFlags: ["임신·수유"] }],
  ["old consent", { consentVersion: "legacy-v1" }], ["no AI consent", { aiProcessingConsent: false }],
] as const) {
  test(`actual program: ${name} blocks all external model and metadata calls`, async () => {
    const f = fixture(); f.seedSubmitted(overrides); await f.generate();
    assert.equal(f.http.length, 0); assert.notEqual(f.values.get(DRAFT).provider, "gemini");
    if (name === "health" || name === "allergy") {
      assert.match(f.values.get(DRAFT).publicContent.days[0].lunch, /안전한/);
      assert.doesNotMatch(f.values.get(DRAFT).publicContent.days[0].lunch, /닭가슴살|견과|우유/);
    }
  });
}

const fallbackScenarios: [string, any, (content: any) => void][] = [
  ["convenience", { mainMealSource: "편의점·간편식" }, c => c.days.forEach((d: any) => { assert.match(d.lunch, /편의점/); assert.match(d.dinner, /간편식/); })],
  ["restaurant", { mainMealSource: "식당·배달" }, c => c.days.forEach((d: any) => { assert.match(d.lunch, /식당·배달/); assert.match(d.dinner, /식당·배달/); })],
  ["cafeteria", { mainMealSource: "구내식당·급식" }, c => c.days.forEach((d: any) => assert.match(d.lunch, /구내식당/))],
  ["microwave", { cookingAccess: "전자레인지·조립만 가능" }, c => c.days.forEach((d: any) => { assert.match(d.lunch, /조리 없이/); assert.match(d.dinner, /전자레인지/); })],
  ["no cook", { cookingAccess: "조리 어려움" }, c => c.days.forEach((d: any) => assert.match(d.lunch, /조리 없이/))],
  ["budget", { mealBudget: "하루 1만원 이하" }, c => c.days.forEach((d: any) => { assert.match(d.lunch, /같은 재료/); assert.match(d.dinner, /남은 재료/); })],
  ["breakfast skip", { breakfastPattern: "거의 거름" }, c => c.days.forEach((d: any) => assert.match(d.breakfast, /아침이 부담/))],
  ["quick cooking", { cookingAccess: "10분 이내 간단 조리" }, c => c.days.forEach((d: any) => assert.match(d.breakfast, /구운 달걀 또는 두부/))],
  ["shift work", { mealBreakWindow: "교대·야간근무" }, c => c.days.forEach((d: any) => assert.match(d.timingTip, /근무 중/))],
  ["late dinner", { mealBreakWindow: "저녁 21시 이후" }, c => c.days.forEach((d: any) => assert.match(d.timingTip, /늦은 식사/))],
  ["no snacks", { snackPattern: ["거의 없음"] }, c => c.days.forEach((d: any) => assert.match(d.snack, /간식은 생략/))],
];
for (const [name, overrides, check] of fallbackScenarios) {
  test(`actual deterministic fallback respects ${name} fixed choice across all 7 days`, async () => {
    const f = fixture({ lookupStatus: 403 }); f.seedSubmitted(overrides); await f.generate();
    const content = f.values.get(DRAFT).publicContent;
    assert.equal(content.days.length, 7); check(content); assert.equal(f.generationCalls().length, 0);
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
