import assert from "node:assert/strict";
import test from "node:test";
import { resolveParkingDiscountPolicy } from "../src/parking/parkingDiscountPolicy";

test("explicit staff jobs always use two 2-hour discounts", () => {
  assert.deepEqual(
    resolveParkingDiscountPolicy({
      ownerType: "staff",
      requestedDiscountHours: 2,
      maxAutoDiscountHours: 2,
      discountUnitHours: 4,
    }),
    {
      policy: "staff_fixed_4h",
      requestedDiscountHours: 4,
      maxAutoDiscountHours: 4,
      discountUnitHours: 2,
    },
  );
});

test("legacy staff jobs without ownerType still use four hours", () => {
  assert.equal(
    resolveParkingDiscountPolicy({ staffId: "staff_1", requestedDiscountHours: 2 }).requestedDiscountHours,
    4,
  );
});

test("member jobs retain their requested duration", () => {
  assert.deepEqual(
    resolveParkingDiscountPolicy({
      ownerType: "member",
      staffName: "수업 강사",
      requestedDiscountHours: 2,
      maxAutoDiscountHours: 4,
      discountUnitHours: 2,
    }),
    {
      policy: "standard",
      requestedDiscountHours: 2,
      maxAutoDiscountHours: 4,
      discountUnitHours: 2,
    },
  );
});

test("visitor jobs retain the existing four-hour request", () => {
  assert.equal(
    resolveParkingDiscountPolicy({
      ownerType: "visitor",
      requestedDiscountHours: 4,
      maxAutoDiscountHours: 4,
      discountUnitHours: 2,
    }).requestedDiscountHours,
    4,
  );
});
