import { Timestamp } from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";
import { DEFAULT_STUDIO_ID } from "../config/constants";
import { db } from "../config/firebase";
import type { StaffDoc } from "../types/models";
import { nowTimestamp } from "../utils/date";
import { AppError } from "../utils/errors";
import {
  approvedMealPlanSnapshot,
  cleanRequestId,
  RECOMMENDED_MEAL_DRAFT_COLLECTION,
  RECOMMENDED_MEAL_REPORT_COLLECTION,
  RECOMMENDED_MEAL_REPORT_EXPIRES_DAYS,
  reviewGateIssue,
} from "./recommendedMealProgram";
import { RECOMMENDED_MEAL_REQUEST_COLLECTION } from "./recommendedMealSurvey";

/**
 * Publishes the reviewed plan to the link included in the original survey message.
 * This intentionally does not create a second Alimtalk candidate.
 */
export async function operatorPublishRecommendedMealPlanHandler(
  request: CallableRequest,
  staff: StaffDoc,
): Promise<Record<string, unknown>> {
  const data = request.data && typeof request.data === "object" ? (request.data as Record<string, unknown>) : {};
  const requestId = cleanRequestId(data.requestId);
  if (data.confirmPublish !== true) {
    throw new AppError("INVALID_ARGUMENT", "추천식단 공개 확인이 필요합니다.");
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
    throw new AppError("INVALID_ARGUMENT", "실제 StudioMate 회원 ID 확인 후 공개할 수 있습니다.");
  }
  if (["published", "sent"].includes(String(previousReport?.publicationStatus || ""))) {
    return {
      ok: true,
      status: "published",
      requestId,
      shortUrl: String(mealRequest.reportShortUrl || previousReport?.shortUrl || ""),
    };
  }

  const gateIssue = reviewGateIssue(draft);
  if (gateIssue) throw new AppError("INVALID_ARGUMENT", gateIssue);
  const revision = String(draft.revision || "").trim();
  if (!revision) throw new AppError("INVALID_ARGUMENT", "추천식단 revision이 없습니다.");
  const accessTokenHash = String(mealRequest.accessTokenHash || "").trim();
  if (!/^[a-f0-9]{64}$/i.test(accessTokenHash)) {
    throw new AppError("INVALID_ARGUMENT", "최초 설문 링크의 접근 정보를 확인할 수 없습니다.");
  }

  const snapshot = approvedMealPlanSnapshot(draft);
  const now = nowTimestamp();
  await db.runTransaction(async (transaction) => {
    const draftRef = db.collection(RECOMMENDED_MEAL_DRAFT_COLLECTION).doc(requestId);
    const reportRef = db.collection(RECOMMENDED_MEAL_REPORT_COLLECTION).doc(requestId);
    const requestRef = db.collection(RECOMMENDED_MEAL_REQUEST_COLLECTION).doc(requestId);
    const freshDraft = (await transaction.get(draftRef)).data();
    const freshReport = (await transaction.get(reportRef)).data();
    if (!freshDraft || String(freshDraft.revision || "") !== revision) {
      throw new AppError("INVALID_ARGUMENT", "식단이 변경되었습니다. 다시 확인 후 공개하세요.");
    }
    const freshGateIssue = reviewGateIssue(freshDraft);
    if (freshGateIssue) throw new AppError("INVALID_ARGUMENT", freshGateIssue);
    if (["published", "sent"].includes(String(freshReport?.publicationStatus || ""))) return;

    transaction.set(
      reportRef,
      {
        reportId: requestId,
        requestId,
        studioId: String(mealRequest.studioId || staff.studioId || DEFAULT_STUDIO_ID),
        memberId,
        memberName: String(mealRequest.memberName || "회원").trim(),
        memberPhoneLast4: String(mealRequest.memberPhone || "").replace(/\D/g, "").slice(-4),
        reportRevision: revision,
        approvedRevision: revision,
        publishedRevision: revision,
        approvedSnapshot: snapshot,
        publishedSnapshot: snapshot,
        approvalStatus: "approved",
        publicationStatus: "published",
        accessTokenHash,
        expiresAt: Timestamp.fromMillis(
          Date.now() + RECOMMENDED_MEAL_REPORT_EXPIRES_DAYS * 24 * 60 * 60 * 1000,
        ),
        reportUrl: String(mealRequest.reportUrl || ""),
        shortLinkId: String(mealRequest.reportShortLinkId || ""),
        shortUrl: String(mealRequest.reportShortUrl || ""),
        approvedByUid: staff.uid || "",
        approvedByStaffId: staff.staffId,
        approvedByName: staff.name,
        approvedAt: now,
        publishedByUid: staff.uid || "",
        publishedByStaffId: staff.staffId,
        publishedByName: staff.name,
        publishedAt: now,
        lastError: null,
        updatedAt: now,
        createdAt: freshReport?.createdAt || now,
      },
      { merge: true },
    );
    transaction.set(
      requestRef,
      {
        recommendationStatus: "published",
        reportRevision: revision,
        completedAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
  });

  return {
    ok: true,
    status: "published",
    requestId,
    shortUrl: String(mealRequest.reportShortUrl || ""),
  };
}
