import {
  evaluateMembershipContractEligibility,
  membershipContractJobKey,
} from "./studiomate-membership-contract-policy.mjs";

const nativeId = (value) => /^[1-9]\d{0,63}$/.test(String(value ?? ""));

export function selectNativeMembershipContractCandidate({
  group,
  member,
  ticketRead,
  contractHistory,
  previousDownloadedAt,
  sourceDownloadedAt,
  config,
}) {
  const review = (reason, details = {}) => ({
    status: "review",
    reason,
    selection: null,
    ...details,
  });
  if (
    !group?.phone ||
    !member ||
    ticketRead?.status !== "verified" ||
    contractHistory?.status !== "verified" ||
    !Array.isArray(ticketRead.tickets) ||
    !Array.isArray(contractHistory.records) ||
    !validInstant(previousDownloadedAt) ||
    !validInstant(sourceDownloadedAt) ||
    Date.parse(previousDownloadedAt) >= Date.parse(sourceDownloadedAt)
  )
    return review("incomplete_native_selection_source");
  const regularProductIds = (config?.regularProductIds || []).map(String);
  if (
    !nativeId(config?.studioId) ||
    member.memberId === undefined ||
    member.phone !== group.phone ||
    !regularProductIds.length ||
    regularProductIds.some((id) => !nativeId(id)) ||
    new Set(regularProductIds).size !== regularProductIds.length ||
    !validInstant(config?.cutoverAt) ||
    !config?.termsVersion
  )
    return review("invalid_native_selection_policy");

  const allRegular = ticketRead.tickets.filter((ticket) =>
    regularProductIds.includes(ticket.productId),
  );
  const currentIds = allRegular.map((ticket) => ticket.userTicketId);
  const previousIds = allRegular
    .filter((ticket) => Date.parse(ticket.issuedAt) <= Date.parse(previousDownloadedAt))
    .map((ticket) => ticket.userTicketId);
  const changedProductNames = new Set(
    (group.rows || [])
      .map((row) => String(row?.["\uC218\uAC15\uAD8C\uBA85"] || "").trim())
      .filter(Boolean),
  );
  const candidates = allRegular.filter(
    (ticket) =>
      Date.parse(ticket.issuedAt) > Date.parse(previousDownloadedAt) &&
      Date.parse(ticket.issuedAt) <= Date.parse(sourceDownloadedAt) &&
      changedProductNames.has(ticket.title),
  );
  if (candidates.length !== 1)
    return review(
      candidates.length ? "multiple_fresh_native_issuances" : "fresh_native_issuance_not_found",
      { candidateCount: candidates.length },
    );

  const ticket = candidates[0];
  const contracts = contractHistory.records.map((contract) => ({
    contractId: contract.contractId,
    scope:
      contract.categoryId === 1 &&
      contract.title === "\uC544\uCE74\uC774\uBE0C \uD68C\uC6D0\uAC00\uC785"
        ? "regular_membership"
        : "other",
    status: contract.status,
    termsVersion:
      contract.categoryId === 1 &&
      contract.title === "\uC544\uCE74\uC774\uBE0C \uD68C\uC6D0\uAC00\uC785"
        ? config.termsVersion
        : undefined,
    applicable:
      contract.categoryId === 1 &&
      contract.title === "\uC544\uCE74\uC774\uBE0C \uD68C\uC6D0\uAC00\uC785",
    revoked: contract.status === "cancelled",
    signedAt: contract.signedAt || undefined,
    validUntil: null,
  }));
  const selectionInput = {
    now: sourceDownloadedAt,
    member: {
      memberId: member.memberId,
      identityVerified: true,
      classification: "member",
    },
    ticket: {
      memberId: ticket.memberId,
      userTicketId: ticket.userTicketId,
      productId: ticket.productId,
      identityVerified: true,
      classification: "regular",
      status: ticket.status,
      refunded: ticket.refunded,
      cancelled: ticket.cancelled,
      issuedAt: ticket.issuedAt,
      source: {
        kind: "studiomate_member_excel",
        verified: true,
        complete: true,
        capturedAt: sourceDownloadedAt,
      },
      payment: ticket.payment,
    },
    policy: {
      regularProductIds,
      termsVersion: config.termsVersion,
      cutoverAt: config.cutoverAt,
      maxSourceAgeMs: config.maxSourceAgeMs,
      maxIssuanceAgeMs: config.maxIssuanceAgeMs,
    },
    history: {
      previousIssuanceIds: previousIds,
      currentIssuanceIds: currentIds,
      baselineCapturedAt: previousDownloadedAt,
      purchases: {
        memberId: member.memberId,
        authoritative: true,
        complete: true,
        asOf: sourceDownloadedAt,
        priorRegularIssuanceIds: allRegular
          .filter((row) => Date.parse(row.issuedAt) < Date.parse(ticket.issuedAt))
          .map((row) => row.userTicketId),
      },
      contracts: {
        memberId: member.memberId,
        authoritative: true,
        complete: true,
        asOf: sourceDownloadedAt,
        records: contracts,
      },
    },
  };
  const decision = evaluateMembershipContractEligibility(selectionInput);
  if (!decision.eligibleForDetection)
    return review(decision.reasons?.[0] || "membership_policy_rejected", {
      policyStatus: decision.status,
    });
  return {
    status: "eligible",
    reason: decision.reasons[0],
    selection: Object.freeze({
      schemaVersion: 1,
      source: "studiomate_native_member_ticket",
      verified: true,
      now: sourceDownloadedAt,
      studioId: String(config.studioId),
      memberId: member.memberId,
      memberPhone: member.phone,
      userTicketId: ticket.userTicketId,
      productId: ticket.productId,
      action: decision.action,
      jobKey: decision.jobKey || membershipContractJobKey(member.memberId, ticket.userTicketId),
      signExpirationDays: Number(config.signExpirationDays || 7),
      member: selectionInput.member,
      ticket: selectionInput.ticket,
      policy: selectionInput.policy,
      history: selectionInput.history,
    }),
    ticket,
  };
}

function validInstant(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
