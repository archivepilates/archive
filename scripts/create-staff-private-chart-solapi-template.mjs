#!/usr/bin/env node

import { createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

const PROJECT_ID = "archive-pilates";
const REFERENCE_TEMPLATE_ID = "KA01TP260527182741301uIuSTL01YQ1";
const TEMPLATE_NAME = "강사용 프라이빗 차트 작성 안내 v3";
const TEMPLATE_CONTENT = `#{강사명} 강사님,
내일 프라이빗 수업이 예정되어 있습니다.

회원: #{회원명}
회차: #{회차}회차
수업: #{수업일시}

수업 전 계획은 수업 전까지,
수업 후 기록은 수업 종료 후 작성해 주세요.

사진·영상은 회차 리포트에 바로 첨부됩니다.

감사합니다.
ARCHIVE PILATES`;
const BUTTON_URLS = [
  ["수업 전 계획 작성", "https://in.archivepilates.com/s/#{수업전계획링크ID}/"],
  ["수업 후 기록 작성", "https://in.archivepilates.com/s/#{수업후기록링크ID}/"],
  ["사진·영상 업로드", "https://in.archivepilates.com/s/#{사진영상업로드링크ID}/"],
];
const API_BASE = "https://api.solapi.com/kakao/v2/templates";

if (!process.argv.includes("--apply")) {
  console.error("Refusing to create a SOLAPI template without --apply.");
  process.exit(2);
}

const apiKey = readSecret("SOLAPI_API_KEY");
const apiSecret = readSecret("SOLAPI_API_SECRET");
const reference = await solapiRequest(`${API_BASE}/${encodeURIComponent(REFERENCE_TEMPLATE_ID)}`);
const channelId = String(reference.channelId || "").trim();
const categoryCode = String(reference.categoryCode || "004001").trim();
if (!channelId) throw new Error("Reference template channelId is missing.");

const existingSummary = await findExistingTemplate(channelId);
const existing = existingSummary
  ? await solapiRequest(`${API_BASE}/${encodeURIComponent(existingSummary.templateId)}`)
  : null;
if (existing) assertTemplateContract(existing, channelId);
const created =
  existing ||
  (await solapiRequest(API_BASE, {
    method: "POST",
    body: JSON.stringify({
      channelId,
      name: TEMPLATE_NAME,
      content: TEMPLATE_CONTENT,
      categoryCode,
      buttons: BUTTON_URLS.map(([buttonName, url]) => ({
        buttonType: "WL",
        buttonName,
        linkMo: url,
        linkPc: url,
        targetOut: false,
      })),
      quickReplies: [],
      messageType: "BA",
      emphasizeType: "NONE",
      securityFlag: false,
    }),
  }));

let current = created;
if (String(current.status || "").toUpperCase() === "PENDING") {
  current = await solapiRequest(`${API_BASE}/${encodeURIComponent(current.templateId)}/inspection`, {
    method: "PUT",
    body: JSON.stringify({
      comment:
        "ARCHIVE PILATES 프라이빗 수업 담당 강사에게 수업 전 계획, 수업 후 기록, 사진·영상 업로드 링크를 안내합니다.",
    }),
  });
}

const finalTemplate = await solapiRequest(`${API_BASE}/${encodeURIComponent(current.templateId)}`);
assertTemplateContract(finalTemplate, channelId);
console.log(
  JSON.stringify(
    {
      templateId: finalTemplate.templateId,
      name: finalTemplate.name,
      status: finalTemplate.status,
      channelId: finalTemplate.channelId,
      buttons: finalTemplate.buttons,
      reused: Boolean(existing),
      firebaseRuntimeEnv: `STAFF_PRIVATE_CHART_ALIMTALK_TEMPLATE_ID=${finalTemplate.templateId}`,
    },
    null,
    2,
  ),
);

function assertTemplateContract(template, expectedChannelId) {
  const issues = [];
  if (String(template.channelId || "") !== expectedChannelId) issues.push("channelId mismatch");
  if (String(template.content || "").trim() !== TEMPLATE_CONTENT.trim()) issues.push("content mismatch");
  if (/Notion/i.test(String(template.content || ""))) issues.push("legacy Notion copy remains");
  const urls = (template.buttons || [])
    .flatMap((button) => [button.linkMo, button.linkPc])
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  for (const [, url] of BUTTON_URLS) {
    if (!urls.includes(url)) issues.push(`button URL missing: ${url}`);
  }
  if (issues.length) throw new Error(`Existing SOLAPI template contract mismatch: ${issues.join(", ")}`);
}

async function findExistingTemplate(channelId) {
  const query = new URLSearchParams({ channelId, limit: "100" });
  const result = await solapiRequest(`${API_BASE}?${query}`);
  const rows = Array.isArray(result)
    ? result
    : result.templateList || result.templates || result.list || result.items || [];
  return (
    rows.find(
      (item) =>
        String(item.name || "").trim() === TEMPLATE_NAME &&
        !item.isDeleted &&
        String(item.channelId || channelId) === channelId,
    ) || null
  );
}

async function solapiRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`SOLAPI ${response.status}: ${body.errorMessage || body.message || JSON.stringify(body)}`);
  }
  return body;
}

function authHeader() {
  const date = new Date().toISOString();
  const salt = randomBytes(16).toString("hex");
  const signature = createHmac("sha256", apiSecret)
    .update(date + salt)
    .digest("hex");
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

function readSecret(name) {
  return execFileSync(
    "gcloud",
    ["secrets", "versions", "access", "latest", `--secret=${name}`, `--project=${PROJECT_ID}`],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  ).trim();
}
