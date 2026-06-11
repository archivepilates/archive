import type { CallableRequest } from "firebase-functions/v2/https";
import { db } from "../config/firebase";
import { DEFAULT_STUDIO_ID } from "../config/constants";
import { refs } from "../firestore/refs";
import type { AlimtalkCandidateDoc, StaffDoc } from "../types/models";
import { nowTimestamp, todayKst } from "../utils/date";
import { AppError } from "../utils/errors";
import { stableHash } from "../utils/hash";
import { alimtalkDedupeKey, findCompletedDuplicateForCandidate, normalizePhone } from "./dedupe";
import { autoSendabilityIssue } from "./eligibility";
import { processAlimtalkCandidate } from "./processAlimtalkQueue";
import { isAlimtalkTemplateApproved } from "./templateStatus";
import { ALIMTALK_TEMPLATES, alimtalkDedupePolicy } from "./templates";

const SETTINGS_DOC_ID = "pricingInquiryAlimtalk";
const REQUEST_COLLECTION = "pricingInquiryAlimtalkRequests";
const DEFAULT_PRICING_URL = "https://archivepilates.notion.site/";

export async function operatorSendPricingInquiryAlimtalkHandler(
  request: CallableRequest,
  staff: StaffDoc,
): Promise<Record<string, unknown>> {
  const data = (request.data || {}) as Record<string, unknown>;
  const phone = normalizePhone(String(data.phone || data.memberPhone || ""));
  if (!/^010\d{8}$/.test(phone)) {
    throw new AppError("INVALID_ARGUMENT", "수강료 안내를 보낼 휴대폰번호를 확인하세요.");
  }
  const memberName = cleanText(String(data.memberName || data.name || "고객"), 24) || "고객";
  const note = cleanText(String(data.note || ""), 240);
  const settings = await pricingInquirySettings();
  if (!settings.templateCode) throw new AppError("INVALID_ARGUMENT", "수강료 안내 템플릿 코드가 없습니다.");
  if (!settings.pricingUrl) throw new AppError("INVALID_ARGUMENT", "수강료 안내 링크가 없습니다.");

  const requestId = `pricing_info_${todayKst()}_${stableHash({ phone, templateCode: settings.templateCode }).slice(0, 12)}`;
  const requestRef = db.collection(REQUEST_COLLECTION).doc(requestId);
  const baseRequest = {
    requestId,
    studioId: staff.studioId || DEFAULT_STUDIO_ID,
    memberName,
    memberPhone: phone,
    note,
    pricingUrl: settings.pricingUrl,
    buttonUrl: settings.pricingUrl,
    templateCode: settings.templateCode,
    requestedByUid: staff.uid || "",
    requestedByStaffId: staff.staffId,
    requestedByName: staff.name,
    updatedAt: nowTimestamp(),
  };

  if (!(await isAlimtalkTemplateApproved(settings.templateCode))) {
    const lastError = `수강료 안내 템플릿 승인 대기: ${settings.templateCode}`;
    await requestRef.set(
      {
        ...baseRequest,
        status: "template_pending",
        lastError,
        createdAt: nowTimestamp(),
      },
      { merge: true },
    );
    return {
      ok: true,
      status: "template_pending",
      requestId,
      templateCode: settings.templateCode,
      buttonUrl: settings.pricingUrl,
      message: lastError,
    };
  }

  const candidate = pricingInfoCandidate({
    requestId,
    studioId: staff.studioId || DEFAULT_STUDIO_ID,
    memberName,
    phone,
    note,
    templateCode: settings.templateCode,
    pricingUrl: settings.pricingUrl,
    staff,
  });
  const issue = await autoSendabilityIssue(candidate, todayKst());
  if (issue) {
    await requestRef.set(
      {
        ...baseRequest,
        status: "failed",
        lastError: issue,
        createdAt: nowTimestamp(),
      },
      { merge: true },
    );
    return { ok: false, status: "failed", requestId, candidateId: candidate.candidateId, message: issue };
  }

  const dedupeKey = alimtalkDedupeKey(candidate);
  const dedupePolicy = alimtalkDedupePolicy(candidate.templateCode);
  const duplicate = await findCompletedDuplicateForCandidate(candidate, dedupeKey, dedupePolicy.windowDays);
  if (duplicate) {
    const lastError = `중복 발송 차단(${dedupePolicy.label}): ${duplicate}`;
    await requestRef.set(
      {
        ...baseRequest,
        status: "skipped",
        candidateId: candidate.candidateId,
        dedupeKey,
        lastError,
        createdAt: nowTimestamp(),
      },
      { merge: true },
    );
    return { ok: true, status: "skipped", requestId, candidateId: candidate.candidateId, message: lastError };
  }

  await refs.alimtalkCandidate(candidate.candidateId).set({ ...candidate, dedupeKey }, { merge: true });
  await requestRef.set(
    {
      ...baseRequest,
      status: "queued",
      candidateId: candidate.candidateId,
      dedupeKey,
      lastError: null,
      createdAt: nowTimestamp(),
    },
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
    buttonUrl: settings.pricingUrl,
    solapiMessageId: result.solapiMessageId || "",
    message: result.lastError || "",
  };
}

async function pricingInquirySettings(): Promise<{ templateCode: string; pricingUrl: string }> {
  const snap = await db.collection("systemSettings").doc(SETTINGS_DOC_ID).get();
  const settings = snap.data() || {};
  return {
    templateCode: String(
      settings.templateCode || process.env.PRICING_INFO_ALIMTALK_TEMPLATE_ID || ALIMTALK_TEMPLATES.pricing_info.code || "",
    ).trim(),
    pricingUrl: String(settings.pricingUrl || DEFAULT_PRICING_URL).trim(),
  };
}

function pricingInfoCandidate(input: {
  requestId: string;
  studioId: string;
  memberName: string;
  phone: string;
  note: string;
  templateCode: string;
  pricingUrl: string;
  staff: StaffDoc;
}): AlimtalkCandidateDoc {
  const candidateId = input.requestId;
  return {
    candidateId,
    studioId: input.studioId,
    memberId: `pricing_lead_${stableHash({ phone: input.phone }).slice(0, 12)}`,
    memberName: input.memberName,
    memberPhone: input.phone,
    type: "pricing_info",
    status: "queued",
    templateCode: input.templateCode,
    title: "수강료 안내",
    reason: "수강료 문의 단건 응답",
    sourceActionKey: input.requestId,
    sourceDate: todayKst(),
    payload: {
      memberName: input.memberName,
      inquiryPhone: input.phone,
      pricingUrl: input.pricingUrl,
      buttonUrl: input.pricingUrl,
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

function cleanText(value: string, maxLength: number): string {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength);
}
