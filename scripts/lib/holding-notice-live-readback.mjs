import { calculateHoldingAllowance } from "./holding-allowance-notice.mjs";
import { normalizeHoldingObservation, sourceDate, sourceInstant } from "./studiomate-holding-source.mjs";

const requireEvidence = (ok, reason) => { if (!ok) throw new Error(reason); };
const kstDay = at => new Date(Date.parse(at) + 9 * 3600000).toISOString().slice(0, 10);

/** Recalculate from the current rendered ticket, never a prior balance or persisted hold ledger. */
export function calculateLiveHolding(raw, { creationEvidenceFingerprint, now = new Date() } = {}) {
  const observation = normalizeHoldingObservation(raw);
  const age = now.getTime() - Date.parse(observation.observedAt);
  requireEvidence(Number.isFinite(age) && age >= 0 && age <= 120000, "fresh_live_ticket_required");
  const events = [];
  const history = observation.history.filter(row => /정지|홀딩/.test(row.type) || row.changes.some(c => /정지|홀딩/.test(c.field)))
    .sort((a, b) => sourceInstant(a.at).localeCompare(sourceInstant(b.at)));
  for (const row of history) {
    const type = row.type.replace(/\s/g, ""), at = sourceInstant(row.at);
    if (type === "수강권정지") {
      const start = row.changes.find(c => c.field === "정지시작일"), end = row.changes.find(c => c.field === "정지종료일");
      requireEvidence(start?.before === "내역없음" && end?.before === "내역없음", "live_hold_creation_required");
      events.push({ id: row.fingerprint, creationEvidenceFingerprint: row.fingerprint, registeredAt: at,
        start: sourceDate(start.after), end: sourceDate(end.after), cancelledAt: null });
      continue;
    }
    requireEvidence(["수강권정지수정", "수강권정지취소"].includes(type), "unsupported_live_hold_change");
    const changes = row.changes.filter(c => /정지|홀딩/.test(c.field));
    requireEvidence(changes.every(c => ["정지시작일", "정지종료일"].includes(c.field)), "unsupported_live_hold_field");
    const candidates = events.filter(event => !event.cancelledAt && event.registeredAt < at &&
      (changes.length ? changes.every(c => sourceDate(c.before) === event[c.field === "정지시작일" ? "start" : "end"])
        : event.end >= kstDay(at)));
    requireEvidence(candidates.length === 1, "ambiguous_live_hold_change");
    const event = candidates[0];
    if (type === "수강권정지취소") {
      event.cancelledAt = at;
    } else {
      requireEvidence(changes.length > 0, "live_hold_edit_dates_required");
      for (const c of changes) event[c.field === "정지시작일" ? "start" : "end"] = sourceDate(c.after);
    }
    requireEvidence(event.start <= event.end, "invalid_live_hold_range");
  }
  const unmatched = new Set(observation.activeHolds.map((_, index) => index)), holds = [];
  for (const event of events) {
    const indexes = [...unmatched].filter(index => {
      const range = observation.activeHolds[index];
      return range.start === event.start && range.end <= event.end;
    });
    requireEvidence(indexes.length <= 1, "ambiguous_live_hold_range");
    const index = indexes[0], range = index === undefined ? null : observation.activeHolds[index];
    if (!range) {
      // A cancellation after the start is NOT proof that all consumed days were refunded.
      requireEvidence(event.cancelledAt && kstDay(event.cancelledAt) < event.start, "early_release_actual_period_required");
      continue;
    }
    requireEvidence(events.filter(other => other.start === range.start && range.end <= other.end).length === 1,
      "ambiguous_live_hold_identity");
    if (range.end < event.end || event.cancelledAt)
      requireEvidence(range.end <= kstDay(event.cancelledAt || observation.observedAt), "early_release_range_not_effective");
    unmatched.delete(index);
    holds.push({ ...event, ...range, status: "registered", kind: "member",
      evidenceRef: `${raw.memberUrl}#live-hold-${event.id}` });
  }
  requireEvidence(unmatched.size === 0, "live_hold_without_creation_evidence");
  const summary = calculateHoldingAllowance({ originalPeriod: observation.originalPeriod, holds, holdsComplete: true });
  requireEvidence(summary.ok, summary.reason);
  const currentHold = raw.currentHold ? { start: sourceDate(raw.currentHold.start), end: sourceDate(raw.currentHold.end) } : null;
  const selected = creationEvidenceFingerprint ? holds.find(hold => hold.id === creationEvidenceFingerprint) : null;
  if (creationEvidenceFingerprint) {
    requireEvidence(selected && !selected.cancelledAt && currentHold && selected.start === currentHold.start && selected.end === currentHold.end,
      "selected_hold_not_current_saved_controls");
    requireEvidence(!holds.some(hold => hold.id !== selected.id && hold.start <= selected.end && selected.start <= hold.end),
      "overlapping_live_hold_identity");
    requireEvidence(!summary.overageDays, "holding_allowance_overage");
  }
  return { observation, summary, holds, selected, currentHold, calculationMode: "live_studiomate_readback" };
}

export async function verifyHoldingAtDispatch(plan, readLatest, calculatePlan, now = () => new Date()) {
  requireEvidence(typeof readLatest === "function", "live_ticket_reader_required_at_dispatch");
  const started = now().getTime();
  const raw = await readLatest({ memberId: plan.memberId, ticketName: plan.sourceEvidence.ticketName });
  requireEvidence(Date.parse(raw.observedAt) >= started, "post_request_live_readback_required");
  const fresh = calculatePlan(raw, { memberId: plan.memberId, name: plan.memberName, phone: plan.memberPhone, studioId: plan.studioId }, plan.approval, now());
  requireEvidence(fresh.id === plan.id && fresh.observationFingerprint === plan.observationFingerprint &&
    JSON.stringify(fresh.variables) === JSON.stringify(plan.variables), "live_ticket_changed_reapproval_required");
  return structuredClone(fresh);
}
