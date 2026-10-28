export const MEAL_CHOICE_SCHEMA = "meal-choice-v2";
export const MEAL_CHOICE_CONSENT = "meal-preferences-gemini-v1-20261029";
export const MEAL_FREE_MODEL = "gemini-2.5-flash-lite";

export const MEAL_CHOICES: Record<string, readonly string[]> = {
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
const MULTI: Record<string, { max: number; none: string }> = {
  snackPattern: { max: 3, none: "거의 없음" },
  allergies: { max: 7, none: "없음" },
  preferredFoods: { max: 3, none: "특별한 선호 없음" },
  healthFlags: { max: 5, none: "해당 없음" },
};

export function parseMealChoices(body: Record<string, unknown>): Record<string, unknown> {
  if (body.schemaVersion !== MEAL_CHOICE_SCHEMA || body.consentVersion !== MEAL_CHOICE_CONSENT
    || body.consent !== true || body.aiProcessingConsent !== true) {
    throw new Error("최신 정보 활용 안내를 확인하고 동의해 주세요.");
  }
  const answers: Record<string, unknown> = {};
  for (const [key, allowed] of Object.entries(MEAL_CHOICES)) {
    const value = body[key];
    const rule = MULTI[key];
    if (rule) {
      if (!Array.isArray(value) || !value.length || value.length > rule.max
        || new Set(value).size !== value.length || value.some(v => typeof v !== "string" || !allowed.includes(v))
        || value.includes(rule.none) && value.length !== 1) throw new Error("모든 질문의 선택 항목을 확인해 주세요.");
      answers[key] = [...value];
    } else {
      if (typeof value !== "string" || !allowed.includes(value)) throw new Error("모든 질문의 선택 항목을 확인해 주세요.");
      answers[key] = value;
    }
  }
  return { ...answers, schemaVersion: MEAL_CHOICE_SCHEMA, consentVersion: MEAL_CHOICE_CONSENT,
    consent: true, aiProcessingConsent: true };
}

// Exact fixed-choice allowlist, never recursive redaction of arbitrary member records.
export function mealGenerationPreferences(answers: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, allowed] of Object.entries(MEAL_CHOICES)) {
    if (key === "allergies" || key === "healthFlags") continue;
    const value = answers[key];
    if (MULTI[key]) {
      if (Array.isArray(value) && value.length <= MULTI[key].max
        && value.every(v => typeof v === "string" && allowed.includes(v))) safe[key] = value;
    } else if (typeof value === "string" && allowed.includes(value)) safe[key] = value;
  }
  return safe;
}

export function mealChoiceReviewReasons(answers: Record<string, unknown>): string[] {
  const flags = Array.isArray(answers.healthFlags) ? answers.healthFlags : [];
  const allergies = Array.isArray(answers.allergies) ? answers.allergies : [];
  return [
    ...(flags.some(v => v !== "해당 없음") ? ["health_safety_review_required"] : []),
    ...(allergies.some(v => v !== "없음") ? ["allergy_reported"] : []),
  ];
}

export function mealAiConsentCurrent(answers: Record<string, unknown>): boolean {
  return answers.schemaVersion === MEAL_CHOICE_SCHEMA && answers.consentVersion === MEAL_CHOICE_CONSENT
    && answers.consent === true && answers.aiProcessingConsent === true;
}

/** Read-only Google metadata checks; no generation on paid, unknown or denied billing. */
export async function assertFreeGeminiProject(apiKey: string, bearer: string, fetcher: typeof fetch = fetch): Promise<string> {
  const headers = { Authorization: `Bearer ${bearer}` };
  const lookup = await fetcher(`https://apikeys.googleapis.com/v2/keys:lookupKey?keyString=${encodeURIComponent(apiKey)}`,
    { headers, signal: AbortSignal.timeout(10000) });
  if (!lookup.ok) throw new Error("gemini_free_tier_identity_unverified");
  const identity = await lookup.json() as { parent?: string; name?: string };
  const match = /^projects\/([0-9]+)\/locations\/global$/.exec(identity.parent || "");
  if (!match || !identity.name?.startsWith(`${identity.parent}/keys/`)) throw new Error("gemini_free_tier_identity_unverified");
  const billing = await fetcher(`https://cloudbilling.googleapis.com/v1/projects/${match[1]}/billingInfo`,
    { headers, signal: AbortSignal.timeout(10000) });
  if (!billing.ok) throw new Error("gemini_free_tier_billing_unverified");
  const info = await billing.json() as { billingEnabled?: boolean; billingAccountName?: string };
  if (info.billingEnabled !== false || info.billingAccountName) throw new Error("gemini_paid_or_unknown_billing_blocked");
  return match[1];
}
