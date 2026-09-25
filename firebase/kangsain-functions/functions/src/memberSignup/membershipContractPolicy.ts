import { createHash } from "node:crypto";

const EXCLUDED = new Set([
  "trial",
  "one_off",
  "oneoff",
  "instructor",
  "instructor_lesson",
  "staff",
  "compensation",
  "complimentary",
  "gift",
  "transfer",
  "test",
]);
const CONTRACT_STATUSES = new Set(["signed", "draft", "opened", "sent", "cancelled", "expired"]);
const PAYMENT_ISSUANCE_CLOCK_SKEW_MS = 5 * 60_000;
const nativeId = (value: any) => typeof value === "string" && /^[1-9]\d{0,63}$/.test(value);
const nativeIds = (value: any) => Array.isArray(value) && [...value].every(nativeId);
const text = (value: any) => typeof value === "string" && value.trim().length > 0;
const money = (value: any) => Number.isSafeInteger(value) && value >= 0;

/** Korean mobile strings only; invalid input returns "". Never an identity key. */
export function normalizeMembershipPhone(value: any) {
  if (typeof value !== "string" || !/^[+\d\s().-]+$/.test(value)) return "";
  let phone = value.replace(/[\s().-]/g, "");
  phone = phone.replace(/^(?:\+82|0082|82)(?=1)/, "0");
  if (/^10\d{8}$/.test(phone)) phone = `0${phone}`;
  return /^01(?:0\d{8}|[16789]\d{7,8})$/.test(phone) ? phone : "";
}

/** Native positive decimal STRING IDs only. Dates, product IDs and counts are excluded. */
export function membershipContractJobKey(memberId: any, userTicketId: any) {
  if (!nativeId(memberId) || !nativeId(userTicketId)) throw new TypeError("Native member/user-ticket IDs required");
  return `membership_contract_${createHash("sha256")
    .update(JSON.stringify(["studiomate-membership-v1", memberId, userTicketId]))
    .digest("hex")}`;
}

/**
 * null/undefined previousIds means bootstrap, whereas [] is an established empty baseline.
 * Inputs are complete native issuance-ID lists for ONE member, not active-ticket lists.
 * observedIds is a monotonic union, never persisted here. On review, do not advance the
 * baseline timestamp. Lost/invalid/duplicate IDs suppress ALL newIds for that snapshot.
 */
export function baselineDiff(previousIds: any, currentIds: any) {
  const first = previousIds == null;
  const previous = first ? [] : previousIds;
  const valid = nativeIds(previous) && nativeIds(currentIds);
  if (!valid)
    return {
      status: "review",
      reasons: ["invalid_issuance_ids"],
      newIds: [],
      observedIds: [],
      lostIds: [],
      duplicateIds: [],
    };
  const duplicates = (ids: string[]) => ids.filter((id: string, index: number) => ids.indexOf(id) !== index);
  const duplicateIds = [...new Set([...duplicates(previous), ...duplicates(currentIds)])].sort();
  const before = new Set<string>(previous);
  const current = new Set<string>(currentIds);
  const lostIds = [...before].filter((id: string) => !current.has(id)).sort();
  const observedIds = [...new Set([...previous, ...currentIds])].sort();
  const reasons = [
    duplicateIds.length ? "duplicate_issuance_ids" : "",
    lostIds.length ? "lost_issuance_ids" : "",
  ].filter(Boolean);
  const newIds = first || reasons.length ? [] : [...current].filter((id: string) => !before.has(id)).sort();
  return {
    status: reasons.length ? "review" : first ? "baseline" : newIds.length ? "changed" : "unchanged",
    reasons,
    newIds,
    observedIds,
    lostIds,
    duplicateIds,
  };
}

/** Strict timezone-bearing RFC3339, milliseconds at most; no local/date-only guessing. */
function instant(value: any) {
  if (typeof value !== "string") return NaN;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return NaN;
  const [, year, month, day, hour, minute, second, zone, , offsetHour, offsetMinute] = match;
  if (
    +year < 1970 ||
    +month < 1 ||
    +month > 12 ||
    +day < 1 ||
    +day > new Date(Date.UTC(+year, +month, 0)).getUTCDate() ||
    +hour > 23 ||
    +minute > 59 ||
    +second > 59 ||
    (zone !== "Z" && (+offsetHour > 14 || +offsetMinute > 59 || (+offsetHour === 14 && +offsetMinute !== 0)))
  )
    return NaN;
  return Date.parse(value);
}

/**
 * Detection only: sendAllowed is ALWAYS false. No IO, clock reads or name inference.
 * The caller must verify native evidence; booleans below are attestations, not proof.
 * All native IDs are decimal strings. Generic ticketId is deliberately NOT accepted.
 * Issuance/product namespaces are distinct, even if their numeric values coincide.
 * All times (including now) are RFC3339 strings with explicit timezone.
 *
 * member: { memberId, identityVerified: true, classification: "member" }
 * ticket: { memberId, userTicketId, productId, identityVerified: true,
 *   classification: "regular", status: "active"|"scheduled", refunded: false,
 *   cancelled: false, issuedAt,
 *   source: { kind: "studiomate_member_excel", verified: true, complete: true, capturedAt },
 *   payment: { verified: true, complete: true, status: "paid", totalAmount,
 *     paidAmount, outstandingAmount: 0, refundedAmount: 0,
 *     transactions: [{ paymentId, method: "card"|"cash"|"bank_transfer", status: "paid",
 *       amount, paidAt, installmentMonths?: positive integer (card only) }] } }
 * Amounts are nonnegative integer KRW, never strings/null. Transactions are distinct
 * settled payments, not future card-installment schedule rows; mixed methods may sum.
 * StudioMate can persist a settled payment shortly before creating the linked ticket.
 * A payment up to five minutes before issuance is accepted; older payments stay review-only.
 * policy: { regularProductIds: [productId], termsVersion, cutoverAt,
 *   maxSourceAgeMs: positive integer, maxIssuanceAgeMs: positive integer }
 * history: { previousIssuanceIds: null|[id], currentIssuanceIds: [id], baselineCapturedAt,
 *   purchases: { memberId, authoritative: true, complete: true, asOf,
 *     priorRegularIssuanceIds: [id] }, // all regular purchases BEFORE this issuance
 *   contracts: { memberId, authoritative: true, complete: true, asOf,
 *     records: [{ contractId, scope, status, termsVersion?, applicable?, revoked?,
 *       signedAt?, validUntil?: RFC3339|null }] } }
 * Signed records require signedAt, termsVersion, applicable/revoked booleans and
 * validUntil (explicit null means no expiry). Cancelled/expired signed records need review.
 * Histories must cover capturedAt through asOf, and include legacy/native records.
 * baselineCapturedAt must be a prior complete capture at/after cutover; an unseen ID
 * issued at/before that baseline is held, never treated as a catch-up event.
 * Results: { status, reasons, eligibleForDetection, action, jobKey, sendAllowed: false }.
 * Only eligible returns an action/key. Other outcomes expose the first blocking reason.
 */
export function evaluateMembershipContractEligibility(input: any = {}) {
  const { ticket, member, history, policy, now } = input || {};
  const result = (status: string, reason: string, action: string | null = null) => ({
    status,
    reasons: [reason],
    eligibleForDetection: status === "eligible",
    action,
    jobKey: status === "eligible" ? membershipContractJobKey(member.memberId, ticket.userTicketId) : null,
    sendAllowed: false,
  });
  const review = (reason: string) => result("review", reason);
  if (!ticket || !member || !policy || !history) return review("missing_input");
  if (
    !nativeId(member.memberId) ||
    member.identityVerified !== true ||
    !nativeId(ticket.memberId) ||
    ticket.memberId !== member.memberId ||
    !nativeId(ticket.userTicketId) ||
    !nativeId(ticket.productId) ||
    ticket.identityVerified !== true
  )
    return review("unverified_native_identity");
  if (EXCLUDED.has(ticket.classification) || EXCLUDED.has(member.classification))
    return result("excluded", "excluded_classification");
  if (member.classification !== "member" || ticket.classification !== "regular")
    return review("unknown_classification");
  if (
    !nativeIds(policy.regularProductIds) ||
    !policy.regularProductIds.length ||
    new Set(policy.regularProductIds).size !== policy.regularProductIds.length
  )
    return review("invalid_regular_product_allowlist");
  if (!policy.regularProductIds.includes(ticket.productId)) return result("excluded", "product_not_allowlisted");
  if (
    ticket.refunded === true ||
    ticket.cancelled === true ||
    ["refunded", "cancelled", "canceled"].includes(ticket.status)
  )
    return result("excluded", "refunded_or_cancelled");
  if (ticket.refunded !== false || ticket.cancelled !== false || !["active", "scheduled"].includes(ticket.status))
    return review("unverified_ticket_state");

  const nowMs = instant(now);
  const cutoverMs = instant(policy.cutoverAt);
  if (
    !Number.isFinite(nowMs) ||
    !Number.isFinite(cutoverMs) ||
    cutoverMs > nowMs ||
    !text(policy.termsVersion) ||
    !Number.isSafeInteger(policy.maxSourceAgeMs) ||
    policy.maxSourceAgeMs <= 0 ||
    !Number.isSafeInteger(policy.maxIssuanceAgeMs) ||
    policy.maxIssuanceAgeMs <= 0
  )
    return review("invalid_time_policy");
  const source = ticket.source;
  const capturedMs = instant(source?.capturedAt);
  if (
    source?.kind !== "studiomate_member_excel" ||
    source.verified !== true ||
    source.complete !== true ||
    !Number.isFinite(capturedMs) ||
    capturedMs > nowMs ||
    capturedMs < cutoverMs ||
    nowMs - capturedMs > policy.maxSourceAgeMs
  )
    return review("unverified_or_stale_source");
  const issuedMs = instant(ticket.issuedAt);
  if (!Number.isFinite(issuedMs) || issuedMs > capturedMs) return review("invalid_issuance_timestamp");
  if (issuedMs <= cutoverMs) return result("ignored", "historical_issuance");
  if (nowMs - issuedMs > policy.maxIssuanceAgeMs) return review("stale_issuance");

  const delta = baselineDiff(history.previousIssuanceIds, history.currentIssuanceIds);
  if (delta.status === "review") return review(delta.reasons[0]);
  if (!history.currentIssuanceIds.includes(ticket.userTicketId)) return review("issuance_missing_from_snapshot");
  if (delta.status === "baseline") return result("baseline", "initialize_without_events");
  const baselineMs = instant(history.baselineCapturedAt);
  if (!Number.isFinite(baselineMs) || baselineMs < cutoverMs || baselineMs >= capturedMs)
    return review("invalid_baseline_time");
  if (!delta.newIds.includes(ticket.userTicketId)) return result("ignored", "issuance_already_observed");
  if (issuedMs <= baselineMs) return review("late_discovered_issuance_no_backfill");

  const paymentError = validatePayment(ticket.payment, issuedMs, capturedMs);
  if (paymentError) return review(paymentError);
  for (const evidence of [history.purchases, history.contracts]) {
    const asOf = instant(evidence?.asOf);
    if (
      evidence?.authoritative !== true ||
      evidence.complete !== true ||
      evidence.memberId !== member.memberId ||
      !Number.isFinite(asOf) ||
      asOf < capturedMs ||
      asOf > nowMs
    )
      return review("incomplete_or_unverified_history");
  }
  const prior = history.purchases.priorRegularIssuanceIds;
  if (
    !nativeIds(prior) ||
    new Set(prior).size !== prior.length ||
    prior.includes(ticket.userTicketId) ||
    prior.some((id: string) => !history.currentIssuanceIds.includes(id))
  )
    return review("invalid_purchase_history");
  const contracts = history.contracts.records;
  if (
    !Array.isArray(contracts) ||
    [...contracts].some(
      (row: any) => !row || !text(row.contractId) || !text(row.scope) || !CONTRACT_STATUSES.has(row.status),
    ) ||
    new Set(contracts.map((row: any) => row.contractId)).size !== contracts.length
  )
    return review("invalid_contract_history");
  if (
    contracts.some((row: any) => row.scope === "regular_membership" && ["draft", "opened", "sent"].includes(row.status))
  )
    return review("existing_unsigned_regular_contract");
  if (contracts.some((row: any) => row.status !== "signed" && row.signedAt != null))
    return review("conflicting_signature_history");
  const signed = contracts.filter((row: any) => row.status === "signed");
  if (
    signed.some(
      (row: any) =>
        !Number.isFinite(instant(row.signedAt)) ||
        instant(row.signedAt) > nowMs ||
        !text(row.termsVersion) ||
        typeof row.applicable !== "boolean" ||
        typeof row.revoked !== "boolean" ||
        (row.validUntil !== null && !Number.isFinite(instant(row.validUntil))),
    )
  )
    return review("incomplete_signature_evidence");
  if (!signed.length) {
    return prior.length
      ? review("prior_purchase_without_signed_contract")
      : result("eligible", "verified_first_regular_purchase", "first_purchase_contract");
  }
  const applicable = signed.filter((row: any) => {
    const signedMs = instant(row.signedAt);
    const expiryMs = row.validUntil == null ? Infinity : instant(row.validUntil);
    return (
      row.scope === "regular_membership" &&
      row.applicable === true &&
      row.revoked === false &&
      row.termsVersion === policy.termsVersion &&
      Number.isFinite(signedMs) &&
      signedMs <= issuedMs &&
      expiryMs > nowMs
    );
  });
  if (!applicable.length) return review("no_applicable_signed_regular_contract");
  if (!prior.length) return review("signed_contract_without_prior_regular_purchase");
  return result("eligible", "verified_signed_member_renewal", "renewal_purchase_confirmation");
}

function validatePayment(payment: any, issuedMs: number, capturedMs: number) {
  if (!payment || payment.verified !== true || payment.complete !== true || payment.status !== "paid")
    return "unverified_payment";
  if (![payment.totalAmount, payment.paidAmount, payment.outstandingAmount, payment.refundedAmount].every(money))
    return "invalid_payment_amounts";
  if (
    payment.totalAmount === 0 ||
    payment.paidAmount === 0 ||
    payment.refundedAmount !== 0 ||
    payment.outstandingAmount !== 0 ||
    payment.totalAmount !== payment.paidAmount
  )
    return "unsettled_or_zero_payment";
  const rows = payment.transactions;
  if (!Array.isArray(rows) || !rows.length) return "missing_payment_transactions";
  const ids = new Set();
  let total = 0;
  for (const row of rows) {
    if (!row || !text(row.paymentId) || row.paymentId !== row.paymentId.trim() || ids.has(row.paymentId))
      return "invalid_or_duplicate_payment_id";
    ids.add(row.paymentId);
    const paidMs = instant(row.paidAt);
    if (
      row.status !== "paid" ||
      !["card", "cash", "bank_transfer"].includes(row.method) ||
      !money(row.amount) ||
      row.amount === 0 ||
      !Number.isFinite(paidMs) ||
      paidMs < issuedMs - PAYMENT_ISSUANCE_CLOCK_SKEW_MS ||
      paidMs > capturedMs
    )
      return "invalid_payment_transaction";
    if (
      row.installmentMonths !== undefined &&
      (row.method !== "card" || !Number.isSafeInteger(row.installmentMonths) || row.installmentMonths < 1)
    )
      return "invalid_installment_evidence";
    total += row.amount;
    if (!Number.isSafeInteger(total)) return "invalid_payment_amounts";
  }
  return total === payment.paidAmount ? null : "payment_transaction_total_mismatch";
}
