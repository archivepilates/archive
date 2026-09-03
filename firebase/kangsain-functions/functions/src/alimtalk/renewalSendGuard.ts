import type { AlimtalkCandidateDoc, MemberProfileDoc } from "../types/models";
import { refs } from "../firestore/refs";
import {
  hasSameKindAlternativeTicket,
  isRenewalManagedTicket,
  renewalTicketKind,
} from "../renewal/renewalPolicy";

const RENEWAL_TYPES = new Set([
  "ticket_expiring",
  "remaining_low",
  "private_count_low",
  "private_ticket_expiring",
]);

export async function renewalCandidateSendabilityIssue(candidate: AlimtalkCandidateDoc): Promise<string> {
  if (!RENEWAL_TYPES.has(candidate.type)) return "";
  const profile = (await refs.memberProfile(candidate.memberId).get()).data();
  if (!profile) return "최신 회원 프로필 없음";
  return renewalCandidateProfileIssue(candidate, profile);
}

export function renewalCandidateProfileIssue(
  candidate: AlimtalkCandidateDoc,
  profile: MemberProfileDoc,
): string {
  if (!RENEWAL_TYPES.has(candidate.type)) return "";
  const tickets = (profile.activeTickets || []).filter((ticket) => currentTicket(ticket, candidate.sourceDate));
  const target = tickets.find((ticket) => sameTicket(candidate, ticket));
  if (!target) return "최신 수강권 상태에서 안내 대상 아님";
  if (!isRenewalManagedTicket(target)) return "재등록 안내 제외 수강권";
  if (hasSameKindAlternativeTicket(tickets, target, candidate.sourceDate))
    return "현재 또는 사용예정 동일 유형 후속 수강권 보유";

  const remaining = target.remainingCount == null ? Number.NaN : Number(target.remainingCount);
  const expiryDays = daysUntil(target.expiresAt?.toDate?.(), candidate.sourceDate);
  const privateTicket = renewalTicketKind(target) === "private";
  if (candidate.type === "private_count_low") {
    if (!privateTicket || !Number.isFinite(remaining) || remaining < 1 || remaining > 3)
      return "최신 프라이빗 잔여횟수 기준에서 안내 대상 아님";
  }
  if (candidate.type === "remaining_low") {
    if (privateTicket || !Number.isFinite(remaining) || remaining < 1 || remaining >= 5)
      return "최신 그룹 잔여횟수 기준에서 안내 대상 아님";
  }
  if (candidate.type === "private_ticket_expiring") {
    if (!privateTicket || !Number.isFinite(expiryDays) || expiryDays < 0 || expiryDays > 14)
      return "최신 프라이빗 만료일 기준에서 안내 대상 아님";
  }
  if (candidate.type === "ticket_expiring") {
    if (privateTicket || !Number.isFinite(expiryDays) || expiryDays < 0 || expiryDays > 14)
      return "최신 그룹 만료일 기준에서 안내 대상 아님";
  }
  return "";
}

function sameTicket(
  candidate: AlimtalkCandidateDoc,
  ticket: NonNullable<MemberProfileDoc["activeTickets"]>[number],
): boolean {
  const payload = candidate.payload || {};
  if (payload.userTicketId) return String(ticket.userTicketId || "") === String(payload.userTicketId);
  if (payload.ticketId) return String(ticket.ticketId || "") === String(payload.ticketId);
  return String(ticket.name || "") === String(payload.ticketName || "");
}

function currentTicket(
  ticket: NonNullable<MemberProfileDoc["activeTickets"]>[number],
  sourceDate: string,
): boolean {
  if (!ticket.name || ticket.expiryLevel === "expired") return false;
  const expiresAt = ticket.expiresAt?.toDate?.();
  if (expiresAt && dateText(expiresAt) < sourceDate) return false;
  const remaining = ticket.remainingCount == null ? Number.NaN : Number(ticket.remainingCount);
  return !Number.isFinite(remaining) || remaining > 0;
}

function daysUntil(value: Date | undefined, sourceDate: string): number {
  if (!value) return Number.NaN;
  const start = new Date(`${sourceDate}T00:00:00+09:00`).getTime();
  const end = new Date(`${dateText(value)}T00:00:00+09:00`).getTime();
  return Math.floor((end - start) / (24 * 60 * 60 * 1000));
}

function dateText(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
