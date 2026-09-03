import assert from "node:assert/strict";
import test from "node:test";
import {
  IparkingApiError,
  parseIparkingAccountPool,
  resolveIparkingAccountStoreSeq,
} from "../src/parking/iparkingClient";

test("main parking accounts are ordered before sub accounts", () => {
  const accounts = parseIparkingAccountPool(
    JSON.stringify({
      accounts: [
        { label: "sub-504", role: "sub", loginId: "sub-id", loginPassword: "sub-password", storeSeq: 287756 },
        { label: "main-704", role: "main", loginId: "main-id", loginPassword: "main-password", storeSeq: 287798 },
        {
          label: "main-705",
          role: "main",
          loginId: "main-secondary-id",
          loginPassword: "main-secondary-password",
          storeSeq: 287799,
        },
      ],
    }),
  );

  assert.deepEqual(
    accounts.map(({ label, role, storeSeq }) => ({ label, role, storeSeq })),
    [
      { label: "main-704", role: "main", storeSeq: 287798 },
      { label: "main-705", role: "main", storeSeq: 287799 },
      { label: "sub-504", role: "sub", storeSeq: 287756 },
    ],
  );
});

test("parking account pool rejects duplicate store sequences", () => {
  assert.throws(
    () =>
      parseIparkingAccountPool(
        JSON.stringify([
          { label: "main-704", role: "main", loginId: "main-id", loginPassword: "one", storeSeq: 287798 },
          { label: "sub-504", role: "sub", loginId: "sub-id", loginPassword: "two", storeSeq: 287798 },
        ]),
      ),
    IparkingApiError,
  );
});

test("parking account pool requires a valid role and store sequence", () => {
  assert.throws(
    () =>
      parseIparkingAccountPool(
        JSON.stringify([{ label: "invalid", role: "backup", loginId: "id", loginPassword: "password", storeSeq: 0 }]),
      ),
    IparkingApiError,
  );
});

test("configured account store sequence overrides the legacy fallback", () => {
  assert.equal(
    resolveIparkingAccountStoreSeq(
      {
        label: "main-705",
        role: "main",
        loginId: "main-secondary-id",
        loginPassword: "main-secondary-password",
        storeSeq: 287799,
      },
      287798,
    ),
    287799,
  );
});

test("the full parking pool keeps main accounts before all sub accounts", () => {
  const accounts = parseIparkingAccountPool(
    JSON.stringify({
      accounts: [
        ...[504, 505, 506, 507, 508].map((room, index) => ({
          label: `sub-${room}`,
          role: "sub",
          loginId: `sub-${room}-id`,
          loginPassword: `sub-${room}-password`,
          storeSeq: 287756 + index,
        })),
        {
          label: "main-704",
          role: "main",
          loginId: "main-704-id",
          loginPassword: "main-704-password",
          storeSeq: 287798,
        },
        {
          label: "main-705",
          role: "main",
          loginId: "main-705-id",
          loginPassword: "main-705-password",
          storeSeq: 287799,
        },
      ],
    }),
  );

  assert.deepEqual(
    accounts.map(({ label, storeSeq }) => ({ label, storeSeq })),
    [
      { label: "main-704", storeSeq: 287798 },
      { label: "main-705", storeSeq: 287799 },
      { label: "sub-504", storeSeq: 287756 },
      { label: "sub-505", storeSeq: 287757 },
      { label: "sub-506", storeSeq: 287758 },
      { label: "sub-507", storeSeq: 287759 },
      { label: "sub-508", storeSeq: 287760 },
    ],
  );
});
