import assert from "node:assert/strict";
import test from "node:test";
import { assertNativeRefundTicketSource, readNativeRefundSource, refundNativeMemberPointer } from "../lib/studiomate-refund-native-source.mjs";

function fixture() {
  const snapshot = {
    ticketKey: "userTicket:201",
    ticketName: "Synthetic pass",
    status: "active",
    paymentAmount: 100000,
    totalCount: 10,
    remainingCount: 8,
    availableFrom: "2026-07-31T15:00:00.000Z",
    purchasedAt: null,
    paymentAt: null,
    expiresAt: "2099-12-31T14:59:59.000Z",
  };
  const job = {
    memberId: "excel_synthetic",
    memberName: "Synthetic member",
    memberPhone: "01000000000",
    studioId: "5330",
    studiomateMemberId: "101",
    ticketKey: snapshot.ticketKey,
    ticketName: snapshot.ticketName,
    ticketSourceSnapshot: snapshot,
  };
  const memberResult = {
    status: "verified",
    reason: "exact_phone_match",
    matchCount: 1,
    member: { memberId: "101", name: job.memberName, phone: job.memberPhone, inactive: false },
  };
  const ticket = {
    source: "studiomate_native_ticket", verified: true, complete: true,
    studioId: "5330", memberId: "101", userTicketId: "201", productId: "301",
    title: snapshot.ticketName, availabilityStartAt: "2026-08-01", expireAt: "2099-12-31",
    status: "active", active: true, usable: true, cancelled: false, refunded: false, isShared: false,
    maxCoupon: 10, remainingCoupon: 8,
    payment: { verified: true, complete: true, status: "paid", totalAmount: 100000, paidAmount: 100000, outstandingAmount: 0, refundedAmount: 0 },
  };
  const ticketRead = { status: "verified", reason: "complete_native_ticket_list", tickets: [ticket] };
  return { job, memberResult, ticketRead, ticket };
}

test("native guard accepts one exact KST ticket and returns only minimal non-private proof", () => {
  const { job, memberResult, ticketRead } = fixture();
  const before = JSON.stringify({ job, memberResult, ticketRead });
  const result = assertNativeRefundTicketSource(job, memberResult, ticketRead);
  assert.deepEqual(result, {
    studiomateMemberId: "101", userTicketId: "201", productId: "301",
    sourceProof: { source: "studiomate_native_ticket", verified: true, complete: true, studioId: "5330", status: "active",
      availableFrom: "2026-08-01", expiresAt: "2099-12-31", totalCount: 10, remainingCount: 8, paymentAmount: 100000 },
  });
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.sourceProof));
  assert.equal(JSON.stringify({ job, memberResult, ticketRead }), before);
  assert.ok(!JSON.stringify(result).includes(job.memberName));
  assert.ok(!JSON.stringify(result).includes(job.memberPhone));
  assert.ok(!Object.hasOwn(result, "refundSettled"));
});

test("native guard accepts scheduled usable tickets and optional member ID without guessing Excel IDs", () => {
  const { job, memberResult, ticketRead, ticket } = fixture();
  delete job.studiomateMemberId;
  ticket.status = "scheduled";
  ticket.active = false;
  assert.equal(assertNativeRefundTicketSource(job, memberResult, ticketRead).sourceProof.status, "scheduled");
  job.studiomateMemberId = 101;
  assert.equal(assertNativeRefundTicketSource(job, memberResult, ticketRead).studiomateMemberId, "101");
});

test("member pointer accepts agreeing queued, profile and numeric member identities without mutation", () => {
  for (const [job, profile] of [
    [{ memberId: "101", studiomateMemberId: "101" }, { studiomateMemberId: "101" }],
    [{ memberId: 101, studiomateMemberId: 101 }, { studiomateMemberId: "101" }],
    [{ memberId: "excel_synthetic", studiomateMemberId: "101" }, { studiomateMemberId: 101 }],
    [{ memberId: "101" }, {}],
    [{ memberId: "excel_synthetic", studiomateMemberId: "101" }, {}],
    [{ memberId: "excel_synthetic" }, { studiomateMemberId: "101" }],
  ]) {
    const before = structuredClone({ job, profile });
    assert.equal(refundNativeMemberPointer(job, profile), "101");
    assert.deepEqual({ job, profile }, before);
  }
});

test("member pointer rejects conflicts between any two provided numeric identities", () => {
  for (const [job, profile] of [
    [{ memberId: "excel_synthetic", studiomateMemberId: "101" }, { studiomateMemberId: "102" }],
    [{ memberId: "102", studiomateMemberId: "101" }, {}],
    [{ memberId: "102" }, { studiomateMemberId: "101" }],
    [{ memberId: "102", studiomateMemberId: "101" }, { studiomateMemberId: "101" }],
    [{ memberId: "101", studiomateMemberId: "101" }, { studiomateMemberId: 102 }],
  ]) {
    assert.throws(() => refundNativeMemberPointer(job, profile), /회원 ID.*서로 다릅니다/);
  }
});

test("member pointer rejects invalid provided pointers rather than ignoring them beside a valid ID", () => {
  for (const pointer of ["excel_101", "0", "00101", " 101", "101 ", "bad", "-1", "1.5", 0, -1, 1.5, NaN, Infinity,
    Number.MAX_SAFE_INTEGER + 1, true, {}, [], "1".repeat(65)]) {
    assert.throws(() => refundNativeMemberPointer({ memberId: "101", studiomateMemberId: pointer }, {}), /회원 ID/);
    assert.throws(() => refundNativeMemberPointer({ memberId: "101" }, { studiomateMemberId: pointer }), /회원 ID/);
  }
  for (const memberId of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "0", "00101", "-1", "1.5", "+101", " 101 "]) {
    assert.throws(() => refundNativeMemberPointer({ memberId, studiomateMemberId: "101" }, {}), /회원 ID/);
  }
});

test("member pointer permits no native ID for exact-phone lookup without guessing an Excel ID", () => {
  for (const [job, profile] of [
    [undefined, undefined], [null, null], [{}, {}],
    [{ memberId: "excel_synthetic" }, {}],
    [{ memberId: "excel_synthetic", studiomateMemberId: null }, { studiomateMemberId: "" }],
  ]) {
    assert.equal(refundNativeMemberPointer(job, profile), undefined);
  }
});

test("native guard accepts only confirmed Korean usable source statuses and preserves the raw snapshot", () => {
  for (const status of ["active", "scheduled", "사용중", "이용중", "사용중 (110일 남음)", "이용중 (0일 남음)", "사용중(9일 남음)"]) {
    const { job, memberResult, ticketRead } = fixture();
    job.ticketSourceSnapshot.status = status;
    const before = structuredClone(job.ticketSourceSnapshot);
    assert.equal(assertNativeRefundTicketSource(job, memberResult, ticketRead).sourceProof.status, "active", status);
    assert.deepEqual(job.ticketSourceSnapshot, before);
  }
});

test("unknown, negative, expired, holding and approximate Korean statuses fail before a browser is opened", async () => {
  for (const status of ["unknown", "Active", "inactive", "refunded", "cancelled", "사용만료", "이용만료", "환불", "취소",
    "사용예정", "이용예정", "미사용", "정지중", "홀딩중", "사용중 (만료)", "사용중 (정지중)", "사용중 (환불)",
    "사용중 (-1일 남음)", "사용중 (110일 남음) 취소", "사용중 확인필요", "사용중 (110일 정지)"]) {
    const { job, memberResult, ticketRead } = fixture();
    job.ticketSourceSnapshot.status = status;
    assert.throws(() => assertNativeRefundTicketSource(job, memberResult, ticketRead), /환불 작업/, status);
    await assert.rejects(() => readNativeRefundSource(job), /환불 작업/, status);
  }
});

test("Korean usable source text never overrides native cancellation, usability or payment evidence", () => {
  for (const patch of [{ refunded: true }, { cancelled: true }, { usable: false }, { status: "inactive", active: false, usable: false },
    { isShared: true }, { payment: { verified: false } }]) {
    const { job, memberResult, ticketRead, ticket } = fixture();
    job.ticketSourceSnapshot.status = "사용중 (110일 남음)";
    Object.assign(ticket, patch);
    assert.throws(() => assertNativeRefundTicketSource(job, memberResult, ticketRead), /네이티브/);
  }
});

test("native guard requires verified exact member name, full phone, and a unique native ID", () => {
  for (const patch of [{ status: "review" }, { matchCount: 2 }, { reason: "partial_match" }, { member: null }]) {
    const { job, memberResult, ticketRead } = fixture();
    assert.throws(() => assertNativeRefundTicketSource(job, { ...memberResult, ...patch }, ticketRead), /네이티브 회원/);
  }
  for (const patch of [{ name: "Other member" }, { phone: "01011110000" }, { memberId: "excel_101" }, { inactive: true }, { inactive: undefined }]) {
    const { job, memberResult, ticketRead } = fixture();
    Object.assign(memberResult.member, patch);
    assert.throws(() => assertNativeRefundTicketSource(job, memberResult, ticketRead), /네이티브 회원/);
  }
  for (const id of ["102", "excel_101", 1.5]) {
    const { job, memberResult, ticketRead } = fixture();
    job.studiomateMemberId = id;
    assert.throws(() => assertNativeRefundTicketSource(job, memberResult, ticketRead), /회원 ID/);
  }
});

test("native guard rejects missing or incomplete lists and wrong ticket ownership", () => {
  for (const patch of [{ status: "review" }, { reason: "partial_page" }, { tickets: null }, { tickets: [] }]) {
    const { job, memberResult, ticketRead } = fixture();
    assert.throws(() => assertNativeRefundTicketSource(job, memberResult, { ...ticketRead, ...patch }), /네이티브 수강권/);
  }
  for (const patch of [{ verified: false }, { complete: false }, { source: "excel" }, { memberId: "102" }, { studioId: "other" },
    { userTicketId: "" }, { productId: "bad" }, { title: "" }, { availabilityStartAt: "2026-02-30" }, { expireAt: null }]) {
    const { job, memberResult, ticketRead, ticket } = fixture();
    Object.assign(ticket, patch);
    assert.throws(() => assertNativeRefundTicketSource(job, memberResult, ticketRead), /네이티브 수강권/);
  }
});

test("unrelated historical tickets need valid identity but do not need target date or payment completeness", () => {
  for (const patch of [
    { title: "", availabilityStartAt: "", expireAt: "" },
    { title: "Old pass", availabilityStartAt: "invalid", expireAt: null },
    { title: "Synthetic pass", availabilityStartAt: "", expireAt: "" },
  ]) {
    const { job, memberResult, ticketRead } = fixture();
    ticketRead.tickets.push({ userTicketId: "202", memberId: "101", studioId: "5330", complete: false, verified: false, ...patch });
    assert.equal(assertNativeRefundTicketSource(job, memberResult, ticketRead).userTicketId, "201");
  }
});

test("historical rows still cannot bypass full-list ownership, identity, or duplicate-ID checks", () => {
  for (const patch of [{ userTicketId: "" }, { userTicketId: "201" }, { memberId: "102" }, { studioId: "5331" }]) {
    const { job, memberResult, ticketRead } = fixture();
    ticketRead.tickets.push({ userTicketId: "202", memberId: "101", studioId: "5330", title: "", ...patch });
    assert.throws(() => assertNativeRefundTicketSource(job, memberResult, ticketRead), /식별자|중복/);
  }
});

test("native guard rejects duplicate IDs and duplicate title/date matches including inactive duplicates", () => {
  for (const patch of [{}, { userTicketId: "202" }, { userTicketId: "202", status: "inactive", active: false, usable: false, refunded: true }]) {
    const { job, memberResult, ticketRead, ticket } = fixture();
    ticketRead.tickets.push({ ...ticket, ...patch });
    assert.throws(() => assertNativeRefundTicketSource(job, memberResult, ticketRead), /중복|여러 개/);
  }
});

test("native guard blocks refunded/cancelled/inactive tickets without inferring actual settlement", () => {
  for (const patch of [{ refunded: true }, { cancelled: true }, { refunded: undefined },
    { status: "inactive", active: false, usable: false }, { usable: false }, { status: "expired" },
    { active: false }, { isShared: true }]) {
    const { job, memberResult, ticketRead, ticket } = fixture();
    Object.assign(ticket, patch);
    assert.throws(() => assertNativeRefundTicketSource(job, memberResult, ticketRead), /환불·취소|비활성|공유/);
  }
  const { job, memberResult, ticketRead, ticket } = fixture();
  Object.assign(ticket, { status: "inactive", active: false, usable: false });
  assert.throws(() => assertNativeRefundTicketSource(job, memberResult, ticketRead), /실제 환불 정산 여부를 뜻하지 않/);
});

test("native guard matches exact title and KST dates, not UTC date slices or nearby tickets", () => {
  for (const patch of [{ title: "Synthetic pass changed" }, { availabilityStartAt: "2026-07-31" }, { expireAt: "2100-01-01" },
    { userTicketId: "202" }]) {
    const { job, memberResult, ticketRead, ticket } = fixture();
    Object.assign(ticket, patch);
    assert.throws(() => assertNativeRefundTicketSource(job, memberResult, ticketRead), /수강권/);
  }
  const { job, memberResult, ticketRead } = fixture();
  job.ticketKey = job.ticketSourceSnapshot.ticketKey = "ticket:999";
  assert.throws(() => assertNativeRefundTicketSource(job, memberResult, ticketRead), /수강권 ID/);
});

test("native guard requires nonnegative exact totals when present and compares canonical remaining coupons", () => {
  for (const patch of [{ maxCoupon: 11 }, { maxCoupon: "10" }, { maxCoupon: null }, { remainingCoupon: 7 },
    { remainingCoupon: "8" }, { remainingCoupon: null }]) {
    const { job, memberResult, ticketRead, ticket } = fixture();
    Object.assign(ticket, patch);
    assert.throws(() => assertNativeRefundTicketSource(job, memberResult, ticketRead), /총횟수|잔여횟수/);
  }
  const { job, memberResult, ticketRead, ticket } = fixture();
  job.ticketSourceSnapshot.remainingCount = null;
  ticket.remainingCoupon = null;
  assert.doesNotThrow(() => assertNativeRefundTicketSource(job, memberResult, ticketRead));
});

test("native guard accepts period tickets with null source counts without inventing native totals", () => {
  for (const nativeTotal of [null, -1, 0]) {
    const { job, memberResult, ticketRead, ticket } = fixture();
    job.ticketSourceSnapshot.totalCount = null;
    job.ticketSourceSnapshot.remainingCount = null;
    ticket.maxCoupon = nativeTotal;
    ticket.remainingCoupon = null;
    const proof = assertNativeRefundTicketSource(job, memberResult, ticketRead).sourceProof;
    assert.equal(proof.totalCount, null);
    assert.equal(proof.remainingCount, null);
    assert.equal(proof.paymentAmount, 100000);
    assert.equal(proof.availableFrom, "2026-08-01");
    assert.equal(proof.expiresAt, "2099-12-31");
    ticket.payment.paidAmount = 99999;
    assert.throws(() => assertNativeRefundTicketSource(job, memberResult, ticketRead), /네이티브 결제/);
  }
});

function zeroPeriodFixture(remainingCount = null) {
  const data = fixture();
  Object.assign(data.job.ticketSourceSnapshot, { totalCount: 0, remainingCount, status: "사용중 (110일 남음)" });
  Object.assign(data.ticket, { maxCoupon: 0, remainingCoupon: remainingCount });
  return data;
}

test("zero-count period tickets require exact native zero and retain canonical zero in proof", () => {
  for (const remaining of [null, 0]) {
    const { job, memberResult, ticketRead } = zeroPeriodFixture(remaining);
    const proof = assertNativeRefundTicketSource(job, memberResult, ticketRead).sourceProof;
    assert.equal(proof.totalCount, 0);
    assert.equal(proof.remainingCount, remaining);
    assert.equal(proof.availableFrom, "2026-08-01");
    assert.equal(proof.expiresAt, "2099-12-31");
    assert.equal(proof.paymentAmount, 100000);
  }
  for (const nativeTotal of [null, undefined, -1, 1, "0", false, 0.5, NaN]) {
    const { job, memberResult, ticketRead, ticket } = zeroPeriodFixture();
    ticket.maxCoupon = nativeTotal;
    assert.throws(() => assertNativeRefundTicketSource(job, memberResult, ticketRead), /총횟수/);
  }
  for (const remaining of [null, 1, "0", -1]) {
    const { job, memberResult, ticketRead, ticket } = zeroPeriodFixture(0);
    ticket.remainingCoupon = remaining;
    assert.throws(() => assertNativeRefundTicketSource(job, memberResult, ticketRead), /잔여횟수/);
  }
});

test("zero-count period tickets do not bypass dates, identity, usability or native payment checks", () => {
  for (const patch of [{ availabilityStartAt: "2026-07-31" }, { expireAt: "2100-01-01" },
    { memberId: "102" }, { productId: "invalid" }, { usable: false }, { cancelled: true }, { refunded: true }]) {
    const { job, memberResult, ticketRead, ticket } = zeroPeriodFixture();
    Object.assign(ticket, patch);
    assert.throws(() => assertNativeRefundTicketSource(job, memberResult, ticketRead), /네이티브/);
  }
  for (const patch of [{ verified: false }, { complete: false }, { paidAmount: 0 }, { paidAmount: 99999 },
    { totalAmount: 99999 }, { outstandingAmount: 1 }, { refundedAmount: 1 }]) {
    const { job, memberResult, ticketRead, ticket } = zeroPeriodFixture();
    Object.assign(ticket.payment, patch);
    assert.throws(() => assertNativeRefundTicketSource(job, memberResult, ticketRead), /네이티브 결제/);
  }
});

test("null source total does not bypass a canonical non-null remaining count", () => {
  const { job, memberResult, ticketRead, ticket } = fixture();
  job.ticketSourceSnapshot.totalCount = null;
  ticket.maxCoupon = null;
  assert.doesNotThrow(() => assertNativeRefundTicketSource(job, memberResult, ticketRead));
  for (const value of [7, null, "8"]) {
    ticket.remainingCoupon = value;
    assert.throws(() => assertNativeRefundTicketSource(job, memberResult, ticketRead), /잔여횟수/);
  }
});

test("native guard rejects unverified, partial, refunded, or mismatched payment without accepting manual amount overrides", () => {
  for (const patch of [{ verified: false }, { complete: false }, { status: "partial" }, { paidAmount: 99999 },
    { paidAmount: "100000" }, { totalAmount: 99999 }, { outstandingAmount: 1 }, { refundedAmount: 1 }]) {
    const { job, memberResult, ticketRead, ticket } = fixture();
    Object.assign(ticket.payment, patch);
    job.paymentAmount = 99999;
    assert.throws(() => assertNativeRefundTicketSource(job, memberResult, ticketRead), /네이티브 결제/);
  }
  const { job, memberResult, ticketRead, ticket } = fixture();
  ticket.payment = null;
  assert.throws(() => assertNativeRefundTicketSource(job, memberResult, ticketRead), /네이티브 결제/);
});

test("native guard refuses malformed or ambiguous source fields before any browser is opened", async () => {
  for (const patch of [{ availableFrom: null }, { availableFrom: "2100-01-01T00:00:00.000Z" },
    { status: "inactive" }, { totalCount: 0, remainingCount: 1 }, { totalCount: 7 },
    { remainingCount: 11 }, { paymentAmount: null }, { paymentAmount: 0 }, { paymentAmount: "100000" }, { unknown: true }]) {
    const { job, memberResult, ticketRead } = fixture();
    Object.assign(job.ticketSourceSnapshot, patch);
    assert.throws(() => assertNativeRefundTicketSource(job, memberResult, ticketRead), /원천|스냅샷/);
    await assert.rejects(() => readNativeRefundSource(job), /원천|스냅샷/);
  }
  for (const key of Object.keys(fixture().job.ticketSourceSnapshot)) {
    const { job, memberResult, ticketRead } = fixture();
    delete job.ticketSourceSnapshot[key];
    assert.throws(() => assertNativeRefundTicketSource(job, memberResult, ticketRead), /스냅샷/);
  }
  for (const snapshot of [null, undefined, {}, []]) {
    const { job, memberResult, ticketRead } = fixture();
    job.ticketSourceSnapshot = snapshot;
    assert.throws(() => assertNativeRefundTicketSource(job, memberResult, ticketRead), /스냅샷/);
  }
  for (const patch of [{ memberPhone: "0000" }, { memberName: "" }, { studioId: "other" }, { ticketName: "Other pass" }, { ticketKey: "other" }]) {
    const { job, memberResult, ticketRead } = fixture();
    Object.assign(job, patch);
    assert.throws(() => assertNativeRefundTicketSource(job, memberResult, ticketRead), /환불 작업/);
  }
});

test("borrowed context uses a separate GET-only page and closes only that page on bootstrap failure", async () => {
  const { job } = fixture();
  const events = [];
  let routeHandler;
  const child = {
    route: async (pattern, handler) => {
      assert.equal(pattern, "**/*");
      routeHandler = handler;
      events.push("route");
      throw new Error("Synthetic bootstrap failure; no API or browser is used");
    },
    close: async () => events.push("child-close"),
  };
  const context = { newPage: async () => { events.push("new-page"); return child; } };
  const parent = {
    context: () => context,
    goto: () => assert.fail("the SMS composer must never navigate"),
    close: () => assert.fail("the caller page must never close"),
  };
  await assert.rejects(() => readNativeRefundSource(job, { page: parent }), /읽기 전용 세션 확인에 실패/);
  assert.deepEqual(events, ["new-page", "route", "child-close"]);
  for (const method of ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"]) {
    let outcome;
    await routeHandler({
      request: () => ({ method: () => method }),
      continue: async () => { outcome = "continue"; },
      abort: async (reason) => { assert.equal(reason, "blockedbyclient"); outcome = "abort"; },
    });
    assert.equal(outcome, ["GET", "HEAD", "OPTIONS"].includes(method) ? "continue" : "abort");
  }
});
