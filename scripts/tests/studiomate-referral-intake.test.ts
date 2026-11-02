import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeReferralInput, operatorCaptureStudioMateReferralHandler, getStudioMateReferralDashboardHandler } from "../../firebase/kangsain-functions/functions/src/callable/studiomateReferral";

const valid = { newMemberName: "신규 테스트", newMemberPhone: "010-0000-0001", referrerName: "추천 테스트", referrerPhone: "010 0000 0002" };
test("receipt normalizes names/phones without creating payment or point authority", () => {
  assert.deepEqual(normalizeReferralInput(valid), { ...valid, newMemberPhone: "01000000001", referrerPhone: "01000000002" });
});
for (const patch of [
  { rewardPoints: 999999 }, { status: "verified" }, { studioId: "9" }, { enabled: true },
  { newMemberName: "" }, { referrerName: "<script>" }, { newMemberPhone: "0001" },
  { newMemberPhone: 1000000001 }, { referrerPhone: "01000000001" }, { referrerName: "a".repeat(61) },
]) test(`invalid receipt rejected: ${Object.keys(patch).join()}`, () => assert.throws(() => normalizeReferralInput({ ...valid, ...patch })));
test("unauthenticated callers cannot save or read receipts", async () => {
  await assert.rejects(operatorCaptureStudioMateReferralHandler({ data: valid } as never), /로그인/);
  await assert.rejects(getStudioMateReferralDashboardHandler({ data: {} } as never), /로그인/);
});
