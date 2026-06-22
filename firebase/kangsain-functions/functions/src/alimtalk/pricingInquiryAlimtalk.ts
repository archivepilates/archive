import type { Request, Response } from "express";
import { getAuth } from "firebase-admin/auth";
import { db } from "../config/firebase";
import { DEFAULT_STUDIO_ID } from "../config/constants";
import { refs } from "../firestore/refs";
import type { AlimtalkCandidateDoc } from "../types/models";
import { nowTimestamp, todayKst } from "../utils/date";
import { stableHash } from "../utils/hash";
import { errorMessage } from "../utils/errors";
import { alimtalkDedupeKey, findCompletedDuplicate, normalizePhone } from "./dedupe";
import { autoSendabilityIssue } from "./eligibility";
import { processAlimtalkQueue } from "./processAlimtalkQueue";
import { isAlimtalkTemplateApproved } from "./templateStatus";
import { ALIMTALK_TEMPLATES, alimtalkDedupePolicy } from "./templates";

const SETTINGS_DOC = "pricingInquiryAlimtalk";
const DEFAULT_PRICING_URL = "https://in.archivepilates.com/pricing/";

type PricingInquiryStatus = "sent" | "queued" | "skipped" | "failed" | "template_pending";

export async function pricingInquiryAlimtalkHandler(request: Request, response: Response): Promise<void> {
  setCorsHeaders(response);
  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return;
  }
  if (request.method !== "POST") {
    response.status(405).json({ ok: false, error: "POST만 지원합니다." });
    return;
  }

  try {
    const operator = await verifyOperator(request);
    const body = typeof request.body === "object" && request.body ? request.body : {};
    const phone = normalizePhone(String(body.phone || ""));
    const memberName = normalizeName(String(body.name || body.memberName || ""));
    const note = String(body.note || "").trim().slice(0, 240);
    if (!/^010\d{8}$/.test(phone)) {
      response.status(400).json({ ok: false, error: "010으로 시작하는 휴대폰번호 11자리를 입력하세요." });
      return;
    }

    const settings = await pricingInquirySettings();
    const requestId = `pricing_inquiry_${todayKst()}_${stableHash({ phone, at: Date.now() }).slice(0, 12)}`;
    const requestRef = db.collection("pricingInquiryAlimtalkRequests").doc(requestId);
    const candidate = pricingInquiryCandidate({
      requestId,
      phone,
      memberName,
      note,
      operatorUid: operator.uid,
      operatorEmail: operator.email || "",
      templateCode: settings.templateCode,
      pricingUrl: settings.pricingUrl,
    });

    await requestRef.set(
      {
        requestId,
        status: "received",
        phone,
        memberName,
        note,
        pricingUrl: settings.pricingUrl,
        templateCode: settings.templateCode,
        operatorUid: operator.uid,
        operatorEmail: operator.email || "",
        createdAt: nowTimestamp(),
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );

    if (!settings.templateCode) {
      await markRequest(requestId, "template_pending", "비회원 수강료 안내 템플릿 코드 설정 대기");
      response.json({ ok: true, status: "template_pending", requestId });
      return;
    }
    if (!(await isAlimtalkTemplateApproved(settings.templateCode))) {
      await markRequest(requestId, "template_pending", `비회원 수강료 안내 템플릿 승인 대기: ${settings.templateCode}`);
      response.json({ ok: true, status: "template_pending", requestId });
      return;
    }

    const issue = await autoSendabilityIssue(candidate, todayKst());
    if (issue) {
      await markRequest(requestId, "failed", issue);
      response.status(400).json({ ok: false, status: "failed", requestId, error: issue });
      return;
    }

    const dedupeKey = alimtalkDedupeKey(candidate);
    const duplicate = await findCompletedDuplicate(dedupeKey, alimtalkDedupePolicy(settings.templateCode).windowDays);
    if (duplicate) {
      await markRequest(requestId, "skipped", `중복 발송 차단: ${duplicate}`);
      response.json({ ok: true, status: "skipped", requestId, duplicate });
      return;
    }

    await refs.alimtalkCandidate(candidate.candidateId).set({ ...candidate, dedupeKey }, { merge: true });
    await requestRef.set(
      {
        status: "queued",
        candidateId: candidate.candidateId,
        dedupeKey,
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );

    await processAlimtalkQueue();
    const sentCandidate = (await refs.alimtalkCandidate(candidate.candidateId).get()).data();
    const finalStatus = candidateStatusToRequestStatus(sentCandidate?.status || "queued");
    await markRequest(requestId, finalStatus, sentCandidate?.lastError || null, candidate.candidateId);
    response.json({
      ok: finalStatus !== "failed",
      status: finalStatus,
      requestId,
      candidateId: candidate.candidateId,
      error: sentCandidate?.lastError || null,
    });
  } catch (err) {
    response.status(500).json({ ok: false, error: errorMessage(err) });
  }
}

async function verifyOperator(request: Request): Promise<{ uid: string; email?: string }> {
  const token = String(request.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("운영자 로그인 토큰이 없습니다.");
  return getAuth().verifyIdToken(token);
}

async function pricingInquirySettings(): Promise<{ templateCode: string; pricingUrl: string }> {
  const snap = await db.collection("systemSettings").doc(SETTINGS_DOC).get();
  const data = snap.data() || {};
  return {
    templateCode: String(data.templateCode || process.env.PRICING_INFO_ALIMTALK_TEMPLATE_ID || ALIMTALK_TEMPLATES.pricing_info.code || "").trim(),
    pricingUrl: String(data.pricingUrl || process.env.PRICING_INFO_URL || DEFAULT_PRICING_URL).trim(),
  };
}

function pricingInquiryCandidate(input: {
  requestId: string;
  phone: string;
  memberName: string;
  note: string;
  operatorUid: string;
  operatorEmail: string;
  templateCode: string;
  pricingUrl: string;
}): AlimtalkCandidateDoc {
  const candidateId = `pricing_inquiry_${input.requestId}`;
  return {
    candidateId,
    studioId: DEFAULT_STUDIO_ID,
    memberId: `pricing_inquiry_${input.phone}`,
    memberName: input.memberName,
    memberPhone: input.phone,
    type: "pricing_info",
    status: "queued",
    templateCode: input.templateCode,
    title: "수강료 안내",
    reason: "비회원 수강료 문의 즉시발송",
    sourceActionKey: input.requestId,
    sourceDate: todayKst(),
    payload: {
      memberName: input.memberName,
      inquiryPhone: input.phone,
      pricingUrl: input.pricingUrl,
      note: input.note,
      sourceRequestId: input.requestId,
      operatorUid: input.operatorUid,
      operatorEmail: input.operatorEmail,
    },
    attempts: 0,
    maxAttempts: 1,
    queuedBy: "operator",
    reviewedByUid: input.operatorUid,
    reviewedAt: nowTimestamp(),
    lastError: null,
    createdAt: nowTimestamp(),
    updatedAt: nowTimestamp(),
  };
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 30) || "고객";
}

function candidateStatusToRequestStatus(status: string): PricingInquiryStatus {
  if (status === "sent") return "sent";
  if (status === "skipped") return "skipped";
  if (status === "failed") return "failed";
  return "queued";
}

async function markRequest(
  requestId: string,
  status: PricingInquiryStatus,
  message: string | null,
  candidateId?: string,
): Promise<void> {
  await db
    .collection("pricingInquiryAlimtalkRequests")
    .doc(requestId)
    .set(
      {
        status,
        candidateId: candidateId || null,
        lastError: message,
        completedAt: ["sent", "skipped", "failed", "template_pending"].includes(status) ? nowTimestamp() : null,
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
}

function setCorsHeaders(response: Response): void {
  response.set("Access-Control-Allow-Origin", "*");
  response.set("Access-Control-Allow-Methods", "POST,OPTIONS");
  response.set("Access-Control-Allow-Headers", "Content-Type,Authorization");
  response.set("Access-Control-Max-Age", "3600");
}
