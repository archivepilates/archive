import assert from "node:assert/strict";
import test from "node:test";
import {
  baselineDiff,
  evaluateMembershipContractEligibility as evaluate,
  membershipContractJobKey,
  normalizeMembershipPhone,
} from "./studiomate-membership-contract-policy.mjs";

function fixture() {
  return {
    now: "2026-09-14T12:00:00+09:00",
    member: {
      memberId: "100",
      identityVerified: true,
      classification: "member",
    },
    ticket: {
      memberId: "100",
      userTicketId: "200",
      productId: "300",
      identityVerified: true,
      name: "Display only",
      classification: "regular",
      status: "active",
      refunded: false,
      cancelled: false,
      issuedAt: "2026-09-14T11:30:00+09:00",
      source: {
        kind: "studiomate_member_excel",
        verified: true,
        complete: true,
        capturedAt: "2026-09-14T11:50:00+09:00",
      },
      payment: {
        verified: true,
        complete: true,
        status: "paid",
        totalAmount: 100000,
        paidAmount: 100000,
        outstandingAmount: 0,
        refundedAmount: 0,
        transactions: [
          {
            paymentId: "payment-1",
            method: "card",
            status: "paid",
            amount: 100000,
            paidAt: "2026-09-14T11:31:00+09:00",
          },
        ],
      },
    },
    policy: {
      regularProductIds: ["300"],
      termsVersion: "regular-v1",
      cutoverAt: "2026-09-14T09:00:00+09:00",
      maxSourceAgeMs: 3600000,
      maxIssuanceAgeMs: 3600000,
    },
    history: {
      previousIssuanceIds: [],
      currentIssuanceIds: ["200"],
      baselineCapturedAt: "2026-09-14T11:00:00+09:00",
      purchases: {
        memberId: "100",
        authoritative: true,
        complete: true,
        asOf: "2026-09-14T11:50:00+09:00",
        priorRegularIssuanceIds: [],
      },
      contracts: {
        memberId: "100",
        authoritative: true,
        complete: true,
        asOf: "2026-09-14T11:50:00+09:00",
        records: [],
      },
    },
  };
}

function renewal() {
  const input = fixture();
  input.history.previousIssuanceIds = ["199"];
  input.history.currentIssuanceIds = ["199", "200"];
  input.history.purchases.priorRegularIssuanceIds = ["199"];
  input.history.contracts.records = [
    {
      contractId: "contract-1",
      scope: "regular_membership",
      status: "signed",
      termsVersion: "regular-v1",
      applicable: true,
      revoked: false,
      signedAt: "2026-08-01T10:00:00+09:00",
      validUntil: null,
    },
  ];
  return input;
}

function blocked(input, reason) {
  const result = evaluate(input);
  assert.equal(result.eligibleForDetection, false);
  assert.equal(result.sendAllowed, false);
  assert.equal(result.action, null);
  assert.equal(result.jobKey, null);
  if (reason)
    assert.ok(result.reasons.includes(reason), JSON.stringify(result));
  return result;
}

test("phone normalization is stable and does not coerce numeric or malformed input", () => {
  for (const value of [
    "010-0000-0000",
    "+82 10 0000 0000",
    "821000000000",
    "0082-10-0000-0000",
    "1000000000",
    "(010) 0000.0000",
  ]) {
    assert.equal(normalizeMembershipPhone(value), "01000000000");
    assert.equal(
      normalizeMembershipPhone(normalizeMembershipPhone(value)),
      "01000000000",
    );
  }
  for (const value of [
    null,
    undefined,
    1000000000,
    "abc01000000000",
    "01000000000 ext 2",
    "+1 01000000000",
    "01000000000/01000000000",
    "",
  ]) {
    assert.equal(normalizeMembershipPhone(value), "");
  }
});

test("job identity uses an unambiguous SHA256 native-member/issuance tuple only", () => {
  const key = membershipContractJobKey("100", "200");
  assert.match(key, /^membership_contract_[a-f0-9]{64}$/);
  assert.equal(key, membershipContractJobKey("100", "200"));
  assert.notEqual(key, membershipContractJobKey("101", "200"));
  assert.notEqual(key, membershipContractJobKey("100", "201"));
  assert.notEqual(
    membershipContractJobKey("1", "23"),
    membershipContractJobKey("12", "3"),
  );
  for (const value of [
    null,
    undefined,
    "",
    100,
    "excel_100",
    "usage_100",
    "0100",
    " 100",
    "100|200",
  ]) {
    assert.throws(() => membershipContractJobKey(value, "200"), TypeError);
    assert.throws(() => membershipContractJobKey("100", value), TypeError);
  }
});

test("first baseline emits nothing; established empty baseline can detect new IDs", () => {
  for (const previous of [null, undefined]) {
    assert.deepEqual(baselineDiff(previous, ["201", "200"]).newIds, []);
    assert.equal(baselineDiff(previous, ["200"]).status, "baseline");
  }
  assert.deepEqual(baselineDiff([], ["200"]).newIds, ["200"]);
  assert.equal(baselineDiff(["200"], ["200"]).status, "unchanged");
  assert.deepEqual(baselineDiff(["200"], ["201", "200"]).newIds, ["201"]);
});

test("duplicates, lost IDs and malformed snapshots suppress the whole delta", () => {
  for (const [previous, current, reason] of [
    [null, ["200", "200"], "duplicate_issuance_ids"],
    [["199", "199"], ["199", "200"], "duplicate_issuance_ids"],
    [["199"], ["200"], "lost_issuance_ids"],
    [["199"], ["199", ""], "invalid_issuance_ids"],
    [[], [200], "invalid_issuance_ids"],
    ["199", ["200"], "invalid_issuance_ids"],
    [[], null, "invalid_issuance_ids"],
  ]) {
    const result = baselineDiff(previous, current);
    assert.equal(result.status, "review");
    assert.ok(result.reasons.includes(reason));
    assert.deepEqual(result.newIds, []);
  }
  const lost = baselineDiff(["199"], ["200"]);
  assert.deepEqual(lost.observedIds, ["199", "200"]);
  assert.deepEqual(baselineDiff(lost.observedIds, ["199", "200"]).newIds, []);
});

test("complete first purchase and applicable signed-member renewal are detection-only", () => {
  for (const [input, action] of [
    [fixture(), "first_purchase_contract"],
    [renewal(), "renewal_purchase_confirmation"],
  ]) {
    const before = structuredClone(input);
    const result = evaluate(input);
    assert.equal(result.status, "eligible");
    assert.equal(result.action, action);
    assert.equal(result.sendAllowed, false);
    assert.equal(result.jobKey, membershipContractJobKey("100", "200"));
    assert.deepEqual(input, before);
  }
});

test("missing native IDs never fall back to generic ticketId or phone", () => {
  for (const update of [
    (x) => {
      x.member.memberId = "excel_100";
    },
    (x) => {
      x.member.identityVerified = false;
    },
    (x) => {
      x.ticket.memberId = "101";
    },
    (x) => {
      x.ticket.userTicketId = "";
      x.ticket.ticketId = "200";
    },
    (x) => {
      delete x.ticket.productId;
      x.ticket.ticketId = "300";
    },
    (x) => {
      x.ticket.productId = 300;
    },
    (x) => {
      x.ticket.identityVerified = false;
    },
  ]) {
    const input = fixture();
    update(input);
    blocked(input, "unverified_native_identity");
  }
});

test("product and issuance IDs have separate semantics, not necessarily different digits", () => {
  const input = fixture();
  const key = evaluate(input).jobKey;
  input.ticket.productId = input.ticket.userTicketId;
  blocked(input, "product_not_allowlisted");
  input.policy.regularProductIds = [input.ticket.productId];
  assert.equal(evaluate(input).jobKey, key);
});

test("regular eligibility requires explicit classification and exact configured product ID", () => {
  for (const allowlist of [
    undefined,
    [],
    [300],
    ["300", "300"],
    [" 300"],
    "300",
  ]) {
    const input = fixture();
    input.policy.regularProductIds = allowlist;
    blocked(input, "invalid_regular_product_allowlist");
  }
  const wrong = fixture();
  wrong.ticket.productId = "301";
  blocked(wrong, "product_not_allowlisted");
  for (const classification of [undefined, "", "unknown", "REGULAR"]) {
    const input = fixture();
    input.ticket.classification = classification;
    input.ticket.name = "Regular paid membership";
    blocked(input, "unknown_classification");
  }
  for (const classification of [
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
  ]) {
    const input = fixture();
    input.ticket.classification = classification;
    assert.equal(blocked(input).status, "excluded");
  }
  for (const classification of ["staff", "instructor", undefined]) {
    const input = fixture();
    input.member.classification = classification;
    blocked(input);
  }
});

test("refunded, cancelled and unverified states cannot qualify", () => {
  for (const patch of [
    { refunded: true },
    { cancelled: true },
    { status: "refunded" },
    { status: "cancelled" },
    { status: "expired" },
    { refunded: null },
    { cancelled: undefined },
  ]) {
    const input = fixture();
    Object.assign(input.ticket, patch);
    blocked(input);
  }
  const scheduled = fixture();
  scheduled.ticket.status = "scheduled";
  assert.equal(evaluate(scheduled).status, "eligible");
});

test("payment amounts never coerce null, strings, boolean, nonfinite or fractional input", () => {
  for (const field of [
    "totalAmount",
    "paidAmount",
    "outstandingAmount",
    "refundedAmount",
  ]) {
    for (const value of [
      null,
      undefined,
      "0",
      "100000",
      false,
      NaN,
      Infinity,
      -1,
      0.5,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      const input = fixture();
      input.ticket.payment[field] = value;
      blocked(input, "invalid_payment_amounts");
    }
  }
  for (const patch of [
    { paidAmount: 0 },
    { totalAmount: 0 },
    { outstandingAmount: 1 },
    { refundedAmount: 1 },
    { paidAmount: 99999 },
    { status: "pending" },
    { verified: false },
    { complete: false },
  ]) {
    const input = fixture();
    Object.assign(input.ticket.payment, patch);
    blocked(input);
  }
});

test("mixed settled payments, points and card installments must reconcile exactly", () => {
  const input = fixture();
  const base = input.ticket.payment.transactions[0];
  input.ticket.payment.transactions = [
    { ...base, amount: 50000, installmentMonths: 3 },
    { ...base, paymentId: "payment-2", method: "cash", amount: 30000 },
    { ...base, paymentId: "payment-3", method: "point", amount: 20000 },
  ];
  assert.equal(evaluate(input).status, "eligible");
  for (const update of [
    (x) => {
      x.ticket.payment.transactions[1].amount = 29999;
    },
    (x) => {
      x.ticket.payment.transactions[1].status = "pending";
    },
    (x) => {
      x.ticket.payment.transactions[1].paymentId = "payment-1";
    },
    (x) => {
      x.ticket.payment.transactions[1].installmentMonths = 3;
    },
    (x) => {
      x.ticket.payment.transactions[0].installmentMonths = null;
    },
    (x) => {
      x.ticket.payment.transactions[0].installmentMonths = "3";
    },
    (x) => {
      x.ticket.payment.transactions[0].amount = null;
    },
    (x) => {
      x.ticket.payment.transactions[0].method = "points";
    },
    (x) => {
      x.ticket.payment.transactions = [];
    },
  ]) {
    const copy = structuredClone(input);
    update(copy);
    blocked(copy);
  }
});

test("unpaid and partially paid issued tickets remain contract-eligible", () => {
  const unpaid = fixture();
  Object.assign(unpaid.ticket.payment, {
    status: "unpaid",
    totalAmount: 398000,
    paidAmount: 0,
    outstandingAmount: 398000,
    transactions: [],
  });
  assert.equal(evaluate(unpaid).status, "eligible");

  const partial = fixture();
  Object.assign(partial.ticket.payment, {
    status: "partial",
    totalAmount: 398000,
    paidAmount: 100000,
    outstandingAmount: 298000,
  });
  partial.ticket.payment.transactions[0].amount = 100000;
  assert.equal(evaluate(partial).status, "eligible");
});

test("payment timing does not determine eligibility for an issued ticket", () => {
  for (const paidAt of [
    "2026-09-14T11:29:56+09:00",
    "2026-09-14T11:27:34+09:00",
    "2026-09-14T11:25:00+09:00",
    "2026-08-01T10:00:00+09:00",
    "2026-09-15T00:00:00+09:00",
  ]) {
    const input = fixture();
    input.ticket.payment.transactions[0].paidAt = paidAt;
    assert.equal(evaluate(input).status, "eligible");
  }
});

test("explicit timezone equivalents agree; date-only, impossible and future times fail closed", () => {
  const utc = fixture();
  utc.ticket.issuedAt = "2026-09-14T02:30:00Z";
  assert.deepEqual(evaluate(utc), evaluate(fixture()));
  for (const value of [
    null,
    "2026-09-14",
    "2026-09-14T11:30:00",
    "2026-02-30T11:30:00+09:00",
    "2026-09-14T24:00:00+09:00",
    "2026-09-14T11:30:00+14:30",
    "2026-09-14T12:01:00+09:00",
  ]) {
    const input = fixture();
    input.ticket.issuedAt = value;
    blocked(input, "invalid_issuance_timestamp");
  }
  for (const patch of [
    { complete: false },
    { verified: false },
    { kind: "legacy_backfill" },
    { capturedAt: "2026-09-14T12:01:00+09:00" },
    { capturedAt: "2026-09-14T10:59:59+09:00" },
  ]) {
    const input = fixture();
    Object.assign(input.ticket.source, patch);
    blocked(input, "unverified_or_stale_source");
  }
  for (const patch of [
    { cutoverAt: "2026-09-15T00:00:00+09:00" },
    { maxSourceAgeMs: null },
    { maxIssuanceAgeMs: "3600000" },
    { termsVersion: "" },
  ]) {
    const input = fixture();
    Object.assign(input.policy, patch);
    blocked(input, "invalid_time_policy");
  }
});

test("cutover, stale issuance, lost IDs and absent baseline cannot create historical events", () => {
  for (const update of [
    (x) => {
      x.ticket.issuedAt = x.policy.cutoverAt;
    },
    (x) => {
      x.ticket.issuedAt = "2026-09-14T10:59:59+09:00";
    },
    (x) => {
      x.ticket.issuedAt = x.history.baselineCapturedAt;
    },
    (x) => {
      x.history.baselineCapturedAt = x.ticket.source.capturedAt;
    },
    (x) => {
      x.history.baselineCapturedAt = null;
    },
    (x) => {
      x.history.previousIssuanceIds = null;
    },
    (x) => {
      x.history.previousIssuanceIds = ["199"];
    },
    (x) => {
      x.history.currentIssuanceIds = ["200", "200"];
    },
    (x) => {
      x.history.currentIssuanceIds = [];
    },
  ]) {
    const input = fixture();
    update(input);
    blocked(input);
  }
});

test("mutable updates never create another event or alter the job identity", () => {
  const input = fixture();
  const key = evaluate(input).jobKey;
  Object.assign(input.ticket, {
    name: "Renamed",
    remainingCount: 0,
    startDate: "2026-10-01",
    endDate: "2027-01-01",
  });
  assert.equal(evaluate(input).jobKey, key);
  input.history.previousIssuanceIds = ["200"];
  blocked(input, "issuance_already_observed");
});

test("legacy or incomplete history is not evidence of first purchase", () => {
  for (const field of ["purchases", "contracts"]) {
    for (const patch of [
      null,
      { authoritative: false },
      { complete: false },
      { memberId: "101" },
      { asOf: "2026-09-14T11:49:59+09:00" },
      { asOf: "2026-09-14T12:00:01+09:00" },
    ]) {
      const input = fixture();
      input.history[field] =
        patch === null ? null : { ...input.history[field], ...patch };
      blocked(input, "incomplete_or_unverified_history");
    }
  }
  const existing = renewal();
  existing.history.contracts.records = [];
  blocked(existing, "prior_purchase_without_signed_contract");
  const legacy = renewal();
  legacy.member.registeredAt = "2025-03-07T00:00:00+09:00";
  legacy.history.contracts.records = [];
  const legacyResult = blocked(legacy, "legacy_member_before_contract_cutover");
  assert.equal(legacyResult.status, "ignored");
  const postCutover = renewal();
  postCutover.member.registeredAt = "2026-09-14T09:00:01+09:00";
  postCutover.history.contracts.records = [];
  blocked(postCutover, "prior_purchase_without_signed_contract");
  const invalid = fixture();
  invalid.history.purchases.priorRegularIssuanceIds = ["200"];
  blocked(invalid, "invalid_purchase_history");
});

test("renewal requires an applicable signed regular contract and exact terms version", () => {
  for (const patch of [
    { status: "sent" },
    { status: "completed" },
    { scope: "instructor_consent" },
    { termsVersion: "old" },
    { applicable: false },
    { revoked: true },
    { revoked: undefined },
    { signedAt: null },
    { signedAt: "2026-09-14T11:51:00+09:00" },
    { validUntil: "2026-09-14T12:00:00+09:00" },
    { validUntil: "invalid" },
  ]) {
    const input = renewal();
    Object.assign(input.history.contracts.records[0], patch);
    blocked(input);
  }
  const duplicate = renewal();
  duplicate.history.contracts.records.push({
    ...duplicate.history.contracts.records[0],
  });
  blocked(duplicate, "invalid_contract_history");
  const gap = renewal();
  gap.history.purchases.priorRegularIssuanceIds = [];
  blocked(gap, "signed_contract_without_prior_regular_purchase");
});

test("a good signature cannot hide incomplete or contradictory contract history", () => {
  for (const patch of [
    { signedAt: null },
    { termsVersion: undefined },
    { applicable: undefined },
    { validUntil: undefined },
    { status: "expired" },
    { status: "cancelled" },
  ]) {
    const input = renewal();
    input.history.contracts.records.push({
      ...input.history.contracts.records[0],
      contractId: "contract-2",
      ...patch,
    });
    blocked(input);
  }
  const input = fixture();
  input.history.contracts.records = [
    {
      contractId: "contract-1",
      scope: "regular_membership",
      status: "expired",
      signedAt: "2026-08-01T00:00:00Z",
    },
  ];
  blocked(input, "conflicting_signature_history");
});

test("sparse arrays cannot assert complete evidence", () => {
  assert.equal(baselineDiff([], Array(1)).status, "review");
  assert.equal(baselineDiff(Array(1), ["200"]).status, "review");
  for (const update of [
    (x) => {
      x.policy.regularProductIds = Array(1);
    },
    (x) => {
      x.history.purchases.priorRegularIssuanceIds = Array(1);
    },
    (x) => {
      x.history.contracts.records = Array(1);
    },
    (x) => {
      x.ticket.payment.transactions = Array(1);
    },
  ]) {
    const input = fixture();
    update(input);
    blocked(input);
  }
});

test("missing input never throws or grants permission", () => {
  for (const input of [undefined, null, {}, { ticket: {} }])
    blocked(input, "missing_input");
  const input = fixture();
  input.now = null;
  blocked(input, "invalid_time_policy");
});
