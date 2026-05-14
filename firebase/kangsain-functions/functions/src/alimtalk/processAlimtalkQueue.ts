import { createHmac, randomBytes } from "node:crypto";
import { logger } from "firebase-functions";
import { db } from "../config/firebase";
import { solapiApiKey, solapiApiSecret, solapiPfid } from "../config/secrets";
import { refs } from "../firestore/refs";
import type { AlimtalkCandidateDoc } from "../types/models";
import { errorMessage } from "../utils/errors";
import { nowTimestamp } from "../utils/date";

const SOLAPI_SEND_URL = "https://api.solapi.com/messages/v4/send-many/detail";
const PROCESSING_STALE_MS = 10 * 60 * 1000;
const APPROVED_TEMPLATE_CODES = new Set([
  "KA01TP2605131325462341f8ACO2THW6",
  "KA01TP260514081318309wQGfeIJxIAJ",
]);

export async function processAlimtalkQueue(): Promise<{ processed: number; sent: number; failed: number }> {
  const snap = await refs
    .alimtalkCandidates()
    .where("status", "in", ["queued", "processing"])
    .limit(20)
    .get();

  let processed = 0;
  let sent = 0;
  let failed = 0;

  for (const candidateSnap of snap.docs) {
    const claimed = await claimCandidate(candidateSnap.data());
    if (!claimed) continue;
    processed += 1;
    try {
      const result = await sendSolapiAlimtalk(claimed);
      await refs.alimtalkCandidate(claimed.candidateId).set(
        {
          status: "sent",
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
          status: "done",
          attempts: 1,
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
      sent += 1;
    } catch (err) {
      const message = errorMessage(err);
      await refs.alimtalkCandidate(claimed.candidateId).set(
        {
          status: "failed",
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
          status: "failed",
          attempts: 1,
          maxAttempts: 1,
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

async function claimCandidate(candidate: AlimtalkCandidateDoc): Promise<AlimtalkCandidateDoc | null> {
  return db.runTransaction(async (tx) => {
    const ref = refs.alimtalkCandidate(candidate.candidateId);
    const snap = await tx.get(ref);
    const current = snap.data();
    if (!current) return null;
    if (current.status === "processing" && !isStaleProcessing(current)) return null;
    if (!["queued", "processing"].includes(current.status)) return null;
    const next = {
      ...current,
      status: "processing" as const,
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
  if (!APPROVED_TEMPLATE_CODES.has(candidate.templateCode)) throw new Error(`template is not approved: ${candidate.templateCode}`);

  const body = {
    messages: [
      {
        to,
        type: "ATA",
        kakaoOptions: {
          pfId: solapiPfid.value(),
          templateId: candidate.templateCode,
          disableSms: true,
          variables: templateVariables(candidate),
        },
      },
    ],
    strict: true,
    allowDuplicates: false,
    showMessageList: true,
    agent: {
      appId: "archivein",
      sdkVersion: "archivein-functions/1.0.0",
      osPlatform: "firebase-functions-node22",
    },
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
  const signature = createHmac("sha256", apiSecret).update(dateTime + salt).digest("hex");
  return `HMAC-SHA256 apiKey=${apiKey}, date=${dateTime}, salt=${salt}, signature=${signature}`;
}

function templateVariables(candidate: AlimtalkCandidateDoc): Record<string, string> {
  const payload = candidate.payload || {};
  const memberName = String(payload.memberName || candidate.memberName || "");
  return {
    "#{이름}": memberName,
    "#{예약주차}": String(payload.reservationWeek || payload.weekLabel || ""),
    "#{남은일수}": String(payload.remainingDays || ""),
    "#{수강권명}": String(payload.ticketName || payload.ticket || ""),
    "#{잔여횟수}": String(payload.remainingCount || ""),
    "#{만료일}": String(payload.expiresAt || payload.expiryDate || payload.expireDate || ""),
  };
}

function normalizePhone(value: string): string {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("8210")) return `0${digits.slice(2)}`;
  return digits;
}

interface SolapiSendResponse {
  message?: string;
  errorMessage?: string;
  failedMessageList?: Array<{ statusMessage?: string }>;
  messageList?: Array<{ messageId?: string }>;
  groupInfo?: { groupId?: string };
}
