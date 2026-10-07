import { createHash } from "node:crypto";
import { calculateHoldingAllowance, holdingNoticeKey } from "./holding-allowance-notice.mjs";

export const HOLDING_SOURCE = "studiomate_ticket_history_dom";
export const holdingFingerprint = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const numeric = (v) => typeof v === "string" && /^[1-9]\d*$/.test(v);
const digest = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const instant = (v) => typeof v === "string" && Number.isFinite(Date.parse(v));
const required = (ok, message) => { if (!ok) throw new Error(message); };
const clean = (v) => String(v ?? "").trim().replace(/\s+/g, " ");

export function sourceDate(value) {
  const match = clean(value).match(/^(\d{4})[.\-]\s*(\d{1,2})[.\-]\s*(\d{1,2})\.?$/);
  if (!match) throw new Error("invalid_source_date");
  const result = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  required(new Date(`${result}T00:00:00Z`).toISOString().slice(0, 10) === result, "invalid_source_date");
  return result;
}

export function sourceInstant(value) {
  const match = clean(value).match(/^(\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.)\s+(\d{2}:\d{2})(?::(\d{2}))?$/);
  required(match, "invalid_history_timestamp");
  const date = sourceDate(match[1]);
  const result = `${date}T${match[2]}:${match[3] || "00"}+09:00`;
  required(Number.isFinite(Date.parse(result)) && Number(match[2].slice(0,2)) < 24 && Number(match[2].slice(3)) < 60,
    "invalid_history_timestamp");
  return new Date(result).toISOString();
}

export function holdingSourceId({ studioId, memberId, ticketId }) {
  required([studioId, memberId, ticketId].every(numeric), "native_ticket_identity_required");
  return `holding_ticket_${holdingFingerprint([studioId, memberId, ticketId])}`;
}

export function normalizeHoldingObservation(raw) {
  required(raw?.source === HOLDING_SOURCE && [raw.studioId, raw.memberId].every(numeric), "invalid_observation_identity");
  required(raw.memberUrl === `https://arcpilates.studiomate.kr/users/detail?id=${raw.memberId}`, "member_url_mismatch");
  required(instant(raw.observedAt) && raw.historyComplete === true && raw.activeHoldsComplete === true,
    "incomplete_observation");
  required(clean(raw.memberName) && clean(raw.ticketName) && Array.isArray(raw.history) && Array.isArray(raw.activeHolds), "missing_observation_fields");
  const history = raw.history.map((row) => {
    required(row && clean(row.at) && clean(row.staff) && clean(row.type) && Array.isArray(row.changes), "invalid_history_row");
    const changes = row.changes.map((c) => ({ field: clean(c.field), before: clean(c.before), after: clean(c.after) }));
    required(changes.every(c => c.field && c.after) && new Set(changes.map(c => c.field)).size === changes.length, "ambiguous_history_fields");
    const normalized = { at: clean(row.at), staff: clean(row.staff), type: clean(row.type), changes };
    required(Date.parse(sourceInstant(normalized.at)) <= Date.parse(raw.observedAt), "future_history_row");
    return { ...normalized, fingerprint: holdingFingerprint(normalized) };
  });
  required(new Set(history.map(r => r.fingerprint)).size === history.length, "indistinguishable_history_rows_review_required");
  const issuances = history.filter(r => r.type === "발급");
  required(issuances.length === 1, "single_original_issuance_required");
  const issuance = issuances[0];
  const dateField = (field) => {
    const c = issuance.changes.find(c => c.field === field);
    required(c?.before === "내역없음", "original_issuance_not_proven");
    return sourceDate(c.after);
  };
  const start = dateField("이용시작일"), end = dateField("이용종료일");
  const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000 + 1;
  required(Number.isSafeInteger(days) && days > 0, "invalid_original_period");
  const activeHolds = raw.activeHolds.map(h => ({ start: sourceDate(h.start), end: sourceDate(h.end) }));
  required(activeHolds.every(h => h.start <= h.end), "invalid_hold_range");
  activeHolds.sort((a,b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  required(new Set(activeHolds.map(h => JSON.stringify(h))).size === activeHolds.length, "duplicate_live_hold_ranges");
  const body = { source: HOLDING_SOURCE, studioId: raw.studioId, memberId: raw.memberId,
    memberName: clean(raw.memberName), ticketName: clean(raw.ticketName), history, activeHolds };
  return { ...body, observedAt: raw.observedAt, observationFingerprint: holdingFingerprint(body),
    originalPeriod: { days, source: "issuance_record", evidenceRef: `${raw.memberUrl}#issuance-${issuance.fingerprint}` },
    issuanceFingerprint: issuance.fingerprint };
}

// A reconciliation is an explicit operator decision bound to the entire observation.
// Mutable date ranges locate approved evidence; they NEVER become event identities.
export function reconcileHoldingObservation(raw, review, previous = null, now = new Date()) {
  const obs = normalizeHoldingObservation(raw);
  required(review?.schemaVersion === 1 && review.observationFingerprint === obs.observationFingerprint &&
    review.issuanceFingerprint === obs.issuanceFingerprint && numeric(review.ticketId) &&
    clean(review.reviewedBy) && instant(review.reviewedAt) && Date.parse(review.reviewedAt) <= now.getTime() &&
    review.completeHistoryVerified === true && review.nativeTicketBindingVerified === true && Array.isArray(review.holds),
  "observation_bound_identity_review_required");
  required(Date.parse(obs.observedAt) <= now.getTime(), "future_observation");
  const ids = new Set(), consumed = new Set();
  const holdRows = obs.history.filter(r => /정지|홀딩/.test(r.type) || r.changes.some(c => /정지|홀딩/.test(c.field)));
  const holds = review.holds.map(h => {
    required(h && /^(?:hold_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|native_[1-9]\d*)$/.test(h.id) &&
      !ids.has(h.id) && ["registered", "cancelled"].includes(h.status) && h.kind === "member" &&
      digest(h.creationEvidenceFingerprint) && Array.isArray(h.evidenceFingerprints), "invalid_stable_hold_mapping");
    ids.add(h.id);
    const creation = holdRows.find(r => r.fingerprint === h.creationEvidenceFingerprint);
    required(creation && creation.type.replace(/\s/g, "") === "수강권정지", "creation_evidence_required");
    required(h.evidenceFingerprints.includes(creation.fingerprint), "creation_evidence_unmapped");
    for (const fp of h.evidenceFingerprints) {
      required(digest(fp) && !consumed.has(fp) && holdRows.some(r => r.fingerprint === fp), "ambiguous_hold_event_mapping");
      consumed.add(fp);
    }
    if (h.status === "cancelled") required(h.evidenceFingerprints.some(fp =>
      /취소/.test(holdRows.find(r => r.fingerprint === fp)?.type)), "cancel_evidence_required");
    const start = sourceDate(h.start), end = sourceDate(h.end);
    required(start <= end, "invalid_hold_range");
    const lifecycle = h.evidenceFingerprints.map(fp => holdRows.find(r => r.fingerprint === fp))
      .sort((a, b) => sourceInstant(a.at).localeCompare(sourceInstant(b.at)));
    required(lifecycle[0]?.fingerprint === creation.fingerprint &&
      lifecycle.filter(row => row.type.replace(/\s/g, "") === "수강권정지").length === 1,
    "single_hold_creation_per_identity_required");
    const creationStart = creation.changes.find(c => c.field === "정지시작일");
    const creationEnd = creation.changes.find(c => c.field === "정지종료일");
    required(creationStart?.before === "내역없음" && creationEnd?.before === "내역없음", "hold_creation_dates_required");
    let currentStart = sourceDate(creationStart.after), currentEnd = sourceDate(creationEnd.after), cancelled = false;
    for (let index = 1; index < lifecycle.length; index++) {
      const row = lifecycle[index], type = row.type.replace(/\s/g, "");
      required(sourceInstant(row.at) > sourceInstant(lifecycle[index - 1].at) && !cancelled,
        "ambiguous_hold_lifecycle_order");
      required(["수강권정지수정", "수강권정지취소"].includes(type), "unsupported_hold_lifecycle_requires_review");
      for (const change of row.changes) {
        if (change.field === "정지시작일") {
          required(sourceDate(change.before) === currentStart, "hold_date_change_chain_mismatch");
          currentStart = sourceDate(change.after);
        } else if (change.field === "정지종료일") {
          required(sourceDate(change.before) === currentEnd, "hold_date_change_chain_mismatch");
          currentEnd = sourceDate(change.after);
        }
      }
      cancelled = type === "수강권정지취소";
    }
    required(start === currentStart && end === currentEnd, "hold_dates_not_supported_by_history");
    required(cancelled === (h.status === "cancelled"), "hold_lifecycle_status_mismatch");
    return { id: h.id, start, end, status: h.status, kind: h.kind,
      registeredAt: sourceInstant(creation.at),
      creationEvidenceFingerprint: creation.fingerprint, evidenceRef: `${raw.memberUrl}#hold-${creation.fingerprint}` };
  });
  required(consumed.size === holdRows.length, "unmapped_hold_history_requires_review");
  const liveRanges = holds.filter(h => h.status === "registered").map(({start,end}) => ({start,end}))
    .sort((a,b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  required(JSON.stringify(liveRanges) === JSON.stringify(obs.activeHolds), "registered_hold_list_mismatch");
  const identity = { studioId: obs.studioId, memberId: obs.memberId, ticketId: review.ticketId };
  const sourceId = holdingSourceId(identity);
  if (previous) {
    required(previous.sourceId === sourceId && previous.issuanceFingerprint === obs.issuanceFingerprint &&
      previous.originalPeriod?.days === obs.originalPeriod.days && instant(previous.baselineAt) &&
      Array.isArray(previous.baselineHoldIds) && Array.isArray(previous.holds) &&
      Date.parse(obs.observedAt) >= Date.parse(previous.observedAt), "prior_source_binding_conflict");
    for (const old of previous.holds) {
      const current = holds.find(h => h.id === old.id);
      required(current && current.creationEvidenceFingerprint === old.creationEvidenceFingerprint,
        "stable_hold_identity_lost");
      required(!(old.status === "cancelled" && current.status === "registered"), "cancelled_identity_cannot_be_reused");
    }
    for (const current of holds) {
      const old = previous.holds.find(h => h.creationEvidenceFingerprint === current.creationEvidenceFingerprint);
      required(!old || old.id === current.id, "creation_identity_reassigned");
    }
    required(Array.isArray(previous.historyFingerprints) && previous.historyFingerprints.every(fp =>
      obs.history.some(row => row.fingerprint === fp)), "previous_history_disappeared");
  }
  const baselineAt = previous?.baselineAt || obs.observedAt;
  const baselineHoldIds = previous?.baselineHoldIds || holds.map(h => h.id);
  const noticeEligibleHoldIds = holds.filter(h => h.status === "registered" && !baselineHoldIds.includes(h.id) &&
    Date.parse(h.registeredAt) > Date.parse(baselineAt)).map(h => h.id);
  const substantive = { ...identity, memberName: obs.memberName, ticketName: obs.ticketName,
    originalPeriod: obs.originalPeriod, holds, baselineAt, baselineHoldIds, noticeEligibleHoldIds,
    historyFingerprints: obs.history.map(r => r.fingerprint),
    issuanceFingerprint: obs.issuanceFingerprint, observationFingerprint: obs.observationFingerprint };
  const result = { schemaVersion: 1, source: HOLDING_SOURCE, sourceId, ...substantive,
    sourceVersion: holdingFingerprint(substantive), observedAt: obs.observedAt, holdsComplete: true, identityVerified: true,
    noticeStatus: noticeEligibleHoldIds.length ? "ready" : "baseline",
    identityReview: { reviewedBy: review.reviewedBy, reviewedAt: review.reviewedAt,
      observationFingerprint: obs.observationFingerprint } };
  if (previous?.sourceVersion === result.sourceVersion && previous.identityVerified === true &&
    ["reviewed", "baseline"].includes(previous.noticeStatus)) result.noticeStatus = previous.noticeStatus;
  if (previous?.sourceVersion === result.sourceVersion && previous.noticeProgress?.sourceVersion === result.sourceVersion &&
    Array.isArray(previous.noticeProgress.completedHoldIds)) result.noticeProgress = previous.noticeProgress;
  const summary = calculateHoldingAllowance(result);
  required(summary.ok, summary.reason || "calculation_failed");
  return { source: result, summary, candidateKeys: noticeEligibleHoldIds.map(holdId => holdingNoticeKey({ ...identity, holdId })),
    sendAllowed: false, reason: previous ? "shadow_until_source_promotion" : "initial_baseline_no_send" };
}

export function holdingMemberScanDue(profile, prior, now = new Date()) {
  if (!numeric(String(profile?.memberId || "")) || profile?.studioId !== "5330") return false;
  const signature = holdingFingerprint({ active: profile.activeTickets || [], holding: profile.ticketStatusSummary || {} });
  const last = Date.parse(prior?.observedAt || "");
  return !prior || prior.memberTicketFingerprint !== signature || !Number.isFinite(last) ||
    now.getTime() - last >= 86400000 || (profile.ticketStatusSummary?.hasHoldingTicket === true && now.getTime() - last >= 3600000);
}
