#!/usr/bin/env node
import { createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  MEMBERSHIP_WELCOME_TEMPLATE as spec,
  membershipWelcomeTemplateIssue,
} from "./lib/studiomate-membership-welcome.mjs";

const apply = process.argv.includes("--apply");
if (
  process.argv.slice(2).some((arg) => !["--apply", "--read-only"].includes(arg))
)
  throw new Error("Use --read-only or --apply");
if (apply && process.argv.includes("--read-only"))
  throw new Error("Choose one mode");
const api = "https://api.solapi.com/kakao/v2/templates";
const secret = (name) =>
  execFileSync(
    "gcloud",
    [
      "secrets",
      "versions",
      "access",
      "latest",
      `--secret=${name}`,
      "--project=archive-pilates",
      "--account=archive-codex-operator@archive-pilates.iam.gserviceaccount.com",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
const key = secret("SOLAPI_API_KEY");
const apiSecret = secret("SOLAPI_API_SECRET");
async function request(url, method = "GET", body) {
  const date = new Date().toISOString();
  const salt = randomBytes(16).toString("hex");
  const signature = createHmac("sha256", apiSecret)
    .update(date + salt)
    .digest("hex");
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `HMAC-SHA256 apiKey=${key}, date=${date}, salt=${salt}, signature=${signature}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      `SOLAPI ${response.status}: ${data.errorMessage || data.message || "request failed"}`,
    );
  return data;
}

const reference = await request(`${api}/${spec.referenceTemplateId}`);
if (
  reference.status !== "APPROVED" ||
  reference.imageId !== spec.imageId ||
  reference.channelId !== spec.channelId ||
  reference.emphasizeType !== "IMAGE"
)
  throw new Error("Reference template/image contract changed");
const templates = [];
let startKey = "";
const seen = new Set();
for (let page = 0; page < 20; page += 1) {
  const query = new URLSearchParams({
    channelId: spec.channelId,
    limit: "100",
    ...(startKey ? { startKey } : {}),
  });
  const response = await request(`${api}?${query}`);
  const rows = Array.isArray(response)
    ? response
    : response.templateList ||
      response.templates ||
      response.list ||
      response.items;
  if (!Array.isArray(rows))
    throw new Error("Unknown template list response; no create");
  templates.push(...rows);
  const next = response.nextKey || "";
  if (!next) break;
  if (seen.has(next) || page === 19)
    throw new Error("Incomplete template inventory; no create");
  seen.add(next);
  startKey = next;
}
const matches = templates.filter((t) => t.name === spec.name && !t.isDeleted);
if (matches.length > 1)
  throw new Error("Duplicate named templates require review");
let current = matches.length
  ? await request(`${api}/${matches[0].templateId}`)
  : null;
if (!current && spec.templateId)
  throw new Error(
    "Pinned template missing from inventory; inspect provider, never recreate automatically",
  );
if (
  current &&
  membershipWelcomeTemplateIssue(current, { requireApproved: false })
)
  throw new Error("Existing template differs; never overwrite automatically");
if (!apply) {
  console.log(
    JSON.stringify(
      {
        mode: "read_only",
        existing: current
          ? { templateId: current.templateId, status: current.status }
          : null,
        proposal: spec,
      },
      null,
      2,
    ),
  );
} else {
  if (!current) {
    const { referenceTemplateId, templateId, ...definition } = spec;
    current = await request(api, "POST", {
      ...definition,
      categoryCode: reference.categoryCode,
      quickReplies: [],
      securityFlag: Boolean(reference.securityFlag),
    });
    if (!current.templateId)
      throw new Error(
        "Ambiguous creation result; inspect provider before retry",
      );
    current = await request(`${api}/${current.templateId}`);
  }
  const issue = membershipWelcomeTemplateIssue(current, {
    requireApproved: false,
  });
  if (issue) throw new Error(issue);
  if (current.status === "PENDING") {
    await request(`${api}/${current.templateId}/inspection`, "PUT", {
      comment:
        "신규 정규회원의 센터 계약서 본인 서명 완료 후 1회 발송하는 가입완료 및 시설 이용 안내입니다. 이용안내와 예약방법 링크만 포함하며 상품 홍보, 할인, 재가입 요청은 포함하지 않습니다. 기존 승인된 센터 로고 이미지를 유지했습니다.",
    });
  }
  const final = await request(`${api}/${current.templateId}`);
  const contractIssue = membershipWelcomeTemplateIssue(final, {
    requireApproved: false,
  });
  if (contractIssue) throw new Error(contractIssue);
  console.log(
    JSON.stringify(
      {
        mode: "apply_template_only",
        checkedAt: new Date().toISOString(),
        templateId: final.templateId,
        name: final.name,
        status: final.status,
        imageId: final.imageId,
        messageType: final.messageType,
        emphasizeType: final.emphasizeType,
        reused: matches.length === 1,
        memberSends: 0,
      },
      null,
      2,
    ),
  );
}
