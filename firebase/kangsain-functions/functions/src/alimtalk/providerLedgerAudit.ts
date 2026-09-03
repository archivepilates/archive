import { createHmac, randomBytes } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { solapiApiKey, solapiApiSecret } from "../config/secrets";
import { refs } from "../firestore/refs";
import { sendAlimtalkLogEmail } from "../google/driveDocsMailer";
import { addDays, todayKst } from "../utils/date";

const SOLAPI_MESSAGE_LIST_URL = "https://api.solapi.com/messages/v4/list";

export interface ProviderMessageEvidence {
  messageId: string;
  groupId: string;
  templateId: string;
  status: string;
  statusCode: string;
}

export interface ProviderLedgerAuditResult {
  date: string;
  providerMessageCount: number;
  ledgerMessageCount: number;
  missingInLedger: ProviderMessageEvidence[];
}

interface SolapiMessageListResponse {
  nextKey?: string;
  messageList?: Record<string, unknown>;
  errorMessage?: string;
  message?: string;
}

export async function auditPreviousDayAlimtalkProviderLedger(
  baseDate = todayKst(),
): Promise<ProviderLedgerAuditResult> {
  const date = addDays(baseDate, -1);
  const start = new Date(`${date}T00:00:00+09:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const [providerMessages, ledgerSnap] = await Promise.all([
    listSolapiAlimtalkMessages(start, end),
    refs
      .alimtalkSends()
      .where("updatedAt", ">=", Timestamp.fromDate(start))
      .where("updatedAt", "<", Timestamp.fromDate(end))
      .get(),
  ]);
  const ledgerMessageIds = new Set(
    ledgerSnap.docs
      .filter((doc) => doc.data().status === "done")
      .map((doc) => String(doc.data().solapiMessageId || "").trim())
      .filter(Boolean),
  );
  return compareProviderMessagesWithLedger(date, providerMessages, ledgerMessageIds);
}

export async function auditPreviousDayAlimtalkProviderLedgerAndNotify(): Promise<ProviderLedgerAuditResult | null> {
  try {
    const result = await auditPreviousDayAlimtalkProviderLedger();
    if (!result.missingInLedger.length) {
      logger.info("SOLAPI provider ledger audit completed", result);
      return result;
    }
    const evidence = result.missingInLedger
      .slice(0, 20)
      .map(
        (message) =>
          `- ${message.messageId} / ${message.templateId || "템플릿 확인필요"} / ${message.statusCode || message.status}`,
      )
      .join("\n");
    await sendAlimtalkLogEmail({
      subject: `[알림톡][확인필요] SOLAPI 원장 누락 ${result.missingInLedger.length}건 · ${result.date}`,
      status: "attention",
      body: [
        "주체: ARCHIVE IN / 알림톡 원장 대조 자동화",
        `결론: SOLAPI에는 있으나 alimtalkSends에 없는 발송 ${result.missingInLedger.length}건을 찾았습니다.`,
        "핵심:",
        `- 기준일 ${result.date}`,
        `- SOLAPI 알림톡 ${result.providerMessageCount}건`,
        `- Firestore 성공 원장 ID ${result.ledgerMessageCount}건`,
        "- 회원 재발송이나 데이터 수정은 수행하지 않았습니다.",
        "검증:",
        evidence,
        "주의: SOLAPI 콘솔 직접 발송 또는 원장 기록 실패 여부를 확인해야 합니다.",
        "다음: 누락 메시지의 발송 경로를 확인하고 시스템 발송이면 원장 쓰기를 보강합니다.",
      ].join("\n"),
    });
    logger.warn("SOLAPI provider messages missing from Firestore ledger", result);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("SOLAPI provider ledger audit failed", { message });
    await sendAlimtalkLogEmail({
      subject: `[알림톡][실패] SOLAPI 원장 대조 불가 · ${todayKst()}`,
      status: "failure",
      body: [
        "주체: ARCHIVE IN / 알림톡 원장 대조 자동화",
        "결론: 전일 SOLAPI 발송과 Firestore 원장을 대조하지 못했습니다.",
        `핵심: ${message}`,
        "검증: 발송이나 회원 데이터 변경은 수행하지 않았습니다.",
        "주의: 알림톡 발송 기능 자체의 실패를 뜻하지는 않습니다.",
        "다음: SOLAPI 조회 권한과 API 응답을 확인합니다.",
      ].join("\n"),
    });
    return null;
  }
}

export function compareProviderMessagesWithLedger(
  date: string,
  providerMessages: ProviderMessageEvidence[],
  ledgerMessageIds: ReadonlySet<string>,
): ProviderLedgerAuditResult {
  const completedProviderMessages = providerMessages.filter(
    (message) => message.status.toUpperCase() === "COMPLETE" || message.statusCode === "4000",
  );
  const missingInLedger = completedProviderMessages.filter(
    (message) => !ledgerMessageIds.has(message.messageId) && !ledgerMessageIds.has(message.groupId),
  );
  return {
    date,
    providerMessageCount: completedProviderMessages.length,
    ledgerMessageCount: ledgerMessageIds.size,
    missingInLedger,
  };
}

export function providerMessageEvidence(messageId: string, raw: unknown): ProviderMessageEvidence | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const type = String(row.type || "").toUpperCase();
  if (type !== "ATA") return null;
  const kakaoOptions =
    row.kakaoOptions && typeof row.kakaoOptions === "object"
      ? (row.kakaoOptions as Record<string, unknown>)
      : {};
  const normalizedMessageId = String(row.messageId || messageId || "").trim();
  if (!normalizedMessageId) return null;
  return {
    messageId: normalizedMessageId,
    groupId: String(row.groupId || "").trim(),
    templateId: String(kakaoOptions.templateId || row.templateId || "").trim(),
    status: String(row.status || "").trim(),
    statusCode: String(row.statusCode || "").trim(),
  };
}

async function listSolapiAlimtalkMessages(start: Date, end: Date): Promise<ProviderMessageEvidence[]> {
  const rows: ProviderMessageEvidence[] = [];
  let startKey = "";
  for (let page = 0; page < 20; page += 1) {
    const url = new URL(SOLAPI_MESSAGE_LIST_URL);
    url.searchParams.set("startDate", start.toISOString());
    url.searchParams.set("endDate", end.toISOString());
    url.searchParams.set("dateType", "CREATED");
    url.searchParams.set("type", "ATA");
    url.searchParams.set("limit", "500");
    if (startKey) url.searchParams.set("startKey", startKey);
    const response = await fetch(url, {
      headers: { Authorization: solapiAuthHeader() },
    });
    const result = (await response.json().catch(() => ({}))) as SolapiMessageListResponse;
    if (!response.ok) {
      throw new Error(result.errorMessage || result.message || `SOLAPI ${response.status}`);
    }
    for (const [messageId, raw] of Object.entries(result.messageList || {})) {
      const evidence = providerMessageEvidence(messageId, raw);
      if (evidence) rows.push(evidence);
    }
    const nextKey = String(result.nextKey || "").trim();
    if (!nextKey || nextKey === startKey) return uniqueProviderMessages(rows);
    startKey = nextKey;
  }
  throw new Error("SOLAPI 메시지 목록 페이지가 20회를 초과했습니다");
}

function uniqueProviderMessages(rows: ProviderMessageEvidence[]): ProviderMessageEvidence[] {
  return [...new Map(rows.map((row) => [row.messageId, row])).values()];
}

function solapiAuthHeader(): string {
  const dateTime = new Date().toISOString();
  const salt = randomBytes(16).toString("hex");
  const signature = createHmac("sha256", solapiApiSecret.value())
    .update(dateTime + salt)
    .digest("hex");
  return `HMAC-SHA256 apiKey=${solapiApiKey.value()}, date=${dateTime}, salt=${salt}, signature=${signature}`;
}
