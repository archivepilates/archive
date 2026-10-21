import assert from "node:assert/strict";
import test from "node:test";
import {
  membershipContractMemberGradeDecision,
  selectNativeMembershipContractCandidate,
} from "./studiomate-membership-contract-native-selection.mjs";

const PREVIOUS = "2026-09-14T00:00:00.000Z";
const CURRENT = "2026-09-14T01:00:00.000Z";

function fixture() {
  const payment = {
    verified: true,
    complete: true,
    status: "paid",
    totalAmount: 398000,
    paidAmount: 398000,
    outstandingAmount: 0,
    refundedAmount: 0,
    transactions: [
      {
        paymentId: "synthetic-payment",
        method: "card",
        status: "paid",
        amount: 398000,
        paidAt: "2026-09-14T00:31:00.000Z",
      },
    ],
  };
  const ticket = {
    source: "studiomate_native_ticket",
    verified: true,
    complete: true,
    studioId: "5330",
    memberId: "100",
    userTicketId: "200",
    productId: "300",
    title: "10주(주2회)",
    type: "P",
    availableClassType: "G",
    availabilityStartAt: "2026-09-21",
    expireAt: "2026-11-29",
    issuedAt: "2026-09-14T00:30:00.000Z",
    status: "active",
    active: true,
    usable: true,
    cancelled: false,
    refunded: false,
    isShared: false,
    maxCoupon: 999,
    remainingCoupon: 999,
    maxCancel: 999,
    payment,
  };
  return {
    group: {
      phone: "01000000001",
      rows: [{ "수강권명": "10주(주2회)", "등급": "" }],
    },
    member: {
      memberId: "100",
      name: "Synthetic Member",
      phone: "01000000001",
    },
    ticketRead: {
      status: "verified",
      tickets: [ticket],
    },
    contractHistory: {
      status: "verified",
      records: [],
    },
    previousDownloadedAt: PREVIOUS,
    sourceDownloadedAt: CURRENT,
    config: {
      studioId: "5330",
      regularProductIds: ["300"],
      termsVersion: "2026-09",
      cutoverAt: "2026-09-14T00:00:00.000Z",
      maxSourceAgeMs: 3_600_000,
      maxIssuanceAgeMs: 3_600_000,
      signExpirationDays: 7,
    },
  };
}

function addPriorRegularIssuance(input) {
  input.ticketRead.tickets.unshift({
    ...input.ticketRead.tickets[0],
    userTicketId: "199",
    issuedAt: "2026-09-13T23:30:00.000Z",
  });
}

function nativeContract(overrides = {}) {
  return {
    source: "studiomate_native_contract",
    verified: true,
    complete: true,
    contractId: "a".repeat(64),
    studioId: "5330",
    memberId: "100",
    categoryId: 1,
    title: "아카이브 회원가입",
    status: "signed",
    signedAt: "2026-09-01T00:00:00.000Z",
    ticket: { userTicketId: "199", productId: "300" },
    ...overrides,
  };
}

test("selects exactly one fresh native regular issuance for first purchase", () => {
  const input = fixture();
  const result = selectNativeMembershipContractCandidate(input);
  assert.equal(result.status, "eligible");
  assert.equal(result.selection.action, "first_purchase_contract");
  assert.equal(result.selection.memberId, "100");
  assert.equal(result.selection.userTicketId, "200");
  assert.equal(result.selection.productId, "300");
  assert.match(result.selection.jobKey, /^membership_contract_[a-f0-9]{64}$/);
  assert.equal(result.ticket, input.ticketRead.tickets[0]);
});

test("Excel product labels do not select the fresh native issuance", () => {
  for (const label of ["다른 수강권", "", undefined]) {
    const input = fixture();
    input.group.rows[0]["수강권명"] = label;
    const result = selectNativeMembershipContractCandidate(input);
    assert.equal(result.status, "eligible", String(label));
    assert.equal(result.selection.action, "first_purchase_contract");
    assert.equal(result.selection.userTicketId, "200");
  }
});

test("fresh native issuance window excludes the previous boundary and includes the source boundary", () => {
  for (const [issuedAt, status] of [
    ["2026-09-13T23:59:59.999Z", "ignored"],
    [PREVIOUS, "ignored"],
    ["2026-09-14T00:00:00.001Z", "eligible"],
    [CURRENT, "eligible"],
    ["2026-09-14T01:00:00.001Z", "ignored"],
  ]) {
    const input = fixture();
    input.ticketRead.tickets[0].issuedAt = issuedAt;
    const result = selectNativeMembershipContractCandidate(input);
    assert.equal(result.status, status, issuedAt);
    if (status === "ignored") assert.equal(result.reason, "no_fresh_native_issuance");
  }
});

test("only allowlisted native products count toward the fresh issuance cap", () => {
  const input = fixture();
  input.ticketRead.tickets.push({
    ...input.ticketRead.tickets[0],
    userTicketId: "201",
    productId: "301",
  });
  const result = selectNativeMembershipContractCandidate(input);
  assert.equal(result.status, "eligible");
  assert.deepEqual(result.selection.history.currentIssuanceIds, ["200"]);

  input.ticketRead.tickets.shift();
  const excluded = selectNativeMembershipContractCandidate(input);
  assert.equal(excluded.status, "ignored");
  assert.equal(excluded.reason, "no_fresh_native_issuance");
});

test("native member, issuance, and recipient guards still hold", () => {
  for (const [label, mutate, reason] of [
    ["phone mismatch", (input) => { input.member.phone = "01000000002"; }, "invalid_native_selection_policy"],
    ["ticket member mismatch", (input) => { input.ticketRead.tickets[0].memberId = "101"; }, "unverified_native_identity"],
    ["fallback issuance ID", (input) => { input.ticketRead.tickets[0].userTicketId = "excel_200"; }, "unverified_native_identity"],
    ["unverified tickets", (input) => { input.ticketRead.status = "review"; }, "incomplete_native_selection_source"],
    ["unverified contracts", (input) => { input.contractHistory.status = "review"; }, "incomplete_native_selection_source"],
  ]) {
    const input = fixture();
    mutate(input);
    const result = selectNativeMembershipContractCandidate(input);
    assert.equal(result.status, "review", label);
    assert.equal(result.reason, reason, label);
    assert.equal(result.selection, null, label);
  }
});

test("allows only the known regular member-grade family", () => {
  for (const grade of ["", "VIP", "Blue", "인플루언서", "회원", "일반회원"]) {
    const decision = membershipContractMemberGradeDecision({ rows: [{ "등급": grade }] });
    assert.equal(decision.status, "eligible", grade);
    assert.equal(decision.classification, "member", grade);
  }
});

test("excludes instructor members before contract selection", () => {
  const input = fixture();
  input.group.rows[0]["등급"] = "강사회원";
  const result = selectNativeMembershipContractCandidate(input);
  assert.deepEqual(
    { status: result.status, reason: result.reason, selection: result.selection },
    { status: "excluded", reason: "instructor_member_grade_excluded", selection: null },
  );
});

test("excludes staff, trial, and consultation grades", () => {
  const expected = new Map([
    ["스텝", "staff_member_grade_excluded"],
    ["체험회원", "trial_member_grade_excluded"],
    ["상담회원", "consultation_member_grade_excluded"],
  ]);
  for (const [grade, reason] of expected) {
    const decision = membershipContractMemberGradeDecision({ rows: [{ "회원구분": grade }] });
    assert.equal(decision.status, "excluded", grade);
    assert.equal(decision.reason, reason, grade);
  }
});

test("holds an unknown new member grade for review", () => {
  const input = fixture();
  input.group.rows[0]["등급"] = "새등급";
  const result = selectNativeMembershipContractCandidate(input);
  assert.equal(result.status, "review");
  assert.equal(result.reason, "unknown_member_grade");
});

test("native instructor grade overrides a regular Excel grade", () => {
  const input = fixture();
  input.member.memberGrade = "강사회원";
  const result = selectNativeMembershipContractCandidate(input);
  assert.equal(result.status, "excluded");
  assert.equal(result.reason, "instructor_member_grade_excluded");
});

test("blocks duplicate fresh issuances instead of guessing", () => {
  const input = fixture();
  input.ticketRead.tickets.push({
    ...input.ticketRead.tickets[0],
    userTicketId: "201",
  });
  const result = selectNativeMembershipContractCandidate(input);
  assert.equal(result.status, "review");
  assert.equal(result.reason, "multiple_fresh_native_issuances");
});

test("holds multiple fresh issuances even when only one title matches Excel", () => {
  const input = fixture();
  input.ticketRead.tickets.push({
    ...input.ticketRead.tickets[0],
    userTicketId: "201",
    title: "다른 native 수강권명",
  });
  const result = selectNativeMembershipContractCandidate(input);
  assert.equal(result.status, "review");
  assert.equal(result.reason, "multiple_fresh_native_issuances");
  assert.equal(result.candidateCount, 2);
  assert.equal(result.selection, null);
});

test("ignores an Excel history change when no fresh native issuance exists", () => {
  const input = fixture();
  input.group.rows[0]["수강권명"] = "다른 수강권";
  input.ticketRead.tickets[0].issuedAt = PREVIOUS;
  const result = selectNativeMembershipContractCandidate(input);
  assert.equal(result.status, "ignored");
  assert.equal(result.reason, "no_fresh_native_issuance");
  assert.equal(result.candidateCount, 0);
});

test("a prior applicable signed membership contract selects renewal confirmation", () => {
  const input = fixture();
  addPriorRegularIssuance(input);
  input.contractHistory.records.push(nativeContract());
  const result = selectNativeMembershipContractCandidate(input);
  assert.equal(result.status, "eligible");
  assert.equal(result.selection.action, "renewal_purchase_confirmation");
});

test("prior native regular issuance selects renewal without a prior electronic agreement", () => {
  const input = fixture();
  addPriorRegularIssuance(input);
  const result = selectNativeMembershipContractCandidate(input);
  assert.equal(result.status, "eligible");
  assert.equal(result.selection.action, "renewal_purchase_confirmation");
  assert.deepEqual(result.selection.history.purchases.priorRegularIssuanceIds, ["199"]);
  assert.deepEqual(result.selection.history.contracts.records, []);
});

test("prior native purchase selects renewal even for a pre-cutover registered member", () => {
  const input = fixture();
  input.member.registeredAt = "2025-03-07T00:00:00.000Z";
  addPriorRegularIssuance(input);
  const result = selectNativeMembershipContractCandidate(input);
  assert.equal(result.status, "eligible");
  assert.equal(result.selection.action, "renewal_purchase_confirmation");
});

for (const title of ["아카이브 회원가입", "아카이브 재등록", "아카이브 재등록 구매조건 확인"]) {
  test(`maps category 1 ${title} to regular membership with native issuance binding`, () => {
    const input = fixture();
    addPriorRegularIssuance(input);
    const contract = nativeContract({ title });
    input.contractHistory.records.push(contract);
    const result = selectNativeMembershipContractCandidate(input);
    assert.equal(result.status, "eligible");
    assert.equal(result.selection.action, "renewal_purchase_confirmation");
    assert.deepEqual(result.selection.history.contracts.records[0], {
      contractId: contract.contractId,
      scope: "regular_membership",
      status: "signed",
      termsVersion: input.config.termsVersion,
      applicable: true,
      revoked: false,
      signedAt: contract.signedAt,
      validUntil: null,
      userTicketId: "199",
    });
  });

  test(`blocks same-issuance ${title} contracts rather than selecting another renewal`, () => {
    for (const status of ["draft", "opened", "sent", "signed", "cancelled", "expired"]) {
      const input = fixture();
      addPriorRegularIssuance(input);
      input.contractHistory.records.push(nativeContract({
        title,
        status,
        signedAt: status === "signed" ? "2026-09-14T00:45:00.000Z" : undefined,
        ticket: { userTicketId: "200", productId: "300" },
      }));
      const result = selectNativeMembershipContractCandidate(input);
      assert.equal(result.status, "review", status);
      assert.equal(result.reason, "existing_contract_for_issuance", status);
      assert.equal(result.selection, null, status);
    }
  });
}

test("unrelated signed contracts do not affect an independent native renewal", () => {
  for (const [categoryId, title, signedAt] of [
    [1, "개인레슨 동의서", "2026-09-01T00:00:00.000Z"],
    [2, "아카이브 재등록", "2026-09-01T00:00:00.000Z"],
    [1, "개인레슨 동의서", undefined],
  ]) {
    const input = fixture();
    addPriorRegularIssuance(input);
    const contract = nativeContract({ categoryId, title, signedAt });
    input.contractHistory.records.push(contract);
    const result = selectNativeMembershipContractCandidate(input);
    assert.equal(result.status, "eligible", `${categoryId}: ${title}`);
    assert.equal(result.selection.action, "renewal_purchase_confirmation");
    const mapped = result.selection.history.contracts.records[0];
    assert.equal(mapped.scope, "other");
    assert.equal(mapped.applicable, false);
    assert.equal(mapped.termsVersion, undefined);
    assert.equal(mapped.status, "signed");
    assert.equal(mapped.signedAt, contract.signedAt);
  }
});

test("only verified positive decimal native contract ticket IDs are attached", () => {
  for (const [verified, userTicketId, expected] of [
    [true, "199", "199"],
    [true, 199, "199"],
    [false, "199", undefined],
    [undefined, "199", undefined],
    ...[undefined, null, "", "0", "-199", "0199", "199.0", "excel_199", "9".repeat(65)]
      .map((id) => [true, id, undefined]),
  ]) {
    const input = fixture();
    input.contractHistory.records.push(nativeContract({
      status: "cancelled",
      signedAt: undefined,
      verified,
      ticket: { userTicketId },
    }));
    const result = selectNativeMembershipContractCandidate(input);
    assert.equal(result.status, "eligible", `${verified}: ${userTicketId}`);
    const mapped = result.selection.history.contracts.records[0];
    assert.equal(mapped.userTicketId, expected, `${verified}: ${userTicketId}`);
    assert.equal(Object.hasOwn(mapped, "userTicketId"), expected !== undefined);
    assert.equal(mapped.signedAt, undefined);
    assert.equal(Object.hasOwn(mapped, "memberSignaturePresent"), false);
  }
});

test("a signed status without provider time does not fabricate signature metadata", () => {
  const input = fixture();
  addPriorRegularIssuance(input);
  input.contractHistory.records.push(nativeContract({ signedAt: undefined }));
  const result = selectNativeMembershipContractCandidate(input);
  assert.equal(result.status, "review");
  assert.equal(result.reason, "incomplete_signature_evidence");
  assert.equal(result.selection, null);
  assert.equal(input.contractHistory.records[0].signedAt, undefined);
});
