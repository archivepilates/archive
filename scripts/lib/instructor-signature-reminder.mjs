import { createHash } from "node:crypto";
import { contractReminderDispatchWindow } from "./contract-signature-reminder-window.mjs";
import { INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_ID } from "./instructor-lesson-registration-contract.mjs";

export const INSTRUCTOR_SIGNATURE_REMINDER_POLICY = "instructor_signup_signature_reminder_24h_v1";

const DAY_MS = 86_400_000;
const nativeId = value => typeof value === "string" && /^[1-9]\d{0,63}$/.test(value) && value === value.trim();
const jobId = value => typeof value === "string" && /^ilr_[a-f0-9]{24}$/.test(value) && value === value.trim();
const documentId = value => typeof value === "string" && /^[a-f0-9]{32}$/.test(value) && value === value.trim();
const phone = value => typeof value === "string" && /^(?:010\d{8}|01[16789]\d{7,8})$/.test(value) && value === value.trim();
const name = value => typeof value === "string" && value === value.trim()
  && /^[\p{L}\p{M}][\p{L}\p{M} .'-]{0,39}$/u.test(value);
const text = value => typeof value === "string" && value.trim().length > 0
  && value === value.trim() && !/[\x00-\x1f\x7f]/.test(value);
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function instant(value) {
  try {
    if (value instanceof Date) return value.getTime();
    if (typeof value === "string") {
      if (value !== value.trim()
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
      const ms = Date.parse(value);
      // Date.parse normalizes invalid calendar dates such as February 30.
      if (new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== value.slice(0, 10)) return NaN;
      return ms;
    }
    const seconds = value?.seconds ?? value?._seconds;
    const nanos = value?.nanoseconds ?? value?._nanoseconds;
    if (seconds != null || nanos != null) {
      if (!Number.isSafeInteger(seconds) || !Number.isInteger(nanos) || nanos < 0 || nanos >= 1_000_000_000) return NaN;
      // Do not let Timestamp.toDate() truncate a fractional millisecond into early eligibility.
      const ms = seconds * 1000 + Math.ceil(nanos / 1_000_000);
      return Number.isFinite(new Date(ms).getTime()) ? ms : NaN;
    }
    if (value && typeof value.toMillis === "function") {
      const ms = value.toMillis();
      return typeof ms === "number" && Number.isFinite(ms) && Number.isFinite(new Date(ms).getTime()) ? Math.ceil(ms) : NaN;
    }
    if (value && typeof value.toDate === "function") return instant(value.toDate());
  } catch { return NaN; }
  return NaN;
}

function lessonDay(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(instant(`${value}T00:00:00Z`));
}

function held(row) {
  return row?.baselineOnly === true || row?.sendAllowed === false || Boolean(row?.cancellation)
    || Boolean(row?.externalOrderReviewRequired) || row?.reviewRequired === true || row?.cancelled === true || row?.refunded === true
    || row?.completed === true || row?.signed === true
    || ["cancelledAt", "canceledAt", "refundedAt", "completedAt", "signedAt", "completion", "signatureReceipt"]
      .some(key => row?.[key] != null);
}

function safeDeferral(row, plan) {
  if (!row || row.policy !== INSTRUCTOR_SIGNATURE_REMINDER_POLICY || row.key !== plan.key
    || row.fingerprint !== plan.fingerprint || row.status !== "deferred" || row.attempts !== 0
    || row.deferredBeforeTransport !== true || row.dispatchStarted === true || row.externalEffectStarted === true
    || row.sendOutcomeUnknown === true
    || ["smsId", "acceptedAt", "sentAt", "deliveredAt", "providerMessageId", "providerGroupId", "providerRequestId", "providerReceipt", "receipt",
      "transportStartedAt", "sendStartedAt", "sendClickedAt", "providerPostStartedAt"]
      .some(key => row[key] != null)) return false;
  if (row.providerPostCount != null && row.providerPostCount !== 0) return false;
  if (row.deferrals != null && (!Array.isArray(row.deferrals)
    || row.deferrals.some(proof => proof?.providerPostCount !== 0))) return false;
  const proof = row.deferrals?.at(-1);
  const boundProof = proof != null && typeof row.dispatchToken === "string"
    && row.dispatchToken.length > 0 && Number.isFinite(instant(row.attemptedAt))
    && proof.dispatchToken === row.dispatchToken && proof.attemptedAt === row.attemptedAt
    && proof.fingerprint === plan.fingerprint && proof.providerPostCount === 0;
  if (proof != null && !boundProof) return false;
  return row.providerPostCount === 0 || boundProof;
}

/** Pure selection only: callers must read eformsignInstructorMemberJobs/<id>, never a mirror. */
export function planInstructorSignatureReminder({ id, job, registration, now = new Date() } = {}) {
  const skip = reason => ({ status: "skipped", reason });
  const ms = instant(now);
  if (!Number.isFinite(ms)) return skip("invalid_clock");
  if (!jobId(id) || job?.jobId !== id || job.registrationId !== id || job.studioId !== "5330"
    || !nativeId(job.studiomateMemberId) || !name(job.memberName) || !phone(job.memberPhone)
    || !documentId(job.documentId) || !text(job.documentName) || !text(job.ticketName)
    || (job.templateId != null && job.templateId !== INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_ID)) return skip("invalid_source");
  if (held(job) || !["sent", "waiting_completion"].includes(job.status)) return skip("job_not_waiting");
  if (registration?.registrationId !== id || (registration.id != null && registration.id !== id)
    || registration.studioId !== job.studioId || registration.memberName !== job.memberName
    || registration.memberPhone !== job.memberPhone || registration.evidence?.studiomateMemberId !== job.studiomateMemberId
    || registration.evidence?.eformsignDocumentId !== job.documentId
    || (registration.studiomateMemberId != null && registration.studiomateMemberId !== job.studiomateMemberId)
    || (registration.ticketName != null && registration.ticketName !== job.ticketName)) return skip("registration_binding_mismatch");
  if (held(registration) || registration.status !== "waiting_signature" || registration.steps?.ticket?.status !== "verified"
    || !["sent", "waiting_external", "waiting_completion"].includes(registration.steps?.eformsign?.status)) return skip("registration_not_waiting");
  if (!lessonDay(job.lessonDate) || registration.lessonDate !== job.lessonDate
    || job.lessonDate < new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10)) return skip("lesson_not_current");
  const sent = instant(job.sentAt), clicked = instant(job.sendClickedAt);
  if (!Number.isFinite(sent) || !Number.isFinite(clicked) || clicked > sent || sent > ms
    || job.externalEffectStarted !== false) return skip("original_send_unverified");

  const key = `instructor_signature_reminder_${job.documentId}`;
  const smsTitle = "ARCHIVE PILATES 강사회원 가입서 작성 안내";
  const smsMessage = `[ARCHIVE PILATES] ${job.memberName}님, 강사회원 가입서 작성이 아직 완료되지 않았습니다.\n이전에 보내드린 이폼싸인 작성 요청 문자에서 가입서를 확인하고 작성해 주세요.\n문의사항은 센터로 연락해 주세요.`;
  const binding = {
    policy: INSTRUCTOR_SIGNATURE_REMINDER_POLICY, key, jobId: id, registrationId: id,
    documentId: job.documentId, templateId: INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_ID, documentName: job.documentName,
    studioId: job.studioId, memberId: job.studiomateMemberId, memberPhone: job.memberPhone, memberName: job.memberName,
    lessonDate: job.lessonDate, ticketName: job.ticketName,
    sourceBindingHash: digest({ ticketId: registration.evidence.ticketId ?? null,
      source: registration.source ?? null, externalOrder: registration.externalOrder ?? null,
      operatorChecks: registration.operatorChecks ?? null, ticketPrice: job.ticketPrice ?? null,
      paymentAmount: job.paymentAmount ?? null }),
    sentAt: new Date(sent).toISOString(), dueAt: new Date(sent + DAY_MS).toISOString(), smsTitle, smsMessage,
  };
  const plan = { status: "ready", reason: "eligible", ...binding, fingerprint: digest(binding) };
  if (job.signatureReminder != null && !safeDeferral(job.signatureReminder, plan)) return skip("reminder_already_recorded");
  if (ms - sent < DAY_MS) return skip("under_24_hours");
  const window = contractReminderDispatchWindow(ms);
  if (!window.allowed) return { ...skip("outside_send_window"), nextAllowedAt: window.nextAllowedAt };
  return plan;
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

/** No I/O. Call again immediately before claiming/dispatching with fresh source and live reads. */
export function assertInstructorSignatureReminderLive({ job, registration, plan, live, now = new Date() } = {}) {
  const current = planInstructorSignatureReminder({ id: plan?.jobId, job, registration, now });
  if (current.status !== "ready" || Object.keys(current).some(key => current[key] !== plan?.[key])) {
    fail("instructor_signature_reminder_source_unverified");
  }
  const ms = instant(now);
  for (const row of [live, live?.document, live?.member, live?.ticket]) {
    const checked = instant(row?.checkedAt);
    if (!Number.isFinite(checked) || checked > ms || ms - checked > 60_000) {
      fail("instructor_signature_reminder_live_stale");
    }
  }
  const doc = live.document, member = live.member, ticket = live.ticket;
  if (doc.source !== "eformsign_document_status" || doc.verified !== true
    || doc.documentId !== current.documentId || doc.templateId !== current.templateId
    || doc.documentName !== current.documentName || doc.status !== "waiting"
    || doc.recipientName !== current.memberName || doc.recipientPhone !== current.memberPhone || doc.recipientCount !== 1
    || !Number.isFinite(instant(doc.expiresAt)) || instant(doc.expiresAt) <= ms
    || held(doc)) fail("instructor_signature_reminder_document_unverified");
  if (member.verified !== true || member.memberId !== current.memberId || member.name !== current.memberName
    || member.phone !== current.memberPhone || member.memberGrade !== "강사회원" || member.inactive !== false
    || (member.studioId != null && member.studioId !== current.studioId)) fail("instructor_signature_reminder_member_unverified");
  if (ticket.verified !== true || ticket.memberId !== current.memberId || ticket.lessonDate !== current.lessonDate
    || ticket.title !== current.ticketName || ticket.refunded !== false || ticket.cancelled !== false
    || held(ticket) || (ticket.studioId != null && ticket.studioId !== current.studioId)) {
    fail("instructor_signature_reminder_ticket_unverified");
  }
}
