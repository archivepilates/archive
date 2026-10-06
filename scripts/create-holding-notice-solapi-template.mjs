import { createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { HOLDING_NOTICE_TEMPLATE as spec, HOLDING_NOTICE_TEMPLATE_ID, holdingTemplateIssue } from "./lib/holding-allowance-notice.mjs";

const mode = process.argv.slice(2);
if (mode.length !== 1 || !["--read-only", "--apply"].includes(mode[0])) throw new Error("Use --read-only or --apply");
const secret = (name) => execFileSync("gcloud", ["secrets", "versions", "access", "latest", `--secret=${name}`, "--project=archive-pilates", "--account=archive-codex-operator@archive-pilates.iam.gserviceaccount.com"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const key = secret("SOLAPI_API_KEY"), apiSecret = secret("SOLAPI_API_SECRET");
const base = "https://api.solapi.com/kakao/v2/templates";
async function request(url, method = "GET", body) {
  const date = new Date().toISOString(), salt = randomBytes(16).toString("hex");
  const signature = createHmac("sha256", apiSecret).update(date + salt).digest("hex");
  const response = await fetch(url, { method, headers: { Authorization: `HMAC-SHA256 apiKey=${key}, date=${date}, salt=${salt}, signature=${signature}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`SOLAPI ${response.status}; inspect provider before retrying writes`);
  return response.json();
}
const reference = await request(`${base}/${spec.referenceTemplateId}`);
if (reference.status !== "APPROVED" || reference.channelId !== spec.channelId || reference.messageType !== "BA" || reference.emphasizeType !== "IMAGE" || reference.imageId !== spec.imageId) throw new Error("Reference image contract changed; no create");
const templates = [], seen = new Set();
let startKey = "";
for (let page = 0; page < 20; page++) {
  const query = new URLSearchParams({ channelId: spec.channelId, limit: "100", ...(startKey ? { startKey } : {}) });
  const response = await request(`${base}?${query}`);
  const rows = Array.isArray(response) ? response : response.templateList || response.templates || response.list || response.items;
  if (!Array.isArray(rows)) throw new Error("Unknown template inventory");
  templates.push(...rows);
  const next = response.nextKey || "";
  if (!next) break;
  if (seen.has(next) || page === 19) throw new Error("Incomplete inventory; no create");
  seen.add(next); startKey = next;
}
const matches = templates.filter((t) => t.name === spec.name && !t.isDeleted);
if (matches.length > 1) throw new Error("Duplicate named templates; manual review required");
let current = matches.length ? await request(`${base}/${matches[0].templateId}`) : null;
if (!current && HOLDING_NOTICE_TEMPLATE_ID) throw new Error("Pinned template missing; inspect provider, never recreate automatically");
if (current && holdingTemplateIssue(current, { requireApproved: false })) throw new Error("Existing template differs; no overwrite");
if (mode[0] === "--apply") {
  if (!current) {
    const { referenceTemplateId, ...definition } = spec;
    const created = await request(base, "POST", { ...definition, categoryCode: reference.categoryCode, quickReplies: [], securityFlag: Boolean(reference.securityFlag) });
    if (!created.templateId) throw new Error("Unknown create outcome; inspect inventory, never blindly retry");
    current = await request(`${base}/${created.templateId}`);
  }
  const issue = holdingTemplateIssue(current, { requireApproved: false });
  if (issue) throw new Error(issue);
  if (current.status === "PENDING") await request(`${base}/${current.templateId}/inspection`, "PUT", {
    comment: "회원이 보유한 수강권의 홀딩 등록 후 이번 정지기간과 이용규정에 따른 총 가능일, 누적 사용일, 잔여일을 안내하는 거래성 메시지입니다. 상품 홍보나 구매 유도 없이 기존 승인된 ARCHIVE PILATES 로고 이미지를 유지합니다.",
  });
  current = await request(`${base}/${current.templateId}`);
  const finalIssue = holdingTemplateIssue(current, { requireApproved: false });
  if (finalIssue) throw new Error(finalIssue);
}
console.log(JSON.stringify({ mode: mode[0], checkedAt: new Date().toISOString(), templateId: current?.templateId || null,
  status: current?.status || "NOT_CREATED", name: spec.name, messageType: current?.messageType, emphasizeType: current?.emphasizeType,
  imageId: current?.imageId, memberSends: 0, ...(mode[0] === "--read-only" ? { proposal: spec } : {}) }, null, 2));
