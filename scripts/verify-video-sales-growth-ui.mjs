import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUTPUT = path.join(ROOT, "artifacts/video-sales-growth-ui");
const moduleRoot =
  process.env.ARCHIVE_NODE_MODULES ||
  path.join(ROOT, "node_modules");
const require = createRequire(path.join(moduleRoot, "__archive-video-sales-verifier__.cjs"));
const { chromium } = require("playwright");
const fixtureImage =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
const asset = fs.readFileSync(
  path.join(ROOT, "official-home/assets/imweb-video-sales-20260730b.js"),
  "utf8"
);

const products = [
  [80, "AR5", "리포머 골반·고관절"],
  [79, "AB9", "바렐 골반·고관절"],
  [51, "ACA5", "캐딜락 호흡"],
  [50, "ACH8", "체어 호흡"],
  [49, "AB8", "바렐 순환"],
  [48, "AB4", "바렐 전신 근막 FLOW"],
  [47, "AR4", "리포머 순환"],
  [46, "AB1", "바렐 척추 신장 & 흉곽 안정화"],
  [45, "AB5", "바렐 크로스패턴"],
  [44, "ACH3", "체어 정렬 인지 & 체간 안정화"],
  [43, "ACH4", "체어 골반 안정화 & 비대칭 교정"],
  [42, "ACH1", "체어 골반 & 체간 안정화"],
  [41, "AB2", "바렐 척추 신장 & 복부 컨트롤"],
  [40, "ACH2", "체어 림프 순환 & 척추 컨트롤"],
  [39, "AB3", "바렐 척추 유연성 & 어깨 안정화"],
  [38, "ACA1", "캐딜락 보상패턴 바로잡기"],
  [37, "ACA3", "캐딜락 고강도 필라테스"],
  [36, "ACA2", "캐딜락 경추보호 코어강화"],
  [35, "ACH5", "체어 고강도 필라테스"],
  [34, "AR2-1", "리포머 챌린지 동작 빌드업"],
  [33, "ACH6", "체어 직장인 증후군"],
  [32, "AB6", "바렐 직장인 증후군"],
  [31, "AR3", "리포머 요추안정화"],
  [30, "AB7", "바렐 요추안정화"],
  [29, "ACA4", "캐딜락 흉추가동성"],
  [28, "ACH7", "체어 흉추가동성"],
  [27, "AR1", "리포머 척추 정렬 & 코어 컨트롤"]
];

function fixture(pathname) {
  const classroom =
    pathname === "/48"
      ? `<main><section class="apc"><div class="apc-grid">
          <a class="apc-card" href="/archive-method-watch-aca5"><span class="apc-code">ACA5</span><strong>캐딜락 호흡</strong></a>
        </div></section></main>`
      : "";
  const listing =
    pathname === "/17"
      ? `<main>
          <section class="ap-listing-intro" data-ap-listing-intro="video">
            <p>ARCHIVE METHOD</p><h1>영상구매</h1>
          </section>
          <div class="shop-grid"><div class="thumb-row">
            ${products
              .map(
                ([idx, code, title]) =>
                  `<article class="shop-item _shop_item" data-product-properties='${JSON.stringify({
                    idx,
                    code,
                    name: `[온라인] ARCHIVE METHOD ${title} (${code}) 40D 이용권`,
                    price: 15000,
                    image_url: fixtureImage
                  })}'>
                    <a href="/17/?idx=${idx}"><img src="${fixtureImage}" alt=""></a>
                    <a href="/17/?idx=${idx}"><h2>${title}</h2><p>15,000원</p></a>
                  </article>`
              )
              .join("")}
          </div></div>
        </main>`
      : "";
  return `<!doctype html>
    <html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>
      *{box-sizing:border-box}body{margin:0;background:#faf8f5;font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif;color:#181614}
      main{padding:32px 0}.ap-listing-intro{width:min(1250px,calc(100% - 36px));margin:0 auto 24px}.ap-listing-intro h1{font-size:34px;margin:4px 0}
      .shop-grid{width:min(1250px,calc(100% - 36px));margin:0 auto}.thumb-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
      .shop-item{min-width:0}.shop-item img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover}.shop-item a{color:inherit;text-decoration:none}.shop-item h2{font-size:16px;line-height:1.45}
      .apc{max-width:1080px;margin:0 auto;padding:80px 18px}.apc-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.apc-card{padding:20px;border:1px solid #ded5cb;background:#fff;color:#181614;text-decoration:none}
      @media(max-width:760px){.thumb-row{grid-template-columns:repeat(2,minmax(0,1fr))}.apc-grid{grid-template-columns:1fr}}
    </style>
    <script>window.apArchiveTrack=function(){};</script></head><body>${listing}${classroom}<script src="/asset.js"></script></body></html>`;
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  if (url.pathname === "/asset.js") {
    response.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
    response.end(asset);
    return;
  }
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(fixture(url.pathname));
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Fixture server did not start.");
const base = `http://127.0.0.1:${address.port}`;
fs.mkdirSync(OUTPUT, { recursive: true });

const chromeExecutable =
  process.env.CHROME_EXECUTABLE ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({
  headless: true,
  ...(fs.existsSync(chromeExecutable) ? { executablePath: chromeExecutable } : {})
});
try {
  for (const width of [320, 390, 768, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: width < 760 ? 900 : 1000 } });
    await page.goto(`${base}/17`, { waitUntil: "domcontentloaded" });
    await page
      .getByRole("heading", { name: "처음이라면 이 세 편부터", exact: true })
      .waitFor({ state: "visible" });
    const best = page.getByRole("link", { name: /BEST 0[1-3]/ });
    if ((await best.count()) !== 3) throw new Error(`${width}px: expected three best links`);
    const firstBest = best.nth(0);
    if (!(await firstBest.getAttribute("href"))?.includes("idx=44")) {
      throw new Error(`${width}px: BEST 01 must link to ACH3 product 44`);
    }
    if (!(await firstBest.innerText()).includes("체어 정렬 인지 & 체간 안정화")) {
      throw new Error(`${width}px: BEST 01 must display the ACH3 title`);
    }
    const result = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      routeCount: document.querySelectorAll(".ap-video-sales__route").length,
      touchTargets: Array.from(
        document.querySelectorAll(".ap-video-sales__route-links a")
      ).every((element) => element.getBoundingClientRect().height >= 44)
    }));
    if (result.overflow > 1) throw new Error(`${width}px: horizontal overflow ${result.overflow}px`);
    if (result.routeCount !== 4) throw new Error(`${width}px: expected four topic routes`);
    if (!result.touchTargets) throw new Error(`${width}px: topic link touch target is under 44px`);
    await page.screenshot({
      path: path.join(OUTPUT, `video-list-${width}.png`),
      fullPage: true
    });
    await page.close();
  }

  const classroomPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await classroomPage.goto(`${base}/48`, { waitUntil: "domcontentloaded" });
  await classroomPage
    .getByRole("heading", {
      name: "다음 추천 · 체어 정렬 인지 & 체간 안정화",
      exact: true
    })
    .waitFor({ state: "visible" });
  const recommendation = classroomPage.getByRole("link", {
    name: "추천 영상 보기",
    exact: true
  });
  if ((await recommendation.count()) !== 1) {
    throw new Error("My Classroom expected exactly one recommendation.");
  }
  if (!(await recommendation.getAttribute("href"))?.includes("idx=44")) {
    throw new Error("My Classroom recommendation must link to ACH3 product 44.");
  }
  await classroomPage.screenshot({
    path: path.join(OUTPUT, "classroom-next-390.png"),
    fullPage: true
  });
  await classroomPage.close();
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

console.log(`Verified video sales UI. Screenshots: ${OUTPUT}`);
