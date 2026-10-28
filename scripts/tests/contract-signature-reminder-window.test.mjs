import test from "node:test";
import assert from "node:assert/strict";
import { contractReminderDispatchWindow, assertContractReminderDispatchAllowed } from "../lib/contract-signature-reminder-window.mjs";
import { isMemberDispatchDeferred } from "../lib/member-dispatch-window.mjs";

test("reminder cutoff is 20:00, not the general 23:00 window", () => {
  for (const [time, allowed, next] of [
    ["2026-10-27T23:59:59.999Z", false, "2026-10-28T00:00:00.000Z"],
    ["2026-10-28T00:00:00.000Z", true, null],
    ["2026-10-28T10:59:59.999Z", true, null],
    ["2026-10-28T11:00:00.000Z", false, "2026-10-29T00:00:00.000Z"],
    ["2026-10-28T13:59:59.999Z", false, "2026-10-29T00:00:00.000Z"],
    ["2026-10-28T14:00:00.000Z", false, "2026-10-29T00:00:00.000Z"],
  ]) {
    const window = contractReminderDispatchWindow(time);
    assert.equal(window.allowed, allowed, time); assert.equal(window.nextAllowedAt, next);
    if (allowed) assert.doesNotThrow(() => assertContractReminderDispatchAllowed(time));
    else assert.throws(() => assertContractReminderDispatchAllowed(time), error => isMemberDispatchDeferred(error) && error.nextAllowedAt === next);
  }
  assert.equal(contractReminderDispatchWindow("bad").allowed, false);
});
