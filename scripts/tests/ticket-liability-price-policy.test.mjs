import assert from "node:assert/strict";
import test from "node:test";
import {
  residualValueShare,
  resolveTicketUnitPrice,
  summarizeUnitPriceAverage,
  ticketPriceCategory,
} from "../lib/ticket-liability-price-policy.mjs";

test("computes each ticket's share of the total remaining value", () => {
  assert.equal(residualValueShare(25_000_000, 100_000_000), 0.25);
  assert.equal(residualValueShare(0, 100_000_000), 0);
  assert.equal(residualValueShare(10_000, 0), 0);
});

test("separates one-to-one, duet, group, and staff lesson tickets", () => {
  assert.equal(ticketPriceCategory({ name: "프라이빗 20회", classType: "프라이빗" }), "private");
  assert.equal(ticketPriceCategory({ name: "듀엣 레슨 20회권", classType: "프라이빗" }), "duet");
  assert.equal(ticketPriceCategory({ name: "50회권(5개월)", classType: "그룹" }), "group");
  assert.equal(ticketPriceCategory({ name: "강사레슨 (2T)", classType: "그룹" }), "staff");
});

test("replaces incomplete and reservation-only prices with the product reference", () => {
  const scheduled = resolveTicketUnitPrice({
    rawUnitPrice: 25_000,
    referenceUnitPrice: 70_000,
    rawPriceSource: "active_ticket",
    paymentType: "재결제",
    status: "사용예정",
  });
  const outstanding = resolveTicketUnitPrice({
    rawUnitPrice: 7_000,
    referenceUnitPrice: 17_800,
    rawPriceSource: "active_ticket",
    paymentType: "미수금",
    status: "사용중",
  });
  const temporaryProfile = resolveTicketUnitPrice({
    rawUnitPrice: 13_000,
    referenceUnitPrice: 70_000,
    rawPriceSource: "active_ticket",
    profileKind: "reservation_only",
  });
  assert.deepEqual([scheduled.unitPrice, outstanding.unitPrice, temporaryProfile.unitPrice], [70_000, 17_800, 70_000]);
  assert.deepEqual([scheduled.priceQuality, outstanding.priceQuality, temporaryProfile.priceQuality], ["adjusted", "adjusted", "adjusted"]);
});

test("keeps a legitimate moderate discount and accepts aggregated purchase totals", () => {
  const discount = resolveTicketUnitPrice({
    rawUnitPrice: 19_800,
    referenceUnitPrice: 25_000,
    rawPriceSource: "active_ticket",
  });
  const aggregate = resolveTicketUnitPrice({
    rawUnitPrice: 70_000,
    referenceUnitPrice: 70_000,
    rawPriceSource: "purchase_aggregate",
    paymentType: "미수금",
  });
  assert.equal(discount.unitPrice, 19_800);
  assert.equal(discount.priceQuality, "confirmed");
  assert.equal(aggregate.unitPrice, 70_000);
  assert.equal(aggregate.priceSource, "결제이력 합산");
});

test("computes category averages without duet or staff leakage", () => {
  const rows = [
    { priceCategory: "private", unitPrice: 55_000, denominator: 30, priceQuality: "confirmed" },
    { priceCategory: "private", unitPrice: 70_000, denominator: 20, priceQuality: "adjusted" },
    { priceCategory: "duet", unitPrice: 37_500, denominator: 20, priceQuality: "confirmed" },
    { priceCategory: "staff", unitPrice: 35_000, denominator: 2, priceQuality: "confirmed" },
  ];
  const result = summarizeUnitPriceAverage(rows, "private");
  assert.equal(result.averageUnitPrice, 61_000);
  assert.equal(result.pricedTicketRows, 2);
  assert.equal(result.purchasedSessionCount, 50);
  assert.equal(result.adjustedPriceRows, 1);
});
