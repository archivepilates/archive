import assert from "node:assert/strict";
import test from "node:test";
import {
  MEAL_CHOICES, MEAL_CHOICE_SCHEMA, MEAL_CHOICE_CONSENT, MEAL_FREE_MODEL,
  parseMealChoices, mealGenerationPreferences, mealChoiceReviewReasons,
  mealAiConsentCurrent, assertFreeGeminiProject,
} from "../../firebase/kangsain-functions/functions/src/mealPlan/recommendedMealChoicePolicy";

const expected = {
  primaryGoal: ["식사 습관 개선", "체지방 감량", "근육·체력 유지", "현재 체중 유지"],
  mealsPerDay: ["1~2회", "3회", "4회 이상", "불규칙"],
  breakfastPattern: ["일반 식사", "간단히 먹음", "거의 거름"],
  mainMealSource: ["집밥·도시락", "구내식당·급식", "식당·배달", "편의점·간편식"],
  cookingAccess: ["20분 이내 조리 가능", "10분 이내 간단 조리", "전자레인지·조립만 가능", "조리 어려움"],
  mealBudget: ["하루 1만원 이하", "하루 1만~2만원", "하루 2만원 이상", "큰 제한 없음"],
  mealBreakWindow: ["대체로 일정", "저녁 21시 이후", "교대·야간근무", "매일 다름"],
  workIntensity: ["주로 앉아서 생활", "서 있거나 가끔 이동", "활동·이동이 많음"],
  exerciseSchedule: ["주로 오전", "주로 오후", "주로 저녁", "일정하지 않음·운동 안 함"],
  snackPattern: ["거의 없음", "단 간식·음료", "야식", "음주·술자리"],
  allergies: ["없음", "우유·유제품", "달걀", "견과류", "밀·글루텐", "해산물", "기타·잘 모름"],
  preferredFoods: ["특별한 선호 없음", "한식", "면류", "빵·샌드위치", "고기·생선", "두부·콩"],
  healthFlags: ["해당 없음", "질환·약물로 식사 제한", "임신·수유", "섭식 관련 치료 경험", "만 18세 미만", "전문가 상담이 먼저 필요"],
};
const multi = { snackPattern: 3, allergies: 7, preferredFoods: 3, healthFlags: 5 };
const valid = (): Record<string, any> => ({
  ...Object.fromEntries(Object.entries(expected).map(([key, values]) => [key, key in multi ? [values[0]] : values[0]])),
  schemaVersion: MEAL_CHOICE_SCHEMA, consentVersion: MEAL_CHOICE_CONSENT,
  consent: true, aiProcessingConsent: true,
});

test("contract pins exactly 13 fixed-choice questions, consent versions and the free model", () => {
  assert.deepEqual(MEAL_CHOICES, expected);
  assert.equal(Object.keys(MEAL_CHOICES).length, 13);
  assert.equal(MEAL_CHOICE_SCHEMA, "meal-choice-v2");
  assert.equal(MEAL_CHOICE_CONSENT, "meal-preferences-operator-v1-20261029");
  assert.equal(MEAL_FREE_MODEL, "gemini-2.5-flash-lite");
  assert.deepEqual(parseMealChoices(valid()), valid());
});

for (const [key, choices] of Object.entries(expected)) {
  test(`${key}: every fixed choice accepted without coercion`, () => {
    for (const choice of choices) {
      const body = { ...valid(), [key]: key in multi ? [choice] : choice };
      assert.deepEqual(parseMealChoices(body), body);
    }
  });
  test(`${key}: missing, arbitrary text and wrong-shaped answers rejected`, () => {
    for (const value of [undefined, null, "", "PRIVATE_SENTINEL", 0, true, {}, { value: choices[0] }, ["PRIVATE_SENTINEL"], [null], [choices[0], {}]]) {
      assert.throws(() => parseMealChoices({ ...valid(), [key]: value }), undefined, `${key}: ${JSON.stringify(value)}`);
    }
    const body = valid(); delete body[key];
    assert.throws(() => parseMealChoices(body));
    if (!(key in multi)) assert.throws(() => parseMealChoices({ ...valid(), [key]: [choices[0]] }));
  });
}

for (const [key, max] of Object.entries(multi)) {
  test(`${key}: required nonempty, unique, bounded array and exclusive none`, () => {
    const choices = expected[key as keyof typeof expected];
    for (const value of [choices[0], [], [choices[0], choices[1]], [choices[1], choices[1]], Array(max + 1).fill(choices[1])]) {
      assert.throws(() => parseMealChoices({ ...valid(), [key]: value }));
    }
    const boundary = choices.slice(1, max + 1);
    assert.deepEqual(parseMealChoices({ ...valid(), [key]: boundary })[key], boundary);
    const body = { ...valid(), [key]: boundary };
    const parsed = parseMealChoices(body);
    assert.notEqual(parsed[key], boundary, "Persisted arrays are detached from incoming payload");
    assert.deepEqual(body[key], boundary);
  });
}

for (const key of ["schemaVersion", "consentVersion", "consent", "aiProcessingConsent"]) {
  test(`${key}: exact current explicit consent required`, () => {
    for (const value of [undefined, null, false, 0, 1, "true", "false", "legacy-v1", {}, []]) {
      const body = { ...valid(), [key]: value };
      assert.equal(mealAiConsentCurrent(body), false);
      assert.throws(() => parseMealChoices(body));
    }
    assert.equal(mealAiConsentCurrent(valid()), true);
  });
}

test("parser discards all injected legacy, health, identity and nested fields", () => {
  const body = { ...valid(), memberId: "PRIVATE_ID", memberPhone: "PRIVATE_PHONE", memberName: "PRIVATE_NAME",
    medicalConditions: "PRIVATE_HEALTH", medications: "PRIVATE_MEDICATION", goalDetail: "PRIVATE_TEXT",
    additionalNote: "PRIVATE_NOTE", inbody: { weightKg: 123, secret: "PRIVATE_INBODY" },
    answers: { primaryGoal: "PRIVATE_NESTED" }, __proto__: { injected: "PRIVATE_PROTO" } };
  const before = JSON.stringify(body);
  assert.deepEqual(parseMealChoices(body), valid());
  assert.equal(JSON.stringify(body), before);
});

test("generation allowlist excludes consent, allergies, health, InBody, identity and arbitrary text", () => {
  const body = { ...valid(), allergies: ["견과류"], healthFlags: ["임신·수유"],
    memberName: "PRIVATE_NAME", phone: "PRIVATE_PHONE", memberId: "PRIVATE_ID", accessToken: "PRIVATE_TOKEN",
    inbody: { bmi: 99 }, medicalConditions: "PRIVATE_HEALTH", medications: "PRIVATE_MEDICATION",
    avoidFoods: "PRIVATE_EXCLUSION", additionalNote: "PRIVATE_NOTE", nested: { goal: "PRIVATE_NESTED" } };
  const result = mealGenerationPreferences(body);
  assert.deepEqual(Object.keys(result).sort(), Object.keys(expected).filter(k => !["allergies", "healthFlags"].includes(k)).sort());
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|inbody|bmi|allergies|healthFlags|consent|member|accessToken/i);
  assert.deepEqual(result.primaryGoal, valid().primaryGoal);
});

test("legacy and malformed preference values cannot escape into model data", () => {
  const legacy = { primaryGoal: "PRIVATE_GOAL", preferredFoods: "PRIVATE_FOODS", snackPattern: "PRIVATE_SNACK",
    workIntensity: { name: "PRIVATE_NAME" }, exerciseSchedule: ["PRIVATE_TEXT"],
    allergies: "PRIVATE_HEALTH", healthFlags: { diagnosis: "PRIVATE_HEALTH" }, inbody: "PRIVATE_INBODY" };
  assert.deepEqual(mealGenerationPreferences(legacy), {});
  assert.deepEqual(mealGenerationPreferences({}), {});
  for (const key of Object.keys(expected)) {
    for (const value of [null, undefined, 123, true, {}, ["PRIVATE_TEXT"], [expected[key as keyof typeof expected][0], "PRIVATE_TEXT"]]) {
      assert.doesNotMatch(JSON.stringify(mealGenerationPreferences({ [key]: value })), /PRIVATE_/);
    }
  }
});

test("every health and allergy exclusion yields a review reason, including unsure", () => {
  assert.deepEqual(mealChoiceReviewReasons(valid()), []);
  for (const flag of expected.healthFlags.slice(1)) {
    assert.deepEqual(mealChoiceReviewReasons({ ...valid(), healthFlags: [flag] }), ["health_safety_review_required"]);
  }
  for (const allergy of expected.allergies.slice(1)) {
    assert.deepEqual(mealChoiceReviewReasons({ ...valid(), allergies: [allergy] }), ["allergy_reported"]);
  }
  assert.deepEqual(mealChoiceReviewReasons({ ...valid(), healthFlags: expected.healthFlags.slice(1), allergies: expected.allergies.slice(1) }),
    ["health_safety_review_required", "allergy_reported"]);
});

const identity = { parent: "projects/123456789/locations/global", name: "projects/123456789/locations/global/keys/synthetic-key-id" };
const free = { billingEnabled: false };
const denied = [
  { name: "lookup permission denied", lookupStatus: 403 },
  { name: "invalid key", lookupStatus: 400 },
  { name: "lookup unavailable", lookupStatus: 503 },
  { name: "missing key project", identity: {} },
  { name: "nonnumeric key project", identity: { ...identity, parent: "projects/unknown/locations/global" } },
  { name: "non-global key", identity: { ...identity, parent: "projects/123456789/locations/us" } },
  { name: "different key project", identity: { ...identity, name: "projects/999/locations/global/keys/key" } },
  { name: "missing key name", identity: { parent: identity.parent } },
  { name: "billing permission denied", billingStatus: 403 },
  { name: "billing unknown", billing: {} },
  { name: "paid project", billing: { billingEnabled: true, billingAccountName: "billingAccounts/synthetic" } },
  { name: "attached account even disabled", billing: { billingEnabled: false, billingAccountName: "billingAccounts/synthetic" } },
  { name: "nonboolean billing metadata", billing: { billingEnabled: "false" } },
  { name: "null billing metadata", billing: null },
];
for (const scenario of denied) {
  test(`free metadata gate denies ${scenario.name}, only bounded read-only metadata calls`, async () => {
    const calls: string[] = [];
    const fakeFetch = async (url: any, options: any) => {
      assert.ok(!options.method || options.method === "GET");
      assert.equal(options.body, undefined);
      assert.equal(options.headers.Authorization, "Bearer synthetic-bearer");
      calls.push(String(url));
      const lookup = String(url).startsWith("https://apikeys.googleapis.com/");
      assert.ok(lookup || String(url) === "https://cloudbilling.googleapis.com/v1/projects/123456789/billingInfo", "No generation endpoint");
      const status = lookup ? scenario.lookupStatus || 200 : scenario.billingStatus || 200;
      return { ok: status === 200, json: async () => lookup
        ? (Object.hasOwn(scenario, "identity") ? scenario.identity : identity)
        : (Object.hasOwn(scenario, "billing") ? scenario.billing : free) };
    };
    await assert.rejects(() => assertFreeGeminiProject("synthetic-not-an-api-key", "synthetic-bearer", fakeFetch as typeof fetch));
    assert.ok(calls.length >= 1 && calls.length <= 2);
    if (scenario.lookupStatus || Object.hasOwn(scenario, "identity")) assert.equal(calls.length, 1);
  });
}

test("free gate permits only explicit unattached billing=false and returns verified numeric project", async () => {
  const calls: string[] = [];
  const result = await assertFreeGeminiProject("synthetic & key", "synthetic-bearer", (async (url: any) => {
    calls.push(String(url)); return { ok: true, json: async () => calls.length === 1 ? identity : free };
  }) as typeof fetch);
  assert.equal(result, "123456789");
  assert.equal(calls.length, 2);
  assert.ok(calls[0].includes("keyString=synthetic%20%26%20key"));
});

test("transport or invalid JSON metadata fails closed without another request", async () => {
  for (const invalidJson of [false, true]) {
    let calls = 0;
    await assert.rejects(() => assertFreeGeminiProject("synthetic-key", "synthetic-bearer", (async () => {
      calls++;
      if (!invalidJson) throw new Error("synthetic network failure");
      return { ok: true, json: async () => { throw new Error("synthetic invalid json"); } };
    }) as typeof fetch));
    assert.equal(calls, 1);
  }
});
