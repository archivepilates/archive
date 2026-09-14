import { normalizeMembershipPhone } from "./membershipContractPolicy";
import { MEMBERSHIP_WELCOME_TEMPLATE } from "./membershipWelcomePolicy";
import { MEMBERSHIP_WELCOME_HISTORY_TEMPLATE_IDS } from "./membershipWelcomeHistory";

export type ProviderGet = (url: string) => Promise<any>;

export interface MembershipProviderHistoryInput {
  phone: string;
  startAt: string;
  now: string;
  coverageVerified: boolean;
  /** Trusted caller attestation of an independent template audit, never inferred from message text.
   * Omitting this input means an empty allowlist. General history coverage is not this audit. */
  nonWelcomeTemplateAllowlist?: {
    independentlyAudited: boolean;
    auditId: string;
    templateIds: readonly string[];
  };
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const templateId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);

function auditedNonWelcomeTemplates(value: unknown): Set<string> | null {
  if (value === undefined) return new Set();
  if (
    !record(value) ||
    value.independentlyAudited !== true ||
    typeof value.auditId !== "string" ||
    !value.auditId ||
    value.auditId !== value.auditId.trim() ||
    !Array.isArray(value.templateIds)
  )
    return null;
  const ids = new Set<string>();
  for (const id of value.templateIds) {
    if (!templateId(id) || ids.has(id) || MEMBERSHIP_WELCOME_HISTORY_TEMPLATE_IDS.includes(id)) return null;
    ids.add(id);
  }
  return ids;
}

/** Explicit-zone RFC3339 instants only; reject coercion, calendar rollover and nonfinite dates. */
function instant(value: unknown): number {
  if (typeof value !== "string") return NaN;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) return NaN;
  const [, year, month, day, hour, minute, second, zone, zoneHour, zoneMinute] = match;
  const date = new Date(0);
  date.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day) ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59 ||
    zone === "-00:00" ||
    (zone !== "Z" &&
      (Number(zoneHour) > 14 || Number(zoneMinute) > 59 || (Number(zoneHour) === 14 && Number(zoneMinute) !== 0)))
  )
    return NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : NaN;
}

function messageTemplate(row: Record<string, unknown>): { code: string; issue: string } {
  if (Object.hasOwn(row, "kakaoOptions") && !record(row.kakaoOptions)) {
    return { code: "", issue: "invalid_provider_template_metadata" };
  }
  const codes: unknown[] = [];
  if (record(row.kakaoOptions) && Object.hasOwn(row.kakaoOptions, "templateId"))
    codes.push(row.kakaoOptions.templateId);
  if (Object.hasOwn(row, "templateId")) codes.push(row.templateId);
  if (!codes.length) return { code: "", issue: "provider_template_missing" };
  if (!codes.every(templateId)) return { code: "", issue: "invalid_provider_template_metadata" };
  if (new Set(codes).size !== 1) return { code: "", issue: "conflicting_provider_template_metadata" };
  return { code: codes[0], issue: "" };
}

/** Exhaust pagination; an empty/default date window is never proof of all-time history. */
export async function loadMembershipProviderHistory(get: ProviderGet, input: MembershipProviderHistoryInput) {
  const records: Array<{ id: string; family: string; status: string; attempted: boolean }> = [];
  const incomplete = (reason: string) => ({ complete: false, reason, records });
  const phone = normalizeMembershipPhone(input.phone);
  const start = instant(input.startAt);
  const now = instant(input.now);
  if (!phone || input.coverageVerified !== true || !Number.isFinite(start) || !Number.isFinite(now) || start > now)
    return incomplete("provider_coverage_not_verified");
  const nonWelcomeTemplates = auditedNonWelcomeTemplates(input.nonWelcomeTemplateAllowlist);
  if (!nonWelcomeTemplates) return incomplete("invalid_non_welcome_template_allowlist");
  let cursor = "";
  const cursors = new Set<string>();
  const ids = new Set<string>();
  try {
    for (let page = 0; page < 20; page += 1) {
      const params = new URLSearchParams({
        to: phone,
        type: "ATA",
        startDate: input.startAt,
        endDate: input.now,
        dateType: "CREATED",
        limit: "500",
        ...(cursor ? { startKey: cursor } : {}),
      });
      const result: unknown = await get(`https://api.solapi.com/messages/v4/list?${params}`);
      if (!record(result) || !record(result.messageList)) return incomplete("invalid_provider_page");
      for (const [id, row] of Object.entries(result.messageList)) {
        if (!id || !record(row) || ids.has(id) || row.messageId !== id || normalizeMembershipPhone(row.to) !== phone)
          return incomplete("invalid_provider_identity");
        ids.add(id);
        const { code, issue } = messageTemplate(row);
        if (issue) return incomplete(issue);
        const known = MEMBERSHIP_WELCOME_HISTORY_TEMPLATE_IDS.includes(code);
        if (!known && !nonWelcomeTemplates.has(code)) return incomplete("unknown_welcome_template");
        if (known)
          records.push({
            id: `solapi/${id}`,
            family: "new_member_welcome",
            status: String(row.statusCode) === "4000" ? "delivered" : "unknown",
            attempted: true,
          });
      }
      if (result.nextKey == null || result.nextKey === "") return { complete: true, reason: "", records };
      if (typeof result.nextKey !== "string" || cursors.has(result.nextKey))
        return incomplete("provider_cursor_repeated");
      cursors.add(result.nextKey);
      cursor = result.nextKey;
    }
    return incomplete("provider_page_limit");
  } catch {
    return incomplete("provider_history_unavailable");
  }
}

export async function loadMembershipWelcomeTemplate(get: ProviderGet) {
  return get(`https://api.solapi.com/kakao/v2/templates/${MEMBERSHIP_WELCOME_TEMPLATE.templateId}`);
}
