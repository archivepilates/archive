import { createHash } from "node:crypto";

export const SIGNATURE_RECOVERY_POLICY = "signature_maintenance_resume_v1";
const HOUR = 3_600_000;
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const instant = value => typeof value === "string" && Number.isFinite(Date.parse(value))
  && new Date(Date.parse(value)).toISOString() === value;
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const nativeId = value => typeof value === "string" && /^[1-9]\d{0,63}$/.test(value);

// This approval only prioritizes five exact discovery hints. Native source and
// canonical job/contract checks still decide whether any request may be sent.
export function signatureMaintenanceRecovery(config, now = Date.now()) {
  const approval = config?.signatureMaintenanceRecovery;
  const hold = config?.signatureMaintenanceHold;
  if (config?.contractWriterEnabled !== true || config?.mode !== "live" || config?.studioId !== "5330"
    || config?.sourcePromoted !== true || config?.nativeE2eVerified !== true
    || hold?.status !== "resumed" || approval?.policy !== SIGNATURE_RECOVERY_POLICY
    || approval.status !== "approved" || approval.holdId !== hold.id
    || approval.reference !== "user_signature_resume_20261028"
    || approval.noticeUrl !== "https://arcpilates.studiomate.kr/boards/studio-notice/224?page=1"
    || ![approval.approvedAt, approval.expiresAt, hold.requestedAt].every(instant)
    || !Number.isFinite(now) || Date.parse(approval.approvedAt) > now || now >= Date.parse(approval.expiresAt)
    || Date.parse(approval.expiresAt) - Date.parse(approval.approvedAt) > 24 * HOUR
    || Date.parse(approval.expiresAt) <= Date.parse(approval.approvedAt)
    || Date.parse(hold.requestedAt) >= Date.parse(approval.approvedAt)
    || !Array.isArray(approval.entries) || !approval.entries.length || approval.entries.length > 5) return null;
  const entries = approval.entries;
  if (entries.some(entry => !entry || ![entry.hintId, entry.phoneFingerprint, entry.fingerprint].every(digest)
    || entry.hintId !== hash([entry.phoneFingerprint, entry.fingerprint]) || !nativeId(entry.memberId)
    || !["사전등록 50회권", "20회(5개월)", "10주(주2회)"].includes(entry.productName)
    || ![entry.previousDownloadedAt, entry.sourceDownloadedAt].every(instant)
    || Date.parse(entry.previousDownloadedAt) >= Date.parse(entry.sourceDownloadedAt)
    || Date.parse(entry.sourceDownloadedAt) > Date.parse(approval.approvedAt)
    || Date.parse(entry.sourceDownloadedAt) < Date.parse(hold.requestedAt))
    || ["hintId", "phoneFingerprint", "memberId"].some(key => new Set(entries.map(e => e[key])).size !== entries.length)) return null;
  return { ...approval, holdFrom: hold.requestedAt, approvalHash: hash(approval) };
}

export function approvedSignatureRecoveryEntry(config, hint, now = Date.now()) {
  const approval = signatureMaintenanceRecovery(config, now);
  const entry = approval?.entries.find(entry => entry.hintId === hint?.hintId
    && entry.phoneFingerprint === hint.phoneFingerprint && entry.previousDownloadedAt === hint.previousDownloadedAt);
  return entry ? { approval, entry } : null;
}

export function signatureRecoverySelectionPolicy({ config, hint, member, ticketRead, now = Date.now() }) {
  const found = approvedSignatureRecoveryEntry(config, hint, now);
  if (!found || member?.memberId !== found.entry.memberId || typeof member.phone !== "string"
    || !/^01[016789]\d{7,8}$/.test(member.phone) || ticketRead?.status !== "verified"
    || !Array.isArray(ticketRead.tickets) || !Array.isArray(config.regularProductIds)
    || hash(member.phone) !== found.entry.phoneFingerprint) return null;
  const { approval, entry } = found;
  const tickets = ticketRead.tickets.filter(ticket => instant(ticket?.issuedAt)
    && Date.parse(ticket.issuedAt) > Date.parse(entry.previousDownloadedAt)
    && Date.parse(ticket.issuedAt) <= Date.parse(entry.sourceDownloadedAt)
    && Date.parse(ticket.issuedAt) >= Date.parse(approval.holdFrom)
    && Date.parse(ticket.issuedAt) <= now && now - Date.parse(ticket.issuedAt) <= 7 * 24 * HOUR
    && ticket.title === entry.productName
    && config.regularProductIds.map(String).includes(ticket.productId));
  if (tickets.length !== 1) return null;
  return { config: { ...config, maxIssuanceAgeMs: 7 * 24 * HOUR },
    previousDownloadedAt: entry.previousDownloadedAt,
    issuanceWindowEndAt: entry.sourceDownloadedAt,
    // End the issuance-selection interval at the original detection, not today.
    ticketId: tickets[0].userTicketId,
    approval: { reference: approval.reference, policy: approval.policy, approvalHash: approval.approvalHash,
      hintId: entry.hintId, memberId: entry.memberId, userTicketId: tickets[0].userTicketId,
      detectedAt: entry.sourceDownloadedAt, approvedAt: approval.approvedAt, expiresAt: approval.expiresAt } };
}
