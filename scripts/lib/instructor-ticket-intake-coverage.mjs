import {
  INSTRUCTOR_LESSON_TICKET_NAME,
  INSTRUCTOR_LESSON_TICKET_PRICE,
  instructorLessonRegistrationId,
  normalizeInstructorLessonPhone,
} from "./instructor-lesson-registration-contract.mjs";

export const INSTRUCTOR_INTAKE_LIMIT = 501;
export const INSTRUCTOR_INTAKE_DAYS = 120;
export const INSTRUCTOR_INTAKE_MAX_AGE_MINUTES = 95;
const STUDIO_ID = "5330";
const DAY_MS = 86_400_000;
const CHECK_KEY = "instructor-ticket-intake";

export function instructorTicketIntakeBounds(nowMs) {
  if (!Number.isFinite(nowMs)) throw new Error("A valid check time is required.");
  const startDate = new Date(nowMs + 9 * 3_600_000).toISOString().slice(0, 10);
  const endDate = new Date(Date.parse(`${startDate}T00:00:00Z`) + (INSTRUCTOR_INTAKE_DAYS - 1) * DAY_MS)
    .toISOString().slice(0, 10);
  return { studioId: STUDIO_ID, startDate, endDate, days: INSTRUCTOR_INTAKE_DAYS, limit: INSTRUCTOR_INTAKE_LIMIT };
}

// Only canonical collection snapshots enter this comparison. Absence is not delivery evidence.
export function classifyInstructorTicketIntakeCoverage({
  profiles = [], registrations = [], nowMs, sourceEvidence = {}, profileQueryFailed = false,
  registrationQueryFailed = false,
}) {
  const bounds = instructorTicketIntakeBounds(nowMs);
  const profileCoverage = { complete: !profileQueryFailed && profiles.length < bounds.limit,
    size: profiles.length, limit: bounds.limit, queryFailed: Boolean(profileQueryFailed),
    queryScope: "studio5330_activeTicketNames_exact_instructor_2T_holders_only" };
  const registrationCoverage = { complete: !registrationQueryFailed && registrations.length < bounds.limit,
    size: registrations.length, limit: bounds.limit, queryFailed: Boolean(registrationQueryFailed),
    queryScope: "lessonDate_range_all_studios_filtered_to_5330; other_studios_consume_cap" };
  const sourceTime = instant(sourceEvidence.sourceObservedAt);
  const ageMinutes = Number.isFinite(sourceTime) ? (nowMs - sourceTime) / 60_000 : null;
  const sourceFresh = sourceEvidence.latestAttemptSucceeded === true && sourceEvidence.stale === false
    && ageMinutes !== null && ageMinutes >= 0 && ageMinutes <= INSTRUCTOR_INTAKE_MAX_AGE_MINUTES;
  const complete = profileCoverage.complete && registrationCoverage.complete && sourceFresh;
  const rows = profiles.slice(0, bounds.limit).filter(({ data }) => String(data?.studioId) === STUDIO_ID
    && Array.isArray(data.activeTicketNames) && data.activeTicketNames.includes(INSTRUCTOR_LESSON_TICKET_NAME));
  const phoneIdentities = new Map();
  for (const row of rows) {
    const phone = validPhone(row.data.phone);
    if (!phone) continue;
    if (!phoneIdentities.has(phone)) phoneIdentities.set(phone, new Set());
    phoneIdentities.get(phone).add(`${row.id}|${row.data.memberId || row.id}`);
  }
  const registrationGroups = new Map();
  const registrationsById = new Map();
  for (const row of registrations.slice(0, bounds.limit)) {
    const data = row.data || {};
    const phone = validPhone(data.memberPhone);
    if (String(data.studioId) !== STUDIO_ID || !inRange(data.lessonDate, bounds)) continue;
    registrationsById.set(row.id, row);
    if (!phone) continue;
    const key = instructorLessonRegistrationId(STUDIO_ID, phone, data.lessonDate);
    if (!registrationGroups.has(key)) registrationGroups.set(key, []);
    registrationGroups.get(key).push(row);
  }
  const groups = new Map();
  const unbound = [];
  let ignoredTickets = 0;
  let duplicateTickets = 0;
  for (const { id, data } of rows) {
    for (const ticket of Array.isArray(data.activeTickets) ? data.activeTickets : []) {
      if (ticket?.name !== INSTRUCTOR_LESSON_TICKET_NAME) { ignoredTickets++; continue; }
      const date = day(ticket.availableFrom);
      const expiry = day(ticket.expiresAt);
      // Historical instructorLessonDates and ticket-name summaries cannot establish a future ticket.
      if ((date && !inRange(date, bounds)) || (expiry && expiry < bounds.startDate)) { ignoredTickets++; continue; }
      const profileRef = reference("memberProfiles", id);
      const phone = validPhone(data.phone);
      if (!date || !phone) {
        unbound.push({ state: "operator_review", reasons: [!date ? "unsupported_ticket_date" : "invalid_phone"],
          sourceRefs: [profileRef] });
        continue;
      }
      const key = instructorLessonRegistrationId(STUDIO_ID, phone, date);
      if (!groups.has(key)) groups.set(key, { key, phone, date, tickets: [], sourceRefs: new Set() });
      const group = groups.get(key);
      group.sourceRefs.add(profileRef);
      const evidence = { ticket, profile: data, expiry };
      const fingerprint = JSON.stringify([id, ticket]);
      if (group.tickets.some((row) => row.fingerprint === fingerprint)) duplicateTickets++;
      else group.tickets.push({ ...evidence, fingerprint });
    }
  }

  const items = [...unbound];
  for (const group of groups.values()) {
    const byId = registrationsById.get(group.key);
    const matched = [...new Map([...(registrationGroups.get(group.key) || []), ...(byId ? [byId] : [])]
      .map((row) => [row.id, row])).values()];
    const refs = [...group.sourceRefs, ...matched.map(({ id }) => reference("instructorLessonRegistrations", id))];
    const reasons = [];
    const bound = matched.length === 1 && matched[0].id === group.key
      && matched[0].data.registrationId === group.key && validPhone(matched[0].data.memberPhone) === group.phone
      && matched[0].data.lessonDate === group.date && matched[0].data.steps?.member?.status === 'verified'
      && matched[0].data.steps?.ticket?.status === 'verified' && Boolean(numericMemberId(matched[0].data.evidence?.studiomateMemberId));
    const boundRegistration = bound ? matched[0].data : null;
    const complimentary = boundRegistration?.source?.type === 'studiomate_existing_complimentary_ticket_operator'
      && boundRegistration.operatorChecks?.complimentaryConfirmed === true
      && boundRegistration.operatorChecks?.paymentBasis === 'operator_approved_complimentary'
      && boundRegistration.ticketPrice === 0 && boundRegistration.evidence?.ticketPaymentAmount === 0
      && boundRegistration.evidence?.complimentaryApproval?.expectedAmount === 0
      && Boolean(boundRegistration.evidence?.complimentaryApproval?.operationKey)
      && Boolean(boundRegistration.evidence?.complimentaryApproval?.actor);
    const ambiguous = phoneIdentities.get(group.phone)?.size !== 1;
    const cancelled = group.tickets.some(({ ticket }) => cancellation(ticket)) || matched.some(({ data }) => cancellation(data));
    if (ambiguous) reasons.push("ambiguous_same_phone_identity");
    if (cancelled) reasons.push("cancelled_or_cancellation_pending");
    if (group.tickets.length > 1) reasons.push("multiple_ticket_evidence");
    for (const { ticket, profile, expiry } of group.tickets) {
      if (expiry !== group.date) reasons.push("unsupported_ticket_date_range");
      if (!complimentary && (profile.isStaff === true || profile.staffId || /staff|직원|스태프|스텝/i.test(String(profile.memberGrade || "")))) reasons.push("staff_review");
      const amount = ticket.paymentAmount;
      if (amount === 0) { if (!complimentary) reasons.push("zero_payment_review"); }
      else if (typeof amount !== "number" || !Number.isFinite(amount)) reasons.push("payment_source_unknown");
      else if (amount !== INSTRUCTOR_LESSON_TICKET_PRICE || /미수|분납|partial|refund|환불/i.test(String(ticket.paymentType || ""))) reasons.push("unsupported_payment_review");
      if (!/^(사용전|사용중|사용예정|사용 전|사용 중|사용 예정|active|scheduled|available)$/i.test(String(ticket.status || ""))) reasons.push("unsupported_ticket_status");
      if ((!profileNativeMemberId(profile) || profile.profileKind === "reservation_only") && !bound) reasons.push("native_identity_unresolved");
    }
    if (matched.length > 1 || matched.some(({ id, data }) => id !== group.key || data.registrationId !== group.key)) reasons.push("noncanonical_registration_identity");
    if (matched.some(({ data }) => validPhone(data.memberPhone) !== group.phone || data.lessonDate !== group.date)) reasons.push("registration_binding_mismatch");
    if (matched.some(({ data }) => {
      const registrationMemberId = numericMemberId(data.evidence?.studiomateMemberId);
      return registrationMemberId && group.tickets.some(({ profile }) => {
        const profileMemberId = profileNativeMemberId(profile);
        return profileMemberId && registrationMemberId !== profileMemberId;
      });
    })) reasons.push("registration_member_identity_mismatch");
    if (matched.some(({ data }) => data.ticketName !== INSTRUCTOR_LESSON_TICKET_NAME)) reasons.push("unsupported_registration_ticket");
    const registrationState = matched.length ? "present" : registrationCoverage.complete ? "missing" : "unknown_incomplete_query";
    let state = "covered";
    if (ambiguous) state = "ambiguous_identity";
    else if (cancelled) state = "cancelled";
    else if (reasons.length) state = "operator_review";
    else if (!complete) state = "incomplete_source";
    else if (!matched.length) state = "missing_canonical_registration";
    items.push({ state, registrationId: group.key, registrationState, reasons: [...new Set(reasons)],
      sourceRefs: [...new Set([...refs, `instructorLessonRegistrations/${group.key}`])] });
  }
  const counts = {};
  for (const item of items) counts[item.state] = (counts[item.state] || 0) + 1;
  const findings = [];
  if (!complete) findings.push(finding("coverage", "강사레슨 수강권 접수 점검 범위 확인 필요",
    `프로필 조회 완전성=${profileCoverage.complete}, 등록 조회 완전성=${registrationCoverage.complete}, Excel 소스 신선도=${sourceFresh}.`,
    ["memberProfiles", "instructorLessonRegistrations"]));
  const attention = items.filter((item) => item.state !== "covered" && item.state !== "incomplete_source");
  if (attention.length) findings.push(finding("review", "강사레슨 수강권·등록 연결 운영자 확인 필요",
    `등록 원본 누락=${counts.missing_canonical_registration || 0}, 동일 연락처 모호=${counts.ambiguous_identity || 0}, 취소/취소대기=${counts.cancelled || 0}, 기타 검토=${counts.operator_review || 0}.`,
    [...new Set(attention.flatMap((item) => item.sourceRefs))].slice(0, 5)));
  return {
    id: CHECK_KEY, bounds, profileCoverage, registrationCoverage,
    freshness: { fresh: sourceFresh, ageMinutes, maxAgeMinutes: INSTRUCTOR_INTAKE_MAX_AGE_MINUTES,
      basis: "successful_complete_excel_sync_download_not_profile_updatedAt" },
    complete, healthy: complete && !attention.length, counts, duplicateTickets, ignoredTickets, items, findings,
    staffEligibility: "not_verified_from_memberProfiles_only; explicit_staff_requires_review",
    duplicateIdentityScope: "bounded_queried_ticket_holders_only; nonholders_and_unqueried_profiles_not_checked",
    verificationScope: "canonical_snapshot_intake_only_not_live_ticket_payment_staff_or_delivery_verification",
    deliveryVerified: false,
    completedCheckKeys: complete ? [`${CHECK_KEY}:coverage`, `${CHECK_KEY}:review`] : [],
  };
}

function finding(suffix, title, cause, sourceRefs) {
  return { checkKey: `${CHECK_KEY}:${suffix}`, area: "instructor_lessons", severity: "action_required", title, cause,
    impact: "등록 트리거 연결이 누락되었을 수 있으나 미발송·미수신 확정 증거는 아닙니다.",
    suggestedAction: "현재 원본·직원/결제/취소 상태와 기존 요청·발송 이력을 운영자가 확인하세요. 탐지만 수행하며 자동 채택·발송·재시도하지 않습니다.",
    sourceRefs, autoRepairable: false, repairStatus: "not_attempted" };
}

function reference(collection, id) {
  const text = String(id || "");
  return /^[a-zA-Z0-9_-]{1,128}$/.test(text) && !/(?:010\d{8}|8210\d{8})/.test(text) ? `${collection}/${text}` : collection;
}

function validPhone(value) {
  const phone = normalizeInstructorLessonPhone(value);
  return /^010\d{8}$/.test(phone) ? phone : "";
}

function numericMemberId(value) {
  const text = String(value ?? "").trim();
  return /^[1-9]\d{0,15}$/.test(text) ? text : "";
}

function profileNativeMemberId(profile) {
  return numericMemberId(profile.studiomateMemberId) || numericMemberId(profile.memberId);
}

function cancellation(data) {
  return Boolean(data?.cancellation || data?.cancelledAt || data?.canceledAt || data?.refundedAt)
    || /cancel|refund|취소|환불/i.test(String(data?.status || ""));
}

function instant(value) {
  if (value == null || value === "") return NaN;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return typeof value === "number" ? value : Date.parse(value);
}

function day(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const ms = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value ? value : "";
  }
  const ms = instant(value);
  return Number.isFinite(ms) ? new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10) : "";
}

function inRange(date, bounds) {
  return Boolean(day(date) && date >= bounds.startDate && date <= bounds.endDate);
}
