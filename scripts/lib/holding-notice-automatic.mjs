import { HOLDING_NOTICE_TEMPLATE_ID } from "./holding-allowance-notice.mjs";
import { calculateLiveHolding } from "./holding-notice-live-readback.mjs";
import { normalizeHoldingObservation, sourceInstant } from "./studiomate-holding-source.mjs";

export const HOLDING_AUTO_MODE = "live_readback_auto";
export const HOLDING_AUTO_EVENTS = "holdingNoticeEvents";
export const HOLDING_AUTO_POLICY = "holding_new_registrations_20261008";
export const HOLDING_AUTO_CUTOVER = "2026-10-07T15:00:00.000Z";

export function holdingAutomaticConfigIssue(config, now = new Date()) {
  if (config?.mode !== HOLDING_AUTO_MODE || config.autoSendEnabled !== true || config.canonicalSourcePromoted !== true ||
      config.calculationMode !== "live_studiomate_readback" || config.sourceScanEnabled !== true ||
      config.rosterDiscoveryEnabled !== true || config.studioId !== "5330" ||
      config.templateId !== HOLDING_NOTICE_TEMPLATE_ID || config.automaticPolicyId !== HOLDING_AUTO_POLICY ||
      config.cutoverAt !== HOLDING_AUTO_CUTOVER || config.automaticSourceCollection !== HOLDING_AUTO_EVENTS ||
      config.nativeE2eVerified !== true || !/^[a-f0-9]{40}$/.test(config.activationCommit || "") || !config.baselineInitializedAt ||
      !Number.isFinite(now.getTime()) ||
      !Number.isFinite(Date.parse(config.baselineInitializedAt)) || Date.parse(config.baselineInitializedAt) >= Date.parse(config.cutoverAt))
    return "holding_automatic_configuration_required";
  return now.getTime() < Date.parse(config.cutoverAt) ? "holding_cutover_not_reached" : "";
}

/** Discovery only chooses reads. Fresh native creation evidence establishes the canonical event. */
export function automaticHoldingEvidence(raw, config, now = new Date()) {
  const issue = holdingAutomaticConfigIssue(config, now);
  if (issue) throw new Error(issue);
  const observed = normalizeHoldingObservation(raw);
  if (!observed.history.some(row => row.type.replace(/\s/g, "") === "수강권정지" &&
      Date.parse(sourceInstant(row.at)) >= Date.parse(config.cutoverAt)))
    throw new Error("holding_historical_registration_excluded");
  const live = calculateLiveHolding(raw, { now });
  if (!live.currentHold) throw new Error("holding_current_controls_required");
  const matches = live.holds.filter(hold => !hold.cancelledAt && hold.start === live.currentHold.start && hold.end === live.currentHold.end);
  if (matches.length !== 1) throw new Error("holding_single_current_creation_required");
  const selected = matches[0];
  if (Date.parse(selected.registeredAt) < Date.parse(config.cutoverAt)) throw new Error("holding_historical_registration_excluded");
  if (now.getTime() - Date.parse(selected.registeredAt) > 48 * 3600_000) throw new Error("holding_registration_too_old_review_required");
  // Enforce overlap, allowance and cancelled-period guards for this specific creation.
  calculateLiveHolding(raw, { creationEvidenceFingerprint: selected.id, now });
  return { live, selected, approval: { confirmed: true, approvedBy: config.automaticPolicyId,
    reason: "Human-approved new holding automation after KST cutover", memberId: raw.memberId,
    observationFingerprint: live.observation.observationFingerprint, creationEvidenceFingerprint: selected.id } };
}

export function automaticHoldingEvent(plan, selected, config) {
  return { schemaVersion: 1, id: plan.id, source: "studiomate_live_ticket_readback", memberId: plan.memberId,
    memberPhone: plan.memberPhone, studioId: plan.studioId, ticketName: plan.sourceEvidence.ticketName,
    issuanceFingerprint: plan.issuanceFingerprint, creationEvidenceFingerprint: plan.creationEvidenceFingerprint,
    registeredAt: selected.registeredAt, policyId: config.automaticPolicyId, cutoverAt: config.cutoverAt,
    status: "ready", canonical: true };
}

export function automaticHoldingEventIssue(event, plan, config, now = new Date()) {
  const issue = holdingAutomaticConfigIssue(config, now);
  if (issue) return issue;
  const proof = automaticHoldingEvidence(plan.sourceEvidence, config, now);
  const expected = automaticHoldingEvent(plan, proof.selected, config);
  const same = event && typeof event === "object" && !Array.isArray(event) &&
    Object.keys(event).length === Object.keys(expected).length && Object.entries(expected).every(([key, value]) => event[key] === value);
  return same && plan.approval.approvedBy === config.automaticPolicyId
    ? "" : "holding_canonical_event_changed_or_missing";
}
