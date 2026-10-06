import { createHash } from "node:crypto";

export const HOLDING_NOTICE_TEMPLATE_ID = "KA01TP261006054728079NtSGrYdtSQH";
export const HOLDING_NOTICE_TEMPLATE = {
  name: "수강권 홀딩 현황 안내 v1",
  referenceTemplateId: "KA01TP260914091233543JoFDsn7KfCr",
  channelId: "KA01PF260511123220162lk0NUjstpVl",
  messageType: "BA",
  emphasizeType: "IMAGE",
  imageId: "ST01FZ260602081207381GWsxSyw1Yo5",
  content: "#{이름}님, 수강권 홀딩이 등록되었습니다.\n\n수강권: #{수강권명}\n이번 홀딩: #{홀딩시작일} ~ #{홀딩종료일} (#{이번홀딩일수}일)\n\n전체 홀딩 가능 기간: #{전체홀딩일수}일\n누적 사용 홀딩 기간: #{사용홀딩일수}일\n잔여 홀딩 가능 기간: #{잔여홀딩일수}일\n\n홀딩 가능 기간은 최초 수강권 전체기간의 20%이며 소수점은 버립니다. 누적 사용 기간에는 이번에 등록된 홀딩과 예정된 홀딩이 포함됩니다.\n\n문의사항은 아카이브필라테스로 연락해 주세요.",
  buttons: [],
};

const DAY = 86_400_000;
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const text = (value) => typeof value === "string" && value.trim() === value && value.length > 0;
const nativeId = (value) => typeof value === "string" && /^[1-9]\d*$/.test(value);
const fail = (reason) => ({ ok: false, reason, sendAllowed: false });
function day(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value ? ms / DAY : NaN;
}

// Original duration must be captured from issuance evidence, never extended expiry or product name.
export function calculateHoldingAllowance(snapshot = {}) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return fail("invalid_snapshot");
  const { originalPeriod, holds, holdsComplete } = snapshot;
  if (!originalPeriod || !Number.isSafeInteger(originalPeriod.days) || originalPeriod.days < 1 ||
      !["issuance_record", "signed_contract", "operator_verified_original"].includes(originalPeriod.source) ||
      !text(originalPeriod.evidenceRef)) return fail("verified_original_period_required");
  if (holdsComplete !== true || !Array.isArray(holds)) return fail("complete_hold_history_required");
  const byId = new Map();
  for (const hold of holds) {
    if (!hold || !text(hold.id) || !["registered", "cancelled"].includes(hold.status)) return fail("invalid_hold");
    const previous = byId.get(hold.id);
    if (previous && ["start", "end", "status", "kind"].some((key) => previous[key] !== hold[key])) return fail("conflicting_hold_identity");
    byId.set(hold.id, hold);
  }
  const intervals = [];
  for (const hold of byId.values()) {
    if (hold.status === "cancelled") continue;
    const start = day(hold.start), end = day(hold.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return fail("invalid_hold_dates");
    if (!["member", "center_closure"].includes(hold.kind) || !text(hold.evidenceRef)) return fail("hold_classification_required");
    if (hold.kind === "member") intervals.push([start, end]);
  }
  // Count inclusive calendar dates once, even if source ranges overlap or duplicate.
  intervals.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const range of intervals) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1] + 1) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  const usedDays = merged.reduce((sum, [start, end]) => sum + end - start + 1, 0);
  const totalDays = Math.floor(originalPeriod.days / 5);
  return { ok: true, originalDays: originalPeriod.days, totalDays, usedDays,
    remainingDays: Math.max(0, totalDays - usedDays), overageDays: Math.max(0, usedDays - totalDays) };
}

export function holdingNoticeKey({ studioId, memberId, ticketId, holdId }) {
  if (![studioId, memberId, ticketId].every(nativeId) || !text(holdId)) throw new Error("Native studio/member/ticket and stable hold identity required");
  return `holding_notice_${hash([studioId, memberId, ticketId, holdId])}`;
}

export function holdingTemplateIssue(template, { requireApproved = true } = {}) {
  if (!template || !text(template.templateId)) return "template_missing";
  if (template.templateId !== HOLDING_NOTICE_TEMPLATE_ID) return "template_id_mismatch";
  if (requireApproved && template.status !== "APPROVED") return "template_not_approved";
  for (const field of ["name", "channelId", "messageType", "emphasizeType", "imageId", "content"]) {
    if (template[field] !== HOLDING_NOTICE_TEMPLATE[field]) return `template_${field}_mismatch`;
  }
  if (!Array.isArray(template.buttons) || template.buttons.length ||
      (template.quickReplies != null && (!Array.isArray(template.quickReplies) || template.quickReplies.length))) return "template_buttons_mismatch";
  return "";
}

// This is a shadow planner, NOT a send adapter. Caller-supplied JSON is never production authority.
export function planHoldingNotice(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail("invalid_input");
  const { snapshot, previousHoldIds, history, template } = input;
  if (!snapshot || ![snapshot.studioId, snapshot.memberId, snapshot.ticketId].every(nativeId)) return fail("native_identity_required");
  if (!Array.isArray(previousHoldIds) || previousHoldIds.some((id) => !text(id))) return fail("baseline_required_no_historical_backfill");
  if (!history || history.complete !== true || !Array.isArray(history.keys) ||
      history.keys.some((key) => typeof key !== "string" || !/^holding_notice_[a-f0-9]{64}$/.test(key))) return fail("complete_send_history_required");
  const summary = calculateHoldingAllowance(snapshot);
  if (!summary.ok) return summary;
  const hold = snapshot.holds.find((h) => h.id === snapshot.currentHoldId && h.status === "registered" && h.kind === "member");
  if (!hold) return fail("registered_member_hold_required");
  if (snapshot.holds.some((h) => h.id !== hold.id && h.status === "registered" && h.kind === "member" &&
      day(h.start) <= day(hold.end) && day(hold.start) <= day(h.end))) return fail("overlapping_event_identity_review_required");
  const key = holdingNoticeKey({ ...snapshot, holdId: hold.id });
  if (history.keys.includes(key)) return fail("duplicate_candidate_or_send");
  if (previousHoldIds.includes(hold.id)) return fail("existing_hold_no_automatic_resend");
  const issue = holdingTemplateIssue(template);
  if (issue) return fail(issue);
  if (!text(snapshot.memberName) || !text(snapshot.ticketName)) return fail("member_and_ticket_names_required");
  const variables = {
    "#{이름}": snapshot.memberName, "#{수강권명}": snapshot.ticketName,
    "#{홀딩시작일}": hold.start, "#{홀딩종료일}": hold.end,
    "#{이번홀딩일수}": String(day(hold.end) - day(hold.start) + 1),
    "#{전체홀딩일수}": String(summary.totalDays), "#{사용홀딩일수}": String(summary.usedDays),
    "#{잔여홀딩일수}": String(summary.remainingDays),
  };
  return { ok: true, mode: "shadow", sendAllowed: false, reason: "canonical_adapter_promotion_required",
    key, summary, variables, message: HOLDING_NOTICE_TEMPLATE.content.replace(/#\{[^}]+\}/g, (key) => variables[key]) };
}
