#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { createCatalogFixture } from "./verify-alimtalk-catalog.mjs";

const fixture = await createCatalogFixture({ autoCloseMs: 0 });
let browser;
const output = "/tmp/alimtalk-template-retirement-ui";
await fs.mkdir(output, { recursive: true });
try {
  browser = await chromium.launch({ headless: true });
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    try {
      const page = await context.newPage();
      await page.goto(`${fixture.origin}/messages/`, { waitUntil: "domcontentloaded" });
      // Isolated operator layout only, never an authenticated access or production-data test.
      await page.evaluate(() => { document.documentElement.dataset.coreAccess = "manager"; });
      await page.waitForFunction(() => document.querySelector("[data-template-catalog]")?.dataset.catalogState === "ready");
      await page.getByRole("heading", { name: "현재 템플릿" }).waitFor();
      assert.equal(await page.getByTestId("catalog-row").count(), 19);
      assert.ok(await page.getByText("운영 연결 18종 · 별도 프로젝트 1종", { exact: true }).isVisible());
      await page.getByRole("combobox", { name: "구현 상태" }).selectOption("archived");
      assert.equal(await page.getByTestId("catalog-row").count(), 0);
      await page.getByRole("combobox", { name: "구현 상태" }).selectOption("all");
      await page.getByRole("searchbox", { name: "템플릿 검색" }).fill("웰컴 v5");
      assert.equal(await page.getByTestId("catalog-row").count(), 0);
      await page.getByRole("searchbox", { name: "템플릿 검색" }).fill("");
      await page.getByLabel("아카이브 신규회원 가입완료 웰컴 안내 v6 정책 상세").click();
      assert.equal(await page.getByTestId("catalog-row").first().getAttribute("open"), "");
      const size = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, body: document.documentElement.scrollWidth, denied: window.__catalogFixture.denied }));
      assert.ok(size.body <= size.viewport + 1, `Horizontal overflow at ${width}`);
      assert.deepEqual(size.denied, []);
      await page.screenshot({ path: path.join(output, `${width}.png`), fullPage: true });
      console.log(`PASS ${width}px: 19 current templates, retired search/filter absent, details and no overflow`);
    } finally { await context.close(); }
  }
} finally {
  if (browser) await browser.close();
  await fixture.close();
  console.log("Task-owned browser contexts and local server closed");
}
