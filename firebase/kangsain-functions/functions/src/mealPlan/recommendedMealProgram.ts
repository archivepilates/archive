import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import type { Request, Response } from "express";
import type { CallableRequest } from "firebase-functions/v2/https";
import { DEFAULT_STUDIO_ID } from "../config/constants";
import { db } from "../config/firebase";
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
          sourceHash: mealResponseSourceHash(bundle.response),
        }
      : null,
    inbody: bundle.inbody,
    draft: safeDraftForOperator(bundle.draft),
    report: safeReportForOperator(bundle.report),
  };
}

export function mealResponseSourceHash(response: FirebaseFirestore.DocumentData): string {
  return stableHash({
    answers: objectValue(response.answers),
    reviewReasons: stringArray(response.reviewReasons, 20, 80),
    submittedAt: timestampIso(response.submittedAt),
  });
}

// Legacy endpoints remain compatible, but never invoke a model or manufacture a draft.
export async function generateRecommendedMealProgramDraftHandler(
  request: CallableRequest,
  staff: StaffDoc,
): Promise<Record<string, unknown>> {
  const requestId = cleanRequestId(objectValue(request.data).requestId);
  await markOperatorCallRequired(requestId, staff);
  return { ok: true, requestId, status: "operator_call_required" };
}

export async function generateRecommendedMealProgramDraftForSubmittedResponse(
  responseId: string,
  responseData: FirebaseFirestore.DocumentData,
): Promise<Record<string, unknown>> {
  const requestId = cleanRequestId(responseId);
  await markOperatorCallRequired(requestId, {
    uid: "system", name: "설문 접수",
    studioId: cleanText(responseData.studioId, 80) || DEFAULT_STUDIO_ID,
  });
  return { ok: true, requestId, status: "operator_call_required" };
}

async function markOperatorCallRequired(requestId: string, actor: RecommendedMealActor): Promise<void> {
  await db.runTransaction(async tx => {
    const requestRef = db.collection(RECOMMENDED_MEAL_REQUEST_COLLECTION).doc(requestId);
    const requestData = (await tx.get(requestRef)).data();
    const response = (await tx.get(db.collection(RECOMMENDED_MEAL_RESPONSE_COLLECTION).doc(requestId))).data();
    const draft = (await tx.get(db.collection(RECOMMENDED_MEAL_DRAFT_COLLECTION).doc(requestId))).data();
    const report = (await tx.get(db.collection(RECOMMENDED_MEAL_REPORT_COLLECTION).doc(requestId))).data();
    assertSubmittedSource(requestData, response, actor);
    if (draft || report) return;
    tx.set(requestRef, {
      recommendationStatus: stringArray(response!.reviewReasons, 20, 80).length
        ? "review_required" : "operator_call_required",
      updatedAt: nowTimestamp(),
    }, { merge: true });
  });
}

function assertSubmittedSource(
  mealRequest: FirebaseFirestore.DocumentData | undefined,
  response: FirebaseFirestore.DocumentData | undefined,
  actor: RecommendedMealActor,
): void {
  if (!mealRequest) throw new AppError("NOT_FOUND", "추천식단 요청을 찾지 못했습니다.");
  const studioId = String(mealRequest.studioId || DEFAULT_STUDIO_ID);
  if (studioId !== String(actor.studioId || DEFAULT_STUDIO_ID)
    || response && String(response.studioId || studioId) !== studioId) {
    throw new AppError("PERMISSION_DENIED", "다른 지점의 추천식단 요청입니다.");
  }
  if (!response || mealRequest.status !== "submitted") {
    throw new AppError("INVALID_ARGUMENT", "회원 설문 제출 상태를 다시 확인하세요.");
  }
  if (response.memberId && String(response.memberId) !== String(mealRequest.memberId)) {
    throw new AppError("INVALID_ARGUMENT", "설문과 회원 원본이 일치하지 않습니다.");
  }
}

function assertUnpublishedReport(report: FirebaseFirestore.DocumentData | undefined): void {
  if (!report) return;
  if (["approved", "published", "sent"].includes(String(report.publicationStatus || ""))
    || ["approved", "sent"].includes(String(report.approvalStatus || ""))
    || report.approvedSnapshot || report.publishedSnapshot || report.sentSnapshot
    || report.approvedAt || report.publishedAt || report.sentAt || report.sentRevision
    || report.candidateId) {
    throw new AppError("INVALID_ARGUMENT", "승인·공개·발송 절차에 들어간 추천식단은 수정할 수 없습니다.");
  }
}

export async function saveRecommendedMealProgramDraftHandler(
  request: CallableRequest,
  staff: StaffDoc,
): Promise<Record<string, unknown>> {
  const data = objectValue(request.data);
  const requestId = cleanRequestId(data.requestId);
  if (typeof data.expectedRevision !== "string" || typeof data.expectedResponseHash !== "string"
    || !/^[a-f0-9]{64}$/.test(data.expectedResponseHash)) {
    throw new AppError("INVALID_ARGUMENT", "최신 설문과 초안을 다시 불러온 뒤 저장하세요.");
  }
  const publicContent = normalizePublicContent(data.publicContent, data.publicContent);
  const now = nowTimestamp();
  const result = await db.runTransaction(async tx => {
    const requestRef = db.collection(RECOMMENDED_MEAL_REQUEST_COLLECTION).doc(requestId);
    const responseRef = db.collection(RECOMMENDED_MEAL_RESPONSE_COLLECTION).doc(requestId);
    const draftRef = db.collection(RECOMMENDED_MEAL_DRAFT_COLLECTION).doc(requestId);
    const reportRef = db.collection(RECOMMENDED_MEAL_REPORT_COLLECTION).doc(requestId);
    const mealRequest = (await tx.get(requestRef)).data();
    const response = (await tx.get(responseRef)).data();
    const previous = (await tx.get(draftRef)).data();
    const report = (await tx.get(reportRef)).data();
    assertSubmittedSource(mealRequest, response, staff);
    assertUnpublishedReport(report);
    const sourceHash = mealResponseSourceHash(response!);
    if (data.expectedRevision !== String(previous?.revision || "")
      || data.expectedResponseHash !== sourceHash) {
      throw new AppError("INVALID_ARGUMENT", "설문 또는 초안이 변경됐습니다. 다시 불러온 뒤 검토하세요.");
    }
    const revision = mealPlanRevision(sourceHash, publicContent);
    const reviewAcknowledged = data.reviewAcknowledged === true;
    if (previous?.revision === revision
      && Boolean(previous.reviewAcknowledgedAt) === reviewAcknowledged) {
      return { ...previous, reused: true };
    }
    const previousRevision = cleanText(previous?.revision, 128);
    const historyRef = previousRevision
      ? db.collection(RECOMMENDED_MEAL_DRAFT_COLLECTION).doc(requestId).collection("revisions").doc(previousRevision)
      : null;
    const history = historyRef ? await tx.get(historyRef) : null;
    const assisted = data.authoringMode === "codex_operator";
    const draft = {
      requestId, responseId: requestId,
      studioId: cleanText(mealRequest!.studioId, 80) || DEFAULT_STUDIO_ID,
      memberId: cleanText(mealRequest!.memberId, 120),
      memberName: cleanText(mealRequest!.memberName, 40),
      sourceResponseHash: sourceHash, publicContent, revision,
      status: "operator_edited",
      reviewReasons: stringArray(response!.reviewReasons, 20, 80),
      reviewAcknowledgedAt: reviewAcknowledged ? now : null,
      reviewAcknowledgedByUid: reviewAcknowledged ? staff.uid || "" : "",
      provider: assisted ? "operator_assisted" : "operator",
      model: assisted ? "codex-chat" : "manual",
      generationError: null,
      editedByUid: staff.uid || "", editedByName: staff.name,
      editedAt: now, updatedAt: now, createdAt: previous?.createdAt || now,
    };
    if (historyRef && !history?.exists) {
      tx.set(historyRef, { ...previous!, preservedAt: now, supersededByRevision: revision });
    }
    tx.set(draftRef, draft);
    tx.set(reportRef, {
      reportId: requestId, requestId, studioId: draft.studioId,
      memberId: draft.memberId, memberName: draft.memberName,
      reportRevision: revision, approvedRevision: "", sentRevision: "",
      approvalStatus: "draft", publicationStatus: "draft",
      updatedAt: now, createdAt: report?.createdAt || now,
    }, { merge: true });
    tx.set(requestRef, {
      recommendationStatus: draft.reviewReasons.length && !reviewAcknowledged
        ? "review_required" : "awaiting_operator_review",
      draftRevision: revision, updatedAt: now,
    }, { merge: true });
    return draft;
  });
  return { ok: true, requestId, reused: "reused" in result, draft: safeDraftForOperator(result) };
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
    const [reportSnap, requestSnap] = await Promise.all([
      db.collection(RECOMMENDED_MEAL_REPORT_COLLECTION).doc(reportId).get(),
      db.collection(RECOMMENDED_MEAL_REQUEST_COLLECTION).doc(reportId).get(),
    ]);
    const report = reportSnap.data();
    const mealRequest = requestSnap.data();
    const actualHash = reportTokenHash(token);
    const tokenMatches = [report?.accessTokenHash, mealRequest?.accessTokenHash]
      .map((value) => cleanText(value, 128))
      .some((expectedHash) => secureHashEquals(actualHash, expectedHash));
    if (!report || !tokenMatches) {
      throw new Error("추천식단을 찾지 못했습니다.");
    }
    const expiresAt = report.expiresAt instanceof Timestamp ? report.expiresAt.toMillis() : 0;
    if (expiresAt && expiresAt < Date.now()) throw new Error("추천식단 링크가 만료되었습니다.");
    const snapshot = report.publishedSnapshot || report.sentSnapshot || report.approvedSnapshot;
    if (!snapshot?.publicContent || !["published", "approved", "sent"].includes(String(report.publicationStatus || ""))) {
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
      publishedAt: timestampIso(report.publishedAt),
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
    publishedAt: timestampIso(data.publishedAt),
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
