import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import type { Request, Response } from "express";
import { DEFAULT_STUDIO_ID } from "../config/constants";
import { db } from "../config/firebase";
import { nowTimestamp } from "../utils/date";
import { AppError } from "../utils/errors";

export const RECOMMENDED_MEAL_REQUEST_COLLECTION = "recommendedMealProgramRequests";
export const RECOMMENDED_MEAL_RESPONSE_COLLECTION = "recommendedMealProgramResponses";
export const RECOMMENDED_MEAL_SURVEY_EXPIRES_DAYS = 14;

export interface RecommendedMealMemberMatch {
  memberId: string;
  memberName: string;
  memberPhone: string;
  studioId: string;
}

export interface RecommendedMealInbodyReference {
  status: "available" | "missing";
  eventId: string;
  testAt: Timestamp | null;
  memberReportUrl: string;
}

interface RecommendedMealSurveyAnswers {
  primaryGoal: string;
  goalDetail: string;
  targetTimeline: string;
  wakeTime: string;
  sleepTime: string;
  sleepQuality: string;
  workType: string;
  workIntensity: string;
  workSchedule: string;
  mealBreakWindow: string;
  exerciseSchedule: string;
  mealsPerDay: string;
  breakfastPattern: string;
  regularMealPattern: string;
  snackPattern: string;
  lateNightFrequency: string;
  eatingOutFrequency: string;
  cookingAccess: string;
  mealBudget: string;
  allergies: string[];
  avoidFoods: string;
  preferredFoods: string;
  alcoholFrequency: string;
  alcoholAmount: string;
  smokingStatus: string;
  medicalConditions: string;
  medications: string;
  pregnancyStatus: string;
  eatingDisorderHistory: string;
  weekendDifference: string;
  additionalNote: string;
  consent: boolean;
}

export async function findRecommendedMealMember(input: {
  phone: string;
  memberName?: string;
}): Promise<RecommendedMealMemberMatch> {
  const phone = normalizePhone(input.phone);
  if (!/^010\d{8}$/.test(phone)) throw new AppError("INVALID_ARGUMENT", "회원 휴대폰번호를 확인하세요.");
  const requestedName = normalizeName(input.memberName || "");
  const profileSnapshot = await db.collection("memberProfiles").where("phone", "==", phone).limit(10).get();
  const profileMatches = profileSnapshot.docs
    .map((doc) => ({ id: doc.id, data: doc.data() }))
    .filter((row) => String(row.data.studioId || DEFAULT_STUDIO_ID) === DEFAULT_STUDIO_ID)
    .map((row) => ({
      memberId: String(row.data.memberId || row.id),
      memberName: String(row.data.name || "").trim(),
      memberPhone: phone,
      studioId: String(row.data.studioId || DEFAULT_STUDIO_ID),
      activeTicketCount: Number(row.data.activeTicketCount || 0),
      temporary: String(row.data.memberId || row.id).startsWith("excel_"),
    }))
    .filter((row) => row.memberId && row.memberName);

  let matches = profileMatches;
  if (!matches.length) {
    const contactSnapshot = await db.collection("memberContactIndex").where("phone", "==", phone).limit(10).get();
    matches = contactSnapshot.docs
      .map((doc) => ({ id: doc.id, data: doc.data() }))
      .filter((row) => String(row.data.studioId || DEFAULT_STUDIO_ID) === DEFAULT_STUDIO_ID)
      .map((row) => ({
        memberId: String(row.data.memberId || row.id),
        memberName: String(row.data.name || "").trim(),
        memberPhone: phone,
        studioId: String(row.data.studioId || DEFAULT_STUDIO_ID),
        activeTicketCount: Number(row.data.activeTicketCount || 0),
        temporary: String(row.data.memberId || row.id).startsWith("excel_"),
      }))
      .filter((row) => row.memberId && row.memberName);
  }

  if (!matches.length) {
    throw new AppError("NOT_FOUND", "해당 전화번호의 ARCHIVE PILATES 회원카드를 찾지 못했습니다.");
  }

  const unique = new Map(matches.map((row) => [row.memberId, row]));
  matches = [...unique.values()];
  if (requestedName) {
    const byName = matches.filter((row) => normalizeName(row.memberName) === requestedName);
    if (byName.length === 1) matches = byName;
  }
  matches.sort(
    (a, b) =>
      Number(a.temporary) - Number(b.temporary) ||
      b.activeTicketCount - a.activeTicketCount ||
      a.memberId.localeCompare(b.memberId),
  );
  if (matches.length > 1 && normalizeName(matches[0].memberName) !== normalizeName(matches[1].memberName)) {
    throw new AppError("INVALID_ARGUMENT", "같은 전화번호의 회원이 여러 명입니다. 회원명을 함께 입력해 주세요.");
  }
  const match = matches[0];
  return {
    memberId: match.memberId,
    memberName: match.memberName,
    memberPhone: match.memberPhone,
    studioId: match.studioId,
  };
}

export async function latestRecommendedMealInbodyReference(
  member: RecommendedMealMemberMatch,
): Promise<RecommendedMealInbodyReference> {
  const rows = new Map<string, FirebaseFirestore.DocumentData>();
  const byPhone = await db.collection("inbodyWebhookEvents").where("userToken", "==", member.memberPhone).limit(30).get();
  byPhone.docs.forEach((doc) => rows.set(doc.id, doc.data()));
  const byMember = await db.collection("inbodyWebhookEvents").where("matchedMemberId", "==", member.memberId).limit(30).get();
  byMember.docs.forEach((doc) => rows.set(doc.id, doc.data()));
  const latest = [...rows.entries()]
    .map(([eventId, data]) => ({
      eventId,
      testAt: data.testAt instanceof Timestamp ? data.testAt : null,
      memberReportUrl:
        data.memberReportStatus === "synced" && typeof data.memberReportUrl === "string"
          ? data.memberReportUrl
          : "",
    }))
    .sort((a, b) => (b.testAt?.toMillis() || 0) - (a.testAt?.toMillis() || 0))[0];
  if (!latest) return { status: "missing", eventId: "", testAt: null, memberReportUrl: "" };
  return { status: "available", ...latest };
}

export function createRecommendedMealAccessToken(): string {
  return randomBytes(24).toString("hex");
}

export function recommendedMealAccessTokenHash(accessToken: string): string {
  return createHash("sha256").update(accessToken).digest("hex");
}

export async function recommendedMealSurveyApiHandler(request: Request, response: Response): Promise<void> {
  setCors(request, response);
  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return;
  }
  try {
    if (request.method === "GET") {
      await handleGet(request, response);
      return;
    }
    if (request.method === "POST") {
      await handlePost(request, response);
      return;
    }
    response.set("Allow", "GET, POST, OPTIONS").status(405).json({ ok: false, error: "지원하지 않는 요청입니다." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "설문 처리 중 오류가 발생했습니다.";
    const status = message.includes("만료") ? 410 : message.includes("찾지 못") ? 404 : 400;
    response.status(status).json({ ok: false, error: message });
  }
}

async function handleGet(request: Request, response: Response): Promise<void> {
  const requestId = cleanRequestId(request.query.id);
  const accessToken = cleanAccessToken(request.query.token);
  const surveyRequest = await verifiedRequest(requestId, accessToken);
  response.set("Cache-Control", "no-store");
  response.status(200).json({
    ok: true,
    requestId,
    memberName: String(surveyRequest.memberName || "회원"),
    status: String(surveyRequest.status || "pending"),
    expiresAt: timestampIso(surveyRequest.expiresAt),
    inbodyStatus: surveyRequest.inbody?.status === "available" ? "available" : "missing",
    inbodyMeasuredAt: timestampIso(surveyRequest.inbody?.testAt),
  });
}

async function handlePost(request: Request, response: Response): Promise<void> {
  const body = request.body && typeof request.body === "object" ? request.body : {};
  const requestId = cleanRequestId((body as Record<string, unknown>).requestId);
  const accessToken = cleanAccessToken((body as Record<string, unknown>).accessToken);
  const requestRef = db.collection(RECOMMENDED_MEAL_REQUEST_COLLECTION).doc(requestId);
  const surveyRequest = await verifiedRequest(requestId, accessToken);
  if (surveyRequest.status === "submitted") {
    response.status(200).json({ ok: true, duplicate: true, status: "submitted" });
    return;
  }

  const answers = parseAnswers(body as Record<string, unknown>);
  const member: RecommendedMealMemberMatch = {
    memberId: String(surveyRequest.memberId || ""),
    memberName: String(surveyRequest.memberName || ""),
    memberPhone: String(surveyRequest.memberPhone || ""),
    studioId: String(surveyRequest.studioId || DEFAULT_STUDIO_ID),
  };
  const inbody = await latestRecommendedMealInbodyReference(member);
  const reviewReasons = recommendedMealReviewReasons(answers, inbody);
  const submittedAt = nowTimestamp();
  await db.runTransaction(async (transaction) => {
    const fresh = await transaction.get(requestRef);
    const current = fresh.data();
    if (!current) throw new Error("설문 요청을 찾지 못했습니다.");
    if (current.status === "submitted") return;
    transaction.set(
      db.collection(RECOMMENDED_MEAL_RESPONSE_COLLECTION).doc(requestId),
      {
        responseId: requestId,
        requestId,
        studioId: member.studioId,
        memberId: member.memberId,
        memberName: member.memberName,
        memberPhone: member.memberPhone,
        answers,
        inbody,
        recommendationStatus: reviewReasons.length ? "review_required" : "ready_for_draft",
        reviewReasons,
        submittedAt,
        createdAt: submittedAt,
        updatedAt: submittedAt,
      },
      { merge: false },
    );
    transaction.set(
      requestRef,
      {
        status: "submitted",
        inbody,
        recommendationStatus: reviewReasons.length ? "review_required" : "ready_for_draft",
        reviewReasonCount: reviewReasons.length,
        submittedAt,
        updatedAt: submittedAt,
      },
      { merge: true },
    );
  });
  response.status(200).json({
    ok: true,
    duplicate: false,
    status: "submitted",
    recommendationStatus: reviewReasons.length ? "review_required" : "ready_for_draft",
  });
}

async function verifiedRequest(requestId: string, accessToken: string): Promise<FirebaseFirestore.DocumentData> {
  const snap = await db.collection(RECOMMENDED_MEAL_REQUEST_COLLECTION).doc(requestId).get();
  const data = snap.data();
  if (!data || !secureHashEquals(recommendedMealAccessTokenHash(accessToken), String(data.accessTokenHash || ""))) {
    throw new Error("설문 요청을 찾지 못했습니다.");
  }
  const expiresAt = data.expiresAt instanceof Timestamp ? data.expiresAt.toMillis() : 0;
  if (expiresAt && expiresAt < Date.now()) throw new Error("설문 링크가 만료되었습니다. ARCHIVE PILATES에 다시 요청해 주세요.");
  if (data.status === "cancelled") throw new Error("사용이 종료된 설문 링크입니다.");
  return data;
}

function parseAnswers(body: Record<string, unknown>): RecommendedMealSurveyAnswers {
  const answers: RecommendedMealSurveyAnswers = {
    primaryGoal: requiredText(body.primaryGoal, "식단 목표", 80),
    goalDetail: optionalText(body.goalDetail, 500),
    targetTimeline: optionalText(body.targetTimeline, 120),
    wakeTime: requiredText(body.wakeTime, "기상 시간", 20),
    sleepTime: requiredText(body.sleepTime, "취침 시간", 20),
    sleepQuality: requiredText(body.sleepQuality, "수면 상태", 80),
    workType: requiredText(body.workType, "업무 형태", 120),
    workIntensity: requiredText(body.workIntensity, "업무 활동 강도", 80),
    workSchedule: optionalText(body.workSchedule, 200),
    mealBreakWindow: optionalText(body.mealBreakWindow, 200),
    exerciseSchedule: optionalText(body.exerciseSchedule, 300),
    mealsPerDay: requiredText(body.mealsPerDay, "하루 식사 횟수", 40),
    breakfastPattern: requiredText(body.breakfastPattern, "아침 식사", 80),
    regularMealPattern: optionalText(body.regularMealPattern, 500),
    snackPattern: optionalText(body.snackPattern, 300),
    lateNightFrequency: requiredText(body.lateNightFrequency, "야식 빈도", 80),
    eatingOutFrequency: requiredText(body.eatingOutFrequency, "외식 빈도", 80),
    cookingAccess: requiredText(body.cookingAccess, "식사 준비 환경", 120),
    mealBudget: optionalText(body.mealBudget, 120),
    allergies: textList(body.allergies, 12, 100),
    avoidFoods: requiredText(body.avoidFoods, "섭취가 어려운 음식", 500),
    preferredFoods: optionalText(body.preferredFoods, 500),
    alcoholFrequency: requiredText(body.alcoholFrequency, "음주 빈도", 80),
    alcoholAmount: optionalText(body.alcoholAmount, 200),
    smokingStatus: requiredText(body.smokingStatus, "흡연 여부", 80),
    medicalConditions: requiredText(body.medicalConditions, "질환 또는 주의사항", 500),
    medications: requiredText(body.medications, "복용 약물", 500),
    pregnancyStatus: requiredText(body.pregnancyStatus, "임신·수유 여부", 100),
    eatingDisorderHistory: requiredText(body.eatingDisorderHistory, "섭식 관련 치료 경험", 80),
    weekendDifference: optionalText(body.weekendDifference, 300),
    additionalNote: optionalText(body.additionalNote, 500),
    consent: body.consent === true,
  };
  if (!answers.allergies.length) throw new Error("알레르기 여부를 선택해 주세요.");
  if (!answers.consent) throw new Error("개인정보 및 건강정보 활용 동의가 필요합니다.");
  return answers;
}

function recommendedMealReviewReasons(
  answers: RecommendedMealSurveyAnswers,
  inbody: RecommendedMealInbodyReference,
): string[] {
  const reasons: string[] = [];
  if (inbody.status === "missing") reasons.push("latest_inbody_missing");
  if (!isNoneAnswer(answers.medicalConditions)) reasons.push("medical_condition_reported");
  if (!isNoneAnswer(answers.medications)) reasons.push("medication_reported");
  if (!isNoneAnswer(answers.pregnancyStatus)) reasons.push("pregnancy_or_breastfeeding_reported");
  if (!isNoneAnswer(answers.eatingDisorderHistory)) reasons.push("eating_disorder_history_reported");
  if (!answers.allergies.every(isNoneAnswer)) reasons.push("allergy_reported");
  return [...new Set(reasons)];
}

function cleanRequestId(value: unknown): string {
  const requestId = String(value || "").trim();
  if (!/^meal-[a-z0-9-]{16,96}$/i.test(requestId)) throw new Error("설문 링크가 올바르지 않습니다.");
  return requestId;
}

function cleanAccessToken(value: unknown): string {
  const token = String(value || "").trim();
  if (!/^[a-f0-9]{48}$/i.test(token)) throw new Error("설문 링크가 올바르지 않습니다.");
  return token;
}

function normalizePhone(value: unknown): string {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.startsWith("8210") ? `0${digits.slice(2)}` : digits;
}

function normalizeName(value: string): string {
  return String(value || "").replace(/\s+/g, "").toLowerCase();
}

function requiredText(value: unknown, label: string, maxLength: number): string {
  const text = optionalText(value, maxLength);
  if (!text) throw new Error(`${label} 항목을 작성해 주세요.`);
  return text;
}

function optionalText(value: unknown, maxLength: number): string {
  return String(value == null ? "" : value).trim().slice(0, maxLength);
}

function textList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => optionalText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function isNoneAnswer(value: string): boolean {
  return /^(없음|해당 ?없음|아니오|비흡연|하지 않음)$/i.test(String(value || "").trim());
}

function secureHashEquals(actual: string, expected: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(actual) || !/^[a-f0-9]{64}$/i.test(expected)) return false;
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

function timestampIso(value: unknown): string {
  return value instanceof Timestamp ? value.toDate().toISOString() : "";
}

function setCors(request: Request, response: Response): void {
  const origin = String(request.get("origin") || "");
  if (["https://in.archivepilates.com", "https://archive-pilates-in.web.app"].includes(origin)) {
    response.set("Access-Control-Allow-Origin", origin);
    response.set("Vary", "Origin");
  }
  response.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.set("Access-Control-Allow-Headers", "Content-Type");
  response.set("X-Content-Type-Options", "nosniff");
}
