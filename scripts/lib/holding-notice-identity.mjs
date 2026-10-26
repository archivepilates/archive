import { holdingFingerprint } from "./studiomate-holding-source.mjs";

const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const nativeId = value => typeof value === "string" && /^[1-9]\d*$/.test(value);
const day = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const instant = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

/** Registration keeps its four-entry hash; changes use exactly six flat entries:
 * [studioId, memberId, issuanceFingerprint, creationEvidenceFingerprint, "holding_period_change", changeFingerprint].
 */
export function holdingOperatorNoticeId(row) {
  if (!row || ![row.studioId, row.memberId].every(nativeId) ||
      ![row.issuanceFingerprint, row.creationEvidenceFingerprint].every(digest))
    throw new Error("holding_notice_identity_required");
  const parts = [row.studioId, row.memberId, row.issuanceFingerprint, row.creationEvidenceFingerprint];
  if (row.noticePurpose !== undefined) {
    if (row.noticePurpose !== "holding_period_change" || !digest(row.changeFingerprint))
      throw new Error("holding_notice_change_identity_required");
    parts.push("holding_period_change", row.changeFingerprint);
  } else if (row.changeFingerprint !== undefined) {
    throw new Error("holding_notice_change_purpose_required");
  }
  return `holding_operator_notice_${holdingFingerprint(parts)}`;
}

/** Canonical UTC ISO instants and ISO calendar dates prevent alternate encodings of one event. */
export function holdingPeriodChangeFingerprint(change) {
  if (!change || ![change.creationEvidenceFingerprint, change.previousChangeId].every(digest) ||
      !instant(change.changedAt) || ![change.beforeStart, change.beforeEnd, change.start, change.end].every(day) ||
      change.beforeStart > change.beforeEnd || change.start > change.end ||
      change.beforeStart === change.start && change.beforeEnd === change.end)
    throw new Error("holding_period_change_evidence_required");
  // The first previousChangeId is the creation fingerprint; later ones are the preceding change id.
  return holdingFingerprint(["holding_period_change_v1", change.creationEvidenceFingerprint,
    change.previousChangeId, change.changedAt, change.beforeStart, change.beforeEnd, change.start, change.end]);
}
