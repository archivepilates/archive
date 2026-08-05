#!/usr/bin/env node

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const archiveInRoot = path.join(repoRoot, "archivein");
const outputDir = "/tmp/recommended-meal-survey-qa";
const viewports = [
  { name: "mobile-320", width: 320, height: 860 },
  { name: "mobile-390", width: 390, height: 844 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1440", width: 1440, height: 1000 },
];
const requestId = "meal-2026-07-28-1234567890abcdef";
const token = "a".repeat(48);

fs.mkdirSync(outputDir, { recursive: true });
const server = await startServer();
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const failures = [];

try {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport });
    await page.goto(`${baseUrl}/recommendedMealSurvey/?id=${requestId}&token=${token}`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("heading", { name: "추천식단 프로그램" }).waitFor();
    await page.getByRole("button", { name: "설문 제출하기" }).waitFor();
    const check = await page.evaluate(() => {
      const width = document.documentElement.clientWidth;
      const documentWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
      const submit = document.querySelector(".submit-button");
      const options = [...document.querySelectorAll(".option")];
      const fieldLabels = [...document.querySelectorAll(".field > span, fieldset legend")];
      const overflowingFields = [...document.querySelectorAll("input, select, textarea, fieldset, .section, .option, .notice, .consent")].filter(
        (element) => element.scrollWidth > element.clientWidth + 1,
      ).length;
      return {
        width,
        documentWidth,
        horizontalOverflow: documentWidth > width + 1,
        submitHeight: submit ? Math.round(submit.getBoundingClientRect().height) : 0,
        minimumOptionHeight: options.length
          ? Math.min(...options.map((option) => Math.round(option.getBoundingClientRect().height)))
          : 0,
        minimumFieldLabelFontSize: fieldLabels.length
          ? Math.min(...fieldLabels.map((label) => Number.parseFloat(getComputedStyle(label).fontSize)))
          : 0,
        overflowingFields,
      };
    });
    if (check.horizontalOverflow) failures.push(`${viewport.name}: horizontal overflow`);
    if (check.submitHeight < 44) failures.push(`${viewport.name}: submit target below 44px`);
    if (check.minimumOptionHeight < 44) failures.push(`${viewport.name}: option target below 44px`);
    if (check.minimumFieldLabelFontSize < 15) failures.push(`${viewport.name}: field label below 15px`);
    if (check.overflowingFields) failures.push(`${viewport.name}: ${check.overflowingFields} fields overflow`);
    await page.screenshot({ path: path.join(outputDir, `${viewport.name}-viewport.png`) });
    await page.screenshot({ path: path.join(outputDir, `${viewport.name}.png`), fullPage: true });
    await page.close();
  }

  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${baseUrl}/recommendedMealSurvey/?id=${requestId}&token=${token}`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByLabel("체지방 감량").check();
  await page.getByLabel("평소 기상 시간").fill("07:00");
  await page.getByLabel("평소 취침 시간").fill("23:30");
  await page.getByLabel("충분하고 규칙적").check();
  await page.getByLabel("평소 업무 형태").selectOption({ label: "주로 앉아서 근무" });
  await page.getByRole("group", { name: "업무 중 활동 강도" }).getByLabel("보통").check();
  await page.getByLabel("하루 식사 횟수").selectOption({ label: "3회" });
  await page.getByLabel("아침 식사").selectOption({ label: "거의 매일 먹음" });
  await page.getByLabel("야식 빈도").selectOption({ label: "거의 없음" });
  await page.getByLabel("외식·배달 빈도").selectOption({ label: "주 1회 이하" });
  await page.getByLabel("식사 준비 환경").selectOption({ label: "직접 조리 가능" });
  await page.getByRole("group", { name: "알레르기가 있나요?" }).getByLabel("없음").check();
  await page.getByLabel("알레르기, 의사에게 제한받은 음식, 못 먹는 음식을 적어주세요").fill("없음");
  await page.getByLabel("음주 빈도").selectOption({ label: "마시지 않음" });
  await page.getByLabel("흡연 여부").selectOption({ label: "비흡연" });
  await page.getByLabel("진단받은 질환 또는 식사 관련 주의사항").fill("없음");
  await page.getByLabel("현재 복용 중인 약물이나 보충제").fill("없음");
  await page.getByRole("group", { name: "임신·수유 관련 해당 사항" }).getByLabel("해당 없음").check();
  await page.getByRole("group", { name: "섭식장애 또는 식사 관련 치료 경험이 있나요?" }).getByLabel("없음").check();
  await page.getByLabel(/추천식단 준비를 위해.*활용하는 데 동의합니다/).check();
  await page.getByRole("button", { name: "설문 제출하기" }).click();
  await page.getByText("설문 제출이 완료되었습니다.").waitFor();
  await page.close();
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures, outputDir }, null, 2));
  process.exit(1);
}
console.log(
  JSON.stringify(
    {
      ok: true,
      viewports: viewports.map((viewport) => `${viewport.width}x${viewport.height}`),
      submission: "passed",
      outputDir,
    },
    null,
    2,
  ),
);

async function startServer() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || "/", "http://localhost");
    if (url.pathname === "/api/recommendedMealSurvey") {
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      if (request.method === "GET") {
        response.end(
          JSON.stringify({
            ok: true,
            requestId,
            memberName: "김기효",
            status: "sent",
            inbodyStatus: "available",
            inbodyMeasuredAt: "2026-07-20T02:00:00.000Z",
          }),
        );
        return;
      }
      if (request.method === "POST") {
        response.end(JSON.stringify({ ok: true, status: "submitted" }));
        return;
      }
    }
    const requestPath = decodeURIComponent(url.pathname);
    const normalized = path.normalize(requestPath).replace(/^(\.\.(\/|\\|$))+/, "");
    let filePath = path.join(archiveInRoot, normalized);
    if (requestPath.endsWith("/")) filePath = path.join(filePath, "index.html");
    if (!filePath.startsWith(archiveInRoot) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
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
  if (extension === ".png") return "image/png";
  return "application/octet-stream";
}
