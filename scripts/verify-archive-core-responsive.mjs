#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const coreRoot = path.join(repoRoot, "core");
const requestedBaseUrl = process.env.ARCHIVE_CORE_BASE_URL?.replace(/\/+$/, "");
const outputDir = process.env.ARCHIVE_CORE_QA_DIR || "/tmp/archive-core-responsive";
const viewports = [
  { name: "mobile-320", width: 320, height: 860 },
  { name: "mobile-390", width: 390, height: 844 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1440", width: 1440, height: 1000 },
  { name: "desktop-1920", width: 1920, height: 1000 },
];
const routes = [
  { name: "home", path: "/" },
  { name: "members", path: "/members/" },
  { name: "lessons", path: "/lessons/" },
  { name: "private", path: "/private/" },
  { name: "staff", path: "/staff/" },
  { name: "recommended-meals", path: "/recommended-meals/" },
  { name: "refunds", path: "/refunds/" },
  { name: "messages", path: "/messages/" },
  { name: "content", path: "/content/" },
  { name: "automation", path: "/automation/" },
  { name: "business", path: "/business/" },
  { name: "imports", path: "/imports/" },
  { name: "rules", path: "/rules/" },
  { name: "settings", path: "/settings/" },
];

fs.mkdirSync(outputDir, { recursive: true });
const localServer = requestedBaseUrl ? null : await startStaticServer();
const baseUrl = requestedBaseUrl || `http://127.0.0.1:${localServer.address().port}`;
const browser = await chromium.launch({ headless: true });
const failures = [];
const results = [];

try {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport });
    for (const route of routes) {
      const url = `${baseUrl}${route.path}`;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForSelector(".shell", { state: "visible", timeout: 10_000 });
      await page.evaluate(() => {
        const style = document.createElement("style");
        style.dataset.archiveCoreQa = "login-gate";
        style.textContent = ".login-gate{display:none!important}";
        document.head.appendChild(style);
        document.querySelectorAll(".login-gate").forEach((element) => element.remove());
      });
      if (route.name === "home") {
        await page.evaluate(() => {
          const panel = document.querySelector("#renewalPipeline");
          const list = document.querySelector("#renewalPipelineList");
          if (panel) panel.open = true;
          if (list) {
            list.innerHTML = `
              <article class="status-row renewal-row warning">
                <div>
                  <strong><a class="renewal-member-link" href="#">긴이름재등록테스트회원</a><small>010-1234-5678</small></strong>
                  <p>잔여 3회 · 매우 긴 프라이빗 수강권 이름 · 주 2.5회 · 예상 소진 2026-08-14 · 다음 예약 2026-08-03 · 프라이빗 30회 중심 상담</p>
                  <div class="renewal-actions">
                    <button type="button" data-renewal-action="contacted">연락완료</button><button type="button" data-renewal-action="considering">고민중</button><button type="button" data-renewal-action="snoozed">7일 후</button><button type="button" data-renewal-action="resolved">재등록완료</button><button type="button" data-renewal-action="excluded">재등록 의사 없음</button>
                  </div>
                </div>
                <span class="pill reviewing">확인</span>
              </article>`;
          }
        });
      }
      if (route.name === "recommended-meals") {
        await page.evaluate(() => {
          const reviewBody = document.querySelector("#mealReviewBody");
          const reviewEmpty = document.querySelector("#mealReviewEmpty");
          const draftForm = document.querySelector("#mealDraftForm");
          const inbody = document.querySelector("#mealInbodySummary");
          const survey = document.querySelector("#mealSurveySummary");
          const days = document.querySelector("#mealDaysEditor");
          if (reviewEmpty) reviewEmpty.hidden = true;
          if (reviewBody) reviewBody.hidden = false;
          if (draftForm) draftForm.hidden = false;
          if (inbody) inbody.innerHTML = '<dl class="meal-source-list"><div><dt>체중</dt><dd>검토용 데이터</dd></div><div><dt>체지방률</dt><dd>긴 설명이 있어도 영역을 침범하지 않는지 확인합니다.</dd></div></dl>';
          if (survey) survey.innerHTML = '<dl class="meal-answer-list"><div><dt>생활 패턴</dt><dd>업무 시간과 운동 일정을 함께 반영한 검토용 답변입니다.</dd></div><div><dt>제외 음식</dt><dd>알레르기 및 선호 정보를 확인합니다.</dd></div></dl>';
          if (days) {
            days.innerHTML = Array.from({ length: 2 }, (_, index) => `<fieldset class="meal-day-editor" data-meal-day="${index}"><legend>${index + 1}일차</legend><label><span>아침</span><textarea rows="2">단백질과 채소 중심 식사</textarea></label><label><span>점심</span><textarea rows="2">일정에 맞춘 균형 식사</textarea></label></fieldset>`).join("");
          }
        });
      }
      if (route.name === "refunds") {
        await page.evaluate(() => {
          const memberCandidates = document.querySelector("#refundMemberCandidates");
          const memberSummary = document.querySelector("#refundMemberSummary");
          const ticketList = document.querySelector("#refundTicketList");
          const calculationPanel = document.querySelector("#refundCalculationPanel");
          const result = document.querySelector("#refundResult");
          const sendPanel = document.querySelector("#refundSendPanel");
          if (memberCandidates) {
            memberCandidates.hidden = false;
            memberCandidates.innerHTML = '<legend>회원 후보를 선택하세요</legend><button class="refund-candidate-option" type="button"><span><strong>동명이인반응형검증회원</strong><small>010-****-5678</small></span><span><small>활성 수강권 2개</small><small>원천 갱신 2026.08.20</small></span><span class="pill">회원 선택</span></button>';
          }
          if (memberSummary) {
            memberSummary.hidden = false;
            memberSummary.innerHTML = "<strong>반응형검증회원 · 010-****-5678</strong><span>보유 수강권 1개 · 원천 2026.08.20</span>";
          }
          if (ticketList) {
            ticketList.hidden = false;
            ticketList.innerHTML = '<legend>환불할 수강권</legend><label class="refund-ticket-option"><input type="radio" checked><span><strong>아주 긴 이름의 프라이빗 30회 수강권 반응형 검증</strong><small>잔여 17 / 총 30 · 사용 13 · 2026.12.31</small></span><span class="pill success">1,650,000원</span></label>';
          }
          if (calculationPanel) calculationPanel.hidden = false;
          if (result) result.hidden = false;
          if (sendPanel) sendPanel.hidden = false;
          const values = {
            refundResultPaid: "1,650,000원",
            refundResultBalance: "935,000원",
            refundResultPenalty: "165,000원",
            refundResultUsed: "715,000원",
            refundResultAmount: "770,000원",
            refundFormula: "산정식 · 1,650,000원 - 위약금 165,000원 - 사용금액 715,000원",
          };
          for (const [id, text] of Object.entries(values)) {
            const element = document.querySelector(`#${id}`);
            if (element) element.textContent = text;
          }
          const periodSummaries = {
            refundPeriodRange: "2026.08.01 - 2026.10.31",
            refundPeriodRemaining: "72일",
            refundPeriodUsage: "잔여 4.57주 / 총 10주 · 사용 5.43주",
          };
          for (const [id, text] of Object.entries(periodSummaries)) {
            const element = document.querySelector(`#${id}`);
            if (element) element.textContent = text;
          }
          const message = document.querySelector("#refundMessage");
          if (message) message.value = "긴 회원 안내 문장이 모바일에서도 잘리지 않고 여러 줄로 표시되는지 확인합니다.";
        });
      }
      await page.evaluate(() => document.fonts?.ready);

      const check = await page.evaluate(() => {
        const documentWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
        const viewportWidth = document.documentElement.clientWidth;
        const metricCards = [...document.querySelectorAll(".kpis > .metric")].slice(0, 4);
        const metricHeights = metricCards.map((element) => Math.round(element.getBoundingClientRect().height));
        const metricContentOverflow = metricCards.some(
          (element) => element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1,
        );
        const metricValues = metricCards
          .map((element) => element.querySelector(".metric-value"))
          .filter(Boolean)
          .map((element) => ({
            text: element.textContent?.trim() || "",
            clippedX: element.scrollWidth > element.clientWidth + 1,
            clippedY: element.scrollHeight > element.clientHeight + 1,
          }));
        const touchTargets = [
          ...document.querySelectorAll(
            ".nav a, .nav-more-button, .quick-action, .external-tool-link, .filter-button, .text-link, .reference-toggle, a.rank-row, .rank-link, .primary-action, .secondary-action, .renewal-actions button, .refund-candidate-option",
          ),
        ]
          .filter((element) => element.offsetParent !== null)
          .map((element) => Math.round(element.getBoundingClientRect().height));
        const navOutsideViewport = [...document.querySelectorAll(".nav a, .nav-more-button")].some((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left < -1 || rect.right > viewportWidth + 1;
        });
        const mealPanel = document.querySelector(".meal-queue-panel");
        const mealHeader = mealPanel?.querySelector(".panel-header");
        const mealFilter = mealPanel?.querySelector(".filter-bar");
        const mealList = mealPanel?.querySelector(".meal-queue");
        const mealHeaderContent = mealHeader?.firstElementChild;
        const mealFilterContent = mealFilter?.firstElementChild;
        const mealListContent = mealList?.firstElementChild;
        const mealTextareas = [...document.querySelectorAll(".meal-draft-form textarea")];
        const mealLayout = mealPanel
          ? {
              filterAligned:
                Math.abs((mealHeaderContent?.getBoundingClientRect().left || 0) - (mealFilterContent?.getBoundingClientRect().left || 0)) <= 1,
              listAligned:
                Math.abs((mealHeaderContent?.getBoundingClientRect().left || 0) - (mealListContent?.getBoundingClientRect().left || 0)) <= 1,
              editorPadding: mealTextareas.every((element) => Number.parseFloat(getComputedStyle(element).paddingLeft) >= 10),
            }
          : null;
        return {
          documentWidth,
          viewportWidth,
          horizontalOverflow: documentWidth > viewportWidth + 1,
          metricHeights,
          metricHeightMismatch:
            metricHeights.length > 1 && Math.max(...metricHeights) - Math.min(...metricHeights) > 2,
          metricContentOverflow,
          metricValues,
          navOutsideViewport,
          shortTouchTarget: touchTargets.some((height) => height < 44),
          mealLayout,
        };
      });

      const routeFailures = [];
      if (check.horizontalOverflow) routeFailures.push(`horizontal overflow ${check.documentWidth}px > ${check.viewportWidth}px`);
      if (check.metricHeightMismatch) routeFailures.push(`KPI heights differ: ${check.metricHeights.join(", ")}`);
      if (check.metricContentOverflow) routeFailures.push("KPI card content overflows its fixed track");
      if (check.metricValues.some((item) => item.clippedX || item.clippedY)) routeFailures.push("KPI value text is clipped");
      if (check.navOutsideViewport) routeFailures.push("navigation extends outside viewport");
      if (check.shortTouchTarget) routeFailures.push("interactive target below 44px");
      if (check.mealLayout && (!check.mealLayout.filterAligned || !check.mealLayout.listAligned)) {
        routeFailures.push("recommended-meal panel content is not aligned with its header");
      }
      if (check.mealLayout && !check.mealLayout.editorPadding) routeFailures.push("recommended-meal editor text touches its control border");

      const screenshot = path.join(outputDir, `${route.name}-${viewport.name}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      results.push({ route: route.name, viewport: viewport.name, screenshot, ...check });
      for (const failure of routeFailures) failures.push(`${route.name}/${viewport.name}: ${failure}`);

      if (route.name === "refunds") {
        const periodCheck = await exposeRefundPeriodFields(page);
        const periodScreenshot = path.join(outputDir, `refunds-period-${viewport.name}.png`);
        await page.screenshot({ path: periodScreenshot, fullPage: true });
        results.push({ route: "refunds-period", viewport: viewport.name, screenshot: periodScreenshot, ...periodCheck });
        if (periodCheck.horizontalOverflow) {
          failures.push(`refunds-period/${viewport.name}: horizontal overflow ${periodCheck.documentWidth}px > ${periodCheck.viewportWidth}px`);
        }
        if (periodCheck.shortTouchTarget) failures.push(`refunds-period/${viewport.name}: interactive target below 44px`);
        if (!periodCheck.allSourceValuesVisible) {
          failures.push(`refunds-period/${viewport.name}: compact automatic period summaries are clipped or incomplete`);
        }
        if (viewport.width >= 1200) {
          if (!periodCheck.workspaceCentered) failures.push(`refunds-period/${viewport.name}: refund workspace is not centered in the main content area`);
          if (periodCheck.workspaceWidth > periodCheck.workspaceMaxWidth + 1) {
            failures.push(`refunds-period/${viewport.name}: refund workspace stretches to ${Math.round(periodCheck.workspaceWidth)}px`);
          }
          if (periodCheck.calculationButtonFullWidth) {
            failures.push(`refunds-period/${viewport.name}: calculation button is full-width on desktop`);
          }
        }
        if (viewport.width <= 560 && !periodCheck.calculationButtonFullWidth) {
          failures.push(`refunds-period/${viewport.name}: calculation button is not full-width on mobile`);
        }
        if (!periodCheck.calculationButtonUsable) {
          failures.push(`refunds-period/${viewport.name}: calculation button is below 44px`);
        }
      }
    }
    await page.close();
  }
} finally {
  await browser.close();
  if (localServer) await new Promise((resolve) => localServer.close(resolve));
}

if (failures.length) {
  console.error("ARCHIVE CORE responsive verification failed.");
  console.error(JSON.stringify({ baseUrl, failures, results }, null, 2));
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      baseUrl,
      checked: results.length,
      routes: routes.map((route) => route.name),
      viewports: viewports.map((viewport) => `${viewport.width}x${viewport.height}`),
      outputDir,
    },
    null,
    2,
  ),
);

async function exposeRefundPeriodFields(page) {
  await page.evaluate(() => {
    document.querySelectorAll(".login-gate").forEach((element) => element.remove());
    const countFields = document.querySelector("#refundCountFields");
    const periodFields = document.querySelector("#refundPeriodFields");
    const kind = document.querySelector("#refundTicketKind");
    if (countFields) countFields.hidden = true;
    if (periodFields) periodFields.hidden = false;
    if (kind) kind.value = "period";
    const values = {
      refundPeriodRange: "2026.08.01 - 2026.10.31",
      refundPeriodRemaining: "72일",
      refundPeriodUsage: "잔여 4.57주 / 총 10주 · 사용 5.43주",
    };
    for (const [id, value] of Object.entries(values)) {
      const element = document.querySelector(`#${id}`);
      if (element) element.textContent = value;
    }
  });
  return page.evaluate(() => {
    const documentWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    const viewportWidth = document.documentElement.clientWidth;
    const sourceSummaries = [...document.querySelectorAll("#refundPeriodFields .refund-source-summary")]
      .filter((element) => element.offsetParent !== null);
    const sourceSummaryValues = sourceSummaries.map((element) => element.querySelector("strong")?.textContent?.trim() || "");
    const calculationForm = document.querySelector("#refundCalculationForm");
    const calculationButton = document.querySelector("#refundPreviewButton");
    const calculationFormStyle = calculationForm ? getComputedStyle(calculationForm) : null;
    const calculationFormContentWidth = calculationForm && calculationFormStyle
      ? calculationForm.clientWidth - Number.parseFloat(calculationFormStyle.paddingLeft) - Number.parseFloat(calculationFormStyle.paddingRight)
      : 0;
    const calculationButtonWidth = calculationButton?.getBoundingClientRect().width || 0;
    const refundWorkspace = document.querySelector(".refund-workspace");
    const main = document.querySelector(".main");
    const workspaceRect = refundWorkspace?.getBoundingClientRect();
    const mainRect = main?.getBoundingClientRect();
    const mainStyle = main ? getComputedStyle(main) : null;
    const mainContentLeft = mainRect && mainStyle ? mainRect.left + Number.parseFloat(mainStyle.paddingLeft) : 0;
    const mainContentRight = mainRect && mainStyle
      ? mainRect.right - Number.parseFloat(mainStyle.paddingRight)
      : 0;
    const workspaceCentered = workspaceRect && mainRect
      ? Math.abs((workspaceRect.left + workspaceRect.width / 2) - (mainContentLeft + (mainContentRight - mainContentLeft) / 2)) <= 1
      : false;
    const touchTargets = [...document.querySelectorAll(".primary-action, .secondary-action, .refund-candidate-option")]
      .filter((element) => element.offsetParent !== null)
      .map((element) => Math.round(element.getBoundingClientRect().height));
    return {
      documentWidth,
      viewportWidth,
      horizontalOverflow: documentWidth > viewportWidth + 1,
      shortTouchTarget: touchTargets.some((height) => height < 44),
      sourceSummaryCount: sourceSummaries.length,
      sourceSummaryValues,
      allSourceValuesVisible:
        sourceSummaries.length === 3
        && sourceSummaryValues.every(Boolean)
        && sourceSummaries.every((element) => element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1),
      workspaceCentered,
      workspaceWidth: workspaceRect?.width || 0,
      workspaceMaxWidth: 1216,
      calculationButtonWidth,
      calculationFormContentWidth,
      calculationButtonFullWidth:
        calculationButtonWidth >= calculationFormContentWidth - 1,
      calculationButtonUsable: (calculationButton?.getBoundingClientRect().height || 0) >= 44,
    };
  });
}

async function startStaticServer() {
  const server = http.createServer((request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url || "/", "http://localhost").pathname);
    const normalized = path.normalize(requestPath).replace(/^(\.\.(\/|\\|$))+/, "");
    let filePath = path.join(coreRoot, normalized);
    if (requestPath.endsWith("/")) filePath = path.join(filePath, "index.html");
    if (!filePath.startsWith(coreRoot) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.setHeader("Content-Type", contentType(filePath));
    response.end(fs.readFileSync(filePath));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server;
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".js" || extension === ".mjs") return "text/javascript; charset=utf-8";
  if (extension === ".json" || extension === ".webmanifest") return "application/json; charset=utf-8";
  if (extension === ".png") return "image/png";
  if (extension === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}
