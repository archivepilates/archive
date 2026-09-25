import assert from "node:assert/strict";
import test from "node:test";
import {
  createStudioMateNativeApiClient,
  normalizePayments,
  normalizeStudioMateDate,
  parseStudioMateLocalTime,
  readExactStudioMateMember,
  StudioMateNativeApiError,
} from "./studiomate-native-contract-source.mjs";

const SESSION_HEADERS = Object.freeze({
  authorization: "Synthetic session",
  "x-sm-signature": "synthetic-signature",
  "web-version": "synthetic-version",
});

test("parses only strict StudioMate local timestamps as KST instants", () => {
  assert.equal(
    parseStudioMateLocalTime("2026-09-14 12:34:56"),
    "2026-09-14T03:34:56.000Z",
  );
  assert.equal(
    parseStudioMateLocalTime("2024-02-29T00:00:00.7"),
    "2024-02-28T15:00:00.700Z",
  );

  for (const value of [
    null,
    20260914,
    "2026-9-14 12:34:56",
    "2026-09-14 2:34:56",
    "2026-09-14 12:34",
    "2026-09-14 12:34:56.1234",
    "2026-09-14T12:34:56Z",
    "2026-09-14T12:34:56+09:00",
    "2026-02-29 00:00:00",
    "2026-04-31 00:00:00",
    "2026-09-14 24:00:00",
  ]) {
    assert.equal(parseStudioMateLocalTime(value), null, String(value));
  }
});

test("normalizes StudioMate ticket dates without accepting calendar rollover", () => {
  assert.equal(normalizeStudioMateDate("2026-09-21"), "2026-09-21");
  assert.equal(
    normalizeStudioMateDate("2026-09-21 00:00:00"),
    "2026-09-21",
  );
  assert.equal(normalizeStudioMateDate("2026. 09. 21"), "2026-09-21");
  assert.equal(normalizeStudioMateDate("2026-02-30 00:00:00"), "");
  assert.equal(normalizeStudioMateDate("2026-09-21T00:00:00Z"), "");
});

test("requires exactly one native member with the exact normalized phone", async () => {
  const requestedPaths = [];
  const result = await readExactStudioMateMember(
    {
      get: async (pathname) => {
        requestedPaths.push(pathname);
        if (pathname === "/staff/member/101") {
          return {
            member: {
              id: 101,
              name: "Synthetic Member",
              mobile: "01012345678",
              user_grade: { name: "강사회원" },
              profile: { gender: "F", birthday: "2000-01-02" },
              account_id: 901,
              deleted_at: null,
            },
          };
        }
        return {
          members: [
            {
              id: 101,
              name: "Synthetic Member",
              mobile: "010-1234-5678",
              user_grade: null,
              profile: { gender: "F", birthday: "2000-01-02" },
              account_id: 901,
            },
            { id: 102, name: "Near Match", mobile: "010-1234-5679" },
          ],
        };
      },
    },
    "01012345678",
  );

  assert.deepEqual(requestedPaths, [
    "/v2/staff/contract/member-list?search_word=01012345678",
    "/staff/member/101",
  ]);
  assert.deepEqual(result, {
    status: "verified",
    reason: "exact_phone_match",
    matchCount: 1,
    member: {
      memberId: "101",
      name: "Synthetic Member",
      phone: "01012345678",
      memberGrade: "강사회원",
      gender: "F",
      birthday: "2000-01-02",
      inactive: false,
      hasAccount: true,
    },
  });

  const ambiguous = await readExactStudioMateMember(
    {
      get: async () => [
        { id: 101, mobile: "010-1234-5678" },
        { id: 103, mobile: "01012345678" },
      ],
    },
    "010-1234-5678",
  );
  assert.deepEqual(ambiguous, {
    status: "review",
    reason: "ambiguous_exact_phone",
    matchCount: 2,
    member: null,
  });
});

test("fails closed when the StudioMate member detail does not match the search identity", async () => {
  const result = await readExactStudioMateMember(
    {
      get: async (pathname) =>
        pathname.startsWith("/v2/staff/contract/member-list")
          ? {
              members: [
                { id: 101, name: "Synthetic Member", mobile: "01012345678" },
              ],
            }
          : {
              member: {
                id: 101,
                name: "Different Member",
                mobile: "01012345678",
                deleted_at: null,
              },
            },
    },
    "01012345678",
  );

  assert.deepEqual(result, {
    status: "review",
    reason: "member_detail_identity_mismatch",
    matchCount: 1,
    member: null,
  });
});

test("normalizes an initial unpaid ledger and later card settlement once", () => {
  const payment = normalizePayments([
    {
      id: 501,
      created_at: "2026-09-14 10:00:00",
      // StudioMate touches this original ledger after the settlement is added.
      updated_at: "2026-09-14 10:06:01",
      card_amount: 0,
      cash_amount: 0,
      wiretransfer_amount: 0,
      transfer_amount: 0,
      unpaid_amount: 120000,
      installment_period: 0,
    },
    {
      id: 502,
      created_at: "2026-09-14 10:05:00",
      updated_at: "2026-09-14 10:06:00",
      settlement_at: "2026-09-14 10:05:00",
      card_amount: 120000,
      cash_amount: 0,
      wiretransfer_amount: 0,
      transfer_amount: 0,
      unpaid_amount: 0,
      installment_period: 3,
    },
  ]);

  assert.equal(payment.status, "paid");
  assert.equal(payment.paidAmount, 120000);
  assert.equal(payment.outstandingAmount, 0);
  assert.deepEqual(payment.transactions, [
    {
      paymentId: "502:card",
      method: "card",
      status: "paid",
      amount: 120000,
      paidAt: "2026-09-14T01:05:00.000Z",
      installmentMonths: 3,
    },
  ]);
  assert.deepEqual(payment.contractPayment, {
    cardAmount: 120000,
    cashAmount: 0,
    wireAmount: 0,
    pointAmount: 0,
    amount: 120000,
    unpaidAmount: 0,
    installmentPeriod: 3,
  });
});

test("normalizes unpaid and partial ledgers for contract display without blocking issuance", () => {
  const unpaid = normalizePayments([
    {
      id: 601,
      created_at: "2026-09-14 10:00:00",
      card_amount: 0,
      cash_amount: 0,
      wiretransfer_amount: 0,
      transfer_amount: 0,
      unpaid_amount: 398000,
      installment_period: 0,
    },
  ]);
  assert.deepEqual(
    {
      status: unpaid.status,
      totalAmount: unpaid.totalAmount,
      paidAmount: unpaid.paidAmount,
      outstandingAmount: unpaid.outstandingAmount,
      transactions: unpaid.transactions,
      contractPayment: unpaid.contractPayment,
    },
    {
      status: "unpaid",
      totalAmount: 398000,
      paidAmount: 0,
      outstandingAmount: 398000,
      transactions: [],
      contractPayment: {
        cardAmount: 0,
        cashAmount: 0,
        wireAmount: 0,
        pointAmount: 0,
        amount: 0,
        unpaidAmount: 398000,
        installmentPeriod: 0,
      },
    },
  );

  const partial = normalizePayments([
    {
      id: 602,
      created_at: "2026-09-14 10:00:00",
      card_amount: 100000,
      cash_amount: 0,
      wiretransfer_amount: 0,
      transfer_amount: 0,
      unpaid_amount: 298000,
      installment_period: 0,
    },
  ]);
  assert.equal(partial.status, "partial");
  assert.equal(partial.totalAmount, 398000);
  assert.equal(partial.paidAmount, 100000);
  assert.equal(partial.outstandingAmount, 298000);
  assert.equal(partial.contractPayment.amount, 100000);
  assert.equal(partial.contractPayment.unpaidAmount, 298000);
});

test("requires signed session headers and marks write transport failures ambiguous", async () => {
  for (const missing of Object.keys(SESSION_HEADERS)) {
    const headers = { ...SESSION_HEADERS };
    delete headers[missing];
    assert.throws(
      () => createStudioMateNativeApiClient({ headers, fetchImpl: async () => {} }),
      new RegExp(`session header missing: ${missing}`),
    );
  }

  const api = createStudioMateNativeApiClient({
    headers: SESSION_HEADERS,
    fetchImpl: async () => {
      throw new Error("synthetic transport loss");
    },
  });
  await assert.rejects(api.post("/v2/staff/contract/join", {}), (error) => {
    assert.ok(error instanceof StudioMateNativeApiError);
    assert.equal(error.method, "POST");
    assert.equal(error.ambiguous, true);
    return true;
  });
  await assert.rejects(api.get("/v2/staff/contract/abc"), (error) => {
    assert.ok(error instanceof StudioMateNativeApiError);
    assert.equal(error.method, "GET");
    assert.equal(error.ambiguous, false);
    return true;
  });
});
