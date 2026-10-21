import { createHash, timingSafeEqual } from "node:crypto";
import type { Firestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import type { AlimtalkCandidateDoc } from "../types/models";
import { stableHash } from "../utils/hash";
import { normalizeRecipientPhone } from "./testRecipients";

type Data = Record<string, any>;
type Dependencies = { db: Firestore; timestamp(): unknown };
const REQUESTS = { pricing_info: "pricingInquiryAlimtalkRequests", recommended_meal_survey: "recommendedMealProgramRequests" };
const QUIET_REASONS = new Set(["member_dispatch_quiet_hours", "invalid_member_dispatch_clock"]);
const cursors = new WeakMap<Firestore, Map<string, QueryDocumentSnapshot>>();
const validId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(value);
const text = (value: unknown): value is string => typeof value === "string" && !!value && value.trim() === value;

function target(candidate: Data): { requestId: string; path: string } | null {
  const collection = REQUESTS[candidate.type as keyof typeof REQUESTS];
  if (!collection) return null;
  const requestId = candidate.sourceActionKey;
  if (!validId(requestId) || !validId(candidate.candidateId)) return null;
  return { requestId, path: `${collection}/${requestId}` };
}

function httpsUrl(value: unknown): boolean {
  if (!text(value)) return false;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
}

function tokenMatches(token: unknown, expected: unknown): boolean {
  if (typeof token !== "string" || !/^[a-f0-9]{48}$/i.test(token) ||
    typeof expected !== "string" || !/^[a-f0-9]{64}$/.test(expected)) return false;
  return timingSafeEqual(createHash("sha256").update(token).digest(), Buffer.from(expected, "hex"));
}

function requestBindingIssue(candidate: Data, request: Data | undefined): string {
  const binding = target(candidate);
  const phone = normalizeRecipientPhone(candidate.memberPhone || "");
  if (!binding || !request || request.requestId !== binding.requestId || request.candidateId !== candidate.candidateId ||
    !text(candidate.studioId) || request.studioId !== candidate.studioId || !/^010\d{8}$/.test(phone) ||
    normalizeRecipientPhone(request.memberPhone || "") !== phone || request.memberName !== candidate.memberName ||
    !text(candidate.templateCode) || request.templateCode !== candidate.templateCode) return "member_dispatch_request_binding_mismatch";
  const payload = candidate.payload || {};
  if (candidate.type === "pricing_info") {
    if (candidate.candidateId !== binding.requestId ||
      candidate.memberId !== `pricing_lead_${stableHash({ phone }).slice(0, 12)}` ||
      (request.memberId != null && request.memberId !== candidate.memberId) ||
      !httpsUrl(request.pricingUrl) || request.pricingUrl !== request.buttonUrl ||
      payload.pricingUrl !== request.pricingUrl || payload.buttonUrl !== request.buttonUrl)
      return "pricing_dispatch_request_binding_mismatch";
  } else {
    if (!text(candidate.memberId) || request.memberId !== candidate.memberId || candidate.candidateId !== `${binding.requestId}-invite` ||
      payload.surveyId !== binding.requestId || !tokenMatches(payload.accessToken, request.accessTokenHash))
      return "meal_dispatch_request_binding_mismatch";
    const surveyUrl = new URL("https://in.archivepilates.com/recommendedMealSurvey/");
    surveyUrl.searchParams.set("id", binding.requestId); surveyUrl.searchParams.set("token", payload.accessToken);
    if (request.surveyUrl !== surveyUrl.toString() || payload.surveyUrl !== request.surveyUrl ||
      !validId(request.shortLinkId) || payload.shortLinkId !== request.shortLinkId ||
      request.shortUrl !== `https://in.archivepilates.com/s/${encodeURIComponent(request.shortLinkId)}/` || payload.shortUrl !== request.shortUrl ||
      !validId(request.reportShortLinkId) || payload.reportLinkId !== request.reportShortLinkId ||
      !httpsUrl(request.reportUrl) || payload.reportUrl !== request.reportUrl ||
      request.reportShortUrl !== `https://in.archivepilates.com/s/${encodeURIComponent(request.reportShortLinkId)}/` ||
      payload.reportShortUrl !== request.reportShortUrl) return "meal_dispatch_request_link_mismatch";
    const report = new URL(request.reportUrl);
    if (report.origin !== "https://in.archivepilates.com" || report.pathname !== "/recommendedMealPlan/" ||
      report.searchParams.get("id") !== binding.requestId || report.searchParams.get("token") !== payload.accessToken ||
      [...report.searchParams.keys()].length !== 2 || report.hash) return "meal_dispatch_request_link_mismatch";
  }
  return "";
}

function sendBindingIssue(candidate: Data, send: Data): boolean {
  return send.sendId !== candidate.candidateId || send.candidateId !== candidate.candidateId ||
    send.memberId !== candidate.memberId || send.studioId !== candidate.studioId || send.templateCode !== candidate.templateCode ||
    normalizeRecipientPhone(send.memberPhone || "") !== normalizeRecipientPhone(candidate.memberPhone || "");
}

export class MemberDispatchRequestBlockedError extends Error {
  readonly code = "member_dispatch_request_blocked";
}

/** Read-only final source check. A caller's cached request or approval is never authoritative. */
export async function assertMemberDispatchRequestAllowed(deps: Pick<Dependencies, "db">, candidate: AlimtalkCandidateDoc): Promise<void> {
  if (!Object.hasOwn(REQUESTS, candidate.type)) return;
  const binding = target(candidate);
  if (!binding) throw new MemberDispatchRequestBlockedError("member_dispatch_request_identity_invalid");
  await deps.db.runTransaction(async tx => {
    const live = (await tx.get(deps.db.doc(`alimtalkCandidates/${candidate.candidateId}`))).data();
    const request = (await tx.get(deps.db.doc(binding.path))).data();
    const send = (await tx.get(deps.db.doc(`alimtalkSends/${candidate.candidateId}`))).data();
    if (!live || live.status !== "processing" || live.queueLeaseId !== (candidate as Data).queueLeaseId ||
      stableHash([live.memberId, live.memberPhone, live.memberName, live.studioId, live.templateCode, live.type, live.sourceActionKey, live.payload]) !==
      stableHash([candidate.memberId, candidate.memberPhone, candidate.memberName, candidate.studioId, candidate.templateCode, candidate.type, candidate.sourceActionKey, candidate.payload]))
      throw new MemberDispatchRequestBlockedError("member_dispatch_candidate_changed");
    const issue = requestBindingIssue(candidate, request);
    if (issue) throw new MemberDispatchRequestBlockedError(issue);
    if (!request || request.status !== "queued" || request.deleted === true || request.deletedAt || request.cancelledAt || request.submittedAt)
      throw new MemberDispatchRequestBlockedError("member_dispatch_request_not_pending");
    const expires = request.expiresAt?.toMillis?.();
    if ((candidate.type === "recommended_meal_survey" || request.expiresAt != null) &&
      (!Number.isFinite(expires) || expires <= Date.now())) throw new MemberDispatchRequestBlockedError("member_dispatch_request_expired");
    // Any existing outbound row blocks replay here; dedupe/approval checks still run independently.
    if (send) throw new MemberDispatchRequestBlockedError("member_dispatch_request_prior_outbound");
    if (candidate.type === "recommended_meal_survey") {
      for (const [id, type, url, sourceId] of [
        [request.shortLinkId, "recommended_meal_survey", request.surveyUrl, binding.requestId],
        [request.reportShortLinkId, "recommended_meal_report", request.reportUrl, `${binding.requestId}-report`],
      ]) {
        const link = (await tx.get(deps.db.doc(`shortLinks/${id}`))).data();
        if (!link || link.linkId !== id || link.active !== true || link.type !== type || link.targetUrl !== url ||
          !(link.sourceId === sourceId || (Array.isArray(link.sourceIds) && link.sourceIds.includes(sourceId))))
          throw new MemberDispatchRequestBlockedError("member_dispatch_short_link_changed");
      }
    }
  });
}

export type MemberDispatchRequestOutcome = { status: "updated" | "unchanged" | "binding_mismatch" | "not_applicable" };

/** Safe for callable handlers too: reads current canonical state, never trusts a passed send result. */
export async function reconcileMemberDispatchRequestOutcome(deps: Dependencies, candidateId: string,
  expectedRequestPath?: string): Promise<MemberDispatchRequestOutcome> {
  if (!validId(candidateId)) return { status: "not_applicable" };
  return deps.db.runTransaction(async tx => {
    const candidate = (await tx.get(deps.db.doc(`alimtalkCandidates/${candidateId}`))).data();
    if (!candidate || !Object.hasOwn(REQUESTS, candidate.type)) return { status: "not_applicable" };
    const binding = target(candidate);
    if (!binding || (expectedRequestPath && binding.path !== expectedRequestPath)) return { status: "binding_mismatch" };
    const ref = deps.db.doc(binding.path);
    const request = (await tx.get(ref)).data();
    const send = (await tx.get(deps.db.doc(`alimtalkSends/${candidateId}`))).data();
    if (requestBindingIssue(candidate, request) || (send && sendBindingIssue(candidate, send))) return { status: "binding_mismatch" };
    if (!request || !["queued", "submitted"].includes(request.status) || request.deleted === true || request.deletedAt || request.cancelledAt)
      return { status: "unchanged" };
    if (request.solapiMessageId && request.solapiMessageId !== send?.solapiMessageId) return { status: "binding_mismatch" };
    const submitted = candidate.type === "recommended_meal_survey" && (request.status === "submitted" || !!request.submittedAt);
    if (candidate.status === "queued" && QUIET_REASONS.has(candidate.lastError) && !send && !submitted) {
      if (request.lastError === candidate.lastError && request.nextEligibleAt === candidate.nextEligibleAt && request.dispatchStatus === "queued")
        return { status: "unchanged" };
      tx.update(ref, { dispatchStatus: "queued", lastError: candidate.lastError, nextEligibleAt: candidate.nextEligibleAt || null, updatedAt: deps.timestamp() });
      return { status: "updated" };
    }
    if (!["sent", "skipped", "failed"].includes(candidate.status)) return { status: "unchanged" };
    const receipt = typeof send?.solapiMessageId === "string" && send.solapiMessageId.trim() ? send.solapiMessageId : "";
    const accepted = send && (send.status === "done" || /^accepted(?:_|$)/.test(String(send.providerOutcome || "")));
    const unknown = send && (send.providerOutcome === "unknown" || send.status === "processing");
    if (candidate.status === "sent" && (!accepted || !receipt)) return { status: "unchanged" };
    const status = accepted ? candidate.status === "sent" ? "sent" : "accepted" : unknown ? "unknown" : candidate.status;
    if (request.dispatchStatus === status && request.nextEligibleAt == null &&
      (!receipt || request.solapiMessageId === receipt) && !QUIET_REASONS.has(request.lastError)) return { status: "unchanged" };
    const at = deps.timestamp();
    const lastError = ["sent", "accepted"].includes(status) || QUIET_REASONS.has(candidate.lastError) ? null : candidate.lastError || null;
    tx.update(ref, { ...(submitted ? {} : { status, completedAt: at }), dispatchStatus: status,
      dispatchCompletedAt: at, ...(receipt ? { solapiMessageId: receipt } : {}), nextEligibleAt: null,
      dispatchLastError: lastError,
      ...(!submitted ? { lastError } : QUIET_REASONS.has(request.lastError) ? { lastError: null } : {}),
      updatedAt: at });
    return { status: "updated" };
  });
}

/** Two existing single-field queued queries; no new index, trigger, or unbounded member scan. */
export async function reconcileQueuedMemberDispatchRequests(deps: Dependencies): Promise<void> {
  let positions = cursors.get(deps.db);
  if (!positions) { positions = new Map(); cursors.set(deps.db, positions); }
  for (const collection of Object.values(REQUESTS)) {
    let query = deps.db.collection(collection).where("status", "==", "queued").limit(20);
    const cursor = positions.get(collection);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    for (const doc of page.docs) {
      const candidateId = doc.data().candidateId;
      if (validId(candidateId)) await reconcileMemberDispatchRequestOutcome(deps, candidateId, doc.ref.path);
    }
    if (page.docs.length === 20) positions.set(collection, page.docs[19]);
    else positions.delete(collection);
  }
}
