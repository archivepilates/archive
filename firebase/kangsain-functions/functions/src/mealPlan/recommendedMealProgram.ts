import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import type { Request, Response } from "express";
import type { CallableRequest } from "firebase-functions/v2/https";
import { DEFAULT_STUDIO_ID } from "../config/constants";
import { db } from "../config/firebase";
import { geminiApiKey } from "../config/secrets";
import type { StaffDoc } from "../types/models";
import { nowTimestamp } from "../utils/date";
import { AppError, errorMessage } from "../utils/errors";
import { stableHash } from "../utils/hash";
import {
  RECOMMENDED_MEAL_REQUEST_COLLECTION,
  RECOMMENDED_MEAL_RESPONSE_COLLECTION,
} from "./recommendedMealSurvey";

export const RECOMMENDED_MEAL_DRAFT_COLLECTION = "recommendedMealProgramDrafts";
export const RECOMMENDED_MEAL_REPORT_COLLECTION = "recommendedMealProgramReports";
export const RECOMMENDED_MEAL_REPORT_EXPIRES_DAYS = 90;

const GEMINI_GENERATE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_MODELS = ["gemini-2.5-flash-lite", "gemini-2.5-flash"];
const REPORT_BASE_URL = "https://in.archivepilates.com/recommendedMealPlan/";

export interface RecommendedMealDay {
  day: number;
  label: string;
  breakfast: string;
  lunch: string;
  dinner: string;
  snack: string;
  timingTip: string;
}

export interface RecommendedMealPublicContent {
  title: string;
  summary: string;
  goal: string;
  metricsSummary: string;
  principles: string[];
  days: RecommendedMealDay[];
  hydration: string;
  exerciseNutrition: string;
  weekendStrategy: string;
  caution: string;
}

type RecommendedMealActor = Pick<StaffDoc, "uid" | "name" | "studioId">;

export async function getRecommendedMealProgramReviewHandler(
  request: CallableRequest,
  staff: StaffDoc,
): Promise<Record<string, unknown>> {
  const requestId = cleanRequestId((request.data as Record<string, unknown> | undefined)?.requestId);
  const bundle = await loadReviewBundle(requestId, staff);
  return {
    ok: true,
    request: safeRequestForOperator(bundle.request),
    response: bundle.response
      ? {
          requestId,
          answers: bundle.response.answers || {},
          reviewReasons: stringArray(bundle.response.reviewReasons, 20, 80),
          recommendationStatus: cleanText(bundle.response.recommendationStatus, 80),
          submittedAt: timestampIso(bundle.response.submittedAt),
        }
      : null,
    inbody: bundle.inbody,
    draft: safeDraftForOperator(bundle.draft),
    report: safeReportForOperator(bundle.report),
  };
}

export async function generateRecommendedMealProgramDraftHandler(
  request: CallableRequest,
  staff: StaffDoc,
): Promise<Record<string, unknown>> {
  const requestId = cleanRequestId((request.data as Record<string, unknown> | undefined)?.requestId);
  return generateRecommendedMealProgramDraftForRequest(requestId, staff, { force: true });
}

export async function generateRecommendedMealProgramDraftForSubmittedResponse(
  responseId: string,
  responseData: FirebaseFirestore.DocumentData,
): Promise<Record<string, unknown>> {
  const requestId = cleanRequestId(responseId);
  const studioId = cleanText(responseData.studioId, 80) || DEFAULT_STUDIO_ID;
  try {
    return await generateRecommendedMealProgramDraftForRequest(
      requestId,
      { uid: "system", name: "설문 제출 자동 생성", studioId },
      { force: false },
    );
  } catch (err) {
    const message = errorMessage(err).slice(0, 400);
    await db.collection(RECOMMENDED_MEAL_REQUEST_COLLECTION).doc(requestId).set(
      {
        recommendationStatus: "draft_failed",
        recommendationLastError: message,
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
    throw err;
  }
}

async function generateRecommendedMealProgramDraftForRequest(
  requestId: string,
  actor: RecommendedMealActor,
  options: { force: boolean },
): Promise<Record<string, unknown>> {
  const bundle = await loadReviewBundle(requestId, actor);
  if (!bundle.response) throw new AppError("INVALID_ARGUMENT", "회원 설문 제출 후 식단 초안을 만들 수 있습니다.");
  if (bundle.report?.publicationStatus === "sent") {
    throw new AppError("INVALID_ARGUMENT", "이미 발송한 추천식단은 다시 생성할 수 없습니다.");
  }

  const answers = objectValue(bundle.response.answers);
  const reviewReasons = stringArray(bundle.response.reviewReasons, 20, 80);
  const sourceHash = stableHash({ answers, inbody: bundle.inbody, reviewReasons });
  if (!options.force && bundle.draft?.sourceResponseHash === sourceHash && bundle.draft?.publicContent) {
    return { ok: true, requestId, reused: true, draft: safeDraftForOperator(bundle.draft) };
  }
  const fallback = deterministicMealPlan(bundle.request, answers, bundle.inbody, reviewReasons);
  let publicContent = fallback;
  let provider = "safe_fallback";
  let model = "rule-based-v1";
  let generationError = "";
  const allergies = reportedAllergies(answers);
  const excludedFoods = reportedFoodExclusions(answers);
  if (excludedFoods.length) {
    provider = allergies.length ? "safe_allergy_review" : "safe_food_exclusion_review";
    generationError = allergies.length
      ? "알레르기 응답으로 특정 식품 자동 추천을 제한했습니다."
      : "섭취 제외 식품 응답으로 특정 식품 자동 추천을 제한했습니다.";
  } else {
    try {
      const generated = await generateGeminiMealPlan(answers, bundle.inbody, reviewReasons);
      publicContent = normalizePublicContent(generated, fallback);
      publicContent.title = fallback.title;
      provider = "gemini";
      model = generated.model;
    } catch (err) {
      generationError = errorMessage(err).slice(0, 400);
    }
  }

  const now = nowTimestamp();
  const revision = mealPlanRevision(sourceHash, publicContent);
  const draft = {
    requestId,
    responseId: requestId,
    studioId: cleanText(bundle.request.studioId, 80) || DEFAULT_STUDIO_ID,
    memberId: cleanText(bundle.request.memberId, 120),
    memberName: cleanText(bundle.request.memberName, 40),
    sourceResponseHash: sourceHash,
    publicContent,
    revision,
    status: reviewReasons.length ? "review_required" : "draft_ready",
    reviewReasons,
    reviewAcknowledgedAt: null,
    reviewAcknowledgedByUid: "",
    provider,
    model,
    generationError: generationError || null,
    generatedByUid: actor.uid || "",
    generatedByName: actor.name,
    generatedAt: now,
    updatedAt: now,
    createdAt: bundle.draft?.createdAt || now,
  };
  await db.collection(RECOMMENDED_MEAL_DRAFT_COLLECTION).doc(requestId).set(draft, { merge: false });
  await db.collection(RECOMMENDED_MEAL_REPORT_COLLECTION).doc(requestId).set(
    {
      reportId: requestId,
      requestId,
      studioId: draft.studioId,
      memberId: draft.memberId,
      memberName: draft.memberName,
      reportRevision: revision,
      approvedRevision: "",
      sentRevision: "",
      approvalStatus: "draft",
      publicationStatus: "draft",
      updatedAt: now,
      createdAt: bundle.report?.createdAt || now,
    },
    { merge: true },
  );
  await db.collection(RECOMMENDED_MEAL_REQUEST_COLLECTION).doc(requestId).set(
    {
      recommendationStatus: reviewReasons.length ? "review_required" : "awaiting_operator_review",
      draftRevision: revision,
      updatedAt: now,
    },
    { merge: true },
  );
  return { ok: true, requestId, draft: safeDraftForOperator(draft) };
}

export async function saveRecommendedMealProgramDraftHandler(
  request: CallableRequest,
  staff: StaffDoc,
): Promise<Record<string, unknown>> {
  const data = objectValue(request.data);
  const requestId = cleanRequestId(data.requestId);
  const bundle = await loadReviewBundle(requestId, staff);
  if (!bundle.draft) throw new AppError("INVALID_ARGUMENT", "먼저 추천식단 초안을 생성하세요.");
  if (bundle.report?.publicationStatus === "sent") {
    throw new AppError("INVALID_ARGUMENT", "회원에게 발송한 추천식단은 수정할 수 없습니다.");
  }
  const publicContent = normalizePublicContent(data.publicContent, bundle.draft.publicContent);
  const revision = mealPlanRevision(cleanText(bundle.draft.sourceResponseHash, 128), publicContent);
  const reviewAcknowledged = data.reviewAcknowledged === true;
  const now = nowTimestamp();
  await db.collection(RECOMMENDED_MEAL_DRAFT_COLLECTION).doc(requestId).set(
    {
      publicContent,
      revision,
      status: "operator_edited",
      reviewAcknowledgedAt: reviewAcknowledged ? now : null,
      reviewAcknowledgedByUid: reviewAcknowledged ? staff.uid || "" : "",
      editedByUid: staff.uid || "",
      editedByName: staff.name,
      editedAt: now,
      updatedAt: now,
    },
    { merge: true },
  );
  await db.collection(RECOMMENDED_MEAL_REPORT_COLLECTION).doc(requestId).set(
    {
      reportRevision: revision,
      approvedRevision: "",
      approvalStatus: "draft",
      publicationStatus: "draft",
      approvedSnapshot: null,
      updatedAt: now,
    },
    { merge: true },
  );
  await invalidateMutableCandidate(cleanText(bundle.report?.candidateId, 160), "추천식단 수정 후 재승인 필요");
  await db.collection(RECOMMENDED_MEAL_REQUEST_COLLECTION).doc(requestId).set(
    { recommendationStatus: "awaiting_operator_review", draftRevision: revision, updatedAt: now },
    { merge: true },
  );
  return {
    ok: true,
    requestId,
    draft: safeDraftForOperator({
      ...bundle.draft,
      publicContent,
      revision,
      status: "operator_edited",
      reviewAcknowledgedAt: reviewAcknowledged ? now : null,
    }),
  };
}

export async function recommendedMealPlanApiHandler(request: Request, response: Response): Promise<void> {
  setCors(request, response);
  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return;
  }
  if (request.method !== "GET") {
    response.set("Allow", "GET, OPTIONS").status(405).json({ ok: false, error: "지원하지 않는 요청입니다." });
    return;
  }
  try {
    const reportId = cleanRequestId(request.query.id);
    const token = cleanReportToken(request.query.token);
    const snap = await db.collection(RECOMMENDED_MEAL_REPORT_COLLECTION).doc(reportId).get();
    const report = snap.data();
    if (!report || !secureHashEquals(reportTokenHash(token), cleanText(report.accessTokenHash, 128))) {
      throw new Error("추천식단을 찾지 못했습니다.");
    }
    const expiresAt = report.expiresAt instanceof Timestamp ? report.expiresAt.toMillis() : 0;
    if (expiresAt && expiresAt < Date.now()) throw new Error("추천식단 링크가 만료되었습니다.");
    const snapshot = report.sentSnapshot || report.approvedSnapshot;
    if (!snapshot?.publicContent || !["approved", "sent"].includes(String(report.publicationStatus || ""))) {
      throw new Error("추천식단이 아직 준비되지 않았습니다.");
    }
    response.set("Cache-Control", "private, no-store, max-age=0");
    response.status(200).json({
      ok: true,
      reportId,
      memberName: cleanText(report.memberName, 40) || "회원",
      revision: cleanText(snapshot.revision, 128),
      content: normalizePublicContent(snapshot.publicContent, snapshot.publicContent),
      approvedAt: timestampIso(report.approvedAt),
      sentAt: timestampIso(report.sentAt),
    });
  } catch (err) {
    const message = errorMessage(err);
    response.status(message.includes("만료") ? 410 : 404).json({ ok: false, error: message });
  }
}

export function createRecommendedMealReportAccess(): { token: string; tokenHash: string } {
  const token = randomBytes(24).toString("hex");
  return { token, tokenHash: reportTokenHash(token) };
}

export function recommendedMealReportUrl(reportId: string, token: string): string {
  const url = new URL(REPORT_BASE_URL);
  url.searchParams.set("id", reportId);
  url.searchParams.set("token", token);
  return url.toString();
}

export function approvedMealPlanSnapshot(draft: FirebaseFirestore.DocumentData): Record<string, unknown> {
  const content = normalizePublicContent(draft.publicContent, draft.publicContent);
  return {
    revision: cleanText(draft.revision, 128),
    sourceResponseHash: cleanText(draft.sourceResponseHash, 128),
    publicContent: content,
    contentHash: stableHash(content),
  };
}

export function reviewGateIssue(draft: FirebaseFirestore.DocumentData): string {
  const reviewReasons = stringArray(draft.reviewReasons, 20, 80);
  if (reviewReasons.length && !(draft.reviewAcknowledgedAt instanceof Timestamp)) {
    return "주의 응답을 확인한 뒤 검토 확인을 저장하세요.";
  }
  return "";
}

export function cleanRequestId(value: unknown): string {
  const requestId = String(value || "").trim();
  if (!/^meal-[a-z0-9-]{16,96}$/i.test(requestId)) {
    throw new AppError("INVALID_ARGUMENT", "추천식단 요청 ID를 확인하세요.");
  }
  return requestId;
}

async function loadReviewBundle(requestId: string, staff: RecommendedMealActor): Promise<{
  request: FirebaseFirestore.DocumentData;
  response: FirebaseFirestore.DocumentData | null;
  draft: FirebaseFirestore.DocumentData | null;
  report: FirebaseFirestore.DocumentData | null;
  inbody: Record<string, unknown> | null;
}> {
  const [requestSnap, responseSnap, draftSnap, reportSnap] = await Promise.all([
    db.collection(RECOMMENDED_MEAL_REQUEST_COLLECTION).doc(requestId).get(),
    db.collection(RECOMMENDED_MEAL_RESPONSE_COLLECTION).doc(requestId).get(),
    db.collection(RECOMMENDED_MEAL_DRAFT_COLLECTION).doc(requestId).get(),
    db.collection(RECOMMENDED_MEAL_REPORT_COLLECTION).doc(requestId).get(),
  ]);
  const mealRequest = requestSnap.data();
  if (!mealRequest) throw new AppError("NOT_FOUND", "추천식단 요청을 찾지 못했습니다.");
  if (String(mealRequest.studioId || DEFAULT_STUDIO_ID) !== String(staff.studioId || DEFAULT_STUDIO_ID)) {
    throw new AppError("PERMISSION_DENIED", "다른 지점의 추천식단 요청입니다.");
  }
  const response = responseSnap.data() || null;
  const inbodyRef = response?.inbody || mealRequest.inbody || {};
  return {
    request: mealRequest,
    response,
    draft: draftSnap.data() || null,
    report: reportSnap.data() || null,
    inbody: await loadInbodySummary(inbodyRef),
  };
}

async function loadInbodySummary(reference: FirebaseFirestore.DocumentData): Promise<Record<string, unknown> | null> {
  const eventId = cleanText(reference?.eventId, 160);
  if (!eventId) return null;
  const event = (await db.collection("inbodyWebhookEvents").doc(eventId).get()).data();
  const measurementId = cleanText(event?.measurementId, 160);
  if (!measurementId) return null;
  const measurement = (await db.collection("inbodyMeasurements").doc(measurementId).get()).data();
  const summary = objectValue(measurement?.summary);
  if (!Object.keys(summary).length) return null;
  const numericKeys = [
    "age",
    "basalMetabolicRateKcal",
    "bmi",
    "bodyFatMassKg",
    "fatControlKg",
    "heightCm",
    "inBodyScore",
    "muscleControlKg",
    "percentBodyFat",
    "skeletalMuscleMassKg",
    "targetWeightKg",
    "visceralFatLevel",
    "weightControlKg",
    "weightKg",
  ];
  const safe: Record<string, unknown> = {
    measurementId,
    testAt: timestampIso(measurement?.testAt || event?.testAt),
    gender: cleanText(summary.gender, 20),
  };
  numericKeys.forEach((key) => {
    const value = Number(summary[key]);
    if (Number.isFinite(value)) safe[key] = value;
  });
  return safe;
}

async function generateGeminiMealPlan(
  answers: Record<string, unknown>,
  inbody: Record<string, unknown> | null,
  reviewReasons: string[],
): Promise<RecommendedMealPublicContent & { model: string }> {
  const apiKey = geminiApiKey.value();
  if (!apiKey) throw new Error("GEMINI_API_KEY secret이 설정되어 있지 않습니다.");
  const prompt = [
    "ARCHIVE PILATES 회원용 추천식단을 한국어 JSON으로 작성합니다.",
    "목표는 생활 습관 개선이며 의료적 영양 처방, 질환 진단, 치료 표현을 금지합니다.",
    "극단적인 칼로리 제한, 단식 강요, 보충제 처방을 하지 않습니다.",
    "설문에 알레르기·섭취불가 음식이 있으면 반드시 모든 식단에서 제외합니다.",
    "InBody 수치는 맥락 설명에만 쓰고 몸을 평가하거나 수치 개선을 단정하지 않습니다.",
    "정확히 7일 식단을 작성하고 각 끼니는 한국에서 쉽게 구할 수 있는 식품으로 제안합니다.",
    "각 끼니는 음식과 대략적인 손바닥/주먹/컵 단위 분량을 짧게 포함합니다.",
    "출력 키: title, summary, goal, metricsSummary, principles(3~5개), days(7개), hydration, exerciseNutrition, weekendStrategy, caution.",
    "days 항목 키: day(1~7), label, breakfast, lunch, dinner, snack, timingTip.",
    `설문: ${JSON.stringify(privacySafeGenerationInput(answers))}`,
    `InBody: ${JSON.stringify(privacySafeGenerationInput(inbody || {}, ["measurementId"]))}`,
    `운영자 확인 사유 코드: ${JSON.stringify(reviewReasons)}`,
    "JSON 외 텍스트는 출력하지 않습니다.",
  ].join("\n");
  let lastError = "";
  for (const model of GEMINI_MODELS) {
    try {
      const response = await fetch(`${GEMINI_GENERATE_URL}/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: "당신은 ARCHIVE PILATES의 생활습관 식단 에디터입니다. 안전하고 실천 가능한 JSON만 반환합니다." }],
          },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.35,
            topP: 0.9,
            maxOutputTokens: 4096,
            responseMimeType: "application/json",
          },
        }),
      });
      const text = await response.text();
      const json = text ? JSON.parse(text) : {};
      if (!response.ok) throw new Error(`Gemini API ${response.status}: ${json.error?.message || text}`);
      const output = String(json?.candidates?.[0]?.content?.parts?.[0]?.text || "");
      const parsed = JSON.parse(output.replace(/^```json\s*|\s*```$/g, ""));
      return { ...normalizePublicContent(parsed, parsed), model };
    } catch (err) {
      lastError = errorMessage(err);
    }
  }
  throw new Error(lastError || "추천식단 AI 초안 생성에 실패했습니다.");
}

function deterministicMealPlan(
  mealRequest: FirebaseFirestore.DocumentData,
  answers: Record<string, unknown>,
  inbody: Record<string, unknown> | null,
  reviewReasons: string[],
): RecommendedMealPublicContent {
  const name = cleanText(mealRequest.memberName, 40) || "회원";
  const goal = cleanText(answers.primaryGoal, 120) || "규칙적인 식사 습관 만들기";
  const avoid = reportedFoodExclusions(answers);
  const exercise = cleanText(answers.exerciseSchedule, 200);
  const mealSet = avoid.length ? safeAllergyReviewMealSet() : [
    ["그릭요거트 1컵 + 제철 과일 1주먹 + 견과 1숟갈", "현미밥 1주먹 + 닭가슴살/두부 1손바닥 + 채소 2주먹", "잡곡밥 반~1주먹 + 생선 1손바닥 + 나물 2가지", "삶은 달걀 1개 또는 무가당 두유"],
    ["달걀 2개 + 통밀빵 1장 + 토마토", "보리밥 1주먹 + 소고기/콩 1손바닥 + 쌈채소", "두부 버섯전골 + 밥 반주먹", "과일 1주먹 + 플레인 요거트"],
    ["오트밀 반컵 + 우유/두유 + 바나나 반개", "비빔밥 1그릇(밥 1주먹, 채소 충분히, 단백질 추가)", "닭고기 채소구이 + 고구마 1주먹", "견과 1줌 또는 치즈 1장"],
    ["밥 반주먹 + 국 + 달걀/두부 + 김", "메밀면 1인분 + 닭고기/달걀 + 채소", "잡곡밥 반주먹 + 돼지안심 1손바닥 + 채소 2주먹", "무가당 두유 또는 방울토마토"],
    ["그릭요거트 1컵 + 오트 2숟갈 + 베리류", "현미김밥 1줄 또는 포케(소스 절반)", "연두부 1팩 + 생선/닭 1손바닥 + 채소", "삶은 달걀 1개 + 오이"],
    ["달걀 2개 + 고구마 1주먹 + 과일 소량", "외식: 밥 반~1공기 + 구이/회/수육 + 채소", "채소 듬뿍 샤브샤브 + 면/죽은 소량", "배고플 때 요거트 또는 견과"],
    ["평소 아침 식사와 같은 시간에 단백질 포함 식사", "한식 백반: 밥 1주먹, 단백질 반찬, 채소 반찬 우선", "가벼운 집밥: 국/찌개는 건더기 위주 + 밥 반주먹", "과일 1주먹 또는 무가당 음료"],
  ];
  return {
    title: `${name}님의 7일 추천식단`,
    summary: `${goal}을 목표로, 현재 생활 패턴에서 반복하기 쉬운 식사 구성을 우선했습니다.`,
    goal,
    metricsSummary: inbody
      ? "최근 InBody 기록은 식사 구성의 참고 자료로만 반영했으며, 수치보다 꾸준히 실천 가능한 흐름을 우선했습니다."
      : "InBody 측정값 없이 설문 응답을 중심으로 구성했습니다. 다음 측정 후 식단을 다시 조정할 수 있습니다.",
    principles: [
      "매 끼니에 손바닥 크기의 단백질을 포함합니다.",
      "채소는 하루 두 끼 이상, 한 끼에 두 주먹을 목표로 합니다.",
      "완벽한 제한보다 비슷한 시간에 반복하는 식사를 우선합니다.",
      avoid.length
        ? `알레르기·섭취 어려움으로 확인된 음식(${avoid.join(", ")})은 제외하고, 기존에 안전하게 섭취한 식품만 사용합니다.`
        : "몸에 맞지 않는 음식은 무리해서 먹지 않습니다.",
    ],
    days: mealSet.map((meals, index) => ({
      day: index + 1,
      label: `${index + 1}일차`,
      breakfast: meals[0],
      lunch: meals[1],
      dinner: meals[2],
      snack: meals[3],
      timingTip: index % 2 === 0 ? "식사 간격은 4~5시간을 기준으로 조정하세요." : "늦은 저녁이라면 밥 양을 줄이고 단백질과 채소를 유지하세요.",
    })),
    hydration: "물을 한 번에 많이 마시기보다 기상 후, 식사 사이, 운동 전후로 나누어 마십니다.",
    exerciseNutrition: exercise
      ? `운동 일정(${exercise}) 전후에는 소화가 쉬운 탄수화물과 단백질을 소량 보충하세요.`
      : "운동 전후에는 소화가 쉬운 탄수화물과 단백질을 소량 보충하세요.",
    weekendStrategy: "주말에도 첫 식사 시간을 평일과 2시간 이상 벌리지 않고, 외식은 단백질과 채소를 먼저 선택합니다.",
    caution: avoid.length
      ? "알레르기 응답이 있어 특정 식품명 대신 안전한 식품군으로 표시했습니다. 운영자와 회원이 실제로 안전한 대체 식품을 확인한 뒤 실천하세요. 새로운 식품을 임의로 시도하지 마세요."
      : reviewReasons.length
      ? "건강 관련 응답이 확인되었습니다. 불편감이나 치료 중인 상태가 있다면 담당 의료진 또는 영양 전문가의 안내를 우선하세요."
      : "본 식단은 생활 습관 개선을 위한 일반 안내이며 의료적 영양 처방을 대신하지 않습니다.",
  };
}

function reportedAllergies(answers: Record<string, unknown>): string[] {
  return stringArray(answers.allergies, 12, 80).filter((item) => !/없음|아니오|해당 없음|없습니다/.test(item));
}

function reportedFoodExclusions(answers: Record<string, unknown>): string[] {
  const avoidFoods = cleanText(answers.avoidFoods, 200);
  return [
    ...reportedAllergies(answers),
    ...(!avoidFoods || /^(없음|아니오|해당 없음|없습니다)[.!]?$/i.test(avoidFoods) ? [] : [avoidFoods]),
  ];
}

function safeAllergyReviewMealSet(): string[][] {
  return Array.from({ length: 7 }, (_, index) => [
    "기존에 안전하게 섭취한 탄수화물 1주먹 + 안전한 단백질 식품 1손바닥 + 평소 먹던 과일 1주먹",
    "알레르기 유발 식품을 제외한 밥 또는 안전한 전분 1주먹 + 안전한 단백질 1손바닥 + 평소 먹던 채소 2주먹",
    "기존에 안전하게 섭취한 탄수화물 반~1주먹 + 안전한 단백질 1손바닥 + 평소 먹던 채소 2주먹",
    index % 2 === 0
      ? "기존에 안전하게 섭취한 간식 1회분"
      : "배고플 때 평소 문제없이 먹던 과일 또는 안전한 단백질 간식",
  ]);
}

function privacySafeGenerationInput(
  value: unknown,
  excludedKeys: string[] = [],
): unknown {
  if (Array.isArray(value)) return value.map((item) => privacySafeGenerationInput(item, excludedKeys));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !excludedKeys.includes(key))
        .map(([key, item]) => [key, privacySafeGenerationInput(item, excludedKeys)]),
    );
  }
  if (typeof value !== "string") return value;
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email removed]")
    .replace(/(?:\+?82[-\s]?)?0?1[016789][-\s]?\d{3,4}[-\s]?\d{4}/g, "[phone removed]");
}

function normalizePublicContent(value: unknown, fallbackValue: unknown): RecommendedMealPublicContent {
  const source = objectValue(value);
  const fallback = objectValue(fallbackValue);
  const sourceDays = Array.isArray(source.days) ? source.days : Array.isArray(fallback.days) ? fallback.days : [];
  const days = sourceDays.slice(0, 7).map((item, index) => {
    const row = objectValue(item);
    return {
      day: index + 1,
      label: cleanText(row.label, 30) || `${index + 1}일차`,
      breakfast: requiredContentText(row.breakfast, `아침 ${index + 1}일차`, 500),
      lunch: requiredContentText(row.lunch, `점심 ${index + 1}일차`, 500),
      dinner: requiredContentText(row.dinner, `저녁 ${index + 1}일차`, 500),
      snack: cleanText(row.snack, 400),
      timingTip: cleanText(row.timingTip, 400),
    };
  });
  if (days.length !== 7) throw new AppError("INVALID_ARGUMENT", "추천식단은 7일 구성이어야 합니다.");
  return {
    title: requiredContentText(source.title || fallback.title, "제목", 120),
    summary: requiredContentText(source.summary || fallback.summary, "요약", 800),
    goal: requiredContentText(source.goal || fallback.goal, "목표", 300),
    metricsSummary: cleanText(source.metricsSummary || fallback.metricsSummary, 800),
    principles: stringArray(source.principles || fallback.principles, 6, 300),
    days,
    hydration: cleanText(source.hydration || fallback.hydration, 600),
    exerciseNutrition: cleanText(source.exerciseNutrition || fallback.exerciseNutrition, 600),
    weekendStrategy: cleanText(source.weekendStrategy || fallback.weekendStrategy, 600),
    caution: requiredContentText(source.caution || fallback.caution, "주의 안내", 800),
  };
}

function mealPlanRevision(sourceHash: string, content: RecommendedMealPublicContent): string {
  return stableHash({ sourceHash, content });
}

async function invalidateMutableCandidate(candidateId: string, reason: string): Promise<void> {
  if (!candidateId) return;
  const ref = db.collection("alimtalkCandidates").doc(candidateId);
  const snap = await ref.get();
  const status = String(snap.data()?.status || "");
  if (snap.exists && !["sent", "skipped"].includes(status)) {
    await ref.set({ status: "skipped", reasonCode: "content_revision_changed", lastError: reason, updatedAt: nowTimestamp() }, { merge: true });
  }
}

function safeRequestForOperator(data: FirebaseFirestore.DocumentData): Record<string, unknown> {
  return {
    requestId: cleanText(data.requestId, 160),
    memberId: cleanText(data.memberId, 120),
    memberName: cleanText(data.memberName, 40),
    memberPhone: cleanText(data.memberPhone, 20),
    status: cleanText(data.status, 80),
    recommendationStatus: cleanText(data.recommendationStatus, 80),
    note: cleanText(data.note, 240),
    inbody: data.inbody || null,
    submittedAt: timestampIso(data.submittedAt),
    updatedAt: timestampIso(data.updatedAt),
  };
}

function safeDraftForOperator(data: FirebaseFirestore.DocumentData | null): Record<string, unknown> | null {
  if (!data) return null;
  return {
    requestId: cleanText(data.requestId, 160),
    status: cleanText(data.status, 80),
    revision: cleanText(data.revision, 128),
    publicContent: data.publicContent ? normalizePublicContent(data.publicContent, data.publicContent) : null,
    reviewReasons: stringArray(data.reviewReasons, 20, 80),
    reviewAcknowledged: data.reviewAcknowledgedAt instanceof Timestamp,
    provider: cleanText(data.provider, 40),
    model: cleanText(data.model, 80),
    generationError: cleanText(data.generationError, 400),
    updatedAt: timestampIso(data.updatedAt),
  };
}

function safeReportForOperator(data: FirebaseFirestore.DocumentData | null): Record<string, unknown> | null {
  if (!data) return null;
  return {
    reportId: cleanText(data.reportId, 160),
    reportRevision: cleanText(data.reportRevision, 128),
    approvedRevision: cleanText(data.approvedRevision, 128),
    sentRevision: cleanText(data.sentRevision, 128),
    approvalStatus: cleanText(data.approvalStatus, 80),
    publicationStatus: cleanText(data.publicationStatus, 80),
    candidateId: cleanText(data.candidateId, 160),
    shortUrl: cleanText(data.shortUrl, 400),
    lastError: cleanText(data.lastError, 400),
    approvedAt: timestampIso(data.approvedAt),
    sentAt: timestampIso(data.sentAt),
  };
}

function reportTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function cleanReportToken(value: unknown): string {
  const token = String(value || "").trim();
  if (!/^[a-f0-9]{48}$/i.test(token)) throw new Error("추천식단을 찾지 못했습니다.");
  return token;
}

function secureHashEquals(actual: string, expected: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(actual) || !/^[a-f0-9]{64}$/i.test(expected)) return false;
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : {};
}

function stringArray(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanText(item, maxLength)).filter(Boolean).slice(0, maxItems);
}

function requiredContentText(value: unknown, label: string, maxLength: number): string {
  const text = cleanText(value, maxLength);
  if (!text) throw new AppError("INVALID_ARGUMENT", `${label} 내용을 확인하세요.`);
  return text;
}

function cleanText(value: unknown, maxLength: number): string {
  return String(value == null ? "" : value).trim().slice(0, maxLength);
}

function timestampIso(value: unknown): string {
  return value instanceof Timestamp ? value.toDate().toISOString() : "";
}

function setCors(request: Request, response: Response): void {
  const origin = String(request.headers.origin || "");
  if (/^https:\/\/(in|core)\.archivepilates\.com$/i.test(origin) || /^https:\/\/archive-pilates(?:-core)?\.web\.app$/i.test(origin)) {
    response.set("Access-Control-Allow-Origin", origin);
  }
  response.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.set("Access-Control-Allow-Headers", "Content-Type");
  response.set("Vary", "Origin");
}
