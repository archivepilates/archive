import test from "node:test";
import assert from "node:assert/strict";
import { sendContractReminderSms, assertContractReminderSmsResponse } from "../lib/contract-signature-reminder-browser.mjs";
import { isMemberDispatchDeferred } from "../lib/member-dispatch-window.mjs";

const plan = { memberId: "701", memberName: "Synthetic Member", memberPhone: "01000000701", studioId: "5330",
  smsTitle: "Synthetic signature reminder", smsMessage: "Synthetic contract link" };

test("disabled native reminder transport touches no browser or claim in the allowed window", async () => {
  let browserCalls = 0, claims = 0;
  const page = new Proxy({}, { get() { browserCalls++; assert.fail("Native SMS UI must remain disabled"); } });
  for (const instant of ["2026-10-28T00:00:00.000Z", "2026-10-28T10:59:59.999Z"]) {
    await assert.rejects(sendContractReminderSms(page, plan, async () => { claims++; }, { now: () => Date.parse(instant) }),
      error => error.message === "member_sms_studiomate_transport_disabled");
  }
  assert.equal(browserCalls, 0);
  assert.equal(claims, 0);
});

test("quiet hours and the stricter reminder cutoff defer before the disabled native transport", async () => {
  let browserCalls = 0, claims = 0;
  const page = new Proxy({}, { get() { browserCalls++; assert.fail("Quiet hours must not touch native UI"); } });
  for (const instant of ["2026-10-27T23:59:59.999Z", "2026-10-28T11:00:00.000Z",
    "2026-10-28T14:00:00.000Z", "2026-10-28T23:59:59.999Z"]) {
    await assert.rejects(sendContractReminderSms(page, plan, async () => { claims++; }, { now: () => Date.parse(instant) }),
      isMemberDispatchDeferred);
  }
  assert.equal(browserCalls, 0);
  assert.equal(claims, 0);
});

test("legacy StudioMate response parsing remains available without enabling native sends", () => {
  const receipt = {
    url: "https://api.studiomate.kr/v2/staff/sms", status: 200,
    payload: { users: [701], title: plan.smsTitle, message: plan.smsMessage },
    body: { id: 1234, studio_id: 5330, type: "send", is_sent: 1, title: plan.smsTitle, message: plan.smsMessage },
  };
  assert.doesNotThrow(() => assertContractReminderSmsResponse(receipt, plan));
  for (const patch of [{ id: 0 }, { studio_id: 999 }, { is_sent: 0 }, { message: "changed" }])
    assert.throws(() => assertContractReminderSmsResponse({ ...receipt, body: { ...receipt.body, ...patch } }, plan),
      /contract_reminder_sms_receipt_unverified/);
  assert.throws(() => assertContractReminderSmsResponse({ ...receipt, payload: { ...receipt.payload, users: [701, 702] } }, plan),
    /contract_reminder_sms_receipt_unverified/);
});
