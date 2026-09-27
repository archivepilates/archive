#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const SITE = "https://archivepilates.imweb.me";
export const ASSET_ORIGIN = "https://archivepilates.com";
export const RENEWAL = "imweb-renewal-20260927";
export const DISCOVERY = "imweb-video-discovery-20260906.js";
export const WIDTHS = [320, 390, 768, 1440];
export const ROUTES = [
  { name: "home", url: "/" },
  { name: "home-index", url: "/index" },
  { name: "catalog", url: "/17" },
  { name: "ab10", url: "/17/?idx=87" },
  { name: "knitido", url: "/16?ap_shop=knitido" },
  { name: "lesson", url: "/18/?idx=1" },
];
const ASSETS = [`${RENEWAL}.css`, `${RENEWAL}.js`, DISCOVERY];
const digest = (body) => createHash("sha256").update(body).digest("hex");

export function loadPlaywright() {
  for (const root of [ROOT, process.env.IMWEB_DEPENDENCY_ROOT, path.join(os.homedir(), "dev/ARCHIVE-IN")].filter(Boolean)) {
    try { return createRequire(path.join(root, "package.json"))("playwright"); }
    catch (error) { if (error.code !== "MODULE_NOT_FOUND") throw error; }
  }
  throw new Error("Playwright missing; set IMWEB_DEPENDENCY_ROOT to the canonical repository (no install required).");
}

export function injectRenewal(html) {
  assert(/<\/head\s*>/i.test(html), "Imweb document has no head closing tag");
  let tags = "";
  for (const extension of ["css", "js"]) {
    const asset = `${ASSET_ORIGIN}/assets/${RENEWAL}.${extension}`;
    if (html.includes(asset)) continue;
    tags += extension === "css" ? `<link rel="stylesheet" href="${asset}">` : `<script defer src="${asset}"></script>`;
  }
  return html.replace(/<\/head\s*>/i, `${tags}</head>`);
}

export function expectedSchedule(texts) {
  return texts.map((value) => {
    const text = value.replace(/\s+/g, " ").trim();
    return `${text.replace(/\s*\(품절\)/g, "")} · ${/품절/.test(text) ? "예약 마감" : "예약 가능"}`;
  });
}

export async function installPreview(context, audit, snapshots = new Map()) {
  await context.route(`${ASSET_ORIGIN}/assets/**`, async (route) => {
    const url = new URL(route.request().url());
    const relative = decodeURIComponent(url.pathname.slice("/assets/".length));
    const local = path.resolve(ROOT, "official-home/assets", relative);
    if (!local.startsWith(path.join(ROOT, "official-home/assets") + path.sep) || !fs.existsSync(local) || !fs.statSync(local).isFile()) return route.continue();
    if (!snapshots.has(relative)) snapshots.set(relative, fs.readFileSync(local));
    const body = snapshots.get(relative);
    audit.push({ asset: relative, sha256: digest(body) });
    await route.fulfill({ body, contentType: { ".css": "text/css", ".js": "application/javascript", ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" }[path.extname(local)] || "application/octet-stream" });
  });
  await context.route(`${SITE}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.resourceType() !== "document" || !/^\/(?:16|17|18|index)?\/?$/.test(url.pathname) || request.method() !== "GET") return route.continue();
    const response = await route.fetch({ timeout: 30000 });
    if (!(response.headers()["content-type"] || "").includes("text/html")) return route.fulfill({ response });
    await route.fulfill({ response, body: injectRenewal(await response.text()) });
  });
}

async function homeState(page) {
  await page.getByRole("heading", { name: /강사의 수업을 기록하고/, level: 1 }).waitFor();
  await page.waitForLoadState("load");
  await page.waitForFunction(() => document.fonts.status === "loaded");
  return page.evaluate(() => {
    const hero = document.getElementById("apb-home");
    const classes = document.getElementById("apb-class");
    const review = document.getElementById("apb-review");
    const clone = hero.cloneNode(true);
    // The only permitted hero change is CTA text; retain all other DOM data.
    clone.querySelectorAll(".apb-actions a").forEach((link) => { link.textContent = "CTA"; });
    const visual = (node, pseudo = null) => {
      const style = getComputedStyle(node, pseudo);
      return { backgroundImage: style.backgroundImage, backgroundColor: style.backgroundColor, backgroundSize: style.backgroundSize, backgroundPosition: style.backgroundPosition, color: style.color, fontSize: style.fontSize };
    };
    return {
      heroCount: document.querySelectorAll("#apb-home").length,
      heroStructure: clone.outerHTML.replace(/\s+/g, " ").trim(),
      heroVisual: { base: visual(hero), before: visual(hero, "::before"), after: visual(hero, "::after"), heading: visual(hero.querySelector("h1")) },
      heroRect: hero.getBoundingClientRect().toJSON(),
      hrefs: Array.from(hero.querySelectorAll(".apb-actions a"), (link) => ({ href: link.href, target: link.target, rel: link.rel })),
      order: { dom: !!(classes.compareDocumentPosition(review) & Node.DOCUMENT_POSITION_FOLLOWING), classBottom: classes.getBoundingClientRect().bottom + scrollY, reviewTop: review.getBoundingClientRect().top + scrollY, heroBeforeClass: !!(hero.compareDocumentPosition(classes) & Node.DOCUMENT_POSITION_FOLLOWING) },
    };
  });
}

async function home(page, evidence, capture) {
  const nativeContext = await page.context().browser().newContext({ viewport: page.viewportSize(), locale: "ko-KR", reducedMotion: "reduce", serviceWorkers: "block" });
  let native;
  try {
    nativeContext.setDefaultTimeout(12000);
    nativeContext.setDefaultNavigationTimeout(35000);
    const nativePage = await nativeContext.newPage();
    const response = await nativePage.goto(evidence.url, { waitUntil: "domcontentloaded" });
    assert(response?.ok(), `Native home baseline HTTP ${response?.status()}`);
    native = await homeState(nativePage);
  } finally { await nativeContext.close(); }
  const actual = await homeState(page);
  evidence.home = { ...actual, nativeHeroStructureHash: digest(native.heroStructure), previewHeroStructureHash: digest(actual.heroStructure), nativeHeroVisual: native.heroVisual, nativeHrefs: native.hrefs };
  delete evidence.home.heroStructure;
  assert.equal(actual.heroCount, 1, "Native home hero must remain unique");
  assert(actual.heroRect.width > 0 && actual.heroRect.height > 0, "Native home hero is hidden");
  assert.equal(actual.heroStructure, native.heroStructure, "Hero DOM changed beyond CTA labels");
  assert.deepEqual(actual.heroVisual, native.heroVisual, "Native hero visuals changed");
  assert.deepEqual(actual.hrefs, native.hrefs, "Hero CTA href/target/rel changed");
  assert(actual.order.dom && actual.order.heroBeforeClass, "Expected hero, classes, then review DOM order");
  assert(actual.order.classBottom <= actual.order.reviewTop + 1, `Classes must precede review visually: ${JSON.stringify(actual.order)}`);
  for (const [label, destination] of [["강사레슨 예약", "/18"], ["강사레슨 영상구매", "/17"]]) {
    const link = page.getByRole("link", { name: label, exact: true });
    assert.equal(await link.count(), 1, `${label}: expected one hero CTA`);
    assert(await link.isVisible(), `${label}: CTA is hidden`);
    assert.equal(await link.getAttribute("href"), SITE + destination, `${label}: destination changed`);
  }
  await capture("hero");
  await page.getByRole("heading", { name: /ARCHIVE PILATES 클래스로/, level: 2 }).scrollIntoViewIfNeeded();
  await capture("classes");
}

async function catalog(page, evidence, capture) {
  await page.getByRole("region", { name: "전체 영상", exact: true }).waitFor();
  await page.waitForFunction(() => !!document.querySelector(".apvd-curated"));
  evidence.order = await page.evaluate(() => {
    const grid = document.querySelector(".shop-grid");
    const curated = document.querySelector(".apvd-curated");
    const panel = document.getElementById("ap-video-discovery-all");
    return { dom: !!(grid.compareDocumentPosition(curated) & Node.DOCUMENT_POSITION_FOLLOWING), gridBottom: grid.getBoundingClientRect().bottom + scrollY, recommendationTop: curated.getBoundingClientRect().top + scrollY, panelTop: panel.getBoundingClientRect().top + scrollY };
  });
  assert(evidence.order.dom, "Catalog must precede recommendations in DOM");
  assert(evidence.order.gridBottom <= evidence.order.recommendationTop + 1, `Catalog overlaps/follows recommendations: ${JSON.stringify(evidence.order)}`);
  if (page.viewportSize().width >= 1024) {
    const countdown = page.getByTestId("video-price-countdown");
    await countdown.waitFor({ state: "visible" });
    evidence.countdownAlignment = await countdown.evaluate((element) => {
      const banner = element.getBoundingClientRect();
      const grid = document.querySelector(".shop-grid").getBoundingClientRect();
      return {
        countdown: { left: banner.left, right: banner.right, center: (banner.left + banner.right) / 2 },
        catalog: { left: grid.left, right: grid.right, center: (grid.left + grid.right) / 2 },
      };
    });
    for (const edge of ["left", "right", "center"]) {
      assert(Math.abs(evidence.countdownAlignment.countdown[edge] - evidence.countdownAlignment.catalog[edge]) <= 1.5,
        `Countdown ${edge} must align with catalog: ${JSON.stringify(evidence.countdownAlignment)}`);
    }
  }
  const instructor = page.getByLabel("강사", { exact: true });
  evidence.instructors = {};
  for (const [label, expected, excluded] of [["민진쌤", 86, 87], ["은영쌤", 87, 86]]) {
    await instructor.selectOption(label);
    const state = await page.evaluate(() => Array.from(document.querySelectorAll("[data-apvd-list-card]"), (card) => {
      const data = JSON.parse(card.getAttribute("data-product-properties") || "{}");
      return { id: Number(data.idx), name: data.name, visible: card.getBoundingClientRect().height > 0 && getComputedStyle(card).display !== "none" };
    }));
    const ids = state.filter((card) => card.visible).map((card) => card.id);
    evidence.instructors[label] = ids;
    assert(ids.includes(expected) && !ids.includes(excluded), `${label}: latest instructor mismatch, visible IDs ${ids}`);
    assert(state.some((card) => card.id === expected && card.name.includes(expected === 86 ? "(AR6)" : "(AB10)")), "Latest ID/code mismatch");
    await instructor.scrollIntoViewIfNeeded();
    await capture(`instructor-${expected}`);
  }
  await page.getByRole("button", { name: "필터 초기화", exact: true }).click();
  assert.equal(await instructor.inputValue(), "");
  await page.getByRole("heading", { name: "전체 영상", exact: true }).scrollIntoViewIfNeeded();
}

async function detailTitle(page, evidence) {
  const title = page.getByRole("heading", { name: /AB10/, level: 1 });
  await title.waitFor();
  evidence.title = await title.evaluate((heading) => Array.from(heading.childNodes).filter((node) => node.nodeType === 3).map((node) => node.textContent).join("").trim());
  evidence.titleSelectorMatch = await title.evaluate((heading) => heading.matches(".goods_detail h1.view_tit, .goods_form h1.view_tit"));
  evidence.titleFontSize = await title.evaluate((heading) => getComputedStyle(heading).fontSize);
  assert.equal(evidence.title, "바렐 외부 피드백 (AB10)", "AB10 title must be short and retain its code");
}

async function detail(page, evidence) {
  await page.getByRole("heading", { name: /AB10/, level: 2 }).first().scrollIntoViewIfNeeded();
  await page.waitForFunction(() => !!document.querySelector(".archive-online-product[data-ap-video-preview-ready='true']"));
  evidence.previews = await page.evaluate(() => Array.from(document.querySelectorAll(".shop_view_body .archive-online-product"), (section) => {
    const frame = section.querySelector("iframe");
    const cta = section.querySelector("[data-archive-pilates-watch-cta]");
    const rect = section.getBoundingClientRect();
    return { title: section.querySelector("h2")?.textContent, count: section.querySelectorAll("iframe").length, src: frame?.src, iframeTitle: frame?.title, before: !!(frame && cta && (frame.compareDocumentPosition(cta) & Node.DOCUMENT_POSITION_FOLLOWING)), visible: rect.height > 0 && rect.width > 0, previewBottom: frame?.getBoundingClientRect().bottom, ctaTop: cta?.getBoundingClientRect().top };
  }));
  assert(evidence.previews.some((item) => item.visible), "No visible product preview");
  for (const preview of evidence.previews) {
    assert(preview.title.includes("(AB10)") && preview.count === 1 && /preview|미리보기/i.test(preview.iframeTitle), "Product-specific preview identity missing");
    // Independently read from the public native AB10 product on 2026-09-27.
    assert.equal(new URL(preview.src).pathname, "/embed/06hKo8h8Tsg", "AB10 must retain its own preview, not AR6 or a recommendation");
    assert(preview.before, "Preview follows watch CTA in DOM");
    if (preview.visible) assert(preview.previewBottom <= preview.ctaTop + 1, "Preview follows/overlaps watch CTA visually");
  }
}

async function knitido(page, evidence, capture) {
  const form = page.getByRole("form", { name: "니티도 상품 필터", exact: true });
  await form.waitFor();
  await page.waitForFunction(() => !!document.querySelector(".ap-renewal-story"));
  evidence.story = await page.evaluate(() => Array.from(document.querySelectorAll(".ap-renewal-story"), (story) => ({ open: story.open, summary: story.querySelector("summary")?.textContent })));
  assert(evidence.story.length && evidence.story.every((story) => !story.open), "Knitido story must be closed initially");
  const photo = page.getByRole("img", { name: "니티도 리브랜딩 론칭에 함께한 구성원 단체 사진", exact: true });
  assert(await photo.isVisible(), "Team photo must remain visible outside the closed story");
  await photo.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => Array.from(document.images).some((img) => img.alt === "니티도 리브랜딩 론칭에 함께한 구성원 단체 사진" && img.complete && img.naturalWidth > 0));
  evidence.teamPhoto = await photo.evaluate((img) => ({ src: img.currentSrc, naturalWidth: img.naturalWidth }));
  await capture("team");
  const all = await page.evaluate(() => Array.from(document.querySelectorAll(".ap-knitido-product-card"), (card) => card.querySelector("strong").textContent.trim()));
  assert(all.length > 0, "No Knitido products");
  evidence.filters = [];
  for (const label of ["사이즈", "색상"]) {
    const select = form.getByLabel(label, { exact: true });
    const options = await select.evaluate((input) => Array.from(input.options, (option) => option.value).filter(Boolean));
    assert(options.length, `No ${label} choices`);
    for (const option of options) {
      await select.selectOption(option);
      const visible = await page.evaluate(() => Array.from(document.querySelectorAll(".ap-knitido-product-card")).filter((card) => card.getBoundingClientRect().height > 0).map((card) => card.querySelector("strong").textContent.trim()));
      const matches = (title) => label === "사이즈" ? title.replace(/\s/g, "").includes(option) : title.split("·").slice(1).join("·").trim() === option;
      assert.deepEqual(visible, all.filter(matches), `${label} ${option} has wrong products`);
      evidence.filters.push({ label, option, count: visible.length });
    }
    await form.getByRole("button", { name: "초기화", exact: true }).click();
    assert.equal(await select.inputValue(), "");
  }
  assert.equal(await form.getByRole("status").textContent(), `${all.length}개 상품`);
  await form.scrollIntoViewIfNeeded();
}

async function lesson(page, evidence) {
  const region = page.getByRole("region", { name: "수강일별 모집 현황", exact: true });
  await region.first().waitFor({ state: "visible" });
  evidence.schedule = {
    native: await page.evaluate(() => Array.from(document.querySelectorAll("#prod_options .dropdown-menu .dropdown-item > a._requireOption"), (option) => option.textContent)),
    visibleRegionCount: await region.count(),
    totalRegionCount: await page.getByRole("region", { name: "수강일별 모집 현황", exact: true, includeHidden: true }).count(),
  };
  assert.equal(evidence.schedule.visibleRegionCount, 1, "Exactly one schedule region must be exposed at this viewport");
  Object.assign(evidence.schedule, await region.evaluate((element) => ({
    rendered: Array.from(element.querySelectorAll(":scope > p"), (row) => row.textContent),
    placement: { parent: element.parentElement.id, visibility: getComputedStyle(element).visibility, insideOptionGroup: !!element.closest(".opt-group"), rect: element.getBoundingClientRect().toJSON() },
  })));
  assert(evidence.schedule.native.length > 0, "Native date options are missing");
  assert.deepEqual(evidence.schedule.rendered, expectedSchedule(evidence.schedule.native), "Schedule diverges from native dates/status");
  assert(evidence.schedule.native.every((option) => /\d/.test(option)), "Native options have no dates");
  assert(await region.isVisible(), `Schedule is not visible without opening purchase options: ${JSON.stringify(evidence.schedule.placement)}`);
  if (evidence.schedule.native.some((option) => option.includes("품절"))) {
    assert.equal(await region.getByRole("link", { name: "마감일 대기 신청", exact: true }).getAttribute("href"), "https://pf.kakao.com/_AHdvn/chat");
  }
  await region.scrollIntoViewIfNeeded();
}

export async function layoutEvidence(page) {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const overflowing = Array.from(document.querySelectorAll("main *")).filter((node) => {
      const r = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none" && (r.right > width + 1 || r.left < -1);
    }).slice(0, 15).map((node) => ({ tag: node.tagName, className: String(node.className), text: node.textContent?.trim().slice(0, 90), rect: node.getBoundingClientRect().toJSON() }));
    // Imweb body scrollWidth includes internal native UI even when the actual
    // document has no horizontal scroll range. Keep it as diagnostics only.
    return { width, scrollWidth: document.scrollingElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth, overflowing };
  });
}

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

async function desktopNavigation(page, evidence, capture) {
  const initialUrl = page.url();
  evidence.navigation = [];
  await page.waitForFunction(() => !!document.querySelector("a.ap-shop-nav-link > .plain_name > .ap-shop-nav-label > .ap-nav-ko"));
  for (const name of ["아카이브홈", "강사레슨", "영상구매", "판매상품", "커뮤니티"]) {
    const candidates = page.getByRole("link", { name, exact: true });
    let link;
    for (let index = 0; index < await candidates.count(); index += 1) {
      const candidate = candidates.nth(index);
      if (await candidate.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return !!element.closest("#doz_header") && element.matches("a.ap-shop-nav-link,a.ap-shop-visual-link") && rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= innerWidth + 1 && rect.top >= 0 && rect.bottom <= innerHeight;
      })) { link = candidate; break; }
    }
    assert(link, `Visible desktop navigation link missing: ${name}`);
    for (const state of ["default", "hover", "focus"]) {
      await page.mouse.move(0, 0);
      if (state === "hover") await link.hover();
      if (state === "focus") { await page.keyboard.press("Tab"); await link.focus(); }
      const result = await link.evaluate((element) => {
        const visual = element.matches("a.ap-shop-visual-link");
        const prefix = visual ? ":scope > .ap-shop-visual-label > .ap-shop-pill-" : ":scope > .plain_name > .ap-shop-nav-label > .ap-nav-";
        const describe = (node) => {
          if (!node) return null;
          const style = getComputedStyle(node), rect = node.getBoundingClientRect();
          return { text: node.textContent, display: style.display, visibility: style.visibility, opacity: style.opacity, width: rect.width, height: rect.height };
        };
        return { type: visual ? "shop-visual" : "regular", ko: describe(element.querySelector(prefix + "ko")), en: describe(element.querySelector(prefix + "en")), hover: element.matches(":hover"), focus: element.matches(":focus"), focusVisible: element.matches(":focus-visible") };
      });
      evidence.navigation.push({ name, state, ...result });
      assert(result.ko && result.en, `Native label structure missing: ${name}`);
      assert(result.ko.width > 0 && result.ko.height > 0 && result.ko.visibility === "visible" && Number(result.ko.opacity) === 1, `${name}/${state}: Korean label hidden`);
      assert.equal(result.en.display, "none", `${name}/${state}: English label must stay hidden`);
      if (state === "hover") assert(result.hover, `${name}: hover did not activate`);
      if (state === "focus") assert(result.focus && result.focusVisible, `${name}: keyboard focus did not activate`);
      if (name === "영상구매" && state === "hover" || name === "판매상품" && state === "focus") await capture(`nav-${result.type}-${state}`);
    }
    await link.evaluate((element) => element.blur());
    await page.keyboard.press("Escape");
  }
  await page.mouse.move(0, 0);
  assert.equal(page.url(), initialUrl, "Navigation labels must be tested without visiting their destinations");
}

export async function runVerification({ live = false, output = path.join(os.tmpdir(), `imweb-renewal-${Date.now()}`), widths = WIDTHS, routes = ROUTES, expectedCssVersion, checkDesktopNavigation = false } = {}) {
  fs.mkdirSync(output, { recursive: true });
  const snapshots = new Map(ASSETS.map((name) => [name, fs.readFileSync(path.join(ROOT, "official-home/assets", name))]));
  const report = { mode: live ? "live-no-interception" : "preview-local-assets", account: "logged-out ephemeral context; no authentication", startedAt: new Date().toISOString(), assetHashes: Object.fromEntries([...snapshots].map(([name, body]) => [name, digest(body)])), results: [], cleanup: false };
  const { chromium } = loadPlaywright();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    scenarios: for (const width of widths) {
      for (const route of routes) {
        const result = { name: route.name, width, url: SITE + route.url, checks: [], screenshots: [], localAssets: [], errors: [], consoleErrors: [], failedRequests: [] };
        report.results.push(result);
        const context = await browser.newContext({ viewport: { width, height: 900 }, locale: "ko-KR", reducedMotion: "reduce", serviceWorkers: "block" });
        const deadline = setTimeout(() => { result.errors.push("Scenario exceeded 90 second budget"); void context.close(); }, 90000);
        try {
          context.setDefaultTimeout(12000);
          context.setDefaultNavigationTimeout(35000);
          if (!live) await installPreview(context, result.localAssets, snapshots);
          const page = await context.newPage();
          page.on("pageerror", (error) => result.errors.push(error.message));
          page.on("console", (message) => { if (message.type() === "error") result.consoleErrors.push(message.text()); });
          page.on("requestfailed", (request) => result.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
          page.on("response", (response) => {
            if (response.status() === 429 && new URL(response.url()).origin === SITE) {
              report.rateLimited = true;
              result.errors.push("HTTP 429: stop all remaining scenarios; no automatic retry");
              void context.close().catch(() => {});
            }
          });
          const check = async (name, fn) => {
            try { await fn(); result.checks.push({ name, ok: true }); }
            catch (error) { result.checks.push({ name, ok: false, error: error.message }); }
          };
          const capture = async (suffix, fullPage = false) => {
            const screenshot = path.join(output, `${live ? "live" : "preview"}-${route.name}-${width}-${suffix}.png`);
            await page.screenshot({ path: screenshot, fullPage, animations: "disabled", timeout: 12000 });
            result.screenshots.push(screenshot);
          };
          const response = await page.goto(result.url, { waitUntil: "domcontentloaded" });
          if (response?.status() === 429) {
            result.errors.push("HTTP 429: stop all remaining scenarios; no automatic retry");
            report.rateLimited = true;
            break scenarios;
          }
          assert(response?.ok(), `HTTP ${response?.status()}`);
          await check("renewal-loaded", async () => {
            await page.waitForFunction(() => document.documentElement.hasAttribute("data-ap-renewal"));
            result.renewalVersion = await page.evaluate(() => document.documentElement.getAttribute("data-ap-renewal"));
            assert(await page.evaluate(() => Array.from(document.styleSheets).some((sheet) => sheet.href?.includes("imweb-renewal-20260927.css"))), "Renewal CSS missing");
            if (expectedCssVersion) {
              result.renewalCssLinks = await page.evaluate(() => Array.from(document.querySelectorAll('link[rel="stylesheet"]'), (link) => link.href).filter((href) => new URL(href).pathname.endsWith("/imweb-renewal-20260927.css")));
              assert(result.renewalCssLinks.length && result.renewalCssLinks.every((href) => new URL(href).searchParams.get("v") === expectedCssVersion), `Expected renewal CSS v=${expectedCssVersion}: ${result.renewalCssLinks}`);
            }
            if (!live) for (const name of ASSETS.filter((name) => route.name === "catalog" || route.name === "ab10" || name !== DISCOVERY)) assert(result.localAssets.some((asset) => asset.asset === name), `Local asset not intercepted: ${name}`);
          });
          await page.waitForFunction(() => document.fonts.status === "loaded");
          await check("initial-screenshot", () => capture("top"));
          if (checkDesktopNavigation && width === 1440 && route.name === "catalog") await check("desktop-navigation-korean", () => desktopNavigation(page, result, capture));
          if (route.name === "ab10") await check("short-title", () => detailTitle(page, result));
          await check(route.name, () => ({ home, "home-index": home, catalog, ab10: detail, knitido, lesson })[route.name](page, result, capture));
          await check("no-horizontal-overflow", async () => {
            result.layout = await layoutEvidence(page);
            assert(result.layout.scrollWidth <= width + 1, `Horizontal overflow: ${result.layout.scrollWidth}px at ${width}px`);
            assert.equal(result.layout.overflowing.length, 0, `Offscreen content: ${JSON.stringify(result.layout.overflowing)}`);
          });
          await check("final-screenshots", async () => { await capture("focus"); await capture("full", true); });
        } catch (error) { result.errors.push(error.message); }
        finally { clearTimeout(deadline); await context.close(); }
        result.ok = !result.errors.length && result.checks.every((check) => check.ok);
        console.log(`${result.ok ? "PASS" : "FAIL"} ${route.name} ${width}: ${result.checks.filter((check) => !check.ok).map((check) => `${check.name}: ${check.error}`).join("; ") || result.errors.join("; ") || "all checks"}`);
        if (report.rateLimited) break scenarios;
      }
    }
  } catch (error) { report.fatal = error.message; }
  finally {
    if (browser) { await browser.close(); report.cleanup = !browser.isConnected() && browser.contexts().length === 0; }
    report.finishedAt = new Date().toISOString();
    report.assetsChangedDuringRun = ASSETS.filter((name) => digest(fs.readFileSync(path.join(ROOT, "official-home/assets", name))) !== report.assetHashes[name]);
    report.ok = !report.fatal && report.cleanup && report.results.length === widths.length * routes.length && report.results.every((result) => result.ok) && !report.assetsChangedDuringRun.length;
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(output, "report.html"), `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ARCHIVE PILATES renewal verification</title><style>body{font:16px/1.6 system-ui;margin:24px auto;padding:0 16px;max-width:1000px;color:#242424}*{box-sizing:border-box}pre{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#a7352b}li{margin:8px 0}</style><h1>ARCHIVE PILATES renewal verification</h1><p>${escapeHtml(report.mode)}: ${report.ok ? "PASS" : "CHECK REQUIRED"}. Public guest presentation only; no auth, order, cart, or production edits.</p><ul>${report.results.map((result) => `<li>${escapeHtml(result.name)} ${result.width}: ${result.ok ? "PASS" : "FAIL"} ${result.screenshots.map((file) => `<a href="${escapeHtml(path.basename(file))}">${escapeHtml(path.basename(file))}</a>`).join(" · ")}</li>`).join("")}</ul><pre>${escapeHtml(JSON.stringify(report, null, 2))}</pre></html>`);
    console.log(JSON.stringify({ ok: report.ok, passed: report.results.filter((result) => result.ok).length, total: report.results.length, cleanup: report.cleanup, assetsChangedDuringRun: report.assetsChangedDuringRun, report: path.join(output, "report.html") }));
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf("--output");
  assert(args.every((arg, index) => ["--live", "--preview", "--output"].includes(arg) || index === outputIndex + 1 && outputIndex >= 0), "Usage: node scripts/verify-imweb-renewal.mjs [--preview|--live] [--output DIRECTORY]");
  assert(!(args.includes("--live") && args.includes("--preview")), "Choose preview or live, not both");
  assert(outputIndex < 0 || args[outputIndex + 1] && !args[outputIndex + 1].startsWith("--"), "--output needs a directory");
  const report = await runVerification({ live: args.includes("--live"), ...(outputIndex >= 0 ? { output: path.resolve(args[outputIndex + 1]) } : {}) });
  process.exitCode = report.ok ? 0 : 1;
}
