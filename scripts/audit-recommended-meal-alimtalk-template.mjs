#!/usr/bin/env node

import { createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

const PROJECT_ID = "archive-pilates";
const TEMPLATE_ID = "KA01TP260728111926523p2JzzTgHsS8";
const EXPECTED_CHANNEL_ID = "KA01PF260511123220162lk0NUjstpVl";
const EXPECTED_IMAGE_ID = "ST01FZ260730122108103pEzxH5jOOpU";
const EXPECTED_BUTTON_URL = "https://in.archivepilates.com/s/#{링크ID}/";
const API_BASE = "https://api.solapi.com/kakao/v2/templates";

const apiKey = readSecret("SOLAPI_API_KEY");
const apiSecret = readSecret("SOLAPI_API_SECRET");
const response = await fetch(`${API_BASE}/${encodeURIComponent(TEMPLATE_ID)}`, {
  headers: { Authorization: authHeader() },
});
const template = await response.json().catch(() => ({}));
if (!response.ok) {
  throw new Error(
    `SOLAPI ${response.status}: ${template.errorMessage || template.message || JSON.stringify(template)}`,
  );
}

const buttonUrls = (template.buttons || [])
  .flatMap((button) => [button.linkMo, button.linkPc])
  .map((value) => String(value || "").trim())
  .filter(Boolean);
const issues = [];
if (String(template.status || "").toUpperCase() !== "APPROVED") {
  issues.push(`status=${template.status || "missing"}`);
}
if (String(template.messageType || "").toUpperCase() !== "BA") {
  issues.push(`messageType=${template.messageType || "missing"}`);
}
if (String(template.emphasizeType || "").toUpperCase() !== "IMAGE") {
  issues.push(`emphasizeType=${template.emphasizeType || "missing"}`);
}
if (String(template.channelId || "") !== EXPECTED_CHANNEL_ID) {
  issues.push(`channelId=${template.channelId || "missing"}`);
}
if (String(template.imageId || "") !== EXPECTED_IMAGE_ID) {
  issues.push(`imageId=${template.imageId || "missing"}`);
}
if (!String(template.content || "").includes("#{이름}")) {
  issues.push("member-name variable missing");
}
if (!buttonUrls.includes(EXPECTED_BUTTON_URL)) {
  issues.push("survey short-link button mismatch");
}

console.log(
  JSON.stringify(
    {
      ok: issues.length === 0,
      mode: "read-only",
      checkedAt: new Date().toISOString(),
      template: {
        templateId: template.templateId,
        name: template.name,
        status: template.status,
        messageType: template.messageType,
        emphasizeType: template.emphasizeType,
        imageId: template.imageId,
        channelId: template.channelId,
        buttons: (template.buttons || []).map((button) => ({
          name: button.buttonName,
          type: button.buttonType,
          mobileUrl: button.linkMo,
          desktopUrl: button.linkPc,
        })),
      },
      issues,
    },
    null,
    2,
  ),
);

if (issues.length) process.exitCode = 1;

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
