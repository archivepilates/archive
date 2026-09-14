import assert from "node:assert/strict";
import test from "node:test";
import { membershipContractJobKey } from "./studiomate-membership-contract-policy.mjs";
import {
  planMembershipContractWelcome,
  MEMBERSHIP_WELCOME_TEMPLATE,
} from "./studiomate-membership-welcome.mjs";
import {
  normalizeNativeContractObservation as normalize,
  normalizeNativeContractDom,
  parseNativeSignedDate,
} from "./studiomate-native-contract-evidence.mjs";

const NOW = "2026-09-14T04:00:00.000Z";
const SELECTED = "2026-09-14T03:00:00.000Z";
const CHECKED = "2026-09-14T03:55:00.000Z";
const PHONE = "01012345678";
const DRAFT = "\uC791\uC131\uC911";
const SIGNED = "\uC11C\uBA85\uC644\uB8CC";

function fixture() {
  const ids = {
    studioId: "studio-synthetic",
    memberId: "100",
    userTicketId: "200",
    productId: "300",
  };
  const read = { verified: true, complete: true, checkedAt: CHECKED, ...ids };
  const binding = {
    verified: true,
    ...ids,
    contractId: "contract-123",
    title: "Synthetic membership contract",
    memberPhone: PHONE,
    contractAction: "first_purchase_contract",
    selectedAt: SELECTED,
    selectionJobKey: membershipContractJobKey(ids.memberId, ids.userTicketId),
    expectedPaidAmount: 100000,
    previousObservations: [],
    currentMemberTicket: {
      member: {
        ...read,
        source: "studiomate_native_member",
        phone: PHONE,
        phoneMatchCount: 1,
        classification: "member",
        currentRecipientEligible: true,
      },
      ticket: {
        ...read,
        source: "studiomate_native_ticket",
        classification: "regular",
        status: "active",
        refunded: false,
        cancelled: false,
      },
      payment: {
        ...read,
        source: "studiomate_native_payment",
        status: "paid",
        totalAmount: 100000,
        paidAmount: 100000,
        outstandingAmount: 0,
        refundedAmount: 0,
      },
      providerSignature: {
        ...read,
        source: "studiomate_native_contract",
        contractId: "contract-123",
        signedAt: "2026-09-14T12:50:00+09:00",
      },
    },
  };
  return {
    binding,
    raw: {
      schemaVersion: 1,
      source: "studiomate_contract_dom",
      verified: true,
      complete: true,
      loading: false,
      matchCount: 1,
      observedAt: CHECKED,
      contractId: binding.contractId,
      title: binding.title,
      memberName: "Synthetic member",
      memberPhone: "010-1234-5678",
      statusText: SIGNED,
      centerSignaturePresent: true,
      memberSignaturePresent: true,
      signedDateText: "\uC11C\uBA85 \uC644\uB8CC\uC77C : 2026. 9. 14.",
      fields: {
        "\uACB0\uC81C\uAE08\uC561*": "100000",
        "\uBBF8\uC218\uAE08": "0",
      },
    },
  };
}

function draft(input, at = "2026-09-14T03:40:00.000Z") {
  return {
    ...structuredClone(input.raw),
    statusText: DRAFT,
    observedAt: at,
    signedDateText: null,
    memberSignaturePresent: false,
    bindingIdentity: historyIdentity(input.binding),
  };
}

function historyIdentity(binding) {
  return Object.fromEntries(
    [
      "studioId",
      "memberId",
      "userTicketId",
      "productId",
      "selectionJobKey",
      "selectedAt",
    ].map((key) => [key, binding[key]]),
  );
}

function run(input) {
  return normalize(input.raw, input.binding, NOW);
}
function review(input, reason) {
  const result = run(input);
  assert.equal(result.status, "review");
  assert.equal(result.reason, reason);
  assert.equal(result.completion, null);
  assert.equal(result.sendAllowed, false);
  return result;
}

test("provider timestamp is preserved as an instant, UI date and first observation stay separate", () => {
  const result = run(fixture());
  assert.equal(result.status, "complete");
  assert.equal(result.completion.signedAt, "2026-09-14T03:50:00.000Z");
  assert.equal(result.completion.signedDate, "2026-09-14");
  assert.equal(result.firstObservedSignedAt, CHECKED);
  assert.equal(result.completion.firstObservedSignedAt, CHECKED);
  assert.equal(result.completion.checkedAt, CHECKED);
  assert.equal(result.sendAllowed, false);
});

test("provider and observed-interval completions match the shared TS policy", () => {
  for (const interval of [false, true]) {
    const input = fixture();
    if (interval) {
      input.binding.currentMemberTicket.providerSignature = null;
      input.binding.previousObservations = [draft(input)];
    }
    const { completion } = run(input);
    const selection = {
      now: SELECTED,
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
        classification: "regular",
        status: "active",
        refunded: false,
        cancelled: false,
        issuedAt: "2026-09-14T02:30:00.000Z",
        source: {
          kind: "studiomate_member_excel",
          verified: true,
          complete: true,
          capturedAt: "2026-09-14T02:50:00.000Z",
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
              paymentId: "payment-synthetic",
              method: "card",
              status: "paid",
              amount: 100000,
              paidAt: "2026-09-14T02:31:00.000Z",
            },
          ],
        },
      },
      policy: {
        regularProductIds: ["300"],
        termsVersion: "v1",
        cutoverAt: "2026-09-14T00:00:00.000Z",
        maxSourceAgeMs: 3600000,
        maxIssuanceAgeMs: 3600000,
      },
      history: {
        previousIssuanceIds: [],
        currentIssuanceIds: ["200"],
        baselineCapturedAt: "2026-09-14T02:00:00.000Z",
        purchases: {
          memberId: "100",
          authoritative: true,
          complete: true,
          asOf: SELECTED,
          priorRegularIssuanceIds: [],
        },
        contracts: {
          memberId: "100",
          authoritative: true,
          complete: true,
          asOf: SELECTED,
          records: [],
        },
      },
    };
    const result = planMembershipContractWelcome({
      selection,
      completion,
      now: NOW,
      template: {
        ...structuredClone(MEMBERSHIP_WELCOME_TEMPLATE),
        status: "APPROVED",
      },
      history: {
        authoritative: true,
        complete: true,
        allVersions: true,
        allTime: true,
        memberAliasesComplete: true,
        providerComplete: true,
        studioId: completion.studioId,
        phone: PHONE,
        checkedAt: NOW,
        records: [],
      },
    });
    assert.equal(result.status, "ready");
    assert.equal(result.sendAllowed, false);
  }
});

test("renderer dates are parsed without locale heuristics, rollover, markup or timestamps", () => {
  for (const value of [
    "2026-09-14",
    "2026.09.14",
    "2026. 9. 14.",
    "2026\uB144 9\uC6D4 14\uC77C",
    "\uC11C\uBA85 \uC644\uB8CC\uC77C : 2026. 9. 14.",
  ]) {
    assert.equal(parseNativeSignedDate(value), "2026-09-14");
  }
  assert.equal(parseNativeSignedDate("2024. 2. 29."), "2024-02-29");
  for (const value of [
    undefined,
    null,
    {},
    20260914,
    "",
    "-",
    "Loading...",
    "Invalid Date",
    "2026-02-29",
    "2100-02-29",
    "2026-04-31",
    "2026-13-01",
    "2026-00-10",
    "2026-09-00",
    "09/14/2026",
    "2026-9-14",
    "26.9.14",
    "2026-09-14T00:00:00Z",
    "2026-09-14 13:00",
    "<span>2026.9.14</span>",
    "2026.9.14<script>alert(1)</script>",
    "2026.9.14&amp;",
    "2026.9.14\u200b",
    "2026.9.14\nignored",
    "2026/09/14",
  ]) {
    assert.equal(parseNativeSignedDate(value), null, String(value));
  }
});

test("skeleton, incomplete or unknown DOM readings fail closed", () => {
  for (const patch of [
    { schemaVersion: 2 },
    { source: "workLanes" },
    { verified: false },
    { complete: false },
    { loading: true },
    { matchCount: 2 },
    { matchCount: "1" },
    { statusText: "unknown" },
    { statusText: "signed" },
    { centerSignaturePresent: undefined },
    { memberSignaturePresent: undefined },
    { observedAt: "2026-09-14" },
    { signedAt: NOW },
    { firstObservedSignedAt: NOW },
    { providerSignedAt: NOW },
  ]) {
    const input = fixture();
    Object.assign(input.raw, patch);
    review(input, "incomplete_contract_dom");
  }
  for (const signedDateText of [
    undefined,
    null,
    "",
    "-",
    "Loading...",
    "2026-02-30",
  ]) {
    const input = fixture();
    input.raw.signedDateText = signedDateText;
    review(input, "invalid_signed_date");
  }
});

test("requires exact contract ID, title, phone and native member/issuance/product binding", () => {
  for (const patch of [
    { contractId: "other" },
    { title: "Synthetic membership contract " },
    { memberPhone: "01087654321" },
    { memberPhone: "***-****-5678" },
  ]) {
    const input = fixture();
    Object.assign(input.raw, patch);
    review(input, "contract_binding_mismatch");
  }
  for (const key of ["studioId", "memberId", "userTicketId", "productId"]) {
    const input = fixture();
    input.binding.currentMemberTicket.ticket[key] = "different";
    review(input, "unverified_ticket_source");
  }
  for (const patch of [
    { verified: false },
    { contractId: "" },
    { title: "" },
    { memberId: 100 },
    { userTicketId: "excel_200" },
    { productId: "" },
    { memberPhone: "010-1234-5678" },
    { selectionJobKey: "forged" },
    { expectedPaidAmount: "100000" },
    { selectedAt: "2026-09-14" },
    { selectedAt: "2026-09-01T00:00:00Z" },
  ]) {
    const input = fixture();
    Object.assign(input.binding, patch);
    review(input, "invalid_native_binding");
  }
});

test("ambiguous, missing or changed current phone never qualifies", () => {
  for (const count of [undefined, null, 0, 2, "1"]) {
    const input = fixture();
    input.binding.currentMemberTicket.member.phoneMatchCount = count;
    review(input, "ambiguous_native_phone");
  }
  const changed = fixture();
  changed.binding.currentMemberTicket.member.phone = "01087654321";
  review(changed, "current_phone_mismatch");
  const formatted = fixture();
  formatted.binding.currentMemberTicket.member.phone = "+82 10 1234 5678";
  assert.equal(run(formatted).completion.currentPhone, PHONE);
});

test("contract, member, ticket, payment and provider freshness are independent", () => {
  const stale = "2026-09-14T03:29:59.999Z";
  const future = "2026-09-14T04:00:00.001Z";
  for (const at of [stale, future, "2026-09-14", undefined]) {
    for (const source of ["member", "ticket", "payment"]) {
      const input = fixture();
      input.binding.currentMemberTicket[source].checkedAt = at;
      review(input, `stale_${source}_source`);
    }
    const input = fixture();
    input.binding.currentMemberTicket.providerSignature.checkedAt = at;
    review(input, "stale_provider_source");
  }
  for (const at of [stale, future]) {
    const input = fixture();
    input.raw.observedAt = at;
    review(input, "stale_contract_source");
  }
  const boundary = fixture();
  for (const source of ["member", "ticket", "payment"])
    boundary.binding.currentMemberTicket[source].checkedAt =
      "2026-09-14T03:30:00Z";
  boundary.binding.currentMemberTicket.providerSignature.signedAt =
    "2026-09-14T03:30:00Z";
  assert.equal(run(boundary).completion.checkedAt, "2026-09-14T03:30:00.000Z");
});

test("independent sources require complete exact native linkage and current settled state", () => {
  for (const source of ["member", "ticket", "payment"]) {
    for (const patch of [
      { complete: false },
      { verified: false },
      { memberId: "101" },
      { studioId: "other" },
      { source: "selection_copy" },
    ]) {
      const input = fixture();
      Object.assign(input.binding.currentMemberTicket[source], patch);
      review(input, `unverified_${source}_source`);
    }
    const input = fixture();
    delete input.binding.currentMemberTicket[source];
    review(input, `unverified_${source}_source`);
  }
  for (const source of ["ticket", "payment"])
    for (const key of ["userTicketId", "productId"]) {
      const input = fixture();
      input.binding.currentMemberTicket[source][key] = "999";
      review(input, `unverified_${source}_source`);
    }
  for (const patch of [
    { refunded: true },
    { cancelled: undefined },
    { status: "expired" },
    { classification: "trial" },
  ]) {
    const input = fixture();
    Object.assign(input.binding.currentMemberTicket.ticket, patch);
    review(input, "current_member_or_ticket_ineligible");
  }
  const member = fixture();
  member.binding.currentMemberTicket.member.classification = "instructor";
  review(member, "current_member_or_ticket_ineligible");
  for (const patch of [
    { status: "pending" },
    { totalAmount: 100001 },
    { paidAmount: 99999 },
    { outstandingAmount: 1 },
    { refundedAmount: 1 },
    { paidAmount: "100000" },
    { paidAmount: NaN },
    { paidAmount: Infinity },
    { totalAmount: null },
  ]) {
    const input = fixture();
    Object.assign(input.binding.currentMemberTicket.payment, patch);
    review(input, "unsettled_current_payment");
  }
});

test("status signed and both actual signatures are required", () => {
  for (const field of ["centerSignaturePresent", "memberSignaturePresent"]) {
    const input = fixture();
    input.binding.currentMemberTicket.providerSignature = null;
    input.raw[field] = false;
    const result = run(input);
    assert.equal(result.status, "waiting");
    assert.equal(result.completion, null);
    assert.equal(result.firstObservedSignedAt, null);
  }
  const input = fixture();
  input.raw = draft(input, CHECKED);
  input.binding.currentMemberTicket.providerSignature = null;
  assert.equal(run(input).status, "waiting");
  input.raw.memberSignaturePresent = true;
  review(input, "conflicting_signature_state");
});

test("date-only first discovery cannot manufacture signedAt or establish a transition", () => {
  const input = fixture();
  input.binding.currentMemberTicket.providerSignature = null;
  const result = review(input, "native_signed_transition_unproven");
  assert.equal(result.firstObservedSignedAt, CHECKED);
  assert.equal(result.transition, null);
  assert.equal(Object.hasOwn(result.observation, "signedAt"), false);
  input.binding.previousObservations = [
    { ...draft(input), statusText: "sent" },
  ];
  review(input, "invalid_bound_observation_history");
});

test("bound earlier draft produces an observed interval with no signing timestamp", () => {
  const input = fixture();
  input.binding.currentMemberTicket.providerSignature = null;
  input.binding.previousObservations = [draft(input)];
  const result = run(input);
  assert.equal(result.status, "complete");
  assert.equal(result.reason, "verified_observed_signature_transition");
  assert.equal(result.completion.signatureTimeSource, "observed_transition");
  assert.deepEqual(result.transition, {
    draftObservedAt: "2026-09-14T03:40:00.000Z",
    signedObservedAt: CHECKED,
  });
  assert.deepEqual(result.completion.signatureObservation, {
    ...result.transition,
    signedDate: "2026-09-14",
  });
  assert.equal(result.firstObservedSignedAt, CHECKED);
  assert.equal(
    result.completion.firstObservedSignedAt,
    result.completion.signatureObservation.signedObservedAt,
  );
  assert.equal(Object.hasOwn(result.completion, "signedAt"), false);
  assert.equal(JSON.stringify(result).includes('"signedAt"'), false);
  input.raw.signedDateText = "2026-09-13";
  review(input, "signed_date_conflicts_with_observations");
});

test("frozen historical snapshots preserve the first signed observation on later readback", () => {
  const input = fixture();
  input.binding.currentMemberTicket.providerSignature = null;
  const priorDraft = draft(input);
  input.binding.previousObservations = [priorDraft];
  const first = run(input);
  input.binding.previousObservations = [
    Object.freeze(priorDraft),
    first.observation,
  ];
  input.raw.observedAt = "2026-09-14T03:59:00.000Z";
  for (const source of ["member", "ticket", "payment"])
    input.binding.currentMemberTicket[source].checkedAt = NOW;
  const before = structuredClone(input);
  deepFreeze(input);
  const later = run(input);
  assert.equal(later.status, "complete");
  assert.equal(later.firstObservedSignedAt, CHECKED);
  assert.deepEqual(later.transition, first.transition);
  assert.deepEqual(input, before);
  assert.ok(Object.isFrozen(later.observation));
  assert.ok(Object.isFrozen(later.observation.bindingIdentity));
  assert.deepEqual(run(input), later);
});

test("DOM-only wrapper persists a bound draft without current readback or eligibility claims", () => {
  const input = fixture();
  input.raw = draft(input, CHECKED);
  delete input.binding.currentMemberTicket;
  const before = structuredClone(input);
  deepFreeze(input);
  const dom = normalizeNativeContractDom(input.raw, input.binding);
  assert.equal(dom.status, "observed");
  assert.equal(dom.observation.status, "draft");
  assert.equal(dom.observation.bindingIdentity.userTicketId, "200");
  assert.equal(Object.hasOwn(dom, "completion"), false);
  assert.equal(Object.hasOwn(dom.observation, "fields"), false);
  const pending = review(input, "current_member_ticket_readback_required");
  assert.deepEqual(pending.observation, dom.observation);
  assert.deepEqual(input, before);
  assert.ok(Object.isFrozen(dom.observation.bindingIdentity));
});

test("DOM wrapper rejects mismatches and pre-binding timestamps without reading a clock", () => {
  const input = fixture();
  for (const patch of [
    { complete: false },
    { memberName: "" },
    { contractId: "other" },
    { title: "wrong" },
    { memberPhone: "01087654321" },
    { observedAt: "2026-09-14T02:00:00Z" },
  ]) {
    const result = normalizeNativeContractDom(
      { ...input.raw, ...patch },
      input.binding,
    );
    assert.equal(result.status, "review");
    assert.equal(result.observation, null);
  }
  for (const binding of [null, {}, { ...input.binding, productId: "" }]) {
    assert.equal(
      normalizeNativeContractDom(input.raw, binding).reason,
      "invalid_native_binding",
    );
  }
});

test("reader form values and old selection never fill in missing current readback", () => {
  for (const readback of [undefined, null, false, "old source"]) {
    const input = fixture();
    input.binding.currentMemberTicket = readback;
    input.raw.fields = {
      "\uACB0\uC81C\uAE08\uC561*": "100000",
      "\uBBF8\uC218\uAE08": "0",
    };
    input.binding.selection = {
      currentRecipientEligible: true,
      paidAmount: 100000,
    };
    review(input, "current_member_ticket_readback_required");
  }
  const input = fixture();
  delete input.binding.currentMemberTicket.payment;
  review(input, "unverified_payment_source");
});

test("neither signature images nor form contents leak into persisted observations", () => {
  const input = fixture();
  input.raw.memberSignatureImage = "data:image/png;base64,not-for-persistence";
  input.raw.fields = { arbitrary: "do-not-persist" };
  const normalized = run(input);
  assert.equal(normalized.status, "complete");
  assert.equal(JSON.stringify(normalized).includes("data:image"), false);
  assert.equal(JSON.stringify(normalized).includes("do-not-persist"), false);
});

test("interval draft and first signed bounds both expire and never refresh on rediscovery", () => {
  const input = fixture();
  input.binding.currentMemberTicket.providerSignature = null;
  input.binding.selectedAt = "2026-09-13T03:00:00Z";
  input.binding.previousObservations = [
    draft(input, "2026-09-13T03:59:59.999Z"),
  ];
  review(input, "invalid_signature_observation_interval");
  input.binding.previousObservations = [draft(input, "2026-09-13T04:00:00Z")];
  assert.equal(run(input).status, "complete");

  input.raw.signedDateText = "2026-09-13";
  const firstDOM = { ...input.raw, observedAt: "2026-09-13T03:59:59.999Z" };
  const first = normalizeNativeContractDom(firstDOM, input.binding).observation;
  input.binding.previousObservations = [
    draft(input, "2026-09-13T03:30:00Z"),
    first,
  ];
  review(input, "stale_first_signed_observation");
});

test("UI date intersects the actual KST observation interval across midnight", () => {
  const input = fixture();
  input.binding.currentMemberTicket.providerSignature = null;
  input.binding.selectedAt = "2026-09-14T14:50:00Z";
  input.raw.observedAt = "2026-09-14T15:10:00Z";
  input.binding.previousObservations = [draft(input, "2026-09-14T14:59:00Z")];
  for (const source of ["member", "ticket", "payment"])
    input.binding.currentMemberTicket[source].checkedAt =
      "2026-09-14T15:15:00Z";
  const now = "2026-09-14T15:20:00Z";
  for (const date of ["2026-09-14", "2026-09-15"]) {
    input.raw.signedDateText = date;
    const result = normalize(input.raw, input.binding, now);
    assert.equal(result.status, "complete");
    assert.equal(result.completion.signatureObservation.signedDate, date);
    assert.equal(Object.hasOwn(result.completion, "signedAt"), false);
  }
  for (const date of ["2026-09-13", "2026-09-16"]) {
    input.raw.signedDateText = date;
    assert.equal(
      normalize(input.raw, input.binding, now).reason,
      "signed_date_conflicts_with_observations",
    );
  }
});

test("invalid, contradictory, cross-binding or future history cannot attest a transition", () => {
  for (const previous of [
    null,
    {},
    new Array(1),
    Array.from({ length: 101 }, () => ({})),
  ]) {
    const input = fixture();
    input.binding.previousObservations = previous;
    assert.equal(run(input).status, "review");
  }
  for (const patch of [
    { contractId: "other" },
    { title: "Other" },
    { memberPhone: "01087654321" },
    { complete: false },
  ]) {
    const input = fixture();
    input.binding.previousObservations = [{ ...draft(input), ...patch }];
    review(input, "invalid_bound_observation_history");
  }
  for (const at of ["2026-09-14T02:59:59Z", "2026-09-14T03:59:00Z"]) {
    const input = fixture();
    input.binding.previousObservations = [draft(input, at)];
    review(input, "invalid_observation_history_time");
  }
  const sameTime = fixture();
  sameTime.binding.previousObservations = [draft(sameTime, CHECKED)];
  review(sameTime, "conflicting_observation_history");
  const regression = fixture();
  regression.binding.previousObservations = [run(regression).observation];
  regression.raw = draft(regression, NOW);
  review(regression, "signature_history_regression");
  const repeat = fixture();
  repeat.binding.previousObservations = [run(repeat).observation];
  assert.equal(run(repeat).status, "complete");
});

test("date-only provider values, forged/future/rollover times and contradictory dates fail", () => {
  for (const signedAt of [
    "2026-09-14",
    "2026.9.14",
    "2026-09-14T03:50:00",
    "2026-09-14T04:00:01Z",
    "2026-09-14T02:59:59Z",
    "2026-02-30T03:50:00Z",
    "2026-09-14T24:00:00Z",
    "2026-09-14T03:50:60Z",
    "2026-09-14T03:50:00-00:00",
    "2026-09-14T03:50:00+14:01",
    "<time>2026-09-14T03:50:00Z</time>",
  ]) {
    const input = fixture();
    input.binding.currentMemberTicket.providerSignature.signedAt = signedAt;
    review(input, "invalid_provider_signature_time");
  }
  for (const patch of [
    { verified: false },
    { source: "ui_date" },
    { contractId: "other" },
    { userTicketId: "201" },
  ]) {
    const input = fixture();
    Object.assign(input.binding.currentMemberTicket.providerSignature, patch);
    review(input, "unverified_provider_signature");
  }
  const beforeDraft = fixture();
  beforeDraft.binding.previousObservations = [
    draft(beforeDraft, "2026-09-14T03:51:00Z"),
  ];
  review(beforeDraft, "invalid_provider_signature_time");
  const wrongDate = fixture();
  wrongDate.raw.signedDateText = "2026-09-13";
  review(wrongDate, "invalid_provider_signature_time");
  const futureDate = fixture();
  futureDate.raw.signedDateText = "2026-09-15";
  review(futureDate, "signed_date_conflicts_with_observations");
});

test("current reads cannot predate the signature evidence even within the freshness window", () => {
  for (const source of ["member", "ticket", "payment"]) {
    const input = fixture();
    input.binding.currentMemberTicket[source].checkedAt =
      "2026-09-14T03:49:00Z";
    review(input, "current_read_predates_signature_evidence");
    input.binding.currentMemberTicket.providerSignature = null;
    input.binding.previousObservations = [draft(input)];
    input.binding.currentMemberTicket[source].checkedAt =
      "2026-09-14T03:54:59Z";
    review(input, "current_read_predates_signature_evidence");
  }
});

test("malformed roots and clocks return review without throwing", () => {
  for (const bad of [undefined, null, [], {}, "", 1, true]) {
    assert.equal(normalize(bad, fixture().binding, NOW).status, "review");
    assert.equal(normalize(fixture().raw, bad, NOW).status, "review");
  }
  for (const now of [
    undefined,
    null,
    "2026-09-14",
    "2026-02-30T04:00:00Z",
    "2026-09-14T04:00:00+00:00",
  ]) {
    assert.equal(
      normalize(fixture().raw, fixture().binding, now).reason,
      "invalid_observation_clock",
    );
  }
});

function deepFreeze(value) {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
