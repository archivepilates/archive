import { createHash } from "node:crypto";
import { evaluateMembershipContractEligibility, normalizeMembershipPhone } from "./membershipContractPolicy";

export const MEMBERSHIP_WELCOME_TEMPLATE = {
  templateId: "KA01TP260914091233543JoFDsn7KfCr",
  name: "아카이브 신규회원 가입완료 웰컴 안내 v6",
  referenceTemplateId: "KA01TP260602101939427lPhGyuDLvFM",
  channelId: "KA01PF260511123220162lk0NUjstpVl",
  messageType: "BA",
  emphasizeType: "IMAGE",
  imageId: "ST01FZ260602081207381GWsxSyw1Yo5",
  content:
    "#{이름}님, 아카이브필라테스에 오신 것을 환영합니다.\n\n회원가입 계약서 서명이 완료되었습니다.\n등록하신 수강권으로 수업을 예약하실 수 있습니다.\n\n첫 방문 전 아래 버튼에서 센터 이용안내와 예약방법을 확인해 주세요.\n\n이 안내는 신규 정규회원의 가입 완료 시 1회 발송됩니다.",
  buttons: [
    {
      buttonType: "WL",
      buttonName: "이용안내 보기",
      linkMo: "https://archivepilates.notion.site/archivepilates",
      linkPc: "https://archivepilates.notion.site/archivepilates",
      targetOut: false,
    },
    {
      buttonType: "WL",
      buttonName: "예약방법 보기",
      linkMo: "https://archivepilates.notion.site/studiomate",
      linkPc: "https://archivepilates.notion.site/studiomate",
      targetOut: false,
    },
  ],
};

const text = (v: any) => typeof v === "string" && v.length > 0 && v === v.trim();
const utc = (v: any) =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString() === (v.length === 20 ? v.replace("Z", ".000Z") : v);
const fresh = (at: any, now: number, maxAge: number) =>
  utc(at) && Date.parse(at) <= now && now - Date.parse(at) <= maxAge;

function verifiedSignatureTime(completion: any, selectedMs: number, nowMs: number) {
  if (completion.signatureTimeSource !== "observed_transition") {
    return (
      fresh(completion.signedAt, nowMs, 24 * 3600_000) &&
      Date.parse(completion.signedAt) >= selectedMs &&
      Date.parse(completion.checkedAt) >= Date.parse(completion.signedAt)
    );
  }
  // A date-only UI supports an observed interval, not an invented signing timestamp.
  const interval = completion.signatureObservation;
  if (
    completion.signedAt != null ||
    !interval ||
    !/^\d{4}-\d{2}-\d{2}$/.test(interval.signedDate) ||
    !fresh(interval.draftObservedAt, nowMs, 24 * 3600_000) ||
    !fresh(interval.signedObservedAt, nowMs, 24 * 3600_000) ||
    completion.firstObservedSignedAt !== interval.signedObservedAt
  )
    return false;
  const lower = Date.parse(interval.draftObservedAt);
  const upper = Date.parse(interval.signedObservedAt);
  const dayStart = Date.parse(`${interval.signedDate}T00:00:00+09:00`);
  if (
    !Number.isFinite(dayStart) ||
    new Date(dayStart + 9 * 3600_000).toISOString().slice(0, 10) !== interval.signedDate
  )
    return false;
  return (
    selectedMs <= lower &&
    lower < upper &&
    upper <= Date.parse(completion.checkedAt) &&
    dayStart <= upper &&
    dayStart + 86400_000 > lower
  );
}

export function membershipWelcomeTemplateIssue(template: any, { requireApproved = true } = {}) {
  if (!template || !text(template.templateId)) return "template_missing";
  if (template.templateId === MEMBERSHIP_WELCOME_TEMPLATE.referenceTemplateId)
    return "legacy_signup_template_forbidden";
  if (template.templateId !== MEMBERSHIP_WELCOME_TEMPLATE.templateId) return "template_id_mismatch";
  if (requireApproved && template.status !== "APPROVED") return "template_not_approved";
  for (const key of ["name", "channelId", "messageType", "emphasizeType", "imageId", "content"] as const) {
    if (template[key] !== MEMBERSHIP_WELCOME_TEMPLATE[key]) return `template_${key}_mismatch`;
  }
  const buttons = template.buttons;
  if (!Array.isArray(buttons) || buttons.length !== 2) return "template_buttons_mismatch";
  for (let index = 0; index < 2; index += 1) {
    if (!buttons[index]) return "template_buttons_mismatch";
    for (const [key, value] of Object.entries(MEMBERSHIP_WELCOME_TEMPLATE.buttons[index])) {
      if (buttons[index][key] !== value) return "template_buttons_mismatch";
    }
  }
  if (template.quickReplies != null && (!Array.isArray(template.quickReplies) || template.quickReplies.length))
    return "unexpected_template_quick_replies";
  return "";
}

// Phone/family scope survives member merges, repeat completion events and template versions.
export function membershipWelcomeKey(studioId: any, phone: any) {
  const normalized = normalizeMembershipPhone(phone);
  if (!text(studioId) || !normalized) throw new TypeError("Studio and verified mobile phone required");
  return `membership_welcome_${createHash("sha256")
    .update(JSON.stringify([studioId, "new_member_welcome", normalized]))
    .digest("hex")}`;
}

/**
 * Staged completion hook, no IO and ALWAYS sendAllowed:false until native adapter promotion.
 * selection is immutable, verified pre-contract evidence in the membership-policy schema.
 * completion is a fresh StudioMate contract/member/ticket readback, never a workLane hint.
 * history must combine canonical candidates, sends, old onsite requests and provider ledger
 * across all legacy template versions, phone formats and member aliases (no lookback limit).
 * Only a promoted trusted loader may supply these attestations; JSON input is NOT authority.
 */
export function planMembershipContractWelcome(input: any = {}) {
  const { selection, completion, history, template, now } = input || {};
  const result = (status: string, reason: string, intent: Record<string, any> | null = null) => ({
    status,
    reason,
    eligibleForCandidate: status === "ready",
    sendAllowed: false,
    intent,
  });
  const decision = evaluateMembershipContractEligibility(selection);
  if (!decision.eligibleForDetection) return result("blocked", `contract_${decision.reasons[0]}`);
  if (decision.action !== "first_purchase_contract") return result("excluded", "renewal_no_welcome");
  if (!completion) return result("waiting", "native_member_signature_required");
  if (!utc(now)) return result("review", "invalid_completion_clock");
  const nowMs = Date.parse(now);
  const selectedMs = Date.parse(selection.now);
  const phone = normalizeMembershipPhone(completion.memberPhone);
  if (!Number.isFinite(selectedMs) || selectedMs > nowMs || nowMs - selectedMs > 7 * 86400_000)
    return result("review", "stale_contract_selection");
  if (
    completion.source !== "studiomate_native_contract" ||
    completion.authoritative !== true ||
    !text(completion.contractId) ||
    !text(completion.studioId) ||
    !phone ||
    completion.memberId !== selection.member.memberId ||
    completion.userTicketId !== selection.ticket.userTicketId ||
    completion.productId !== selection.ticket.productId ||
    completion.contractAction !== decision.action ||
    completion.selectionJobKey !== decision.jobKey ||
    !fresh(completion.checkedAt, nowMs, 30 * 60_000)
  )
    return result("review", "unverified_native_completion");
  // Re-read current recipient and issuance exclusions. No staff/test override exists here.
  if (
    completion.memberClassification !== "member" ||
    completion.ticketClassification !== "regular" ||
    completion.currentRecipientEligible !== true ||
    completion.identityVerified !== true ||
    completion.nativePhoneMatchCount !== 1 ||
    completion.currentPhone !== phone ||
    completion.refunded !== false ||
    completion.cancelled !== false ||
    !["active", "scheduled"].includes(completion.ticketStatus)
  )
    return result("excluded", "current_member_or_ticket_ineligible");
  if (completion.status !== "signed" || completion.memberSigned !== true || completion.centerSigned !== true)
    return result("waiting", "native_member_signature_required");
  if (!verifiedSignatureTime(completion, selectedMs, nowMs)) return result("review", "invalid_or_stale_signature_time");
  if (
    !history ||
    history.authoritative !== true ||
    history.complete !== true ||
    history.allVersions !== true ||
    history.allTime !== true ||
    history.memberAliasesComplete !== true ||
    history.providerComplete !== true ||
    history.studioId !== completion.studioId ||
    history.phone !== phone ||
    !fresh(history.checkedAt, nowMs, 30 * 60_000) ||
    Date.parse(history.checkedAt) < Date.parse(completion.checkedAt) ||
    !Array.isArray(history.records)
  )
    return result("review", "complete_welcome_history_required");
  const allowedHistoryStates = new Set([
    "delivered",
    "accepted",
    "queued",
    "sending",
    "unknown",
    "failed",
    "cancelled",
    "skipped",
  ]);
  for (const row of history.records) {
    if (!row || !text(row.id) || row.family !== "new_member_welcome" || !allowedHistoryStates.has(row.status))
      return result("review", "invalid_welcome_history");
    if (["delivered", "accepted"].includes(row.status)) return result("excluded", "welcome_already_sent");
    if (["queued", "sending", "unknown"].includes(row.status)) return result("review", "welcome_pending_or_ambiguous");
    if (row.attempted !== false) return result("review", "previous_welcome_attempt_requires_review");
  }
  const templateIssue = membershipWelcomeTemplateIssue(template);
  if (templateIssue) return result("waiting", templateIssue);
  return result("ready", "first_regular_contract_signed", {
    family: "new_member_welcome",
    trigger: "native_contract_signed",
    type: "membership_welcome",
    memberId: completion.memberId,
    sourceContractId: completion.contractId,
    sourceIssuanceId: completion.userTicketId,
    proposedSourceCollection: "studiomateMembershipContracts",
    templateCode: template.templateId,
    dedupeKey: membershipWelcomeKey(completion.studioId, phone),
    maxAttempts: 1,
    requiredSendPath: "canonical_alimtalk_queue_after_promotion",
  });
}
