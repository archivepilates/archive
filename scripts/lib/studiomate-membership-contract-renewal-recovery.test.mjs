import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  baselineDiff,
  evaluateMembershipContractEligibility as evaluate,
  membershipContractJobKey,
} from "./studiomate-membership-contract-policy.mjs";
import { selectNativeMembershipContractCandidate as selectNative } from "./studiomate-membership-contract-native-selection.mjs";
import { isFreshContractDiscoverySource } from "./studiomate-membership-contract-observer.mjs";
import { readExactStudioMateMember } from "./studiomate-native-contract-source.mjs";

// Synthetic evidence follows the existing policy fixture, with a fresh October issuance.
function fixture() {
  return {
    now: "2026-10-22T03:00:00.000Z",
    member: {
      memberId: "100",
      identityVerified: true,
      classification: "member",
      registeredAt: "2025-03-07T00:00:00.000Z",
    },
    ticket: {
      memberId: "100",
      userTicketId: "200",
      productId: "300",
      identityVerified: true,
      name: "Synthetic regular membership",
      classification: "regular",
      status: "active",
      refunded: false,
      cancelled: false,
      issuedAt: "2026-10-22T02:30:00.000Z",
      source: {
        kind: "studiomate_member_excel",
        verified: true,
        complete: true,
        capturedAt: "2026-10-22T02:50:00.000Z",
      },
      payment: {
        verified: true,
        complete: true,
        status: "paid",
        totalAmount: 398000,
        paidAmount: 398000,
        outstandingAmount: 0,
        refundedAmount: 0,
        transactions: [{
          paymentId: "synthetic-payment-200",
          method: "card",
          status: "paid",
          amount: 398000,
          paidAt: "2026-10-22T02:31:00.000Z",
        }],
      },
    },
    policy: {
      regularProductIds: ["300"],
      termsVersion: "regular-v1",
      cutoverAt: "2026-09-14T00:00:00.000Z",
      maxSourceAgeMs: 3600000,
      maxIssuanceAgeMs: 3600000,
    },
    history: {
      previousIssuanceIds: [],
      currentIssuanceIds: ["200"],
      baselineCapturedAt: "2026-10-22T02:00:00.000Z",
      purchases: {
        memberId: "100",
        authoritative: true,
        complete: true,
        asOf: "2026-10-22T02:50:00.000Z",
        priorRegularIssuanceIds: [],
      },
      contracts: {
        memberId: "100",
        authoritative: true,
        complete: true,
        asOf: "2026-10-22T02:50:00.000Z",
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
  return input;
}

// Policy rows use the native issuance binding, not product ID or contract ID.
function signedRegular(userTicketId = "199", contractId = "a".repeat(64)) {
  return {
    contractId,
    userTicketId,
    scope: "regular_membership",
    status: "signed",
    termsVersion: "regular-v1",
    applicable: true,
    revoked: false,
    signedAt: "2026-09-20T01:00:00.000Z",
    validUntil: null,
  };
}

function unsignedRegular(userTicketId, status = "sent") {
  return {
    contractId: "b".repeat(64),
    scope: "regular_membership",
    status,
    ...(userTicketId === undefined ? {} : { userTicketId }),
  };
}

function eligible(input, action = "renewal_purchase_confirmation") {
  const before = structuredClone(input);
  const result = evaluate(input);
  assert.equal(result.status, "eligible", JSON.stringify(result));
  assert.equal(result.eligibleForDetection, true);
  assert.equal(result.action, action);
  assert.equal(result.sendAllowed, false);
  assert.equal(result.jobKey, membershipContractJobKey(input.member.memberId, input.ticket.userTicketId));
  assert.deepEqual(input, before, "evaluation must not mutate evidence");
  return result;
}

function blocked(input, reason, status) {
  const result = evaluate(input);
  assert.equal(result.eligibleForDetection, false, JSON.stringify(result));
  assert.equal(result.sendAllowed, false);
  assert.equal(result.action, null);
  assert.equal(result.jobKey, null);
  if (reason) assert.ok(result.reasons.includes(reason), JSON.stringify(result));
  if (status) assert.equal(result.status, status, JSON.stringify(result));
  return result;
}

for (const registeredAt of [
  undefined,
  "2025-03-07T00:00:00.000Z",
  "2026-09-14T00:00:00.000Z",
  "2026-09-14T00:00:01.000Z",
]) {
  test(`fresh verified prior regular purchase renews without electronic signature: registeredAt=${registeredAt}`, () => {
    const input = renewal();
    input.member.registeredAt = registeredAt;
    eligible(input);
  });
}

test("first regular purchase stays first-purchase even for a pre-cutover registered member", () => {
  eligible(fixture(), "first_purchase_contract");
});

test("scheduled independent regular issuance also renews without an electronic signature", () => {
  const input = renewal();
  input.ticket.status = "scheduled";
  eligible(input);
});

for (const status of ["draft", "opened", "sent"]) {
  test(`unsigned ${status} contract bound to an older issuance does not block a new independent renewal`, () => {
    const input = renewal();
    input.history.contracts.records = [unsignedRegular("199", status)];
    eligible(input);
  });

  test(`unsigned ${status} regular contract with unknown binding still requires review`, () => {
    const input = renewal();
    input.history.contracts.records = [unsignedRegular(undefined, status)];
    blocked(input, undefined, "review");
  });

  test(`unsigned ${status} contract already bound to the new issuance requires review`, () => {
    const input = renewal();
    input.history.contracts.records = [unsignedRegular("200", status)];
    blocked(input, undefined, "review");
  });
}

for (const binding of ["", null, "excel_199", " 199", 199]) {
  test(`malformed unsigned regular issuance binding is not an independent prior contract: ${JSON.stringify(binding)}`, () => {
    const input = renewal();
    input.history.contracts.records = [unsignedRegular(binding)];
    blocked(input, undefined, "review");
  });
}

for (const userTicketId of ["199", "200"]) {
  for (const statuses of [["signed", "signed"], ["sent", "opened"], ["signed", "sent"]]) {
    test(`distinct contract IDs for SAME userTicketId=${userTicketId} (${statuses.join("/")}) require review`, () => {
      const input = renewal();
      input.history.contracts.records = statuses.map((status, index) => ({
        ...(status === "signed" ? signedRegular(userTicketId) : unsignedRegular(userTicketId, status)),
        contractId: String(index + 1).repeat(64),
      }));
      blocked(input, undefined, "review");
    });
  }
}

test("duplicate contract IDs remain invalid even when their issuance bindings differ", () => {
  const input = renewal();
  input.history.contracts.records = [signedRegular("199"), signedRegular("200")];
  blocked(input, "invalid_contract_history", "review");
});

for (const patch of [
  { status: "expired" }, { status: "cancelled" }, { signedAt: null },
  { signedAt: "2026-10-22T03:00:01.000Z" }, { termsVersion: undefined },
  { applicable: undefined }, { revoked: undefined }, { validUntil: undefined },
]) {
  test(`prior purchase cannot hide contradictory or incomplete regular signature: ${Object.keys(patch)[0]}=${Object.values(patch)[0]}`, () => {
    const input = renewal();
    input.history.contracts.records = [{ ...signedRegular(), ...patch }];
    blocked(input, undefined, "review");
  });
}

for (const firstPurchase of [false, true]) {
  test(`signed other-scope consent needs no regular termsVersion and cannot classify a ${firstPurchase ? "first purchase as renewal" : "renewal as first purchase"}`, () => {
    const input = firstPurchase ? fixture() : renewal();
    input.history.contracts.records = [{
      contractId: "c".repeat(64),
      scope: "other",
      status: "signed",
      applicable: false,
      revoked: false,
      signedAt: "2026-09-01T00:00:00.000Z",
      validUntil: null,
    }];
    eligible(input, firstPurchase ? "first_purchase_contract" : "renewal_purchase_confirmation");
  });
}

test("one signed base plus a signed past renewal for distinct issuances permits the next renewal", () => {
  const input = renewal();
  input.history.previousIssuanceIds.unshift("198");
  input.history.currentIssuanceIds.unshift("198");
  input.history.purchases.priorRegularIssuanceIds.unshift("198");
  input.history.contracts.records = [
    signedRegular("198"),
    { ...signedRegular("199", "d".repeat(64)), signedAt: "2026-10-01T01:00:00.000Z" },
  ];
  eligible(input);
});

test("permanent issuance job key stays byte-for-byte unchanged across first/renewal action, signature, dates, terms and product", () => {
  const expected = `membership_contract_${createHash("sha256")
    .update(JSON.stringify(["studiomate-membership-v1", "100", "200"]))
    .digest("hex")}`;
  const first = eligible(fixture(), "first_purchase_contract");
  const recovered = eligible(renewal());
  const signed = renewal();
  signed.history.contracts.records = [signedRegular()];
  const changed = renewal();
  changed.now = "2026-10-22T03:01:00.000Z";
  changed.member.registeredAt = "2026-10-01T00:00:00.000Z";
  changed.ticket.name = "Different display name";
  changed.ticket.productId = "301";
  changed.ticket.issuedAt = "2026-10-22T02:32:00.000Z";
  changed.policy.regularProductIds = ["301"];
  changed.policy.termsVersion = "regular-v2";
  for (const result of [first, recovered, eligible(signed), eligible(changed)]) {
    assert.equal(result.jobKey, expected);
  }
  assert.notEqual(expected, membershipContractJobKey("101", "200"));
  assert.notEqual(expected, membershipContractJobKey("100", "201"));
});

const guardCases = [
  ["Excel fallback member ID", (x) => { x.member.memberId = x.ticket.memberId = "excel_100"; }, "unverified_native_identity"],
  ["numeric rather than native string member ID", (x) => { x.member.memberId = x.ticket.memberId = 100; }, "unverified_native_identity"],
  ["unverified member identity", (x) => { x.member.identityVerified = false; }, "unverified_native_identity"],
  ["unverified issuance identity", (x) => { x.ticket.identityVerified = false; }, "unverified_native_identity"],
  ["different ticket owner", (x) => { x.ticket.memberId = "101"; }, "unverified_native_identity"],
  ["generic ticketId replacing native issuance", (x) => { x.ticket.userTicketId = ""; x.ticket.ticketId = "200"; }, "unverified_native_identity"],
  ["fallback issuance ID", (x) => { x.ticket.userTicketId = "usage_200"; }, "unverified_native_identity"],
  ["missing native product ID", (x) => { delete x.ticket.productId; x.ticket.ticketId = "300"; }, "unverified_native_identity"],
  ["unverified source", (x) => { x.ticket.source.verified = false; }, "unverified_or_stale_source"],
  ["incomplete source", (x) => { x.ticket.source.complete = false; }, "unverified_or_stale_source"],
  ["currentpass source replacing purchase export", (x) => { x.ticket.source.kind = "studiomate_currentpass"; }, "unverified_or_stale_source"],
  ["derived CRM source", (x) => { x.ticket.source.kind = "member360Cards"; }, "unverified_or_stale_source"],
  ["missing source", (x) => { delete x.ticket.source; }, "unverified_or_stale_source"],
  ["stale source", (x) => { x.ticket.source.capturedAt = "2026-10-22T01:59:59.000Z"; }, "unverified_or_stale_source"],
  ["future source", (x) => { x.ticket.source.capturedAt = "2026-10-22T03:00:01.000Z"; }, "unverified_or_stale_source"],
  ["issuance newer than capture", (x) => { x.ticket.issuedAt = "2026-10-22T02:50:01.000Z"; }, "invalid_issuance_timestamp"],
  ["stale issuance", (x) => { x.ticket.issuedAt = "2026-10-22T01:59:59.000Z"; }, "stale_issuance"],
  ["historical issuance at cutover", (x) => { x.ticket.issuedAt = x.policy.cutoverAt; }, "historical_issuance"],
  ["late discovery at baseline", (x) => { x.ticket.issuedAt = x.history.baselineCapturedAt; }, "late_discovered_issuance_no_backfill"],
  ["already observed issuance", (x) => { x.history.previousIssuanceIds.push("200"); }, "issuance_already_observed"],
  ["currentpass-only snapshot losing prior issuance", (x) => { x.history.currentIssuanceIds = ["200"]; }, "lost_issuance_ids"],
  ["new issuance absent from snapshot", (x) => { x.history.currentIssuanceIds = ["199"]; }, "issuance_missing_from_snapshot"],
  ["duplicate snapshot ID", (x) => { x.history.currentIssuanceIds.push("200"); }, "duplicate_issuance_ids"],
  ["refunded ticket", (x) => { x.ticket.refunded = true; }, "refunded_or_cancelled"],
  ["cancelled ticket", (x) => { x.ticket.cancelled = true; }, "refunded_or_cancelled"],
  ["unknown refund state", (x) => { delete x.ticket.refunded; }, "unverified_ticket_state"],
  ["unknown cancellation state", (x) => { x.ticket.cancelled = null; }, "unverified_ticket_state"],
  ["inactive current pass", (x) => { x.ticket.status = "inactive"; }, "unverified_ticket_state"],
  ["expired current pass", (x) => { x.ticket.status = "expired"; }, "unverified_ticket_state"],
  ["unverified payment", (x) => { x.ticket.payment.verified = false; }, "unverified_payment"],
  ["incomplete payment", (x) => { x.ticket.payment.complete = false; }, "unverified_payment"],
  ["refunded amount hidden behind paid status", (x) => { x.ticket.payment.refundedAmount = 1000; }, "invalid_payment_balance"],
  ["payment transaction mismatch", (x) => { x.ticket.payment.transactions[0].amount--; }, "payment_transaction_total_mismatch"],
  ["non-allowlisted product", (x) => { x.ticket.productId = "301"; }, "product_not_allowlisted"],
  ["empty product allowlist", (x) => { x.policy.regularProductIds = []; }, "invalid_regular_product_allowlist"],
  ["numeric product allowlist", (x) => { x.policy.regularProductIds = [300]; }, "invalid_regular_product_allowlist"],
  ["duplicate product allowlist", (x) => { x.policy.regularProductIds.push("300"); }, "invalid_regular_product_allowlist"],
  ["prior evidence includes this new issuance", (x) => { x.history.purchases.priorRegularIssuanceIds = ["200"]; }, "invalid_purchase_history"],
  ["duplicate prior evidence", (x) => { x.history.purchases.priorRegularIssuanceIds.push("199"); }, "invalid_purchase_history"],
  ["fallback prior evidence", (x) => { x.history.purchases.priorRegularIssuanceIds = ["excel_199"]; }, "invalid_purchase_history"],
  ["prior evidence absent from complete snapshot", (x) => { x.history.purchases.priorRegularIssuanceIds = ["198"]; }, "invalid_purchase_history"],
  ["missing baseline timestamp", (x) => { delete x.history.baselineCapturedAt; }, "invalid_baseline_time"],
  ["pre-cutover baseline", (x) => { x.history.baselineCapturedAt = "2026-09-13T23:59:59.000Z"; }, "invalid_baseline_time"],
  ["baseline at current capture", (x) => { x.history.baselineCapturedAt = x.ticket.source.capturedAt; }, "invalid_baseline_time"],
  ["missing terms policy", (x) => { delete x.policy.termsVersion; }, "invalid_time_policy"],
];

for (const [name, mutate, reason] of guardCases) {
  test(`renewal recovery preserves guard: ${name}`, () => {
    const input = renewal();
    mutate(input);
    blocked(input, reason);
  });
}

for (const field of ["member", "ticket"]) {
  for (const classification of [
    "trial", "one_off", "oneoff", "instructor", "instructor_lesson", "staff",
    "compensation", "complimentary", "gift", "transfer", "test", undefined, "unknown",
  ]) {
    test(`prior regular history cannot override ${field} classification=${classification}`, () => {
      const input = renewal();
      input[field].classification = classification;
      blocked(input, [undefined, "unknown"].includes(classification) ? "unknown_classification" : "excluded_classification");
    });
  }
}

for (const evidence of ["purchases", "contracts"]) {
  for (const [name, patch] of [
    ["unverified", { authoritative: false }],
    ["incomplete", { complete: false }],
    ["different member", { memberId: "101" }],
    ["older than source", { asOf: "2026-10-22T02:49:59.000Z" }],
    ["future", { asOf: "2026-10-22T03:00:01.000Z" }],
    ["missing timestamp", { asOf: undefined }],
  ]) {
    test(`unsigned renewal still requires ${evidence} history: ${name}`, () => {
      const input = renewal();
      Object.assign(input.history[evidence], patch);
      blocked(input, "incomplete_or_unverified_history", "review");
    });
  }
}

test("renewal cannot turn missing previous baseline into a recovery event", () => {
  for (const previous of [null, undefined]) {
    const input = renewal();
    input.history.previousIssuanceIds = previous;
    blocked(input, "initialize_without_events", "baseline");
    assert.equal(baselineDiff(previous, input.history.currentIssuanceIds).status, "baseline");
  }
});

test("established empty baseline is not proof of prior purchase or permission to omit baseline time", () => {
  assert.deepEqual(baselineDiff([], ["200"]).newIds, ["200"]);
  eligible(fixture(), "first_purchase_contract");
  const missingTime = fixture();
  delete missingTime.history.baselineCapturedAt;
  blocked(missingTime, "invalid_baseline_time", "review");
  const inventedPrior = renewal();
  inventedPrior.history.previousIssuanceIds = [];
  inventedPrior.history.currentIssuanceIds = ["200"];
  blocked(inventedPrior, "invalid_purchase_history", "review");
});

function nativeFixture() {
  const input = renewal();
  const current = {
    ...input.ticket,
    title: "10-week regular group",
    source: "studiomate_native_ticket",
    verified: true,
    complete: true,
    studioId: "5330",
  };
  return {
    group: { phone: "01000000001", rows: [{ "수강권명": current.title, "등급": "VIP" }] },
    member: { ...input.member, name: "Synthetic Member", phone: "01000000001" },
    ticketRead: {
      status: "verified",
      tickets: [
        { ...current, userTicketId: "199", issuedAt: "2026-09-01T00:00:00.000Z" },
        current,
      ],
    },
    contractHistory: { status: "verified", records: [] },
    previousDownloadedAt: input.history.baselineCapturedAt,
    sourceDownloadedAt: input.ticket.source.capturedAt,
    config: { ...input.policy, studioId: "5330", signExpirationDays: 7 },
  };
}

test("native selector recovers a pre-cutover member's verified fresh renewal with no electronic contract", () => {
  const result = selectNative(nativeFixture());
  assert.equal(result.status, "eligible", JSON.stringify(result));
  assert.equal(result.selection.action, "renewal_purchase_confirmation");
  assert.equal(result.selection.userTicketId, "200");
  assert.equal(result.selection.jobKey, membershipContractJobKey("100", "200"));
});

test("native first membership plus past renewal templates do not block the next issuance", () => {
  const input = nativeFixture();
  input.ticketRead.tickets.unshift({ ...input.ticketRead.tickets[0], userTicketId: "198" });
  input.contractHistory.records = [
    {
      contractId: "a".repeat(64), categoryId: 1,
      verified: true,
      title: "\uC544\uCE74\uC774\uBE0C \uD68C\uC6D0\uAC00\uC785",
      status: "signed", signedAt: "2026-09-01T01:00:00.000Z",
      ticket: { userTicketId: "198", productId: "300" },
    },
    {
      contractId: "b".repeat(64), categoryId: 1,
      verified: true,
      title: "\uC544\uCE74\uC774\uBE0C \uC7AC\uB4F1\uB85D",
      status: "signed", signedAt: "2026-10-01T01:00:00.000Z",
      ticket: { userTicketId: "199", productId: "300" },
    },
  ];
  const result = selectNative(input);
  assert.equal(result.status, "eligible", JSON.stringify(result));
  assert.equal(result.selection.action, "renewal_purchase_confirmation");
  assert.equal(result.selection.jobKey, membershipContractJobKey("100", "200"));
});

for (const title of [
  "\uC544\uCE74\uC774\uBE0C \uD68C\uC6D0\uAC00\uC785",
  "\uC544\uCE74\uC774\uBE0C \uC7AC\uB4F1\uB85D",
  "\uC544\uCE74\uC774\uBE0C \uC7AC\uB4F1\uB85D \uAD6C\uB9E4\uC870\uAC74 \uD655\uC778",
]) {
  test(`verified native unsigned prior-issuance contract allows independent renewal: ${title}`, () => {
    const input = nativeFixture();
    input.contractHistory.records = [{
      contractId: "b".repeat(64), categoryId: 1, title,
      status: "sent", verified: true, signedAt: null,
      ticket: { userTicketId: "199", productId: "300" },
    }];
    const result = selectNative(input);
    assert.equal(result.status, "eligible", JSON.stringify(result));
    assert.equal(result.selection.action, "renewal_purchase_confirmation");
    assert.equal(result.selection.jobKey, membershipContractJobKey("100", "200"));
  });

  for (const userTicketId of [undefined, "200"]) {
    test(`native unsigned regular template retains unknown/same-issuance guard: ${title}, binding=${userTicketId}`, () => {
      const input = nativeFixture();
      input.contractHistory.records = [{
        contractId: "b".repeat(64), categoryId: 1, title,
        status: "sent", verified: true, signedAt: null,
        ticket: userTicketId ? { userTicketId, productId: "300" } : null,
      }];
      const result = selectNative(input);
      assert.equal(result.status, "review", JSON.stringify(result));
      assert.equal(result.selection, null);
    });
  }
}

test("native unrelated signed consent does not need regular template terms", () => {
  const input = nativeFixture();
  input.contractHistory.records = [{
    contractId: "c".repeat(64), categoryId: 2, title: "Synthetic photo consent",
    status: "signed", verified: true, signedAt: "2026-09-01T00:00:00.000Z",
    ticket: null,
  }];
  const result = selectNative(input);
  assert.equal(result.status, "eligible", JSON.stringify(result));
  assert.equal(result.selection.action, "renewal_purchase_confirmation");
});

for (const [name, mutate, reason] of [
  ["phone mismatch", (x) => { x.member.phone = "01000000002"; }, "invalid_native_selection_policy"],
  ["missing phone", (x) => { x.group.phone = ""; }, "incomplete_native_selection_source"],
  ["unverified native ticket read", (x) => { x.ticketRead.status = "review"; }, "incomplete_native_selection_source"],
  ["unverified native contract read", (x) => { x.contractHistory.status = "review"; }, "incomplete_native_selection_source"],
  ["currentpass substituted for verified all-ticket read", (x) => { x.ticketRead.status = "currentpass"; }, "incomplete_native_selection_source"],
  ["missing previous download", (x) => { x.previousDownloadedAt = undefined; }, "incomplete_native_selection_source"],
  ["empty previous download", (x) => { x.previousDownloadedAt = ""; }, "incomplete_native_selection_source"],
  ["unchanged download timestamp", (x) => { x.previousDownloadedAt = x.sourceDownloadedAt; }, "incomplete_native_selection_source"],
  ["non-native member ID", (x) => { x.member.memberId = "excel_100"; }, "unverified_native_identity"],
  ["wrong issuance owner", (x) => { x.ticketRead.tickets[1].memberId = "101"; }, "unverified_native_identity"],
  ["no fresh issuance", (x) => { x.ticketRead.tickets[1].issuedAt = x.previousDownloadedAt; }, "no_fresh_native_issuance"],
  ["Excel hint without fresh native purchase proof", (x) => { x.group.rows[0]["수강권명"] = "Another regular product"; x.ticketRead.tickets.pop(); }, "no_fresh_native_issuance"],
  ["empty regular allowlist", (x) => { x.config.regularProductIds = []; }, "invalid_native_selection_policy"],
  ["refunded new pass", (x) => { x.ticketRead.tickets[1].refunded = true; }, "refunded_or_cancelled"],
  ["cancelled new pass", (x) => { x.ticketRead.tickets[1].cancelled = true; }, "refunded_or_cancelled"],
  ["inactive new pass", (x) => { x.ticketRead.tickets[1].status = "inactive"; }, "unverified_ticket_state"],
  ["duplicate fresh native issuances", (x) => { x.ticketRead.tickets.push({ ...x.ticketRead.tickets[1], userTicketId: "201" }); }, "multiple_fresh_native_issuances"],
]) {
  test(`native renewal recovery cannot bypass ${name}`, () => {
    const input = nativeFixture();
    mutate(input);
    const result = selectNative(input);
    assert.notEqual(result.status, "eligible", JSON.stringify(result));
    assert.equal(result.selection, null);
    assert.equal(result.reason, reason);
  });
}

for (const [grade, reason] of [
  ["강사회원", "instructor_member_grade_excluded"],
  ["강사", "instructor_member_grade_excluded"],
  ["스텝", "staff_member_grade_excluded"],
  ["직원", "staff_member_grade_excluded"],
  ["체험회원", "trial_member_grade_excluded"],
  ["상담회원", "consultation_member_grade_excluded"],
  ["unknown-grade", "unknown_member_grade"],
]) {
  for (const source of ["Excel", "native member"]) {
    test(`verified prior purchases do not override ${source} grade=${grade}`, () => {
      const input = nativeFixture();
      if (source === "Excel") input.group.rows[0]["회원구분"] = grade;
      else input.member.memberGrade = grade;
      const result = selectNative(input);
      assert.notEqual(result.status, "eligible");
      assert.equal(result.selection, null);
      assert.equal(result.reason, reason);
    });
  }
}

test("renewal discovery still requires a complete applied fresh source import", () => {
  const now = Date.parse(fixture().now);
  const source = {
    sourceImportId: "synthetic-october-import",
    downloadedAt: fixture().ticket.source.capturedAt,
    applied: true,
    complete: true,
  };
  assert.equal(isFreshContractDiscoverySource(source, now), true);
  for (const patch of [
    { applied: false }, { complete: false }, { sourceImportId: "" },
    { downloadedAt: "2026-10-22T02:29:59.000Z" },
    { downloadedAt: "2026-10-22T03:00:01.000Z" },
  ]) {
    assert.equal(isFreshContractDiscoverySource({ ...source, ...patch }, now), false);
  }
});

test("renewal lookup cannot replace ambiguous exact-phone identity with a prior-purchase hint", async () => {
  let reads = 0;
  const result = await readExactStudioMateMember({
    get: async (pathname) => {
      reads++;
      assert.equal(pathname, "/v2/staff/contract/member-list?search_word=01000000001");
      return [
        { id: 100, name: "Synthetic Member", mobile: "010-0000-0001" },
        { id: 101, name: "Synthetic Member", mobile: "01000000001" },
      ];
    },
  }, "01000000001");
  assert.equal(reads, 1, "ambiguous identity must not proceed to member detail");
  assert.equal(result.status, "review");
  assert.equal(result.reason, "ambiguous_exact_phone");
  assert.equal(result.member, null);
});

for (const patch of [
  { id: 101 }, { mobile: "01000000002" },
  { name: "Different synthetic member" }, { deleted_at: "2026-10-22 11:00:00" },
]) {
  test(`renewal exact-phone lookup still rejects mismatched native detail: ${Object.keys(patch)[0]}`, async () => {
    const result = await readExactStudioMateMember({
      get: async (pathname) => {
        if (pathname === "/v2/staff/contract/member-list?search_word=01000000001") {
          return [{ id: 100, name: "Synthetic Member", mobile: "01000000001" }];
        }
        assert.equal(pathname, "/staff/member/100");
        return { member: { id: 100, name: "Synthetic Member", mobile: "01000000001", ...patch } };
      },
    }, "01000000001");
    assert.equal(result.status, "review");
    assert.equal(result.reason, "member_detail_identity_mismatch");
    assert.equal(result.member, null);
  });
}
