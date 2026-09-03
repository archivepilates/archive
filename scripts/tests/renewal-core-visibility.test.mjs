import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../../core/assets/app.js", import.meta.url), "utf8");
const start = source.indexOf("function timestampMs");
const end = source.indexOf("function hasSameKindBackupTicket");
assert.ok(start >= 0 && end > start, "renewal visibility helpers must remain available in CORE app.js");
const context = { result: null };
vm.runInNewContext(`${source.slice(start, end)}\nresult = renewalCaseIsCurrent;`, context);
const renewalCaseIsCurrent = context.result;

const referenceDate = new Date("2026-08-21T12:00:00+09:00");
const timestamp = (value) => ({ toMillis: () => new Date(value).getTime() });
const ticket = (overrides = {}) => ({
  userTicketId: "old-ticket",
  name: "그룹 30회",
  classType: "G",
  remainingCount: 3,
  expiresAt: timestamp("2026-08-25T23:59:59+09:00"),
  ...overrides,
});
const renewalCase = (overrides = {}) => ({
  memberId: "member-1",
  kind: "group",
  ticketIdentity: "user:old-ticket",
  ticketName: "그룹 30회",
  ...overrides,
});
const member = (tickets) => ({ memberId: "member-1", currentTicketsSummary: tickets });

test("CORE keeps a genuinely risky renewal case visible", () => {
  assert.equal(renewalCaseIsCurrent(renewalCase(), member([ticket()]), referenceDate), true);
});

test("CORE hides an old renewal case after a healthy follow-up ticket is registered", () => {
  const followUp = ticket({
    userTicketId: "new-ticket",
    remainingCount: 40,
    availableFrom: timestamp("2026-08-22T00:00:00+09:00"),
    expiresAt: timestamp("2026-12-20T23:59:59+09:00"),
  });
  assert.equal(renewalCaseIsCurrent(renewalCase(), member([ticket(), followUp]), referenceDate), false);
});

test("CORE hides a waiting case when a healthy ticket now exists", () => {
  const followUp = ticket({
    userTicketId: "new-ticket",
    remainingCount: 40,
    expiresAt: timestamp("2026-12-20T23:59:59+09:00"),
  });
  assert.equal(
    renewalCaseIsCurrent(
      renewalCase({ ticketIdentity: "waiting:old-booking", ticketName: "활성 수강권 없음" }),
      member([followUp]),
      referenceDate,
    ),
    false,
  );
});

test("CORE does not treat a compensation coupon as a follow-up ticket", () => {
  const coupon = ticket({
    userTicketId: "coupon",
    name: "여름휴가 보상 쿠폰",
    remainingCount: 5,
    expiresAt: timestamp("2026-12-20T23:59:59+09:00"),
  });
  assert.equal(renewalCaseIsCurrent(renewalCase(), member([ticket(), coupon]), referenceDate), true);
});

test("CORE keeps a case visible when the alternative ticket has no usable status fields", () => {
  const incomplete = ticket({
    userTicketId: "incomplete",
    name: "그룹 신규권",
    remainingCount: null,
    expiresAt: null,
  });
  assert.equal(renewalCaseIsCurrent(renewalCase(), member([ticket(), incomplete]), referenceDate), true);
});

test("CORE hides a case when the same source ticket is no longer at risk", () => {
  const recovered = ticket({ remainingCount: 20, expiresAt: timestamp("2026-12-20T23:59:59+09:00") });
  assert.equal(renewalCaseIsCurrent(renewalCase(), member([recovered]), referenceDate), false);
});
