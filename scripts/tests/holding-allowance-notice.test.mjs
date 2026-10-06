import test from "node:test";
import assert from "node:assert/strict";
import { calculateHoldingAllowance as calc, holdingNoticeKey, holdingTemplateIssue, HOLDING_NOTICE_TEMPLATE as spec, HOLDING_NOTICE_TEMPLATE_ID, planHoldingNotice } from "../lib/holding-allowance-notice.mjs";

const hold = (id, start, end, extra = {}) => ({ id, start, end, status: "registered", kind: "member", evidenceRef: "fixture", ...extra });
const snapshot = () => ({ studioId: "5330", memberId: "100", ticketId: "200", memberName: "테스트", ticketName: "100회권",
  currentHoldId: "new", originalPeriod: { days: 365, source: "issuance_record", evidenceRef: "fixture-original" }, holdsComplete: true,
  holds: [hold("a", "2026-04-27", "2026-05-05"), hold("b", "2026-05-30", "2026-06-07"),
    hold("c", "2026-07-25", "2026-08-10"), hold("d", "2026-08-11", "2026-09-13"), hold("new", "2026-10-06", "2026-10-11")] });
const template = () => ({ ...spec, templateId: HOLDING_NOTICE_TEMPLATE_ID, status: "APPROVED" });
const input = () => ({ snapshot: snapshot(), previousHoldIds: ["a", "b", "c", "d"], history: { complete: true, keys: [] }, template: template() });

test("365 days / 20 percent: prior 69 plus current 6 = 75; remaining zero; overage two", () => {
  assert.deepEqual(calc(snapshot()), { ok: true, originalDays: 365, totalDays: 73, usedDays: 75, remainingDays: 0, overageDays: 2 });
});
test("floor fractional allowances and never use extended expiry", () => {
  const s = snapshot(); s.originalPeriod.days = 84; s.holds = []; s.expiresAt = "2030-12-31";
  assert.equal(calc(s).totalDays, 16);
});
test("deduplicate exact events and overlapping inclusive calendar dates", () => {
  const s = snapshot(); const a = hold("a", "2028-02-28", "2028-03-01");
  s.holds = [a, { ...a }, hold("b", "2028-02-29", "2028-03-02")];
  assert.equal(calc(s).usedDays, 4);
});
test("exclude cancelled holds and explicitly classified center closure", () => {
  const s = snapshot(); s.holds = [hold("a", "2026-01-01", "2026-01-10", { status: "cancelled" }), hold("b", "2026-01-11", "2026-01-20", { kind: "center_closure" })];
  assert.equal(calc(s).usedDays, 0);
});
test("include future registered holds", () => {
  const s = snapshot(); s.holds = [hold("future", "2027-01-01", "2027-01-04")]; assert.equal(calc(s).usedDays, 4);
});
test("fail closed for incomplete or guessed source", () => {
  for (const patch of [{ holdsComplete: false }, { holds: null }, { originalPeriod: { days: 365, source: "current_expiry", evidenceRef: "x" } }, { originalPeriod: { days: 365.2, source: "issuance_record", evidenceRef: "x" } }]) {
    assert.equal(calc({ ...snapshot(), ...patch }).ok, false);
  }
});
test("reject invalid calendar dates, reversed ranges and unclassified holds", () => {
  for (const h of [hold("a", "2026-02-30", "2026-03-03"), hold("a", "2026-03-03", "2026-03-01"), hold("a", "2026-03-01", "2026-03-03", { kind: undefined })]) {
    assert.equal(calc({ ...snapshot(), holds: [h] }).ok, false);
  }
});
test("reject conflicting duplicate identity", () => {
  assert.equal(calc({ ...snapshot(), holds: [hold("a", "2026-01-01", "2026-01-02"), hold("a", "2026-01-01", "2026-01-03")] }).reason, "conflicting_hold_identity");
});
test("no historical backfill or send on initial baseline", () => {
  const i = input(); delete i.previousHoldIds; assert.equal(planHoldingNotice(i).ok, false);
  i.previousHoldIds = ["new"]; assert.equal(planHoldingNotice(i).reason, "existing_hold_no_automatic_resend");
});
test("stable event key across date or template changes", () => {
  const ids = { studioId: "5330", memberId: "100", ticketId: "200", holdId: "hold" };
  assert.equal(holdingNoticeKey(ids), holdingNoticeKey({ ...ids, end: "2026-12-31", templateId: "v2" }));
  assert.throws(() => holdingNoticeKey({ ...ids, ticketId: "excel_200" }));
});
test("dedupe all canonical candidates and sends before proposal", () => {
  const i = input(); i.history.keys = [holdingNoticeKey({ ...i.snapshot, holdId: "new" })];
  assert.equal(planHoldingNotice(i).reason, "duplicate_candidate_or_send");
  i.history.complete = false; assert.equal(planHoldingNotice(i).reason, "complete_send_history_required");
});
test("exact approved image contract required", () => {
  assert.equal(holdingTemplateIssue(template()), "");
  for (const patch of [{ templateId: "wrong" }, { status: "INSPECTING" }, { imageId: "wrong" }, { content: "wrong" }, { buttons: [{}] }, { quickReplies: [{}] }]) {
    assert.ok(holdingTemplateIssue({ ...template(), ...patch }));
  }
});
test("shadow output includes three balances with no unexpanded variables and cannot send", () => {
  const result = planHoldingNotice(input());
  assert.equal(result.ok, true); assert.equal(result.sendAllowed, false);
  assert.match(result.message, /전체 홀딩 가능 기간: 73일/);
  assert.match(result.message, /누적 사용 홀딩 기간: 75일/);
  assert.match(result.message, /잔여 홀딩 가능 기간: 0일/);
  assert.doesNotMatch(result.message, /#\{/);
});
test("equivalent duplicate records do not depend on object property order", () => {
  const s = snapshot(), h = s.holds[0];
  s.holds.push(Object.fromEntries(Object.entries(h).reverse()));
  assert.equal(calc(s).usedDays, 75);
});
test("overlapping new event identity requires review instead of second proposal", () => {
  const i = input(); i.snapshot.holds.push(hold("other", "2026-10-06", "2026-10-11"));
  assert.equal(planHoldingNotice(i).reason, "overlapping_event_identity_review_required");
});
test("reject malformed send history keys", () => {
  for (const key of [null, {}, "", "wrong", "holding_notice_x"]) {
    const i = input(); i.history.keys = [key];
    assert.equal(planHoldingNotice(i).reason, "complete_send_history_required");
  }
});
test("literal user text cannot inject replacement semantics", () => {
  const i = input(); i.snapshot.memberName = "$&"; i.snapshot.ticketName = "#{이름}";
  const result = planHoldingNotice(i);
  assert.match(result.message, /^\$&님/);
  assert.match(result.message, /수강권: #\{이름\}/);
});
test("malformed top level input fails closed", () => {
  for (const value of [null, [], 3, "test"]) {
    assert.equal(calc(value).ok, false); assert.equal(planHoldingNotice(value).ok, false);
  }
});
