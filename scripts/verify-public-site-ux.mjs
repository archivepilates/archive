import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const live = process.argv.includes("--live");
const dir = "artifacts/public-site-ux-20260905";
fs.mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const results = [];
try {
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    try {
      if (!live) {
        await context.route("https://archivepilates.com/**", async route => {
          const url = new URL(route.request().url());
          let local = path.join("official-home", url.pathname === "/" ? "index.html" : url.pathname);
          if (fs.existsSync(local) && fs.statSync(local).isDirectory()) local = path.join(local, "index.html");
          if (fs.existsSync(local)) {
            const ext = path.extname(local);
            await route.fulfill({ path: local, contentType: { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".webp": "image/webp", ".png": "image/png" }[ext] });
          } else await route.continue();
        });
        await context.route("https://archivepilates.imweb.me/**", async route => {
          if (route.request().resourceType() !== "document") return route.continue();
          const response = await route.fetch();
          let body = await response.text();
          for (const position of ["header", "footer"]) {
            const before = fs.readFileSync(`${dir}/${position}-before.html`, "utf8");
            const after = fs.readFileSync(`${dir}/${position}-after.html`, "utf8");
            assert(body.includes(before), `Live ${position} changed; preview no longer reliable`);
            body = body.replace(before, after);
          }
          await route.fulfill({ response, body });
        });
      }
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      for (const [name, url, ready] of [
        ["home", "https://archivepilates.com/", "header"],
        ["knitido", "https://archivepilates.imweb.me/16?ap_shop=knitido", ".ap-knitido-filters"],
        ["videos", "https://archivepilates.imweb.me/17", ".shop-item._shop_item"],
        ["video-detail", "https://archivepilates.imweb.me/17/?idx=85", ".goods_detail"],
        ["community", "https://archivepilates.imweb.me/community", "#doz_header_wrap"],
      ]) {
        console.log(`Checking ${live ? "live" : "preview"} ${name} ${width}`);
        const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
        assert(response?.ok(), `${name}/${width}: HTTP ${response?.status()}`);
        await page.waitForFunction(selector => !!document.querySelector(selector), ready, { timeout: 30000 });
        await page.evaluate(() => document.fonts.ready);
        if (name !== "home") await page.waitForFunction(() => document.documentElement.hasAttribute("data-archive-pilates-public-ux-ready"), null, { timeout: 20000 });
        if (name === "videos" || name === "video-detail") {
          await page.waitForFunction(expected => document.documentElement.getAttribute("data-ap-video-discovery-ready") === expected, name === "videos" ? "list" : "detail", { timeout: 30000 });
        }
        const state = await page.evaluate(() => ({
          width: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          headerY: (document.querySelector(".site-header,#doz_header_wrap")?.getBoundingClientRect().top ?? -1),
          broken: Array.from(document.images).filter(img => img.currentSrc && img.complete && !img.naturalWidth).map(img => img.currentSrc),
        }));
        assert(state.scrollWidth <= state.width + 1, `${name}/${width}: horizontal overflow ${state.scrollWidth}`);
        if (name === "videos") {
          await page.getByRole("link", { name: "전체 영상 바로 보기", exact: true }).click();
          await page.waitForFunction(() => {
            const top = document.getElementById("ap-video-discovery-all").getBoundingClientRect().top;
            return top >= 0 && top < 240;
          }).catch(async error => {
            await page.screenshot({ path: `${dir}/jump-failure-${width}.png`, fullPage: false });
            console.log(await page.evaluate(() => ({ y: scrollY, hash: location.hash, panel: document.getElementById("ap-video-discovery-all").getBoundingClientRect().toJSON(), header: document.getElementById("doz_header_wrap").getBoundingClientRect().toJSON() })));
            throw error;
          });
          await page.getByLabel("기구", { exact: true }).selectOption("체어");
          await page.getByLabel("강사", { exact: true }).selectOption("민진쌤");
          const filtered = await page.evaluate(() => Array.from(document.querySelectorAll(".shop-item._shop_item:not([data-apvd-filtered])")).map(card => JSON.parse(card.getAttribute("data-product-properties") || "{}").name));
          assert(filtered.length > 0 && filtered.every(name => name.includes("체어")), "Equipment filter returned wrong products");
          await page.screenshot({ path: `${dir}/${live ? "live" : "preview"}-${name}-${width}-filters.png` });
          await page.getByRole("button", { name: "필터 초기화" }).click();
          await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
        }
        if (name === "video-detail") {
          const previews = await page.evaluate(() => Array.from(document.querySelectorAll(".archive-online-product[data-ap-video-preview-ready='true']")).map(section => ({
            src: section.querySelector("iframe").src,
            previewBeforeAccess: Boolean(section.querySelector("iframe").compareDocumentPosition(section.querySelector("[data-archive-pilates-watch-cta]")) & Node.DOCUMENT_POSITION_FOLLOWING),
          })));
          assert(previews.length && previews.every(item => item.src.includes("/embed/JVdsoaWkH-s") && item.previewBeforeAccess), "Preview mismatch or still below access prose");
        }
        if (name === "knitido") {
          const total = await page.evaluate(() => document.querySelectorAll(".ap-knitido-product-card").length);
          const form = page.getByRole("form", { name: "니티도 상품 필터" });
          await page.getByLabel("사이즈", { exact: true }).selectOption("25-27cm");
          assert(await page.evaluate(() => document.querySelectorAll(".ap-knitido-product-card:not([hidden])").length) === 1, "Expected one 25-27cm product");
          await page.getByLabel("색상", { exact: true }).selectOption("블랙");
          assert(await page.getByText("선택한 조건의 상품이 없습니다.", { exact: true }).isVisible(), "No-match message missing");
          await form.getByRole("button", { name: "초기화" }).click();
          await page.waitForFunction(expected => document.querySelectorAll(".ap-knitido-product-card:not([hidden])").length === expected, total);
          await page.getByRole("link", { name: "니티도 상품 바로 보기" }).click();
          await page.waitForFunction(() => {
            const top = document.getElementById("knitido-products").getBoundingClientRect().top;
            return top >= 0 && top < 230;
          });
          await page.screenshot({ path: `${dir}/${live ? "live" : "preview"}-${name}-${width}-products.png` });
          await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
        }
        await page.screenshot({ path: `${dir}/${live ? "live" : "preview"}-${name}-${width}.png`, fullPage: false });
        results.push({ name, width, ...state });
      }
      if (errors.length) results.push({ width, browserErrors: [...new Set(errors)] });
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
fs.writeFileSync(`${dir}/${live ? "live" : "preview"}-public.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify({ mode: live ? "live" : "preview-interception", results }, null, 2));
