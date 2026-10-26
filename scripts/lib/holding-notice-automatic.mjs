import { HOLDING_NOTICE_TEMPLATE_ID } from "./holding-allowance-notice.mjs";
import { calculateLiveHolding } from "./holding-notice-live-readback.mjs";
import { automaticHoldingPeriodChangeEvidence } from "./holding-period-change-policy.mjs";

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
export function automaticHoldingSourceReadback(raw, config, now = new Date()) {
  const issue = holdingAutomaticConfigIssue(config, now);
  if (issue) throw new Error(issue);
  const live = calculateLiveHolding(raw, { now });
  const today = new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
  const matches = live.holds.filter(hold => !hold.cancelledAt && (live.currentHold
    ? hold.start === live.currentHold.start && hold.end === live.currentHold.end
    : hold.start > today));
  if (!live.currentHold && !matches.length) throw new Error("holding_current_controls_required");
  if (matches.length !== 1) throw new Error("holding_single_current_creation_required");
  const selected = matches[0];
  // Enforce overlap, allowance and cancelled-period guards for this specific creation.
  calculateLiveHolding(raw, { creationEvidenceFingerprint: selected.id, now });
  return { live, selected, approval: { confirmed: true, approvedBy: config.automaticPolicyId,
    reason: "Human-approved new holding automation after KST cutover", memberId: raw.memberId,
    observationFingerprint: live.observation.observationFingerprint, creationEvidenceFingerprint: selected.id } };
}

export function automaticHoldingReadback(raw, config, now = new Date()) {
  const proof = automaticHoldingSourceReadback(raw, config, now);
  if (Date.parse(proof.selected.registeredAt) < Date.parse(config.cutoverAt)) throw new Error("holding_historical_registration_excluded");
  return proof;
}

/** Only receipt matching may precede this age gate; every new send still requires it. */
export function automaticHoldingEvidence(raw, config, now = new Date()) {
  const proof = automaticHoldingReadback(raw, config, now);
  if (now.getTime() - Date.parse(proof.selected.registeredAt) > 48 * 3600_000)
    throw new Error("holding_registration_too_old_review_required");
  return proof;
}

export function automaticHoldingEvent(plan, selected, config) {
  const change = plan.noticePurpose === "holding_period_change";
  return { schemaVersion: 1, id: plan.id, source: "studiomate_live_ticket_readback", memberId: plan.memberId,
    memberPhone: plan.memberPhone, studioId: plan.studioId, ticketName: plan.sourceEvidence.ticketName,
    issuanceFingerprint: plan.issuanceFingerprint, creationEvidenceFingerprint: plan.creationEvidenceFingerprint,
    registeredAt: selected.registeredAt, policyId: change ? config.periodChangeNotice.policyId : config.automaticPolicyId, cutoverAt: config.cutoverAt,
    ...(change ? { noticePurpose: plan.noticePurpose, changeFingerprint: plan.changeFingerprint,
      originalNoticeId: plan.originalNoticeId, changedAt: plan.periodChange.changedAt } : {}),
    status: "ready", canonical: true };
}

export function automaticHoldingEventIssue(event, plan, config, now = new Date(), originalSend, completedChanges = []) {
  const issue = holdingAutomaticConfigIssue(config, now);
  if (issue) return issue;
  const change = plan.noticePurpose === "holding_period_change";
  const proof = change ? automaticHoldingPeriodChangeEvidence(plan.sourceEvidence, config, originalSend, now, completedChanges)
    : automaticHoldingEvidence(plan.sourceEvidence, config, now);
  if (!proof || change && proof.change.id !== plan.changeFingerprint) return "holding_period_change_evidence_changed";
  const expected = automaticHoldingEvent(plan, proof.selected, config);
  const same = event && typeof event === "object" && !Array.isArray(event) &&
    Object.keys(event).length === Object.keys(expected).length && Object.entries(expected).every(([key, value]) => event[key] === value);
  return same && plan.approval.approvedBy === (change ? config.periodChangeNotice.policyId : config.automaticPolicyId)
    ? "" : "holding_canonical_event_changed_or_missing";
}
