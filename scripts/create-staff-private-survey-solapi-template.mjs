#!/usr/bin/env node

import { createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

const PROJECT_ID = "archive-pilates";
const REFERENCE_TEMPLATE_ID = "KA01TP260519093416836f1EHZYJ00uM";
const TEMPLATE_NAME = "담당강사 사전설문 제출 안내 v2";
const TEMPLATE_CONTENT = `#{강사명} 강사님,
담당 수업으로 배정된

#{회원명} 회원님의
프라이빗 사전설문이 제출되었습니다.

수업일시: #{수업일시}

수업 전 아래 링크에서
설문 내용을 확인해 주세요.`;
const BUTTON_URL = "https://in.archivepilates.com/s/#{링크ID}/";
const API_BASE = "https://api.solapi.com/kakao/v2/templates";

if (!process.argv.includes("--apply")) {
  console.error("Refusing to create a SOLAPI template without --apply.");
  process.exit(2);
}

const apiKey = readSecret("SOLAPI_API_KEY");
const apiSecret = readSecret("SOLAPI_API_SECRET");
const reference = await solapiRequest(
  `${API_BASE}/${encodeURIComponent(REFERENCE_TEMPLATE_ID)}`,
);
const channelId = String(reference.channelId || "").trim();
const categoryCode = String(reference.categoryCode || "004001").trim();
if (!channelId) throw new Error("Reference template channelId is missing.");
const imageContract = referenceImageContract(reference);
const templatePayload = {
  name: TEMPLATE_NAME,
  content: TEMPLATE_CONTENT,
  categoryCode,
  buttons: [
    {
      buttonType: "WL",
      buttonName: "설문 확인하기",
      linkMo: BUTTON_URL,
      linkPc: BUTTON_URL,
      targetOut: true,
    },
  ],
  quickReplies: [],
  messageType: imageContract.messageType,
  emphasizeType: imageContract.emphasizeType,
  imageId: imageContract.imageId,
  securityFlag: Boolean(reference.securityFlag),
};

const existingSummary = await findExistingTemplate(channelId);
const existing = existingSummary
  ? await solapiRequest(
      `${API_BASE}/${encodeURIComponent(existingSummary.templateId)}`,
    )
  : null;
let current = existing;
let repaired = false;
if (
  current &&
  templateContractIssues(current, channelId, imageContract).length
) {
  current = await prepareTemplateForUpdate(current);
  current = await solapiRequest(
    `${API_BASE}/${encodeURIComponent(current.templateId)}`,
    {
      method: "PUT",
      body: JSON.stringify(templatePayload),
    },
  );
  repaired = true;
}
if (!current) {
  current = await solapiRequest(API_BASE, {
    method: "POST",
    body: JSON.stringify({ channelId, ...templatePayload }),
  });
}

if (String(current.status || "").toUpperCase() === "PENDING") {
  current = await solapiRequest(
    `${API_BASE}/${encodeURIComponent(current.templateId)}/inspection`,
    {
      method: "PUT",
      body: JSON.stringify({
        comment:
          "ARCHIVE PILATES 프라이빗 회원이 사전설문을 제출하면 담당 강사에게 수업 준비용 설문 확인 링크를 안내합니다. 광고성 내용 없이 담당 수업 기준으로 1회 발송합니다.",
      }),
    },
  );
}

const finalTemplate = await solapiRequest(
  `${API_BASE}/${encodeURIComponent(current.templateId)}`,
);
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
      firebaseRuntimeEnv: `STAFF_PRIVATE_SURVEY_ALIMTALK_TEMPLATE_ID=${finalTemplate.templateId}`,
    },
    null,
    2,
  ),
);

function assertTemplateContract(
  template,
  expectedChannelId,
  expectedImageContract,
) {
  const issues = templateContractIssues(
    template,
    expectedChannelId,
    expectedImageContract,
  );
  if (issues.length)
    throw new Error(
      `Existing SOLAPI template contract mismatch: ${issues.join(", ")}`,
    );
}

function templateContractIssues(
  template,
  expectedChannelId,
  expectedImageContract,
) {
  const issues = [];
  if (String(template.channelId || "") !== expectedChannelId)
    issues.push("channelId mismatch");
  if (String(template.content || "").trim() !== TEMPLATE_CONTENT.trim())
    issues.push("content mismatch");
  const urls = (template.buttons || [])
    .flatMap((button) => [button.linkMo, button.linkPc])
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (!urls.includes(BUTTON_URL))
    issues.push("short-link survey detail button URL missing");
  for (const variable of [
    "#{강사명}",
    "#{회원명}",
    "#{수업일시}",
    "#{링크ID}",
  ]) {
    if (
      ![String(template.content || ""), ...urls].join("\n").includes(variable)
    ) {
      issues.push(`template variable missing: ${variable}`);
    }
  }
  if (
    String(template.messageType || "").toUpperCase() !==
    expectedImageContract.messageType
  ) {
    issues.push("messageType mismatch");
  }
  if (
    String(template.emphasizeType || "").toUpperCase() !==
    expectedImageContract.emphasizeType
  ) {
    issues.push("image emphasizeType mismatch");
  }
  if (String(template.imageId || "") !== expectedImageContract.imageId)
    issues.push("ARCHIVE imageId mismatch");
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
  let currentTemplate = template;
  if (String(currentTemplate.status || "").toUpperCase() === "INSPECTING") {
    currentTemplate = await solapiRequest(
      `${API_BASE}/${encodeURIComponent(templateId)}/inspection/cancel`,
      {
        method: "PUT",
      },
    );
  }
  const editableStatus = String(currentTemplate.status || "").toUpperCase();
  if (!["PENDING", "REJECTED"].includes(editableStatus)) {
    throw new Error(
      `Refusing to modify template ${templateId} in ${editableStatus || "UNKNOWN"} status.`,
    );
  }
  return currentTemplate;
}

async function findExistingTemplate(channelId) {
  const query = new URLSearchParams({ channelId, limit: "100" });
  const result = await solapiRequest(`${API_BASE}?${query}`);
  const rows = Array.isArray(result)
    ? result
    : result.templateList ||
      result.templates ||
      result.list ||
      result.items ||
      [];
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
    throw new Error(
      `SOLAPI ${response.status}: ${body.errorMessage || body.message || JSON.stringify(body)}`,
    );
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
    [
      "secrets",
      "versions",
      "access",
      "latest",
      `--secret=${name}`,
      `--project=${PROJECT_ID}`,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  ).trim();
}
