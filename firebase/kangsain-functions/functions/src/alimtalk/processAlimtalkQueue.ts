import { createHmac, randomBytes } from "node:crypto";
import { logger } from "firebase-functions";
import { db } from "../config/firebase";
import { solapiApiKey, solapiApiSecret, solapiPfid } from "../config/secrets";
import { refs } from "../firestore/refs";
import type { AlimtalkCandidateDoc } from "../types/models";
import { errorMessage } from "../utils/errors";
import { nowTimestamp, todayKst } from "../utils/date";
import { ensureShortLink } from "../utils/shortLinks";
import { ALIMTALK_TEMPLATE_CHANNEL_IDS, alimtalkDedupePolicy } from "./templates";
import { autoSendabilityIssue } from "./eligibility";
import { alimtalkDedupeKey, findCompletedDuplicateForCandidate, normalizePhone } from "./dedupe";
import { isAlimtalkTemplateApproved } from "./templateStatus";
import { normalizeInstructorLessonManagementNumber } from "./instructorLessonManagement";
import { isAlimtalkTestRecipient } from "./testRecipients";
import { currentPrivateLessonReportRevision } from "../privateLessonChart/privateLessonReportRevision";

const SOLAPI_SEND_URL = "https://api.solapi.com/messages/v4/send-many/detail";
const PROCESSING_STALE_MS = 10 * 60 * 1000;

export interface AlimtalkCandidateProcessResult {
  processed: boolean;
  status: "not_found" | "not_claimed" | "sent" | "skipped" | "failed";
  lastError?: string | null;
  solapiMessageId?: string;
}

export async function processAlimtalkQueue(): Promise<{ processed: number; sent: number; failed: number }> {
  const snap = await refs.alimtalkCandidates().where("status", "in", ["queued", "processing"]).limit(20).get();

  let processed = 0;
  let sent = 0;
  let failed = 0;

  for (const candidateSnap of snap.docs) {
    const claimed = await claimCandidate(candidateSnap.data());
    if (!claimed) continue;
    processed += 1;
    try {
      const sendabilityIssue = await autoSendabilityIssue(claimed, todayKst());
      if (sendabilityIssue) {
        await refs.alimtalkCandidate(claimed.candidateId).set(
          {
            status: "skipped",
            reasonCode: "auto_sendability_blocked",
            lastError: sendabilityIssue,
            updatedAt: nowTimestamp(),
          },
          { merge: true },
        );
        continue;
      }
      const dedupeKey = alimtalkDedupeKey(claimed);
      const dedupePolicy = alimtalkDedupePolicy(claimed.templateCode);
      const duplicate = isAlimtalkTestRecipient(claimed)
        ? ""
        : await findCompletedDuplicateForCandidate(claimed, dedupeKey, dedupePolicy.windowDays);
      if (duplicate) {
        await refs.alimtalkCandidate(claimed.candidateId).set(
          {
            status: "skipped",
            dedupeKey,
            reasonCode: "duplicate_send_blocked",
            lastError: `중복 발송 차단(${dedupePolicy.label}): ${duplicate}`,
            updatedAt: nowTimestamp(),
          },
          { merge: true },
        );
        continue;
      }
      const privateReportIssue = await lockPrivateLessonReportForSend(claimed);
      if (privateReportIssue) {
        await markPrivateLessonReportFailed(claimed, privateReportIssue);
        await refs.alimtalkCandidate(claimed.candidateId).set(
          {
            status: "skipped",
            reasonCode: "private_report_revision_blocked",
            lastError: privateReportIssue,
            updatedAt: nowTimestamp(),
          },
          { merge: true },
        );
        continue;
      }
      const attempts = (claimed.attempts || 0) + 1;
      const result = await sendSolapiAlimtalk(claimed);
      await refs.alimtalkCandidate(claimed.candidateId).set(
        {
          status: "sent",
          dedupeKey,
          attempts,
          maxAttempts: claimed.maxAttempts || 2,
          sentAt: nowTimestamp(),
          lastError: null,
          updatedAt: nowTimestamp(),
        },
        { merge: true },
      );
      await refs.alimtalkSend(claimed.candidateId).set(
        {
          sendId: claimed.candidateId,
          studioId: claimed.studioId,
          candidateId: claimed.candidateId,
          memberId: claimed.memberId,
          memberName: claimed.memberName,
          memberPhone: claimed.memberPhone,
          templateCode: claimed.templateCode,
          dedupeKey,
          dedupePolicy: dedupePolicy.label,
          dedupeWindowDays: dedupePolicy.windowDays,
          status: "done",
          attempts,
          maxAttempts: 1,
          nextRunAt: nowTimestamp(),
          solapiMessageId: result.messageId,
          lastError: null,
          createdByUid: claimed.reviewedByUid || "system",
          createdAt: nowTimestamp(),
          updatedAt: nowTimestamp(),
        },
        { merge: true },
      );
      await markPrivateLessonReportSent(claimed);
      sent += 1;
    } catch (err) {
      const message = errorMessage(err);
      await markPrivateLessonReportFailed(claimed, message);
      const attempts = (claimed.attempts || 0) + 1;
      const maxAttempts = claimed.maxAttempts || 2;
      await refs.alimtalkCandidate(claimed.candidateId).set(
        {
          status: "failed",
          attempts,
          maxAttempts,
          lastError: message,
          updatedAt: nowTimestamp(),
        },
        { merge: true },
      );
      await refs.alimtalkSend(claimed.candidateId).set(
        {
          sendId: claimed.candidateId,
          studioId: claimed.studioId,
          candidateId: claimed.candidateId,
          memberId: claimed.memberId,
          memberName: claimed.memberName,
          memberPhone: claimed.memberPhone,
          templateCode: claimed.templateCode,
          dedupeKey: alimtalkDedupeKey(claimed),
          dedupePolicy: alimtalkDedupePolicy(claimed.templateCode).label,
          dedupeWindowDays: alimtalkDedupePolicy(claimed.templateCode).windowDays,
          status: "failed",
          attempts,
          maxAttempts,
          nextRunAt: nowTimestamp(),
          lastError: message,
          createdByUid: claimed.reviewedByUid || "system",
          createdAt: nowTimestamp(),
          updatedAt: nowTimestamp(),
        },
        { merge: true },
      );
      failed += 1;
      logger.warn("processAlimtalkQueue send failed", {
        candidateId: claimed.candidateId,
        templateCode: claimed.templateCode,
        message,
      });
    }
  }

  logger.info("processAlimtalkQueue completed", { processed, sent, failed });
  return { processed, sent, failed };
}

export async function processAlimtalkCandidate(candidateId: string): Promise<AlimtalkCandidateProcessResult> {
  const snap = await refs.alimtalkCandidate(candidateId).get();
  const candidate = snap.data();
  if (!candidate) return { processed: false, status: "not_found", lastError: "알림톡 후보가 없습니다" };
  const claimed = await claimCandidate(candidate);
  if (!claimed) return { processed: false, status: "not_claimed", lastError: "알림톡 후보를 처리할 수 없습니다" };

  try {
    const sendabilityIssue = await autoSendabilityIssue(claimed, todayKst());
    if (sendabilityIssue) {
      await refs.alimtalkCandidate(claimed.candidateId).set(
        {
          status: "skipped",
          reasonCode: "auto_sendability_blocked",
          lastError: sendabilityIssue,
          updatedAt: nowTimestamp(),
        },
        { merge: true },
      );
      return { processed: true, status: "skipped", lastError: sendabilityIssue };
    }

    const dedupeKey = alimtalkDedupeKey(claimed);
    const dedupePolicy = alimtalkDedupePolicy(claimed.templateCode);
    const duplicate = isAlimtalkTestRecipient(claimed)
      ? ""
      : await findCompletedDuplicateForCandidate(claimed, dedupeKey, dedupePolicy.windowDays);
    if (duplicate) {
      const lastError = `중복 발송 차단(${dedupePolicy.label}): ${duplicate}`;
      await refs.alimtalkCandidate(claimed.candidateId).set(
        {
          status: "skipped",
          dedupeKey,
          reasonCode: "duplicate_send_blocked",
          lastError,
          updatedAt: nowTimestamp(),
        },
        { merge: true },
      );
      return { processed: true, status: "skipped", lastError };
    }

    const privateReportIssue = await lockPrivateLessonReportForSend(claimed);
    if (privateReportIssue) {
      await markPrivateLessonReportFailed(claimed, privateReportIssue);
      await refs.alimtalkCandidate(claimed.candidateId).set(
        {
          status: "skipped",
          reasonCode: "private_report_revision_blocked",
          lastError: privateReportIssue,
          updatedAt: nowTimestamp(),
        },
        { merge: true },
      );
      return { processed: true, status: "skipped", lastError: privateReportIssue };
    }
    const attempts = (claimed.attempts || 0) + 1;
    const result = await sendSolapiAlimtalk(claimed);
    await refs.alimtalkCandidate(claimed.candidateId).set(
      {
        status: "sent",
        dedupeKey,
        attempts,
        maxAttempts: claimed.maxAttempts || 2,
        sentAt: nowTimestamp(),
        lastError: null,
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
    await refs.alimtalkSend(claimed.candidateId).set(
      {
        sendId: claimed.candidateId,
        studioId: claimed.studioId,
        candidateId: claimed.candidateId,
        memberId: claimed.memberId,
        memberName: claimed.memberName,
        memberPhone: claimed.memberPhone,
        templateCode: claimed.templateCode,
        dedupeKey,
        dedupePolicy: dedupePolicy.label,
        dedupeWindowDays: dedupePolicy.windowDays,
        status: "done",
        attempts,
        maxAttempts: claimed.maxAttempts || 2,
        nextRunAt: nowTimestamp(),
        solapiMessageId: result.messageId,
        lastError: null,
        createdByUid: claimed.reviewedByUid || "system",
        createdAt: nowTimestamp(),
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
    await markPrivateLessonReportSent(claimed);
    return { processed: true, status: "sent", solapiMessageId: result.messageId };
  } catch (err) {
    const message = errorMessage(err);
    await markPrivateLessonReportFailed(claimed, message);
    const attempts = (claimed.attempts || 0) + 1;
    const maxAttempts = claimed.maxAttempts || 2;
    await refs.alimtalkCandidate(claimed.candidateId).set(
      {
        status: "failed",
        attempts,
        maxAttempts,
        lastError: message,
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
    await refs.alimtalkSend(claimed.candidateId).set(
      {
        sendId: claimed.candidateId,
        studioId: claimed.studioId,
        candidateId: claimed.candidateId,
        memberId: claimed.memberId,
        memberName: claimed.memberName,
        memberPhone: claimed.memberPhone,
        templateCode: claimed.templateCode,
        dedupeKey: alimtalkDedupeKey(claimed),
        dedupePolicy: alimtalkDedupePolicy(claimed.templateCode).label,
        dedupeWindowDays: alimtalkDedupePolicy(claimed.templateCode).windowDays,
        status: "failed",
        attempts,
        maxAttempts,
        nextRunAt: nowTimestamp(),
        lastError: message,
        createdByUid: claimed.reviewedByUid || "system",
        createdAt: nowTimestamp(),
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
    logger.warn("processAlimtalkCandidate send failed", {
      candidateId: claimed.candidateId,
      templateCode: claimed.templateCode,
      message,
    });
    return { processed: true, status: "failed", lastError: message };
  }
}

async function markPrivateLessonReportSent(candidate: AlimtalkCandidateDoc): Promise<void> {
  if (candidate.type !== "private_lesson_report") return;
  const recordId = String(candidate.payload?.recordId || candidate.sourceActionKey || "").trim();
  const reportRevision = String(candidate.payload?.reportRevision || "").trim();
  const sentAt = nowTimestamp();
  if (recordId) {
    await db.runTransaction(async (tx) => {
      const ref = refs.privateLessonChartRecord(recordId);
      const snap = await tx.get(ref);
      const record = snap.data();
      if (!record) return;
      const snapshot =
        reportRevision && record.approvedReportSnapshot?.revision === reportRevision
          ? record.approvedReportSnapshot
          : record.approvedReportSnapshot || null;
      tx.set(
        ref,
        {
          gptStatus: "published",
          sentRevision: reportRevision || record.approvedRevision || "",
          sentReportSnapshot: snapshot,
          publicReportApproval: {
            ...(record.publicReportApproval || {}),
            status: "sent",
            candidateId: candidate.candidateId,
            sentAt,
            lastError: null,
          },
          updatedAt: sentAt,
        },
        { merge: true },
      );
    });
  }
}

async function lockPrivateLessonReportForSend(candidate: AlimtalkCandidateDoc): Promise<string> {
  if (candidate.type !== "private_lesson_report") return "";
  const recordId = String(candidate.payload?.recordId || candidate.sourceActionKey || "").trim();
  const revision = String(candidate.payload?.reportRevision || "").trim();
  if (!recordId || !revision) return "승인된 리포트 리비전 정보가 없습니다.";
  return db.runTransaction(async (tx) => {
    const candidateRef = refs.alimtalkCandidate(candidate.candidateId);
    const recordRef = refs.privateLessonChartRecord(recordId);
    const requestId = String(candidate.payload?.requestId || recordId);
    const requestRef = refs.privateLessonChartRequest(requestId);
    const [candidateSnap, recordSnap, requestSnap] = await Promise.all([
      tx.get(candidateRef),
      tx.get(recordRef),
      tx.get(requestRef),
    ]);
    const currentCandidate = candidateSnap.data();
    const record = recordSnap.data();
    const chartRequest = requestSnap.data();
    if (currentCandidate?.status !== "processing") return "발송 후보 상태가 변경되었습니다.";
    if (!record || !chartRequest) return "프라이빗 수업 기록을 찾을 수 없습니다.";
    if (chartRequest.status === "cancelled" || chartRequest.cancelledAt) return "취소된 수업입니다.";
    const booking = chartRequest.bookingId ? (await tx.get(refs.booking(chartRequest.bookingId))).data() : undefined;
    if (!booking || booking.appStatus !== "reserved" || /cancel|deleted|inactive/i.test(String(booking.sourceStatus || ""))) {
      return "예약 취소 또는 시간변경 상태를 다시 확인해야 합니다.";
    }
    if (record.approvedRevision !== revision || record.approvedReportSnapshot?.revision !== revision) {
      return "승인본과 발송 후보의 리비전이 다릅니다.";
    }
    if (currentPrivateLessonReportRevision(record) !== revision) {
      return "승인 후 리포트 내용이 변경되었습니다.";
    }
    tx.set(
      recordRef,
      {
        publicReportApproval: {
          ...(record.publicReportApproval || {}),
          status: "processing",
          candidateId: candidate.candidateId,
          lastError: null,
        },
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
    return "";
  });
}

async function markPrivateLessonReportFailed(candidate: AlimtalkCandidateDoc, message: string): Promise<void> {
  if (candidate.type !== "private_lesson_report") return;
  const recordId = String(candidate.payload?.recordId || candidate.sourceActionKey || "").trim();
  if (!recordId) return;
  const record = (await refs.privateLessonChartRecord(recordId).get()).data();
  if (!record || record.publicReportApproval?.status === "sent") return;
  await refs.privateLessonChartRecord(recordId).set(
    {
      publicReportApproval: {
        ...(record.publicReportApproval || {}),
        status: "failed",
        candidateId: candidate.candidateId,
        lastError: message,
      },
      updatedAt: nowTimestamp(),
    },
    { merge: true },
  );
}

async function claimCandidate(candidate: AlimtalkCandidateDoc): Promise<AlimtalkCandidateDoc | null> {
  return db.runTransaction(async (tx) => {
    const ref = refs.alimtalkCandidate(candidate.candidateId);
    const snap = await tx.get(ref);
    const current = snap.data();
    if (!current) return null;
    if (current.status === "processing" && !isStaleProcessing(current)) return null;
    if (!["queued", "processing"].includes(current.status)) return null;
    if ((current.attempts || 0) >= (current.maxAttempts || 2)) {
      tx.set(
        ref,
        {
          status: "failed",
          maxAttempts: current.maxAttempts || 2,
          lastError: current.lastError || "발송 실패 재시도 한도 초과",
          updatedAt: nowTimestamp(),
        },
        { merge: true },
      );
      return null;
    }
    const next = {
      ...current,
      status: "processing" as const,
      attempts: current.attempts || 0,
      maxAttempts: current.maxAttempts || 2,
      updatedAt: nowTimestamp(),
    };
    tx.set(ref, next, { merge: true });
    return next;
  });
}

function isStaleProcessing(candidate: AlimtalkCandidateDoc): boolean {
  const updatedAt = candidate.updatedAt?.toMillis?.() || 0;
  return updatedAt > 0 && Date.now() - updatedAt >= PROCESSING_STALE_MS;
}

async function sendSolapiAlimtalk(candidate: AlimtalkCandidateDoc): Promise<{ messageId: string }> {
  const to = normalizePhone(candidate.memberPhone);
  if (!to) throw new Error("member phone is empty");
  if (!candidate.templateCode) throw new Error("templateCode is empty");
  if (!(await isAlimtalkTemplateApproved(candidate.templateCode)))
    throw new Error(`template is not approved: ${candidate.templateCode}`);

  const variables = await templateVariables(candidate);
  const body = {
    messages: [
      {
        to,
        type: "ATA",
        kakaoOptions: {
          pfId: ALIMTALK_TEMPLATE_CHANNEL_IDS[candidate.templateCode] || solapiPfid.value(),
          templateId: candidate.templateCode,
          disableSms: true,
          variables,
        },
      },
    ],
    strict: true,
    allowDuplicates: false,
    showMessageList: true,
  };

  const response = await fetch(SOLAPI_SEND_URL, {
    method: "POST",
    headers: {
      Authorization: solapiAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => ({}))) as SolapiSendResponse;
  if (!response.ok) {
    throw new Error(result.errorMessage || result.message || `SOLAPI ${response.status}`);
  }
  if (Array.isArray(result.failedMessageList) && result.failedMessageList.length) {
    throw new Error(result.failedMessageList[0]?.statusMessage || "SOLAPI rejected message");
  }
  return {
    messageId: result.messageList?.[0]?.messageId || result.groupInfo?.groupId || "",
  };
}

function solapiAuthHeader(): string {
  const apiKey = solapiApiKey.value();
  const apiSecret = solapiApiSecret.value();
  const dateTime = new Date().toISOString();
  const salt = randomBytes(16).toString("hex");
  const signature = createHmac("sha256", apiSecret)
    .update(dateTime + salt)
    .digest("hex");
  return `HMAC-SHA256 apiKey=${apiKey}, date=${dateTime}, salt=${salt}, signature=${signature}`;
}

async function templateVariables(candidate: AlimtalkCandidateDoc): Promise<Record<string, string>> {
  const payload = candidate.payload || {};
  const memberName = String(payload.memberName || candidate.memberName || "");
  const surveyId = String(payload.surveyId || payload.responseId || "");
  const accessToken = String(payload.accessToken || "");
  const managementNumber = normalizeInstructorLessonManagementNumber(
    String(payload.managementNumber || payload.materialNumber || payload.archiveMethodId || ""),
  );
  const shortLinkId = await shortLinkIdForCandidate(candidate, surveyId, accessToken, managementNumber);
  const reportLinkId = await reportLinkIdForCandidate(candidate);
  const inbodyLinkId = await inbodyLinkIdForCandidate(candidate);
  return {
    "#{이름}": memberName,
    "#{회원명}": String(payload.memberName || candidate.memberName || ""),
    "#{회차}": String(payload.sessionLabel || payload.sessionNumberText || ""),
    "#{수업일시}": String(payload.lessonDateTime || payload.lessonDate || ""),
    "#{강사명}": String(payload.staffName || payload.instructorName || ""),
    "#{예약주차}": String(payload.reservationWeek || payload.weekLabel || ""),
    "#{남은일수}": String(payload.remainingDays || ""),
    "#{수강권명}": String(payload.ticketName || payload.ticket || ""),
    "#{잔여횟수}": String(payload.remainingCount || ""),
    "#{만료일}": String(payload.expiresAt || payload.expiryDate || payload.expireDate || ""),
    "#{미방문일수}": String(payload.absenceDays || payload.daysSinceLastVisit || ""),
    "#{마지막출석일}": String(payload.lastAttendanceDateText || payload.lastAttendanceDate || ""),
    "#{설문ID}": surveyId,
    "#{접근토큰}": accessToken,
    "#{관리번호}": managementNumber,
    "#{링크ID}": shortLinkId,
    "#{리포트링크ID}": reportLinkId,
    "#{인바디링크ID}": inbodyLinkId,
  };
}

async function inbodyLinkIdForCandidate(candidate: AlimtalkCandidateDoc): Promise<string> {
  const existing = String(candidate.payload?.inbodyLinkId || "");
  if (existing) return existing;
  if (candidate.type !== "private_lesson_report") return "";
  const targetUrl = (await latestInbodyReportUrlForCandidate(candidate)) || inbodyNoDataUrl(candidate.memberName);
  const link = await ensureShortLink({
    type: "inbody_report",
    targetUrl,
    sourceId: `${candidate.candidateId}_inbody`,
  });
  await refs.alimtalkCandidate(candidate.candidateId).set(
    {
      payload: {
        ...candidate.payload,
        inbodyLinkId: link.linkId,
        inbodyShortUrl: link.shortUrl,
        inbodyReportUrl: targetUrl,
        inbodyReportStatus: targetUrl.includes("status=no-data") ? "no_data" : "found",
      },
      updatedAt: nowTimestamp(),
    },
    { merge: true },
  );
  return link.linkId;
}

async function latestInbodyReportUrlForCandidate(candidate: AlimtalkCandidateDoc): Promise<string> {
  const explicit = String(candidate.payload?.inbodyReportUrl || candidate.payload?.latestInbodyReportUrl || "");
  if (explicit) return explicit;
  const rows: Array<{ testAtMs: number; memberReportUrl: string }> = [];
  const byMemberId = candidate.memberId
    ? await db.collection("inbodyWebhookEvents").where("matchedMemberId", "==", candidate.memberId).limit(20).get()
    : null;
  for (const doc of byMemberId?.docs || []) {
    const data = doc.data();
    const memberReportUrl = String(data.memberReportUrl || "");
    if (!memberReportUrl || data.memberReportStatus !== "synced") continue;
    rows.push({ testAtMs: data.testAt?.toMillis?.() || 0, memberReportUrl });
  }
  const phone = normalizePhone(candidate.memberPhone);
  const byPhone = phone
    ? await db.collection("inbodyWebhookEvents").where("userToken", "==", phone).limit(20).get()
    : null;
  for (const doc of byPhone?.docs || []) {
    const data = doc.data();
    const memberReportUrl = String(data.memberReportUrl || "");
    if (!memberReportUrl || data.memberReportStatus !== "synced") continue;
    rows.push({ testAtMs: data.testAt?.toMillis?.() || 0, memberReportUrl });
  }
  rows.sort((a, b) => b.testAtMs - a.testAtMs);
  return rows[0]?.memberReportUrl || "";
}

function inbodyNoDataUrl(memberName: string): string {
  const url = new URL("https://in.archivepilates.com/reports/inbody-members/");
  url.searchParams.set("status", "no-data");
  if (memberName) url.searchParams.set("member", memberName);
  return url.toString();
}

async function reportLinkIdForCandidate(candidate: AlimtalkCandidateDoc): Promise<string> {
  const existing = String(candidate.payload?.reportLinkId || "");
  if (existing) return existing;
  const publicReportUrl = String(candidate.payload?.publicReportUrl || "");
  if (!["private_lesson_report", "inbody_report"].includes(candidate.type) || !publicReportUrl) return "";
  const link = await ensureShortLink({
    type: candidate.type === "inbody_report" ? "inbody_report" : "private_report",
    targetUrl: publicReportUrl,
    sourceId: candidate.candidateId,
  });
  await refs.alimtalkCandidate(candidate.candidateId).set(
    {
      payload: { ...candidate.payload, reportLinkId: link.linkId, reportShortUrl: link.shortUrl },
      updatedAt: nowTimestamp(),
    },
    { merge: true },
  );
  return link.linkId;
}

async function shortLinkIdForCandidate(
  candidate: AlimtalkCandidateDoc,
  surveyId: string,
  accessToken: string,
  managementNumber: string,
): Promise<string> {
  const existing = String(candidate.payload?.shortLinkId || "");
  if (candidate.type === "private_survey" && surveyId && accessToken) {
    const link = await ensureShortLink({
      type: "private_survey",
      targetUrl: privateSurveyTargetUrl(surveyId, accessToken),
      sourceId: candidate.candidateId,
    });
    if (!existing) {
      await refs.alimtalkCandidate(candidate.candidateId).set(
        {
          payload: { ...candidate.payload, shortLinkId: link.linkId, shortUrl: link.shortUrl },
          updatedAt: nowTimestamp(),
        },
        { merge: true },
      );
    }
    return link.linkId;
  }
  if (candidate.type === "group_survey" && surveyId && accessToken) {
    const link = await ensureShortLink({
      type: "group_survey",
      targetUrl: groupSurveyTargetUrl(surveyId, accessToken),
      sourceId: candidate.candidateId,
    });
    if (!existing) {
      await refs
        .alimtalkCandidate(candidate.candidateId)
        .set(
          {
            payload: { ...candidate.payload, shortLinkId: link.linkId, shortUrl: link.shortUrl },
            updatedAt: nowTimestamp(),
          },
          { merge: true },
        );
    }
    return link.linkId;
  }
  if (existing) return existing;
  if (candidate.type === "instructor_lesson_material" && managementNumber) {
    const link = await ensureShortLink({
      type: "method_material",
      targetUrl: methodMaterialTargetUrl(managementNumber),
      sourceId: candidate.candidateId,
    });
    await refs
      .alimtalkCandidate(candidate.candidateId)
      .set(
        {
          payload: { ...candidate.payload, shortLinkId: link.linkId, shortUrl: link.shortUrl },
          updatedAt: nowTimestamp(),
        },
        { merge: true },
      );
    return link.linkId;
  }
  return "";
}

function privateSurveyTargetUrl(surveyId: string, accessToken: string): string {
  const url = new URL("https://in.archivepilates.com/privateSurvey");
  url.searchParams.set("id", surveyId);
  url.searchParams.set("token", accessToken);
  return url.toString();
}

function groupSurveyTargetUrl(surveyId: string, accessToken: string): string {
  const url = new URL("https://in.archivepilates.com/groupSurvey");
  url.searchParams.set("id", surveyId);
  url.searchParams.set("token", accessToken);
  return url.toString();
}

function methodMaterialTargetUrl(managementNumber: string): string {
  return `https://in.archivepilates.com/method/${encodeURIComponent(managementNumber)}`;
}

interface SolapiSendResponse {
  message?: string;
  errorMessage?: string;
  failedMessageList?: Array<{ statusMessage?: string }>;
  messageList?: Array<{ messageId?: string }>;
  groupInfo?: { groupId?: string };
}
