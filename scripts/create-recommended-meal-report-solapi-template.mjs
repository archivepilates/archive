#!/usr/bin/env node

import { createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

const PROJECT_ID = "archive-pilates";
const REFERENCE_TEMPLATE_ID = "KA01TP260802163827071E2TTuX6CsWp";
const IMAGE_ID = "ST01FZ260730122108103pEzxH5jOOpU";
const TEMPLATE_NAME = "아카이브 추천식단 도착 안내 v1";
const TEMPLATE_CONTENT = `#{이름}님, 설문과 InBody 기록을 반영한
ARCHIVE PILATES 추천식단이 준비되었습니다.

생활 패턴과 운동 일정을 고려해
실천하기 쉬운 7일 식단으로 정리했습니다.

아래 버튼에서 확인해 주세요.

※ 본 내용은 생활 습관 개선을 위한 일반 안내이며 의료적 영양 처방을 대신하지 않습니다.`;
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
const created = existing ||
  (await solapiRequest(API_BASE, {
    method: "POST",
    body: JSON.stringify({
      channelId,
      name: TEMPLATE_NAME,
      content: TEMPLATE_CONTENT,
      categoryCode,
      buttons: [{ buttonType: "WL", buttonName: "추천식단 보기", linkMo: BUTTON_URL, linkPc: BUTTON_URL, targetOut: false }],
      quickReplies: [],
      messageType: "BA",
      emphasizeType: "IMAGE",
      imageId: IMAGE_ID,
      securityFlag: false,
    }),
  }));

let current = created;
if (["PENDING", "REJECTED"].includes(String(current.status || "").toUpperCase())) {
  current = await solapiRequest(`${API_BASE}/${encodeURIComponent(current.templateId)}/inspection`, {
    method: "PUT",
    body: JSON.stringify({
      comment: "회원이 제출한 생활·식습관 설문과 센터 InBody 기록을 바탕으로 운영자가 검토·승인한 7일 추천식단 확인 링크를 단건 발송합니다. 광고성 내용이 아닙니다.",
    }),
  });
}
const finalTemplate = await solapiRequest(`${API_BASE}/${encodeURIComponent(current.templateId)}`);
console.log(JSON.stringify({
  templateId: finalTemplate.templateId,
  name: finalTemplate.name,
  status: finalTemplate.status,
  channelId: finalTemplate.channelId,
  messageType: finalTemplate.messageType,
  emphasizeType: finalTemplate.emphasizeType,
  imageId: finalTemplate.imageId,
  buttons: finalTemplate.buttons,
  reused: Boolean(existing),
}, null, 2));

async function findExistingTemplate(channelId) {
  const query = new URLSearchParams({ channelId, limit: "100" });
  const result = await solapiRequest(`${API_BASE}?${query}`);
  const rows = Array.isArray(result) ? result : result.templateList || result.templates || result.list || result.items || [];
  return rows.find((item) => String(item.name || "").trim() === TEMPLATE_NAME && !item.isDeleted) || null;
}

async function solapiRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: authHeader(), "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`SOLAPI ${response.status}: ${body.errorMessage || body.message || JSON.stringify(body)}`);
  return body;
}

function authHeader() {
  const date = new Date().toISOString();
  const salt = randomBytes(16).toString("hex");
  const signature = createHmac("sha256", apiSecret).update(date + salt).digest("hex");
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

function readSecret(name) {
  return execFileSync("gcloud", ["secrets", "versions", "access", "latest", `--secret=${name}`, `--project=${PROJECT_ID}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
}
