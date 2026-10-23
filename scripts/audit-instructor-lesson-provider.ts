import { createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { db } from "../firebase/kangsain-functions/functions/src/config/firebase";
import { primaryAlimtalkTestRecipient } from "../firebase/kangsain-functions/functions/src/alimtalk/testRecipients";
import { INSTRUCTOR_LESSON_ALIMTALK_TEMPLATE_CODE, INSTRUCTOR_LESSON_ALIMTALK_CHANNEL_ID } from "../firebase/kangsain-functions/functions/src/alimtalk/templates";
import { normalizePhone } from "../firebase/kangsain-functions/functions/src/alimtalk/dedupe";

const secretCache = new Map<string, string>();
function secret(name: string): string {
  if (process.env[name]?.trim()) return process.env[name]!.trim();
  if (!secretCache.has(name)) secretCache.set(name, execFileSync("gcloud", ["secrets", "versions", "access", "latest",
    `--secret=${name}`, "--project=archive-pilates", "--account=archive-codex-operator@archive-pilates.iam.gserviceaccount.com", "--quiet"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20000 }).trim());
  return secretCache.get(name)!;
}

async function providerGet(route: string): Promise<any> {
  if (!route.startsWith("/messages/v4/list?") && route !== `/kakao/v2/templates/${INSTRUCTOR_LESSON_ALIMTALK_TEMPLATE_CODE}`)
    throw new Error("Provider audit route not allowed");
  const date = new Date().toISOString(), salt = randomBytes(16).toString("hex");
  const signature = createHmac("sha256", secret("SOLAPI_API_SECRET")).update(date + salt).digest("hex");
  const response = await fetch(`https://api.solapi.com${route}`, {
    headers: { Authorization: `HMAC-SHA256 apiKey=${secret("SOLAPI_API_KEY")}, date=${date}, salt=${salt}, signature=${signature}` },
    redirect: "error", signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Provider read failed HTTP ${response.status}`);
  return response.json();
}

export async function auditInstructorLessonProvider(sourceDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sourceDate)) throw new Error("Invalid source date");
  const template = await providerGet(`/kakao/v2/templates/${INSTRUCTOR_LESSON_ALIMTALK_TEMPLATE_CODE}`);
  const urls = ["https://in.archivepilates.com/method/#{관리번호}",
    "https://in.archivepilates.com/method/#{관리번호}/assignment", "https://archivepilates.notion.site/visitin",
    "https://in.archivepilates.com/s/#{주차링크ID}/"];
  const names = ["수업자료 보기", "수업배정 안내", "방문안내 보기", "주차 사전등록"];
  const buttons = template.buttons || [];
  if (template.status !== "APPROVED" || template.channelId !== INSTRUCTOR_LESSON_ALIMTALK_CHANNEL_ID
    || template.messageType !== "BA" || template.emphasizeType !== "IMAGE" || !template.imageId
    || !String(template.content || "").includes("#{이름}") || buttons.length !== 4
    || buttons.some((b: any, i: number) => b.buttonName !== names[i] || b.linkMo !== urls[i] || b.linkPc !== urls[i]))
    throw new Error("Approved V3 provider contract mismatch");
  const candidates = await db.collection("alimtalkCandidates").where("sourceDate", "==", sourceDate).get();
  const phones = new Set<string>(candidates.docs.filter(d => d.data().studioId === "5330"
    && d.data().type === "instructor_lesson_material").map(d => normalizePhone(d.data().memberPhone)));
  phones.delete("");
  const testPhone = normalizePhone(primaryAlimtalkTestRecipient().phone);
  phones.delete(testPhone);
  const results: any[] = [];
  for (const phone of [...phones, testPhone]) {
    const params = new URLSearchParams({ to: phone, type: "ATA", dateType: "CREATED",
      startDate: `${sourceDate}T00:00:00+09:00`, endDate: `${sourceDate}T23:59:59+09:00`, limit: "500" });
    const result = await providerGet(`/messages/v4/list?${params}`);
    if (result.nextKey) throw new Error("Provider history pagination requires manual review");
    const messages = Object.values(result.messageList || {}).filter((m: any) =>
      m.kakaoOptions?.templateId === INSTRUCTOR_LESSON_ALIMTALK_TEMPLATE_CODE || m.templateId === INSTRUCTOR_LESSON_ALIMTALK_TEMPLATE_CODE) as any[];
    results.push({ sample: phone === testPhone, rows: messages.map(m => ({ messageId: m.messageId,
      status: m.status, statusCode: String(m.statusCode || ""), statusMessage: m.statusMessage })) });
  }
  return { readOnly: true, sourceDate, checkedAt: new Date().toISOString(), templateApproved: true,
    templateId: template.templateId, recipientCount: phones.size,
    memberHistoryCount: results.filter(r => !r.sample).reduce((n, r) => n + r.rows.length, 0),
    sampleHistoryCount: results.filter(r => r.sample).reduce((n, r) => n + r.rows.length, 0),
    receipts: results.flatMap(r => r.rows.map((m: any) => ({ sample: r.sample, ...m }))) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  auditInstructorLessonProvider(process.argv[2]).then(r => console.log(JSON.stringify(r, null, 2)))
    .catch(() => { console.error("Instructor provider audit blocked; inspect exact template/history read without retrying sends."); process.exitCode = 1; });
