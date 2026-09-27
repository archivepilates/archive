import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { after, before } from "node:test";
import { DISCOVERY, RENEWAL, ROOT, WIDTHS, expectedSchedule, injectRenewal, installPreview, loadPlaywright } from "../verify-imweb-renewal.mjs";

const renewal = fs.readFileSync(path.join(ROOT, "official-home/assets", `${RENEWAL}.js`), "utf8");
const css = fs.readFileSync(path.join(ROOT, "official-home/assets", `${RENEWAL}.css`), "utf8");
const discovery = fs.readFileSync(path.join(ROOT, "official-home/assets", DISCOVERY), "utf8");
let browser;
before(async () => { browser = await loadPlaywright().chromium.launch({ headless: true }); });
after(async () => { if (browser) await browser.close(); });

async function withPage(route, markup, fn, { width = 390, discover = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
  try {
    context.setDefaultTimeout(5000);
    await context.route("**/*", (request) => request.fulfill(request.request().resourceType() === "document" && request.request().url().startsWith("https://imweb-renewal.test/") ? {
      contentType: "text/html; charset=utf-8", body: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:16px}main{min-width:0}img{max-width:100%}h1,h2{overflow-wrap:anywhere}</style></head><body><main>${markup}</main></body></html>`,
    } : { status: 204 }));
    const page = await context.newPage();
    await page.goto(`https://imweb-renewal.test${route}`, { waitUntil: "domcontentloaded" });
    await page.addStyleTag({ content: css });
    if (discover) await page.addScriptTag({ content: discovery });
    await page.addScriptTag({ content: renewal });
    await fn(page);
  } finally { await context.close(); }
}

const product = (id, code, title) => `<article class="shop-item _shop_item" data-product-properties='${JSON.stringify({ idx: id, name: `[온라인] ARCHIVE METHOD ${title} (${code}) 40D 이용권` })}'><a href="/17/?idx=${id}">${title} (${code})</a></article>`;
const catalog = `<section class="ap-video-sales"><h2>추천 영상</h2><div class="ap-video-sales__routes"><p>추천 내용</p></div></section><div class="shop-content"><div class="shop-grid">${product(86, "AR6", "리포머 외부 피드백")}${product(87, "AB10", "바렐 외부 피드백")}${product(27, "AR1", "리포머 척추 정렬 & 코어 컨트롤")}</div><nav aria-label="상품 페이지">1</nav></div>`;

test("preview injection is idempotent and leaves existing discovery inclusion intact", () => {
  const original = `<html><head><script src="https://archivepilates.com/assets/${DISCOVERY}?v=old"></script></head><body>Native shop</body></html>`;
  const injected = injectRenewal(original);
  assert.equal(injectRenewal(injected), injected);
  assert.equal(injected.split(`${RENEWAL}.css`).length - 1, 1);
  assert.equal(injected.split(`${RENEWAL}.js`).length - 1, 1);
  assert(injected.includes(`${DISCOVERY}?v=old`));
  assert(injected.includes("Native shop"));
  assert.throws(() => injectRenewal("not an HTML document"), /head/);
});

test("preview replaces the requested official assets, including existing discovery URL", async () => {
  const handlers = [];
  const context = { route: async (pattern, handler) => handlers.push({ pattern, handler }) };
  const audit = [];
  await installPreview(context, audit);
  assert.equal(handlers.length, 2);
  for (const file of [DISCOVERY, `${RENEWAL}.css`, `${RENEWAL}.js`]) {
    let reply;
    await handlers[0].handler({ request: () => ({ url: () => `https://archivepilates.com/assets/${file}?v=current` }), fulfill: async (value) => { reply = value; }, continue: () => assert.fail("Expected local asset") });
    assert.equal(reply.body.toString(), fs.readFileSync(path.join(ROOT, "official-home/assets", file), "utf8"));
  }
  assert.equal(audit.length, 3);
  assert(audit.every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256)));
  for (const pathname of ["/", "/index"]) {
    let reply;
    await handlers[1].handler({
      request: () => ({ url: () => `https://archivepilates.imweb.me${pathname}`, resourceType: () => "document", method: () => "GET" }),
      fetch: async () => ({ headers: () => ({ "content-type": "text/html" }), text: async () => "<html><head></head><body>Native HOME</body></html>" }),
      fulfill: async (value) => { reply = value; },
      continue: () => assert.fail(`${pathname}: HOME preview must intercept document`),
    });
    assert(reply.body.includes(`${RENEWAL}.js`) && reply.body.includes("Native HOME"));
  }
});

test("HOME aliases preserve native hero and CTA destinations while moving classes before review", async () => {
  const markup = `<div id="archive-pilates-site"><section id="apb-home" class="apb-hero"><h1>강사의 수업을 기록하고, 레슨의 기준을 다시 세웁니다.</h1><p>Native hero copy</p><div class="apb-actions"><a href="https://archivepilates.imweb.me/18" target="_blank" rel="noopener">강사레슨 보기</a><a href="https://archivepilates.imweb.me/17" target="_blank" rel="noopener">영상구매 보기</a></div></section><section id="apb-review"><h2>수업 후기</h2></section><section id="apb-class"><h2>클래스</h2></section></div>`;
  for (const route of ["/", "/index"]) await withPage(route, markup, async (page) => {
    assert.equal(await page.getByRole("heading", { level: 1 }).textContent(), "강사의 수업을 기록하고, 레슨의 기준을 다시 세웁니다.");
    for (const [label, destination] of [["강사레슨 예약", "/18"], ["강사레슨 영상구매", "/17"]]) {
      const link = page.getByRole("link", { name: label, exact: true });
      assert.equal(await link.getAttribute("href"), `https://archivepilates.imweb.me${destination}`);
      assert.equal(await link.getAttribute("target"), "_blank");
      assert.equal(await link.getAttribute("rel"), "noopener");
    }
    const state = await page.evaluate(() => ({
      ids: Array.from(document.querySelector("#archive-pilates-site").children, (node) => node.id),
      copy: document.querySelector("#apb-home > p").textContent,
      classBottom: document.querySelector("#apb-class").getBoundingClientRect().bottom,
      reviewTop: document.querySelector("#apb-review").getBoundingClientRect().top,
    }));
    assert.deepEqual(state.ids, ["apb-home", "apb-class", "apb-review"]);
    assert.equal(state.copy, "Native hero copy");
    assert(state.classBottom <= state.reviewTop);
  });
});

test("catalog and pagination precede recommendations; latest instructor filters work at all widths", { timeout: 30000 }, async () => {
  for (const width of WIDTHS) await withPage("/17", catalog, async (page) => {
    const panel = page.getByRole("region", { name: "전체 영상", exact: true });
    await panel.waitFor();
    const position = await page.evaluate(() => {
      const shop = document.querySelector(".shop-content");
      const recommendation = document.querySelector(".apvd-curated");
      return { before: !!(shop.compareDocumentPosition(recommendation) & Node.DOCUMENT_POSITION_FOLLOWING), bottom: shop.getBoundingClientRect().bottom, top: recommendation.getBoundingClientRect().top };
    });
    assert(position.before && position.bottom <= position.top);
    for (const [instructor, visible, hidden] of [["민진쌤", "AR6", "AB10"], ["은영쌤", "AB10", "AR6"]]) {
      await page.getByLabel("강사", { exact: true }).selectOption(instructor);
      assert(await page.getByRole("link", { name: new RegExp(`\\(${visible}\\)`) }).isVisible());
      assert.equal(await page.getByRole("link", { name: new RegExp(`\\(${hidden}\\)`) }).isVisible(), false);
    }
    await page.getByRole("button", { name: "필터 초기화", exact: true }).click();
    assert.equal(await panel.getByRole("status").textContent(), "3편 / 3편");
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.getByLabel("강사", { exact: true }).focus();
    assert(await page.getByLabel("강사", { exact: true }).evaluate((input) => getComputedStyle(input).outlineStyle !== "none"));
  }, { width, discover: true });
});

test("AB10 shortening preserves controls and moves its original preview before the watch CTA", async () => {
  await withPage("/17/?idx=87", `<div class="goods_detail"><h1 class="view_tit">[온라인] ARCHIVE METHOD 바렐 외부 피드백 (AB10) 40D 이용권<button type="button" aria-label="찜">+</button></h1></div><div class="shop_view_body"><section class="archive-online-product"><h2>ARCHIVE METHOD 바렐 외부 피드백 (AB10)</h2><p>Native details</p><div data-archive-pilates-watch-cta><a href="/watch-ab10">AB10 구매 후 시청 페이지 열기</a></div><div><iframe title="ARCHIVE PILATES preview" src="https://www.youtube.com/embed/06hKo8h8Tsg"></iframe></div></section></div>`, async (page) => {
    const title = page.getByRole("heading", { name: /AB10/, level: 1 });
    assert.equal(await title.evaluate((node) => node.firstChild.textContent.trim()), "바렐 외부 피드백 (AB10)");
    assert(await page.getByRole("button", { name: "찜", exact: true }).isVisible());
    const preview = await page.evaluate(() => {
      const iframe = document.querySelector("iframe");
      const cta = document.querySelector("[data-archive-pilates-watch-cta]");
      return { src: iframe.src, before: !!(iframe.compareDocumentPosition(cta) & Node.DOCUMENT_POSITION_FOLLOWING), bottom: iframe.getBoundingClientRect().bottom, top: cta.getBoundingClientRect().top };
    });
    assert.equal(preview.src, "https://www.youtube.com/embed/06hKo8h8Tsg");
    assert(preview.before && preview.bottom <= preview.top);
    await page.evaluate(() => document.dispatchEvent(new Event("archive:shop-route-change")));
    assert.equal(await page.getByRole("heading", { name: "미리보기", exact: true }).count(), 1);
  }, { discover: true });
});

test("Knitido story starts closed without moving or losing its team photo", async () => {
  await withPage("/16?ap_shop=knitido", `<section class="ap-knitido-brand-intro"><div class="ap-knitido-brand-hero"><figure class="ap-knitido-brand-media"><img width="640" height="427" alt="니티도 리브랜딩 론칭에 함께한 구성원 단체 사진"></figure></div><div class="ap-knitido-brand-story"><p>Story</p></div><p class="ap-knitido-brand-note">Note</p></section>`, async (page) => {
    const state = await page.evaluate(() => ({ count: document.querySelectorAll("details.ap-renewal-story").length, open: document.querySelector("details").open, photoInStory: !!document.querySelector("details img"), noteInStory: !!document.querySelector("details .ap-knitido-brand-note") }));
    assert.deepEqual(state, { count: 1, open: false, photoInStory: false, noteInStory: true });
    assert(await page.getByRole("img", { name: "니티도 리브랜딩 론칭에 함께한 구성원 단체 사진", exact: true }).isVisible());
    await page.evaluate(() => document.dispatchEvent(new Event("archive:shop-route-change")));
    assert.equal(await page.evaluate(() => document.querySelectorAll("details.ap-renewal-story").length), 1);
  });
});

test("native Imweb goods_form title outside goods_detail is shortened too", async () => {
  // The public AB10 document uses this ancestry; the legacy fixture above
  // alone cannot detect an overly narrow goods_detail selector.
  for (const width of WIDTHS) await withPage("/17/?idx=87", `<div class="goods_form"><h1 class="view_tit">[온라인] ARCHIVE METHOD 바렐 외부 피드백 (AB10) 40D 이용권</h1></div>`, async (page) => {
    const title = page.getByRole("heading", { level: 1 });
    assert.equal(await title.textContent(), "바렐 외부 피드백 (AB10)");
    assert.equal(await title.evaluate((heading) => getComputedStyle(heading).fontSize), width < 768 ? "22px" : "25px");
  }, { width });
});

test("Knitido lazy team image reserves space before intrinsic dimensions load", async () => {
  await withPage("/16?ap_shop=knitido", `<section class="ap-knitido-brand-intro"><figure class="ap-knitido-brand-media"><img loading="lazy" src="/pending-image.jpg" alt="팀 사진"></figure><div class="ap-knitido-brand-story">Story</div></section>`, async (page) => {
    const photo = page.getByRole("img", { name: "팀 사진", exact: true });
    const size = await photo.evaluate((img) => ({ width: img.getBoundingClientRect().width, height: img.getBoundingClientRect().height }));
    assert(size.width > 0 && size.height > 0);
    assert(Math.abs(size.width / size.height - 1.5) < 0.02);
  }, { width: 320 });
});

test("lesson schedule mirrors native available/sold-out options without selecting or ordering", async () => {
  const options = ["10월 3일 토요일 14:00 (품절)", "10월 10일 토요일 14:00"];
  await withPage("/18/?idx=1", `<div id="prod_options"><div class="dropdown-menu">${options.map((option) => `<div class="dropdown-item"><a class="_requireOption" href="#">${option}</a></div>`).join("")}</div></div>`, async (page) => {
    const region = page.getByRole("region", { name: "수강일별 모집 현황", exact: true });
    await region.waitFor();
    assert.deepEqual(await region.evaluate((element) => Array.from(element.querySelectorAll("p"), (row) => row.textContent)), expectedSchedule(options));
    assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll("._requireOption"), (option) => option.textContent)), options);
    assert.equal(await region.getByRole("link", { name: "마감일 대기 신청", exact: true }).getAttribute("href"), "https://pf.kakao.com/_AHdvn/chat");
    assert(await region.evaluate((element) => element.nextElementSibling?.id === "prod_options"), "Without a detail body, schedule must precede native options");
    assert.equal(page.url(), "https://imweb-renewal.test/18/?idx=1");
  });
});

test("desktop/mobile body clones expose exactly one schedule outside native opt-group at every width", { timeout: 15000 }, async () => {
  const options = ["2026년 10월 24일(토) 70,000원 (품절)", "2026년 10월 25일(일) 70,000원"];
  const markup = `<style>.categorize{display:none}.opt-group{visibility:hidden;position:fixed;top:100%;left:0;width:100%}@media(min-width:768px){.categorize-mobile{display:none}.categorize{display:block}.opt-group{visibility:visible;position:static}}</style><div class="goods_form"><div class="categorize-mobile"><div class="shop_view_body"><h2>모바일 강사레슨 상세정보</h2></div></div><div class="opt-group"><div id="prod_options"><div class="dropdown-menu">${options.map((option) => `<div class="dropdown-item"><a class="_requireOption" href="#">${option}</a></div>`).join("")}</div></div></div></div><div class="categorize"><div class="shop_view_body"><h2>데스크톱 강사레슨 상세정보</h2></div></div>`;
  await withPage("/18/?idx=1", markup, async (page) => {
    for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    const region = page.getByRole("region", { name: "수강일별 모집 현황", exact: true });
    await region.waitFor({ state: "visible" });
    assert.equal(await region.count(), 1, `${width}px: exactly one exposed region`);
    assert.equal(await page.getByRole("region", { name: "수강일별 모집 현황", exact: true, includeHidden: true }).count(), 2, "Both native detail bodies retain a schedule clone");
    assert.equal(await region.evaluate((element) => !!element.closest(".categorize-mobile")), width < 768, "The exposed schedule must follow native body visibility");
    assert.deepEqual(await region.evaluate((element) => ({
      insideOptions: !!element.closest(".opt-group"),
      firstInBody: element.parentElement.matches(".shop_view_body") && element.parentElement.firstElementChild === element,
      rows: Array.from(element.querySelectorAll("p"), (row) => row.textContent),
    })), { insideOptions: false, firstInBody: true, rows: expectedSchedule(options) });
    assert.deepEqual(await page.evaluate(() => ({
      hidden: getComputedStyle(document.querySelector(".opt-group")).visibility,
      native: Array.from(document.querySelectorAll("._requireOption"), (option) => option.textContent),
    })), { hidden: width < 768 ? "hidden" : "visible", native: options });
    await page.evaluate(() => document.dispatchEvent(new Event("archive:shop-route-change")));
    assert.equal(await region.count(), 1, "Route reinitialization must not duplicate the schedule");
    assert(await region.isVisible());
    assert(await page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth));
    assert.equal(page.url(), "https://imweb-renewal.test/18/?idx=1");
    }
  }, { width: 320 });
});

test("renewal does not mount on admin or private internal routes", async () => {
  for (const route of ["/admin", "/_/internal"]) await withPage(route, "<h1>Untouched</h1>", async (page) => {
    assert.equal(await page.evaluate(() => document.documentElement.hasAttribute("data-ap-renewal")), false);
  });
});
