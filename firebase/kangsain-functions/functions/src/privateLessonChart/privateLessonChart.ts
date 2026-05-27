import { createHmac } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { DEFAULT_STUDIO_ID } from "../config/constants";
import { notionToken, privateSurveyWebhookSecret } from "../config/secrets";
import { db } from "../config/firebase";
import { refs } from "../firestore/refs";
import type {
  BookingDoc,
  PrivateLessonChartGptTaskDoc,
  PrivateLessonChartMode,
  PrivateLessonChartRecordDoc,
  PrivateLessonChartRequestDoc,
  PrivateLessonChartRequestStatus,
  PrivateSurveyResponseDoc,
} from "../types/models";
import { addDays, formatDateKst, nowTimestamp, todayKst } from "../utils/date";
import { errorMessage } from "../utils/errors";
import { stableHash } from "../utils/hash";
import { ensureShortLink } from "../utils/shortLinks";

const PUBLIC_BASE_URL = process.env.PRIVATE_CHART_BASE_URL || "https://in.archivepilates.com/private-chart/";
const NOTION_API_VERSION = "2022-06-28";
const NOTION_MEMBERS_DATABASE_ID = process.env.NOTION_PRIVATE_MEMBERS_DATABASE_ID || "c58a39ceb7ac405ba43b38d3b5871ed3";
const NOTION_SESSION_RECORDS_DATABASE_ID =
  process.env.NOTION_PRIVATE_SESSION_RECORDS_DATABASE_ID || "105b17685d914fbe915ef5b65146d993";
const PRIVATE_CHART_TEMPLATE_NAME = "강사용_프라이빗 차트 작성 안내 v1";

type ChartAnswerMap = Record<string, string[] | string | number | null>;

export async function privateLessonChartApiHandler(request: any, response: any): Promise<void> {
  setCors(response);
  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return;
  }

  try {
    if (request.method === "GET") {
      const { chartRequest, mode } = await readChartRequestFromRequest(request);
      response.status(200).json(publicChartRequest(chartRequest, mode));
      return;
    }
    if (request.method === "POST") {
      const body = request.body || {};
      const chartRequest = await readChartRequest(String(body.requestId || ""), String(body.token || ""));
      const mode = normalizeMode(body.mode);
      const answers = normalizeAnswers(body.answers || {});
      const result = await submitPrivateLessonChart(chartRequest, mode, answers);
      response.status(200).json({ ok: true, ...result });
      return;
    }
    response.status(405).json({ ok: false, error: "method not allowed" });
  } catch (err) {
    const message = errorMessage(err);
    logger.warn("privateLessonChartApi failed", { message });
    response.status(400).json({ ok: false, error: message });
  }
}

export async function createTomorrowPrivateLessonChartRequests(): Promise<{
  date: string;
  checked: number;
  created: number;
  skipped: number;
}> {
  const targetDate = addDays(todayKst(), 1);
  return createPrivateLessonChartRequestsForDate(targetDate);
}

export async function createPrivateLessonChartRequestsForDate(date: string): Promise<{
  date: string;
  checked: number;
  created: number;
  skipped: number;
}> {
  const snap = await refs.bookings().where("lectureDate", "==", date).limit(500).get();
  let checked = 0;
  let created = 0;
  let skipped = 0;

  for (const bookingSnap of snap.docs) {
    const booking = bookingSnap.data();
    if (!isPrivateBooking(booking)) {
      skipped += 1;
      continue;
    }
    checked += 1;
    const result = await ensureChartRequestForBooking(booking).catch((err) => {
      logger.warn("ensureChartRequestForBooking failed", {
        bookingId: booking.bookingId,
        message: errorMessage(err),
      });
      return null;
    });
    if (result?.created) created += 1;
    else skipped += 1;
  }

  logger.info("createPrivateLessonChartRequestsForDate completed", { date, checked, created, skipped });
  return { date, checked, created, skipped };
}

export async function enqueuePendingPrivateLessonChartGptTasks(): Promise<{
  checked: number;
  enqueued: number;
  skipped: number;
}> {
  const snap = await refs.privateLessonChartRecords().where("gptStatus", "==", "pending").limit(100).get();
  let checked = 0;
  let enqueued = 0;
  let skipped = 0;

  for (const recordSnap of snap.docs) {
    const record = recordSnap.data();
    if (!record.postRecord || !record.postSubmittedAt) {
      skipped += 1;
      continue;
    }
    checked += 1;
    const requestSnap = await refs.privateLessonChartRequest(record.requestId).get();
    const chartRequest = requestSnap.data();
    if (!chartRequest) {
      skipped += 1;
      continue;
    }
    const result = await ensureGptTask(record, chartRequest).catch((err) => {
      logger.warn("enqueuePendingPrivateLessonChartGptTasks failed", {
        recordId: record.recordId,
        message: errorMessage(err),
      });
      return null;
    });
    if (result?.enqueued) enqueued += 1;
    else skipped += 1;
  }

  logger.info("enqueuePendingPrivateLessonChartGptTasks completed", { checked, enqueued, skipped });
  return { checked, enqueued, skipped };
}

async function ensureChartRequestForBooking(booking: BookingDoc): Promise<{ requestId: string; created: boolean }> {
  const requestId = `plc_${booking.bookingId}`;
  const existing = await refs.privateLessonChartRequest(requestId).get();
  if (existing.exists) return { requestId, created: false };

  const [staffSnap, intakeSummary, sessionNumber] = await Promise.all([
    booking.staffId ? refs.staff(booking.staffId).get() : Promise.resolve(null as any),
    latestPrivateSurveyForBooking(booking),
    nextSessionNumber(booking.memberId),
  ]);
  const staff = staffSnap?.data?.();
  const token = accessTokenFor(requestId);
  const preUrl = chartUrl("pre", requestId, token);
  const postUrl = chartUrl("post", requestId, token);
  const [preShort, postShort] = await Promise.all([
    ensureShortLink({ type: "private_chart", targetUrl: preUrl, sourceId: `${requestId}_pre` }),
    ensureShortLink({ type: "private_chart", targetUrl: postUrl, sourceId: `${requestId}_post` }),
  ]);

  const now = nowTimestamp();
  const doc: PrivateLessonChartRequestDoc = {
    requestId,
    studioId: booking.studioId || DEFAULT_STUDIO_ID,
    bookingId: booking.bookingId,
    lectureId: booking.lectureId,
    memberId: booking.memberId,
    memberName: booking.memberName,
    memberPhone: booking.memberPhone,
    memberPhoneLast4: String(booking.memberPhone || "").slice(-4),
    staffId: booking.staffId,
    staffName: booking.staffName,
    staffPhone: String(staff?.phone || ""),
    lessonDate: booking.lectureDate,
    lessonStartAt: booking.lectureStartAt || null,
    lessonEndAt: booking.lectureEndAt || null,
    sessionNumber,
    accessTokenHash: sha256(token),
    preUrl,
    postUrl,
    preShortUrl: preShort.shortUrl,
    postShortUrl: postShort.shortUrl,
    status: "pending",
    preStatus: "pending",
    postStatus: "pending",
    alimtalk: {
      status: "template_pending",
      templateName: PRIVATE_CHART_TEMPLATE_NAME,
      lastError: null,
    },
    intakeSummary: intakeSummary ? privateSurveySummaryForRequest(intakeSummary) : undefined,
    createdAt: now,
    updatedAt: now,
  };
  await refs.privateLessonChartRequest(requestId).create(doc);
  const baseRecord = await upsertChartRecordBase(doc);
  const notionSync = await syncPrivateLessonChartRecordToNotion(baseRecord, doc);
  await refs.privateLessonChartRecord(requestId).set({ notionSync, updatedAt: nowTimestamp() }, { merge: true });
  if (notionSync.pageUrl) {
    const mediaUploadShort = await ensureShortLink({
      type: "private_chart",
      targetUrl: notionSync.pageUrl,
      sourceId: `${requestId}_media`,
    });
    await refs.privateLessonChartRequest(requestId).set(
      {
        mediaUploadUrl: notionSync.pageUrl,
        mediaUploadShortUrl: mediaUploadShort.shortUrl,
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
  }
  return { requestId, created: true };
}

async function submitPrivateLessonChart(
  chartRequest: PrivateLessonChartRequestDoc,
  mode: PrivateLessonChartMode,
  answers: ChartAnswerMap,
): Promise<{ requestId: string; recordId: string; mode: PrivateLessonChartMode; notionStatus: string }> {
  const recordRef = refs.privateLessonChartRecord(chartRequest.requestId);
  const snap = await recordRef.get();
  const base = snap.data() || (await upsertChartRecordBase(chartRequest));
  const now = nowTimestamp();
  const recordPatch =
    mode === "pre"
      ? { prePlan: answers, preSubmittedAt: now, gptStatus: base.gptStatus || "pending" }
      : { postRecord: answers, postSubmittedAt: now, gptStatus: "pending" as const };
  const nextRecord = {
    ...base,
    ...recordPatch,
    updatedAt: now,
  } as PrivateLessonChartRecordDoc;
  await recordRef.set(nextRecord, { merge: true });

  const nextStatus: PrivateLessonChartRequestStatus =
    mode === "pre"
      ? chartRequest.postStatus === "submitted"
        ? "completed"
        : "pre_submitted"
      : chartRequest.preStatus === "submitted"
        ? "completed"
        : "post_submitted";
  const requestPatch =
    mode === "pre"
      ? { preStatus: "submitted" as const, status: nextStatus }
      : { postStatus: "submitted" as const, status: nextStatus };
  await refs.privateLessonChartRequest(chartRequest.requestId).set({ ...requestPatch, updatedAt: now }, { merge: true });

  const notionSync = await syncPrivateLessonChartRecordToNotion(nextRecord, chartRequest);
  await recordRef.set({ notionSync, updatedAt: nowTimestamp() }, { merge: true });
  if (mode === "post") await ensureGptTask(nextRecord, chartRequest);

  return { requestId: chartRequest.requestId, recordId: nextRecord.recordId, mode, notionStatus: notionSync.status };
}

async function upsertChartRecordBase(chartRequest: PrivateLessonChartRequestDoc): Promise<PrivateLessonChartRecordDoc> {
  const now = nowTimestamp();
  const base: PrivateLessonChartRecordDoc = {
    recordId: chartRequest.requestId,
    requestId: chartRequest.requestId,
    studioId: chartRequest.studioId,
    bookingId: chartRequest.bookingId,
    lectureId: chartRequest.lectureId,
    memberId: chartRequest.memberId,
    memberName: chartRequest.memberName,
    memberPhone: chartRequest.memberPhone,
    staffId: chartRequest.staffId,
    staffName: chartRequest.staffName,
    lessonDate: chartRequest.lessonDate,
    lessonStartAt: chartRequest.lessonStartAt,
    sessionNumber: chartRequest.sessionNumber,
    preSubmittedAt: null,
    postSubmittedAt: null,
    gptStatus: "pending",
    notionSync: { status: "pending" },
    createdAt: now,
    updatedAt: now,
  };
  await refs.privateLessonChartRecord(chartRequest.requestId).set(base, { merge: true });
  return base;
}

async function ensureGptTask(
  record: PrivateLessonChartRecordDoc,
  chartRequest: PrivateLessonChartRequestDoc,
): Promise<{ taskId: string; enqueued: boolean }> {
  const taskId = `plc_gpt_${record.recordId}`;
  const now = nowTimestamp();
  const sourceHash = gptSourceHash(record, chartRequest);
  const existing = await refs.privateLessonChartGptTask(taskId).get();
  const existingTask = existing.data();
  if (existingTask?.sourceHash === sourceHash && existingTask.status !== "failed") {
    await refs.privateLessonChartRecord(record.recordId).set({ gptTaskId: taskId, updatedAt: now }, { merge: true });
    return { taskId, enqueued: false };
  }
  const task: PrivateLessonChartGptTaskDoc = {
    taskId,
    type: "private_lesson_chart_public_draft",
    status: "pending",
    sourceCollection: "privateLessonChartRecords",
    sourceDocId: record.recordId,
    sourceHash,
    recordId: record.recordId,
    requestId: record.requestId,
    memberId: record.memberId,
    memberName: record.memberName,
    staffName: record.staffName,
    sessionNumber: record.sessionNumber,
    lessonDate: record.lessonDate,
    promptBrief: gptPromptBrief(record, chartRequest),
    inputSnapshot: {
      intakeSummary: chartRequest.intakeSummary,
      prePlan: record.prePlan,
      postRecord: record.postRecord,
    },
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  await refs.privateLessonChartGptTask(taskId).set(task, { merge: true });
  await refs.privateLessonChartRecord(record.recordId).set({ gptTaskId: taskId, gptStatus: "pending", updatedAt: now }, { merge: true });
  return { taskId, enqueued: true };
}

async function syncPrivateLessonChartRecordToNotion(
  record: PrivateLessonChartRecordDoc,
  chartRequest: PrivateLessonChartRequestDoc,
): Promise<NonNullable<PrivateLessonChartRecordDoc["notionSync"]>> {
  try {
    const memberPageId = await notionMemberPageId(record.memberPhone, record.memberName, chartRequest);
    const properties = compactObject({
      Name: notionTitle(`${record.memberName} ${record.sessionNumber}회차`),
      Date: notionDate(record.lessonStartAt ? record.lessonStartAt.toDate().toISOString() : `${record.lessonDate}T00:00:00+09:00`),
      "Member Relation": memberPageId ? { relation: [{ id: memberPageId }] } : undefined,
      Instructor: notionSelect(record.staffName || "미정"),
      "Session Status": notionSelect(record.postRecord ? "출석" : record.prePlan ? "수업전 계획" : "예정"),
      Condition: notionSelect(firstText(record.postRecord?.condition)),
      "Pain 여부": notionSelect(firstText(record.postRecord?.painChange)),
      "Focus Area": notionMultiSelect(textArray(record.postRecord?.focusAreas || record.prePlan?.focusAreas)),
      Goal: notionMultiSelect(textArray(record.postRecord?.goals || record.prePlan?.goals)),
      "Equipment Used": notionMultiSelect(textArray(record.postRecord?.equipment || record.prePlan?.equipment)),
      "Core Stability Score": notionNumber(record.postRecord?.coreScore),
      "Balance Score": notionNumber(record.postRecord?.balanceScore),
      "Breathing Score": notionNumber(record.postRecord?.breathingScore),
      "Mobility Score": notionNumber(record.postRecord?.mobilityScore),
      "Flexibility Score": notionNumber(record.postRecord?.flexibilityScore),
      Notes: notionText(chartNotes(record, chartRequest)),
      "Next Session Memo": notionText(String(record.postRecord?.nextMemo || "")),
      "Chart Request ID": notionText(record.requestId),
      "Session Number": { number: record.sessionNumber },
      "Pre Status": notionSelect(record.prePlan ? "submitted" : "pending"),
      "Post Status": notionSelect(record.postRecord ? "submitted" : "pending"),
      "GPT Status": notionSelect(record.gptStatus),
      "회원 리포트": record.publicReportUrl ? { url: record.publicReportUrl } : undefined,
      발송상태: notionSelect(record.publicReportUrl ? "대기" : ""),
    });
    const content = notionChartChildren(record, chartRequest);
    const existingPageId = record.notionSync?.pageId;
    if (existingPageId) {
      await notionRequest(`pages/${existingPageId}`, "PATCH", { properties });
      await appendPageContent(existingPageId, notionUpdateChildren(record, chartRequest));
      return {
        status: "synced",
        pageId: existingPageId,
        pageUrl: record.notionSync?.pageUrl || notionPageUrl(existingPageId),
        syncedAt: new Date().toISOString(),
      };
    }
    const page = await notionRequest("pages", "POST", {
      parent: { database_id: NOTION_SESSION_RECORDS_DATABASE_ID },
      properties,
      children: content,
    });
    return { status: "synced", pageId: String(page.id), pageUrl: String(page.url || notionPageUrl(String(page.id))), syncedAt: new Date().toISOString() };
  } catch (err) {
    return { status: "failed", error: errorMessage(err), syncedAt: new Date().toISOString() };
  }
}

async function appendPageContent(pageId: string, children: Record<string, unknown>[]): Promise<void> {
  await notionRequest(`blocks/${pageId}/children`, "PATCH", { children });
}

function notionPageUrl(pageId: string): string {
  return `https://www.notion.so/${pageId.replaceAll("-", "")}`;
}

async function notionMemberPageId(
  phone: string,
  name: string,
  chartRequest: PrivateLessonChartRequestDoc,
): Promise<string> {
  const fromIntake = await latestPrivateSurveyForBooking({
    memberId: chartRequest.memberId,
    memberPhone: phone,
  } as BookingDoc);
  const existing = fromIntake?.notionSync?.memberPageId;
  if (existing) return existing;
  const byPhone = await notionQueryFirst(NOTION_MEMBERS_DATABASE_ID, {
    property: "Phone",
    phone_number: { equals: phone },
  });
  if (byPhone) return byPhone;
  const byName = await notionQueryFirst(NOTION_MEMBERS_DATABASE_ID, {
    property: "Name",
    title: { equals: name },
  });
  return byName || "";
}

async function notionQueryFirst(databaseId: string, filter: Record<string, unknown>): Promise<string> {
  const result = await notionRequest(`databases/${databaseId}/query`, "POST", { filter, page_size: 1 });
  const first = Array.isArray(result.results) ? result.results[0] : null;
  return first?.id ? String(first.id) : "";
}

async function notionRequest(path: string, method: "GET" | "POST" | "PATCH" | "DELETE", body?: Record<string, unknown>): Promise<any> {
  const response = await fetch(`https://api.notion.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${notionToken.value()}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_API_VERSION,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`Notion API ${path} failed ${response.status}: ${parsed.message || text}`);
  return parsed;
}

async function readChartRequestFromRequest(request: any): Promise<{ chartRequest: PrivateLessonChartRequestDoc; mode: PrivateLessonChartMode }> {
  const requestId = String(request.query?.r || request.query?.requestId || "").trim();
  const token = String(request.query?.t || request.query?.token || "").trim();
  const mode = normalizeMode(request.query?.mode);
  const chartRequest = await readChartRequest(requestId, token);
  return { chartRequest, mode };
}

async function readChartRequest(requestId: string, token: string): Promise<PrivateLessonChartRequestDoc> {
  if (!/^plc_[a-zA-Z0-9_.:-]{4,120}$/.test(requestId) || !/^[a-f0-9]{16,80}$/i.test(token)) {
    throw new Error("차트 링크가 올바르지 않습니다.");
  }
  const snap = await refs.privateLessonChartRequest(requestId).get();
  const chartRequest = snap.data();
  if (!chartRequest || chartRequest.accessTokenHash !== sha256(token)) throw new Error("차트 링크를 확인할 수 없습니다.");
  return chartRequest;
}

function publicChartRequest(chartRequest: PrivateLessonChartRequestDoc, mode: PrivateLessonChartMode): Record<string, unknown> {
  return {
    requestId: chartRequest.requestId,
    mode,
    memberName: chartRequest.memberName,
    staffName: chartRequest.staffName,
    lessonDate: chartRequest.lessonDate,
    lessonTime: lessonTimeText(chartRequest),
    sessionNumber: chartRequest.sessionNumber,
    preStatus: chartRequest.preStatus,
    postStatus: chartRequest.postStatus,
    intakeSummary: chartRequest.intakeSummary || null,
  };
}

async function latestPrivateSurveyForBooking(booking: BookingDoc): Promise<PrivateSurveyResponseDoc | null> {
  const byMember = booking.memberId
    ? await refs.privateSurveyResponses().where("matching.memberId", "==", booking.memberId).limit(10).get()
    : null;
  const memberHit = byMember?.docs
    .map((doc) => doc.data())
    .filter((doc) => (doc.surveyType || "private") === "private")
    .sort((a, b) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0))[0];
  if (memberHit) return memberHit;
  const byPhone = booking.memberPhone
    ? await refs.privateSurveyResponses().where("memberPhone", "==", booking.memberPhone).limit(10).get()
    : null;
  return (
    byPhone?.docs
      .map((doc) => doc.data())
      .filter((doc) => (doc.surveyType || "private") === "private")
      .sort((a, b) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0))[0] || null
  );
}

async function nextSessionNumber(memberId: string): Promise<number> {
  if (!memberId) return 1;
  const snap = await refs.privateLessonChartRecords().where("memberId", "==", memberId).limit(200).get();
  const max = snap.docs.reduce((acc, doc) => Math.max(acc, Number(doc.data().sessionNumber || 0)), 0);
  return max + 1;
}

function isPrivateBooking(booking: BookingDoc): boolean {
  if (booking.appStatus && booking.appStatus !== "reserved") return false;
  if (booking.lessonType === "private" || booking.lessonType === "semi_private") return true;
  const text = `${booking.ticketName || ""} ${booking.ticketClassType || ""} ${booking.ticketType || ""}`;
  return /프라이빗|개인|1:1|PRIVATE|\bP\b/i.test(text);
}

function privateSurveySummaryForRequest(doc: PrivateSurveyResponseDoc): NonNullable<PrivateLessonChartRequestDoc["intakeSummary"]> {
  return {
    responseId: doc.responseId,
    submittedAtText: doc.submittedAtText,
    experienceType: doc.experienceType,
    goal: doc.summary.goal,
    focusArea: doc.summary.focusArea,
    painOrMedicalNote: doc.summary.painOrMedicalNote,
    exerciseLevel: doc.summary.exerciseLevel,
    concernOrDifficulty: doc.summary.concernOrDifficulty,
    expectationOrImportantFactor: doc.summary.expectationOrImportantFactor,
    referralSource: doc.summary.referralSource,
    lifestyleOrPreviousIssue: doc.summary.lifestyleOrPreviousIssue,
  };
}

function gptPromptBrief(record: PrivateLessonChartRecordDoc, chartRequest: PrivateLessonChartRequestDoc): string {
  return [
    "ARCHIVE PILATES 프라이빗 회원용 수업 요약 초안을 작성합니다.",
    "톤: 조용하고 전문적이며 따뜻하게. 통증/병력 상세와 내부 판단은 직접 노출하지 않습니다.",
    `회원: ${record.memberName}`,
    `회차: ${record.sessionNumber}회차`,
    `수업일: ${record.lessonDate}`,
    `강사: ${record.staffName}`,
    `사전설문 요약: ${safeJson(chartRequest.intakeSummary || {})}`,
    `수업 전 계획: ${safeJson(record.prePlan || {})}`,
    `수업 후 기록: ${safeJson(record.postRecord || {})}`,
    "출력: summary 2문장, nextDirection 1문장.",
  ].join("\n");
}

function gptSourceHash(record: PrivateLessonChartRecordDoc, chartRequest: PrivateLessonChartRequestDoc): string {
  return stableHash({
    requestId: record.requestId,
    intakeSummary: chartRequest.intakeSummary || {},
    prePlan: record.prePlan || {},
    postRecord: record.postRecord || {},
  });
}

function notionChartChildren(record: PrivateLessonChartRecordDoc, chartRequest: PrivateLessonChartRequestDoc): Record<string, unknown>[] {
  return [
    heading(3, `📋 ${record.memberName}님 개인레슨 차트`),
    paragraph(`회차: ${record.sessionNumber}회차 / 수업일: ${lessonTimeText(chartRequest)} / 담당: ${record.staffName || "미정"}`),
    heading(3, "✔ 오늘의 수업 목적"),
    ...bullets(textArray(record.prePlan?.goals).length ? textArray(record.prePlan?.goals) : ["수업 전 계획 미작성"]),
    divider(),
    heading(3, "🔹 사전설문 참고"),
    ...bullets([
      `목표: ${chartRequest.intakeSummary?.goal || "-"}`,
      `신경 부위: ${chartRequest.intakeSummary?.focusArea || "-"}`,
      `운동 수준: ${chartRequest.intakeSummary?.exerciseLevel || "-"}`,
      chartRequest.intakeSummary?.painOrMedicalNote ? "주의 내용 확인 필요" : "특별 주의 내용 없음",
    ]),
    divider(),
    heading(3, "🔹 수업 전 계획"),
    ...bullets([
      `집중 부위: ${textArray(record.prePlan?.focusAreas).join(", ") || "-"}`,
      `예정 기구: ${textArray(record.prePlan?.equipment).join(", ") || "-"}`,
      `강도 계획: ${firstText(record.prePlan?.intensity) || "-"}`,
      `주의점: ${textArray(record.prePlan?.cautions).join(", ") || "-"}`,
      `메모: ${String(record.prePlan?.memo || "-")}`,
    ]),
    divider(),
    heading(3, "🔹 수업 후 기록"),
    ...bullets([
      `컨디션: ${firstText(record.postRecord?.condition) || "-"}`,
      `통증 변화: ${firstText(record.postRecord?.painChange) || "-"}`,
      `진행 부위: ${textArray(record.postRecord?.focusAreas).join(", ") || "-"}`,
      `사용 기구: ${textArray(record.postRecord?.equipment).join(", ") || "-"}`,
      `오늘 변화: ${textArray(record.postRecord?.changes).join(", ") || "-"}`,
      `다음 수업 메모: ${String(record.postRecord?.nextMemo || "-")}`,
    ]),
    divider(),
    heading(3, "✅ 회원용 초안"),
    paragraph(record.gptDraftSummary || "GPT 초안 생성 대기 중입니다."),
    divider(),
    heading(3, "🖼 사진·영상 업로드"),
    paragraph("수업 중 촬영한 사진과 영상은 이 섹션 아래에 업로드합니다. 자동화는 기존 업로드 블록을 삭제하지 않습니다."),
    divider(),
    heading(3, "📱 회원 리포트 검수"),
    paragraph(record.publicReportUrl ? "아래 임베드 또는 회원 리포트 URL 속성에서 최종 회원용 리포트를 확인합니다." : "회원용 HTML 리포트 생성 대기 중입니다."),
    ...(record.publicReportUrl ? [embed(record.publicReportUrl)] : []),
  ];
}

function notionUpdateChildren(record: PrivateLessonChartRecordDoc, chartRequest: PrivateLessonChartRequestDoc): Record<string, unknown>[] {
  return [
    divider(),
    heading(3, `자동화 업데이트 ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`),
    paragraph(`회차: ${record.sessionNumber}회차 / 수업일: ${lessonTimeText(chartRequest)} / 담당: ${record.staffName || "미정"}`),
    heading(3, "수업 전 계획"),
    ...bullets([
      `목표: ${textArray(record.prePlan?.goals).join(", ") || "-"}`,
      `집중 부위: ${textArray(record.prePlan?.focusAreas).join(", ") || "-"}`,
      `예정 기구: ${textArray(record.prePlan?.equipment).join(", ") || "-"}`,
      `메모: ${String(record.prePlan?.memo || "-")}`,
    ]),
    heading(3, "수업 후 기록"),
    ...bullets([
      `컨디션: ${firstText(record.postRecord?.condition) || "-"}`,
      `통증 변화: ${firstText(record.postRecord?.painChange) || "-"}`,
      `오늘 변화: ${textArray(record.postRecord?.changes).join(", ") || "-"}`,
      `다음 수업 메모: ${String(record.postRecord?.nextMemo || "-")}`,
    ]),
    heading(3, "회원 리포트"),
    paragraph(record.gptDraftSummary || "GPT 초안 생성 대기 중입니다."),
    ...(record.publicReportUrl ? [embed(record.publicReportUrl)] : []),
  ];
}

function chartNotes(record: PrivateLessonChartRecordDoc, chartRequest: PrivateLessonChartRequestDoc): string {
  return [
    `[${record.sessionNumber}회차] ${lessonTimeText(chartRequest)}`,
    "",
    "사전설문 요약",
    safeJson(chartRequest.intakeSummary || {}),
    "",
    "수업 전 계획",
    safeJson(record.prePlan || {}),
    "",
    "수업 후 기록",
    safeJson(record.postRecord || {}),
  ].join("\n").slice(0, 1900);
}

function chartUrl(mode: PrivateLessonChartMode, requestId: string, token: string): string {
  const url = new URL(PUBLIC_BASE_URL);
  url.searchParams.set("mode", mode);
  url.searchParams.set("r", requestId);
  url.searchParams.set("t", token);
  return url.toString();
}

function accessTokenFor(requestId: string): string {
  return createHmac("sha256", privateSurveyWebhookSecret.value()).update(`private-chart:${requestId}`).digest("hex").slice(0, 16);
}

function sha256(value: string): string {
  return createHmac("sha256", privateSurveyWebhookSecret.value()).update(value).digest("hex");
}

function normalizeMode(value: unknown): PrivateLessonChartMode {
  return value === "post" ? "post" : "pre";
}

function normalizeAnswers(input: Record<string, unknown>): ChartAnswerMap {
  const output: ChartAnswerMap = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (!/^[a-zA-Z0-9_]{1,40}$/.test(key)) continue;
    if (Array.isArray(value)) output[key] = value.map((item) => String(item).trim()).filter(Boolean).slice(0, 30);
    else if (typeof value === "number") output[key] = Number.isFinite(value) ? value : null;
    else output[key] = String(value || "").trim().slice(0, 1000);
  }
  return output;
}

function setCors(response: any): void {
  response.set("Access-Control-Allow-Origin", "*");
  response.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.set("Access-Control-Allow-Headers", "Content-Type");
}

function lessonTimeText(chartRequest: Pick<PrivateLessonChartRequestDoc, "lessonDate" | "lessonStartAt">): string {
  const date = chartRequest.lessonStartAt?.toDate?.();
  if (!date) return chartRequest.lessonDate;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function textArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (!value) return [];
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function firstText(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] || "");
  return String(value || "");
}

function notionTitle(value: string): Record<string, unknown> {
  return { title: [{ text: { content: value.slice(0, 2000) } }] };
}

function notionText(value: string): Record<string, unknown> {
  return { rich_text: value ? [{ text: { content: value.slice(0, 2000) } }] : [] };
}

function notionSelect(value: string): Record<string, unknown> | undefined {
  return value ? { select: { name: value } } : undefined;
}

function notionMultiSelect(values: string[]): Record<string, unknown> {
  return { multi_select: values.map((name) => ({ name })) };
}

function notionDate(value: string): Record<string, unknown> {
  return { date: { start: value } };
}

function notionNumber(value: unknown): Record<string, unknown> | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? { number } : undefined;
}

function compactObject(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined));
}

function heading(level: 1 | 2 | 3, text: string): Record<string, unknown> {
  return {
    object: "block",
    type: `heading_${level}`,
    [`heading_${level}`]: { rich_text: [{ type: "text", text: { content: text } }] },
  };
}

function paragraph(text: string): Record<string, unknown> {
  return { object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: text.slice(0, 2000) } }] } };
}

function bullets(values: string[]): Record<string, unknown>[] {
  return values.map((value) => ({
    object: "block",
    type: "bulleted_list_item",
    bulleted_list_item: { rich_text: [{ type: "text", text: { content: String(value).slice(0, 2000) } }] },
  }));
}

function divider(): Record<string, unknown> {
  return { object: "block", type: "divider", divider: {} };
}

function embed(url: string): Record<string, unknown> {
  return { object: "block", type: "embed", embed: { url } };
}

function safeJson(value: unknown): string {
  return JSON.stringify(value, null, 2).slice(0, 1200);
}
