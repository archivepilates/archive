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

test("blocks a native ticket that is absent from the changed Excel product hint", () => {
  const input = fixture();
  input.group.rows[0]["수강권명"] = "다른 수강권";
  const result = selectNativeMembershipContractCandidate(input);
  assert.equal(result.status, "review");
  assert.equal(result.reason, "fresh_native_issuance_not_found");
});

test("a prior applicable signed membership contract selects renewal confirmation", () => {
  const input = fixture();
  input.ticketRead.tickets.unshift({
    ...input.ticketRead.tickets[0],
    userTicketId: "199",
    issuedAt: "2026-09-13T23:30:00.000Z",
  });
  input.contractHistory.records.push({
    contractId: "a".repeat(64),
    categoryId: 1,
    title: "아카이브 회원가입",
    status: "signed",
    signedAt: "2026-09-01T00:00:00.000Z",
  });
  const result = selectNativeMembershipContractCandidate(input);
  assert.equal(result.status, "eligible");
  assert.equal(result.selection.action, "renewal_purchase_confirmation");
});
