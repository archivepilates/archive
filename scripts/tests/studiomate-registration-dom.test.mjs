import assert from "node:assert/strict";
import test from "node:test";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { observeMemberSave, assertNewMemberForm } from "../lib/studiomate-registration-flow.mjs";

const BASE = "https://arcpilates.studiomate.kr";
const guide = '<div class="el-dialog" role="dialog"><span class="el-dialog__title">회원 등록 완료 및 이용권 등록 안내</span><p>회원 등록이 완료되었습니다. 이어서 수강권을 등록해주세요.</p><button>취소</button><button>확인</button></div>';

test("real Chromium synthetic DOM: legacy, split, unknown and edit form boundaries", async t => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    // Every URL is fulfilled locally: never contact StudioMate or use its profile.
    await context.route("**/*", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }));
    const page = await context.newPage();
    for (const [label, pathname, html, expected] of [
      ["legacy", "/users/detail?id=1234567", "<p>Saved</p>", "legacy_detail"],
      ["split without redirect", "/users/create", guide, "split_registration_ticket_guide"],
      ["split with redirect", "/users/detail?id=1234567", guide, "split_registration_ticket_guide"],
      ["hidden old modal", "/users/detail?id=1234567", `<div style="display:none">${guide}</div>`, "legacy_detail"],
    ]) await t.test(label, async () => {
      await page.goto(`${BASE}${pathname}`);
      await page.setContent(html);
      await page.evaluate(() => { window.clicks = 0; document.addEventListener("click", () => window.clicks++); });
      assert.equal((await observeMemberSave(page, BASE)).layout, expected);
      assert.equal(await page.evaluate(() => window.clicks), 0);
    });
    await t.test("unknown popup fails closed", async () => {
      await page.goto(`${BASE}/users/create`);
      await page.setContent(guide.replace("회원 등록 완료 및 이용권 등록 안내", "추가 확인 필요"));
      await assert.rejects(observeMemberSave(page, BASE), /Unknown StudioMate registration dialog/);
    });
    await t.test("exact new form accepted but existing-member edit rejected", async () => {
      const identity = { baseUrl: BASE, memberName: "Synthetic Member", memberPhone: "01000000001" };
      const form = '<input placeholder="이름을 입력해주세요" value="Synthetic Member"><input placeholder="휴대폰 번호" value="010-0000-0001"><button>회원 등록 완료</button>';
      await page.goto(`${BASE}/users/create`);
      await page.setContent(form);
      await assertNewMemberForm(page, identity);
      await page.goto(`${BASE}/users/create?id=1234567`);
      await page.setContent(form);
      await assert.rejects(assertNewMemberForm(page, identity), /edit pages/);
    });
  } finally { await browser.close(); }
});

test("new CORE rule fits its container and introduces no additional page overflow", async t => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const html = await readFile(new URL("../../core/rules/index.html", import.meta.url), "utf8");
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== "https://core.archivepilates.com") return route.abort();
      if (url.pathname === "/rules/") return route.fulfill({ contentType: "text/html", body: html });
      if (["/assets/styles.css", "/assets/interface.css"].includes(url.pathname)) {
        return route.fulfill({ contentType: "text/css", body: await readFile(new URL(`../../core${url.pathname}`, import.meta.url), "utf8") });
      }
      return route.abort();
    });
    await mkdir(new URL("../../artifacts/studiomate-registration-revamp-20261102/", import.meta.url), { recursive: true });
    for (const width of [320, 390, 768, 1440]) await t.test(`${width}px`, async () => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("https://core.archivepilates.com/rules/", { waitUntil: "load" });
      // This local visual fixture omits the authenticated app, not production access control.
      await page.evaluate(() => document.documentElement.dataset.coreAccess = "manager");
      await page.locator("#coreAccessLoading").evaluate(element => element.remove());
      const rule = page.locator('[data-studiomate-registration-revamp="notice225-v1"]');
      assert.equal(await rule.count(), 1);
      assert.ok(await rule.isVisible());
      const layout = await rule.evaluate(element => ({ width: innerWidth, pageScroll: document.documentElement.scrollWidth,
        right: element.getBoundingClientRect().right, scroll: element.scrollWidth, client: element.clientWidth }));
      assert.ok(layout.right <= width && layout.scroll <= layout.client, JSON.stringify(layout));
      await rule.scrollIntoViewIfNeeded();
      await page.screenshot({ path: new URL(`../../artifacts/studiomate-registration-revamp-20261102/rules-${width}.png`, import.meta.url).pathname });
      await rule.evaluate(element => element.remove());
      const baselineScroll = await page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(layout.pageScroll <= baselineScroll, "new rule must not increase pre-existing page overflow");
      if (baselineScroll > width) t.diagnostic(`Existing unrelated rule content overflows at ${width}px (${baselineScroll}px); unchanged by this rule.`);
    });
  } finally { await browser.close(); }
});
