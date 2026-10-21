import assert from "node:assert/strict";
import test from "node:test";
import { memberDispatchWindow, assertMemberDispatchAllowed, isMemberDispatchDeferred, memberDispatchActiveElapsedMs } from "../lib/member-dispatch-window.mjs";

for (const [at, allowed, next] of [
  ["2026-10-21T13:59:59.999Z", true, null],
  ["2026-10-21T14:00:00.000Z", false, "2026-10-22T00:00:00.000Z"],
  ["2026-10-21T15:00:00.000Z", false, "2026-10-22T00:00:00.000Z"],
  ["2026-10-21T23:59:59.999Z", false, "2026-10-22T00:00:00.000Z"],
  ["2026-10-22T00:00:00.000Z", true, null],
  ["2026-10-22T14:00:00.000Z", false, "2026-10-23T00:00:00.000Z"],
  ["2026-12-31T14:00:00.000Z", false, "2027-01-01T00:00:00.000Z"],
  ["2028-02-28T14:00:00.000Z", false, "2028-02-29T00:00:00.000Z"],
]) test(`daily KST member dispatch boundary ${at}`, () => {
  for (const value of [at, new Date(at), Date.parse(at)]) {
    const result = memberDispatchWindow(value);
    assert.equal(result.allowed, allowed);
    assert.equal(result.nextAllowedAt, next);
    if (allowed) assert.doesNotThrow(() => assertMemberDispatchAllowed(value));
    else assert.throws(() => assertMemberDispatchAllowed(value), (e) => isMemberDispatchDeferred(e) && e.nextAllowedAt === next);
  }
});

for (const at of [NaN, Infinity, "invalid", new Date(NaN)]) test(`invalid dispatch clock fails closed: ${String(at)}`, () => {
  assert.equal(memberDispatchWindow(at).allowed, false);
  assert.throws(() => assertMemberDispatchAllowed(at), isMemberDispatchDeferred);
});

test("quiet hours do not consume the daytime freshness budget", () => {
  const duration = (a, b) => memberDispatchActiveElapsedMs(Date.parse(a), Date.parse(b));
  assert.equal(duration("2026-10-21T13:30:00Z", "2026-10-22T00:30:00Z"), 3600000);
  assert.equal(duration("2026-10-21T14:30:00Z", "2026-10-22T00:00:00Z"), 0);
  assert.equal(duration("2026-10-21T00:00:00Z", "2026-10-22T00:00:00Z"), 14 * 3600000);
  assert.equal(duration("2026-10-21T00:00:00Z", "2026-10-23T00:00:00Z"), 28 * 3600000);
  assert.equal(duration("2026-10-22T01:00:00Z", "2026-10-22T00:00:00Z"), Infinity);
});

test("every minute of a KST day uses the same absolute member window", () => {
  const midnightKst = Date.parse("2026-10-21T15:00:00.000Z");
  for (let minute = 0; minute < 1440; minute++)
    assert.equal(memberDispatchWindow(midnightKst + minute * 60000).allowed, minute >= 9 * 60 && minute < 23 * 60, String(minute));
});
