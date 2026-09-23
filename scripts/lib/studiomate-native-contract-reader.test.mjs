import test from "node:test";
import assert from "node:assert/strict";
import { readNativeContractPage } from "./studiomate-native-contract-reader.mjs";

test("reader rejects malformed IDs before opening a page", async () => {
  let opens = 0;
  await assert.rejects(
    readNativeContractPage(
      {
        goto: async () => {
          opens++;
        },
      },
      "../../other",
    ),
  );
  assert.equal(opens, 0);
});
test("waits for populated DOM; reads only the exact contract and contains no writes", async () => {
  const id = "a".repeat(64);
  const calls = [];
  const page = {
    goto: async (url) => calls.push(["goto", url]),
    waitForFunction: async () => calls.push(["loaded"]),
    url: () =>
      `https://arcpilates.studiomate.kr/users/contract/detail?id=${id}`,
    evaluate: async () => {
      calls.push(["read"]);
      return {
        contractId: id,
        title: "Synthetic contract",
        memberPhone: "01012345678",
      };
    },
  };
  const result = await readNativeContractPage(page, id);
  assert.deepEqual(
    calls.map((c) => c[0]),
    ["goto", "loaded", "loaded", "read"],
  );
  assert.equal(result.contractId, id);
  assert.ok(Date.parse(result.observedAt));
});
test("login redirect, incomplete page and wrong ID fail closed", async () => {
  const id = "a".repeat(64);
  for (const variant of ["login", "empty", "wrong"]) {
    const page = {
      goto: async () => {},
      waitForFunction: async () => {},
      url: () =>
        variant === "login"
          ? "https://arcpilates.studiomate.kr/login"
          : `https://arcpilates.studiomate.kr/users/contract/detail?id=${id}`,
      evaluate: async () =>
        variant === "empty"
          ? {}
          : {
              contractId: "b".repeat(64),
              title: "Synthetic",
              memberPhone: "01012345678",
            },
    };
    await assert.rejects(readNativeContractPage(page, id));
  }
});
