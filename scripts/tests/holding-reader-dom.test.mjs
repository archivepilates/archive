import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { extractRegisteredHoldsDom, registeredHoldingRanges } from "../lib/studiomate-holding-reader.mjs";

test("real DOM current controls are collected, while draft/partial/ambiguous controls fail closed", async t => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const render = async ({ start = "2026. 10. 7.", end = "2026. 10. 31.", disabled = true, list = "", duplicate = false } = {}) => {
      await page.setContent(`<div role="dialog"><div class="ticket-edit-modal__tabs"><li class="active">정지기간정보</li></div>
        <ul class="holding-detail__holding-list">${list}</ul>
        <div class="holding-detail__form__element start_date"><input placeholder="정지 시작일" value="${start}" ${disabled ? "disabled" : ""}></div>
        <div class="holding-detail__form__element end_date"><input placeholder="정지 종료일" value="${end}"></div>
        ${duplicate ? '<div class="holding-detail__form__element start_date"><input placeholder="정지 시작일" disabled></div>' : ""}</div>`);
      return page.evaluate(extractRegisteredHoldsDom);
    };
    await t.test("empty list and ongoing fields", async () => {
      assert.deepEqual(registeredHoldingRanges(await render()), [{ start: "2026-10-07", end: "2026-10-31" }]);
    });
    await t.test("current range also in list counted once", async () => {
      assert.equal(registeredHoldingRanges(await render({ list: "<li>2026. 10. 7. ~ 2026. 10. 31. (25일 정지)</li>" })).length, 1);
    });
    await t.test("blank editable form is not a hold", async () => { assert.deepEqual(registeredHoldingRanges(await render({ start: "", end: "", disabled: false })), []); });
    await t.test("partial date rejected", async () => { await assert.rejects(render({ end: "" }), /incomplete_current/); });
    await t.test("filled editable start is uncommitted", async () => { await assert.rejects(render({ disabled: false }), /uncommitted_current/); });
    await t.test("ambiguous controls rejected", async () => { await assert.rejects(render({ duplicate: true }), /single_current/); });
    await t.test("invalid date rejected", async () => { assert.throws(() => registeredHoldingRanges({ activeHolds: [], currentHold: { start: "2026-02-30", end: "2026-10-31" } }), /invalid_source_date/); });
    await t.test("displayed actual days must agree with dates", async () => {
      await assert.rejects(render({ list: "<li>2026. 10. 7. ~ 2026. 10. 16. (25일 정지)</li>" }), /hold_displayed_days_mismatch/);
      const read = await render({ list: "<li>2026. 10. 7. ~ 2026. 10. 16. (10일 정지)</li>", start: "", end: "", disabled: false });
      assert.deepEqual(registeredHoldingRanges(read), [{ start: "2026-10-07", end: "2026-10-16" }]);
    });
  } finally { await browser.close(); }
});
