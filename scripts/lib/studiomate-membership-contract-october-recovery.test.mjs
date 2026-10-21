import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  evaluateApprovedOctoberRenewalRecovery as recover,
  evaluateMembershipContractEligibility as evaluate,
  membershipContractJobKey,
} from "./studiomate-membership-contract-policy.mjs";
import { selectNativeMembershipContractCandidate as selectNative } from "./studiomate-membership-contract-native-selection.mjs";

const REFERENCE = "user_october_renewal_recovery_20261022";
const HOUR = 3_600_000;
const REGULAR_TITLE = "\uC544\uCE74\uC774\uBE0C \uC7AC\uB4F1\uB85D";

// Independent synthetic evidence: an old October renewal, freshly re-read today.
function fixture() {
  const input = {
    now: "2026-10-22T03:00:00.000Z",
    member: {
      memberId: "100", identityVerified: true, classification: "member",
      registeredAt: "2025-01-01T00:00:00.000Z",
    },
    ticket: {
      memberId: "100", userTicketId: "200", productId: "300",
      identityVerified: true, classification: "regular", status: "active",
      refunded: false, cancelled: false, issuedAt: "2026-10-05T03:00:00.000Z",
      source: {
        kind: "studiomate_member_excel", verified: true, complete: true,
        capturedAt: "2026-10-22T02:50:00.000Z",
      },
      payment: {
        verified: true, complete: true, status: "paid",
        totalAmount: 398000, paidAmount: 398000,
        outstandingAmount: 0, refundedAmount: 0,
        transactions: [{
          paymentId: "synthetic-october-payment", method: "card", status: "paid",
          amount: 398000, paidAt: "2026-10-05T03:00:00.000Z",
        }],
      },
    },
    policy: {
      regularProductIds: ["300"], termsVersion: "regular-v1",
      cutoverAt: "2026-09-14T00:00:00.000Z",
      maxSourceAgeMs: HOUR, maxIssuanceAgeMs: 2 * HOUR,
    },
    history: {
      previousIssuanceIds: null, currentIssuanceIds: ["199", "200"],
      baselineCapturedAt: null,
      purchases: {
        memberId: "100", authoritative: true, complete: true,
        asOf: "2026-10-22T02:50:00.000Z", priorRegularIssuanceIds: ["199"],
      },
      contracts: {
        memberId: "100", authoritative: true, complete: true,
        asOf: "2026-10-22T02:50:00.000Z", records: [],
      },
    },
  };
  const approval = {
    reference: REFERENCE, memberId: "100", userTicketId: "200",
    sourceSha256: createHash("sha256")
      .update("synthetic complete membership export\n100,199,200\n")
      .digest("hex"),
    sourceComplete: true,
  };
  return { input, approval };
}

function freshAt(input, now) {
  input.now = now;
  input.ticket.source.capturedAt = now;
  input.history.purchases.asOf = now;
  input.history.contracts.asOf = now;
}

function eligible(result) {
  assert.equal(result.status, "eligible", JSON.stringify(result));
  assert.equal(result.eligibleForDetection, true);
  assert.equal(result.action, "renewal_purchase_confirmation");
  assert.equal(result.jobKey, membershipContractJobKey("100", "200"));
  assert.equal(result.sendAllowed, false);
  return result;
}

function blocked(result, reason, status = "review") {
  assert.equal(result.status, status, JSON.stringify(result));
  assert.deepEqual(result.reasons, [reason]);
  assert.equal(result.eligibleForDetection, false);
  assert.equal(result.action, null);
  assert.equal(result.jobKey, null);
  assert.equal(result.sendAllowed, false);
}

function nativeFixture() {
  const { input, approval } = fixture();
  const current = {
    ...input.ticket,
    source: "studiomate_native_ticket", verified: true, complete: true,
    studioId: "5330", title: "Synthetic regular group pass",
    type: "P", availableClassType: "G",
  };
  return {
    group: { phone: "01000000001", rows: [{ "\uB4F1\uAE09": "VIP" }] },
    member: { ...input.member, name: "Synthetic Member", phone: "01000000001" },
    ticketRead: {
      status: "verified",
      tickets: [
        { ...structuredClone(current), userTicketId: "199", issuedAt: "2026-09-01T00:00:00.000Z" },
        current,
      ],
    },
    contractHistory: { status: "verified", records: [] },
    sourceDownloadedAt: input.ticket.source.capturedAt,
    config: { ...input.policy, studioId: "5330", signExpirationDays: 7 },
    recoveryApproval: approval,
  };
}

function selected(result) {
  assert.equal(result.status, "eligible", JSON.stringify(result));
  assert.equal(result.selection.action, "renewal_purchase_confirmation");
  assert.equal(result.selection.memberId, "100");
  assert.equal(result.selection.userTicketId, "200");
  assert.equal(result.selection.jobKey, membershipContractJobKey("100", "200"));
  assert.equal(Object.isFrozen(result.selection), true);
  return result.selection;
}

function notSelected(result, reason, status = reason ? "review" : undefined) {
  if (status) assert.equal(result.status, status, JSON.stringify(result));
  else assert.ok(["review", "ignored", "excluded"].includes(result.status), JSON.stringify(result));
  assert.equal(result.selection, null);
  if (reason) assert.equal(result.reason, reason);
}

test("October export accepts exact, issuance-bound approval without authorizing a send or mutating evidence", () => {
  assert.equal(typeof recover, "function");
  const { input, approval } = fixture();
  const before = structuredClone({ input, approval });
  assert.equal(approval.reference, REFERENCE);
  assert.match(approval.sourceSha256, /^[a-f0-9]{64}$/);
  assert.equal(approval.sourceComplete, true);
  eligible(recover(input, approval));
  assert.deepEqual({ input, approval }, before);
});

const invalidApprovalPatches = [
  ["missing reference", { reference: undefined }],
  ["wrong day", { reference: "user_october_renewal_recovery_20261021" }],
  ["reference suffix", { reference: `${REFERENCE}_extra` }],
  ["reference whitespace", { reference: ` ${REFERENCE}` }],
  ["reference case", { reference: REFERENCE.toUpperCase() }],
  ["wrong member", { memberId: "101" }],
  ["missing member", { memberId: undefined }],
  ["numeric member", { memberId: 100 }],
  ["wrong issuance", { userTicketId: "201" }],
  ["missing issuance", { userTicketId: undefined }],
  ["numeric issuance", { userTicketId: 200 }],
  ["product ID is not issuance ID", { userTicketId: "300" }],
  ["missing export digest", { sourceSha256: undefined }],
  ["null export digest", { sourceSha256: null }],
  ["numeric export digest", { sourceSha256: 123 }],
  ["object export digest", { sourceSha256: { value: "a".repeat(64) } }],
  ["short export digest", { sourceSha256: "a".repeat(63) }],
  ["long export digest", { sourceSha256: "a".repeat(65) }],
  ["nonhex export digest", { sourceSha256: "g".repeat(64) }],
  ["uppercase export digest", { sourceSha256: "A".repeat(64) }],
  ["trailing newline digest", { sourceSha256: `${"a".repeat(64)}\n` }],
  ["missing completeness", { sourceComplete: undefined }],
  ["incomplete export", { sourceComplete: false }],
  ["string completeness", { sourceComplete: "true" }],
  ["numeric completeness", { sourceComplete: 1 }],
];

for (const [name, patch] of invalidApprovalPatches) {
  test(`October approval rejects ${name}`, () => {
    const { input, approval } = fixture();
    blocked(recover(input, { ...approval, ...patch }), "invalid_october_recovery_approval");
    const native = nativeFixture();
    native.recoveryApproval = { ...native.recoveryApproval, ...patch };
    notSelected(selectNative(native));
  });
}

for (const [now, allowed] of [
  ["2026-10-21T14:59:59.999Z", false],
  ["2026-10-21T15:00:00.000Z", true],
  ["2026-10-22T14:59:59.999Z", true],
  ["2026-10-22T15:00:00.000Z", false],
  ["2026-10-22T15:00:00.001Z", false],
  ["2026-10-22T00:00:00+09:00", true],
  ["2026-10-23T00:00:00+09:00", false],
]) {
  test(`approval execution window is half-open: ${now}`, () => {
    const { input, approval } = fixture();
    freshAt(input, now);
    if (allowed) eligible(recover(input, approval));
    else blocked(recover(input, approval), "invalid_october_recovery_approval");
    if (now.endsWith("Z")) {
      const native = nativeFixture();
      native.sourceDownloadedAt = now;
      if (allowed) selected(selectNative(native));
      else notSelected(selectNative(native), "invalid_october_recovery_approval");
    }
  });
}

for (const [issuedAt, reason] of [
  ["2026-09-30T14:59:59.999Z", "invalid_october_recovery_approval"],
  ["2026-09-30T15:00:00.000Z", null],
  ["2026-10-01T00:00:00+09:00", null],
  ["2026-10-31T14:59:59.999Z", "invalid_issuance_timestamp"],
  ["2026-10-31T15:00:00.000Z", "invalid_october_recovery_approval"],
  ["2026-10-31T15:00:00.001Z", "invalid_october_recovery_approval"],
  ["2026-11-01T00:00:00+09:00", "invalid_october_recovery_approval"],
]) {
  test(`native October issuance month is half-open and never permits future issuance: ${issuedAt}`, () => {
    const { input, approval } = fixture();
    input.ticket.issuedAt = issuedAt;
    const native = nativeFixture();
    native.ticketRead.tickets[1].issuedAt = issuedAt;
    if (reason) {
      blocked(recover(input, approval), reason);
      notSelected(selectNative(native), reason);
    } else {
      eligible(recover(input, approval));
      selected(selectNative(native));
    }
  });
}

for (const field of ["now", "issuedAt"]) {
  for (const value of [undefined, null, 0, "2026-10-22", "2026-10-22T03:00:00", "2026-10-32T03:00:00Z"]) {
    test(`approval never guesses malformed ${field}: ${String(value)}`, () => {
      const { input, approval } = fixture();
      if (field === "now") input.now = value;
      else input.ticket.issuedAt = value;
      blocked(recover(input, approval), "invalid_october_recovery_approval");
    });
  }
}

test("ordinary two-hour issuance policy remains inclusive at two hours and blocked one millisecond later", () => {
  for (const [age, stale] of [[2 * HOUR, false], [2 * HOUR + 1, true], [17 * 24 * HOUR, true]]) {
    const { input, approval } = fixture();
    input.ticket.issuedAt = new Date(Date.parse(input.now) - age).toISOString();
    freshAt(input, input.now);
    input.history.previousIssuanceIds = ["199"];
    input.history.baselineCapturedAt = "2026-10-01T00:00:00.000Z";
    if (stale) blocked(evaluate(input), "stale_issuance");
    else eligible(evaluate(input));
    eligible(recover(input, approval));
    assert.equal(input.policy.maxIssuanceAgeMs, 2 * HOUR);
  }
});

test("operator exception cannot create first-purchase contracts without actual prior purchases", () => {
  const { input, approval } = fixture();
  input.history.purchases.priorRegularIssuanceIds = [];
  input.history.currentIssuanceIds = ["200"];
  blocked(recover(input, approval), "recovery_not_a_renewal", "excluded");
  const native = nativeFixture();
  native.ticketRead.tickets.shift();
  const result = selectNative(native);
  notSelected(result, "recovery_not_a_renewal");
  assert.equal(result.policyStatus, "excluded");
});

test("recovery leaves missing baseline missing, and cannot turn ordinary bootstrap into a new event", () => {
  const { input, approval } = fixture();
  input.ticket.issuedAt = "2026-10-22T02:30:00.000Z";
  for (const previous of [null, undefined]) {
    input.history.previousIssuanceIds = previous;
    const before = structuredClone(input);
    eligible(recover(input, approval));
    assert.deepEqual(input, before);
    blocked(evaluate(input), "initialize_without_events", "baseline");
  }
  const native = nativeFixture();
  const before = structuredClone(native);
  const selection = selected(selectNative(native));
  assert.equal(selection.history.previousIssuanceIds, null);
  assert.equal(selection.history.baselineCapturedAt, null);
  assert.deepEqual(native, before);
  blocked(evaluate({
    ...selection, ticket: { ...selection.ticket, issuedAt: selection.now },
  }), "initialize_without_events", "baseline");
});

test("approval does not advance or forge an existing observed baseline", () => {
  const { input, approval } = fixture();
  input.history.previousIssuanceIds = ["199", "200"];
  input.history.baselineCapturedAt = "2026-10-21T00:00:00.000Z";
  const before = structuredClone(input);
  eligible(recover(input, approval));
  assert.deepEqual(input, before);
  const native = nativeFixture();
  native.previousDownloadedAt = input.history.baselineCapturedAt;
  const selection = selected(selectNative(native));
  assert.equal(selection.history.previousIssuanceIds, null);
  assert.equal(selection.history.baselineCapturedAt, null);
  assert.equal(native.previousDownloadedAt, input.history.baselineCapturedAt);
});

test("permanent job key is unchanged by recovery, action, dates, terms, product or export digest", () => {
  const expected = `membership_contract_${createHash("sha256")
    .update(JSON.stringify(["studiomate-membership-v1", "100", "200"]))
    .digest("hex")}`;
  const { input, approval } = fixture();
  assert.equal(eligible(recover(input, approval)).jobKey, expected);
  assert.equal(selected(selectNative(nativeFixture())).jobKey, expected);
  const first = structuredClone(input);
  first.ticket.issuedAt = "2026-10-22T02:30:00.000Z";
  first.history.previousIssuanceIds = [];
  first.history.currentIssuanceIds = ["200"];
  first.history.baselineCapturedAt = "2026-10-22T02:00:00.000Z";
  first.history.purchases.priorRegularIssuanceIds = [];
  const ordinary = evaluate(first);
  assert.equal(ordinary.status, "eligible");
  assert.equal(ordinary.action, "first_purchase_contract");
  assert.equal(ordinary.jobKey, expected);
  input.ticket.productId = "301";
  input.ticket.issuedAt = "2026-10-06T00:00:00.000Z";
  input.policy.regularProductIds = ["301"];
  input.policy.termsVersion = "regular-v2";
  freshAt(input, "2026-10-22T04:00:00.000Z");
  approval.sourceSha256 = "b".repeat(64);
  assert.equal(eligible(recover(input, approval)).jobKey, expected);
  assert.notEqual(membershipContractJobKey("101", "200"), expected);
  assert.notEqual(membershipContractJobKey("100", "201"), expected);
});

const policyGuards = [
  ["stale actual source", (x) => { x.ticket.source.capturedAt = "2026-10-22T01:59:59.999Z"; }, "unverified_or_stale_source"],
  ["future actual source", (x) => { x.ticket.source.capturedAt = "2026-10-22T03:00:00.001Z"; }, "unverified_or_stale_source"],
  ["unverified actual source", (x) => { x.ticket.source.verified = false; }, "unverified_or_stale_source"],
  ["incomplete actual source despite approved export", (x) => { x.ticket.source.complete = false; }, "unverified_or_stale_source"],
  ["mirror source", (x) => { x.ticket.source.kind = "member360Cards"; }, "unverified_or_stale_source"],
  ["missing actual source", (x) => { x.ticket.source = null; }, "unverified_or_stale_source"],
  ["future issuance within October", (x) => { x.ticket.issuedAt = "2026-10-22T02:50:00.001Z"; }, "invalid_issuance_timestamp"],
  ["cutover still respected", (x) => { x.policy.cutoverAt = x.ticket.issuedAt; }, "historical_issuance", "ignored"],
  ["refunded", (x) => { x.ticket.refunded = true; }, "refunded_or_cancelled", "excluded"],
  ["cancelled", (x) => { x.ticket.cancelled = true; }, "refunded_or_cancelled", "excluded"],
  ["refunded status", (x) => { x.ticket.status = "refunded"; }, "refunded_or_cancelled", "excluded"],
  ["unknown refund", (x) => { x.ticket.refunded = undefined; }, "unverified_ticket_state"],
  ["unknown cancellation", (x) => { x.ticket.cancelled = null; }, "unverified_ticket_state"],
  ["inactive ticket", (x) => { x.ticket.status = "inactive"; }, "unverified_ticket_state"],
  ["member identity", (x) => { x.member.identityVerified = false; }, "unverified_native_identity"],
  ["ticket identity", (x) => { x.ticket.identityVerified = false; }, "unverified_native_identity"],
  ["different ticket owner", (x) => { x.ticket.memberId = "101"; }, "unverified_native_identity"],
  ["fallback member ID even with matching approval", (x, a) => { a.memberId = x.member.memberId = x.ticket.memberId = "excel_100"; }, "unverified_native_identity"],
  ["numeric member ID even with matching approval", (x, a) => { a.memberId = x.member.memberId = x.ticket.memberId = 100; }, "unverified_native_identity"],
  ["fallback issuance even with matching approval", (x, a) => { a.userTicketId = x.ticket.userTicketId = "excel_200"; }, "unverified_native_identity"],
  ["numeric issuance even with matching approval", (x, a) => { a.userTicketId = x.ticket.userTicketId = 200; }, "unverified_native_identity"],
  ["generic ID instead of native issuance", (x) => { x.ticket.ticketId = "200"; delete x.ticket.userTicketId; }, "invalid_october_recovery_approval"],
  ["missing native product", (x) => { delete x.ticket.productId; }, "unverified_native_identity"],
  ["nonallowlisted product", (x) => { x.ticket.productId = "301"; }, "product_not_allowlisted", "excluded"],
  ["empty allowlist", (x) => { x.policy.regularProductIds = []; }, "invalid_regular_product_allowlist"],
  ["duplicate allowlist", (x) => { x.policy.regularProductIds.push("300"); }, "invalid_regular_product_allowlist"],
  ["unverified payment", (x) => { x.ticket.payment.verified = false; }, "unverified_payment"],
  ["payment refund", (x) => { x.ticket.payment.refundedAmount = 1; }, "invalid_payment_balance"],
  ["payment mismatch", (x) => { x.ticket.payment.transactions[0].amount--; }, "payment_transaction_total_mismatch"],
  ["duplicate current IDs", (x) => { x.history.currentIssuanceIds.push("200"); }, "duplicate_issuance_ids"],
  ["missing selected issuance", (x) => { x.history.currentIssuanceIds = ["199"]; }, "issuance_missing_from_snapshot"],
  ["lost observed IDs", (x) => { x.history.previousIssuanceIds = ["198", "199"]; }, "lost_issuance_ids"],
  ["forged prior not in source", (x) => { x.history.purchases.priorRegularIssuanceIds = ["198"]; }, "invalid_purchase_history"],
  ["current issuance used as prior", (x) => { x.history.purchases.priorRegularIssuanceIds = ["200"]; }, "invalid_purchase_history"],
  ["duplicate prior", (x) => { x.history.purchases.priorRegularIssuanceIds.push("199"); }, "invalid_purchase_history"],
  ["fallback prior", (x) => { x.history.purchases.priorRegularIssuanceIds = ["excel_199"]; }, "invalid_purchase_history"],
];

for (const [name, mutate, reason, status = "review"] of policyGuards) {
  test(`approved recovery preserves ${name} guard`, () => {
    const { input, approval } = fixture();
    mutate(input, approval);
    blocked(recover(input, approval), reason, status);
  });
}

test("source freshness threshold is unchanged by the issuance-age exception", () => {
  const { input, approval } = fixture();
  input.ticket.source.capturedAt = "2026-10-22T02:00:00.000Z";
  eligible(recover(input, approval));
  input.ticket.source.capturedAt = "2026-10-22T01:59:59.999Z";
  blocked(recover(input, approval), "unverified_or_stale_source");
});

for (const field of ["member", "ticket"]) {
  for (const classification of ["staff", "trial", "instructor", "instructor_lesson", "one_off", "unknown", undefined]) {
    test(`operator approval never overrides ${field} classification ${classification}`, () => {
      const { input, approval } = fixture();
      input[field].classification = classification;
      const unknown = classification === "unknown" || classification === undefined;
      blocked(recover(input, approval), unknown ? "unknown_classification" : "excluded_classification", unknown ? "review" : "excluded");
    });
  }
}

for (const evidence of ["purchases", "contracts"]) {
  for (const [name, patch] of [
    ["not authoritative", { authoritative: false }],
    ["incomplete", { complete: false }],
    ["wrong member", { memberId: "101" }],
    ["stale before actual capture", { asOf: "2026-10-22T02:49:59.999Z" }],
    ["future", { asOf: "2026-10-22T03:00:00.001Z" }],
    ["missing time", { asOf: undefined }],
  ]) {
    test(`actual ${evidence} history must remain fresh and verified: ${name}`, () => {
      const { input, approval } = fixture();
      Object.assign(input.history[evidence], patch);
      blocked(recover(input, approval), "incomplete_or_unverified_history");
    });
  }
}

test("native recovery selects only the explicitly approved issuance even when another October pass exists", () => {
  const input = nativeFixture();
  input.ticketRead.tickets.push({ ...input.ticketRead.tickets[1], userTicketId: "201" });
  const selection = selected(selectNative(input));
  assert.equal(selection.ticket.issuedAt, "2026-10-05T03:00:00.000Z");
  assert.deepEqual(selection.history.currentIssuanceIds, ["199", "200", "201"]);
  assert.deepEqual(selection.history.purchases.priorRegularIssuanceIds, ["199"]);
});

test("native selector without approval retains the ordinary two-hour guard", () => {
  const input = nativeFixture();
  input.previousDownloadedAt = "2026-10-01T00:00:00.000Z";
  delete input.recoveryApproval;
  notSelected(selectNative(input), "stale_issuance");
  delete input.previousDownloadedAt;
  notSelected(selectNative(input), "incomplete_native_selection_source");
});

for (const [name, mutate, reason, status = "review"] of [
  ["unverified ticket read", (x) => { x.ticketRead.status = "review"; }, "incomplete_native_selection_source"],
  ["unverified contract read", (x) => { x.contractHistory.status = "review"; }, "incomplete_native_selection_source"],
  ["missing current source time", (x) => { delete x.sourceDownloadedAt; }, "incomplete_native_selection_source"],
  ["invalid current source time", (x) => { x.sourceDownloadedAt = "not-a-time"; }, "incomplete_native_selection_source"],
  ["phone mismatch", (x) => { x.member.phone = "01000000002"; }, "invalid_native_selection_policy"],
  ["wrong owner", (x) => { x.ticketRead.tickets[1].memberId = "101"; }, "unverified_native_identity"],
  ["fallback member", (x) => { x.member.memberId = x.recoveryApproval.memberId = x.ticketRead.tickets[1].memberId = "excel_100"; }, "unverified_native_identity"],
  ["refunded", (x) => { x.ticketRead.tickets[1].refunded = true; }, "refunded_or_cancelled"],
  ["cancelled", (x) => { x.ticketRead.tickets[1].cancelled = true; }, "refunded_or_cancelled"],
  ["unknown refund", (x) => { delete x.ticketRead.tickets[1].refunded; }, "unverified_ticket_state"],
  ["unknown cancellation", (x) => { delete x.ticketRead.tickets[1].cancelled; }, "unverified_ticket_state"],
  ["nonallowlisted product", (x) => { x.ticketRead.tickets[1].productId = "301"; }, "no_fresh_native_issuance", "ignored"],
  ["empty allowlist", (x) => { x.config.regularProductIds = []; }, "invalid_native_selection_policy"],
  ["duplicate target issuance", (x) => { x.ticketRead.tickets.push(structuredClone(x.ticketRead.tickets[1])); }, "multiple_fresh_native_issuances"],
]) {
  test(`native recovery preserves ${name} guard`, () => {
    const input = nativeFixture();
    mutate(input);
    notSelected(selectNative(input), reason, status);
  });
}

for (const [grade, reason, status] of [
  ["\uC2A4\uD15D", "staff_member_grade_excluded", "excluded"],
  ["\uCCB4\uD5D8\uD68C\uC6D0", "trial_member_grade_excluded", "excluded"],
  ["\uAC15\uC0AC\uD68C\uC6D0", "instructor_member_grade_excluded", "excluded"],
  ["unknown-grade", "unknown_member_grade", "review"],
]) {
  for (const field of ["group", "member"]) {
    test(`native approval retains ${field} grade guard: ${reason}`, () => {
      const input = nativeFixture();
      if (field === "group") input.group.rows[0]["\uB4F1\uAE09"] = grade;
      else input.member.memberGrade = grade;
      notSelected(selectNative(input), reason, status);
    });
  }
}

for (const flag of ["refunded", "cancelled"]) {
  test(`native ${flag} prior pass is not evidence of a renewal`, () => {
    const input = nativeFixture();
    input.ticketRead.tickets[0][flag] = true;
    const result = selectNative(input);
    notSelected(result, "recovery_not_a_renewal");
    assert.equal(result.policyStatus, "excluded");
  });
}

for (const status of ["draft", "opened", "sent", "signed", "cancelled", "expired"]) {
  test(`same-issuance ${status} contract blocks approved recreation in policy and selector`, () => {
    const { input, approval } = fixture();
    input.history.contracts.records = [{
      contractId: "a".repeat(64), userTicketId: "200", scope: "regular_membership",
      status, termsVersion: "regular-v1", applicable: true, revoked: status === "cancelled",
      signedAt: status === "signed" ? "2026-10-05T04:00:00.000Z" : undefined,
      validUntil: null,
    }];
    blocked(recover(input, approval), "existing_contract_for_issuance");
    const native = nativeFixture();
    native.contractHistory.records = [{
      contractId: "a".repeat(64), verified: true, memberId: "100", studioId: "5330",
      categoryId: 1, title: REGULAR_TITLE, status,
      signedAt: input.history.contracts.records[0].signedAt,
      ticket: { userTicketId: "200", productId: "300" },
    }];
    notSelected(selectNative(native), "existing_contract_for_issuance");
    native.contractHistory.records[0].ticket.userTicketId = "199";
    selected(selectNative(native));
  });
}

for (const [name, value] of [
  ["undefined", undefined], ["null", null], ["false", false], ["true", true],
  ["zero", 0], ["number", 123], ["empty string", ""], ["reference string", REFERENCE],
  ["empty array", []], ["array of reference", [REFERENCE]], ["empty object", {}],
  ["wrong nested shape", { approval: { reference: REFERENCE } }],
]) {
  test(`malformed approval never throws or grants recovery: ${name}`, () => {
    const { input } = fixture();
    let result;
    assert.doesNotThrow(() => { result = recover(input, value); });
    blocked(result, "invalid_october_recovery_approval");
    const native = nativeFixture();
    native.recoveryApproval = value;
    assert.doesNotThrow(() => { result = selectNative(native); });
    notSelected(result);
  });
}

test("valid approval with missing input still fails closed without throwing", () => {
  const { approval } = fixture();
  for (const input of [undefined, null, {}, { ticket: {} }, { member: {} }]) {
    let result;
    assert.doesNotThrow(() => { result = recover(input, approval); });
    blocked(result, "invalid_october_recovery_approval");
  }
});
