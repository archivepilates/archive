import { normalizeMembershipPhone } from "./membershipContractPolicy";

type Data = Record<string, any>;
const MAX_AGE_MS = 90_000;
const record = (value: any): value is Data => !!value && typeof value === "object" && !Array.isArray(value);
const utcMillis = (value: any) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return NaN;
  const millis = Date.parse(value);
  return Number.isFinite(millis) && new Date(millis).toISOString() === value ? millis : NaN;
};

/** A signed contract's copied purchase fields are not current payment/refund evidence. */
export function membershipWelcomeReadbackIssue(source: Data, now: Date, candidate?: Data) {
  if (!record(source) || !(now instanceof Date) || !Number.isFinite(now.getTime()))
    return "native_readback_clock_unverified";
  const completion = source.completion;
  const readback = source.nativeReadback;
  if (!record(completion) || !record(readback)) return "current_native_readback_required";
  const completionAt = utcMillis(completion.checkedAt);
  const created = candidate?.createdAt;
  let candidateAt = completionAt;
  if (candidate) {
    try {
      candidateAt =
        typeof created?.toMillis === "function"
          ? created.toMillis()
          : Number.isSafeInteger(created?.seconds) &&
              Number.isInteger(created?.nanoseconds) &&
              created.nanoseconds >= 0 &&
              created.nanoseconds < 1e9
            ? created.seconds * 1000 + created.nanoseconds / 1e6
            : NaN;
    } catch {
      return "native_readback_clock_unverified";
    }
  }
  if (!Number.isFinite(completionAt) || !Number.isFinite(candidateAt)) return "native_readback_clock_unverified";
  const sources = ["studiomate_native_member", "studiomate_native_ticket", "studiomate_native_payment"];
  const reads = [readback.member, readback.ticket, readback.payment];
  for (const [index, read] of reads.entries()) {
    if (
      !record(read) ||
      read.source !== sources[index] ||
      read.verified !== true ||
      read.complete !== true ||
      read.studioId !== source.studioId ||
      read.memberId !== completion.memberId ||
      (index > 0 && (read.userTicketId !== completion.userTicketId || read.productId !== completion.productId))
    ) {
      return "current_native_readback_identity_mismatch";
    }
    const at = utcMillis(read.checkedAt);
    if (
      !Number.isFinite(at) ||
      at > now.getTime() ||
      now.getTime() - at > MAX_AGE_MS ||
      at < completionAt ||
      at < candidateAt
    )
      return "fresh_native_readback_required";
  }
  const [member, ticket, payment] = reads;
  if (
    member.phoneMatchCount !== 1 ||
    !normalizeMembershipPhone(completion.memberPhone) ||
    normalizeMembershipPhone(member.phone) !== normalizeMembershipPhone(completion.memberPhone) ||
    member.classification !== "member" ||
    member.currentRecipientEligible !== true
  )
    return "current_native_member_ineligible";
  if (
    ticket.classification !== "regular" ||
    ticket.refunded !== false ||
    ticket.cancelled !== false ||
    !["active", "scheduled"].includes(ticket.status)
  )
    return "current_native_ticket_ineligible";
  if (
    payment.status !== "paid" ||
    !Number.isSafeInteger(payment.paidAmount) ||
    payment.paidAmount <= 0 ||
    payment.paidAmount !== completion.paidAmount ||
    payment.totalAmount !== payment.paidAmount ||
    payment.outstandingAmount !== 0 ||
    payment.refundedAmount !== 0
  )
    return "current_native_payment_ineligible";
  return "";
}
