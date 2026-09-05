import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";

const preview = process.argv.includes("--preview");
const asset = "https://archivepilates.com/assets/imweb-knitido-images-20260906.js";
const dir = "artifacts/public-site-ux-20260905";
const expected = [
  ["니티도 리브랜딩 론칭에 함께한 구성원 단체 사진", "team"],
  ["일본 와카야마 해안 지역을 배경으로 걷는 사람", "coast"],
  ["니티도 제조 현장에서 편직기를 점검하는 모습", "factory"]
];
const results = [];
const browser = await chromium.launch({ headless: true, channel: "chrome" });
try {
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    try {
      if (preview) {
        await context.route(asset, route => route.fulfill({ path: "official-home/assets/imweb-knitido-images-20260906.js", contentType: "application/javascript" }));
        await context.route("https://archivepilates.imweb.me/16?ap_shop=knitido", async route => {
          const response = await route.fetch();
          const html = await response.text();
          assert(!html.includes(asset), "New image asset already installed; use live verification");
          await route.fulfill({ response, body: html.replace("</head>", `<script src="${asset}"></script></head>`) });
        });
      }
      const page = await context.newPage();
      const obsolete = [];
      const jpgRequests = [];
      page.on("request", request => {
        if (request.url().includes("imweb-knitido-shipping-review-20260729c.js")) obsolete.push(request.url());
        if (request.url().includes("storage.googleapis.com/studio-design-asset-files/")) jpgRequests.push(request.url());
      });
      await page.goto("https://archivepilates.imweb.me/16?ap_shop=knitido", { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => document.documentElement.hasAttribute("data-archive-pilates-public-ux-ready"));
      const images = [];
      for (const [alt, name] of expected) {
        const image = page.getByRole("img", { name: alt, exact: true });
        await image.scrollIntoViewIfNeeded();
        await page.waitForFunction(({ alt, name }) => {
          const image = Array.from(document.images).find(item => item.alt === alt);
          return image?.complete && image.naturalWidth > 0 && image.currentSrc.includes(`knitido-${name}-20260905-`) && image.currentSrc.endsWith(".webp");
        }, { alt, name });
        images.push(await image.evaluate(image => ({ alt: image.alt, src: image.currentSrc, srcset: image.srcset, naturalWidth: image.naturalWidth })));
      }
      const state = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
      assert(state.scrollWidth <= state.width + 1, "Horizontal overflow");
      assert.equal(obsolete.length, 0, "Obsolete loader request returned");
      assert.equal(jpgRequests.length, 0, "Legacy story JPG request returned");
      await page.screenshot({ path: `${dir}/${preview ? "preview" : "live"}-story-images-${width}.png` });
      results.push({ width, images, obsoleteRequests: obsolete.length, legacyJpgRequests: jpgRequests.length });
      console.log(`${width}: three WebP images, obsolete requests ${obsolete.length}, legacy JPG requests ${jpgRequests.length}`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
fs.writeFileSync(`${dir}/${preview ? "preview" : "live"}-story-images.json`, JSON.stringify(results, null, 2));
