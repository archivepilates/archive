import { createHash } from "node:crypto";

export const OPS_MAIL = Object.freeze({
  mailbox: "home@archivepilates.com",
  topic: "projects/archive-pilates/topics/archive-operations-mail",
  lanePath: "workLanes/operations-mail-ingress",
  statePath: "workLanes/operations-mail-ingress/state/mailbox",
  source: "operations-mail-ingress",
} as const);

const AREAS = Object.freeze({
  "알림톡": "alimtalk",
  "홀딩 안내": "holding",
  "전자계약": "contract",
  "시스템점검": "system_health",
  "동기화": "sync",
  "배포": "deploy",
  "사이트": "site",
  "강사레슨": "instructor_lesson",
  "자동화": "automation",
  "알림감지": "notification_detection",
  "주차등록": "parking",
  "릴스": "reel",
  "월말정산": "settlement",
  "인바디 API": "inbody_api",
  "유튜브 영상리스트": "youtube_video_list",
  "인바디": "inbody",
  "시스템검증": "system_validation",
  "데이터정합성": "data_integrity",
  "로그인": "login",
  "친구초대": "referral",
  "스텝 혜택": "staff_benefits",
  "강사레슨영상": "instructor_lesson_video",
  "스텝 영상권한": "staff_video_access",
} as const);

export const OPS_MAIL_LABEL_NAMES: readonly string[] = Object.freeze(
  Object.keys(AREAS).map(area => `${area} 보고`),
);

const STATUSES = Object.freeze({
  "실패": "failure",
  "긴급": "urgent",
  "확인필요": "attention",
  "성공": "success",
  "진행중": "in_progress",
} as const);

export type GmailMetadata = {
  id: string;
  threadId?: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: { headers?: Array<{ name: string; value: string }> };
};

export type OperationsMailClassification = {
  messageId: string;
  threadId: string;
  receivedAt: string;
  area: typeof AREAS[keyof typeof AREAS];
  areaLabel: keyof typeof AREAS;
  status: typeof STATUSES[keyof typeof STATUSES];
  priority: "high" | "normal";
  title: string;
  incidentKey: string;
  actionable: boolean;
  isTest: boolean;
};

function isHexId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{8,64}$/.test(value);
}

// Accept only one bare mailbox or one unambiguous name-addr, never a list/group/comment.
function isOwnMailbox(value: string): boolean {
  const address = value.trim();
  if (address.toLowerCase() === OPS_MAIL.mailbox) return true;
  const match = /^(?:(?:"[^"\\]*"|[^<>,;:@"\\]+)\s*)?<([^<>\s]+)>$/.exec(address);
  return match?.[1].toLowerCase() === OPS_MAIL.mailbox;
}

function activationTime(value: string): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return null;
  const ms = Date.parse(value);
  const hours = Number(match[4] ?? 0);
  const minutes = Number(match[5] ?? 0);
  if (!Number.isFinite(ms) || hours > 23 || minutes > 59) return null;
  const offset = (hours * 60 + minutes) * 60_000 * (match[3] === "-" ? -1 : 1);
  const localMs = ms + offset;
  if (!Number.isFinite(localMs) || Math.abs(localMs) > 8.64e15) return null;
  return new Date(localMs).toISOString().slice(0, 19) === match[1] ? ms : null;
}

function normalizedSubject(subject: string): string {
  return subject.normalize("NFKC").toLowerCase()
    .replace(/\b\d{4}[-./]\d{1,2}[-./]\d{1,2}(?:t|\s+)\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:z|\s*(?:kst|utc)|[+-]\d{2}:?\d{2})?/g, " <datetime> ")
    .replace(/\b\d{4}[-./]\d{1,2}[-./]\d{1,2}\b/g, " <date> ")
    .replace(/\d{4}년\s*\d{1,2}월\s*\d{1,2}일/g, " <date> ")
    .replace(/\b\d{1,2}\/\d{1,2}\b|\d{1,2}월\s*\d{1,2}일/g, " <date> ")
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:kst|utc))?/g, " <time> ")
    .replace(/\d{1,2}시\s*(?:\d{1,2}분)?(?:\s*\d{1,2}초)?/g, " <time> ")
    .replace(/\d[\d,]*\s*(건|명|회|개)/g, "<count>$1")
    .replace(/\s+/g, " ").trim();
}

/** Metadata-only admission. Non-actionable success is evidence, never incident closure. */
export function classifyOperationsMail(
  message: GmailMetadata,
  labels: Record<string, string>,
  activatedAt: string,
): OperationsMailClassification | null {
  if (!message || !isHexId(message.id)
    || (message.threadId !== undefined && !isHexId(message.threadId))) return null;
  const cutoff = activationTime(activatedAt);
  if (cutoff === null || typeof message.internalDate !== "string"
    || !/^[1-9]\d{0,15}$/.test(message.internalDate)) return null;
  const receivedMs = Number(message.internalDate);
  if (!Number.isSafeInteger(receivedMs) || receivedMs > 253402300799999 || receivedMs < cutoff) return null;
  if (!Array.isArray(message.labelIds) || !message.labelIds.every(id => typeof id === "string")
    || !message.labelIds.includes("SENT")
    || message.labelIds.some(id => id === "SPAM" || id === "TRASH")) return null;
  if (!labels || typeof labels !== "object" || Array.isArray(labels)) return null;

  const headers = message.payload?.headers;
  if (!Array.isArray(headers)) return null;
  const selected = new Map<string, string>();
  for (const header of headers) {
    if (!header || typeof header.name !== "string" || typeof header.value !== "string"
      || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(header.name)
      || /[\x00-\x1f\x7f]/.test(header.name + header.value)) return null;
    const name = header.name.toLowerCase();
    if (name !== "from" && name !== "to" && name !== "subject") continue;
    if (selected.has(name)) return null;
    selected.set(name, header.value);
  }
  if (!isOwnMailbox(selected.get("from") ?? "") || !isOwnMailbox(selected.get("to") ?? "")) return null;
  const subject = selected.get("subject");
  if (!subject || subject.length > 2048) return null;
  const parsed = /^\[([^\[\]]+)\]\[([^\[\]]+)\]\s+\S/.exec(subject);
  if (!parsed || !Object.hasOwn(AREAS, parsed[1]) || !Object.hasOwn(STATUSES, parsed[2])) return null;
  const areaLabel = parsed[1] as keyof typeof AREAS;
  const statusLabel = parsed[2] as keyof typeof STATUSES;
  const requiredLabel = `${areaLabel} 보고`;
  if (!message.labelIds.some(id => Object.hasOwn(labels, id) && labels[id] === requiredLabel)) return null;

  const status = STATUSES[statusLabel];
  const actionable = status === "failure" || status === "urgent" || status === "attention";
  const isTest = /\[연결테스트\]/.test(subject);
  return {
    messageId: message.id.toLowerCase(),
    threadId: (message.threadId ?? message.id).toLowerCase(),
    receivedAt: new Date(receivedMs).toISOString(),
    area: AREAS[areaLabel],
    areaLabel,
    status,
    priority: status === "failure" || status === "urgent" ? "high" : "normal",
    title: `${areaLabel} ${statusLabel} 보고`,
    incidentKey: createHash("sha256").update(JSON.stringify([OPS_MAIL.source, isTest, normalizedSubject(subject)])).digest("hex"),
    actionable,
    isTest,
  };
}
