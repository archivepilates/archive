import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { chromium } from "playwright";

const preview = process.argv.includes("--preview");
const site = "https://archivepilates.imweb.me";
const expected = new Map([[32, "AB6"], [33, "ACH6"], [45, "AB5"]]);
const source = fs.readFileSync("official-home/assets/imweb-video-discovery-20260906.js", "utf8");
const previous = fs.readFileSync("official-home/assets/imweb-video-discovery-20260905.js", "utf8");
const catalogFrom = code => vm.runInNewContext(`(${code.match(/var CATALOG = (\{[\s\S]*?\n  \});/)[1]})`);
const catalog = catalogFrom(source);
for (const [id, entry] of Object.entries(catalogFrom(previous))) {
  assert.equal(JSON.stringify(catalog[id]), JSON.stringify(expected.has(Number(id)) ? [entry[0], entry[1], "민진쌤"] : entry));
}
const readProduct = vm.runInNewContext(`(${source.slice(source.indexOf("function readProduct("), source.indexOf("function applyFilters("))})`, { CATALOG: catalog });
const classify = (idx, code, instructor) => readProduct({
  getAttribute: () => JSON.stringify({ idx, name: `체어 테스트 (${code})`, instructor }),
});
for (const [id, code] of expected) assert.equal(classify(id, code, "아카이브 강사진").instructor, "민진쌤");
assert.equal(classify(28, "ACH7", "아카이브 강사진").instructor, "아카이브 강사진");
assert.equal(classify(999, "NEW1", "아카이브 강사진").instructor, "아카이브 강사진");
assert.equal(classify(32, "NEW1", "아카이브 강사진").instructor, "아카이브 강사진");
assert.equal(classify(32, "AB6", "확인된 새 강사").instructor, "확인된 새 강사");
if (process.argv.includes("--static-only")) { console.log("Instructor mapping guards passed"); process.exit(0); }
const dir = "artifacts/video-instructor-20260906";
fs.mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const results = [];
try {
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    try {
      let intercepted = 0;
      if (preview) {
        await context.route(/https:\/\/archivepilates\.com\/assets\/imweb-video-discovery-2026090[56]\.js(?:\?.*)?$/, route => {
          intercepted++;
          return route.fulfill({ path: "official-home/assets/imweb-video-discovery-20260906.js", contentType: "application/javascript" });
        });
      }
      const page = await context.newPage();
      await page.goto(`${site}/17`, { waitUntil: "domcontentloaded" });
      const select = page.getByLabel("강사", { exact: true });
      await select.waitFor({ state: "visible" });
      if (preview) assert.equal(intercepted, 1, "Local discovery candidate must be loaded exactly once");
      const options = await select.evaluate(e => Array.from(e.options).map(o => o.textContent));
      assert.deepEqual(options, ["전체", "민진쌤", "은영쌤"]);
      await select.selectOption("민진쌤");
      const ids = await page.evaluate(() => Array.from(document.querySelectorAll(".shop-item._shop_item:not([data-apvd-filtered])"))
        .map(e => Number(JSON.parse(e.getAttribute("data-product-properties") || "{}").idx)));
      for (const id of expected.keys()) assert(ids.includes(id), `${id}: absent from Minjin results`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      assert(!overflow, "Horizontal overflow");
      await select.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${dir}/${preview ? "preview" : "live"}-instructor-${width}.png` });
      results.push({ width, options, confirmedProducts: [...expected.values()], minjinCount: ids.length, overflow });
    } finally { await context.close(); }
  }
  if (!preview) {
    const page = await browser.newPage();
    try {
      for (const [id, code] of expected) {
        await page.goto(`${site}/17/?idx=${id}`, { waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => document.querySelector(".goods_summary")?.innerText.includes("민진쌤"));
        const summary = (await page.locator(".goods_summary").allInnerTexts()).join("\n");
        assert(!summary.includes("아카이브 강사진"), `${code}: old instructor summary`);
        const details = await page.locator(".archive-online-product").allInnerTexts();
        assert(details.length > 0, `${code}: missing product detail`);
        for (const detail of details) assert(detail.includes("민진쌤") && !detail.includes("아카이브 강사진"), `${code}: wrong detail instructor`);
        results.push({ code, summary, detailInstructorCorrect: true });
      }
    } finally { await page.close(); }
  }
} finally { await browser.close(); }
fs.writeFileSync(`${dir}/${preview ? "preview" : "live"}-verification.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify({ mode: preview ? "preview" : "live", results }));
