#!/usr/bin/env node

import { createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

const PROJECT_ID = "archive-pilates";
const REFERENCE_TEMPLATE_ID = "KA01TP260724090746135DWCIb2boEw7";
const EXPECTED_CHANNEL_ID = "KA01PF260511123407631PSoAflYAVXs";
const TEMPLATE_NAME = "강사레슨_수업자료 안내 v3";
const TEMPLATE_CONTENT = `#{이름}님,

예약하신 강사레슨 수업이
내일 진행돼요.

수업 전 아래 버튼에서
수업자료, 수업배정, 방문안내와
주차 사전등록을 확인해 주세요.`;
const MATERIAL_URL = "https://in.archivepilates.com/method/#{관리번호}";
const ASSIGNMENT_URL = "https://in.archivepilates.com/method/#{관리번호}/assignment";
const VISIT_URL = "https://archivepilates.notion.site/visitin";
const PARKING_URL = "https://in.archivepilates.com/s/#{주차링크ID}/";
const API_BASE = "https://api.solapi.com/kakao/v2/templates";

if (!process.argv.includes("--apply")) {
  console.error("Refusing to create a SOLAPI template without --apply.");
  process.exit(2);
}

const apiKey = readSecret("SOLAPI_API_KEY");
const apiSecret = readSecret("SOLAPI_API_SECRET");
const reference = await solapiRequest(`${API_BASE}/${encodeURIComponent(REFERENCE_TEMPLATE_ID)}`);
assertReference(reference);

const templatePayload = {
  name: TEMPLATE_NAME,
  content: TEMPLATE_CONTENT,
  categoryCode: reference.categoryCode,
  buttons: [
    webButton("수업자료 보기", MATERIAL_URL),
    webButton("수업배정 안내", ASSIGNMENT_URL),
    webButton("방문안내 보기", VISIT_URL),
    webButton("주차 사전등록", PARKING_URL),
  ],
  quickReplies: Array.isArray(reference.quickReplies) ? reference.quickReplies : [],
  messageType: reference.messageType,
  emphasizeType: reference.emphasizeType,
  imageId: reference.imageId,
  securityFlag: Boolean(reference.securityFlag),
};

const existingSummary = await findExistingTemplate();
const existing = existingSummary
  ? await solapiRequest(`${API_BASE}/${encodeURIComponent(existingSummary.templateId)}`)
  : null;
let current = existing;
let repaired = false;

if (current) {
  const issues = templateContractIssues(current);
  if (issues.length) {
    const status = String(current.status || "").toUpperCase();
    if (!["PENDING", "REJECTED"].includes(status)) {
      throw new Error(
        `Refusing to modify ${current.templateId} in ${status || "UNKNOWN"} status: ${issues.join(", ")}`,
      );
    }
    current = await solapiRequest(`${API_BASE}/${encodeURIComponent(current.templateId)}`, {
      method: "PUT",
      body: JSON.stringify(templatePayload),
    });
    repaired = true;
  }
} else {
  current = await solapiRequest(API_BASE, {
    method: "POST",
    body: JSON.stringify({ channelId: EXPECTED_CHANNEL_ID, ...templatePayload }),
  });
}

const beforeInspection = await solapiRequest(`${API_BASE}/${encodeURIComponent(current.templateId)}`);
assertTemplateContract(beforeInspection);
const beforeStatus = String(beforeInspection.status || "").toUpperCase();
if (["PENDING", "REJECTED"].includes(beforeStatus)) {
  current = await solapiRequest(`${API_BASE}/${encodeURIComponent(beforeInspection.templateId)}/inspection`, {
    method: "PUT",
    body: JSON.stringify({
      comment:
        "ARCHIVE PILATES 강사레슨 예약자에게 수업 하루 전 1회 발송하는 예약 이행 안내입니다. 수업자료, 수업배정, 방문안내와 예약자별 차량번호 사전등록 링크를 제공합니다. 광고성 내용은 없으며, 주차 등록은 유효 예약과 수업일을 재확인하고 수업 시작 30분 후 입차 조회 1회에만 사용합니다.",
    }),
  });
}

const finalTemplate = await solapiRequest(`${API_BASE}/${encodeURIComponent(current.templateId)}`);
assertTemplateContract(finalTemplate);
const finalStatus = String(finalTemplate.status || "").toUpperCase();
if (!["INSPECTING", "APPROVED"].includes(finalStatus)) {
  throw new Error(`Template inspection was not submitted: ${finalStatus || "UNKNOWN"}`);
}

console.log(
  JSON.stringify(
    {
      templateId: finalTemplate.templateId,
      name: finalTemplate.name,
      status: finalTemplate.status,
      channelId: finalTemplate.channelId,
      content: finalTemplate.content,
      buttons: finalTemplate.buttons,
      messageType: finalTemplate.messageType,
      emphasizeType: finalTemplate.emphasizeType,
      imageId: finalTemplate.imageId,
      referenceTemplateId: REFERENCE_TEMPLATE_ID,
      reused: Boolean(existing),
      repaired,
      activation: "v2 remains active until v3 is APPROVED and deployed in a separate switch",
    },
    null,
    2,
  ),
);

function webButton(buttonName, url) {
  return {
    buttonType: "WL",
    buttonName,
    linkMo: url,
    linkPc: url,
    targetOut: true,
  };
}

function assertReference(template) {
  const status = String(template.status || "").toUpperCase();
  if (status !== "APPROVED") throw new Error(`Reference template is not approved: ${status || "missing"}`);
  if (String(template.channelId || "") !== EXPECTED_CHANNEL_ID) throw new Error("Reference channelId mismatch");
  if (String(template.messageType || "").toUpperCase() !== "BA") throw new Error("Reference messageType mismatch");
  if (String(template.emphasizeType || "").toUpperCase() !== "IMAGE") throw new Error("Reference emphasizeType mismatch");
  if (!String(template.imageId || "").trim()) throw new Error("Reference imageId is missing");
  if (!Array.isArray(template.buttons) || template.buttons.length !== 3) {
    throw new Error("Reference template must have exactly three approved buttons");
  }
}

function assertTemplateContract(template) {
  const issues = templateContractIssues(template);
  if (issues.length) throw new Error(`SOLAPI v3 template contract mismatch: ${issues.join(", ")}`);
}

function templateContractIssues(template) {
  const issues = [];
  if (String(template.channelId || "") !== EXPECTED_CHANNEL_ID) issues.push("channelId mismatch");
  if (String(template.name || "").trim() !== TEMPLATE_NAME) issues.push("name mismatch");
  if (String(template.content || "").trim() !== TEMPLATE_CONTENT.trim()) issues.push("content mismatch");
  if (String(template.categoryCode || "") !== String(reference.categoryCode || "")) issues.push("category mismatch");
  if (String(template.messageType || "").toUpperCase() !== String(reference.messageType || "").toUpperCase()) {
    issues.push("messageType mismatch");
  }
  if (String(template.emphasizeType || "").toUpperCase() !== String(reference.emphasizeType || "").toUpperCase()) {
    issues.push("emphasizeType mismatch");
  }
  if (String(template.imageId || "") !== String(reference.imageId || "")) issues.push("imageId mismatch");
  const expectedButtons = templatePayload.buttons;
  const actualButtons = Array.isArray(template.buttons) ? template.buttons : [];
  if (actualButtons.length !== expectedButtons.length) issues.push("button count mismatch");
  expectedButtons.forEach((expected, index) => {
    const actual = actualButtons[index] || {};
    if (String(actual.buttonType || actual.type || "") !== expected.buttonType) issues.push(`button ${index + 1} type mismatch`);
    if (String(actual.buttonName || actual.name || "") !== expected.buttonName) issues.push(`button ${index + 1} name mismatch`);
    if (String(actual.linkMo || actual.mobileUrl || "") !== expected.linkMo) issues.push(`button ${index + 1} mobile URL mismatch`);
    if (String(actual.linkPc || actual.desktopUrl || "") !== expected.linkPc) issues.push(`button ${index + 1} desktop URL mismatch`);
  });
  for (const variable of ["#{이름}", "#{관리번호}", "#{주차링크ID}"]) {
    const contractText = [String(template.content || ""), ...actualButtons.flatMap((button) => [button.linkMo, button.linkPc])]
      .join("\n");
    if (!contractText.includes(variable)) issues.push(`template variable missing: ${variable}`);
  }
  return issues;
}

async function findExistingTemplate() {
  const query = new URLSearchParams({ channelId: EXPECTED_CHANNEL_ID, limit: "100" });
  const result = await solapiRequest(`${API_BASE}?${query}`);
  const rows = Array.isArray(result)
    ? result
    : result.templateList || result.templates || result.list || result.items || [];
  return rows.find(
    (item) =>
      String(item.name || "").trim() === TEMPLATE_NAME &&
      !item.isDeleted &&
      String(item.channelId || EXPECTED_CHANNEL_ID) === EXPECTED_CHANNEL_ID,
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
