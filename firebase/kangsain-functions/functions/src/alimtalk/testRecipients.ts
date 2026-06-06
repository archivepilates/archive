import type { AlimtalkCandidateDoc, MemberProfileDoc } from "../types/models";

type AlimtalkRecipientLike = Partial<
  Pick<AlimtalkCandidateDoc, "memberId" | "memberName" | "memberPhone"> &
    Pick<MemberProfileDoc, "name" | "phone">
>;

const TEST_RECIPIENTS = [
  {
    memberId: "1982133",
    name: "김기효",
    phone: "01086488585",
    reason: "운영자 알림톡 실발송 테스트",
  },
] as const;

const TEST_MEMBER_IDS = new Set<string>(TEST_RECIPIENTS.map((recipient) => recipient.memberId));
const TEST_PHONES = new Set<string>(TEST_RECIPIENTS.map((recipient) => normalizeRecipientPhone(recipient.phone)));

export function isAlimtalkTestRecipient(input: AlimtalkRecipientLike): boolean {
  const memberId = String(input.memberId || "").trim();
  if (memberId && TEST_MEMBER_IDS.has(memberId)) return true;
  const phone = normalizeRecipientPhone(input.memberPhone || input.phone || "");
  const name = normalizeRecipientName(input.memberName || input.name || "");
  return Boolean(phone && TEST_PHONES.has(phone) && name === "김기효");
}

export function alimtalkTestRecipientReason(input: AlimtalkRecipientLike): string {
  if (!isAlimtalkTestRecipient(input)) return "";
  const phone = normalizeRecipientPhone(input.memberPhone || input.phone || "");
  const memberId = String(input.memberId || "").trim();
  const match = TEST_RECIPIENTS.find(
    (recipient) => recipient.memberId === memberId || normalizeRecipientPhone(recipient.phone) === phone,
  );
  return match?.reason || "운영자 알림톡 실발송 테스트";
}

export function normalizeRecipientPhone(value: string): string {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("8210")) return `0${digits.slice(2)}`;
  return digits;
}

function normalizeRecipientName(value: string): string {
  return String(value || "").replace(/\s+/g, "").trim();
}
