export const HOLDING_TEMPLATE = {
  templateId: "KA01TP2610061247076605VQTRV7FTPK",
  name: "수강권 홀딩 현황 안내 v2",
  channelId: "KA01PF260511123220162lk0NUjstpVl",
  messageType: "BA", emphasizeType: "IMAGE", imageId: "ST01FZ261006124706032WUA50TaQpg0",
  content: "#{이름}님, \n수강권 홀딩이 등록되었습니다.\n\n🏷수강권: #{수강권명}\n\n🚫홀딩 기간\n#{홀딩시작일}~#{홀딩종료일} (#{이번홀딩일수}일)\n\n▶전체 홀딩 가능 기간: #{전체홀딩일수}일\n▶누적 사용 홀딩 기간: #{사용홀딩일수}일\n▶잔여 홀딩 가능 기간: #{잔여홀딩일수}일\n\n❗홀딩 가능 기간은 \n수강권 전체기간의 20%입니다.",
  buttons: [{ buttonType: "WL", buttonName: "홀딩규정 보기", linkMo: "https://archivepilates.notion.site/hold",
    linkPc: "https://archivepilates.notion.site/hold", targetOut: false }],
};
type Data = Record<string, any>;
const record = (v: any): v is Data => !!v && typeof v === "object" && !Array.isArray(v);

export function holdingProviderTemplateIssue(template: any): string {
  if (!record(template) || template.status !== "APPROVED") return "holding_template_not_approved";
  for (const [key, expected] of Object.entries(HOLDING_TEMPLATE)) {
    if (key === "buttons") continue;
    if (template[key] !== expected) return `holding_template_${key}_mismatch`;
  }
  if (!Array.isArray(template.buttons) || template.buttons.length !== 1 ||
    !record(template.buttons[0]) || Object.entries(HOLDING_TEMPLATE.buttons[0]).some(([k,v]) => template.buttons[0][k] !== v) ||
    ["linkAnd", "linkIos", "chatExtra"].some(k => template.buttons[0][k] != null && template.buttons[0][k] !== "") ||
    (template.quickReplies != null && (!Array.isArray(template.quickReplies) || template.quickReplies.length)))
    return "holding_template_buttons_mismatch";
  return "";
}

export function holdingProviderReceipt(result: any, phone: string) {
  if (!record(result)) throw new Error("holding_provider_response_unknown");
  const rows = Array.isArray(result.messageList) ? result.messageList : record(result.messageList) ? Object.values(result.messageList) : [];
  const failed = result.failedMessageList;
  if (failed != null && !Array.isArray(failed) && !record(failed)) throw new Error("holding_provider_failures_unknown");
  if ((failed && Object.keys(failed).length) || rows.length !== 1 || !record(rows[0]) ||
    typeof rows[0].messageId !== "string" || !rows[0].messageId.trim() || rows[0].messageId.trim() !== rows[0].messageId ||
    (rows[0].to != null && rows[0].to !== phone) ||
    (rows[0].kakaoOptions?.templateId != null && rows[0].kakaoOptions.templateId !== HOLDING_TEMPLATE.templateId))
    throw new Error("holding_provider_acceptance_unknown");
  return { messageId: rows[0].messageId, groupId: rows[0].groupId || result.groupInfo?.groupId || "",
    identityProven: rows[0].to === phone && rows[0].kakaoOptions?.templateId === HOLDING_TEMPLATE.templateId };
}

/** Exhaust bounded pages. Unknown holding receipts block; they never justify a retry. */
export async function holdingProviderHistory(get: (url: string) => Promise<any>, input: {
  phone: string; startAt: string; endAt: string; coverageVerified: boolean;
  knownReceipts: Map<string, string>; candidateId: string;
}) {
  const fail = () => ({ complete: false, duplicate: true });
  const start = Date.parse(input.startAt), end = Date.parse(input.endAt);
  if (!input.coverageVerified || !Number.isFinite(start) || !Number.isFinite(end) || start > end) return fail();
  let cursor = "";
  const cursors = new Set<string>(), ids = new Set<string>();
  let duplicate = false;
  for (let page = 0; page < 20; page++) {
    const params = new URLSearchParams({ to: input.phone, type: "ATA", startDate: input.startAt,
      endDate: input.endAt, dateType: "CREATED", limit: "500", ...(cursor ? { startKey: cursor } : {}) });
    const data = await get(`https://api.solapi.com/messages/v4/list?${params}`);
    if (!record(data) || !record(data.messageList)) return fail();
    for (const [id,row] of Object.entries(data.messageList)) {
      if (!record(row) || !id || row.messageId !== id || row.to !== input.phone || ids.has(id) ||
        !record(row.kakaoOptions) || typeof row.kakaoOptions.templateId !== "string") return fail();
      ids.add(id);
      // v1 is a historical family marker only. Never load it as a template or fallback.
      if (![HOLDING_TEMPLATE.templateId, "KA01TP261006054728079NtSGrYdtSQH"].includes(row.kakaoOptions.templateId)) continue;
      const owner = input.knownReceipts.get(id);
      if (!owner || owner === input.candidateId) duplicate = true;
    }
    if (data.nextKey == null || data.nextKey === "") return { complete: true, duplicate };
    if (typeof data.nextKey !== "string" || cursors.has(data.nextKey)) return fail();
    cursor = data.nextKey; cursors.add(cursor);
  }
  return fail();
}
