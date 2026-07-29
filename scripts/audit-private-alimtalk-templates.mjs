#!/usr/bin/env node

import { createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

const PROJECT_ID = "archive-pilates";
const API_BASE = "https://api.solapi.com/kakao/v2/templates";
const REFERENCE_TEMPLATE_ID = "KA01TP260514153632171uiWXYoeiOLS";
const strict = process.argv.includes("--strict");
const templates = [
  {
    key: "member_private_survey",
    id: process.env.PRIVATE_SURVEY_ALIMTALK_TEMPLATE_ID || "KA01TP260729144645970fv13He8mfsK",
    requiredButtonFragments: ["https://in.archivepilates.com/s/#{링크ID}/"],
    requiredVariables: ["#{이름}", "#{링크ID}"],
    expectedMessageType: "BA",
    expectedEmphasizeType: "IMAGE",
    expectedImageId: "ST01FZ2605141601264576AUwmK3Bqgl",
  },
  {
    key: "staff_intake_summary",
    id: "KA01TP260519093416836f1EHZYJ00uM",
    requiredButtonFragments: ["#{설문ID}", "#{접근토큰}"],
    requiredVariables: ["#{강사명}", "#{회원명}", "#{수업일시}", "#{설문ID}", "#{접근토큰}"],
  },
  {
    key: "staff_private_chart",
    id:
      process.env.STAFF_PRIVATE_CHART_ALIMTALK_TEMPLATE_ID ||
      "KA01TP260729144657202OV26yAD15wR",
    requiredButtonFragments: [
      "#{수업전계획링크ID}",
      "#{수업후기록링크ID}",
      "#{사진영상업로드링크ID}",
    ],
    requiredVariables: [
      "#{강사명}",
      "#{회원명}",
      "#{회차}",
      "#{수업일시}",
      "#{수업전계획링크ID}",
      "#{수업후기록링크ID}",
      "#{사진영상업로드링크ID}",
    ],
    forbiddenContentFragments: ["Notion"],
    expectedMessageType: "BA",
    expectedEmphasizeType: "IMAGE",
    expectedImageId: "ST01FZ260527183751162YVedKZ3LQIu",
  },
  {
    key: "member_private_report",
    id: "KA01TP260528081225871Fr92FW901Vo",
    requiredButtonFragments: ["#{리포트링크ID}"],
    requiredVariables: ["#{회원명}", "#{리포트링크ID}"],
  },
];

const apiKey = readSecret("SOLAPI_API_KEY");
const apiSecret = readSecret("SOLAPI_API_SECRET");
const referenceTemplate = await solapiRequest(`${API_BASE}/${encodeURIComponent(REFERENCE_TEMPLATE_ID)}`);
const expectedChannelId = String(referenceTemplate.channelId || "").trim();
if (!expectedChannelId) throw new Error("Reference SOLAPI channelId is missing.");
const results = [];

for (const expected of templates) {
  const template = await solapiRequest(`${API_BASE}/${encodeURIComponent(expected.id)}`);
  const buttonUrls = (template.buttons || [])
    .flatMap((button) => [button.linkMo, button.linkPc])
    .map((value) => String(value || ""))
    .filter(Boolean);
  const issues = [];
  if (String(template.status || "").toUpperCase() !== "APPROVED") {
    issues.push(`template status is ${template.status || "unknown"}`);
  }
  if (String(template.channelId || "") !== expectedChannelId) {
    issues.push(`channelId mismatch: ${template.channelId || "missing"}`);
  }
  if (
    expected.expectedMessageType &&
    String(template.messageType || "").toUpperCase() !== expected.expectedMessageType
  ) {
    issues.push(`messageType mismatch: ${template.messageType || "missing"}`);
  }
  if (
    expected.expectedEmphasizeType &&
    String(template.emphasizeType || "").toUpperCase() !== expected.expectedEmphasizeType
  ) {
    issues.push(`emphasizeType mismatch: ${template.emphasizeType || "missing"}`);
  }
  if (expected.expectedImageId && String(template.imageId || "") !== expected.expectedImageId) {
    issues.push(`imageId mismatch: ${template.imageId || "missing"}`);
  }
  for (const fragment of expected.requiredButtonFragments) {
    if (!buttonUrls.some((url) => url.includes(fragment))) {
      issues.push(`button URL is missing ${fragment}`);
    }
  }
  const contractText = [String(template.content || ""), ...buttonUrls].join("\n");
  for (const variable of expected.requiredVariables) {
    if (!contractText.includes(variable)) issues.push(`template variable is missing ${variable}`);
  }
  for (const fragment of expected.forbiddenContentFragments || []) {
    if (String(template.content || "").includes(fragment)) {
      issues.push(`template content still contains ${fragment}`);
    }
  }
  results.push({
    key: expected.key,
    templateId: expected.id,
    name: template.name,
    status: template.status,
    channelId: template.channelId,
    messageType: template.messageType,
    emphasizeType: template.emphasizeType,
    imageId: template.imageId,
    content: template.content,
    buttons: (template.buttons || []).map((button) => ({
      name: button.buttonName,
      type: button.buttonType,
      mobileUrl: button.linkMo,
      desktopUrl: button.linkPc,
    })),
    ok: issues.length === 0,
    issues,
  });
}

console.log(
  JSON.stringify(
    {
      ok: results.every((result) => result.ok),
      mode: "read-only",
      checkedAt: new Date().toISOString(),
      results,
    },
    null,
    2,
  ),
);

if (strict && results.some((result) => !result.ok)) process.exitCode = 1;

async function solapiRequest(url) {
  const response = await fetch(url, {
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
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
