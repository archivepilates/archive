import { createHmac, randomBytes } from "node:crypto";
import { logger } from "firebase-functions";
import { db } from "../config/firebase";
import { solapiApiKey, solapiApiSecret } from "../config/secrets";
import { nowTimestamp } from "../utils/date";
import type { AlimtalkCandidateDoc } from "../types/models";
import { MEMBERSHIP_AUTOMATION_SETTINGS } from "../memberSignup/membershipWelcomeQueue";
import { holdingQueueOutcomeTerminal, holdingReadyBatch, holdingReadyScopeIssue, holdingWelcomeInteropIssue as welcomeInteropIssue } from "./holdingNoticeScheduling";
import { automaticMemberExclusionReason } from "./recipientExclusion";
import { normalizeRecipientPhone } from "./testRecipients";
import { HOLDING_TEMPLATE, holdingProviderHistory, holdingProviderReceipt, holdingProviderTemplateIssue } from "./holdingNoticeProvider";
import { approveHoldingNotice, candidateKey, dispatchHoldingNotice, holdingAutomationEnabled, holdingMemberFingerprint, queueHoldingNotice,
  HOLDING_NOTICE_SETTINGS, HOLDING_NOTICE_SOURCE_COLLECTION, type HoldingNoticeDependencies } from "./holdingNoticeQueue";

function auth() {
  const date = new Date().toISOString(), salt = randomBytes(16).toString("hex");
  const signature = createHmac("sha256", solapiApiSecret.value()).update(date + salt).digest("hex");
  return `HMAC-SHA256 apiKey=${solapiApiKey.value()}, date=${date}, salt=${salt}, signature=${signature}`;
}
async function providerGet(url: string, timeoutMs = 20_000) {
  const response = await fetch(url, { headers: { Authorization: auth() }, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`holding_provider_read_${response.status}`);
  return response.json();
}
function dependencies(): HoldingNoticeDependencies {
  return {
    db, now: () => new Date(), timestamp: nowTimestamp,
    async verifyRecipientInTransaction(tx, source, member) {
      const staff = await tx.get(db.collection("staffs").where("studioId", "==", source.studioId).where("active", "==", true));
      const welcome = (await tx.get(db.doc(MEMBERSHIP_AUTOMATION_SETTINGS))).data();
      return automaticMemberExclusionReason(member as any, new Set(staff.docs.map(d => normalizeRecipientPhone(d.data().phone || "")))) ||
        welcomeInteropIssue(welcome);
    },
    async loadEvidence(source, candidate) {
      const member = (await db.doc(`memberProfiles/${source.memberId}`).get()).data();
      const base = { recipientIssue: "", templateIssue: "", providerHistoryComplete: false,
        providerDuplicate: true, memberFingerprint: holdingMemberFingerprint(member || {}) };
      const staff = await db.collection("staffs").where("studioId", "==", source.studioId).where("active", "==", true).get();
      base.recipientIssue = automaticMemberExclusionReason((member || {}) as any,
        new Set(staff.docs.map(d => normalizeRecipientPhone(d.data().phone || ""))));
      if (base.recipientIssue) return base;
      base.recipientIssue = welcomeInteropIssue((await db.doc(MEMBERSHIP_AUTOMATION_SETTINGS).get()).data());
      if (base.recipientIssue) return base;
      const config = (await db.doc(HOLDING_NOTICE_SETTINGS).get()).data();
      const coverage = config?.providerHistoryCoverage;
      const coverageVerified = coverage?.verified === true && coverage?.allHoldingVersions === true &&
        coverage?.noRetentionGap === true && typeof coverage.auditId === "string" && !!coverage.auditId &&
        Date.parse(coverage.startAt) <= Date.parse(config?.cutoverAt);
      if (!coverageVerified) return base;
      const deadline = Date.now() + 25_000;
      const boundedGet = (url: string) => {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error("holding_evidence_deadline_exceeded");
        return providerGet(url, Math.min(20_000, remaining));
      };
      // Read all local receipts for this recipient; a truncated result is not complete evidence.
      const receipts = await db.collection("alimtalkSends").where("memberPhone", "==", normalizeRecipientPhone(member?.phone || "")).limit(500).get();
      if (receipts.size === 500) return base;
      const knownReceipts = new Map<string, string>();
      for (const doc of receipts.docs) {
        const data = doc.data();
        if (data.templateCode !== HOLDING_TEMPLATE.templateId) continue;
        if (!data.solapiMessageId || !/^holding_notice_[a-f0-9]{64}$/.test(data.candidateId || "")) continue;
        if (knownReceipts.has(data.solapiMessageId)) return base;
        knownReceipts.set(data.solapiMessageId, data.candidateId);
      }
      const history = await holdingProviderHistory(boundedGet, {
        phone: normalizeRecipientPhone(member?.phone || ""), startAt: coverage.startAt,
        endAt: new Date().toISOString(), coverageVerified, knownReceipts, candidateId: candidate?.candidateId || "",
      });
      base.providerHistoryComplete = history.complete;
      base.providerDuplicate = history.duplicate;
      if (history.complete && !history.duplicate) {
        base.templateIssue = holdingProviderTemplateIssue(await boundedGet(
          `https://api.solapi.com/kakao/v2/templates/${HOLDING_TEMPLATE.templateId}`));
      }
      return base;
    },
  };
}

export async function approveHoldingNoticeForOperator(input: {
  candidateId: string; expectedSnapshot: string; reviewedByUid: string; studioId: string;
}) {
  return approveHoldingNotice(dependencies(), input);
}

/** Opt-in only. No source/member scans while the independent activation gates are closed. */
export async function reconcileHoldingNoticeQueue() {
  if (!holdingAutomationEnabled((await db.doc(HOLDING_NOTICE_SETTINGS).get()).data())) return;
  const sources = await db.collection(HOLDING_NOTICE_SOURCE_COLLECTION).where("noticeStatus", "==", "ready").limit(1).get();
  for (const doc of sources.docs) {
    const source = doc.data();
    const holds = source.noticeEligibleHoldIds;
    if (holdingReadyScopeIssue(holds)) {
      await db.runTransaction(async tx => {
        const current = (await tx.get(doc.ref)).data();
        if (current?.sourceVersion === source.sourceVersion && current?.observedAt === source.observedAt)
          tx.update(doc.ref, { noticeStatus: "review", noticeReason: "holding_event_scope_invalid", noticeCheckedAt: nowTimestamp() });
      });
      continue;
    }
    const outcomes: Awaited<ReturnType<typeof queueHoldingNotice>>[] = [];
    const completed: string[] = [];
    for (const holdId of holdingReadyBatch(holds, source.noticeProgress, source.sourceVersion)) {
      const id = candidateKey(source, holdId);
      const send = await db.doc(`alimtalkSends/${id}`).get();
      const claim = await db.doc(`holdingNoticeClaims/${id}`).get();
      // A prior attempt is terminal for this event, not a reason to stop later events.
      if (send.exists || claim.exists) { completed.push(holdId); continue; }
      const outcome = await queueHoldingNotice(dependencies(), doc.id, holdId);
      outcomes.push(outcome);
      if (holdingQueueOutcomeTerminal(outcome)) completed.push(holdId);
    }
    // Do not consume a newer native observation while recording this reconciliation.
    await db.runTransaction(async tx => {
      const current = (await tx.get(doc.ref)).data();
      if (!current || current.sourceVersion !== source.sourceVersion || current.observedAt !== source.observedAt) return;
      const blocked = outcomes.find(result => !holdingQueueOutcomeTerminal(result));
      const prior = current.noticeProgress?.sourceVersion === source.sourceVersion && Array.isArray(current.noticeProgress.completedHoldIds)
        ? current.noticeProgress.completedHoldIds.filter((id: string) => holds.includes(id)) : [];
      const completedHoldIds = [...new Set<string>([...prior, ...completed])];
      tx.update(doc.ref, { noticeStatus: blocked ? "review" : completedHoldIds.length === holds.length ? "reviewed" : "ready",
        noticeProgress: { sourceVersion: source.sourceVersion, completedHoldIds }, noticeReason: blocked?.reason || "operator_review_required",
        noticeCheckedAt: nowTimestamp() });
    });
    if (outcomes.some(result => !holdingQueueOutcomeTerminal(result))) logger.warn("Holding source needs review", { sourceId: doc.id });
  }
}

export async function sendHoldingNotice(candidate: AlimtalkCandidateDoc) {
  return dispatchHoldingNotice(dependencies(), candidate, async variables => {
    const phone = normalizeRecipientPhone(candidate.memberPhone);
    const startedAt = new Date(Date.now() - 60_000).toISOString();
    const response = await fetch("https://api.solapi.com/messages/v4/send-many/detail", {
      method: "POST", headers: { Authorization: auth(), "Content-Type": "application/json" },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({ messages: [{ to: phone, type: "ATA", kakaoOptions: {
        pfId: HOLDING_TEMPLATE.channelId, templateId: HOLDING_TEMPLATE.templateId, disableSms: true, variables,
      } }], strict: true, allowDuplicates: false, showMessageList: true }),
    });
    if (!response.ok) throw new Error(`holding_provider_send_${response.status}`);
    const receipt = holdingProviderReceipt(await response.json(), phone);
    if (!receipt.identityProven) {
      try {
        const params = new URLSearchParams({ to: phone, startDate: startedAt, endDate: new Date().toISOString(),
          dateType: "CREATED", type: "ATA", limit: "500" });
        const data = await providerGet(`https://api.solapi.com/messages/v4/list?${params}`);
        const row = data?.messageList?.[receipt.messageId];
        if (!row || row.messageId !== receipt.messageId || row.to !== phone ||
          row.kakaoOptions?.templateId !== HOLDING_TEMPLATE.templateId) throw new Error("unverified_receipt");
      } catch {
        throw Object.assign(new Error("holding_provider_receipt_readback_required"), { holdingReceipt: receipt });
      }
    }
    return { messageId: receipt.messageId, groupId: receipt.groupId, variables };
  });
}
