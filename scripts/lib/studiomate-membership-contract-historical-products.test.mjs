import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { selectNativeMembershipContractCandidate as selectNative } from "./studiomate-membership-contract-native-selection.mjs";
import { membershipContractJobKey } from "./studiomate-membership-contract-policy.mjs";
import { planMembershipContractWelcome } from "./studiomate-membership-welcome.mjs";
import { normalizePayments, normalizeUserTicket } from "./studiomate-native-contract-source.mjs";
import { buildStudioMateJoinContractPayload, MEMBERSHIP_CONTRACT_TEMPLATES } from "./studiomate-native-contract-writer.mjs";

const HISTORICAL_IDS = [
  "194834", "203252", "268320", "338610", "375406", "412181", "211940",
  "216386", "249896", "249897", "258773", "336809", "434225",
];
const NOW = "2026-10-22T03:00:00.000Z";

function paymentRow(amount = 120000) {
  return {
    id: 501, created_at: "2026-10-05 12:00:00", status: "paid",
    card_amount: amount, cash_amount: 0, wiretransfer_amount: 0,
    transfer_amount: 0, point_amount: 0, unpaid_amount: 0,
  };
}

function ticketRow(productId = "300") {
  return {
    id: 200, studio_id: 5330, member: { id: 100 }, ticket_id: Number(productId),
    ticket: { id: Number(productId), title: "Synthetic regular pass", type: "C", available_class_type: "group" },
    created_at: "2026-10-22 11:30:00", updated_at: "2026-10-22 11:30:00",
    availability_start_at: "2026-10-22", expire_at: "2026-12-31",
    active: true, ticket_usable: true, status: "active", is_shared: false,
    max_coupon: 10, remaining_coupon: 10, max_cancel: 2,
    payments: [paymentRow()],
  };
}

function fixture(productId = HISTORICAL_IDS[0], recovery = false) {
  const current = structuredClone(normalizeUserTicket(ticketRow(), "100"));
  if (recovery) current.issuedAt = "2026-10-05T03:00:00.000Z";
  const prior = {
    ...structuredClone(current), productId, userTicketId: "199",
    issuedAt: "2026-09-01T03:00:00.000Z", status: "inactive",
  };
  return {
    group: { phone: "01000000001", rows: [] },
    member: { memberId: "100", name: "Synthetic Member", phone: "01000000001" },
    ticketRead: { status: "verified", tickets: [prior, current] },
    contractHistory: { status: "verified", records: [] },
    previousDownloadedAt: recovery ? null : "2026-10-22T02:00:00.000Z",
    sourceDownloadedAt: NOW,
    config: {
      studioId: "5330", regularProductIds: ["300"], termsVersion: "synthetic-v1",
      cutoverAt: "2026-09-14T00:00:00.000Z", maxSourceAgeMs: 3600000,
      maxIssuanceAgeMs: 7200000, signExpirationDays: 7,
    },
    ...(recovery ? { recoveryApproval: {
      reference: "user_october_renewal_recovery_20261022",
      memberId: "100", userTicketId: "200", sourceComplete: true,
      sourceSha256: createHash("sha256").update("synthetic complete October export").digest("hex"),
    } } : {}),
  };
}

function selected(input, action = "renewal_purchase_confirmation", priorIds = ["199"]) {
  const before = structuredClone(input);
  const result = selectNative(input);
  assert.equal(result.status, "eligible", JSON.stringify(result));
  assert.equal(result.selection.action, action);
  assert.equal(result.selection.userTicketId, "200");
  assert.equal(result.selection.jobKey, membershipContractJobKey("100", "200"));
  assert.deepEqual(result.selection.history.purchases.priorRegularIssuanceIds, priorIds);
  assert.deepEqual(input, before, "selection must not mutate synthetic evidence");
  return result.selection;
}

const INVALID_PRIORS = [
  ["gratis", (row) => { row.payment = normalizePayments([paymentRow(0)], { allowZero: true }); }],
  ["cancelled", (row) => { row.cancelled = true; }],
  ["refunded", (row) => { row.refunded = true; }],
  ["refund balance", (row) => { row.payment.refundedAmount = 1; }],
  ["unverified payment", (row) => { row.payment.verified = false; }],
  ["incomplete payment", (row) => { row.payment.complete = false; }],
  ["missing payment", (row) => { delete row.payment; }],
  ["not strictly prior", (row, current) => { row.issuedAt = current.issuedAt; }],
];

for (const productId of HISTORICAL_IDS) {
  for (const recovery of [false, true]) {
    const mode = recovery ? "October recovery" : "fresh detection";
    test(`${mode}: paid historical product ${productId} establishes prior regular purchase only`, () => {
      const input = fixture(productId, recovery);
      const selection = selected(input);
      assert.equal(selection.productId, "300");
      assert.deepEqual(selection.history.currentIssuanceIds, ["199", "200"]);
      assert.deepEqual(selection.policy.regularProductIds, ["300"]);
    });

    test(`${mode}: historical product ${productId} cannot be a new target outside config allowlist`, () => {
      const input = fixture(productId, recovery);
      input.ticketRead.tickets[1].productId = productId;
      const result = selectNative(input);
      assert.equal(result.status, "ignored");
      assert.equal(result.reason, "no_fresh_native_issuance");
      assert.equal(result.selection, null);
      assert.equal(result.candidateCount, 0);
    });

    for (const [name, mutate] of INVALID_PRIORS) {
      test(`${mode}: ${name} historical product ${productId} cannot classify renewal`, () => {
        const input = fixture(productId, recovery);
        mutate(...input.ticketRead.tickets);
        if (!recovery) {
          selected(input, "first_purchase_contract", []);
        } else {
          const result = selectNative(input);
          assert.equal(result.status, "review");
          assert.equal(result.reason, "recovery_not_a_renewal");
          assert.equal(result.selection, null);
        }
      });
    }
  }

  test(`historical product ${productId} becomes a target only with explicit config allowlisting`, () => {
    const input = fixture(productId);
    input.config.regularProductIds.push(productId);
    input.ticketRead.tickets[1].productId = productId;
    assert.equal(selected(input).productId, productId);
  });

  test(`fresh historical product ${productId} does not compete with the allowlisted new target`, () => {
    const input = fixture(productId);
    input.ticketRead.tickets.push({ ...structuredClone(input.ticketRead.tickets[1]), productId, userTicketId: "201" });
    selected(input);
  });

  test(`recovered historical product ${productId} persists approval and remains excluded from welcome`, () => {
    const input = fixture(productId, true);
    const selection = selected(input);
    assert.deepEqual(selection.operatorRecoveryApproval, input.recoveryApproval);
    assert.ok(Object.isFrozen(selection.operatorRecoveryApproval));
    assert.equal(selection.history.previousIssuanceIds, null);
    assert.equal(selection.history.baselineCapturedAt, null);
    assert.deepEqual(planMembershipContractWelcome({ selection }), {
      status: "excluded", reason: "renewal_no_welcome", eligibleForCandidate: false,
      sendAllowed: false, intent: null,
    });
  });
}

for (const [productId, title] of [
  ["901", "Synthetic trial"], ["902", "Synthetic instructor"],
  ["903", "Synthetic merchandise"], ["904", "Synthetic starter OT"],
  ["905", "Synthetic regular pass"],
]) {
  for (const recovery of [false, true]) {
    test(`nonallowlisted prior ${title} cannot establish renewal (recovery=${recovery})`, () => {
      const input = fixture(productId, recovery);
      input.ticketRead.tickets[0].title = title;
      if (!recovery) {
        const selection = selected(input, "first_purchase_contract", []);
        assert.deepEqual(selection.history.currentIssuanceIds, ["200"]);
      } else {
        const result = selectNative(input);
        assert.equal(result.status, "review");
        assert.equal(result.reason, "recovery_not_a_renewal");
        assert.equal(result.selection, null);
      }
    });
  }
}

test("welcome revalidation requires the exact October approval rather than treating null baseline as fresh", () => {
  const selection = selected(fixture(HISTORICAL_IDS[0], true));
  for (const patch of [
    { reference: "user_october_renewal_recovery_20261021" },
    { sourceSha256: "" }, { sourceComplete: false },
    { memberId: "101" }, { userTicketId: "201" },
  ]) {
    const result = planMembershipContractWelcome({ selection: {
      ...selection, operatorRecoveryApproval: { ...selection.operatorRecoveryApproval, ...patch },
    } });
    assert.equal(result.status, "blocked");
    assert.equal(result.reason, "contract_invalid_october_recovery_approval");
    assert.equal(result.sendAllowed, false);
  }
  const { operatorRecoveryApproval, ...withoutApproval } = selection;
  assert.ok(operatorRecoveryApproval);
  const result = planMembershipContractWelcome({ selection: withoutApproval });
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "contract_stale_issuance");
  const freshWithoutBaseline = structuredClone(withoutApproval);
  freshWithoutBaseline.ticket.issuedAt = "2026-10-22T02:30:00.000Z";
  const freshResult = planMembershipContractWelcome({ selection: freshWithoutBaseline });
  assert.equal(freshResult.status, "blocked");
  assert.equal(freshResult.reason, "contract_initialize_without_events");
});

test("production payment and ticket normalization reject zero by default; exact opt-in preserves real zero", () => {
  for (const amount of [0, "0"]) {
    const row = paymentRow(amount);
    for (const options of [undefined, { allowZero: false }, { allowZero: "true" }, { allowZero: 1 }, { allowZero: {} }]) {
      const payment = normalizePayments([row], options);
      assert.equal(payment.verified, false);
      assert.equal(payment.complete, false);
      assert.equal(payment.reason, "invalid_payment_total");
    }
    const payment = normalizePayments([row], { allowZero: true });
    assert.equal(payment.verified, true);
    assert.equal(payment.complete, true);
    assert.equal(payment.status, "paid");
    for (const field of ["totalAmount", "paidAmount", "outstandingAmount", "refundedAmount"]) assert.equal(payment[field], 0);
    assert.deepEqual(payment.transactions, []);
    assert.ok(Object.values(payment.contractPayment).every((value) => value === 0));
    const raw = ticketRow();
    raw.payments = [row];
    assert.equal(normalizeUserTicket(raw, "100").payment.verified, false);
  }
});

for (const field of ["card_amount", "cash_amount", "wiretransfer_amount", "transfer_amount", "point_amount", "unpaid_amount"]) {
  for (const value of [null, "", " ", "\t", false, true, undefined, " 0 ", "0.0", -1, 0.5, NaN, Infinity, {}, []]) {
    if (field === "point_amount" && value === undefined) continue;
    test(`zero opt-in rejects malformed ${field}=${String(value)} (${typeof value})`, () => {
      const row = { ...paymentRow(0), [field]: value };
      for (const options of [undefined, { allowZero: true }]) {
        const payment = normalizePayments([row], options);
        assert.equal(payment.verified, false);
        assert.equal(payment.complete, false);
        assert.equal(payment.reason, field === "unpaid_amount" ? "invalid_outstanding_amount" : "invalid_payment_amount");
      }
    });
  }
}

test("only undefined point amount defaults to zero; digit-string zero amounts remain valid on exact opt-in", () => {
  const row = paymentRow(0);
  delete row.point_amount;
  assert.equal(normalizePayments([row], { allowZero: true }).verified, true);
  for (const field of ["card_amount", "cash_amount", "wiretransfer_amount", "transfer_amount", "unpaid_amount"]) row[field] = "0";
  const payment = normalizePayments([row], { allowZero: true });
  assert.equal(payment.verified, true);
  assert.equal(payment.totalAmount, 0);
});

// These IDs are the hard-coded public approval boundary, not member data readbacks.
function zeroWriterFixture() {
  const binding = { studioId: "5330", memberId: "1982133", userTicketId: "10277817", productId: "191164" };
  const action = "renewal_purchase_confirmation";
  const jobKey = `membership_contract_${createHash("sha256").update(JSON.stringify([
    "studiomate-renewal-operator-test-v1", binding.memberId, binding.userTicketId, "20261022",
  ])).digest("hex")}`;
  return {
    selection: { ...binding, action, jobKey, now: NOW, memberPhone: "01000000001", signExpirationDays: 7 },
    member: { memberId: binding.memberId, name: "Synthetic Member", phone: "01000000001", gender: "F", birthday: "2000-01-01" },
    ticket: { ...structuredClone(normalizeUserTicket(ticketRow(), "100")), ...binding, payment: normalizePayments([paymentRow(0)], { allowZero: true }) },
    staff: { id: "55", name: "Synthetic Staff" },
    template: { ...MEMBERSHIP_CONTRACT_TEMPLATES[action], category_id: 1, basic: { additional: [{ field_label: "\uAD6C\uB9E4\uC870\uAC74 \uC0C1\uC138" }] } },
    terms: [{ title: "Synthetic term", contents: "Synthetic contents", agree_type: "R", is_agree: false }],
    operatorTestApproval: { reference: "user_october_renewal_test_20261022", ...binding, action, jobKey },
  };
}

for (const action of ["first_purchase_contract", "renewal_purchase_confirmation"]) {
  test(`writer rejects real zero without approval for ${action}`, () => {
    const input = zeroWriterFixture();
    delete input.operatorTestApproval;
    input.selection.action = action;
    input.template = { ...input.template, ...MEMBERSHIP_CONTRACT_TEMPLATES[action] };
    assert.throws(() => buildStudioMateJoinContractPayload(input), /Ticket\/payment binding is incomplete/);
  });
}

test("exact-bound operator test approval permits real zero without inventing payment or consent", () => {
  const input = zeroWriterFixture();
  const before = structuredClone(input);
  const payload = buildStudioMateJoinContractPayload(input);
  const ticket = payload.join_user_tickets[0].required;
  for (const field of ["amount", "unpaid_amount", "card_amount", "cash_amount", "wiretransfer_amount", "point_amount"]) assert.equal(ticket[field], 0);
  assert.equal(ticket.user_ticket_id, Number(input.ticket.userTicketId));
  assert.equal(ticket.ticket_id, Number(input.ticket.productId));
  assert.equal(ticket.availability_start_at, input.ticket.availabilityStartAt);
  assert.equal(ticket.expire_at, input.ticket.expireAt);
  assert.ok(payload.terms.every((term) => term.is_agree === false));
  assert.deepEqual(input, before);
});

for (const [field, value] of [
  ["reference", "user_october_renewal_recovery_20261022"],
  ["studioId", "5331"], ["memberId", "101"], ["userTicketId", "201"],
  ["productId", "301"], ["action", "first_purchase_contract"],
  ["jobKey", `membership_contract_${"b".repeat(64)}`],
]) {
  test(`zero writer cannot expand exact operator approval by changing ${field}`, () => {
    const input = zeroWriterFixture();
    input.operatorTestApproval[field] = value;
    if (field !== "reference") input.selection[field] = value;
    if (Object.hasOwn(input.ticket, field)) input.ticket[field] = value;
    if (field === "memberId") input.member.memberId = value;
    assert.throws(() => buildStudioMateJoinContractPayload(input), /Invalid operator test approval or selection/);
  });
}
