#!/usr/bin/env node

import { createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

const PROJECT_ID = "archive-pilates";
const REFERENCE_TEMPLATE_ID = "KA01TP260802163827071E2TTuX6CsWp";
const TEMPLATE_NAME = "아카이브 추천식단 프로그램 v2";
const SURVEY_BUTTON_URL = "https://in.archivepilates.com/s/#{링크ID}/";
const REPORT_BUTTON_URL = "https://in.archivepilates.com/s/#{리포트링크ID}/";
const API_BASE = "https://api.solapi.com/kakao/v2/templates";

if (!process.argv.includes("--apply")) {
  console.error("Refusing to create a SOLAPI template without --apply.");
  process.exit(2);
}

const apiKey = readSecret("SOLAPI_API_KEY");
const apiSecret = readSecret("SOLAPI_API_SECRET");
const reference = await solapiRequest(`${API_BASE}/${encodeURIComponent(REFERENCE_TEMPLATE_ID)}`);
if (String(reference.status || "").toUpperCase() !== "APPROVED") {
  throw new Error(`Reference template is not approved: ${reference.status || "missing"}`);
}
const channelId = String(reference.channelId || "").trim();
if (!channelId) throw new Error("Reference template channelId is missing.");

const existing = await findExistingTemplate(channelId);
const created =
  existing ||
  (await solapiRequest(API_BASE, {
    method: "POST",
    body: JSON.stringify({
      channelId,
      name: TEMPLATE_NAME,
      content: reference.content,
      categoryCode: reference.categoryCode,
      buttons: [
        {
          buttonType: "WL",
          buttonName: "식단 설문 작성",
          linkMo: SURVEY_BUTTON_URL,
          linkPc: SURVEY_BUTTON_URL,
          targetOut: false,
        },
        {
          buttonType: "WL",
          buttonName: "추천식단 확인",
          linkMo: REPORT_BUTTON_URL,
          linkPc: REPORT_BUTTON_URL,
          targetOut: false,
        },
      ],
      quickReplies: [],
      messageType: "BA",
      emphasizeType: "IMAGE",
      imageId: reference.imageId,
      securityFlag: Boolean(reference.securityFlag),
    }),
  }));

let current = created;
if (["PENDING", "REJECTED"].includes(String(current.status || "").toUpperCase())) {
  current = await solapiRequest(`${API_BASE}/${encodeURIComponent(current.templateId)}/inspection`, {
    method: "PUT",
    body: JSON.stringify({
      comment:
        "ARCHIVE PILATES 기존 회원에게 단건 발송하는 맞춤 식단 프로그램 안내입니다. 첫 버튼은 생활·식습관 설문, 두 번째 버튼은 같은 요청에서 운영자 검토 후 공개되는 추천식단 리포트 확인용입니다. 별도 도착 알림톡을 보내지 않습니다.",
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
      messageType: finalTemplate.messageType,
      emphasizeType: finalTemplate.emphasizeType,
      imageId: finalTemplate.imageId,
      buttons: finalTemplate.buttons,
      reused: Boolean(existing),
    },
    null,
    2,
  ),
);

async function findExistingTemplate(expectedChannelId) {
  const query = new URLSearchParams({ channelId: expectedChannelId, limit: "100" });
  const result = await solapiRequest(`${API_BASE}?${query}`);
  const rows = Array.isArray(result)
    ? result
    : result.templateList || result.templates || result.list || result.items || [];
  return rows.find(
    (item) =>
      String(item.name || "").trim() === TEMPLATE_NAME &&
      !item.isDeleted &&
      String(item.channelId || expectedChannelId) === expectedChannelId,
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
  const signature = createHmac("sha256", apiSecret).update(date + salt).digest("hex");
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

function readSecret(name) {
  return execFileSync(
    "gcloud",
    ["secrets", "versions", "access", "latest", `--secret=${name}`, `--project=${PROJECT_ID}`],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  ).trim();
}
