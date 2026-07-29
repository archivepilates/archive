import { createHmac, randomBytes } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { DEFAULT_STUDIO_ID } from "../config/constants";
import { geminiApiKey, notionToken, privateSurveyWebhookSecret, solapiApiKey, solapiApiSecret, solapiPfid } from "../config/secrets";
import { db } from "../config/firebase";
import { refs } from "../firestore/refs";
import type {
  AlimtalkCandidateDoc,
  BookingDoc,
  PrivateLessonChartMediaFile,
  PrivateLessonChartMode,
  PrivateLessonChartRecordDoc,
  PrivateLessonChartRequestDoc,
  PrivateLessonChartRequestStatus,
  PrivateSurveyResponseDoc,
} from "../types/models";
import { addDays, dateRange, formatDateKst, nowTimestamp, todayKst } from "../utils/date";
import { errorMessage } from "../utils/errors";
import { stableHash } from "../utils/hash";
import { ensureShortLink } from "../utils/shortLinks";
import { bookingSourcePriority, isExcelBookingId } from "../utils/canonicalBooking";
import {
  ALIMTALK_TEMPLATES,
  LEGACY_STAFF_PRIVATE_CHART_ALIMTALK_TEMPLATE_CODE,
} from "../alimtalk/templates";
import { alimtalkTemplateReadiness, isAlimtalkTemplateApproved } from "../alimtalk/templateStatus";
import { completePrivateLessonMediaUpload, initPrivateLessonMediaUpload, uploadPrivateLessonMediaChunk } from "./privateLessonMedia";
import { invalidatePendingPrivateLessonReportCandidates } from "./privateLessonReportCandidates";
import {
  createPrivateLessonReportSnapshot,
  currentPrivateLessonReportRevision,
  privateLessonReportCandidateId,
  privateLessonReportMutationLockReason,
  privateLessonReportSnapshotForView,
  privateLessonReportSourceChangePatch,
  reportUrlForRevision,
} from "./privateLessonReportRevision";

const PUBLIC_BASE_URL = process.env.PRIVATE_CHART_BASE_URL || "https://in.archivepilates.com/private-chart/";
const NOTION_API_VERSION = "2022-06-28";
const NOTION_MEMBERS_DATABASE_ID = process.env.NOTION_PRIVATE_MEMBERS_DATABASE_ID || "c58a39ceb7ac405ba43b38d3b5871ed3";
const STAFF_PRIVATE_CHART_TEMPLATE_ID = ALIMTALK_TEMPLATES.staff_private_chart.code;
const PRIVATE_CHART_TEMPLATE_NAME = ALIMTALK_TEMPLATES.staff_private_chart.label;
const PRIVATE_LESSON_REPORT_VIEW_BASE_URL = process.env.PRIVATE_LESSON_REPORT_VIEW_BASE_URL ||
  "https://in.archivepilates.com/api/privateLessonReport";
const GEMINI_MODEL = process.env.PRIVATE_LESSON_REPORT_GEMINI_MODEL || "gemini-2.5-flash";
const GEMINI_FALLBACK_MODELS = (process.env.PRIVATE_LESSON_REPORT_GEMINI_FALLBACK_MODELS || "gemini-2.5-flash-lite")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const GEMINI_GENERATE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const SOLAPI_SEND_URL = "https://api.solapi.com/messages/v4/send-many/detail";
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
      response.status(200).json(await publicChartRequest(chartRequest, mode, record));
      return;
    }
    if (request.method === "POST") {
      const body = request.body || {};
      const chartRequest = await readChartRequest(String(body.requestId || ""), String(body.token || ""));
      if (String(body.action || "") === "convertReport") {
        const reportInput: { summary?: unknown; nextDirection?: unknown } = {};
        if (Object.prototype.hasOwnProperty.call(body, "summary")) reportInput.summary = body.summary;
        if (Object.prototype.hasOwnProperty.call(body, "nextDirection")) reportInput.nextDirection = body.nextDirection;
        const result = await convertPrivateLessonReportFromChart(chartRequest, reportInput);
        response.status(200).json({ ok: true, ...result });
        return;
      }
      if (String(body.action || "") === "approveReport") {
        const result = await approvePrivateLessonReportFromChart(chartRequest);
        response.status(200).json({ ok: true, ...result });
        return;
      }
      if (String(body.action || "") === "editReport") {
        const result = await editPrivateLessonReportFromChart(chartRequest, {
          summary: body.summary,
          nextDirection: body.nextDirection,
        });
        response.status(200).json({ ok: true, ...result });
        return;
      }
      if (String(body.action || "") === "initMediaUpload") {
        const record =
          (await refs.privateLessonChartRecord(chartRequest.requestId).get()).data() ||
          (await upsertChartRecordBase(chartRequest));
        const result = await initPrivateLessonMediaUpload({
          chartRequest,
          record,
          fileName: String(body.fileName || ""),
          mimeType: String(body.mimeType || ""),
          size: Number(body.size || 0),
        });
        response.status(200).json({ ok: true, ...result });
        return;
      }
      if (String(body.action || "") === "uploadMediaChunk") {
        const result = await uploadPrivateLessonMediaChunk({
          chartRequest,
          uploadId: String(body.uploadId || ""),
          start: Number(body.start || 0),
          end: Number(body.end || 0),
          total: Number(body.total || 0),
          chunkBase64: String(body.chunkBase64 || ""),
        });
        response.status(200).json({ ok: true, ...result });
        return;
      }
      if (String(body.action || "") === "completeMediaUpload") {
        const result = await completePrivateLessonMediaUpload({
          chartRequest,
          uploadId: String(body.uploadId || ""),
          driveFile: body.driveFile || {},
        });
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
  const requestedRevision = String(request.query?.rev || "");
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
  if (!isPrivateLessonReportGenerated(record)) {
    response.status(409).send(renderPrivateLessonReportMessagePage("회원용 리포트가 아직 생성되지 않았습니다."));
    return;
  }
  record = await ensureLegacySentReportSnapshot(record);

  const snapshot = privateLessonReportSnapshotForView(record, requestedRevision);
  if (requestedRevision && !snapshot) {
    response.status(409).send(renderPrivateLessonReportMessagePage("승인된 리포트 버전을 찾을 수 없습니다."));
    return;
  }
  const recordForView = snapshot
    ? ({
      ...record,
      memberName: snapshot.memberName || record.memberName,
      staffName: snapshot.staffName || record.staffName,
      lessonDate: snapshot.lessonDate || record.lessonDate,
      lessonStartAt: snapshot.lessonStartAt || record.lessonStartAt,
      sessionNumber: snapshot.sessionNumber || record.sessionNumber,
      gptDraftSummary: snapshot.summary,
      publicSummary: snapshot.summary,
      gptDraftNextDirection: snapshot.nextDirection,
      publicNextDirection: snapshot.nextDirection,
      postRecord: { ...(record.postRecord || {}), homework: snapshot.homework },
      media: { ...(record.media || {}), files: snapshot.includedMedia },
    } as PrivateLessonChartRecordDoc)
    : record;
  response.status(200).send(renderPrivateLessonReportPage(recordForView, requestDoc));
}

async function ensureLegacySentReportSnapshot(
  record: PrivateLessonChartRecordDoc,
): Promise<PrivateLessonChartRecordDoc> {
  if (
    record.sentReportSnapshot?.revision ||
    record.approvedReportSnapshot?.revision ||
    record.legacySentReportSnapshot?.revision ||
    !(
      record.publicReportApproval?.status === "sent" ||
      record.publicReportApproval?.sentAt ||
      record.gptStatus === "published"
    )
  ) {
    return record;
  }
  return db.runTransaction(async (tx) => {
    const ref = refs.privateLessonChartRecord(record.recordId);
    const snap = await tx.get(ref);
    const current = snap.data() || record;
    if (current.legacySentReportSnapshot?.revision) return current;
    const revision = `legacy-${currentPrivateLessonReportRevision(current)}`;
    const legacySentReportSnapshot = createPrivateLessonReportSnapshot(current, revision);
    tx.set(
      ref,
      {
        legacySentReportSnapshot,
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
    return { ...current, legacySentReportSnapshot };
  });
}

export async function notionPrivateLessonReportWebhookHandler(request: any, response: any): Promise<void> {
  response.status(200).json({
    ok: true,
    status: "display_only",
    message: "Notion은 프라이빗 차트 표시용이며 발송 승인 입력으로 사용하지 않습니다.",
  });
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

export async function reconcileCurrentMonthPrivateLessonCharts(): Promise<{
  startDate: string;
  endDate: string;
  dates: number;
  checkedBookings: number;
  created: number;
  bookingSkipped: number;
  checkedRequests: number;
  cancelled: number;
  requestSkipped: number;
  failed: number;
}> {
  const { startDate, endDate } = currentMonthRangeKst();
  let checkedBookings = 0;
  let created = 0;
  let bookingSkipped = 0;
  let checkedRequests = 0;
  let cancelled = 0;
  let requestSkipped = 0;
  let failed = 0;

  for (const date of dateRange(startDate, endDate)) {
    try {
      const createSummary = await createPrivateLessonChartRequestsForDate(date);
      checkedBookings += createSummary.checked;
      created += createSummary.created;
      bookingSkipped += createSummary.skipped;

      const snap = await refs.privateLessonChartRequests().where("lessonDate", "==", date).limit(500).get();
      const canonical = canonicalChartRequests(snap.docs.map((doc) => doc.data()));
      requestSkipped += snap.size - canonical.length;

      for (const request of canonical) {
        if (request.status === "cancelled") {
          requestSkipped += 1;
          continue;
        }
        checkedRequests += 1;
        const activeBooking = await activePrivateBookingForChartRequest(request);
        if (!activeBooking.ok) {
          await cancelPrivateLessonChartRequest(request, activeBooking.reason);
          cancelled += 1;
        }
      }
    } catch (err) {
      failed += 1;
      logger.warn("reconcileCurrentMonthPrivateLessonCharts date failed", {
        date,
        message: errorMessage(err),
      });
    }
  }

  const result = {
    startDate,
    endDate,
    dates: dateRange(startDate, endDate).length,
    checkedBookings,
    created,
    bookingSkipped,
    checkedRequests,
    cancelled,
    requestSkipped,
    failed,
  };
  logger.info("reconcileCurrentMonthPrivateLessonCharts completed", result);
  return result;
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
            reasonCode: "duplicate_booking_source",
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
    const activeBooking = await activePrivateBookingForChartRequest(request);
    if (!activeBooking.ok) {
      await cancelPrivateLessonChartRequest(request, activeBooking.reason);
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

async function approvePrivateLessonReportFromChart(
  chartRequest: PrivateLessonChartRequestDoc,
): Promise<{
  recordId: string;
  reportStatus: string;
  candidateId?: string;
  reportUrl?: string;
  message?: string;
}> {
  const initialRecord = (await refs.privateLessonChartRecord(chartRequest.requestId).get()).data();
  if (!initialRecord) throw new Error("회차 기록을 찾을 수 없습니다.");
  const activeBooking = await activePrivateBookingForChartRequest(chartRequest);
  if (!activeBooking.ok) {
    const message = `예약 취소/변경 확인: ${activeBooking.reason}`;
    await refs.privateLessonChartRecord(chartRequest.requestId).set(
      {
        publicReportApproval: { status: "failed", lastError: message },
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
    throw new Error(message);
  }
  const approvedRecord = await db.runTransaction(async (tx) => {
    const recordRef = refs.privateLessonChartRecord(chartRequest.requestId);
    const snap = await tx.get(recordRef);
    const current = snap.data();
    if (!current) throw new Error("회차 기록을 찾을 수 없습니다.");
    if (!current.postRecord || !current.postSubmittedAt) {
      throw new Error("수업 후 기록 제출 후 승인할 수 있습니다.");
    }
    if (!isPrivateLessonReportGenerated(current)) {
      throw new Error("회원용 리포트가 아직 생성되지 않았습니다. 잠시 후 다시 확인해 주세요.");
    }
    if (!current.memberPhone) throw new Error("회원 연락처가 없어 발송 후보를 만들 수 없습니다.");
    const lockReason = privateLessonReportMutationLockReason(current);
    if (lockReason) throw new Error(lockReason);
    const revision = currentPrivateLessonReportRevision(current);
    const snapshot = createPrivateLessonReportSnapshot(current, revision);
    const approvedAt = nowTimestamp();
    const nextRecord: PrivateLessonChartRecordDoc = {
      ...current,
      reportRevision: revision,
      approvedRevision: revision,
      approvedReportSnapshot: snapshot,
      publicReportApproval: {
        status: "approved",
        approvedAt,
        approvedBy: chartRequest.staffName || "staff",
        candidateId: null,
        lastError: null,
      },
      updatedAt: approvedAt,
    };
    tx.set(
      recordRef,
      {
        reportRevision: revision,
        approvedRevision: revision,
        approvedReportSnapshot: snapshot,
        publicReportApproval: nextRecord.publicReportApproval,
        updatedAt: approvedAt,
      },
      { merge: true },
    );
    return nextRecord;
  });
  const revision = approvedRecord.approvedRevision || "";
  const candidateId = privateLessonReportCandidateId(approvedRecord.recordId, revision);
  const templateApproved = await isAlimtalkTemplateApproved(ALIMTALK_TEMPLATES.private_lesson_report.code);
  const result = await enqueuePrivateLessonReportForRecord(approvedRecord, templateApproved, "staff:private-chart");
  const status =
    result === "queued" || result === "already_queued"
      ? "queued"
      : result === "completed"
        ? "sent"
        : result === "template_pending"
          ? "approved"
          : result === "failed" || result === "inactive"
            ? "failed"
            : result === "stale"
              ? "pending"
              : "approved";
  return {
    recordId: approvedRecord.recordId,
    reportStatus: status,
    candidateId,
    reportUrl: approvedRecord.publicReportUrl || approvedRecord.publicReportCanonicalUrl || "",
    message:
      status === "queued"
        ? "회원 알림톡 발송 후보에 등록되었습니다."
        : status === "sent"
          ? "이미 발송 완료된 리포트입니다."
          : status === "pending"
            ? "리포트 내용이 변경되어 발송 후보를 만들지 않았습니다. 최신 내용을 확인한 뒤 다시 승인해 주세요."
            : status === "failed"
              ? "예약 상태를 확인할 수 없어 발송 후보를 만들지 않았습니다."
              : "승인되었습니다. 템플릿 상태 확인 후 발송됩니다.",
  };
}

async function convertPrivateLessonReportFromChart(
  chartRequest: PrivateLessonChartRequestDoc,
  input: { summary?: unknown; nextDirection?: unknown } = {},
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
  if (isPrivateLessonReportSent(record)) {
    throw new Error("회원 리포트 알림톡 발송 완료 후에는 리포트를 다시 생성할 수 없습니다.");
  }
  const lockReason = privateLessonReportMutationLockReason(record);
  if (lockReason) throw new Error(lockReason);

  let sourceRecord = record;
  if (hasEditableReportInput(input)) {
    const summary = cleanEditableReportText(input.summary, 900);
    const nextDirection = cleanEditableReportText(input.nextDirection, 1200);
    if (!summary) throw new Error("오늘의 핵심 문장을 입력해 주세요.");
    if (!nextDirection) throw new Error("다음 수업 방향 문장을 입력해 주세요.");
    sourceRecord = await saveManualPrivateLessonReportEdit(sourceRecord, chartRequest, summary, nextDirection);
  } else {
    sourceRecord = await preparePrivateLessonReportRegeneration(sourceRecord, chartRequest);
  }

  const generated = hasManualPrivateLessonReportText(sourceRecord)
    ? await regenerateManualPrivateLessonReport(sourceRecord, chartRequest)
    : await generatePrivateLessonReportDraft(sourceRecord, chartRequest, { force: true });
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

async function editPrivateLessonReportFromChart(
  chartRequest: PrivateLessonChartRequestDoc,
  input: { summary: unknown; nextDirection: unknown },
): Promise<{
  recordId: string;
  reportStatus: string;
  reportUrl: string;
  summary: string;
  nextDirection: string;
  message: string;
}> {
  const record = (await refs.privateLessonChartRecord(chartRequest.requestId).get()).data();
  if (!record) throw new Error("회차 기록을 찾을 수 없습니다.");
  if (!record.postRecord || !record.postSubmittedAt) {
    throw new Error("수업 후 기록 제출 후 리포트를 수정할 수 있습니다.");
  }
  if (!isPrivateLessonReportGenerated(record)) {
    throw new Error("회원용 리포트가 아직 생성되지 않았습니다. 먼저 리포트 변환을 완료해 주세요.");
  }
  if (isPrivateLessonReportSent(record)) {
    throw new Error("회원 리포트 알림톡 발송 완료 후에는 리포트를 수정할 수 없습니다.");
  }
  const lockReason = privateLessonReportMutationLockReason(record);
  if (lockReason) throw new Error(lockReason);

  const summary = cleanEditableReportText(input.summary, 900);
  const nextDirection = cleanEditableReportText(input.nextDirection, 1200);
  if (!summary) throw new Error("오늘의 핵심 문장을 입력해 주세요.");
  if (!nextDirection) throw new Error("다음 수업 방향 문장을 입력해 주세요.");

  const nextRecord = await saveManualPrivateLessonReportEdit(record, chartRequest, summary, nextDirection);
  const notionSync = await syncPrivateLessonChartRecordToNotion(nextRecord, chartRequest);
  await refs.privateLessonChartRecord(record.recordId).set({ notionSync, updatedAt: nowTimestamp() }, { merge: true });

  return {
    recordId: record.recordId,
    reportStatus: "ready",
    reportUrl: record.publicReportUrl || record.publicReportCanonicalUrl || "",
    summary,
    nextDirection,
    message: "회원 리포트 문장을 저장했습니다. 발송 전까지 다시 수정할 수 있습니다.",
  };
}

async function saveManualPrivateLessonReportEdit(
  record: PrivateLessonChartRecordDoc,
  chartRequest: PrivateLessonChartRequestDoc,
  summary: string,
  nextDirection: string,
): Promise<PrivateLessonChartRecordDoc> {
  const lastError = "리포트 발송 전 회원용 리포트 문장이 수정되어 기존 발송 후보를 보류했습니다.";
  const nextRecord = await db.runTransaction(async (tx) => {
    const recordRef = refs.privateLessonChartRecord(record.recordId);
    const snap = await tx.get(recordRef);
    const current = snap.data();
    if (!current) throw new Error("회차 기록을 찾을 수 없습니다.");
    const lockReason = privateLessonReportMutationLockReason(current);
    if (lockReason) throw new Error(lockReason);
    const candidateId = String(current.publicReportApproval?.candidateId || "");
    const candidateRef = candidateId ? refs.alimtalkCandidate(candidateId) : null;
    const candidate = candidateRef ? (await tx.get(candidateRef)).data() : undefined;
    if (candidate?.status === "processing") throw new Error("알림톡 발송이 시작되어 리포트를 수정할 수 없습니다.");
    if (candidate?.status === "sent") throw new Error("알림톡 발송 완료 후에는 리포트를 수정할 수 없습니다.");
    const now = nowTimestamp();
    const nextRecordBase = {
      ...current,
      gptStatus: "draft_created",
      gptDraftSummary: summary,
      gptDraftNextDirection: nextDirection,
      publicSummary: summary,
      publicNextDirection: nextDirection,
      publicReportApproval: {
        status: "pending" as const,
        approvedAt: null,
        approvedBy: chartRequest.staffName || "staff",
        candidateId: "",
        lastError: null,
      },
      approvedRevision: "",
      sentRevision: "",
      approvedReportSnapshot: null,
      sentReportSnapshot: null,
      manualReportEdit: {
        editedAt: now,
        editedBy: chartRequest.staffName || "staff",
        source: "staff:private-chart",
      },
      updatedAt: now,
    } as PrivateLessonChartRecordDoc;
    const next = {
      ...nextRecordBase,
      reportRevision: currentPrivateLessonReportRevision(nextRecordBase),
    };
    if (candidateRef && candidate && ["candidate", "queued", "failed"].includes(candidate.status)) {
      tx.set(
        candidateRef,
        {
          status: "skipped",
          reasonCode: "private_report_changed_before_send",
          lastError,
          updatedAt: now,
        },
        { merge: true },
      );
    }
    tx.set(recordRef, next, { merge: true });
    return next;
  });
  await invalidatePendingPrivateLessonReportCandidates(record.recordId, lastError);
  return nextRecord;
}

async function preparePrivateLessonReportRegeneration(
  record: PrivateLessonChartRecordDoc,
  chartRequest: PrivateLessonChartRequestDoc,
): Promise<PrivateLessonChartRecordDoc> {
  const lastError = "리포트가 다시 생성되어 기존 발송 후보를 보류했습니다.";
  const nextRecord = await db.runTransaction(async (tx) => {
    const recordRef = refs.privateLessonChartRecord(record.recordId);
    const snap = await tx.get(recordRef);
    const current = snap.data();
    if (!current) throw new Error("회차 기록을 찾을 수 없습니다.");
    const lockReason = privateLessonReportMutationLockReason(current);
    if (lockReason) throw new Error(lockReason);
    const candidateId = String(current.publicReportApproval?.candidateId || "");
    const candidateRef = candidateId ? refs.alimtalkCandidate(candidateId) : null;
    const candidate = candidateRef ? (await tx.get(candidateRef)).data() : undefined;
    if (candidate?.status === "processing") throw new Error("알림톡 발송이 시작되어 리포트를 다시 생성할 수 없습니다.");
    if (candidate?.status === "sent") throw new Error("알림톡 발송 완료 후에는 리포트를 다시 생성할 수 없습니다.");
    const now = nowTimestamp();
    const patch = {
      gptStatus: "pending" as const,
      approvedRevision: "",
      approvedReportSnapshot: null,
      publicReportApproval: {
        status: "pending" as const,
        approvedAt: null,
        approvedBy: chartRequest.staffName || "staff",
        candidateId: "",
        lastError: null,
      },
      updatedAt: now,
    };
    if (candidateRef && candidate && ["candidate", "queued", "failed"].includes(candidate.status)) {
      tx.set(
        candidateRef,
        {
          status: "skipped",
          reasonCode: "private_report_changed_before_send",
          lastError,
          updatedAt: now,
        },
        { merge: true },
      );
    }
    tx.set(recordRef, patch, { merge: true });
    return { ...current, ...patch } as PrivateLessonChartRecordDoc;
  });
  await invalidatePendingPrivateLessonReportCandidates(record.recordId, lastError);
  return nextRecord;
}

async function enqueuePrivateLessonReportForRecord(
  record: PrivateLessonChartRecordDoc,
  templateApproved: boolean,
  reviewedByUid = "system:private-report",
): Promise<
  "queued" | "completed" | "failed" | "skipped" | "already_queued" | "template_pending" | "stale" | "inactive"
> {
  if (!isPrivateLessonReportGenerated(record)) return "skipped";
  const revision = String(record.approvedRevision || "");
  if (!revision || record.approvedReportSnapshot?.revision !== revision) return "skipped";
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
  const reportTargetUrl = reportUrlForRevision(resolved.reportTargetUrl, revision);

  const candidateId = privateLessonReportCandidateId(record.recordId, revision);

  const chartRequest = (await refs.privateLessonChartRequest(record.requestId || record.recordId).get()).data();
  if (!chartRequest) return "skipped";
  const activeBooking = await activePrivateBookingForChartRequest(chartRequest);
  if (!activeBooking.ok) {
    await refs.privateLessonChartRecord(record.recordId).set(
      {
        publicReportApproval: {
          ...(record.publicReportApproval || {}),
          status: "failed",
          lastError: `예약 취소/변경 확인: ${activeBooking.reason}`,
        },
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
    return "inactive";
  }

  const link = await ensureShortLink({
    type: "private_report",
    targetUrl: reportTargetUrl,
    sourceId: record.recordId,
  });
  const now = nowTimestamp();
  const nextStatus: AlimtalkCandidateDoc["status"] = templateApproved ? "queued" : "candidate";
  return db.runTransaction(async (tx) => {
    const recordRef = refs.privateLessonChartRecord(record.recordId);
    const candidateRef = refs.alimtalkCandidate(candidateId);
    const [recordSnap, candidateSnap] = await Promise.all([tx.get(recordRef), tx.get(candidateRef)]);
    const current = recordSnap.data();
    const existing = candidateSnap.data();
    if (existing?.status === "sent") return "completed";
    if (existing?.status === "queued" || existing?.status === "processing") return "already_queued";
    if (
      !current ||
      current.approvedRevision !== revision ||
      current.approvedReportSnapshot?.revision !== revision ||
      currentPrivateLessonReportRevision(current) !== revision
    ) {
      if (existing && ["candidate", "queued"].includes(existing.status)) {
        tx.set(
          candidateRef,
          {
            status: "skipped",
            reasonCode: "stale_report_revision",
            lastError: "승인 후 리포트 내용이 변경되어 발송 후보를 무효화했습니다.",
            updatedAt: now,
          },
          { merge: true },
        );
      }
      return "stale";
    }
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
        reportRevision: revision,
        notionPageId: "",
      },
      attempts: existing?.attempts || 0,
      maxAttempts: existing?.maxAttempts || 2,
      queuedBy: templateApproved ? "auto" : undefined,
      reviewedByUid: templateApproved ? reviewedByUid : existing?.reviewedByUid,
      reviewedAt: templateApproved ? now : existing?.reviewedAt || null,
      reasonCode: "",
      lastError: templateApproved ? null : "프라이빗 회원 리포트 템플릿 승인 대기",
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    tx.set(candidateRef, candidate, { merge: true });
    tx.set(
      recordRef,
      {
        gptStatus: "approved",
        publicReportApproval: {
          ...(current.publicReportApproval || {}),
          status: templateApproved ? "queued" : "approved",
          candidateId,
          lastError: templateApproved ? null : "프라이빗 회원 리포트 템플릿 승인 대기",
        },
        updatedAt: now,
      },
      { merge: true },
    );
    return templateApproved ? "queued" : "template_pending";
  });
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

async function ensureChartRequestForBooking(booking: BookingDoc): Promise<{ requestId: string; created: boolean }> {
  const requestId = `plc_${booking.bookingId}`;
  const existing = await refs.privateLessonChartRequest(requestId).get();
  if (existing.exists) {
    const existingRequest = existing.data();
    const syncedRequest = await syncChartRequestToActiveBooking(
      existingRequest,
      booking,
      "active_booking_repair",
    );
    await ensureChartRequestMediaUploadLink(syncedRequest);
    return { requestId: syncedRequest.requestId, created: false };
  }

  const reusableRequest = await findReusableChartRequestForBooking(booking);
  if (reusableRequest) {
    const syncedRequest = await syncChartRequestToActiveBooking(
      reusableRequest,
      booking,
      "rescheduled_booking_reuse",
    );
    await ensureChartRequestMediaUploadLink(syncedRequest);
    return { requestId: syncedRequest.requestId, created: false };
  }

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
  await ensureChartRequestMediaUploadLink(doc);
  return { requestId, created: true };
}

async function findReusableChartRequestForBooking(
  booking: BookingDoc,
): Promise<PrivateLessonChartRequestDoc | null> {
  if (!booking.memberId || !booking.lectureDate) return null;
  const snap = await refs.privateLessonChartRequests()
    .where("memberId", "==", booking.memberId)
    .where("lessonDate", "==", booking.lectureDate)
    .limit(50)
    .get();
  const candidates: PrivateLessonChartRequestDoc[] = [];
  for (const doc of snap.docs) {
    const request = doc.data();
    if (!request || request.requestId === `plc_${booking.bookingId}`) continue;
    if (request.bookingId === booking.bookingId) continue;
    if (request.status === "cancelled" && !isAutoBookingCancellationReason(request.cancellationReason)) continue;
    if (staffOccurrenceIdentity(request.staffId, request.staffName) !== staffOccurrenceIdentity(booking.staffId, booking.staffName)) {
      continue;
    }
    const linkedBooking = request.bookingId ? (await refs.booking(request.bookingId).get()).data() : null;
    if (linkedBooking && !inactivePrivateBookingReason(linkedBooking)) continue;
    candidates.push(request);
  }
  if (candidates.length !== 1) return null;
  return candidates.sort((a, b) => chartRequestReuseScore(b) - chartRequestReuseScore(a))[0] || null;
}

function chartRequestReuseScore(request: PrivateLessonChartRequestDoc): number {
  let score = 0;
  if (request.preStatus === "submitted") score += 20;
  if (request.postStatus === "submitted") score += 30;
  if (request.alimtalk?.status === "sent") score += 10;
  if (request.status !== "cancelled") score += 5;
  return score;
}

async function ensureChartRequestMediaUploadLink(request: PrivateLessonChartRequestDoc | undefined): Promise<void> {
  if (!request?.requestId) return;
  const token = accessTokenFor(request.requestId);
  const mediaUploadUrl = chartUrl("post", request.requestId, token, { focus: "media" });
  if (!(await shouldRepairMediaUploadLink(request, mediaUploadUrl))) return;

  const mediaUploadShort = await ensureShortLink({
    type: "private_chart",
    targetUrl: mediaUploadUrl,
    sourceId: `${request.requestId}_media`,
  });
  await refs.privateLessonChartRequest(request.requestId).set(
    {
      mediaUploadUrl,
      mediaUploadShortUrl: mediaUploadShort.shortUrl,
      updatedAt: nowTimestamp(),
    },
    { merge: true },
  );
}

async function shouldRepairMediaUploadLink(
  request: PrivateLessonChartRequestDoc,
  expectedTargetUrl: string,
): Promise<boolean> {
  if (request.mediaUploadUrl !== expectedTargetUrl) return true;
  const linkId = shortLinkIdFromUrl(request.mediaUploadShortUrl || "");
  if (!linkId) return true;
  const snap = await db.collection("shortLinks").doc(linkId).get();
  return String(snap.data()?.targetUrl || "") !== expectedTargetUrl;
}

async function syncChartRequestToActiveBooking(
  request: PrivateLessonChartRequestDoc | undefined,
  booking: BookingDoc,
  reason: string,
): Promise<PrivateLessonChartRequestDoc> {
  if (!request) throw new Error("missing_private_chart_request");
  const sessionNumber = await nextSessionNumber(booking);
  const syncResult = await db.runTransaction(async (tx) => {
    const requestRef = refs.privateLessonChartRequest(request.requestId);
    const recordRef = refs.privateLessonChartRecord(request.requestId);
    const [requestSnap, recordSnap] = await Promise.all([tx.get(requestRef), tx.get(recordRef)]);
    const currentRequest = requestSnap.data() || request;
    const shouldReactivate =
      currentRequest.status === "cancelled" &&
      isAutoBookingCancellationReason(currentRequest.cancellationReason);
    if (currentRequest.status === "cancelled" && !shouldReactivate) {
      return { changed: false, updatedRequest: currentRequest, updatedRecord: recordSnap.data() || null, invalidated: false };
    }
    const sessionChanged = Number(currentRequest.sessionNumber || 0) !== sessionNumber;
    const bookingChanged =
      currentRequest.bookingId !== booking.bookingId ||
      currentRequest.lectureId !== booking.lectureId ||
      currentRequest.staffId !== booking.staffId ||
      currentRequest.staffName !== booking.staffName ||
      currentRequest.lessonDate !== booking.lectureDate ||
      (currentRequest.lessonStartAt?.toMillis?.() || 0) !== (booking.lectureStartAt?.toMillis?.() || 0) ||
      (currentRequest.lessonEndAt?.toMillis?.() || 0) !== (booking.lectureEndAt?.toMillis?.() || 0);
    if (!sessionChanged && !bookingChanged && !shouldReactivate) {
      return { changed: false, updatedRequest: currentRequest, updatedRecord: recordSnap.data() || null, invalidated: false };
    }

    const now = nowTimestamp();
    const correction = {
      fromBookingId: currentRequest.bookingId || null,
      toBookingId: booking.bookingId || null,
      fromLessonStartAt: currentRequest.lessonStartAt || null,
      toLessonStartAt: booking.lectureStartAt || null,
      fromSessionNumber: Number(currentRequest.sessionNumber || 0) || null,
      toSessionNumber: sessionNumber,
      reason,
      correctedAt: now,
    };
    const sessionNumberCorrection = sessionChanged
      ? {
        from: Number(currentRequest.sessionNumber || 0) || null,
        to: sessionNumber,
        reason: "privateSessionLedger canonical round",
        correctedAt: now,
      }
      : currentRequest.sessionNumberCorrection;
    const scheduleNotice =
      bookingChanged && currentRequest.alimtalk?.status === "sent"
        ? {
          alimtalk: {
            ...currentRequest.alimtalk,
            status: "sent" as const,
            reasonCode: "schedule_changed_after_send",
            lastError: "강사 알림톡 발송 후 수업 일정이 변경되었습니다. 링크는 최신 일정으로 연결됩니다.",
          },
        }
        : {};
    const requestPatch = compactObject({
      bookingId: booking.bookingId,
      lectureId: booking.lectureId,
      staffId: booking.staffId,
      staffName: booking.staffName,
      lessonDate: booking.lectureDate,
      lessonStartAt: booking.lectureStartAt || null,
      lessonEndAt: booking.lectureEndAt || null,
      sessionNumber,
      sessionNumberCorrection,
      rescheduleCorrection: correction,
      cancellationReason: null,
      cancelledAt: null,
      status: shouldReactivate ? chartRequestStatusFromSubmissions(currentRequest) : currentRequest.status,
      ...scheduleNotice,
      updatedAt: now,
    }) as Partial<PrivateLessonChartRequestDoc>;
    const updatedRequest = { ...currentRequest, ...requestPatch } as PrivateLessonChartRequestDoc;
    const currentRecord = recordSnap.data() || chartRecordBase(updatedRequest);
    const recordPatch = compactObject({
      bookingId: booking.bookingId,
      lectureId: booking.lectureId,
      staffId: booking.staffId,
      staffName: booking.staffName,
      lessonDate: booking.lectureDate,
      lessonStartAt: booking.lectureStartAt || null,
      sessionNumber,
      sessionNumberCorrection,
      rescheduleCorrection: correction,
      cancellationReason: null,
      cancelledAt: null,
      updatedAt: now,
    }) as Partial<PrivateLessonChartRecordDoc>;
    const recordWithSchedule = { ...currentRecord, ...recordPatch } as PrivateLessonChartRecordDoc;
    const shouldInvalidateApproval =
      (sessionChanged || bookingChanged) &&
      !isPrivateLessonReportSent(currentRecord) &&
      Boolean(currentRecord.approvedRevision || currentRecord.publicReportApproval?.candidateId);
    const reportStatePatch: Partial<PrivateLessonChartRecordDoc> = shouldInvalidateApproval
      ? {
        reportRevision: currentPrivateLessonReportRevision(recordWithSchedule),
        approvedRevision: "",
        approvedReportSnapshot: null,
        publicReportApproval: {
          status: "pending",
          approvedAt: null,
          approvedBy: currentRecord.publicReportApproval?.approvedBy,
          candidateId: null,
          lastError: "수업 일정 또는 회차가 변경되어 리포트 재승인이 필요합니다.",
        },
      }
      : {};
    const updatedRecord = { ...recordWithSchedule, ...reportStatePatch } as PrivateLessonChartRecordDoc;
    const candidateId = shouldInvalidateApproval
      ? String(currentRecord.publicReportApproval?.candidateId || "")
      : "";
    const candidateRef = candidateId ? refs.alimtalkCandidate(candidateId) : null;
    const candidate = candidateRef ? (await tx.get(candidateRef)).data() : undefined;
    tx.set(requestRef, requestPatch, { merge: true });
    tx.set(
      recordRef,
      recordSnap.exists
        ? { ...recordPatch, ...reportStatePatch }
        : compactObject(updatedRecord as unknown as Record<string, unknown>),
      { merge: true },
    );
    if (candidateRef && candidate && ["candidate", "queued", "processing", "failed"].includes(candidate.status)) {
      tx.set(
        candidateRef,
        {
          status: "skipped",
          reasonCode: "private_report_schedule_changed",
          lastError: "수업 일정 또는 회차가 변경되어 기존 리포트 발송 후보를 보류했습니다.",
          updatedAt: now,
        },
        { merge: true },
      );
    }
    return {
      changed: true,
      updatedRequest,
      updatedRecord,
      invalidated: shouldInvalidateApproval,
    };
  });
  const { updatedRequest, updatedRecord } = syncResult;
  if (!syncResult.changed) return updatedRequest;
  if (syncResult.invalidated) {
    await invalidatePendingPrivateLessonReportCandidates(
      updatedRecord?.recordId || request.requestId,
      "수업 일정 또는 회차가 변경되어 기존 리포트 발송 후보를 보류했습니다.",
    );
  }

  if (updatedRecord && (updatedRecord.notionSync?.pageId || updatedRecord.notionSync?.instructorPageId)) {
    try {
      const notionSync = await syncPrivateLessonChartRecordToNotion(updatedRecord, updatedRequest);
      await refs.privateLessonChartRecord(request.requestId).set({ notionSync, updatedAt: nowTimestamp() }, { merge: true });
    } catch (err) {
      logger.warn("private chart request booking sync notion update failed", {
        requestId: request.requestId,
        previousBookingId: request.bookingId,
        nextBookingId: booking.bookingId,
        message: errorMessage(err),
      });
    }
  }
  return updatedRequest;
}

function isAutoBookingCancellationReason(value: unknown): boolean {
  return /^(booking_not_in_private_session_ledger|chart_request_not_in_private_session_ledger|missing_from_latest_reservation_import|stale|lecture_deleted|deleted|source_inactive|missing_booking|booking_not_found|booking_app_status_cancel|rescheduled_duplicate|duplicate_source|fallback_source_superseded|session_order_excluded|not_in_private_session_ledger)/i.test(String(value || ""));
}

function chartRequestStatusFromSubmissions(request: PrivateLessonChartRequestDoc): PrivateLessonChartRequestStatus {
  if (request.preStatus === "submitted" && request.postStatus === "submitted") return "completed";
  if (request.preStatus === "submitted") return "pre_submitted";
  if (request.postStatus === "submitted") return "post_submitted";
  return "pending";
}

async function submitPrivateLessonChart(
  chartRequest: PrivateLessonChartRequestDoc,
  mode: PrivateLessonChartMode,
  answers: ChartAnswerMap,
): Promise<{ requestId: string; recordId: string; mode: PrivateLessonChartMode; notionStatus: string }> {
  const recordRef = refs.privateLessonChartRecord(chartRequest.requestId);
  const requestRef = refs.privateLessonChartRequest(chartRequest.requestId);
  const { nextRecord } = await db.runTransaction(async (tx) => {
    const requestSnap = await tx.get(requestRef);
    const recordSnap = await tx.get(recordRef);
    const currentRequest = requestSnap.data() || chartRequest;
    const base = recordSnap.data() || chartRecordBase(chartRequest);
    const lockReason = privateLessonReportMutationLockReason(base);
    if (lockReason) throw new Error(lockReason);
    const now = nowTimestamp();
    const reportResetPatch = privateLessonReportSourceChangePatch();
    const recordPatch =
      mode === "pre"
        ? { prePlan: answers, preSubmittedAt: now, ...reportResetPatch }
        : { postRecord: answers, postSubmittedAt: now, ...reportResetPatch };
    const nextRecord = {
      ...base,
      ...recordPatch,
      updatedAt: now,
    } as PrivateLessonChartRecordDoc;
    const nextStatus: PrivateLessonChartRequestStatus =
      mode === "pre"
        ? currentRequest.postStatus === "submitted"
          ? "completed"
          : "pre_submitted"
        : currentRequest.preStatus === "submitted"
          ? "completed"
          : "post_submitted";
    const requestPatch =
      mode === "pre"
        ? { preStatus: "submitted" as const, status: nextStatus }
        : { postStatus: "submitted" as const, status: nextStatus };
    tx.set(recordRef, nextRecord, { merge: true });
    tx.set(requestRef, { ...requestPatch, updatedAt: now }, { merge: true });
    return { nextRecord };
  });

  let recordForNotion = nextRecord;
  await skipPendingPrivateLessonReportCandidate(recordForNotion);
  if (recordForNotion.postRecord && recordForNotion.postSubmittedAt) {
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

async function skipPendingPrivateLessonReportCandidate(
  record: PrivateLessonChartRecordDoc,
  lastError = "리포트 발송 전 설문 답변이 수정되어 기존 발송 후보를 보류했습니다.",
): Promise<void> {
  if (isPrivateLessonReportSent(record)) return;
  await invalidatePendingPrivateLessonReportCandidates(record.recordId, lastError);
}

async function upsertChartRecordBase(chartRequest: PrivateLessonChartRequestDoc): Promise<PrivateLessonChartRecordDoc> {
  const base = chartRecordBase(chartRequest);
  await refs.privateLessonChartRecord(chartRequest.requestId).set(base, { merge: true });
  return base;
}

function chartRecordBase(chartRequest: PrivateLessonChartRequestDoc): PrivateLessonChartRecordDoc {
  const now = nowTimestamp();
  return {
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
    const draft = applyPrivateLessonReportKeywords(
      await generateGeminiPrivateLessonDraft(record, chartRequest),
      record,
    );
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
    const readyRecordBase = {
      ...nextRecord,
      publicReportUrl: reportResolution.publicReportUrl || nextRecord.publicReportUrl,
      publicReportCanonicalUrl: reportResolution.publicReportCanonicalUrl || nextRecord.publicReportCanonicalUrl,
    } as PrivateLessonChartRecordDoc;
    const reportRevision = currentPrivateLessonReportRevision(readyRecordBase);
    const readyRecord = {
      ...readyRecordBase,
      reportRevision,
      approvedRevision: "",
      approvedReportSnapshot: null,
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
        reportRevision,
        approvedRevision: "",
        approvedReportSnapshot: null,
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

async function regenerateManualPrivateLessonReport(
  record: PrivateLessonChartRecordDoc,
  chartRequest: PrivateLessonChartRequestDoc,
): Promise<{ taskId: string; generated: boolean; ready: boolean; record: PrivateLessonChartRecordDoc }> {
  const sourceHash = gptSourceHash(record, chartRequest);
  const taskId = `manual_${record.recordId}_${sourceHash.slice(0, 12)}`;
  const summary = cleanEditableReportText(record.gptDraftSummary || record.publicSummary, 900);
  const nextDirection = cleanEditableReportText(record.gptDraftNextDirection || record.publicNextDirection, 1200);
  if (!summary || !nextDirection) {
    return generatePrivateLessonReportDraft(record, chartRequest, { force: true });
  }
  const nextRecord = {
    ...record,
    gptTaskId: taskId,
    gptStatus: "draft_created",
    gptDraftSummary: summary,
    gptDraftNextDirection: nextDirection,
    publicSummary: summary,
    publicNextDirection: nextDirection,
    publicReportApproval: { status: "pending" as const, lastError: null },
    updatedAt: nowTimestamp(),
  } as PrivateLessonChartRecordDoc;
  const reportResolution = await resolveReportShortUrl(nextRecord);
  const readyRecordBase = {
    ...nextRecord,
    publicReportUrl: reportResolution.publicReportUrl || nextRecord.publicReportUrl,
    publicReportCanonicalUrl: reportResolution.publicReportCanonicalUrl || nextRecord.publicReportCanonicalUrl,
  } as PrivateLessonChartRecordDoc;
  const reportRevision = currentPrivateLessonReportRevision(readyRecordBase);
  const readyRecord = {
    ...readyRecordBase,
    reportRevision,
    approvedRevision: "",
    approvedReportSnapshot: null,
  } as PrivateLessonChartRecordDoc;
  await refs.privateLessonChartRecord(record.recordId).set(
    {
      gptTaskId: taskId,
      gptStatus: "draft_created",
      gptSourceHash: sourceHash,
      gptDraftSummary: summary,
      gptDraftNextDirection: nextDirection,
      publicSummary: summary,
      publicNextDirection: nextDirection,
      publicReportUrl: readyRecord.publicReportUrl || "",
      publicReportCanonicalUrl: readyRecord.publicReportCanonicalUrl || "",
      reportRevision,
      approvedRevision: "",
      approvedReportSnapshot: null,
      publicReportApproval: readyRecord.publicReportApproval,
      gptError: null,
      updatedAt: nowTimestamp(),
    },
    { merge: true },
  );
  return { taskId, generated: false, ready: true, record: readyRecord };
}

function hasEditableReportInput(input: { summary?: unknown; nextDirection?: unknown }): boolean {
  return Object.prototype.hasOwnProperty.call(input, "summary") || Object.prototype.hasOwnProperty.call(input, "nextDirection");
}

function hasManualPrivateLessonReportText(record: PrivateLessonChartRecordDoc): boolean {
  return Boolean(
    record.manualReportEdit &&
    cleanEditableReportText(record.gptDraftSummary || record.publicSummary, 900) &&
    cleanEditableReportText(record.gptDraftNextDirection || record.publicNextDirection, 1200)
  );
}

async function syncPrivateLessonChartRecordToNotion(
  record: PrivateLessonChartRecordDoc,
  chartRequest: PrivateLessonChartRequestDoc,
): Promise<NonNullable<PrivateLessonChartRecordDoc["notionSync"]>> {
  try {
    const reportCanBeExposed = canExposePrivateLessonReport(record);
    const reportResolution = reportCanBeExposed
      ? await resolveReportShortUrl(record)
      : {
        reportTargetUrl: "",
        publicReportUrl: "",
        publicReportCanonicalUrl: "",
        shouldUpdateRecord: Boolean(record.publicReportUrl || record.publicReportCanonicalUrl),
        shouldUpdateNotion: Boolean(record.publicReportUrl || record.publicReportCanonicalUrl),
      };
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
    const recordForNotion = {
      ...record,
      publicReportUrl: reportCanBeExposed ? reportResolution.publicReportUrl || record.publicReportUrl || "" : "",
      publicReportCanonicalUrl: reportCanBeExposed
        ? reportResolution.publicReportCanonicalUrl || record.publicReportCanonicalUrl || ""
        : "",
    } as PrivateLessonChartRecordDoc;
    const instructorPage = await syncInstructorMemberChartPage(recordForNotion, chartRequest);
    if (!instructorPage) {
      throw new Error(`Notion 강사 차트 위치를 찾을 수 없습니다: ${record.staffName || "강사 미확인"}`);
    }
    return {
      status: "synced",
      pageId: record.notionSync?.pageId,
      pageUrl: record.notionSync?.pageUrl,
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
): Promise<{ pageId: string; pageUrl: string } | null> {
  const title = notionSessionTitle(record, chartRequest);
  const knownPageId = record.notionSync?.instructorPageId;
  if (knownPageId) {
    await updateNotionPageTitle(knownPageId, title).catch((err) => {
      logger.warn("update instructor chart page title failed", {
        pageId: knownPageId,
        title,
        message: errorMessage(err),
      });
    });
    await replacePageContent(knownPageId, notionInstructorChartChildren(record, chartRequest));
    return {
      pageId: knownPageId,
      pageUrl: record.notionSync?.instructorPageUrl || notionPageUrl(knownPageId),
    };
  }
  const memberPageId = await findInstructorMemberPageId(record.staffName, record.memberName).catch((err) => {
    logger.warn("findInstructorMemberPageId failed", {
      staffName: record.staffName,
      memberName: record.memberName,
      message: errorMessage(err),
    });
    return "";
  });
  if (!memberPageId) return null;
  const existingPageId = await findChildPageByExactTitle(memberPageId, title);
  if (existingPageId) {
    await replacePageContent(existingPageId, notionInstructorChartChildren(record, chartRequest));
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

async function replacePageContent(pageId: string, children: Record<string, unknown>[]): Promise<void> {
  const existing = await notionBlockChildren(pageId);
  for (const child of existing) {
    if (!child?.id || child?.type === "child_page") continue;
    await notionRequest(`blocks/${child.id}`, "DELETE");
  }
  await appendPageContent(pageId, children);
}

async function updateNotionPageTitle(pageId: string, title: string): Promise<void> {
  await notionRequest(`pages/${pageId}`, "PATCH", { properties: notionTitle(title) });
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
  const activeBooking = await activePrivateBookingForChartRequest(chartRequest);
  if (!activeBooking.ok) {
    await cancelPrivateLessonChartRequest(chartRequest, activeBooking.reason);
    throw new Error("취소되었거나 변경된 수업입니다. 운영자에게 확인해 주세요.");
  }
  return chartRequest;
}

async function publicChartRequest(
  chartRequest: PrivateLessonChartRequestDoc,
  mode: PrivateLessonChartMode,
  record: PrivateLessonChartRecordDoc | null = null,
): Promise<Record<string, unknown>> {
  const approvalStatus = record?.publicReportApproval?.status || "";
  const reportReady = isPrivateLessonReportGenerated(record);
  const reportSent = isPrivateLessonReportSent(record);
  const reportUrl = reportReady ? record?.publicReportUrl || "" : "";
  const reportCanonicalUrl = reportReady ? record?.publicReportCanonicalUrl || "" : "";
  const reportStatus = approvalStatus && approvalStatus !== "pending" && reportReady
    ? approvalStatus
    : reportReady
      ? "ready"
      : record?.gptStatus || "pending";
  const [previousReport, latestIntake] = await Promise.all([
    mode === "pre" ? previousPrivateLessonReportSummary(chartRequest) : Promise.resolve(null),
    mode === "pre"
      ? latestPrivateSurveyForBooking({
        memberId: chartRequest.memberId,
        memberPhone: chartRequest.memberPhone,
      })
      : Promise.resolve(null),
  ]);
  const intakeSummary = latestIntake
    ? privateSurveySummaryForRequest(latestIntake)
    : chartRequest.intakeSummary || null;
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
    intakeSummary,
    previousReport,
    existingAnswers: record
      ? {
        pre: record.prePlan || null,
        post: record.postRecord || null,
      }
      : { pre: null, post: null },
    locked: reportSent,
    lockedReason: reportSent ? "member_report_sent" : "",
    report: record
      ? {
        recordId: record.recordId,
        status: reportStatus,
        sent: reportSent,
        canEdit: !reportSent,
        gptStatus: record.gptStatus,
        url: reportUrl,
        canonicalUrl: reportCanonicalUrl,
        summary: record.gptDraftSummary || record.publicSummary || "",
        nextDirection: record.gptDraftNextDirection || record.publicNextDirection || "",
        approval: record.publicReportApproval || null,
        postSubmitted: Boolean(record.postSubmittedAt),
      }
      : null,
    media: record?.media
      ? {
        sessionFolderUrl: record.media.sessionFolderUrl || "",
        files: mediaFilesForReport(record).map((file) => ({
          mediaId: file.mediaId,
          fileName: file.fileName,
          mimeType: file.mimeType,
          size: file.size,
          driveUrl: file.driveUrl,
          previewUrl: file.previewUrl,
          thumbnailUrl: file.thumbnailUrl || "",
          includeInReport: file.includeInReport !== false,
        })),
      }
      : { sessionFolderUrl: "", files: [] },
  };
}

async function previousPrivateLessonReportSummary(
  chartRequest: PrivateLessonChartRequestDoc,
): Promise<Record<string, unknown> | null> {
  if (!chartRequest.memberId) return null;
  const currentOrder = privateLessonOrderMillis(chartRequest);
  const currentSession = Number(chartRequest.sessionNumber || 0);
  const snap = await refs.privateLessonChartRecords()
    .where("memberId", "==", chartRequest.memberId)
    .limit(120)
    .get();
  const previous = snap.docs
    .map((doc) => doc.data())
    .filter((record) => record.recordId !== chartRequest.requestId)
    .filter((record) => isPrivateLessonReportGenerated(record))
    .filter((record) => {
      const order = privateLessonOrderMillis(record);
      const session = Number(record.sessionNumber || 0);
      if (currentOrder && order) return order < currentOrder;
      if (currentSession && session) return session < currentSession;
      return false;
    })
    .sort((a, b) => {
      const orderDiff = privateLessonOrderMillis(b) - privateLessonOrderMillis(a);
      if (orderDiff) return orderDiff;
      return Number(b.sessionNumber || 0) - Number(a.sessionNumber || 0);
    })[0];
  if (!previous) return null;
  const url = previous.publicReportUrl || previous.publicReportCanonicalUrl || "";
  return {
    recordId: previous.recordId,
    sessionNumber: previous.sessionNumber || null,
    lessonDate: previous.lessonDate || "",
    lessonTime: lessonTimeText(previous),
    summary: cleanEditableReportText(previous.gptDraftSummary || previous.publicSummary, 900),
    nextDirection: cleanEditableReportText(previous.gptDraftNextDirection || previous.publicNextDirection, 1200),
    homework: cleanEditableReportText(previous.postRecord?.homework, 900),
    url,
  };
}

async function latestPrivateSurveyForBooking(
  booking: Pick<BookingDoc, "memberId" | "memberPhone">,
): Promise<PrivateSurveyResponseDoc | null> {
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
  const bookingSessionNumber = canonicalSessionNumberFromBooking(booking);
  if (bookingSessionNumber) return bookingSessionNumber;
  const ledgerNumber = await nextSessionNumberFromPrivateLedger(booking);
  if (ledgerNumber) return ledgerNumber;
  const bookingNumber = await nextSessionNumberFromBookings(booking);
  return bookingNumber || 1;
}

async function nextSessionNumberFromBookings(booking: BookingDoc): Promise<number> {
  const snap = await refs.bookings().where("memberId", "==", booking.memberId).get();
  const currentStart = booking.lectureStartAt?.toMillis?.() || 0;
  const canonical = canonicalPrivateBookings(snap.docs.map((doc) => doc.data()))
    .filter(isCountablePrivateHistoryBooking);
  if (currentStart) {
    return canonical.filter((item) => (item.lectureStartAt?.toMillis?.() || 0) < currentStart).length + 1;
  }
  const currentDate = booking.lectureDate || "";
  return canonical.filter((item) => (item.lectureDate || "") < currentDate).length + 1;
}

function currentMonthRangeKst(baseDate = todayKst()): { startDate: string; endDate: string } {
  const yearMonth = baseDate.slice(0, 7);
  const startDate = `${yearMonth}-01`;
  const nextMonthFirst = new Date(`${startDate}T00:00:00.000+09:00`);
  nextMonthFirst.setMonth(nextMonthFirst.getMonth() + 1);
  return { startDate, endDate: addDays(formatDateKst(nextMonthFirst), -1) };
}

async function nextSessionNumberFromPrivateLedger(booking: BookingDoc): Promise<number | null> {
  const snap = await db.collection("privateSessionLedger").where("memberId", "==", booking.memberId).get();
  const rows = canonicalPrivateTimelineRows(
    snap.docs
      .map((doc): Record<string, any> => ({ id: doc.id, ...(doc.data() || {}) }))
      .filter((item) => ["attended", "reserved"].includes(String(item.status || "")))
      .map((item) => ({
        id: String(item.ledgerId || item.id || ""),
        memberId: String(item.memberId || ""),
        staffId: "",
        staffName: String(item.staffName || ""),
        startsAt: timestampMillisFromValue(item.startsAt),
        date: dateFromAnyValue(item.startsAt),
        title: "",
        ticketName: String(item.ticketName || ""),
        sessionNumber: positiveNumber(item.cumulativePrivateRound),
        sourcePriority: 1,
      })),
  );
  return nextSessionNumberFromTimeline(booking, rows);
}

type PrivateTimelineRow = {
  id: string;
  memberId: string;
  staffId: string;
  staffName: string;
  startsAt: number;
  date: string;
  title: string;
  ticketName: string;
  sessionNumber: number | null;
  sourcePriority: number;
};

async function nextSessionNumberFromTimeline(booking: BookingDoc, rows: PrivateTimelineRow[]): Promise<number | null> {
  if (!rows.length) return null;
  const current = privateTimelineRowFromBooking(booking);
  const exact = rows.find((row) => privateTimelineOccurrenceKey(row) === privateTimelineOccurrenceKey(current));
  if (exact?.sessionNumber) return exact.sessionNumber;
  const beforeRows = rows.filter((row) => comparePrivateTimelineRows(row, current) < 0);
  if (!beforeRows.length) return 1;
  const lastSource = beforeRows.reduce((latest, row) =>
    comparePrivateTimelineRows(row, latest) > 0 ? row : latest,
  );
  const baseNumber = Math.max(...beforeRows.map((row) => row.sessionNumber || 0), beforeRows.length);
  const supplement = await supplementalPrivateBookingsAfterTimeline(booking, current, lastSource, rows);
  return baseNumber + supplement.length + 1;
}

function privateTimelineRowFromBooking(booking: BookingDoc): PrivateTimelineRow {
  return {
    id: booking.bookingId,
    memberId: booking.memberId,
    staffId: booking.staffId || "",
    staffName: booking.staffName || "",
    startsAt: booking.lectureStartAt?.toMillis?.() || 0,
    date: booking.lectureDate || dateFromAnyValue(booking.lectureStartAt),
    title: "",
    ticketName: booking.ticketName || "",
    sessionNumber: null,
    sourcePriority: bookingSourcePriority(booking.bookingId),
  };
}

function canonicalPrivateTimelineRows(rows: PrivateTimelineRow[]): PrivateTimelineRow[] {
  const grouped = new Map<string, PrivateTimelineRow>();
  for (const row of rows) {
    if (!row.memberId || (!row.startsAt && !row.date)) continue;
    const key = privateTimelineOccurrenceKey(row);
    const current = grouped.get(key);
    if (!current || row.sourcePriority < current.sourcePriority || String(row.id || "") < String(current.id || "")) {
      grouped.set(key, row);
    }
  }
  return [...grouped.values()].sort(comparePrivateTimelineRows);
}

function privateTimelineOccurrenceKey(value: PrivateTimelineRow): string {
  return [
    value.memberId || "",
    staffOccurrenceIdentity(value.staffId, value.staffName),
    value.startsAt || value.date || "",
  ].join("|");
}

function comparePrivateTimelineRows(a: PrivateTimelineRow, b: PrivateTimelineRow): number {
  return (
    timelineOrderValue(a) - timelineOrderValue(b) ||
    String(a.date || "").localeCompare(String(b.date || "")) ||
    String(a.id || "").localeCompare(String(b.id || ""))
  );
}

function timelineOrderValue(row: PrivateTimelineRow): number {
  if (row.startsAt) return row.startsAt;
  if (!row.date) return 0;
  const parsed = Date.parse(`${row.date.slice(0, 10)}T00:00:00+09:00`);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function supplementalPrivateBookingsAfterTimeline(
  booking: BookingDoc,
  current: PrivateTimelineRow,
  lastSource: PrivateTimelineRow,
  sourceRows: PrivateTimelineRow[],
): Promise<BookingDoc[]> {
  if (!booking.memberId) return [];
  const boundary = timelineOrderValue(lastSource);
  const sourceKeys = new Set(sourceRows.map(privateTimelineOccurrenceKey));
  const currentKey = privateTimelineOccurrenceKey(current);
  const snap = await refs.bookings().where("memberId", "==", booking.memberId).get();
  return canonicalPrivateBookings(snap.docs.map((doc) => doc.data()))
    .filter(isCountablePrivateHistoryBooking)
    .filter((item) => {
      const row = privateTimelineRowFromBooking(item);
      const order = timelineOrderValue(row);
      if (!order || order <= boundary) return false;
      if (comparePrivateTimelineRows(row, current) >= 0) return false;
      const key = privateTimelineOccurrenceKey(row);
      if (key === currentKey || sourceKeys.has(key)) return false;
      return true;
    });
}

function timestampMillisFromValue(value: any): number {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (typeof value === "number") return value;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateFromAnyValue(value: any): string {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  const millis = timestampMillisFromValue(value);
  return millis ? new Date(millis).toISOString().slice(0, 10) : "";
}

function positiveNumber(value: any): number | null {
  const num = Number(value || 0);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function canonicalSessionNumberFromBooking(booking: BookingDoc): number | null {
  if (!booking || booking.sessionOrder?.counted === false) return null;
  if (inactivePrivateBookingReason(booking)) return null;
  return positiveNumber(booking.sessionOrder?.privateCumulativeRound);
}

function isPrivateBooking(booking: BookingDoc): boolean {
  if (booking.appStatus && booking.appStatus !== "reserved") return false;
  if (booking.lessonType === "group") return false;
  if (booking.lessonType === "private" || booking.lessonType === "semi_private") return true;
  const text = `${booking.ticketName || ""} ${booking.ticketClassType || ""} ${booking.ticketType || ""} ${(booking as any).title || ""} ${(booking as any).lectureTitle || ""}`;
  return /프라이빗|개인|1:1|PRIVATE|\bP\b/i.test(text);
}

function isCountablePrivateHistoryBooking(booking: BookingDoc): boolean {
  if (inactivePrivateBookingReason(booking)) return false;
  if (["wait", "wait_cancel", "cancel"].includes(String(booking.appStatus || ""))) return false;
  if (["absent", "late_cancel"].includes(String(booking.attendanceStatus || ""))) return false;
  return true;
}

function canonicalPrivateBookings(bookings: BookingDoc[]): BookingDoc[] {
  const grouped = new Map<string, BookingDoc>();
  for (const booking of bookings) {
    if (inactivePrivateBookingReason(booking)) continue;
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
    if (!current || preferCanonicalChartRequest(request, current)) grouped.set(key, request);
  }
  return [...grouped.values()].sort(
    (a, b) => (a.lessonStartAt?.toMillis?.() || 0) - (b.lessonStartAt?.toMillis?.() || 0),
  );
}

function preferCanonicalChartRequest(
  next: PrivateLessonChartRequestDoc,
  current: PrivateLessonChartRequestDoc,
): boolean {
  const nextPriority = bookingSourcePriority(next.bookingId);
  const currentPriority = bookingSourcePriority(current.bookingId);
  if (nextPriority !== currentPriority) return nextPriority < currentPriority;
  const nextScore = chartRequestReuseScore(next);
  const currentScore = chartRequestReuseScore(current);
  if (nextScore !== currentScore) return nextScore > currentScore;
  return String(next.requestId || "") < String(current.requestId || "");
}

function privateLessonOccurrenceKey(
  value: Pick<BookingDoc, "memberId" | "staffId" | "lectureStartAt" | "lectureDate" | "memberName" | "staffName">,
): string {
  const start = value.lectureStartAt?.toMillis?.() || value.lectureDate || "";
  return [
    value.memberId || normalizeKoreanName(value.memberName || ""),
    staffOccurrenceIdentity(value.staffId, value.staffName),
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
    staffOccurrenceIdentity(value.staffId, value.staffName),
    start,
  ].join("|");
}

function staffOccurrenceIdentity(staffId?: string, staffName?: string): string {
  return normalizeKoreanName(staffName || "") || String(staffId || "");
}

function preferCanonicalBooking(next: BookingDoc, current: BookingDoc): boolean {
  return preferCanonicalBookingLike(next.bookingId, current.bookingId);
}

function preferCanonicalBookingLike(nextBookingId: string, currentBookingId: string): boolean {
  const nextPriority = bookingSourcePriority(nextBookingId);
  const currentPriority = bookingSourcePriority(currentBookingId);
  if (nextPriority !== currentPriority) return nextPriority < currentPriority;
  return String(nextBookingId || "") < String(currentBookingId || "");
}

function isSendablePrivateChartRequest(request: PrivateLessonChartRequestDoc): boolean {
  if (request.status === "cancelled") return false;
  if (request.alimtalk?.status !== "template_pending" && request.alimtalk?.status !== "queued") return false;
  if (!request.staffPhone || !normalizePhone(request.staffPhone)) return false;
  if (!request.preShortUrl || !request.postShortUrl || !request.mediaUploadShortUrl) return false;
  if (!request.memberName || !request.staffName || !request.lessonStartAt) return false;
  return true;
}

async function activePrivateBookingForChartRequest(
  request: PrivateLessonChartRequestDoc,
): Promise<{ ok: true; booking: BookingDoc } | { ok: false; reason: string }> {
  if (
    request.status === "cancelled" &&
    !isAutoBookingCancellationReason(request.cancellationReason)
  ) {
    return { ok: false, reason: request.cancellationReason || "chart_request_cancelled" };
  }
  if (!request.bookingId) return { ok: false, reason: "missing_booking_id" };
  const snap = await refs.booking(request.bookingId).get();
  const booking = snap.data();
  if (!booking) return { ok: false, reason: "booking_not_found" };
  const reason = inactivePrivateBookingReason(booking);
  if (reason) {
    const replacement = await findReplacementPrivateBookingForChartRequest(request, reason);
    if (replacement) {
      const updatedRequest = await syncChartRequestToActiveBooking(
        request,
        replacement,
        `rescheduled_from_inactive_booking:${reason}`,
      );
      Object.assign(request, updatedRequest);
      return { ok: true, booking: replacement };
    }
    return { ok: false, reason };
  }
  const updatedRequest = await syncChartRequestToActiveBooking(request, booking, "active_booking_repair");
  Object.assign(request, updatedRequest);
  return { ok: true, booking };
}

async function findReplacementPrivateBookingForChartRequest(
  request: PrivateLessonChartRequestDoc,
  reason: string,
): Promise<BookingDoc | null> {
  if (!request.memberId || !request.lessonDate) return null;
  const linkedBooking = request.bookingId ? (await refs.booking(request.bookingId).get()).data() : null;
  const explicitReplacementId = String(
    linkedBooking?.supersededByBookingId || linkedBooking?.sessionOrder?.supersededByBookingId || "",
  );
  if (explicitReplacementId) {
    const explicitReplacement = (await refs.booking(explicitReplacementId).get()).data();
    if (
      explicitReplacement?.memberId === request.memberId &&
      !inactivePrivateBookingReason(explicitReplacement)
    ) {
      return explicitReplacement;
    }
  }
  const snap = await refs.bookings()
    .where("memberId", "==", request.memberId)
    .where("lectureDate", "==", request.lessonDate)
    .limit(50)
    .get();
  const requestStart = request.lessonStartAt?.toMillis?.() || 0;
  const candidates = snap.docs
    .map((doc) => doc.data())
    .filter((booking) => booking.bookingId !== request.bookingId)
    .filter((booking) => !inactivePrivateBookingReason(booking))
    .filter((booking) =>
      staffOccurrenceIdentity(booking.staffId, booking.staffName) === staffOccurrenceIdentity(request.staffId, request.staffName),
    )
    .sort((a, b) => {
      const aDistance = Math.abs((a.lectureStartAt?.toMillis?.() || 0) - requestStart);
      const bDistance = Math.abs((b.lectureStartAt?.toMillis?.() || 0) - requestStart);
      return aDistance - bDistance || bookingSourcePriority(a.bookingId) - bookingSourcePriority(b.bookingId);
    });
  if (candidates.length !== 1) {
    if (candidates.length > 1) {
      logger.warn("private chart replacement booking ambiguous", {
        requestId: request.requestId,
        previousBookingId: request.bookingId,
        candidateBookingIds: candidates.map((booking) => booking.bookingId),
        reason,
      });
    }
    return null;
  }
  const replacement = candidates[0] || null;
  if (replacement) {
    logger.info("private chart request resolved to replacement booking", {
      requestId: request.requestId,
      previousBookingId: request.bookingId,
      replacementBookingId: replacement.bookingId,
      reason,
    });
  }
  return replacement;
}

function inactivePrivateBookingReason(booking: BookingDoc): string {
  if (!booking?.bookingId) return "missing_booking";
  if ((booking as any).archiveBooking?.isCanonical === false) {
    return String(booking.sessionOrder?.excludedReason || "duplicate_source");
  }
  if (booking.sessionOrder?.counted === false) {
    return String(booking.sessionOrder.excludedReason || "session_order_excluded");
  }
  if (booking.appStatus && booking.appStatus !== "reserved") return `booking_app_status_${booking.appStatus}`;
  if (["absent", "late_cancel"].includes(String(booking.attendanceStatus || ""))) {
    return `attendance_status_${booking.attendanceStatus}`;
  }
  if (isPastUncheckedBooking(booking)) return "past_unchecked_attendance";
  const sourceStatus = String((booking as any).sourceStatus || "");
  if (/missing_from_latest_reservation_import|stale|lecture_deleted|deleted|cancel/i.test(sourceStatus)) {
    return sourceStatus || "source_inactive";
  }
  if (!isPrivateBooking(booking)) return "not_private_booking";
  return "";
}

function isPastUncheckedBooking(booking: BookingDoc): boolean {
  if (String(booking.attendanceStatus || "unchecked") === "attended") return false;
  const date = booking.lectureDate || dateFromAnyValue(booking.lectureStartAt);
  return Boolean(date && date < todayKst());
}

async function cancelPrivateLessonChartRequest(
  request: PrivateLessonChartRequestDoc,
  reason: string,
): Promise<void> {
  const now = nowTimestamp();
  const patch = {
    status: "cancelled" as const,
    cancellationReason: reason,
    cancelledAt: now,
    alimtalk: {
      ...(request.alimtalk || {}),
      status: request.alimtalk?.status === "sent" ? "sent" as const : "skipped" as const,
      templateName: PRIVATE_CHART_TEMPLATE_NAME,
      templateId: STAFF_PRIVATE_CHART_TEMPLATE_ID,
      lastError: `예약 취소/변경 확인: ${reason}`,
    },
    updatedAt: now,
  };
  await refs.privateLessonChartRequest(request.requestId).set(patch, { merge: true });
  const recordSnap = await refs.privateLessonChartRecord(request.requestId).get();
  const record = recordSnap.data();
  if (!record) return;
  await refs.privateLessonChartRecord(request.requestId).set(
    {
      cancellationReason: reason,
      cancelledAt: now,
      updatedAt: now,
    },
    { merge: true },
  );
  await updateCancelledNotionChartTitle(record, request, reason);
}

async function updateCancelledNotionChartTitle(
  record: PrivateLessonChartRecordDoc,
  request: PrivateLessonChartRequestDoc,
  reason: string,
): Promise<void> {
  const title = `${notionSessionTitle(record, request)} (취소)`;
  const pageIds = [record.notionSync?.pageId, record.notionSync?.instructorPageId].filter(Boolean) as string[];
  await Promise.all(
    pageIds.map(async (pageId) => {
      await updateNotionPageTitle(pageId, title);
      await appendPageContent(pageId, [
        callout(`예약 취소/변경으로 차트 요청을 중단했습니다. 사유: ${reason}`),
      ]);
    }),
  ).catch((err) => {
    logger.warn("cancelled private lesson notion title update failed", {
      requestId: request.requestId,
      bookingId: request.bookingId,
      reason,
      message: errorMessage(err),
    });
  });
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
  const configured = String(process.env.STAFF_PRIVATE_CHART_ALIMTALK_TEMPLATE_ID || "").trim();
  if (
    !configured ||
    STAFF_PRIVATE_CHART_TEMPLATE_ID === LEGACY_STAFF_PRIVATE_CHART_ALIMTALK_TEMPLATE_CODE ||
    STAFF_PRIVATE_CHART_TEMPLATE_ID !== configured
  ) {
    return false;
  }
  const readiness = await alimtalkTemplateReadiness(STAFF_PRIVATE_CHART_TEMPLATE_ID);
  if (!readiness.approved || !readiness.state) return false;
  const content = String(readiness.state.content || "");
  if (/Notion/i.test(content)) return false;
  for (const variable of ["#{강사명}", "#{회원명}", "#{회차}", "#{수업일시}"]) {
    if (!content.includes(variable)) return false;
  }
  const buttonUrls = readiness.state.buttonUrls || [];
  return [
    "https://in.archivepilates.com/s/#{수업전계획링크ID}/",
    "https://in.archivepilates.com/s/#{수업후기록링크ID}/",
    "https://in.archivepilates.com/s/#{사진영상업로드링크ID}/",
  ].every((url) => buttonUrls.includes(url));
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
  const postRecord = { ...(record.postRecord || {}) };
  delete (postRecord as Record<string, unknown>).nextMemo;
  const summaryKeywords = reportKeywordList(record.postRecord?.summaryKeywords);
  const nextDirectionKeywords = reportKeywordList(record.postRecord?.nextDirectionKeywords);
  const homework = cleanEditableReportText(record.postRecord?.homework, 900);
  return [
    "ARCHIVE PILATES 프라이빗 회원용 수업 리포트 문장을 작성합니다.",
    "톤: 조용하고 전문적이며 따뜻하게. 과장, 진단, 치료 효과 단정, 통증/병력 상세 노출은 금지합니다.",
    "점수, 평균, 등급, 평가처럼 느껴지는 표현은 쓰지 않습니다. 몸 상태의 흐름과 다음 수업 방향만 정리합니다.",
    "다음 수업 방향은 수업 후 기록의 목표, 진행 부위, 관찰 변화, 주의사항, 다음 수업 방향 키워드를 바탕으로 회원용 1문장으로 정리합니다.",
    "오늘의 핵심 키워드가 있으면 summary 문장에 자연스럽게 반드시 포함합니다.",
    "다음 수업 방향 키워드가 있으면 nextDirection 문장에 자연스럽게 반드시 포함합니다.",
    "홈워크는 별도 섹션에 노출되므로 summary나 nextDirection에 억지로 반복하지 않습니다.",
    "강사의 다음 수업 준비 메모는 내부 참고용이므로 회원용 다음 수업 방향 문장에 그대로 복사하지 않습니다.",
    "회원이 읽는 문장입니다. 강사용 체크값을 자연스럽고 고급스럽게 정리합니다.",
    `회원: ${record.memberName}`,
    `회차: ${record.sessionNumber}회차`,
    `수업일: ${record.lessonDate}`,
    `강사: ${record.staffName}`,
    `사전설문 요약: ${safeJson(chartRequest.intakeSummary || {})}`,
    `수업 전 계획: ${safeJson(record.prePlan || {})}`,
    `수업 후 기록: ${safeJson(postRecord)}`,
    `오늘의 핵심 키워드: ${summaryKeywords.join(", ") || "-"}`,
    `다음 수업 방향 키워드: ${nextDirectionKeywords.join(", ") || "-"}`,
    `홈워크: ${homework || "-"}`,
    "출력은 JSON만 허용합니다.",
    "summary: 1문장. 강사가 회원에게 직접 전하는 짧은 코칭 톤으로, 오늘 확인한 변화와 수업 방향을 평가 없이 따뜻하지만 담백하게 요약합니다.",
    "nextDirection: 1문장. 오늘 기록에서 이어갈 다음 수업 방향을 회원이 이해하기 쉬운 코칭 문장으로 정리합니다.",
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
  const nextDirection = cleanReportSentence(parsed.nextDirection) ||
    "다음 수업에서는 오늘 확인한 움직임의 흐름을 바탕으로 몸 상태에 맞게 이어가겠습니다.";
  if (!summary) {
    throw new Error("Gemini 리포트 응답에 summary가 없습니다.");
  }
  return { summary, nextDirection };
}

function applyPrivateLessonReportKeywords(
  draft: { summary: string; nextDirection: string },
  record: PrivateLessonChartRecordDoc,
): { summary: string; nextDirection: string } {
  return {
    summary: ensureKeywordsInReportSentence(
      draft.summary,
      reportKeywordList(record.postRecord?.summaryKeywords),
      "summary",
    ),
    nextDirection: ensureKeywordsInReportSentence(
      draft.nextDirection,
      reportKeywordList(record.postRecord?.nextDirectionKeywords),
      "nextDirection",
    ),
  };
}

function ensureKeywordsInReportSentence(
  sentence: string,
  keywords: string[],
  target: "summary" | "nextDirection",
): string {
  const clean = cleanReportSentence(sentence);
  const missing = uniqueTextItems(keywords).filter((keyword) => !clean.includes(keyword)).slice(0, 4);
  if (!missing.length) return clean;
  const joined = missing.join(", ");
  if (!clean) {
    return target === "summary"
      ? `${joined}를 중심으로 오늘 수업의 흐름을 정리했습니다.`
      : `다음 수업에서는 ${joined}를 중심으로 몸 상태에 맞게 이어가겠습니다.`;
  }
  return target === "summary"
    ? cleanReportSentence(`${clean} 특히 ${joined}를 함께 확인했습니다.`)
    : cleanReportSentence(`${clean} 다음 수업에서는 ${joined}도 함께 이어가겠습니다.`);
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

function cleanEditableReportText(value: unknown, maxLength: number): string {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLength);
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
      "사진·영상은 수업 후 기록 설문 페이지에서 첨부합니다. 첨부한 파일은 home@archivepilates.com Google Drive의 회원별/회차별 폴더에 저장되고 회원 리포트에 자동 포함됩니다.",
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
      `불편감 흐름: ${firstText(record.postRecord?.painChange) || "-"}`,
      `진행 부위: ${textArray(record.postRecord?.focusAreas).join(", ") || "-"}`,
      `사용 기구: ${textArray(record.postRecord?.equipment).join(", ") || "-"}`,
      `오늘 변화: ${textArray(record.postRecord?.changes).join(", ") || "-"}`,
      `움직임 관찰: ${textArray(record.postRecord?.movementObservations).join(", ") || "-"}`,
      `회원 체감/반응: ${textArray(record.postRecord?.memberResponses).join(", ") || "-"}`,
      `오늘의 핵심 키워드: ${reportKeywordList(record.postRecord?.summaryKeywords).join(", ") || "-"}`,
      `다음 수업 방향 키워드: ${reportKeywordList(record.postRecord?.nextDirectionKeywords).join(", ") || "-"}`,
      `홈워크: ${cleanEditableReportText(record.postRecord?.homework, 900) || "-"}`,
      `다음 수업 준비 메모(내부): ${String(record.postRecord?.nextMemo || "-")}`,
    ]),
    divider(),
    heading(3, "회원용 초안"),
    paragraph(record.gptDraftSummary || "Gemini 초안 생성 대기 중입니다."),
    divider(),
    heading(3, "회원 리포트 검수"),
    paragraph(
      isPrivateLessonReportGenerated(record)
        ? "아래 임베드 또는 회원 리포트 URL 속성에서 최종 회원용 리포트를 확인합니다."
        : "회원용 HTML 리포트 생성 대기 중입니다.",
    ),
    ...(isPrivateLessonReportGenerated(record) && record.publicReportUrl ? [embed(record.publicReportUrl)] : []),
  ];
}

function renderPrivateLessonReportMessagePage(message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"/>` +
    `<title>ARCHIVE PILATES Private Report</title><style>body{margin:0;padding:24px;font-family:Apple SD Gothic Neo,\"Noto Sans KR\",Arial,sans-serif;background:#f8f6f1;color:#27211b}.card{max-width:760px;margin:0 auto;padding:24px;background:#fff;border:1px solid #e4ded5;border-radius:12px}</style>` +
    `</head><body><div class="card"><p>${escapeHtml(message)}</p></div></body></html>`;
}

export function renderPrivateLessonReportPage(
  record: PrivateLessonChartRecordDoc,
  chartRequest: PrivateLessonChartRequestDoc,
): string {
  const memberName = escapeHtml(record.memberName || "");
  const staffName = escapeHtml(record.staffName || "미정");
  const sessionText = `${Number(record.sessionNumber || 1)}회차`;
  const lessonTime = lessonTimeText(record);
  const title = `${memberName || "회원"}님 수업 리포트`;
  const reportSummaryText = cleanEditableReportText(record.gptDraftSummary || record.publicSummary, 900) ||
    "오늘 수업 기록을 바탕으로 몸의 변화와 다음 방향을 정리했습니다.";
  const goals = textArray(record.postRecord?.goals || record.prePlan?.goals || []);
  const focusAreas = textArray(record.postRecord?.focusAreas || record.prePlan?.focusAreas || []);
  const equipment = textArray(record.postRecord?.equipment || record.prePlan?.equipment || []);
  const changes = textArray(record.postRecord?.changes || []);
  const movementObservations = textArray(record.postRecord?.movementObservations || []);
  const memberResponses = textArray(record.postRecord?.memberResponses || []);
  const cautions = textArray(record.postRecord?.cautions || record.prePlan?.cautions || []);
  const condition = firstText(record.postRecord?.condition);
  const painChange = firstText(record.postRecord?.painChange);
  const nextDirectionText = cleanEditableReportText(record.gptDraftNextDirection || record.publicNextDirection, 1200) ||
    "다음 수업 방향은 담당 강사가 수업 기록을 기준으로 이어서 조정합니다.";
  const homeworkText = cleanEditableReportText(record.postRecord?.homework, 900);
  const reportUrl = (() => {
    const url = new URL(PRIVATE_LESSON_REPORT_VIEW_BASE_URL);
    url.searchParams.set("recordId", record.recordId);
    url.searchParams.set("token", String(chartRequest.accessTokenHash || ""));
    return url.toString();
  })();
  const reportShortcutUrl = String(record.publicReportUrl || "").trim();
  const reportVisibleUrl = reportShortcutUrl || reportUrl;
  const flowSummary = [condition, painChange].filter(Boolean).join(" · ");
  const todayProgress = uniqueTextItems([...goals, ...focusAreas, ...equipment]).slice(0, 10);
  const improvementItems = uniqueTextItems(changes.length ? changes : memberResponses).slice(0, 6);
  const observationItems = uniqueTextItems([...movementObservations, ...memberResponses]).slice(0, 12);
  const nextCheckItems = privateReportNextCheckItems({
    condition,
    painChange,
    focusAreas,
    cautions,
  });
  const mediaFiles = mediaFilesForReport(record);
  const mediaSection = renderPrivateLessonReportMediaSection(mediaFiles, record.media?.sessionFolderUrl || "");
  const metricTiles = [
    focusAreas.length
      ? `<div class="tile"><small>집중 영역</small><strong>${escapeHtml(focusAreas.slice(0, 2).join(" · "))}</strong></div>`
      : "",
    flowSummary
      ? `<div class="tile"><small>몸 상태 흐름</small><strong>${escapeHtml(flowSummary)}</strong></div>`
      : "",
    changes.length
      ? `<div class="tile"><small>오늘 변화</small><strong>${escapeHtml(changes.slice(0, 2).join(" · "))}</strong></div>`
      : "",
  ].filter(Boolean);
  const metricGrid = metricTiles.length ? `<div class="grid">${metricTiles.join("")}</div>` : "";
  const improvementSection = improvementItems.length
    ? `<section><div class="section-title"><h2>좋아진 점</h2><span class="hint">회원님이 느낄 수 있는 변화</span></div><ul class="soft-list">${improvementItems
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join("")}</ul></section>`
    : "";
  const progressSection = todayProgress.length
    ? `<section><div class="section-title"><h2>오늘 확인한 움직임</h2><span class="hint">진행 내용</span></div><div class="chips">${todayProgress
      .map((item) => `<span class="chip">${escapeHtml(item)}</span>`)
      .join("")}</div></section>`
    : "";
  const observationSection = observationItems.length
    ? `<section><div class="section-title"><h2>수업 중 관찰</h2><span class="hint">담당 강사 기록</span></div><div class="chips">${observationItems
      .map((item) => `<span class="chip">${escapeHtml(item)}</span>`)
      .join("")}</div></section>`
    : "";
  const nextCheckSection = nextCheckItems.length
    ? `<section><div class="section-title"><h2>다음 수업 전 체크</h2><span class="hint">가볍게 확인할 내용</span></div><ul class="soft-list">${nextCheckItems
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join("")}</ul></section>`
    : "";

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"/>` +
    `<title>${title}</title><style>
      :root{color-scheme:light;--bg:#f7f5f2;--surface:#fffdfa;--line:#ded8d0;--text:#201d19;--muted:#6f675f;--soft:#ece7df;--accent:#4f5b4a;--accent2:#8a6f54}
      *{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;background:var(--bg);color:var(--text);font-family:Apple SD Gothic Neo,\"Noto Sans KR\",system-ui,sans-serif;line-height:1.62;overflow-x:clip}
      main,.hero,.lead,.grid,.tile,section,.section-title,.chips,.chip,.soft-list,.note,.media-grid,.media-card,.media-info,.footer{min-width:0}
      p,h1,h2,strong,span,small,li,.note,.report-link{overflow-wrap:anywhere;word-break:keep-all}
      main{width:min(100%,820px);margin:0 auto;padding:26px 18px 56px}.brand{margin:0 0 18px;color:var(--muted);font-size:12px;font-weight:800;letter-spacing:0}
      .hero{padding:0 0 22px;border-bottom:1px solid var(--line)}h1{margin:0;font-size:30px;line-height:1.2;letter-spacing:0}.meta{margin-top:12px;color:var(--muted);font-size:14px}
      .lead{margin-top:22px;padding:20px;background:var(--surface);border:1px solid var(--line);border-radius:8px}.lead small{display:block;margin-bottom:7px;color:var(--accent2);font-size:12px;font-weight:800}.lead p{margin:0;font-size:17px;white-space:pre-wrap}
      .grid{display:grid;gap:12px;margin-top:18px;align-items:stretch}.tile{padding:16px;background:var(--surface);border:1px solid var(--line);border-radius:8px}.tile small{display:block;color:var(--muted);font-size:12px;font-weight:800}.tile strong{display:block;margin-top:6px;font-size:20px;line-height:1.38;white-space:normal}
      section{margin-top:28px}.section-title{display:flex;align-items:end;justify-content:space-between;gap:12px;margin-bottom:12px}h2{margin:0;font-size:17px;letter-spacing:0}.hint{color:var(--muted);font-size:12px}
      .chips{display:flex;flex-wrap:wrap;gap:8px}.chip{display:inline-flex;align-items:flex-start;max-width:100%;min-height:34px;padding:7px 10px;border:1px solid var(--line);border-radius:12px;background:var(--surface);font-size:13px;color:#2d2924;white-space:normal}
      .soft-list{display:grid;gap:9px;margin:0;padding:0;list-style:none}.soft-list li{padding:13px 14px;background:var(--surface);border:1px solid var(--line);border-radius:8px}
      .media-grid{display:grid;gap:12px}.media-card{overflow:hidden;background:var(--surface);border:1px solid var(--line);border-radius:8px}.media-card iframe{display:block;width:100%;aspect-ratio:16/10;border:0;background:#f0ede8}.media-info{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;color:var(--muted);font-size:12px}.media-info a{color:var(--accent);font-weight:800;text-decoration:none}
      .note{padding:16px;border-left:3px solid var(--accent);background:rgba(255,253,250,.72);color:#312c26;white-space:pre-wrap}.footer{margin-top:32px;padding-top:16px;border-top:1px solid var(--line);color:var(--muted);font-size:12px}.report-link{display:inline-flex;align-items:center;max-width:100%;min-height:40px;margin-top:10px;padding:8px 13px;border:1px solid var(--line);border-radius:999px;color:var(--accent);font-weight:800;text-decoration:none;background:var(--surface)}
      @media (min-width:680px){main{padding:38px 28px 72px}.grid{grid-template-columns:repeat(3,minmax(0,1fr))}.media-grid{grid-template-columns:repeat(2,minmax(0,1fr))}h1{font-size:36px}.lead{padding:24px}}
    </style></head><body><main><div class="hero"><p class="brand">ARCHIVE PILATES</p><h1>${escapeHtml(title)}</h1>` +
    `<p class="meta">${escapeHtml(sessionText)} · ${escapeHtml(lessonTime)} · 담당: ${staffName}</p>` +
    `<div class="lead"><small>오늘의 핵심</small><p>${escapeHtml(reportSummaryText)}</p></div>` +
    `${metricGrid}</div>` +
    improvementSection +
    progressSection +
    observationSection +
    `<section><div class="section-title"><h2>다음 수업 방향</h2><span class="hint">강사 입력 반영</span></div><p class="note">${escapeHtml(nextDirectionText)}</p></section>` +
    (homeworkText
      ? `<section><div class="section-title"><h2>홈워크</h2><span class="hint">다음 수업 전 가볍게</span></div><p class="note">${escapeHtml(homeworkText)}</p></section>`
      : "") +
    nextCheckSection +
    mediaSection +
    `<p class="footer">본 리포트는 담당 강사의 프라이빗 수업 기록을 바탕으로 정리되었습니다.<br><a class="report-link" href="${escapeAttr(reportVisibleUrl)}">리포트 다시 열기</a></p>` +
    `</main></body></html>`;
}

function privateReportNextCheckItems(options: {
  condition: string;
  painChange: string;
  focusAreas: string[];
  cautions: string[];
}): string[] {
  const items = uniqueTextItems([
    options.condition ? `다음 수업 전 컨디션 흐름: ${options.condition}` : "",
    options.painChange ? `불편감 변화: ${options.painChange}` : "",
    options.cautions.length ? `주의할 부분: ${options.cautions.slice(0, 2).join(" · ")}` : "",
    options.focusAreas.length ? `이어갈 감각: ${options.focusAreas.slice(0, 2).join(" · ")}` : "",
  ]).slice(0, 4);
  return items;
}

function uniqueTextItems(values: unknown[]): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const value of values) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    items.push(text);
  }
  return items;
}

function renderPrivateLessonReportMediaSection(files: PrivateLessonChartMediaFile[], folderUrl: string): string {
  if (!files.length) return "";
  return `<section><div class="section-title"><h2>수업 사진·영상</h2><span class="hint">강사 업로드 자료</span></div><div class="media-grid">` +
    files.map((file) => {
      const url = file.previewUrl || drivePreviewUrl(file.driveFileId);
      return `<article class="media-card"><iframe loading="lazy" title="${escapeAttr(file.fileName)}" src="${escapeAttr(url)}" allow="autoplay"></iframe>` +
        `<div class="media-info"><span>${escapeHtml(file.fileName)}</span><a href="${escapeAttr(file.driveUrl || url)}" target="_blank" rel="noopener">원본 보기</a></div></article>`;
    }).join("") +
    `</div>${folderUrl ? `<p class="footer"><a href="${escapeAttr(folderUrl)}" target="_blank" rel="noopener">Drive 폴더 보기</a></p>` : ""}</section>`;
}

function mediaFilesForReport(record: PrivateLessonChartRecordDoc): PrivateLessonChartMediaFile[] {
  return (record.media?.files || [])
    .filter((file) => file && file.status === "uploaded" && file.includeInReport !== false && file.driveFileId)
    .slice(0, 12);
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

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function drivePreviewUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/preview`;
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
      `불편감 흐름: ${firstText(record.postRecord?.painChange) || "-"}`,
      `오늘 변화: ${textArray(record.postRecord?.changes).join(", ") || "-"}`,
      `움직임 관찰: ${textArray(record.postRecord?.movementObservations).join(", ") || "-"}`,
      `회원 체감/반응: ${textArray(record.postRecord?.memberResponses).join(", ") || "-"}`,
      `오늘의 핵심 키워드: ${reportKeywordList(record.postRecord?.summaryKeywords).join(", ") || "-"}`,
      `다음 수업 방향 키워드: ${reportKeywordList(record.postRecord?.nextDirectionKeywords).join(", ") || "-"}`,
      `홈워크: ${cleanEditableReportText(record.postRecord?.homework, 900) || "-"}`,
      `다음 수업 준비 메모(내부): ${String(record.postRecord?.nextMemo || "-")}`,
    ]),
    heading(3, "회원 리포트"),
    paragraph(record.gptDraftSummary || "Gemini 초안 생성 대기 중입니다."),
    ...(isPrivateLessonReportGenerated(record) && record.publicReportUrl ? [embed(record.publicReportUrl)] : []),
  ];
}

function notionInstructorChartChildren(
  record: PrivateLessonChartRecordDoc,
  chartRequest: PrivateLessonChartRequestDoc,
): Record<string, unknown>[] {
  const reportButtonUrl = isPrivateLessonReportGenerated(record)
    ? record.publicReportUrl || record.publicReportCanonicalUrl || ""
    : "";
  return [
    callout("이 페이지는 강사용 회차 기록입니다. 회원 발송은 수업 후 기록 링크의 리포트 화면에서 처리합니다."),
    heading(2, `${record.memberName}님 ${record.sessionNumber}회차`),
    paragraph(`수업일: ${lessonTimeText(chartRequest)} / 담당: ${record.staffName || "미정"}`),
    heading(2, "사진·영상"),
    paragraph("수업 후 기록 설문에서 첨부한 사진과 영상은 Google Drive에 저장되고 회원 리포트에 자동 포함됩니다."),
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
      `불편감 흐름: ${firstText(record.postRecord?.painChange) || "-"}`,
      `진행 부위: ${textArray(record.postRecord?.focusAreas).join(", ") || "-"}`,
      `사용 기구: ${textArray(record.postRecord?.equipment).join(", ") || "-"}`,
      `오늘 변화: ${textArray(record.postRecord?.changes).join(", ") || "-"}`,
      `움직임 관찰: ${textArray(record.postRecord?.movementObservations).join(", ") || "-"}`,
      `회원 체감/반응: ${textArray(record.postRecord?.memberResponses).join(", ") || "-"}`,
      `오늘의 핵심 키워드: ${reportKeywordList(record.postRecord?.summaryKeywords).join(", ") || "-"}`,
      `다음 수업 방향 키워드: ${reportKeywordList(record.postRecord?.nextDirectionKeywords).join(", ") || "-"}`,
      `홈워크: ${cleanEditableReportText(record.postRecord?.homework, 900) || "-"}`,
      `다음 수업 준비 메모(내부): ${String(record.postRecord?.nextMemo || "-")}`,
    ]),
    divider(),
    heading(3, "회원 리포트"),
    paragraph(
      reportButtonUrl
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
  const reportButtonUrl = isPrivateLessonReportGenerated(record)
    ? record.publicReportUrl || record.publicReportCanonicalUrl || ""
    : "";
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
      `불편감 흐름: ${firstText(record.postRecord?.painChange) || "-"}`,
      `오늘 변화: ${textArray(record.postRecord?.changes).join(", ") || "-"}`,
      `움직임 관찰: ${textArray(record.postRecord?.movementObservations).join(", ") || "-"}`,
      `회원 체감/반응: ${textArray(record.postRecord?.memberResponses).join(", ") || "-"}`,
      `오늘의 핵심 키워드: ${reportKeywordList(record.postRecord?.summaryKeywords).join(", ") || "-"}`,
      `다음 수업 방향 키워드: ${reportKeywordList(record.postRecord?.nextDirectionKeywords).join(", ") || "-"}`,
      `홈워크: ${cleanEditableReportText(record.postRecord?.homework, 900) || "-"}`,
      `다음 수업 준비 메모(내부): ${String(record.postRecord?.nextMemo || "-")}`,
    ]),
    heading(3, "회원 리포트"),
    paragraph(
      reportButtonUrl
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

function chartUrl(
  mode: PrivateLessonChartMode,
  requestId: string,
  token: string,
  extraParams: Record<string, string> = {},
): string {
  const url = new URL(PUBLIC_BASE_URL);
  url.searchParams.set("mode", mode);
  url.searchParams.set("r", requestId);
  url.searchParams.set("t", token);
  for (const [key, value] of Object.entries(extraParams)) {
    if (value) url.searchParams.set(key, value);
  }
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

function privateLessonOrderMillis(chartRequest: Pick<PrivateLessonChartRequestDoc, "lessonDate" | "lessonStartAt">): number {
  const date = chartRequest.lessonStartAt?.toDate?.();
  if (date) return date.getTime();
  const parsed = Date.parse(`${chartRequest.lessonDate || ""}T00:00:00+09:00`);
  return Number.isFinite(parsed) ? parsed : 0;
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
  return `${lessonTitleDate(chartRequest)} · ${record.memberName} ${record.sessionNumber}회차(${privateLessonChartStageLabel(record, chartRequest)})`;
}

function privateLessonChartStageLabel(
  record: PrivateLessonChartRecordDoc,
  chartRequest?: PrivateLessonChartRequestDoc,
): string {
  if (isPrivateLessonReportSent(record)) return "리포트 발송완료";
  if (isPrivateLessonReportGenerated(record)) return "리포트 생성완료";
  if (record.postSubmittedAt || chartRequest?.postStatus === "submitted") return "수업 후 설문완료";
  if (record.preSubmittedAt || chartRequest?.preStatus === "submitted") return "수업 전 설문완료";
  return "수업 전 설문대기";
}

function isPrivateLessonReportSent(record: PrivateLessonChartRecordDoc | null | undefined): boolean {
  const approval = record?.publicReportApproval as (PrivateLessonChartRecordDoc["publicReportApproval"] & {
    sentAt?: Timestamp;
  }) | undefined;
  return Boolean(
    record &&
    (
      approval?.status === "sent" ||
      approval?.sentAt ||
      (record as any).publicReportSentAt ||
      record.gptStatus === "published"
    ),
  );
}

function canExposePrivateLessonReport(record: PrivateLessonChartRecordDoc | null | undefined): boolean {
  return Boolean(
    record?.postSubmittedAt &&
    ["draft_created", "approved", "published"].includes(String(record.gptStatus || "")),
  );
}

function isPrivateLessonReportGenerated(record: PrivateLessonChartRecordDoc | null | undefined): boolean {
  return Boolean(
    canExposePrivateLessonReport(record) &&
    (record?.publicReportUrl || record?.publicReportCanonicalUrl),
  );
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

function reportKeywordList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value.join(",") : String(value || "");
  return raw
    .split(/[\n,，·]+/g)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
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
