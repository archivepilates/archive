#!/usr/bin/env node

import { createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

const PROJECT_ID = "archive-pilates";
const REFERENCE_TEMPLATE_ID = "KA01TP260729144645970fv13He8mfsK";
const TEMPLATE_NAME = "아카이브 추천식단 프로그램";
const TEMPLATE_CONTENT = `#{이름}님,
ARCHIVE 추천식단 프로그램을 위한
생활·식습관 설문을 보내드립니다.

기상·취침 시간, 업무 활동량,
식사 습관과 섭취가 어려운 음식을 확인해
ARCHIVE에서 측정한 InBody 자료와 함께
맞춤 식단 구성에 참고합니다.

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

const existing = await findExistingTemplate(channelId);
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
          buttonName: "식단 설문 작성",
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
        "ARCHIVE PILATES 기존 회원이 요청한 맞춤 식단 설문 링크입니다. 광고성 내용 없이 생활·식습관 확인 목적으로 단건 발송합니다.",
    }),
  });
}
const finalTemplate = await solapiRequest(`${API_BASE}/${encodeURIComponent(current.templateId)}`);
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
    },
    null,
    2,
  ),
);

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
