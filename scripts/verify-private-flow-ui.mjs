#!/usr/bin/env node

import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const submissions = [];
let postSubmitted = false;
let reportStatus = "draft_created";

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname === "/archivein/api/privateSurveySubmit") {
      if (request.method === "POST") {
        const body = await jsonBody(request);
        submissions.push({ kind: "member-intake", body });
        return json(response, 200, { ok: true, duplicate: false });
      }
      return json(response, 200, {
        ok: true,
        status: "pending",
        memberName: "테스트 회원",
        memberPhone: "010-0000-0000",
        lessonTime: "2026. 7. 30. 오전 10:00",
        staffName: "테스트 강사",
      });
    }

    if (url.pathname === "/archivein/api/privateChart") {
      if (request.method === "POST") {
        const body = await jsonBody(request);
        submissions.push({ kind: `staff-${body.mode || body.action || "action"}`, body });
        if (body.mode === "post") postSubmitted = true;
        if (body.action === "approveReport") reportStatus = "queued";
        return json(response, 200, { ok: true });
      }
      if (url.searchParams.get("view") === "today") {
        return json(response, 200, dailyPrivateChartPayload());
      }
      return json(response, 200, privateChartPayload());
    }

    if (url.pathname === "/archivein/privateSurvey/" || url.pathname === "/archivein/privateSurvey/index.html") {
      return html(response, await fs.readFile(path.join(repoRoot, "archivein/privateSurvey/index.html")));
    }
    if (url.pathname === "/archivein/private-chart/" || url.pathname === "/archivein/private-chart/index.html") {
      return html(response, await fs.readFile(path.join(repoRoot, "archivein/private-chart/index.html")));
    }
    if (url.pathname === "/archivein/test-report") {
      return html(response, Buffer.from("<!doctype html><html lang=\"ko\"><body><main><h1>테스트 회원 리포트</h1></main></body></html>"));
    }
    response.writeHead(404).end("Not found");
  } catch (error) {
    json(response, 500, { ok: false, error: error.message || String(error) });
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Failed to start UI fixture server.");
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });

try {
  const results = [];
  for (const viewport of [
    { width: 320, height: 720 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    const page = await browser.newPage({ viewport });
    await page.goto(
      `${origin}/archivein/privateSurvey/?id=psr-abcdefgh&token=abcdefabcdefabcdefabcdefabcdefab`,
      { waitUntil: "networkidle" },
    );
    await page.locator("#surveyForm").waitFor({ state: "visible" });
    await assertNoHorizontalOverflow(page, `member survey ${viewport.width}px`);
    results.push({ surface: "member-intake", width: viewport.width, overflow: false });
    await page.close();

    const chartPage = await browser.newPage({ viewport });
    await chartPage.goto(
      `${origin}/archivein/private-chart/?r=plc-ui-test&t=abcdefabcdefabcdefabcdefabcdefab&mode=pre`,
      { waitUntil: "networkidle" },
    );
    await chartPage.locator("#form").waitFor({ state: "visible" });
    await assertVisibleText(chartPage, "프라이빗 오늘 기록");
    await assertNoHorizontalOverflow(chartPage, `staff post-only ${viewport.width}px`);
    await chartPage.locator("#mediaFiles").waitFor({ state: "attached" });
    results.push({ surface: "staff-post-only", width: viewport.width, overflow: false });
    await chartPage.close();

    const dailyPage = await browser.newPage({ viewport });
    await dailyPage.goto(
      `${origin}/archivein/private-chart/?r=plc-ui-test&t=abcdefabcdefabcdefabcdefabcdefab&view=today&date=2026-07-30`,
      { waitUntil: "networkidle" },
    );
    await dailyPage.locator("#dailyPanel").waitFor({ state: "visible" });
    await assertVisibleText(dailyPage, "오늘의 프라이빗 기록");
    assert.match(
      await dailyPage.locator(".daily-card").getAttribute("href"),
      /[?&]focus=report(?:&|$)/,
      "review item must open the report section",
    );
    await assertNoHorizontalOverflow(dailyPage, `staff daily ${viewport.width}px`);
    results.push({ surface: "staff-daily", width: viewport.width, overflow: false });
    await dailyPage.close();
  }

  await verifyMemberSurveySubmission();
  await verifyStaffPostSubmission();

  assert.equal(submissions.filter((item) => item.kind === "member-intake").length, 1);
  assert.equal(submissions.filter((item) => item.kind === "staff-post").length, 1);
  assert.equal(submissions.filter((item) => item.kind === "staff-editReport").length, 1);
  assert.equal(submissions.filter((item) => item.kind === "staff-approveReport").length, 1);

  console.log(
    JSON.stringify(
      {
        ok: true,
        guard: "private-flow-ui",
        responsiveChecks: results,
        submittedFlows: ["member-intake", "staff-post"],
        checked: [
          "native member survey completion state",
          "legacy pre-link redirects to post-only record",
          "daily instructor record list",
          "three required post-record fields",
          "other free-text answer",
          "media picker presence",
          "record remains editable before member delivery",
          "editable report fields before send",
          "long report text wrapping",
          "320/390/768/1440px horizontal overflow",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function verifyMemberSurveySubmission() {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(
    `${origin}/archivein/privateSurvey/?id=psr-abcdefgh&token=abcdefabcdefabcdefabcdefabcdefab`,
    { waitUntil: "networkidle" },
  );
  await page.locator('input[name="experienceType"]').first().check();
  await page.locator('input[name="primaryGoal"][value="체형교정·자세 개선"]').check();
  await page.locator('input[name="focusAreas"][value="어깨"]').check();
  await page.locator('input[name="lifestyle"]').first().check();
  await page.locator('input[name="exerciseLevel"]').first().check();
  await page.locator('input[name="concern"]').first().check();
  await page.locator('input[name="referralSource"]').first().check();
  await page.getByRole("button", { name: "제출하기" }).click();
  await assertVisibleText(page, "제출이 완료되었습니다.");
  await assertNoHorizontalOverflow(page, "member survey completion");
  await page.close();
}

async function verifyStaffPostSubmission() {
  postSubmitted = false;
  reportStatus = "draft_created";
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(
    `${origin}/archivein/private-chart/?r=plc-ui-test&t=abcdefabcdefabcdefabcdefabcdefab&mode=post`,
    { waitUntil: "networkidle" },
  );
  assert.equal(
    await page.locator('[data-field-key="focusAreas"], [data-field-key="changes"], [data-field-key="nextDirection"]').count(),
    3,
    "the post-only flow must expose exactly three required record fields",
  );
  assert.equal(await page.getByText("오늘의 수업 목표", { exact: true }).count(), 0);
  await page.locator('textarea[name="nextDirection"]').fill("다음 수업에서는 고관절 안정화와 코어 연결을 이어갑니다.");
  await page.getByRole("button", { name: "기록 저장 · 리포트 확인" }).click();
  await assertVisibleText(page, "진행 부위를 선택해 주세요.");
  assert.equal(
    await page.evaluate(() => document.activeElement?.getAttribute("data-field-key")),
    "focusAreas",
    "missing required answer must focus its field group",
  );
  await page.locator('input[name="focusAreas"][value="어깨"]').check();
  await page.locator('input[name="changes"][value="기타"]').check();
  await page.locator('textarea[name="changesOther"]').fill("견갑 움직임을 편안하게 연결함");
  await page.locator('textarea[name="nextDirection"]').fill("다음 수업에서는 고관절 안정화와 코어 연결을 이어갑니다.");
  await page.getByTestId("optional-record-toggle").click();
  await page.locator('textarea[name="homework"]').fill("자기 전 3분간 흉곽 호흡");
  await page.getByRole("button", { name: "기록 저장 · 리포트 확인" }).click();
  await assertVisibleText(page, "기록을 저장했습니다. 아래 리포트를 확인해 주세요.");
  const reviseButton = page.getByRole("button", { name: "기록 수정 · 리포트 다시 확인" });
  await reviseButton.waitFor({ state: "visible" });
  assert.equal(await reviseButton.isEnabled(), true, "saved record must remain editable before member delivery");
  await page.locator("#reportSummaryEdit").waitFor({ state: "visible" });
  await page.locator("#reportNextDirectionEdit").waitFor({ state: "visible" });
  const longTextVisible = await page.locator("#reportNextDirectionEdit").evaluate((element) => {
    const value = element.value;
    return value.includes("다음 수업에서는") && element.scrollHeight >= element.clientHeight;
  });
  assert.equal(longTextVisible, true, "long next-direction text must remain accessible");
  await assertNoHorizontalOverflow(page, "staff post report review");
  await page.locator("#reportSummaryEdit").fill(
    "오늘은 흉곽 움직임과 호흡 연결을 중심으로 어깨 긴장을 줄이며 코어 연결을 확인했습니다.",
  );
  await page.getByRole("button", { name: "검토 완료 · 회원에게 발송" }).click();
  await assertVisibleText(page, "검토한 리포트를 발송 대기열에 등록했습니다.");
  const queuedButton = page.getByRole("button", { name: "발송 대기 중" });
  await queuedButton.waitFor({ state: "visible" });
  assert.equal(await queuedButton.isDisabled(), true, "queued report must not be approved twice without another edit");
  await page.close();
}

function privateChartPayload() {
  return {
    ok: true,
    mode: "post",
    memberName: "테스트 회원",
    sessionNumber: 12,
    lessonTime: "2026. 7. 30. 오전 10:00",
    staffName: "테스트 강사",
    preStatus: "pending",
    postStatus: postSubmitted ? "submitted" : "pending",
    postSubmitted,
    locked: false,
    existingAnswers: {},
    intakeSummary: {
      primaryGoal: "체형교정·자세 개선",
      focusAreas: ["어깨", "골반/고관절"],
      painNote: "오래 앉아 있으면 오른쪽 어깨가 긴장됩니다.",
    },
    previousReport: {
      sessionNumber: 11,
      lessonTime: "2026. 7. 28. 오후 7:00",
      summary: "흉곽 움직임과 호흡 연결을 편안하게 확인했습니다.",
      nextDirection: "다음 수업에서는 고관절 안정성과 코어 연결을 이어갑니다.",
      homework: "자기 전 3분 흉곽 호흡",
      url: `${origin}/archivein/test-report`,
    },
    media: {
      files: [],
      sessionFolderUrl: "https://drive.google.com/drive/folders/test",
    },
    report:
      postSubmitted
        ? {
            status: reportStatus,
            canEdit: true,
            sent: false,
            url: `${origin}/archivein/test-report`,
            canonicalUrl: `${origin}/archivein/test-report`,
            summary:
              "오늘은 흉곽 움직임과 호흡 연결을 중심으로 어깨의 불필요한 긴장을 줄이며 코어 연결을 확인했습니다.",
            nextDirection:
              "다음 수업에서는 고관절 안정성과 코어 연결을 바탕으로 움직임의 범위를 천천히 넓히고, 회원이 일상에서도 편안하게 적용할 수 있도록 충분한 설명과 반복을 이어갑니다.",
          }
        : {},
  };
}

function dailyPrivateChartPayload() {
  return {
    ok: true,
    date: "2026-07-30",
    staffName: "테스트 강사",
    total: 1,
    completed: 0,
    items: [
      {
        requestId: "plc-ui-test",
        memberName: "테스트 회원",
        sessionNumber: 12,
        lessonTime: "2026. 7. 30. 오전 10:00",
        postUrl: `${origin}/archivein/private-chart/?r=plc-ui-test&t=abcdefabcdefabcdefabcdefabcdefab&mode=post`,
        status: "review",
      },
    ],
  };
}

async function jsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function json(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function html(response, body) {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(body);
}

async function assertVisibleText(page, text) {
  await page.getByText(text, { exact: false }).waitFor({ state: "visible" });
}

async function assertNoHorizontalOverflow(page, label) {
  const widths = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  assert.ok(
    widths.scrollWidth <= widths.clientWidth + 1,
    `${label} overflows horizontally: ${widths.scrollWidth}px > ${widths.clientWidth}px`,
  );
}
