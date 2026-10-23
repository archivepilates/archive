import test from "node:test";
import assert from "node:assert/strict";
import { holdingBrowserBusyState, holdingBrowserRetryCarry } from "../lib/holding-browser-retry.mjs";

const NOW = Date.UTC(2026, 9, 24, 3);
const MINUTE = 60_000;
const at = minutes => new Date(NOW + minutes * MINUTE).toISOString();
const identity = { memberId: "101", memberKey: "synthetic-member-key", ticketName: "Synthetic Pass" };
const busy = (patch = {}) => ({
  ...identity, status: "pending", reason: "holding_browser_busy_deferred",
  browserBusySince: at(-30), browserBusyCount: 3, nextAttemptAt: at(30), browserBusyAlertedAt: null,
  ...patch,
});

test("first busy result is a five-minute pending deferral without alert or input mutation", () => {
  const job = Object.freeze({ ...identity, status: "pending", reason: "" });
  assert.deepEqual(holdingBrowserBusyState(job, NOW), {
    patch: {
      status: "pending", reason: "holding_browser_busy_deferred", browserBusySince: at(0),
      browserBusyCount: 1, nextAttemptAt: at(5), browserBusyAlertedAt: null,
    },
    shouldAlert: false,
  });
  assert.deepEqual(job, { ...identity, status: "pending", reason: "" });
});

test("default nowMs uses Date.now without requiring a real clock or side effects", t => {
  t.mock.method(Date, "now", () => NOW);
  assert.equal(holdingBrowserBusyState().patch.browserBusySince, at(0));
});

test("backoff grows 5, 10, 20, then at most 30 minutes from each attempt", () => {
  let job = {};
  for (const [index, minutes] of [5, 10, 20, 30, 30, 30].entries()) {
    const nowMs = NOW + index * 40 * MINUTE;
    const state = holdingBrowserBusyState(job, nowMs);
    assert.equal(Date.parse(state.patch.nextAttemptAt) - nowMs, minutes * MINUTE);
    assert.equal(state.patch.browserBusyCount, index + 1);
    assert.equal(state.patch.browserBusySince, at(0));
    job = state.patch;
  }
});

for (const count of [999, 1000, 1001, Number.MAX_SAFE_INTEGER]) {
  test(`retry count is bounded at 1000 for ${count}`, () => {
    const { patch } = holdingBrowserBusyState({ browserBusyCount: count }, NOW);
    assert.equal(patch.browserBusyCount, 1000);
    assert.equal(patch.nextAttemptAt, at(30));
  });
}

for (const count of [undefined, null, -1, 1.5, "3", NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  test(`invalid retry count ${String(count)} starts at one`, () => {
    const { patch } = holdingBrowserBusyState({ browserBusyCount: count }, NOW);
    assert.equal(patch.browserBusyCount, 1);
    assert.equal(patch.nextAttemptAt, at(5));
  });
}

for (const since of [undefined, null, "", "invalid", 0, "2026-02-30T00:00:00.000Z", "2026-10-24", at(1)]) {
  test(`invalid or future busy date ${String(since)} resets to now without premature alert`, () => {
    const { patch, shouldAlert } = holdingBrowserBusyState({ browserBusySince: since }, NOW);
    assert.equal(patch.browserBusySince, at(0));
    assert.equal(patch.browserBusyAlertedAt, null);
    assert.equal(shouldAlert, false);
  });
}

test("valid ISO busy dates at now or in the past are retained", () => {
  for (const since of [at(0), at(-1), at(-120), "2026-10-24T03:00:00Z", "2026-10-24T11:00:00+09:00"]) {
    assert.equal(holdingBrowserBusyState({ browserBusySince: since }, NOW).patch.browserBusySince, since);
  }
});

test("offset ISO timestamps use their actual instant for escalation and future rejection", () => {
  const old = { browserBusySince: "2026-10-24T10:00:00+09:00" };
  assert.equal(holdingBrowserBusyState(old, NOW).shouldAlert, true);
  const state = holdingBrowserBusyState({ browserBusySince: "2026-10-24T12:01:00+09:00" }, NOW);
  assert.equal(state.patch.browserBusySince, at(0));
  assert.equal(state.shouldAlert, false);
});

test("escalation fires exactly at two hours and the returned marker prevents repeats", () => {
  const initial = { browserBusySince: at(-120), browserBusyCount: 4 };
  assert.equal(holdingBrowserBusyState(initial, NOW - 1).shouldAlert, false);
  const first = holdingBrowserBusyState(initial, NOW);
  assert.equal(first.shouldAlert, true);
  assert.equal(first.patch.browserBusyAlertedAt, at(0));
  const later = holdingBrowserBusyState(first.patch, NOW + 60 * MINUTE);
  assert.equal(later.shouldAlert, false);
  assert.equal(later.patch.browserBusyAlertedAt, at(0));
  assert.equal(later.patch.browserBusySince, at(-120));
});

test("an existing valid alert marker is retained without issuing another alert", () => {
  for (const since of [at(-30), at(-180)]) {
    const state = holdingBrowserBusyState({ browserBusySince: since, browserBusyAlertedAt: at(-1) }, NOW);
    assert.equal(state.shouldAlert, false);
    assert.equal(state.patch.browserBusyAlertedAt, at(-1));
  }
  const marker = "2026-10-24T11:59:00+09:00";
  const state = holdingBrowserBusyState({ browserBusySince: at(-180), browserBusyAlertedAt: marker }, NOW);
  assert.equal(state.shouldAlert, false);
  assert.equal(state.patch.browserBusyAlertedAt, marker);
});

for (const alertedAt of [undefined, null, "", "invalid", 0, "2026-02-30T00:00:00.000Z", at(1)]) {
  test(`invalid or future alert marker ${String(alertedAt)} cannot suppress escalation`, () => {
    const state = holdingBrowserBusyState({ browserBusySince: at(-120), browserBusyAlertedAt: alertedAt }, NOW);
    assert.equal(state.shouldAlert, true);
    assert.equal(state.patch.browserBusyAlertedAt, at(0));
  });
}

for (const nowMs of [NaN, Infinity, -Infinity, "now", null, 9e15]) {
  test(`invalid clock ${String(nowMs)} fails before producing a patch`, () => {
    assert.throws(() => holdingBrowserBusyState({}, nowMs), RangeError);
  });
}

test("carry copies only retry fields despite fresh source identity and revision", () => {
  const old = Object.freeze(busy({ sourceImportId: "old-import", discoveryVersion: "old-version",
    downloadedAt: at(-30), requestedAt: at(-60), lastCheckedAt: at(-1), sendAllowed: true,
    ticketRevision: "old-ticket-revision", unexpected: "must-not-carry" }));
  const job = Object.freeze({ ...identity, status: "pending", reason: "", sourceImportId: "new-import",
    discoveryVersion: "new-version", downloadedAt: at(0), requestedAt: at(0) });
  const carried = holdingBrowserRetryCarry(old, job);
  assert.deepEqual(carried, {
    reason: "holding_browser_busy_deferred", browserBusySince: at(-30), browserBusyCount: 3,
    nextAttemptAt: at(30), browserBusyAlertedAt: null,
  });
  const combined = { ...job, ...carried };
  assert.equal(combined.sourceImportId, "new-import");
  assert.equal(combined.discoveryVersion, "new-version");
  assert.equal(combined.downloadedAt, at(0));
  assert.equal(combined.requestedAt, at(0));
  assert.equal(Object.hasOwn(combined, "sendAllowed"), false);
});

for (const field of ["memberId", "memberKey", "ticketName"]) {
  test(`changed or missing ${field} prevents retry carry`, () => {
    for (const value of ["different", "", " ", undefined, null]) {
      assert.deepEqual(holdingBrowserRetryCarry(busy(), { ...identity, [field]: value, reason: "" }), {});
    }
    assert.deepEqual(holdingBrowserRetryCarry(busy({ [field]: undefined }), { ...identity, [field]: undefined }), {});
  });
}

for (const oldPatch of [{ status: "review" }, { status: "observed" }, { status: "completed" },
  { reason: "other_error" }, { reason: "" }]) {
  test(`non-busy/non-pending old state ${JSON.stringify(oldPatch)} is never carried`, () => {
    assert.deepEqual(holdingBrowserRetryCarry(busy(oldPatch), identity), {});
  });
}

test("new source validation errors always outrank old browser retry state", () => {
  assert.deepEqual(holdingBrowserRetryCarry(busy(), { ...identity, reason: "native_member_phone_match_required" }), {});
  assert.deepEqual(holdingBrowserRetryCarry(undefined, identity), {});
  assert.deepEqual(holdingBrowserRetryCarry(busy(), undefined), {});
});

test("carry never introduces undefined fields into a Firestore patch", () => {
  const old = { ...identity, status: "pending", reason: "holding_browser_busy_deferred", browserBusyAlertedAt: undefined };
  assert.deepEqual(holdingBrowserRetryCarry(old, identity), { reason: "holding_browser_busy_deferred" });
});
