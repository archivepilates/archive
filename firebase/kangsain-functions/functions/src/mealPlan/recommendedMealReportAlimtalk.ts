import { Timestamp } from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";
import { DEFAULT_STUDIO_ID } from "../config/constants";
import { db } from "../config/firebase";
import type { AlimtalkCandidateDoc, StaffDoc } from "../types/models";
import { nowTimestamp, todayKst } from "../utils/date";
import { AppError } from "../utils/errors";
import { ensureShortLink } from "../utils/shortLinks";
import { alimtalkDedupeKey, findCompletedDuplicateForCandidate } from "../alimtalk/dedupe";
import { autoSendabilityIssue } from "../alimtalk/eligibility";
import { processAlimtalkCandidate } from "../alimtalk/processAlimtalkQueue";
import { isAlimtalkTemplateApproved } from "../alimtalk/templateStatus";
import { ALIMTALK_TEMPLATES, alimtalkDedupePolicy } from "../alimtalk/templates";
import {
  approvedMealPlanSnapshot,
  cleanRequestId,
  createRecommendedMealReportAccess,
  RECOMMENDED_MEAL_DRAFT_COLLECTION,
  RECOMMENDED_MEAL_REPORT_COLLECTION,
  RECOMMENDED_MEAL_REPORT_EXPIRES_DAYS,
  recommendedMealReportUrl,
  reviewGateIssue,
} from "./recommendedMealProgram";
import { RECOMMENDED_MEAL_REQUEST_COLLECTION } from "./recommendedMealSurvey";

export async function operatorApproveAndSendRecommendedMealPlanHandler(
  request: CallableRequest,
  staff: StaffDoc,
): Promise<Record<string, unknown>> {
  const data = request.data && typeof request.data === "object" ? (request.data as Record<string, unknown>) : {};
  const requestId = cleanRequestId(data.requestId);
  if (data.confirmSend !== true) {
    throw new AppError("INVALID_ARGUMENT", "회원 발송 확인이 필요합니다.");
  }
  const templateCode = String(ALIMTALK_TEMPLATES.recommended_meal_report.code || "").trim();
  if (!templateCode) {
    return { ok: false, status: "template_pending", requestId, message: "추천식단 도착 템플릿 코드가 없습니다." };
  }
  if (!(await isAlimtalkTemplateApproved(templateCode))) {
    return {
      ok: false,
      status: "template_pending",
      requestId,
      templateCode,
      message: `추천식단 도착 템플릿 승인 대기: ${templateCode}`,
    };
  }

  const [requestSnap, draftSnap, reportSnap] = await Promise.all([
    db.collection(RECOMMENDED_MEAL_REQUEST_COLLECTION).doc(requestId).get(),
    db.collection(RECOMMENDED_MEAL_DRAFT_COLLECTION).doc(requestId).get(),
    db.collection(RECOMMENDED_MEAL_REPORT_COLLECTION).doc(requestId).get(),
  ]);
  const mealRequest = requestSnap.data();
  const draft = draftSnap.data();
  const previousReport = reportSnap.data();
  if (!mealRequest || !draft) throw new AppError("NOT_FOUND", "추천식단 요청 또는 초안을 찾지 못했습니다.");
  if (String(mealRequest.studioId || DEFAULT_STUDIO_ID) !== String(staff.studioId || DEFAULT_STUDIO_ID)) {
    throw new AppError("PERMISSION_DENIED", "다른 지점의 추천식단 요청입니다.");
  }
  const memberId = String(mealRequest.memberId || "").trim();
  if (!memberId || memberId.startsWith("excel_")) {
    throw new AppError("INVALID_ARGUMENT", "실제 StudioMate 회원 ID 확인 후 발송할 수 있습니다.");
  }
  if (previousReport?.publicationStatus === "sent") {
    return { ok: true, status: "sent", requestId, candidateId: String(previousReport.candidateId || "") };
  }
  const gateIssue = reviewGateIssue(draft);
  if (gateIssue) throw new AppError("INVALID_ARGUMENT", gateIssue);
  const revision = String(draft.revision || "").trim();
  if (!revision) throw new AppError("INVALID_ARGUMENT", "추천식단 revision이 없습니다.");

  const access = createRecommendedMealReportAccess();
  const reportUrl = recommendedMealReportUrl(requestId, access.token);
  const shortLink = await ensureShortLink({
    type: "recommended_meal_report",
    targetUrl: reportUrl,
    sourceId: requestId,
  });
  const candidateId = `${requestId}-report-${revision.slice(0, 12)}`;
  const snapshot = approvedMealPlanSnapshot(draft);
  const now = nowTimestamp();
  const candidate: AlimtalkCandidateDoc = {
    candidateId,
    studioId: String(mealRequest.studioId || staff.studioId || DEFAULT_STUDIO_ID),
    memberId,
    memberName: String(mealRequest.memberName || "회원").trim(),
    memberPhone: String(mealRequest.memberPhone || "").replace(/\D/g, ""),
    type: "recommended_meal_report",
    status: "queued",
    templateCode,
    title: "ARCHIVE PILATES 추천식단",
    reason: "운영자 검토·승인 추천식단 발송",
    sourceActionKey: requestId,
    sourceDate: todayKst(),
    payload: {
      memberName: String(mealRequest.memberName || "회원").trim(),
      reportId: requestId,
      reportRevision: revision,
      shortLinkId: shortLink.linkId,
      shortUrl: shortLink.shortUrl,
      approvedByStaffId: staff.staffId,
      approvedByName: staff.name,
    },
    attempts: 0,
    maxAttempts: 1,
    queuedBy: "operator",
    reviewedByUid: staff.uid || "operator",
    reviewedAt: now,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };
  const issue = await autoSendabilityIssue(candidate, todayKst());
  if (issue) throw new AppError("INVALID_ARGUMENT", issue);
  const dedupeKey = alimtalkDedupeKey(candidate);
  const policy = alimtalkDedupePolicy(templateCode);
  const duplicate = await findCompletedDuplicateForCandidate(candidate, dedupeKey, policy.windowDays);
  if (duplicate) {
    return {
      ok: true,
      status: "skipped",
      requestId,
      candidateId,
      message: `중복 발송 차단(${policy.label}): ${duplicate}`,
    };
  }

  await db.runTransaction(async (transaction) => {
    const draftRef = db.collection(RECOMMENDED_MEAL_DRAFT_COLLECTION).doc(requestId);
    const reportRef = db.collection(RECOMMENDED_MEAL_REPORT_COLLECTION).doc(requestId);
    const candidateRef = db.collection("alimtalkCandidates").doc(candidateId);
    const freshDraft = (await transaction.get(draftRef)).data();
    const freshReport = (await transaction.get(reportRef)).data();
    if (!freshDraft || String(freshDraft.revision || "") !== revision) {
      throw new AppError("INVALID_ARGUMENT", "식단이 변경되었습니다. 다시 확인 후 발송하세요.");
    }
    if (reviewGateIssue(freshDraft)) throw new AppError("INVALID_ARGUMENT", reviewGateIssue(freshDraft));
    if (freshReport?.publicationStatus === "sent") return;
    transaction.set(candidateRef, { ...candidate, dedupeKey }, { merge: true });
    transaction.set(
      reportRef,
      {
        reportId: requestId,
        requestId,
        studioId: candidate.studioId,
        memberId,
        memberName: candidate.memberName,
        memberPhoneLast4: candidate.memberPhone.slice(-4),
        reportRevision: revision,
        approvedRevision: revision,
        sentRevision: "",
        approvedSnapshot: snapshot,
        sentSnapshot: null,
        approvalStatus: "approved",
        publicationStatus: "approved",
        accessTokenHash: access.tokenHash,
        expiresAt: Timestamp.fromMillis(Date.now() + RECOMMENDED_MEAL_REPORT_EXPIRES_DAYS * 24 * 60 * 60 * 1000),
        reportUrl,
        shortLinkId: shortLink.linkId,
        shortUrl: shortLink.shortUrl,
        candidateId,
        approvedByUid: staff.uid || "",
        approvedByStaffId: staff.staffId,
        approvedByName: staff.name,
        approvedAt: now,
        lastError: null,
        updatedAt: now,
        createdAt: freshReport?.createdAt || now,
      },
      { merge: true },
    );
    transaction.set(
      db.collection(RECOMMENDED_MEAL_REQUEST_COLLECTION).doc(requestId),
      { recommendationStatus: "approved", reportRevision: revision, candidateId, updatedAt: now },
      { merge: true },
    );
  });

  const result = await processAlimtalkCandidate(candidateId);
  if (result.status !== "sent") {
    await db.collection(RECOMMENDED_MEAL_REPORT_COLLECTION).doc(requestId).set(
      {
        approvalStatus: "approved",
        publicationStatus: result.status === "deferred" ? "approved" : "send_failed",
        lastError: result.lastError || "알림톡 발송 실패",
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
  }
  return {
    ok: result.status === "sent" || result.status === "skipped",
    status: result.status,
    requestId,
    candidateId,
    shortUrl: shortLink.shortUrl,
    solapiMessageId: result.solapiMessageId || "",
    message: result.lastError || "",
  };
}
