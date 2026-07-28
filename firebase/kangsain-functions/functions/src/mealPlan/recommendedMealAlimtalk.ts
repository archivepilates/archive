import { Timestamp } from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";
import { DEFAULT_STUDIO_ID } from "../config/constants";
import { db } from "../config/firebase";
import { refs } from "../firestore/refs";
import type { AlimtalkCandidateDoc, StaffDoc } from "../types/models";
import { nowTimestamp, todayKst } from "../utils/date";
import { AppError } from "../utils/errors";
import { stableHash } from "../utils/hash";
import { ensureShortLink } from "../utils/shortLinks";
import { alimtalkDedupeKey, findCompletedDuplicateForCandidate, normalizePhone } from "../alimtalk/dedupe";
import { autoSendabilityIssue } from "../alimtalk/eligibility";
import { processAlimtalkCandidate } from "../alimtalk/processAlimtalkQueue";
import { isAlimtalkTemplateApproved } from "../alimtalk/templateStatus";
import { ALIMTALK_TEMPLATES, alimtalkDedupePolicy } from "../alimtalk/templates";
import {
  createRecommendedMealAccessToken,
  findRecommendedMealMember,
  latestRecommendedMealInbodyReference,
  recommendedMealAccessTokenHash,
  RECOMMENDED_MEAL_REQUEST_COLLECTION,
  RECOMMENDED_MEAL_SURVEY_EXPIRES_DAYS,
} from "./recommendedMealSurvey";

const SURVEY_BASE_URL = "https://in.archivepilates.com/recommendedMealSurvey/";

export async function operatorSendRecommendedMealProgramAlimtalkHandler(
  request: CallableRequest,
  staff: StaffDoc,
): Promise<Record<string, unknown>> {
  const data = (request.data || {}) as Record<string, unknown>;
  const phone = normalizePhone(String(data.phone || data.memberPhone || ""));
  if (!/^010\d{8}$/.test(phone)) {
    throw new AppError("INVALID_ARGUMENT", "추천식단 설문을 보낼 휴대폰번호를 확인하세요.");
  }
  const requestedName = cleanText(String(data.memberName || data.name || ""), 24);
  const note = cleanText(String(data.note || ""), 240);
  const member = await findRecommendedMealMember({ phone, memberName: requestedName });
  const templateCode = String(ALIMTALK_TEMPLATES.recommended_meal_survey.code || "").trim();
  if (!templateCode) throw new AppError("INVALID_ARGUMENT", "추천식단 프로그램 알림톡 템플릿 코드가 없습니다.");

  const accessToken = createRecommendedMealAccessToken();
  const requestId = `meal-${todayKst()}-${stableHash({
    phone,
    memberId: member.memberId,
    token: accessToken,
  }).slice(0, 16)}`;
  const surveyUrl = recommendedMealSurveyUrl(requestId, accessToken);
  const shortLink = await ensureShortLink({
    type: "recommended_meal_survey",
    targetUrl: surveyUrl,
    sourceId: requestId,
  });
  const inbody = await latestRecommendedMealInbodyReference(member);
  const requestRef = db.collection(RECOMMENDED_MEAL_REQUEST_COLLECTION).doc(requestId);
  const now = nowTimestamp();
  const baseRequest = {
    requestId,
    studioId: member.studioId || staff.studioId || DEFAULT_STUDIO_ID,
    memberId: member.memberId,
    memberName: member.memberName,
    memberPhone: member.memberPhone,
    memberPhoneLast4: member.memberPhone.slice(-4),
    note,
    templateCode,
    accessTokenHash: recommendedMealAccessTokenHash(accessToken),
    surveyUrl,
    shortLinkId: shortLink.linkId,
    shortUrl: shortLink.shortUrl,
    inbody,
    recommendationStatus: inbody.status === "available" ? "awaiting_survey" : "inbody_required",
    requestedByUid: staff.uid || "",
    requestedByStaffId: staff.staffId,
    requestedByName: staff.name,
    expiresAt: Timestamp.fromMillis(Date.now() + RECOMMENDED_MEAL_SURVEY_EXPIRES_DAYS * 24 * 60 * 60 * 1000),
    updatedAt: now,
    createdAt: now,
  };

  if (!(await isAlimtalkTemplateApproved(templateCode))) {
    const lastError = `추천식단 프로그램 템플릿 승인 대기: ${templateCode}`;
    await requestRef.set({ ...baseRequest, status: "template_pending", lastError }, { merge: true });
    return {
      ok: true,
      status: "template_pending",
      requestId,
      templateCode,
      shortUrl: shortLink.shortUrl,
      message: lastError,
    };
  }

  const candidate = recommendedMealCandidate({
    requestId,
    accessToken,
    templateCode,
    shortLinkId: shortLink.linkId,
    shortUrl: shortLink.shortUrl,
    surveyUrl,
    note,
    member,
    staff,
  });
  const issue = await autoSendabilityIssue(candidate, todayKst());
  if (issue) {
    await requestRef.set({ ...baseRequest, status: "failed", lastError: issue }, { merge: true });
    return { ok: false, status: "failed", requestId, candidateId: candidate.candidateId, message: issue };
  }

  const dedupeKey = alimtalkDedupeKey(candidate);
  const policy = alimtalkDedupePolicy(candidate.templateCode);
  const duplicate = await findCompletedDuplicateForCandidate(candidate, dedupeKey, policy.windowDays);
  if (duplicate) {
    const lastError = `중복 발송 차단(${policy.label}): ${duplicate}`;
    await requestRef.set(
      { ...baseRequest, status: "skipped", candidateId: candidate.candidateId, dedupeKey, lastError },
      { merge: true },
    );
    return { ok: true, status: "skipped", requestId, candidateId: candidate.candidateId, message: lastError };
  }

  await refs.alimtalkCandidate(candidate.candidateId).set({ ...candidate, dedupeKey }, { merge: true });
  await requestRef.set(
    { ...baseRequest, status: "queued", candidateId: candidate.candidateId, dedupeKey, lastError: null },
    { merge: true },
  );
  const result = await processAlimtalkCandidate(candidate.candidateId);
  await requestRef.set(
    {
      status: result.status,
      solapiMessageId: result.solapiMessageId || "",
      lastError: result.lastError || null,
      completedAt: nowTimestamp(),
      updatedAt: nowTimestamp(),
    },
    { merge: true },
  );
  return {
    ok: result.status === "sent" || result.status === "skipped",
    status: result.status,
    requestId,
    candidateId: candidate.candidateId,
    shortUrl: shortLink.shortUrl,
    solapiMessageId: result.solapiMessageId || "",
    message: result.lastError || "",
  };
}

function recommendedMealCandidate(input: {
  requestId: string;
  accessToken: string;
  templateCode: string;
  shortLinkId: string;
  shortUrl: string;
  surveyUrl: string;
  note: string;
  member: {
    memberId: string;
    memberName: string;
    memberPhone: string;
    studioId: string;
  };
  staff: StaffDoc;
}): AlimtalkCandidateDoc {
  return {
    candidateId: `${input.requestId}-invite`,
    studioId: input.member.studioId || input.staff.studioId || DEFAULT_STUDIO_ID,
    memberId: input.member.memberId,
    memberName: input.member.memberName,
    memberPhone: input.member.memberPhone,
    type: "recommended_meal_survey",
    status: "queued",
    templateCode: input.templateCode,
    title: "ARCHIVE 추천식단 프로그램",
    reason: "운영자 승인 추천식단 설문 초대",
    sourceActionKey: input.requestId,
    sourceDate: todayKst(),
    payload: {
      memberName: input.member.memberName,
      surveyId: input.requestId,
      accessToken: input.accessToken,
      shortLinkId: input.shortLinkId,
      shortUrl: input.shortUrl,
      surveyUrl: input.surveyUrl,
      note: input.note,
      requestedByStaffId: input.staff.staffId,
      requestedByName: input.staff.name,
    },
    attempts: 0,
    maxAttempts: 1,
    queuedBy: "operator",
    reviewedByUid: input.staff.uid || "operator",
    reviewedAt: nowTimestamp(),
    lastError: null,
    createdAt: nowTimestamp(),
    updatedAt: nowTimestamp(),
  };
}

function recommendedMealSurveyUrl(requestId: string, accessToken: string): string {
  const url = new URL(SURVEY_BASE_URL);
  url.searchParams.set("id", requestId);
  url.searchParams.set("token", accessToken);
  return url.toString();
}

function cleanText(value: string, maxLength: number): string {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength);
}
