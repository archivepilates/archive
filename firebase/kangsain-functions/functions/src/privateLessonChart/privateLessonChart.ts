import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { DEFAULT_STUDIO_ID } from "../config/constants";
import { geminiApiKey, notionToken, privateSurveyWebhookSecret, solapiApiKey, solapiApiSecret, solapiPfid } from "../config/secrets";
import { db } from "../config/firebase";
import { refs } from "../firestore/refs";
import type {
  AlimtalkCandidateDoc,
  BookingDoc,
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
import { ALIMTALK_TEMPLATES } from "../alimtalk/templates";
import { isAlimtalkTemplateApproved } from "../alimtalk/templateStatus";

const PUBLIC_BASE_URL = process.env.PRIVATE_CHART_BASE_URL || "https://in.archivepilates.com/private-chart/";
const NOTION_API_VERSION = "2022-06-28";
const NOTION_MEMBERS_DATABASE_ID = process.env.NOTION_PRIVATE_MEMBERS_DATABASE_ID || "c58a39ceb7ac405ba43b38d3b5871ed3";
const NOTION_SESSION_RECORDS_DATABASE_ID =
  process.env.NOTION_PRIVATE_SESSION_RECORDS_DATABASE_ID || "105b17685d914fbe915ef5b65146d993";
const STAFF_PRIVATE_CHART_TEMPLATE_ID = "KA01TP260527182741301uIuSTL01YQ1";
const PRIVATE_CHART_TEMPLATE_NAME = "강사용_프라이빗 차트 작성 안내 v2";
const PRIVATE_LESSON_REPORT_VIEW_BASE_URL = process.env.PRIVATE_LESSON_REPORT_VIEW_BASE_URL ||
  "https://in.archivepilates.com/api/privateLessonReport";
const GEMINI_MODEL = process.env.PRIVATE_LESSON_REPORT_GEMINI_MODEL || "gemini-2.5-flash";
const GEMINI_FALLBACK_MODELS = (process.env.PRIVATE_LESSON_REPORT_GEMINI_FALLBACK_MODELS || "gemini-2.5-flash-lite")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const GEMINI_GENERATE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const SOLAPI_SEND_URL = "https://api.solapi.com/messages/v4/send-many/detail";
const SOLAPI_TEMPLATE_URL = "https://api.solapi.com/kakao/v2/templates";
const NOTION_INSTRUCTOR_CHART_PAGE_IDS: Record<string, string> = {
  "이초림 수석강사": "22cd49eae4bf802ebc89fe094d0c355a",
  이초림: "22cd49eae4bf802ebc89fe094d0c355a",
  "배민진 원장님": "22dd49eae4bf80258427fe92a4b6ce2c",
  배민진: "22dd49eae4bf80258427fe92a4b6ce2c",
  "정은영 부원장님": "22dd49eae4bf809da7e7d6953e41eb86",
  정은영: "22dd49eae4bf809da7e7d6953e41eb86",
  "김기효 강사": "36ed49eae4bf8161a0d3edd9f30643b9",
  김기효: "36ed49eae4bf8161a0d3edd9f30643b9",
};

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
      const record = (await refs.privateLessonChartRecord(chartRequest.requestId).get()).data() || null;
      response.status(200).json(publicChartRequest(chartRequest, mode, record));
      return;
    }
    if (request.method === "POST") {
      const body = request.body || {};
      const chartRequest = await readChartRequest(String(body.requestId || ""), String(body.token || ""));
      if (String(body.action || "") === "convertReport") {
        const result = await convertPrivateLessonReportFromChart(chartRequest);
        response.status(200).json({ ok: true, ...result });
        return;
      }
      if (String(body.action || "") === "approveReport") {
        const result = await approvePrivateLessonReportFromChart(chartRequest);
        response.status(200).json({ ok: true, ...result });
        return;
      }
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

export async function privateLessonReportViewHandler(request: any, response: any): Promise<void> {
  const recordId = String(request.query?.recordId || request.query?.r || request.query?.record || "");
  const requestId = String(request.query?.requestId || request.query?.req || request.query?.request || "");
  const token = String(request.query?.token || request.query?.t || request.query?.accessToken || "");
  response.set("Cache-Control", "no-store");

  if ((!recordId && !requestId) || !token) {
    response.status(400).send(renderPrivateLessonReportMessagePage("리포트 링크 정보가 올바르지 않습니다."));
    return;
  }

  let record = recordId ? (await refs.privateLessonChartRecord(recordId).get()).data() : undefined;
  if (!record && requestId) {
    const snap = await refs.privateLessonChartRecords().where("requestId", "==", requestId).limit(1).get();
    record = snap.docs.length ? snap.docs[0].data() : undefined;
  }
  if (!record) {
    response.status(404).send(renderPrivateLessonReportMessagePage("회차 기록을 찾을 수 없습니다."));
    return;
  }

  const requestSnap = await refs.privateLessonChartRequest(record.requestId).get();
  const requestDoc = requestSnap.data();
  const storedToken = String(requestDoc?.accessTokenHash || "");
  const isAuthorized = token === storedToken || sha256(token) === storedToken;
  if (!requestDoc || !isAuthorized) {
    response.status(403).send(renderPrivateLessonReportMessagePage("리포트 조회 권한이 없습니다."));
    return;
  }

  response.status(200).send(renderPrivateLessonReportPage(record, requestDoc));
}

export async function notionPrivateLessonReportWebhookHandler(request: any, response: any): Promise<void> {
  if (request.method !== "POST") {
    response.status(405).json({ ok: false, error: "method not allowed" });
    return;
  }

  try {
    const body = request.body || {};
    if (body.verification_token) {
      await db
        .collection("systemSettings")
        .doc("notionPrivateLessonReportWebhook")
        .set(
          {
            verificationToken: String(body.verification_token),
            verified: false,
            updatedAt: nowTimestamp(),
          },
          { merge: true },
        );
      response.status(200).json({ ok: true });
      return;
    }

    const trusted = await verifyNotionWebhookSignature(request);
    if (!trusted) {
      response.status(401).json({ ok: false, error: "invalid signature" });
      return;
    }

    const result = await handleNotionPrivateLessonReportEvent(body);
    response.status(200).json({ ok: true, ...result });
  } catch (err) {
    const message = errorMessage(err);
    logger.warn("notionPrivateLessonReportWebhook failed", { message });
    response.status(500).json({ ok: false, error: message });
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

export async function createAndSendTomorrowPrivateLessonCharts(): Promise<{
  date: string;
  createSummary: Awaited<ReturnType<typeof createPrivateLessonChartRequestsForDate>>;
  sendSummary: Awaited<ReturnType<typeof sendPendingPrivateLessonChartAlimtalksForDate>>;
}> {
  const targetDate = addDays(todayKst(), 1);
  const createSummary = await createPrivateLessonChartRequestsForDate(targetDate);
  const sendSummary = await sendPendingPrivateLessonChartAlimtalksForDate(targetDate);
  return { date: targetDate, createSummary, sendSummary };
}

export async function createPrivateLessonChartRequestsForDate(date: string): Promise<{
  date: string;
  checked: number;
  created: number;
  skipped: number;
}> {
  const snap = await refs.bookings().where("lectureDate", "==", date).limit(500).get();
  const bookings = canonicalPrivateBookings(snap.docs.map((doc) => doc.data()));
  let checked = 0;
  let created = 0;
  let skipped = snap.size - bookings.length;

  for (const booking of bookings) {
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

export async function sendPendingPrivateLessonChartAlimtalksForDate(date: string): Promise<{
  date: string;
  checked: number;
  sent: number;
  skipped: number;
  failed: number;
}> {
  const templateApproved = await isStaffPrivateChartTemplateApproved();
  const snap = await refs.privateLessonChartRequests().where("lessonDate", "==", date).limit(500).get();
  const canonical = canonicalChartRequests(snap.docs.map((doc) => doc.data()));
  const canonicalIds = new Set(canonical.map((request) => request.requestId));
  let checked = 0;
  let sent = 0;
  let skipped = snap.size - canonical.length;
  let failed = 0;

  for (const request of snap.docs.map((doc) => doc.data())) {
    if (!canonicalIds.has(request.requestId) && isSendablePrivateChartRequest(request)) {
      await refs.privateLessonChartRequest(request.requestId).set(
        {
          alimtalk: {
            ...(request.alimtalk || {}),
            status: "skipped",
            templateName: PRIVATE_CHART_TEMPLATE_NAME,
            templateId: STAFF_PRIVATE_CHART_TEMPLATE_ID,
            lastError: "동일 수업의 실제 예약 ID 요청이 있어 Excel 중복 요청은 발송 제외",
          },
          updatedAt: nowTimestamp(),
        },
        { merge: true },
      );
    }
  }

  for (const request of canonical) {
    if (!isSendablePrivateChartRequest(request)) {
      skipped += 1;
      continue;
    }
    checked += 1;
    if (!templateApproved) {
      await refs.privateLessonChartRequest(request.requestId).set(
        {
          alimtalk: {
            ...(request.alimtalk || {}),
            status: "template_pending",
            templateName: PRIVATE_CHART_TEMPLATE_NAME,
            templateId: STAFF_PRIVATE_CHART_TEMPLATE_ID,
            lastError: "강사용 프라이빗 차트 알림톡 템플릿 승인 대기",
          },
          updatedAt: nowTimestamp(),
        },
        { merge: true },
      );
      skipped += 1;
      continue;
    }

    const sendId = `staff_private_lesson_chart_${request.requestId}`;
    const existingSend = (await refs.alimtalkSend(sendId).get()).data();
    if (existingSend?.status === "done") {
      await refs.privateLessonChartRequest(request.requestId).set(
        {
          alimtalk: {
            ...(request.alimtalk || {}),
            status: "sent",
            templateName: PRIVATE_CHART_TEMPLATE_NAME,
            templateId: STAFF_PRIVATE_CHART_TEMPLATE_ID,
            solapiMessageId: existingSend.solapiMessageId || "",
            lastError: null,
          },
          updatedAt: nowTimestamp(),
        },
        { merge: true },
      );
      skipped += 1;
      continue;
    }

    try {
      const variables = privateChartAlimtalkVariables(request);
      const result = await sendStaffPrivateChartAlimtalk(request.staffPhone, variables);
      await refs.privateLessonChartRequest(request.requestId).set(
        {
          alimtalk: {
            status: "sent",
            templateName: PRIVATE_CHART_TEMPLATE_NAME,
            templateId: STAFF_PRIVATE_CHART_TEMPLATE_ID,
            solapiMessageId: result.messageId,
            sentAt: nowTimestamp(),
            lastError: null,
          },
          updatedAt: nowTimestamp(),
        },
        { merge: true },
      );
      await refs.alimtalkSend(sendId).set(
        {
          sendId,
          studioId: request.studioId,
          candidateId: sendId,
          memberId: request.memberId,
          memberName: request.memberName,
          memberPhone: request.staffPhone,
          templateCode: STAFF_PRIVATE_CHART_TEMPLATE_ID,
          dedupeKey: sendId,
          dedupePolicy: "강사용 프라이빗 차트 수업별 1회",
          dedupeWindowDays: null,
          status: "done",
          attempts: 1,
          maxAttempts: 1,
          nextRunAt: nowTimestamp(),
          solapiMessageId: result.messageId,
          variables,
          lastError: null,
          createdByUid: "system:private-lesson-chart",
          createdAt: nowTimestamp(),
          updatedAt: nowTimestamp(),
        },
        { merge: true },
      );
      sent += 1;
    } catch (err) {
      const message = errorMessage(err);
      failed += 1;
      await refs.privateLessonChartRequest(request.requestId).set(
        {
          alimtalk: {
            ...(request.alimtalk || {}),
            status: "failed",
            templateName: PRIVATE_CHART_TEMPLATE_NAME,
            templateId: STAFF_PRIVATE_CHART_TEMPLATE_ID,
            lastError: message,
          },
          updatedAt: nowTimestamp(),
        },
        { merge: true },
      );
      logger.warn("sendPendingPrivateLessonChartAlimtalksForDate failed", {
        requestId: request.requestId,
        bookingId: request.bookingId,
        message,
      });
    }
  }

  logger.info("sendPendingPrivateLessonChartAlimtalksForDate completed", { date, checked, sent, skipped, failed });
  return { date, checked, sent, skipped, failed };
}

export async function generatePendingPrivateLessonChartReports(): Promise<{
  checked: number;
  generated: number;
  skipped: number;
  failed: number;
}> {
  const snap = await refs.privateLessonChartRecords().where("gptStatus", "==", "pending").limit(100).get();
  let checked = 0;
  let generated = 0;
  let skipped = 0;
  let failed = 0;

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
    const result = await generatePrivateLessonReportDraft(record, chartRequest).catch((err) => {
      logger.warn("generatePendingPrivateLessonChartReports failed", {
        recordId: record.recordId,
        message: errorMessage(err),
      });
      return null;
    });
    if (result?.generated || result?.ready) generated += 1;
    else failed += 1;
  }

  logger.info("generatePendingPrivateLessonChartReports completed", { checked, generated, skipped, failed });
  return { checked, generated, skipped, failed };
}

export async function enqueueApprovedPrivateLessonReportAlimtalks(): Promise<{
  checked: number;
  queued: number;
  skipped: number;
  completed: number;
  failed: number;
}> {
  const notionPages = await notionApprovedReportPages();
  const templateApproved = await isAlimtalkTemplateApproved(ALIMTALK_TEMPLATES.private_lesson_report.code);
  let checked = 0;
  let queued = 0;
  let skipped = 0;
  let completed = 0;
  let failed = 0;

  for (const page of notionPages) {
    checked += 1;
    const result = await enqueuePrivateLessonReportForNotionPage(page, templateApproved);
    if (result === "queued") queued += 1;
    else if (result === "completed") completed += 1;
    else if (result === "failed") failed += 1;
    else skipped += 1;
  }

  logger.info("enqueueApprovedPrivateLessonReportAlimtalks completed", {
    checked,
    queued,
    skipped,
    completed,
    failed,
  });
  return { checked, queued, skipped, completed, failed };
}

async function handleNotionPrivateLessonReportEvent(body: any): Promise<{ status: string }> {
  const eventId = String(body.id || "");
  if (eventId && !(await claimNotionWebhookEvent(eventId, body))) return { status: "duplicate" };
  if (String(body.type || "") !== "page.properties_updated") return { status: "ignored_type" };

  const pageId = String(body.entity?.id || "");
  if (!pageId) return { status: "missing_page" };
  const updatedProperties = Array.isArray(body.data?.updated_properties)
    ? body.data.updated_properties.map(String)
    : [];
  if (
    updatedProperties.length &&
    !updatedProperties.some((name: string) => ["발송", "발송상태", "회원 리포트"].includes(name))
  ) {
    return { status: "ignored_property" };
  }

  const page = await notionRequest(`pages/${pageId}`, "GET");
  if (!isPrivateSessionRecordPage(page)) return { status: "ignored_page" };
  const templateApproved = await isAlimtalkTemplateApproved(ALIMTALK_TEMPLATES.private_lesson_report.code);
  const result = await enqueuePrivateLessonReportForNotionPage(page, templateApproved);
  if (eventId) {
    await db.collection("notionWebhookEvents").doc(eventId).set(
      {
        status: result,
        pageId,
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
  }
  return { status: result };
}

async function enqueuePrivateLessonReportForNotionPage(
  page: any,
  templateApproved: boolean,
): Promise<"queued" | "completed" | "failed" | "skipped" | "already_queued" | "template_pending"> {
  if (!notionCheckbox(page.properties?.["발송"])) return "skipped";
  if (notionSelectName(page.properties?.["발송상태"]) !== "대기") return "skipped";
  if (!notionUrl(page.properties?.["회원 리포트"])) return "skipped";

  const recordId = notionRichText(page.properties?.["Chart Request ID"]);
  const pageId = String(page.id || "");
  if (!pageId) return "skipped";
  const record =
    (recordId ? (await refs.privateLessonChartRecord(recordId).get()).data() : null) ||
    (await privateLessonChartRecordByNotionPageId(pageId));
  if (!record) {
    logger.warn("notion private report: record not found", { pageId, recordId });
    return "skipped";
  }
  if (
    !record.postRecord ||
    record.gptStatus !== "draft_created" ||
    !(record.publicReportCanonicalUrl || record.publicReportUrl) ||
    !record.memberPhone
  ) {
    return "skipped";
  }
  return enqueuePrivateLessonReportForRecord(record, templateApproved, String(page.id || ""), "system:notion-private-report");
}

async function approvePrivateLessonReportFromChart(
  chartRequest: PrivateLessonChartRequestDoc,
): Promise<{
  recordId: string;
  reportStatus: string;
  candidateId?: string;
  reportUrl?: string;
  message?: string;
}> {
  const record = (await refs.privateLessonChartRecord(chartRequest.requestId).get()).data();
  if (!record) throw new Error("회차 기록을 찾을 수 없습니다.");
  if (!record.postRecord || !record.postSubmittedAt) {
    throw new Error("수업 후 기록 제출 후 승인할 수 있습니다.");
  }
  if (!["draft_created", "approved", "published"].includes(record.gptStatus) || !(record.publicReportUrl || record.publicReportCanonicalUrl)) {
    throw new Error("회원용 리포트가 아직 생성되지 않았습니다. 잠시 후 다시 확인해 주세요.");
  }
  if (!record.memberPhone) throw new Error("회원 연락처가 없어 발송 후보를 만들 수 없습니다.");

  const templateApproved = await isAlimtalkTemplateApproved(ALIMTALK_TEMPLATES.private_lesson_report.code);
  const result = await enqueuePrivateLessonReportForRecord(record, templateApproved, record.notionSync?.pageId || "", "staff:private-chart");
  const candidateId = `private_lesson_report_${record.recordId}`;
  const status =
    result === "queued" || result === "already_queued"
      ? "queued"
      : result === "completed"
        ? "sent"
        : result === "template_pending"
          ? "approved"
          : result === "failed"
            ? "failed"
            : "approved";
  await refs.privateLessonChartRecord(record.recordId).set(
    {
      gptStatus: status === "sent" ? "published" : "approved",
      publicReportApproval: {
        status,
        approvedAt: nowTimestamp(),
        approvedBy: chartRequest.staffName || "staff",
        candidateId,
        lastError: result === "template_pending" ? "프라이빗 회원 리포트 템플릿 승인 대기" : null,
      },
      updatedAt: nowTimestamp(),
    },
    { merge: true },
  );
  return {
    recordId: record.recordId,
    reportStatus: status,
    candidateId,
    reportUrl: record.publicReportUrl || record.publicReportCanonicalUrl || "",
    message:
      status === "queued"
        ? "회원 알림톡 발송 후보에 등록되었습니다."
        : status === "sent"
          ? "이미 발송 완료된 리포트입니다."
          : "승인되었습니다. 템플릿 상태 확인 후 발송됩니다.",
  };
}

async function convertPrivateLessonReportFromChart(
  chartRequest: PrivateLessonChartRequestDoc,
): Promise<{
  recordId: string;
  reportStatus: string;
  taskId?: string;
  reportUrl?: string;
  message: string;
}> {
  const record = (await refs.privateLessonChartRecord(chartRequest.requestId).get()).data();
  if (!record) throw new Error("회차 기록을 찾을 수 없습니다.");
  if (!record.postRecord || !record.postSubmittedAt) {
    throw new Error("수업 후 기록 제출 후 리포트로 변환할 수 있습니다.");
  }

  if (
    ["draft_created", "approved", "published"].includes(record.gptStatus) &&
    (record.publicReportUrl || record.publicReportCanonicalUrl)
  ) {
    return {
      recordId: record.recordId,
      reportStatus: "ready",
      taskId: record.gptTaskId,
      reportUrl: record.publicReportUrl || record.publicReportCanonicalUrl || "",
      message: "이미 변환된 회원용 리포트가 있습니다. 내용을 확인한 뒤 발송 승인해 주세요.",
    };
  }

  const generated = await generatePrivateLessonReportDraft(record, chartRequest, { force: true });
  const notionSync = await syncPrivateLessonChartRecordToNotion(generated.record, chartRequest);
  await refs.privateLessonChartRecord(record.recordId).set({ notionSync, updatedAt: nowTimestamp() }, { merge: true });
  return {
    recordId: record.recordId,
    reportStatus: "ready",
    taskId: generated.taskId,
    reportUrl: generated.record.publicReportUrl || generated.record.publicReportCanonicalUrl || "",
    message: "수업 전/후 기록을 반영해 회원용 리포트를 생성했습니다. 내용을 확인한 뒤 발송 승인해 주세요.",
  };
}

async function enqueuePrivateLessonReportForRecord(
  record: PrivateLessonChartRecordDoc,
  templateApproved: boolean,
  notionPageId = "",
  reviewedByUid = "system:private-report",
): Promise<"queued" | "completed" | "failed" | "skipped" | "already_queued" | "template_pending"> {
  const resolved = await resolveReportShortUrl(record);
  if (!resolved.reportTargetUrl) return "skipped";
  if (resolved.shouldUpdateRecord) {
    await refs.privateLessonChartRecord(record.recordId).set(
      {
        publicReportUrl: resolved.publicReportUrl,
        publicReportCanonicalUrl: resolved.publicReportCanonicalUrl,
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
  }
  if (resolved.shouldUpdateNotion && notionPageId) {
    await notionRequest(`pages/${notionPageId}`, "PATCH", {
      properties: {
        "회원 리포트": { url: resolved.publicReportUrl },
      },
    }).catch((err) => {
      logger.warn("session notion report link patch failed", {
        pageId: notionPageId,
        memberName: record.memberName,
        recordId: record.recordId,
        error: errorMessage(err),
      });
    });
  }
  const reportTargetUrl = resolved.reportTargetUrl;

  const candidateId = `private_lesson_report_${record.recordId}`;
  const existing = (await refs.alimtalkCandidate(candidateId).get()).data();
  if (existing?.status === "sent") {
    if (notionPageId) await updatePrivateLessonReportNotionStatus(notionPageId, "완료");
    return "completed";
  }
  if (existing?.status === "queued" || existing?.status === "processing") return "already_queued";

  const link = await ensureShortLink({
    type: "private_report",
    targetUrl: reportTargetUrl,
    sourceId: record.recordId,
  });
  const now = nowTimestamp();
  const nextStatus: AlimtalkCandidateDoc["status"] = templateApproved ? "queued" : "candidate";
  const candidate: AlimtalkCandidateDoc = {
    candidateId,
    studioId: record.studioId || DEFAULT_STUDIO_ID,
    memberId: record.memberId,
    memberName: record.memberName,
    memberPhone: record.memberPhone,
    type: "private_lesson_report",
    status: nextStatus,
    templateCode: ALIMTALK_TEMPLATES.private_lesson_report.code,
    title: "프라이빗 회원 리포트",
    reason: `${record.memberName} ${record.sessionNumber}회차 회원 리포트 검수 완료`,
    sourceActionKey: record.recordId,
    sourceDate: record.lessonDate,
    payload: {
      memberName: record.memberName,
      sessionNumberText: `${record.sessionNumber}회차`,
      sessionLabel: `${record.sessionNumber}회차`,
      lessonDate: record.lessonDate,
      lessonDateTime: lessonTimeText(record),
      staffName: record.staffName,
      instructorName: record.staffName,
      recordId: record.recordId,
      requestId: record.requestId,
      publicReportUrl: reportTargetUrl,
      reportLinkId: link.linkId,
      reportShortUrl: link.shortUrl,
      notionPageId: String(notionPageId || ""),
    },
    attempts: existing?.attempts || 0,
    maxAttempts: existing?.maxAttempts || 2,
    queuedBy: templateApproved ? "auto" : undefined,
    reviewedByUid: templateApproved ? reviewedByUid : existing?.reviewedByUid,
    reviewedAt: templateApproved ? now : existing?.reviewedAt || null,
    lastError: templateApproved ? null : "프라이빗 회원 리포트 템플릿 승인 대기",
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  await refs.alimtalkCandidate(candidateId).set(candidate, { merge: true });
  if (existing?.status === "failed") return "failed";
  return templateApproved ? "queued" : "template_pending";
}

async function claimNotionWebhookEvent(eventId: string, body: any): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const ref = db.collection("notionWebhookEvents").doc(eventId);
    const snap = await tx.get(ref);
    if (snap.exists) return false;
    tx.set(ref, {
      eventId,
      type: String(body.type || ""),
      pageId: String(body.entity?.id || ""),
      status: "received",
      createdAt: nowTimestamp(),
      updatedAt: nowTimestamp(),
    });
    return true;
  });
}

async function notionApprovedReportPages(): Promise<any[]> {
  const result = await notionRequest(`databases/${NOTION_SESSION_RECORDS_DATABASE_ID}/query`, "POST", {
    filter: {
      and: [
        { property: "발송", checkbox: { equals: true } },
        { property: "발송상태", select: { equals: "대기" } },
        { property: "회원 리포트", url: { is_not_empty: true } },
      ],
    },
    page_size: 50,
  });
  return Array.isArray(result.results) ? result.results : [];
}

async function privateLessonChartRecordByNotionPageId(
  pageId: string,
): Promise<PrivateLessonChartRecordDoc | null> {
  if (!pageId) return null;
  const snap = await refs.privateLessonChartRecords().where("notionSync.pageId", "==", pageId).limit(1).get();
  return snap.docs.length ? snap.docs[0].data() : null;
}

async function resolveReportShortUrl(record: PrivateLessonChartRecordDoc): Promise<{
  reportTargetUrl: string;
  publicReportUrl: string;
  publicReportCanonicalUrl: string;
  shouldUpdateRecord: boolean;
  shouldUpdateNotion: boolean;
}> {
  const canonical = String(record.publicReportCanonicalUrl || "").trim();
  const current = String(record.publicReportUrl || "").trim();
  const requestSnap = record.requestId ? await refs.privateLessonChartRequest(record.requestId).get() : null;
  const requestDoc = requestSnap?.data();
  const canonicalFromRequest = requestDoc
    ? buildPrivateReportCanonicalUrl({
      recordId: String(record.recordId || ""),
      accessTokenHash: String(requestDoc.accessTokenHash || ""),
    })
    : "";
  const currentShortTarget = isShortPrivateReportUrl(current) ? await resolveShortLinkTarget(current) : "";
  const reportTargetUrl = isSupportedPrivateReportTargetUrl(canonical)
    ? canonical
    : isSupportedPrivateReportTargetUrl(canonicalFromRequest)
      ? canonicalFromRequest
      : isSupportedPrivateReportTargetUrl(currentShortTarget)
        ? currentShortTarget
        : isValidLegacyPrivateReportTargetUrl(canonical)
          ? canonicalFromRequest
          : isValidLegacyPrivateReportTargetUrl(current)
            ? canonicalFromRequest
            : isSupportedPrivateReportTargetUrl(current)
              ? current
              : "";
  if (!reportTargetUrl) {
    return {
      reportTargetUrl: "",
      publicReportUrl: "",
      publicReportCanonicalUrl: "",
      shouldUpdateRecord: false,
      shouldUpdateNotion: false,
    };
  }
  const resolvedShortTarget = isSupportedPrivateReportTargetUrl(currentShortTarget) ? currentShortTarget : "";
  const canonicalNeedsRepair = Boolean(canonical && canonical !== reportTargetUrl);
  const shortNeedsRepair =
    isShortPrivateReportUrl(current) && resolvedShortTarget && resolvedShortTarget !== reportTargetUrl;
  if (isShortPrivateReportUrl(current) && !canonical && !shortNeedsRepair) {
    return {
      reportTargetUrl,
      publicReportUrl: current,
      publicReportCanonicalUrl: "",
      shouldUpdateRecord: false,
      shouldUpdateNotion: false,
    };
  }
  const normalizedCanonical = reportTargetUrl;
  const link = await ensureShortLink({
    type: "private_report",
    targetUrl: normalizedCanonical,
    sourceId: record.recordId,
  });
  return {
    reportTargetUrl: normalizedCanonical,
    publicReportUrl: link.shortUrl,
    publicReportCanonicalUrl: normalizedCanonical,
    shouldUpdateRecord:
      record.publicReportUrl !== link.shortUrl || record.publicReportCanonicalUrl !== normalizedCanonical || shortNeedsRepair || canonicalNeedsRepair,
    shouldUpdateNotion: !isShortPrivateReportUrl(current) || shortNeedsRepair || !record.publicReportCanonicalUrl,
  };
}

async function resolveShortLinkTarget(shortUrl: string): Promise<string> {
  const linkId = shortLinkIdFromUrl(shortUrl);
  if (!linkId) return "";
  const snap = await db.collection("shortLinks").doc(linkId).get();
  const targetUrl = String(snap.data()?.targetUrl || "");
  return isValidUrl(targetUrl) ? targetUrl : "";
}

function isValidPrivateReportTargetUrl(url: string): boolean {
  return isSupportedPrivateReportTargetUrl(url);
}

function isSupportedPrivateReportTargetUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.origin === "https://in.archivepilates.com" &&
      parsed.pathname.includes("/api/privateLessonReport") &&
      Boolean(parsed.searchParams.get("recordId")) &&
      Boolean(parsed.searchParams.get("token"))
    );
  } catch {
    return false;
  }
}

function isValidUrl(url: string): boolean {
  if (!url) return false;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function isValidLegacyPrivateReportTargetUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.origin === "https://in.archivepilates.com" &&
      parsed.pathname.includes("/archivein/api/privateLessonReport") &&
      Boolean(parsed.searchParams.get("recordId")) &&
      Boolean(parsed.searchParams.get("token"))
    );
  } catch {
    return false;
  }
}

function isShortPrivateReportUrl(url: string): boolean {
  return /^https:\/\/in\.archivepilates\.com\/s\/[A-Za-z0-9_-]+\/?$/.test(url || "");
}

async function updatePrivateLessonReportNotionStatus(pageId: string, status: string): Promise<void> {
  if (!pageId) return;
  await notionRequest(`pages/${pageId}`, "PATCH", {
    properties: {
      발송상태: notionSelect(status),
    },
  });
}

async function verifyNotionWebhookSignature(request: any): Promise<boolean> {
  const signature = String(request.get?.("X-Notion-Signature") || request.headers?.["x-notion-signature"] || "");
  if (!signature.startsWith("sha256=")) return false;
  const settings = (await db.collection("systemSettings").doc("notionPrivateLessonReportWebhook").get()).data();
  const verificationToken = String(settings?.verificationToken || "");
  if (!verificationToken) return false;
  const rawBody = request.rawBody
    ? Buffer.isBuffer(request.rawBody)
      ? request.rawBody
      : Buffer.from(String(request.rawBody))
    : Buffer.from(JSON.stringify(request.body || {}));
  const expected = `sha256=${createHmac("sha256", verificationToken).update(rawBody).digest("hex")}`;
  if (signature.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function isPrivateSessionRecordPage(page: any): boolean {
  const parentId = String(page?.parent?.database_id || page?.parent?.data_source_id || "");
  return normalizeNotionId(parentId) === normalizeNotionId(NOTION_SESSION_RECORDS_DATABASE_ID);
}

function normalizeNotionId(value: string): string {
  return String(value || "")
    .replaceAll("-", "")
    .toLowerCase();
}

async function ensureChartRequestForBooking(booking: BookingDoc): Promise<{ requestId: string; created: boolean }> {
  const requestId = `plc_${booking.bookingId}`;
  const existing = await refs.privateLessonChartRequest(requestId).get();
  if (existing.exists) return { requestId, created: false };

  const [staffSnap, intakeSummary, sessionNumber] = await Promise.all([
    booking.staffId ? refs.staff(booking.staffId).get() : Promise.resolve(null as any),
    latestPrivateSurveyForBooking(booking),
    nextSessionNumber(booking),
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
  const mediaUploadUrl = notionSync.instructorPageUrl || notionSync.pageUrl;
  if (mediaUploadUrl) {
    const mediaUploadShort = await ensureShortLink({
      type: "private_chart",
      targetUrl: mediaUploadUrl,
      sourceId: `${requestId}_media`,
    });
    await refs.privateLessonChartRequest(requestId).set(
      {
        mediaUploadUrl,
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
  if (mode === "pre" && (chartRequest.preStatus === "submitted" || base.preSubmittedAt)) {
    throw new Error("이미 제출된 수업 전 계획입니다. 기존 기록 보호를 위해 다시 제출할 수 없습니다.");
  }
  if (mode === "post" && (chartRequest.postStatus === "submitted" || base.postSubmittedAt)) {
    throw new Error("이미 제출된 수업 후 기록입니다. 기존 기록 보호를 위해 다시 제출할 수 없습니다.");
  }
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
  await refs
    .privateLessonChartRequest(chartRequest.requestId)
    .set({ ...requestPatch, updatedAt: now }, { merge: true });

  let recordForNotion = nextRecord;
  if (mode === "post") {
    try {
      recordForNotion = (await generatePrivateLessonReportDraft(nextRecord, chartRequest)).record;
    } catch (err) {
      logger.warn("submitPrivateLessonChart Gemini draft failed", {
        requestId: chartRequest.requestId,
        memberName: chartRequest.memberName,
        message: errorMessage(err),
      });
    }
  }
  const notionSync = await syncPrivateLessonChartRecordToNotion(recordForNotion, chartRequest);
  await recordRef.set({ notionSync, updatedAt: nowTimestamp() }, { merge: true });

  return { requestId: chartRequest.requestId, recordId: recordForNotion.recordId, mode, notionStatus: notionSync.status };
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

async function generatePrivateLessonReportDraft(
  record: PrivateLessonChartRecordDoc,
  chartRequest: PrivateLessonChartRequestDoc,
  options: { force?: boolean } = {},
): Promise<{ taskId: string; generated: boolean; ready: boolean; record: PrivateLessonChartRecordDoc }> {
  const sourceHash = gptSourceHash(record, chartRequest);
  const taskId = `gemini_${record.recordId}_${sourceHash.slice(0, 12)}`;
  if (
    !options.force &&
    record.gptStatus === "draft_created" &&
    record.gptDraftSummary &&
    record.gptDraftNextDirection &&
    record.gptTaskId === taskId &&
    (record.publicReportUrl || record.publicReportCanonicalUrl)
  ) {
    return { taskId, generated: false, ready: true, record };
  }

  const now = nowTimestamp();
  await refs.privateLessonChartRecord(record.recordId).set(
    {
      gptTaskId: taskId,
      gptStatus: "processing",
      gptProvider: "gemini",
      gptModel: GEMINI_MODEL,
      gptSourceHash: sourceHash,
      gptError: null,
      updatedAt: now,
    },
    { merge: true },
  );

  try {
    const draft = await generateGeminiPrivateLessonDraft(record, chartRequest);
    const nextRecord = {
      ...record,
      gptTaskId: taskId,
      gptStatus: "draft_created",
      gptDraftSummary: draft.summary,
      gptDraftNextDirection: draft.nextDirection,
      publicSummary: draft.summary,
      publicNextDirection: draft.nextDirection,
      updatedAt: nowTimestamp(),
    } as PrivateLessonChartRecordDoc;
    const reportResolution = await resolveReportShortUrl(nextRecord);
    const readyRecord = {
      ...nextRecord,
      publicReportUrl: reportResolution.publicReportUrl || nextRecord.publicReportUrl,
      publicReportCanonicalUrl: reportResolution.publicReportCanonicalUrl || nextRecord.publicReportCanonicalUrl,
    } as PrivateLessonChartRecordDoc;
    await refs.privateLessonChartRecord(record.recordId).set(
      {
        gptTaskId: taskId,
        gptStatus: "draft_created",
        gptProvider: "gemini",
        gptModel: GEMINI_MODEL,
        gptSourceHash: sourceHash,
        gptDraftSummary: draft.summary,
        gptDraftNextDirection: draft.nextDirection,
        publicSummary: draft.summary,
        publicNextDirection: draft.nextDirection,
        publicReportUrl: readyRecord.publicReportUrl || "",
        publicReportCanonicalUrl: readyRecord.publicReportCanonicalUrl || "",
        publicReportApproval: { status: "pending", lastError: null },
        gptError: null,
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
    return { taskId, generated: true, ready: true, record: readyRecord };
  } catch (err) {
    const message = errorMessage(err);
    await refs.privateLessonChartRecord(record.recordId).set(
      {
        gptTaskId: taskId,
        gptStatus: "failed",
        gptProvider: "gemini",
        gptModel: GEMINI_MODEL,
        gptSourceHash: sourceHash,
        gptError: message,
        publicReportApproval: { status: "pending", lastError: message },
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
    throw err;
  }
}

async function syncPrivateLessonChartRecordToNotion(
  record: PrivateLessonChartRecordDoc,
  chartRequest: PrivateLessonChartRequestDoc,
): Promise<NonNullable<PrivateLessonChartRecordDoc["notionSync"]>> {
  try {
    const reportResolution = await resolveReportShortUrl(record);
    if (reportResolution.shouldUpdateRecord) {
      await refs.privateLessonChartRecord(record.recordId).set(
        {
          publicReportUrl: reportResolution.publicReportUrl,
          publicReportCanonicalUrl: reportResolution.publicReportCanonicalUrl,
          updatedAt: nowTimestamp(),
        },
        { merge: true },
      );
    }
    const reportUrl = reportResolution.publicReportUrl;
    const properties = compactObject({
      "회원 리포트": reportUrl ? { url: reportUrl } : undefined,
      발송: { checkbox: false },
      발송상태: notionSelect(reportUrl ? "대기" : ""),
    });
    const content = notionChartChildren(record, chartRequest);
    const existingPageId = record.notionSync?.pageId;
    if (existingPageId) {
      await notionRequest(`pages/${existingPageId}`, "PATCH", { properties });
      await appendPageContent(existingPageId, notionUpdateChildren(record, chartRequest));
      const instructorPage = await syncInstructorMemberChartPage(
        record,
        chartRequest,
        record.notionSync?.pageUrl || notionPageUrl(existingPageId),
      );
      return {
        status: "synced",
        pageId: existingPageId,
        pageUrl: record.notionSync?.pageUrl || notionPageUrl(existingPageId),
        instructorPageId: instructorPage?.pageId || record.notionSync?.instructorPageId,
        instructorPageUrl: instructorPage?.pageUrl || record.notionSync?.instructorPageUrl,
        syncedAt: new Date().toISOString(),
      };
    }
    const page = await notionRequest("pages", "POST", {
      parent: { database_id: NOTION_SESSION_RECORDS_DATABASE_ID },
      properties,
      children: content,
    });
    const pageUrl = String(page.url || notionPageUrl(String(page.id)));
    const instructorPage = await syncInstructorMemberChartPage(record, chartRequest, pageUrl);
    return {
      status: "synced",
      pageId: String(page.id),
      pageUrl,
      instructorPageId: instructorPage?.pageId,
      instructorPageUrl: instructorPage?.pageUrl,
      syncedAt: new Date().toISOString(),
    };
  } catch (err) {
    return { status: "failed", error: errorMessage(err), syncedAt: new Date().toISOString() };
  }
}

async function syncInstructorMemberChartPage(
  record: PrivateLessonChartRecordDoc,
  chartRequest: PrivateLessonChartRequestDoc,
  sessionPageUrl: string,
): Promise<{ pageId: string; pageUrl: string } | null> {
  if (!sessionPageUrl) return null;
  const memberPageId = await findInstructorMemberPageId(record.staffName, record.memberName).catch((err) => {
    logger.warn("findInstructorMemberPageId failed", {
      staffName: record.staffName,
      memberName: record.memberName,
      message: errorMessage(err),
    });
    return "";
  });
  if (!memberPageId) return null;
  const title = notionSessionTitle(record, chartRequest);
  const existingPageId = await findChildPageByExactTitle(memberPageId, title);
  if (existingPageId) {
    await appendPageContent(existingPageId, notionInstructorUpdateChildren(record, chartRequest));
    return { pageId: existingPageId, pageUrl: notionPageUrl(existingPageId) };
  }
  const page = await notionRequest("pages", "POST", {
    parent: { page_id: memberPageId },
    properties: notionTitle(title),
    children: notionInstructorChartChildren(record, chartRequest),
  });
  return {
    pageId: String(page.id || ""),
    pageUrl: String(page.url || notionPageUrl(String(page.id || ""))),
  };
}

async function findInstructorMemberPageId(staffName: string, memberName: string): Promise<string> {
  const instructorPageId = NOTION_INSTRUCTOR_CHART_PAGE_IDS[staffName];
  if (!instructorPageId) return "";
  const normalizedMemberName = normalizeKoreanName(memberName);
  const direct = await findChildPageByTitle(instructorPageId, normalizedMemberName);
  if (direct) return direct;
  const children = await notionBlockChildren(instructorPageId);
  for (const child of children) {
    const title = String(child.child_page?.title || "");
    if (!title || /완료|종료|자료|식단|자동화/.test(title)) continue;
    const nested = await findChildPageByTitle(String(child.id || ""), normalizedMemberName);
    if (nested) return nested;
  }
  return "";
}

async function findChildPageByTitle(parentPageId: string, normalizedMemberName: string): Promise<string> {
  const children = await notionBlockChildren(parentPageId);
  const hit = children.find((child) => {
    const title = String(child.child_page?.title || "");
    return title && normalizeKoreanName(title) === normalizedMemberName;
  });
  return hit?.id ? String(hit.id) : "";
}

async function findChildPageByExactTitle(parentPageId: string, title: string): Promise<string> {
  const children = await notionBlockChildren(parentPageId);
  const hit = children.find((child) => String(child.child_page?.title || "") === title);
  return hit?.id ? String(hit.id) : "";
}

async function notionBlockChildren(blockId: string): Promise<any[]> {
  const children: any[] = [];
  let cursor = "";
  do {
    const query = cursor ? `?page_size=100&start_cursor=${encodeURIComponent(cursor)}` : "?page_size=100";
    const result = await notionRequest(`blocks/${blockId}/children${query}`, "GET");
    children.push(...(Array.isArray(result.results) ? result.results : []));
    cursor = result.has_more && result.next_cursor ? String(result.next_cursor) : "";
  } while (cursor);
  return children;
}

async function pageHasLink(pageId: string, url: string): Promise<boolean> {
  const children = await notionBlockChildren(pageId);
  return children.some((child) => blockHasHref(child, url));
}

function blockHasHref(block: any, url: string): boolean {
  const values = Object.values(block || {});
  return values.some((value: any) =>
    Array.isArray(value?.rich_text)
      ? value.rich_text.some((item: any) => String(item?.href || item?.text?.link?.url || "") === url)
      : false,
  );
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

async function notionRequest(
  path: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  body?: Record<string, unknown>,
): Promise<any> {
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

async function readChartRequestFromRequest(
  request: any,
): Promise<{ chartRequest: PrivateLessonChartRequestDoc; mode: PrivateLessonChartMode }> {
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
  if (!chartRequest || chartRequest.accessTokenHash !== sha256(token))
    throw new Error("차트 링크를 확인할 수 없습니다.");
  return chartRequest;
}

function publicChartRequest(
  chartRequest: PrivateLessonChartRequestDoc,
  mode: PrivateLessonChartMode,
  record: PrivateLessonChartRecordDoc | null = null,
): Record<string, unknown> {
  const approvalStatus = record?.publicReportApproval?.status || "";
  const reportReady = record?.gptStatus === "draft_created" &&
    Boolean(record.publicReportUrl || record.publicReportCanonicalUrl);
  const reportStatus = approvalStatus && approvalStatus !== "pending"
    ? approvalStatus
    : reportReady
      ? "ready"
      : record?.gptStatus || "pending";
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
    existingAnswers: record
      ? {
        pre: record.prePlan || null,
        post: record.postRecord || null,
      }
      : { pre: null, post: null },
    locked: mode === "pre"
      ? chartRequest.preStatus === "submitted" || Boolean(record?.preSubmittedAt)
      : chartRequest.postStatus === "submitted" || Boolean(record?.postSubmittedAt),
    report: record
      ? {
        recordId: record.recordId,
        status: reportStatus,
        gptStatus: record.gptStatus,
        url: record.publicReportUrl || "",
        canonicalUrl: record.publicReportCanonicalUrl || "",
        summary: record.gptDraftSummary || record.publicSummary || "",
        nextDirection: record.gptDraftNextDirection || record.publicNextDirection || "",
        approval: record.publicReportApproval || null,
        postSubmitted: Boolean(record.postSubmittedAt),
      }
      : null,
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

async function nextSessionNumber(booking: BookingDoc): Promise<number> {
  if (!booking.memberId) return 1;
  const snap = await refs.bookings().where("memberId", "==", booking.memberId).limit(500).get();
  const currentStart = booking.lectureStartAt?.toMillis?.() || 0;
  const canonical = canonicalPrivateBookings(snap.docs.map((doc) => doc.data()))
    .filter((item) => item.appStatus === "reserved")
    .filter((item) => !["absent", "late_cancel"].includes(item.attendanceStatus));
  if (currentStart) {
    return canonical.filter((item) => (item.lectureStartAt?.toMillis?.() || 0) < currentStart).length + 1;
  }
  const currentDate = booking.lectureDate || "";
  return canonical.filter((item) => (item.lectureDate || "") < currentDate).length + 1;
}

function isPrivateBooking(booking: BookingDoc): boolean {
  if (booking.appStatus && booking.appStatus !== "reserved") return false;
  if (booking.lessonType === "private" || booking.lessonType === "semi_private") return true;
  const text = `${booking.ticketName || ""} ${booking.ticketClassType || ""} ${booking.ticketType || ""}`;
  return /프라이빗|개인|1:1|PRIVATE|\bP\b/i.test(text);
}

function canonicalPrivateBookings(bookings: BookingDoc[]): BookingDoc[] {
  const grouped = new Map<string, BookingDoc>();
  for (const booking of bookings) {
    if (!isPrivateBooking(booking)) continue;
    const key = privateLessonOccurrenceKey(booking);
    const current = grouped.get(key);
    if (!current || preferCanonicalBooking(booking, current)) grouped.set(key, booking);
  }
  return [...grouped.values()].sort(
    (a, b) => (a.lectureStartAt?.toMillis?.() || 0) - (b.lectureStartAt?.toMillis?.() || 0),
  );
}

function canonicalChartRequests(requests: PrivateLessonChartRequestDoc[]): PrivateLessonChartRequestDoc[] {
  const grouped = new Map<string, PrivateLessonChartRequestDoc>();
  for (const request of requests) {
    const key = privateChartRequestOccurrenceKey(request);
    const current = grouped.get(key);
    if (!current || preferCanonicalBookingLike(request.bookingId, current.bookingId)) grouped.set(key, request);
  }
  return [...grouped.values()].sort(
    (a, b) => (a.lessonStartAt?.toMillis?.() || 0) - (b.lessonStartAt?.toMillis?.() || 0),
  );
}

function privateLessonOccurrenceKey(
  value: Pick<BookingDoc, "memberId" | "staffId" | "lectureStartAt" | "lectureDate" | "memberName" | "staffName">,
): string {
  const start = value.lectureStartAt?.toMillis?.() || value.lectureDate || "";
  return [
    value.memberId || normalizeKoreanName(value.memberName || ""),
    value.staffId || normalizeKoreanName(value.staffName || ""),
    start,
  ].join("|");
}

function privateChartRequestOccurrenceKey(
  value: Pick<
    PrivateLessonChartRequestDoc,
    "memberId" | "staffId" | "lessonStartAt" | "lessonDate" | "memberName" | "staffName"
  >,
): string {
  const start = value.lessonStartAt?.toMillis?.() || value.lessonDate || "";
  return [
    value.memberId || normalizeKoreanName(value.memberName || ""),
    value.staffId || normalizeKoreanName(value.staffName || ""),
    start,
  ].join("|");
}

function preferCanonicalBooking(next: BookingDoc, current: BookingDoc): boolean {
  return preferCanonicalBookingLike(next.bookingId, current.bookingId);
}

function preferCanonicalBookingLike(nextBookingId: string, currentBookingId: string): boolean {
  const nextExcel = isExcelBookingId(nextBookingId);
  const currentExcel = isExcelBookingId(currentBookingId);
  if (nextExcel !== currentExcel) return !nextExcel;
  return String(nextBookingId || "") < String(currentBookingId || "");
}

function isExcelBookingId(bookingId: string): boolean {
  return String(bookingId || "").startsWith("excel_booking_");
}

function isSendablePrivateChartRequest(request: PrivateLessonChartRequestDoc): boolean {
  if (request.alimtalk?.status !== "template_pending" && request.alimtalk?.status !== "queued") return false;
  if (!request.staffPhone || !normalizePhone(request.staffPhone)) return false;
  if (!request.preShortUrl || !request.postShortUrl || !request.mediaUploadShortUrl) return false;
  if (!request.memberName || !request.staffName || !request.lessonStartAt) return false;
  return true;
}

function privateChartAlimtalkVariables(request: PrivateLessonChartRequestDoc): Record<string, string> {
  return {
    "#{강사명}": request.staffName,
    "#{회원명}": request.memberName,
    "#{회차}": String(request.sessionNumber || ""),
    "#{수업일시}": lessonTimeText(request),
    "#{수업전계획링크ID}": shortLinkIdFromUrl(request.preShortUrl),
    "#{수업후기록링크ID}": shortLinkIdFromUrl(request.postShortUrl),
    "#{사진영상업로드링크ID}": shortLinkIdFromUrl(request.mediaUploadShortUrl || ""),
  };
}

function shortLinkIdFromUrl(shortUrl: string): string {
  const match = String(shortUrl || "").match(/\/s\/([^/?#]+)\/?/);
  return match ? decodeURIComponent(match[1]) : "";
}

async function sendStaffPrivateChartAlimtalk(
  staffPhone: string,
  variables: Record<string, string>,
): Promise<{ messageId: string }> {
  const to = normalizePhone(staffPhone);
  if (!to) throw new Error("staff phone is empty");
  if (Object.values(variables).some((value) => !value)) throw new Error("template variable is empty");

  const response = await fetch(SOLAPI_SEND_URL, {
    method: "POST",
    headers: {
      Authorization: solapiAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages: [
        {
          to,
          type: "ATA",
          kakaoOptions: {
            pfId: solapiPfid.value(),
            templateId: STAFF_PRIVATE_CHART_TEMPLATE_ID,
            disableSms: true,
            variables,
          },
        },
      ],
      strict: true,
      allowDuplicates: false,
      showMessageList: true,
    }),
  });
  const result = (await response.json().catch(() => ({}))) as {
    errorMessage?: string;
    message?: string;
    failedMessageList?: Array<{ statusMessage?: string }>;
    messageList?: Array<{ messageId?: string }>;
    groupInfo?: { groupId?: string };
  };
  if (!response.ok) throw new Error(result.errorMessage || result.message || `SOLAPI ${response.status}`);
  if (Array.isArray(result.failedMessageList) && result.failedMessageList.length) {
    throw new Error(result.failedMessageList[0]?.statusMessage || "SOLAPI rejected message");
  }
  return {
    messageId: result.messageList?.[0]?.messageId || result.groupInfo?.groupId || "",
  };
}

async function isStaffPrivateChartTemplateApproved(): Promise<boolean> {
  const response = await fetch(`${SOLAPI_TEMPLATE_URL}/${encodeURIComponent(STAFF_PRIVATE_CHART_TEMPLATE_ID)}`, {
    headers: {
      Authorization: solapiAuthHeader(),
    },
  });
  if (!response.ok) return isAlimtalkTemplateApproved(STAFF_PRIVATE_CHART_TEMPLATE_ID);
  const body = (await response.json().catch(() => ({}))) as { status?: string };
  return String(body.status || "").toUpperCase() === "APPROVED";
}

function solapiAuthHeader(): string {
  const dateTime = new Date().toISOString();
  const salt = randomBytes(16).toString("hex");
  const signature = createHmac("sha256", solapiApiSecret.value())
    .update(dateTime + salt)
    .digest("hex");
  return `HMAC-SHA256 apiKey=${solapiApiKey.value()}, date=${dateTime}, salt=${salt}, signature=${signature}`;
}

function normalizePhone(value: string): string {
  return String(value || "").replace(/\D/g, "");
}

function privateSurveySummaryForRequest(
  doc: PrivateSurveyResponseDoc,
): NonNullable<PrivateLessonChartRequestDoc["intakeSummary"]> {
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
    "ARCHIVE PILATES 프라이빗 회원용 수업 리포트 문장을 작성합니다.",
    "톤: 조용하고 전문적이며 따뜻하게. 과장, 진단, 치료 효과 단정, 통증/병력 상세 노출은 금지합니다.",
    "회원이 읽는 문장입니다. 강사용 체크값을 자연스럽고 고급스럽게 정리합니다.",
    `회원: ${record.memberName}`,
    `회차: ${record.sessionNumber}회차`,
    `수업일: ${record.lessonDate}`,
    `강사: ${record.staffName}`,
    `사전설문 요약: ${safeJson(chartRequest.intakeSummary || {})}`,
    `수업 전 계획: ${safeJson(record.prePlan || {})}`,
    `수업 후 기록: ${safeJson(record.postRecord || {})}`,
    "출력은 JSON만 허용합니다.",
    "summary: 1~2문장. 오늘 진행과 관찰된 변화를 따뜻하지만 담백하게 요약합니다.",
    "nextDirection: 1문장. 다음 수업 방향을 확신형 진단이 아니라 관리 방향으로 표현합니다.",
  ].join("\n");
}

async function generateGeminiPrivateLessonDraft(
  record: PrivateLessonChartRecordDoc,
  chartRequest: PrivateLessonChartRequestDoc,
): Promise<{ summary: string; nextDirection: string }> {
  const apiKey = geminiApiKey.value();
  if (!apiKey) throw new Error("GEMINI_API_KEY secret이 설정되어 있지 않습니다.");

  const prompt = gptPromptBrief(record, chartRequest);
  const models = [...new Set([GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS])];
  let lastError = "";
  for (const model of models) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        return await requestGeminiPrivateLessonDraft(apiKey, model, prompt);
      } catch (err) {
        lastError = errorMessage(err);
        if (!isRetryableGeminiError(lastError) || attempt === 2) break;
        await delay(700 * attempt);
      }
    }
  }
  throw new Error(lastError || "Gemini 리포트 생성에 실패했습니다.");
}

async function requestGeminiPrivateLessonDraft(
  apiKey: string,
  model: string,
  prompt: string,
): Promise<{ summary: string; nextDirection: string }> {
  const response = await fetch(`${GEMINI_GENERATE_URL}/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: {
        parts: [
          {
            text:
              "당신은 ARCHIVE PILATES의 프라이빗 회원 리포트 에디터입니다. " +
              "한국어로 간결하고 따뜻하게 작성하고, JSON 외 다른 텍스트는 출력하지 않습니다.",
          },
        ],
      },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.45,
        topP: 0.9,
        maxOutputTokens: 512,
        responseMimeType: "application/json",
      },
    }),
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`Gemini API ${response.status}: ${json.error?.message || text}`);
  }
  const output = extractGeminiText(json);
  const parsed = parseJsonObject(output);
  const summary = cleanReportSentence(parsed.summary);
  const nextDirection = cleanReportSentence(parsed.nextDirection);
  if (!summary || !nextDirection) {
    throw new Error("Gemini 리포트 응답에 summary 또는 nextDirection이 없습니다.");
  }
  return { summary, nextDirection };
}

function isRetryableGeminiError(message: string): boolean {
  return /\b(429|500|502|503|504)\b|RESOURCE_EXHAUSTED|UNAVAILABLE|high demand/i.test(message);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractGeminiText(response: any): string {
  const parts = response?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts.map((part: any) => String(part?.text || "")).join("").trim();
}

function parseJsonObject(text: string): Record<string, any> {
  const normalized = text
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const parsed = normalized ? JSON.parse(normalized) : {};
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function cleanReportSentence(value: unknown): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 360);
}

function gptSourceHash(record: PrivateLessonChartRecordDoc, chartRequest: PrivateLessonChartRequestDoc): string {
  return stableHash({
    requestId: record.requestId,
    intakeSummary: chartRequest.intakeSummary || {},
    prePlan: record.prePlan || {},
    postRecord: record.postRecord || {},
  });
}

function notionChartChildren(
  record: PrivateLessonChartRecordDoc,
  chartRequest: PrivateLessonChartRequestDoc,
): Record<string, unknown>[] {
  return [
    heading(2, `${record.memberName}님 개인레슨 차트`),
    paragraph(
      `회차: ${record.sessionNumber}회차 / 수업일: ${lessonTimeText(chartRequest)} / 담당: ${record.staffName || "미정"}`,
    ),
    callout(
      "사진·영상 업로드는 이 페이지 상단에서 바로 처리합니다. 아래 '업로드 위치'에 파일을 드래그하거나 + 버튼으로 사진/영상을 추가하세요.",
    ),
    heading(2, "사진·영상 업로드"),
    paragraph(
      "업로드 위치: 이 문장 바로 아래에 사진·영상을 추가합니다. 자동화는 이 영역의 기존 미디어 블록을 삭제하지 않습니다.",
    ),
    divider(),
    heading(3, "오늘의 수업 목적"),
    ...bullets(textArray(record.prePlan?.goals).length ? textArray(record.prePlan?.goals) : ["수업 전 계획 미작성"]),
    divider(),
    heading(3, "사전설문 참고"),
    ...bullets([
      `목표: ${chartRequest.intakeSummary?.goal || "-"}`,
      `신경 부위: ${chartRequest.intakeSummary?.focusArea || "-"}`,
      `운동 수준: ${chartRequest.intakeSummary?.exerciseLevel || "-"}`,
      chartRequest.intakeSummary?.painOrMedicalNote ? "주의 내용 확인 필요" : "특별 주의 내용 없음",
    ]),
    divider(),
    heading(3, "수업 전 계획"),
    ...bullets([
      `집중 부위: ${textArray(record.prePlan?.focusAreas).join(", ") || "-"}`,
      `예정 기구: ${textArray(record.prePlan?.equipment).join(", ") || "-"}`,
      `강도 계획: ${firstText(record.prePlan?.intensity) || "-"}`,
      `주의점: ${textArray(record.prePlan?.cautions).join(", ") || "-"}`,
      `메모: ${String(record.prePlan?.memo || "-")}`,
    ]),
    divider(),
    heading(3, "수업 후 기록"),
    ...bullets([
      `컨디션: ${firstText(record.postRecord?.condition) || "-"}`,
      `통증 변화: ${firstText(record.postRecord?.painChange) || "-"}`,
      `진행 부위: ${textArray(record.postRecord?.focusAreas).join(", ") || "-"}`,
      `사용 기구: ${textArray(record.postRecord?.equipment).join(", ") || "-"}`,
      `오늘 변화: ${textArray(record.postRecord?.changes).join(", ") || "-"}`,
      `다음 수업 메모: ${String(record.postRecord?.nextMemo || "-")}`,
    ]),
    divider(),
    heading(3, "회원용 초안"),
    paragraph(record.gptDraftSummary || "Gemini 초안 생성 대기 중입니다."),
    divider(),
    heading(3, "회원 리포트 검수"),
    paragraph(
      record.publicReportUrl
        ? "아래 임베드 또는 회원 리포트 URL 속성에서 최종 회원용 리포트를 확인합니다."
        : "회원용 HTML 리포트 생성 대기 중입니다.",
    ),
    ...(record.publicReportUrl ? [embed(record.publicReportUrl)] : []),
  ];
}

function renderPrivateLessonReportMessagePage(message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"/>` +
    `<title>ARCHIVE PILATES Private Report</title><style>body{margin:0;padding:24px;font-family:Apple SD Gothic Neo,\"Noto Sans KR\",Arial,sans-serif;background:#f8f6f1;color:#27211b}.card{max-width:760px;margin:0 auto;padding:24px;background:#fff;border:1px solid #e4ded5;border-radius:12px}</style>` +
    `</head><body><div class="card"><p>${escapeHtml(message)}</p></div></body></html>`;
}

function renderPrivateLessonReportPage(
  record: PrivateLessonChartRecordDoc,
  chartRequest: PrivateLessonChartRequestDoc,
): string {
  const memberName = escapeHtml(record.memberName || "");
  const staffName = escapeHtml(record.staffName || "미정");
  const sessionText = `${Number(record.sessionNumber || 1)}회차`;
  const lessonTime = lessonTimeText(chartRequest);
  const title = `${memberName || "회원"}님 수업 리포트`;
  const reportSummary = escapeHtml(String(record.gptDraftSummary || "요약이 아직 준비되지 않았습니다."));
  const nextDirection = escapeHtml(String(record.gptDraftNextDirection || "다음 수업 방향이 아직 정리되지 않았습니다."));
  const goals = textArray(record.postRecord?.goals || record.prePlan?.goals || []);
  const focusAreas = textArray(record.postRecord?.focusAreas || record.prePlan?.focusAreas || []);
  const equipment = textArray(record.postRecord?.equipment || record.prePlan?.equipment || []);
  const changes = textArray(record.postRecord?.changes || []);
  const scores = [
    [`코어 안정성`, Number(record.postRecord?.coreScore)],
    [`밸런스`, Number(record.postRecord?.balanceScore)],
    [`호흡`, Number(record.postRecord?.breathingScore)],
    [`가동성`, Number(record.postRecord?.mobilityScore)],
    [`유연성`, Number(record.postRecord?.flexibilityScore)],
  ].filter((item) => Number.isFinite(item[1]));
  const reportUrl = (() => {
    const url = new URL(PRIVATE_LESSON_REPORT_VIEW_BASE_URL);
    url.searchParams.set("recordId", record.recordId);
    url.searchParams.set("token", String(chartRequest.accessTokenHash || ""));
    return url.toString();
  })();
  const reportShortcutUrl = String(record.publicReportUrl || "").trim();
  const reportVisibleUrl = reportShortcutUrl || reportUrl;
  const scoreAverage = scores.length
    ? Math.round((scores.reduce((sum, [, score]) => sum + Number(score || 0), 0) / scores.length) * 10) / 10
    : 0;

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"/>` +
    `<title>${title}</title><style>
      :root{color-scheme:light;--bg:#f7f5f2;--surface:#fffdfa;--line:#ded8d0;--text:#201d19;--muted:#6f675f;--soft:#ece7df;--accent:#4f5b4a;--accent2:#8a6f54}
      *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Apple SD Gothic Neo,\"Noto Sans KR\",system-ui,sans-serif;line-height:1.62}
      main{width:min(100%,820px);margin:0 auto;padding:26px 18px 56px}.brand{margin:0 0 18px;color:var(--muted);font-size:12px;font-weight:800;letter-spacing:0}
      .hero{padding:0 0 22px;border-bottom:1px solid var(--line)}h1{margin:0;font-size:30px;line-height:1.2;letter-spacing:0}.meta{margin-top:12px;color:var(--muted);font-size:14px}
      .lead{margin-top:22px;padding:20px;background:var(--surface);border:1px solid var(--line);border-radius:8px}.lead p{margin:0;font-size:17px;word-break:keep-all}.next{margin-top:14px;color:#3f493d;font-weight:700}
      .grid{display:grid;gap:12px;margin-top:18px}.tile{padding:16px;background:var(--surface);border:1px solid var(--line);border-radius:8px}.tile small{display:block;color:var(--muted);font-size:12px;font-weight:800}.tile strong{display:block;margin-top:6px;font-size:22px}
      section{margin-top:28px}.section-title{display:flex;align-items:end;justify-content:space-between;gap:12px;margin-bottom:12px}h2{margin:0;font-size:17px;letter-spacing:0}.hint{color:var(--muted);font-size:12px}
      .chips{display:flex;flex-wrap:wrap;gap:8px}.chip{display:inline-flex;align-items:center;min-height:34px;padding:7px 10px;border:1px solid var(--line);border-radius:999px;background:var(--surface);font-size:13px;color:#2d2924}
      .scores{display:grid;gap:12px}.score-row{display:grid;grid-template-columns:minmax(86px,116px) 1fr 34px;gap:10px;align-items:center}.bar{height:9px;background:var(--soft);border-radius:99px;overflow:hidden}.fill{height:100%;background:linear-gradient(90deg,var(--accent),var(--accent2));border-radius:99px}.score-row span{font-size:13px;color:var(--muted)}.score-row b{text-align:right;font-size:13px}
      .note{padding:16px;border-left:3px solid var(--accent);background:rgba(255,253,250,.72);color:#312c26}.footer{margin-top:32px;padding-top:16px;border-top:1px solid var(--line);color:var(--muted);font-size:12px}.copy{word-break:break-all}
      @media (min-width:680px){main{padding:38px 28px 72px}.grid{grid-template-columns:repeat(3,minmax(0,1fr))}h1{font-size:36px}.lead{padding:24px}}
    </style></head><body><main><div class="hero"><p class="brand">ARCHIVE PILATES</p><h1>${escapeHtml(title)}</h1>` +
    `<p class="meta">${escapeHtml(sessionText)} · ${escapeHtml(lessonTime)} · 담당: ${staffName}</p>` +
    `<div class="lead"><p>${reportSummary}</p><p class="next">${nextDirection}</p></div>` +
    `<div class="grid"><div class="tile"><small>집중 영역</small><strong>${escapeHtml(focusAreas.slice(0, 2).join(" · ") || "-")}</strong></div>` +
    `<div class="tile"><small>오늘 변화</small><strong>${escapeHtml(changes.slice(0, 2).join(" · ") || "-")}</strong></div>` +
    `<div class="tile"><small>평균 점수</small><strong>${scoreAverage ? `${escapeHtml(String(scoreAverage))} / 5` : "-"}</strong></div></div></div>` +
    `<section><div class="section-title"><h2>오늘 진행</h2><span class="hint">목표와 사용 기구</span></div><div class="chips">` +
    [...goals, ...equipment].slice(0, 12).map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join("") +
    `</div></section>` +
    `<section><div class="section-title"><h2>변화 흐름</h2><span class="hint">수업 후 관찰</span></div><div class="chips">` +
    (changes.length ? changes : ["기록된 변화 없음"]).map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join("") +
    `</div></section>` +
    `<section><div class="section-title"><h2>기능 점수</h2><span class="hint">1-5 기준</span></div>${scores.length ? `<div class="scores">` +
    scores.map(([name, score]) => `<div class="score-row"><span>${escapeHtml(String(name))}</span><div class="bar"><div class="fill" style="width:${Math.max(0, Math.min(100, Number(score) * 20))}%"></div></div><b>${escapeHtml(String(score))}</b></div>`).join("") + `</div>` : "<p class=\"note\">아직 입력된 점수가 없습니다.</p>"}</section>` +
    `<section><div class="section-title"><h2>다음 수업 방향</h2></div><p class="note">${nextDirection}</p></section>` +
    `<p class="footer">본 리포트는 프라이빗 회원 수업 기록 기준으로 생성되었습니다.<br><span class=\"copy\">${escapeHtml(reportVisibleUrl)}</span></p>` +
    `</main></body></html>`;
}

function asTextList(values: unknown[]): string {
  const lines: string[] = [];
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (Array.isArray(entry) && entry.length) {
        lines.push(`${key}: ${entry.map(String).join(", ")}`);
      } else if (entry != null && String(entry).trim()) {
        lines.push(`${key}: ${String(entry).trim()}`);
      }
    }
  }
  return lines.join(" | ");
}

function escapeHtml(value: string): string {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char] || char);
}

function notionUpdateChildren(
  record: PrivateLessonChartRecordDoc,
  chartRequest: PrivateLessonChartRequestDoc,
): Record<string, unknown>[] {
  return [
    divider(),
    heading(3, `자동화 업데이트 ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`),
    paragraph(
      `회차: ${record.sessionNumber}회차 / 수업일: ${lessonTimeText(chartRequest)} / 담당: ${record.staffName || "미정"}`,
    ),
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
    paragraph(record.gptDraftSummary || "Gemini 초안 생성 대기 중입니다."),
    ...(record.publicReportUrl ? [embed(record.publicReportUrl)] : []),
  ];
}

function notionInstructorChartChildren(
  record: PrivateLessonChartRecordDoc,
  chartRequest: PrivateLessonChartRequestDoc,
): Record<string, unknown>[] {
  const reportButtonUrl = record.publicReportUrl || record.publicReportCanonicalUrl || "";
  return [
    callout("이 페이지는 강사용 회차 기록입니다. 회원 발송은 수업 후 기록 링크의 리포트 화면에서 처리합니다."),
    heading(2, `${record.memberName}님 ${record.sessionNumber}회차`),
    paragraph(`수업일: ${lessonTimeText(chartRequest)} / 담당: ${record.staffName || "미정"}`),
    heading(2, "사진·영상 업로드"),
    paragraph("이 문장 아래에 수업 사진과 영상을 추가합니다."),
    divider(),
    heading(3, "수업 전 계획"),
    ...bullets([
      `목표: ${textArray(record.prePlan?.goals).join(", ") || "-"}`,
      `집중 부위: ${textArray(record.prePlan?.focusAreas).join(", ") || "-"}`,
      `예정 기구: ${textArray(record.prePlan?.equipment).join(", ") || "-"}`,
      `강도 계획: ${firstText(record.prePlan?.intensity) || "-"}`,
      `주의점: ${textArray(record.prePlan?.cautions).join(", ") || "-"}`,
      `메모: ${String(record.prePlan?.memo || "-")}`,
    ]),
    divider(),
    heading(3, "수업 후 기록"),
    ...bullets([
      `컨디션: ${firstText(record.postRecord?.condition) || "-"}`,
      `통증 변화: ${firstText(record.postRecord?.painChange) || "-"}`,
      `진행 부위: ${textArray(record.postRecord?.focusAreas).join(", ") || "-"}`,
      `사용 기구: ${textArray(record.postRecord?.equipment).join(", ") || "-"}`,
      `오늘 변화: ${textArray(record.postRecord?.changes).join(", ") || "-"}`,
      `다음 수업 메모: ${String(record.postRecord?.nextMemo || "-")}`,
    ]),
    divider(),
    heading(3, "회원 리포트"),
    paragraph(
      record.publicReportUrl
        ? "회원용 리포트가 생성되었습니다. 운영자가 검수 후 발송합니다."
        : "회원용 리포트 생성 대기 중입니다.",
    ),
    ...(reportButtonUrl
      ? [notionLinkButton("최종 회원 리포트 보기", reportButtonUrl)]
      : []),
  ];
}

function notionInstructorUpdateChildren(
  record: PrivateLessonChartRecordDoc,
  chartRequest: PrivateLessonChartRequestDoc,
): Record<string, unknown>[] {
  const reportButtonUrl = record.publicReportUrl || record.publicReportCanonicalUrl || "";
  return [
    divider(),
    heading(3, `업데이트 ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`),
    paragraph(`수업일: ${lessonTimeText(chartRequest)} / 담당: ${record.staffName || "미정"}`),
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
    paragraph(
      record.publicReportUrl
        ? "회원용 리포트가 생성되었습니다. 운영자가 검수 후 발송합니다."
        : "회원용 리포트 생성 대기 중입니다.",
    ),
    ...(reportButtonUrl ? [notionLinkButton("최종 회원 리포트 보기", reportButtonUrl)] : []),
  ];
}

function notionLinkButton(text: string, url: string): Record<string, unknown> {
  if (!url) {
    return paragraph(text);
  }
  return {
    object: "block",
    type: "bookmark",
    bookmark: {
      url: url,
      caption: [{ type: "text", text: { content: text.slice(0, 2000) } }],
    },
  };
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
  ]
    .join("\n")
    .slice(0, 1900);
}

function chartUrl(mode: PrivateLessonChartMode, requestId: string, token: string): string {
  const url = new URL(PUBLIC_BASE_URL);
  url.searchParams.set("mode", mode);
  url.searchParams.set("r", requestId);
  url.searchParams.set("t", token);
  return url.toString();
}

function buildPrivateReportCanonicalUrl(input: { recordId: string; accessTokenHash: string }): string {
  if (!input.recordId || !input.accessTokenHash) return "";
  const url = new URL(PRIVATE_LESSON_REPORT_VIEW_BASE_URL);
  url.searchParams.set("recordId", input.recordId);
  url.searchParams.set("token", input.accessTokenHash);
  return url.toString();
}

function accessTokenFor(requestId: string): string {
  return createHmac("sha256", privateSurveyWebhookSecret.value())
    .update(`private-chart:${requestId}`)
    .digest("hex")
    .slice(0, 16);
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
    if (Array.isArray(value))
      output[key] = value
        .map((item) => String(item).trim())
        .filter(Boolean)
        .slice(0, 30);
    else if (typeof value === "number") output[key] = Number.isFinite(value) ? value : null;
    else
      output[key] = String(value || "")
        .trim()
        .slice(0, 1000);
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

function notionSessionTitle(record: PrivateLessonChartRecordDoc, chartRequest: PrivateLessonChartRequestDoc): string {
  return `${lessonTitleDate(chartRequest)} · ${record.memberName} ${record.sessionNumber}회차(자동화)`;
}

function lessonTitleDate(chartRequest: Pick<PrivateLessonChartRequestDoc, "lessonDate" | "lessonStartAt">): string {
  const date = chartRequest.lessonStartAt?.toDate?.();
  if (!date) return chartRequest.lessonDate.replaceAll("-", ".");
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}.${value("month")}.${value("day")} ${value("hour")}:${value("minute")}`;
}

function normalizeKoreanName(value: string): string {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/님$/g, "")
    .replace(/\d+$/g, "")
    .trim();
}

function textArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (!value) return [];
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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

function notionRichText(property: any): string {
  const items = Array.isArray(property?.rich_text) ? property.rich_text : [];
  return items
    .map((item: any) => String(item?.plain_text || ""))
    .join("")
    .trim();
}

function notionCheckbox(property: any): boolean {
  return Boolean(property?.checkbox);
}

function notionSelectName(property: any): string {
  return String(property?.select?.name || "");
}

function notionUrl(property: any): string {
  return String(property?.url || "");
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
  return {
    object: "block",
    type: "paragraph",
    paragraph: { rich_text: [{ type: "text", text: { content: text.slice(0, 2000) } }] },
  };
}

function linkedSessionParagraph(text: string, url: string): Record<string, unknown> {
  return {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [
        {
          type: "text",
          text: {
            content: text.slice(0, 2000),
            link: { url },
          },
        },
      ],
    },
  };
}

function callout(text: string): Record<string, unknown> {
  return {
    object: "block",
    type: "callout",
    callout: {
      icon: { type: "emoji", emoji: "📎" },
      color: "gray_background",
      rich_text: [{ type: "text", text: { content: text.slice(0, 2000) } }],
    },
  };
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
