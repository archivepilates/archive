#!/usr/bin/env node

import { createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

const PROJECT_ID = "archive-pilates";
const REFERENCE_TEMPLATE_ID = "KA01TP260729144657202OV26yAD15wR";
const TEMPLATE_NAME = "강사용 프라이빗 오늘 기록 안내 v4";
const TEMPLATE_CONTENT = `#{강사명} 강사님,
#{수업일} 프라이빗 수업 기록을 안내드립니다.

오늘 수업: #{수업수}건

수업 후 아래 링크에서 회원별 기록을 작성해 주세요.
필수 항목은 진행 부위, 확인한 변화, 다음 방향입니다.

감사합니다.
ARCHIVE PILATES`;
const BUTTON_URLS = [
  ["오늘 기록 열기", "https://in.archivepilates.com/s/#{오늘기록링크ID}/"],
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
const imageContract = referenceImageContract(reference);
const templatePayload = {
  name: TEMPLATE_NAME,
  content: TEMPLATE_CONTENT,
  categoryCode,
  buttons: BUTTON_URLS.map(([buttonName, url]) => ({
    buttonType: "WL",
    buttonName,
    linkMo: url,
    linkPc: url,
    targetOut: true,
  })),
  quickReplies: [],
  messageType: imageContract.messageType,
  emphasizeType: imageContract.emphasizeType,
  imageId: imageContract.imageId,
  securityFlag: Boolean(reference.securityFlag),
};

const existingSummary = await findExistingTemplate(channelId);
const existing = existingSummary
  ? await solapiRequest(`${API_BASE}/${encodeURIComponent(existingSummary.templateId)}`)
  : null;
let current = existing;
let repaired = false;
if (current && templateContractIssues(current, channelId, imageContract).length) {
  current = await prepareTemplateForUpdate(current);
  current = await solapiRequest(`${API_BASE}/${encodeURIComponent(current.templateId)}`, {
    method: "PUT",
    body: JSON.stringify(templatePayload),
  });
  repaired = true;
}
if (!current) {
  current = await solapiRequest(API_BASE, {
    method: "POST",
    body: JSON.stringify({
      channelId,
      ...templatePayload,
    }),
  });
}

if (String(current.status || "").toUpperCase() === "PENDING") {
  current = await solapiRequest(`${API_BASE}/${encodeURIComponent(current.templateId)}/inspection`, {
    method: "PUT",
    body: JSON.stringify({
      comment:
        "ARCHIVE PILATES 프라이빗 수업 담당 강사에게 당일 수업 목록과 수업 후 기록 단일 링크를 안내합니다.",
    }),
  });
}

const finalTemplate = await solapiRequest(`${API_BASE}/${encodeURIComponent(current.templateId)}`);
assertTemplateContract(finalTemplate, channelId, imageContract);
console.log(
  JSON.stringify(
    {
      templateId: finalTemplate.templateId,
      name: finalTemplate.name,
      status: finalTemplate.status,
      channelId: finalTemplate.channelId,
      buttons: finalTemplate.buttons,
      messageType: finalTemplate.messageType,
      emphasizeType: finalTemplate.emphasizeType,
      imageId: finalTemplate.imageId,
      reused: Boolean(existing),
      repaired,
      firebaseRuntimeEnv: `STAFF_PRIVATE_CHART_ALIMTALK_TEMPLATE_ID=${finalTemplate.templateId}`,
    },
    null,
    2,
  ),
);

function assertTemplateContract(template, expectedChannelId, expectedImageContract) {
  const issues = templateContractIssues(template, expectedChannelId, expectedImageContract);
  if (issues.length) throw new Error(`Existing SOLAPI template contract mismatch: ${issues.join(", ")}`);
}

function templateContractIssues(template, expectedChannelId, expectedImageContract) {
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
  if (String(template.messageType || "").toUpperCase() !== expectedImageContract.messageType) {
    issues.push("messageType mismatch");
  }
  if (String(template.emphasizeType || "").toUpperCase() !== expectedImageContract.emphasizeType) {
    issues.push("image emphasizeType mismatch");
  }
  if (String(template.imageId || "") !== expectedImageContract.imageId) issues.push("ARCHIVE imageId mismatch");
  return issues;
}

function referenceImageContract(template) {
  const messageType = String(template.messageType || "").toUpperCase();
  const emphasizeType = String(template.emphasizeType || "").toUpperCase();
  const imageId = String(template.imageId || "").trim();
  if (messageType !== "BA" || emphasizeType !== "IMAGE" || !imageId) {
    throw new Error(
      `Reference template is not the expected ARCHIVE image template: ${messageType}/${emphasizeType}/${imageId || "missing imageId"}`,
    );
  }
  return { messageType, emphasizeType, imageId };
}

async function prepareTemplateForUpdate(template) {
  const templateId = String(template.templateId || "").trim();
  if (!templateId) throw new Error("Existing SOLAPI templateId is missing.");
  let current = template;
  const status = String(current.status || "").toUpperCase();
  if (status === "INSPECTING") {
    current = await solapiRequest(`${API_BASE}/${encodeURIComponent(templateId)}/inspection/cancel`, {
      method: "PUT",
    });
  }
  const editableStatus = String(current.status || "").toUpperCase();
  if (!["PENDING", "REJECTED"].includes(editableStatus)) {
    throw new Error(`Refusing to modify template ${templateId} in ${editableStatus || "UNKNOWN"} status.`);
  }
  return current;
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
