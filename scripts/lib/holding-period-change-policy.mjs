import { HOLDING_NOTICE_TEMPLATE_ID } from "./holding-allowance-notice.mjs";
import { holdingOperatorNoticeId, holdingPeriodChangeFingerprint } from "./holding-notice-identity.mjs";
import { calculateLiveHolding } from "./holding-notice-live-readback.mjs";
import { sourceDate } from "./studiomate-holding-source.mjs";

export const HOLDING_PERIOD_CHANGE_POLICY = "holding_period_change_20261026_v1";

const requireEvidence = (ok, reason) => { if (!ok) throw new Error(reason); };
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const nativeId = value => typeof value === "string" && /^[1-9]\d*$/.test(value);
const strictISO = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const TARGET_KEYS = ["memberId", "issuanceFingerprint", "creationEvidenceFingerprint", "changeFingerprint"];
const POLICY_KEYS = ["enabled", "policyId", "activatedAt", "approvedBy", "templateId", "allowedPriorChanges"];
const CHANGE_KEYS = ["id", "creationEvidenceFingerprint", "previousChangeId", "changedAt", "beforeStart", "beforeEnd", "start", "end"];
const exactKeys = (value, keys) => record(value) && Object.keys(value).length === keys.length &&
  keys.every(key => Object.hasOwn(value, key));

function approvedPolicy(config, now) {
  const policy = config?.periodChangeNotice;
  requireEvidence(now instanceof Date && Number.isFinite(now.getTime()) && exactKeys(policy, POLICY_KEYS) &&
    policy.enabled === true && policy.policyId === HOLDING_PERIOD_CHANGE_POLICY && strictISO(policy.activatedAt) &&
    Date.parse(policy.activatedAt) <= now.getTime() && typeof policy.approvedBy === "string" &&
    policy.approvedBy.trim().length > 0 && policy.templateId === HOLDING_NOTICE_TEMPLATE_ID &&
    Array.isArray(policy.allowedPriorChanges) && policy.allowedPriorChanges.length <= 1 &&
    [...policy.allowedPriorChanges].every(target => exactKeys(target, TARGET_KEYS) && nativeId(target.memberId) &&
      [target.issuanceFingerprint, target.creationEvidenceFingerprint, target.changeFingerprint].every(digest)),
  "holding_period_change_configuration_required");
  return policy;
}

function validatedChanges(live, selected) {
  requireEvidence(Array.isArray(live.periodChanges), "holding_period_change_chronology_required");
  const changes = live.periodChanges.filter(change => change?.creationEvidenceFingerprint === selected.id);
  if (!changes.length) return changes;
  const creation = live.observation.history.find(row => row.fingerprint === selected.id);
  requireEvidence(creation && selected.creationEvidenceFingerprint === selected.id && strictISO(selected.registeredAt),
    "holding_period_change_chronology_required");
  let beforeStart = sourceDate(creation.changes.find(change => change.field === "정지시작일")?.after);
  let beforeEnd = sourceDate(creation.changes.find(change => change.field === "정지종료일")?.after);
  let previousChangeId = selected.id, previousAt = Date.parse(selected.registeredAt);
  for (const change of changes) {
    requireEvidence(change.id === holdingPeriodChangeFingerprint(change) && change.previousChangeId === previousChangeId &&
      change.beforeStart === beforeStart && change.beforeEnd === beforeEnd && Date.parse(change.changedAt) > previousAt &&
      Date.parse(change.changedAt) <= Date.parse(live.observation.observedAt), "holding_period_change_chronology_required");
    beforeStart = change.start;
    beforeEnd = change.end;
    previousChangeId = change.id;
    previousAt = Date.parse(change.changedAt);
  }
  requireEvidence(beforeStart === selected.start && beforeEnd === selected.end,
    "holding_period_change_current_range_required");
  return changes;
}

function originalReceipt(originalSend, live, selected) {
  const identity = { studioId: live.observation.studioId, memberId: live.observation.memberId,
    issuanceFingerprint: live.observation.issuanceFingerprint, creationEvidenceFingerprint: selected.id };
  const id = holdingOperatorNoticeId(identity);
  requireEvidence(record(originalSend) && Object.entries(identity).every(([key, value]) => originalSend[key] === value) &&
    originalSend.id === id && originalSend.candidateId === id && originalSend.sendId === id &&
    originalSend.noticePurpose === undefined && originalSend.changeFingerprint === undefined &&
    originalSend.status === "done" && originalSend.providerStatus === "COMPLETE" && originalSend.providerStatusCode === "4000" &&
    originalSend.isTest === false && originalSend.templateCode === HOLDING_NOTICE_TEMPLATE_ID &&
    originalSend.payload?.holdingNotice === true &&
    ["operator_verified_one_off", "automatic_live_readback"].includes(originalSend.payload?.deliveryMode) &&
    originalSend.payload?.noticePurpose === undefined && strictISO(originalSend.observedAt) &&
    Date.parse(originalSend.observedAt) >= Date.parse(selected.registeredAt) &&
    Date.parse(originalSend.observedAt) <= Date.parse(live.observation.observedAt),
  "holding_original_notice_delivery_required");
  return Date.parse(originalSend.observedAt);
}

function requireCompletedChange(change, completedChanges, originalSend, live) {
  const identity = { studioId: originalSend.studioId, memberId: originalSend.memberId,
    issuanceFingerprint: originalSend.issuanceFingerprint, creationEvidenceFingerprint: originalSend.creationEvidenceFingerprint,
    noticePurpose: "holding_period_change", changeFingerprint: change.id };
  const id = holdingOperatorNoticeId(identity);
  const matches = completedChanges.filter(row => record(row) &&
    ([row.id, row.candidateId, row.sendId].includes(id) || row.changeFingerprint === change.id));
  const receipt = matches.length === 1 ? matches[0] : null;
  requireEvidence(receipt && Object.entries(identity).every(([key, value]) => receipt[key] === value) &&
    receipt.id === id && receipt.candidateId === id && receipt.sendId === id && receipt.originalNoticeId === originalSend.id &&
    typeof originalSend.memberPhone === "string" && /^01[016789]\d{7,8}$/.test(originalSend.memberPhone) &&
    receipt.memberPhone === originalSend.memberPhone && receipt.status === "done" && receipt.providerStatus === "COMPLETE" &&
    receipt.providerStatusCode === "4000" && receipt.isTest === false && receipt.templateCode === HOLDING_NOTICE_TEMPLATE_ID &&
    typeof receipt.solapiMessageId === "string" && receipt.solapiMessageId.trim().length > 0 &&
    receipt.payload?.holdingNotice === true && receipt.payload?.deliveryMode === "automatic_live_readback" &&
    receipt.payload?.policyId === HOLDING_PERIOD_CHANGE_POLICY && exactKeys(receipt.periodChange, CHANGE_KEYS) &&
    CHANGE_KEYS.every(key => receipt.periodChange[key] === change[key]) && strictISO(receipt.observedAt) &&
    Date.parse(receipt.observedAt) >= Date.parse(change.changedAt) &&
    Date.parse(receipt.observedAt) <= Date.parse(live.observation.observedAt),
  "holding_multiple_unnotified_changes_review_required");
}

/** Pure approval evidence only. The existing approved template text is intentionally unchanged. */
export function automaticHoldingPeriodChangeReadback(raw, config, originalSend, now = new Date(), completedChanges = []) {
  const policy = approvedPolicy(config, now);
  requireEvidence(Array.isArray(completedChanges), "holding_multiple_unnotified_changes_review_required");
  let live = calculateLiveHolding(raw, { now });
  requireEvidence(strictISO(live.observation.observedAt), "holding_period_change_observation_time_required");
  const today = new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
  const matches = live.holds.filter(hold => !hold.cancelledAt && (live.currentHold
    ? hold.start === live.currentHold.start && hold.end === live.currentHold.end
    : hold.start > today && live.observation.activeHolds.some(range => range.start === hold.start && range.end === hold.end)));
  requireEvidence(matches.length > 0, "holding_current_controls_required");
  requireEvidence(matches.length === 1, "holding_single_current_creation_required");
  const selected = matches[0];
  // Reuse the calculator's selected-creation allowance, overlap and saved-controls guards.
  live = calculateLiveHolding(raw, { creationEvidenceFingerprint: selected.id, now });
  const changes = validatedChanges(live, selected), change = changes.at(-1);
  if (!change) return null;
  const explicitlyAllowed = item => policy.allowedPriorChanges.some(target => target.memberId === live.observation.memberId &&
    target.issuanceFingerprint === live.observation.issuanceFingerprint && target.creationEvidenceFingerprint === selected.id &&
    target.changeFingerprint === item.id);
  const eligible = item => Date.parse(item.changedAt) > Date.parse(policy.activatedAt) || explicitlyAllowed(item);
  if (!eligible(change)) return null;
  const observedAt = originalReceipt(originalSend, live, selected);
  const included = changes.filter(item => Date.parse(item.changedAt) <= observedAt).at(-1);
  if (included) requireEvidence(originalSend.variables?.["#{홀딩시작일}"] === included.start &&
    originalSend.variables?.["#{홀딩종료일}"] === included.end, "holding_period_change_original_order_review_required");
  if (Date.parse(change.changedAt) <= observedAt) return null;
  // Only earlier transitions need delivered receipts. The worker reconciles the latest identity separately.
  for (const earlier of changes.slice(0, -1).filter(item => Date.parse(item.changedAt) > observedAt &&
      (Date.parse(item.changedAt) >= Date.parse(policy.activatedAt) || explicitlyAllowed(item))))
    requireCompletedChange(earlier, completedChanges, originalSend, live);
  return { live, selected, change, approval: { confirmed: true, approvedBy: policy.policyId,
    reason: "Human-approved existing-template holding period update", memberId: live.observation.memberId,
    observationFingerprint: live.observation.observationFingerprint, creationEvidenceFingerprint: selected.id,
    noticePurpose: "holding_period_change", changeFingerprint: change.id } };
}

/** Receipt reconciliation may precede this gate; a new transport may never bypass it. */
export function automaticHoldingPeriodChangeEvidence(raw, config, originalSend, now = new Date(), completedChanges = []) {
  const proof = automaticHoldingPeriodChangeReadback(raw, config, originalSend, now, completedChanges);
  if (proof) requireEvidence(now.getTime() - Date.parse(proof.change.changedAt) <= 48 * 3600_000,
    "holding_period_change_too_old_review_required");
  return proof;
}
