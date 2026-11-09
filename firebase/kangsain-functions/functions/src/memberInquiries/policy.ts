import { createHash } from "node:crypto";
import { memberInquiryContract as contract, memberInquirySchema as schema } from "./contract";
import type { InquiryStatus } from "./contract";

export class InquiryError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export type Actor = { staffId: string; name: string; studioId: string; role: string; active: boolean; memberInquiryAccess?: boolean };
export type InquiryRow = Record<string, any> & { id: string; studioId: string; revision: number; status: InquiryStatus };
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export const hash = (value: unknown): string => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
export function manager(actor: Actor): boolean { return actor.active === true && ["owner", "manager"].includes(actor.role); }
export function assertActor(actor: Actor): void {
  if (!actor.active || actor.studioId !== contract.studioId || !actor.staffId ||
    (!manager(actor) && actor.role !== "instructor"))
    throw new InquiryError(403, "현재 스태프 권한이 필요합니다.");
}
export function assertRead(actor: Actor, row: InquiryRow): void {
  assertActor(actor);
  if (row.studioId !== actor.studioId)
    throw new InquiryError(403, "같은 지점의 문의만 확인할 수 있습니다.");
}
export function text(value: unknown, max: number, required = false): string {
  if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))
    throw new InquiryError(400, "입력 내용을 확인해 주세요.");
  const result = value.trim();
  if (required && !result) throw new InquiryError(400, "필수 내용을 입력해 주세요.");
  return result;
}
export function validateSubmission(body: any) {
  if (!body || typeof body !== "object" || Array.isArray(body) ||
    Object.keys(body).some(key => !["requestKey", "category", "memberName", "memberPhone", "answers", "details", "contact", "privacyConsent", "privacyVersion", "policyVersion", "website"].includes(key)) ||
    typeof body.requestKey !== "string" || !/^[a-f0-9]{48}$/.test(body.requestKey) ||
    !Object.hasOwn(schema, body.category || "") || body.privacyConsent !== true ||
    body.policyVersion !== contract.policyVersion || body.privacyVersion !== contract.privacyVersion || body.website)
    throw new InquiryError(400, "입력 내용과 동의 항목을 확인해 주세요.");
  const memberName = text(body.memberName, 40, true);
  const rawPhone = text(body.memberPhone, 20, true);
  if (!/^[\d+() -]+$/.test(rawPhone)) throw new InquiryError(400, "휴대폰번호를 확인해 주세요.");
  const memberPhone = rawPhone.replace(/[() -]/g, "").replace(/^\+82/, "0");
  if (!/^010\d{8}$/.test(memberPhone)) throw new InquiryError(400, "휴대폰번호를 확인해 주세요.");
  const category = String(body.category), input = body.answers;
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new InquiryError(400, "문의 항목을 선택해 주세요.");
  const questions = schema[category].questions;
  if (Object.keys(input).some(key => !questions.some(q => q.id === key))) throw new InquiryError(400, "문의 항목을 확인해 주세요.");
  const answers: Record<string, string | string[]> = {};
  for (const q of questions) {
    const active = !q.when || (Array.isArray(input[q.when[0]]) ? input[q.when[0]].includes(q.when[1]) : input[q.when[0]] === q.when[1]);
    if (!active) {
      if (input[q.id] !== undefined && input[q.id] !== "" && (!Array.isArray(input[q.id]) || input[q.id].length))
        throw new InquiryError(400, "선택 내용이 바뀌었습니다. 다시 확인해 주세요.");
      continue;
    }
    const value = input[q.id];
    if ((value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) && q.optional) continue;
    if (q.type) {
      const date = text(value, 16, true);
      const valid = q.type === "time" ? /^([01]\d|2[0-3]):[0-5]\d$/.test(date) :
        q.type === "month" ? /^20\d{2}-(0[1-9]|1[0-2])$/.test(date) :
          /^20\d{2}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date + "T00:00:00Z")) && new Date(date + "T00:00:00Z").toISOString().slice(0, 10) === date;
      if (!valid) throw new InquiryError(400, "날짜·시간을 확인해 주세요.");
      answers[q.id] = date;
    } else if (q.multiple) {
      if (!Array.isArray(value) || value.length < 1 || value.length > (q.options?.length || 0) ||
        new Set(value).size !== value.length || value.some(v => !q.options?.includes(v)) ||
        (value.includes("상담 후 결정") && value.length > 1)) throw new InquiryError(400, "해당하는 보기를 선택해 주세요.");
      answers[q.id] = [...value].sort();
    } else {
      if (typeof value !== "string" || !q.options?.includes(value)) throw new InquiryError(400, "해당하는 보기를 선택해 주세요.");
      answers[q.id] = value;
    }
  }
  if (!["카카오톡", "문자", "전화", "상관없어요"].includes(body.contact)) throw new InquiryError(400, "답변 방법을 선택해 주세요.");
  return { category, memberName, memberPhone, answers, contact: String(body.contact), details: text(body.details ?? "", 200),
    policyVersion: contract.policyVersion, privacyVersion: contract.privacyVersion, privacyConsent: true };
}
export function fixedException(row: InquiryRow): boolean {
  return (row.category === "booking" && row.answers?.mode === "고정예약" && ["수업 취소", "다른 수업으로 변경"].includes(row.answers?.request)) ||
    (row.category === "fixed" && row.answers?.request === "취소·변경 예외 상담");
}
export function planHash(row: InquiryRow, review: any): string {
  return hash([contract.policyVersion, row.id, row.category, row.answers, row.details, row.memberName, row.memberPhone, review]);
}
export function transition(row: InquiryRow, actor: Actor, input: any, now: string): Record<string, any> {
  assertRead(actor, row);
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision !== row.revision)
    throw new InquiryError(409, "다른 변경이 있습니다. 새로 조회해 주세요.");
  if (row.status === "completed") throw new InquiryError(409, "완료된 문의는 수정할 수 없습니다.");
  const base: Record<string, any> = { revision: row.revision + 1, updatedAt: now };
  if (input.action === "claim") {
    if (row.assignedStaffId && row.assignedStaffId !== actor.staffId && !manager(actor)) throw new InquiryError(403, "담당 문의만 처리할 수 있습니다.");
    return { ...base, assignedStaffId: actor.staffId, assignedStaffName: actor.name, status: row.status === "received" ? "in_review" : row.status };
  }
  if (!manager(actor) && row.assignedStaffId !== actor.staffId)
    throw new InquiryError(403, "먼저 담당자로 지정한 문의만 처리할 수 있습니다.");
  if (input.action === "review") {
    if (!["guidance", "manual_processing", "exception_review"].includes(input.resolutionKind) ||
      !["within_policy", "exception", "insufficient"].includes(input.policyFit)) throw new InquiryError(400, "검토 구분을 선택해 주세요.");
    if (fixedException(row) && (input.policyFit !== "exception" || input.resolutionKind !== "exception_review"))
      throw new InquiryError(400, "고정예약 취소·변경 요청은 예외 검토로 제출해 주세요.");
    if (row.category === "conversion" && input.policyFit === "within_policy") throw new InquiryError(400, "수강권 전환 기준은 관리자 검토가 필요합니다.");
    const review = { resolutionKind: input.resolutionKind, policyFit: input.policyFit,
      plan: text(input.plan, 2000, true), memberReply: text(input.memberReply, 1500, true),
      internalNote: text(input.internalNote ?? "", 1000), policyVersion: contract.policyVersion };
    return { ...base, status: "awaiting_approval", assignedStaffId: row.assignedStaffId || actor.staffId,
      assignedStaffName: row.assignedStaffName || actor.name, review, reviewHash: planHash(row, review),
      reviewedBy: actor.staffId, reviewedAt: now, approval: null, completion: null };
  }
  if (["approve", "reject", "needs_information"].includes(input.action)) {
    if (!manager(actor)) throw new InquiryError(403, "관리자만 승인할 수 있습니다.");
    if (row.status !== "awaiting_approval" || !row.reviewHash || input.expectedReviewHash !== row.reviewHash ||
      planHash(row, row.review) !== row.reviewHash || row.review?.policyVersion !== contract.policyVersion)
      throw new InquiryError(409, "처리안이 변경되었습니다. 다시 검토해 주세요.");
    const reason = text(input.reason ?? "", 1000, input.action !== "approve" || fixedException(row));
    return { ...base, status: input.action === "approve" ? "approved" : input.action === "reject" ? "rejected" : "needs_information",
      approval: { decision: input.action, reviewHash: row.reviewHash, by: actor.staffId, name: actor.name, at: now, reason,
        scope: "inquiry_plan_only", externalExecutionAuthorized: false }, completion: null };
  }
  if (input.action === "complete") {
    if (row.status !== "approved" || row.approval?.decision !== "approve" || row.approval.reviewHash !== row.reviewHash ||
      input.expectedReviewHash !== row.reviewHash || planHash(row, row.review) !== row.reviewHash)
      throw new InquiryError(409, "현재 처리안의 관리자 승인이 필요합니다.");
    return { ...base, status: "completed", completion: { by: actor.staffId, at: now,
      note: text(input.completionNote, 1500, true), evidence: text(input.evidence, 500, true),
      recordedManually: true, providerSendVerified: false }, memberNotificationStatus: "not_sent_by_system" };
  }
  throw new InquiryError(400, "지원하지 않는 처리입니다.");
}
