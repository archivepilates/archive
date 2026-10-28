import {
  evaluateMembershipContractEligibility,
  membershipContractJobKey,
  evaluateApprovedOctoberRenewalRecovery,
  isExcludedMembershipContractProductTitle,
} from "./studiomate-membership-contract-policy.mjs";

const nativeId = (value) => /^[1-9]\d{0,63}$/.test(String(value ?? ""));
// Retired regular products verified against native paid purchase histories on
// 2026-10-22. These establish prior purchase only, never select a new send target.
const HISTORICAL_REGULAR_PRODUCT_IDS = new Set([
  "194834", "203252", "268320", "338610", "375406", "412181", "211940",
  "216386", "249896", "249897", "258773", "336809", "434225",
]);
const REGULAR_CONTRACT_TITLES = new Set([
  "\uC544\uCE74\uC774\uBE0C \uD68C\uC6D0\uAC00\uC785",
  "\uC544\uCE74\uC774\uBE0C \uC7AC\uB4F1\uB85D",
  "\uC544\uCE74\uC774\uBE0C \uC7AC\uB4F1\uB85D \uAD6C\uB9E4\uC870\uAC74 \uD655\uC778",
]);
const REGULAR_MEMBER_GRADES = new Set(["", "vip", "blue", "인플루언서", "회원", "일반회원", "일반멤버"]);
const EXCLUDED_MEMBER_GRADES = new Map([
  ["강사회원", "instructor_member_grade_excluded"],
  ["강사", "instructor_member_grade_excluded"],
  ["스텝", "staff_member_grade_excluded"],
  ["직원", "staff_member_grade_excluded"],
  ["체험회원", "trial_member_grade_excluded"],
  ["상담회원", "consultation_member_grade_excluded"],
]);

const normalizedGrade = (value) => String(value ?? "").trim().replace(/\s+/g, "").toLowerCase();

export function membershipContractMemberGradeDecision(group, member = {}) {
  const grades = [
    ...(Array.isArray(group?.rows)
      ? group.rows.flatMap((row) => [row?.["등급"], row?.["회원구분"], row?.["회원등급"]])
      : []),
    member.memberGrade,
  ]
    .map(normalizedGrade)
    .filter(Boolean);
  const unique = [...new Set(grades)];
  for (const grade of unique) {
    const reason = EXCLUDED_MEMBER_GRADES.get(grade);
    if (reason) return { status: "excluded", reason, classification: null, memberGrade: grade };
  }
  const unknown = unique.filter((grade) => !REGULAR_MEMBER_GRADES.has(grade));
  if (unknown.length)
    return {
      status: "review",
      reason: "unknown_member_grade",
      classification: null,
      memberGrade: unknown[0],
    };
  return {
    status: "eligible",
    reason: "regular_member_grade",
    classification: "member",
    memberGrade: unique[0] || "",
  };
}

export function selectNativeMembershipContractCandidate({
  group,
  member,
  ticketRead,
  contractHistory,
  previousDownloadedAt,
  sourceDownloadedAt,
  config,
  recoveryApproval = null,
  issuanceWindowEndAt = sourceDownloadedAt,
}) {
  const review = (reason, details = {}) => ({
    status: "review",
    reason,
    selection: null,
    ...details,
  });
  const memberGradeDecision = membershipContractMemberGradeDecision(group, member);
  if (memberGradeDecision.status === "excluded") {
    return {
      status: "excluded",
      reason: memberGradeDecision.reason,
      selection: null,
      memberGrade: memberGradeDecision.memberGrade,
    };
  }
  if (memberGradeDecision.status !== "eligible") {
    return review(memberGradeDecision.reason, { memberGrade: memberGradeDecision.memberGrade });
  }
  if (
    !group?.phone ||
    !member ||
    ticketRead?.status !== "verified" ||
    contractHistory?.status !== "verified" ||
    !Array.isArray(ticketRead.tickets) ||
    !Array.isArray(contractHistory.records) ||
    (!recoveryApproval && !validInstant(previousDownloadedAt)) ||
    !validInstant(sourceDownloadedAt) ||
    !validInstant(issuanceWindowEndAt) || Date.parse(issuanceWindowEndAt) > Date.parse(sourceDownloadedAt) ||
    (!recoveryApproval && Date.parse(previousDownloadedAt) >= Date.parse(sourceDownloadedAt))
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
    regularProductIds.includes(ticket.productId) && !isExcludedMembershipContractProductTitle(ticket.title),
  );
  const purchaseHistory = ticketRead.tickets.filter((ticket) =>
    (regularProductIds.includes(ticket.productId) || HISTORICAL_REGULAR_PRODUCT_IDS.has(ticket.productId))
      && !isExcludedMembershipContractProductTitle(ticket.title),
  );
  const currentIds = purchaseHistory.map((ticket) => ticket.userTicketId);
  const previousIds = purchaseHistory
    .filter((ticket) => Date.parse(ticket.issuedAt) <= Date.parse(previousDownloadedAt))
    .map((ticket) => ticket.userTicketId);
  // Excel discovers the member; native issuance IDs and timestamps select the ticket.
  const candidates = allRegular.filter(
    (ticket) =>
      recoveryApproval
        ? ticket.userTicketId === recoveryApproval.userTicketId
        : Date.parse(ticket.issuedAt) > Date.parse(previousDownloadedAt) &&
          Date.parse(ticket.issuedAt) <= Date.parse(issuanceWindowEndAt),
  );
  if (!candidates.length)
    return {
      status: "ignored",
      reason: "no_fresh_native_issuance",
      selection: null,
      candidateCount: 0,
    };
  if (candidates.length > 1)
    return review("multiple_fresh_native_issuances", {
      candidateCount: candidates.length,
    });

  const ticket = candidates[0];
  const contracts = contractHistory.records.map((contract) => {
    const regular = contract.categoryId === 1 && REGULAR_CONTRACT_TITLES.has(contract.title);
    return {
      contractId: contract.contractId,
      scope: regular ? "regular_membership" : "other",
      status: contract.status,
      termsVersion: regular ? config.termsVersion : undefined,
      applicable: regular,
      revoked: contract.status === "cancelled",
      signedAt: contract.signedAt || undefined,
      validUntil: null,
      ...(contract.verified === true && nativeId(contract.ticket?.userTicketId)
        ? { userTicketId: String(contract.ticket.userTicketId) }
        : {}),
    };
  });
  const selectionInput = {
    now: sourceDownloadedAt,
    member: {
      memberId: member.memberId,
      identityVerified: true,
      classification: memberGradeDecision.classification,
      memberGrade: memberGradeDecision.memberGrade,
      registeredAt: member.registeredAt,
    },
    ticket: {
      memberId: ticket.memberId,
      userTicketId: ticket.userTicketId,
      productId: ticket.productId,
      title: ticket.title,
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
      previousIssuanceIds: recoveryApproval ? null : previousIds,
      currentIssuanceIds: currentIds,
      baselineCapturedAt: recoveryApproval ? null : previousDownloadedAt,
      purchases: {
        memberId: member.memberId,
        authoritative: true,
        complete: true,
        asOf: sourceDownloadedAt,
        priorRegularIssuanceIds: purchaseHistory
          .filter((row) => !row.refunded && !row.cancelled && row.payment?.verified === true && row.payment?.complete === true && row.payment.totalAmount > 0 && row.payment.refundedAmount === 0 && Date.parse(row.issuedAt) < Date.parse(ticket.issuedAt))
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
  const decision = recoveryApproval
    ? evaluateApprovedOctoberRenewalRecovery(selectionInput, recoveryApproval)
    : evaluateMembershipContractEligibility(selectionInput);
  if (decision.status === "ignored")
    return {
      status: "ignored",
      reason: decision.reasons?.[0] || "membership_policy_ignored",
      selection: null,
      policyStatus: decision.status,
    };
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
      ...(recoveryApproval ? { operatorRecoveryApproval: Object.freeze({ ...recoveryApproval }) } : {}),
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
