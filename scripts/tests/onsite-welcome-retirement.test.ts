import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { onsiteWelcomeRequestHandler } from "../../firebase/kangsain-functions/functions/src/memberSignup/onsiteWelcomeRequest";
import { autoSendabilityIssue } from "../../firebase/kangsain-functions/functions/src/alimtalk/eligibility";
import { refs } from "../../firebase/kangsain-functions/functions/src/firestore/refs";

function response() {
  return {
    statusCode: 200,
    body: null as any,
    status(value: number) { this.statusCode = value; return this; },
    json(value: any) { this.body = value; return this; },
    set() { return this; },
  };
}

test("all old POST actions return gone without reading or writing a request", async () => {
  const original = refs.onsiteWelcomeRequest;
  refs.onsiteWelcomeRequest = (() => { throw new Error("Unexpected database access"); }) as any;
  try {
    for (const action of [undefined, "send", "discard", "create"]) {
      const res = response();
      await onsiteWelcomeRequestHandler({ method: "POST", body: { action } }, res);
      assert.equal(res.statusCode, 410);
      assert.equal(res.body.code, "onsite_welcome_retired");
      assert.equal(res.body.replacementUrl, "https://arcpilates.studiomate.kr/users/create");
    }
  } finally { refs.onsiteWelcomeRequest = original; }
});

test("authorized sent-request history remains readable without enabling a send", async () => {
  const original = refs.onsiteWelcomeRequest;
  const token = "synthetic-test-token";
  refs.onsiteWelcomeRequest = (() => ({ get: async () => ({ data: () => ({
    requestId: "owr-synthetic-test",
    accessTokenHash: createHash("sha256").update(token).digest("hex"),
    status: "sent",
    phoneLast4: "0000",
    progressPercent: 100,
  }) }) })) as any;
  try {
    const res = response();
    await onsiteWelcomeRequestHandler({ method: "GET", query: { id: "owr-synthetic-test", token } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.request.status, "sent");
    assert.equal(res.body.request.canSendAlimtalk, false);
    const denied = response();
    await onsiteWelcomeRequestHandler({ method: "GET", query: { id: "owr-synthetic-test", token: "wrong" } }, denied);
    assert.equal(denied.statusCode, 400);
    assert.equal(denied.body.ok, false);
  } finally { refs.onsiteWelcomeRequest = original; }
});

test("send-time retirement overrides legacy queue retries and test exceptions", async () => {
  for (const payload of [{}, { testOverride: true, allowTestRecipient: true }]) {
    assert.equal(await autoSendabilityIssue({ type: "onsite_welcome", payload } as any, "2026-09-14"), "현장 웰컴 신규 발송 종료");
  }
});

test("retired local runner cannot claim jobs or open Chrome even with --apply", () => {
  const result = JSON.parse(execFileSync(process.execPath, ["scripts/process-onsite-welcome-requests.mjs", "--apply"], { encoding: "utf8" }));
  assert.equal(result.status, "retired");
  assert.equal(result.processed, 0);
  assert.equal(result.ok, true);
});
