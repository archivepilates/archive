#!/usr/bin/env node

import { createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

const PROJECT_ID = "archive-pilates";
const REFERENCE_TEMPLATE_ID = "KA01TP260514153632171uiWXYoeiOLS";
const TEMPLATE_NAME = "프라이빗 사전설문 안내 v2";
const TEMPLATE_CONTENT = `#{이름}님,
ARCHIVE PILATES 프라이빗 수업을 준비하기 위한 사전설문입니다.

운동 목적과 현재 컨디션을 확인해
첫 수업 계획과 이후 리포트에 반영합니다.

아래 버튼에서 설문을 작성해 주세요.`;
const BUTTON_URL = "https://in.archivepilates.com/s/#{링크ID}/";
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
      buttons: [
        {
          buttonType: "WL",
          buttonName: "사전설문 작성",
          linkMo: BUTTON_URL,
          linkPc: BUTTON_URL,
          targetOut: false,
        },
      ],
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
        "ARCHIVE PILATES 프라이빗 수업 회원에게 운동 목적과 컨디션을 확인하는 자체 사전설문 링크를 안내합니다. 광고성 내용 없이 수업 준비 목적으로 1회 발송합니다.",
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
      categoryCode: finalTemplate.categoryCode,
      buttons: finalTemplate.buttons,
      reused: Boolean(existing),
      firebaseRuntimeEnv: `PRIVATE_SURVEY_ALIMTALK_TEMPLATE_ID=${finalTemplate.templateId}`,
    },
    null,
    2,
  ),
);

function assertTemplateContract(template, expectedChannelId) {
  const issues = [];
  if (String(template.channelId || "") !== expectedChannelId) issues.push("channelId mismatch");
  if (String(template.content || "").trim() !== TEMPLATE_CONTENT.trim()) issues.push("content mismatch");
  const urls = (template.buttons || [])
    .flatMap((button) => [button.linkMo, button.linkPc])
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (!urls.includes(BUTTON_URL)) issues.push("native survey button URL missing");
  if (!String(template.content || "").includes("#{이름}")) issues.push("member-name variable missing");
  if (issues.length) {
    throw new Error(`Existing SOLAPI template contract mismatch: ${issues.join(", ")}`);
  }
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
