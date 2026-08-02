import type { BookingDoc, MemberProfileDoc } from "../types/models";

export type RenewalTicketKind = "group" | "private" | "lesson";

type ActiveTicket = NonNullable<MemberProfileDoc["activeTickets"]>[number];

const DAY_MS = 24 * 60 * 60 * 1000;
const RENEWAL_EXCLUDED_TICKET_KEYWORDS = [
  "강사레슨",
  "강사용",
  "직원",
  "상담",
  "체험",
  "락커",
  "양말",
  "토삭스",
  "상품권",
];

export interface RenewalUsageSummary {
  weeklyPace: number;
  consumedCount: number;
  lookbackDays: number;
  nextBookingDate: string;
  lastUsageDate: string;
}

export interface RenewalAssessment {
  kind: RenewalTicketKind;
  priority: "urgent" | "warning" | "follow";
  reason: string;
  remainingCount: number | null;
  remainingDays: number | null;
  predictedDepletionDate: string;
  predictedDepletionDays: number | null;
  usage: RenewalUsageSummary;
  recommendation: string;
}

export function renewalTicketKind(ticket: Pick<ActiveTicket, "classType" | "name">): RenewalTicketKind {
  const text = `${String(ticket.classType || "")} ${String(ticket.name || "")}`.toLowerCase();
  if (/듀엣|duet|세미|semi|프라이빗|개인|1:1|private/.test(text)) return "private";
  if (/그룹|group|소그룹/.test(text)) return "group";
  return "lesson";
}

export function isRenewalManagedTicket(ticket: Pick<ActiveTicket, "name">): boolean {
  const name = String(ticket.name || "").trim();
  return Boolean(name) && !RENEWAL_EXCLUDED_TICKET_KEYWORDS.some((keyword) => name.includes(keyword));
}

export function renewalCountThreshold(kind: RenewalTicketKind): number {
  return kind === "private" ? 3 : 5;
}

export function hasSameKindAlternativeTicket(tickets: ActiveTicket[], target: ActiveTicket): boolean {
  const targetKind = renewalTicketKind(target);
  return tickets.some((ticket) => ticket !== target && renewalTicketKind(ticket) === targetKind);
}

export function renewalSourceTicketKey(
  memberId: string,
  kind: RenewalTicketKind,
  ticket: ActiveTicket,
): string {
  if (ticket.userTicketId) return `user:${ticket.userTicketId}`;
  const availableFrom = ticket.availableFrom?.toMillis?.() || "";
  const extended = ticket as ActiveTicket & { paymentAt?: { toMillis?: () => number } | null };
  const paymentAt = extended.paymentAt?.toMillis?.() || "";
  return [
    `member:${memberId}`,
    `kind:${kind}`,
    `name:${String(ticket.name || "").trim().toLowerCase()}`,
    `from:${availableFrom}`,
    `paid:${paymentAt}`,
    `max:${ticket.maxCount ?? ""}`,
  ].join("|");
}

export function renewalBookingKind(booking: BookingDoc): RenewalTicketKind {
  const text = `${String(booking.lessonType || "")} ${String(booking.ticketClassType || "")} ${String(
    booking.ticketType || "",
  )} ${String(booking.ticketName || "")}`.toLowerCase();
  if (/듀엣|duet|세미|semi_private|프라이빗|개인|1:1|private/.test(text)) return "private";
  if (/그룹|group|소그룹/.test(text)) return "group";
  return "lesson";
}

export function renewalUsageSummary(
  bookings: BookingDoc[],
  kind: RenewalTicketKind,
  sourceDate: string,
  lookbackDays = 56,
): RenewalUsageSummary {
  const startDate = addDays(sourceDate, -(lookbackDays - 1));
  const relevant = bookings.filter((booking) => renewalBookingKind(booking) === kind);
  const consumed = relevant.filter(
    (booking) =>
      booking.lectureDate >= startDate &&
      booking.lectureDate <= sourceDate &&
      ["attended", "absent", "late_cancel"].includes(String(booking.attendanceStatus || "")),
  );
  const nextBooking = relevant
    .filter((booking) => booking.appStatus === "reserved" && booking.lectureDate > sourceDate)
    .sort((a, b) => a.lectureDate.localeCompare(b.lectureDate))[0];
  const lastUsage = consumed.slice().sort((a, b) => b.lectureDate.localeCompare(a.lectureDate))[0];
  return {
    weeklyPace: roundToOneDecimal((consumed.length / lookbackDays) * 7),
    consumedCount: consumed.length,
    lookbackDays,
    nextBookingDate: nextBooking?.lectureDate || "",
    lastUsageDate: lastUsage?.lectureDate || "",
  };
}

export function assessRenewalTicket(input: {
  ticket: ActiveTicket;
  bookings: BookingDoc[];
  sourceDate: string;
}): RenewalAssessment | null {
  const { ticket, bookings, sourceDate } = input;
  if (!isRenewalManagedTicket(ticket)) return null;
  const kind = renewalTicketKind(ticket);
  const remainingCount = finiteNumber(ticket.remainingCount);
  const remainingDays = ticket.expiresAt ? daysBetween(sourceDate, dateText(ticket.expiresAt.toDate())) : null;
  const usage = renewalUsageSummary(bookings, kind, sourceDate);
  const predictedDepletionDays =
    remainingCount == null || usage.weeklyPace <= 0
      ? null
      : Math.max(0, Math.ceil((remainingCount / usage.weeklyPace) * 7));
  const predictedDepletionDate = predictedDepletionDays == null ? "" : addDays(sourceDate, predictedDepletionDays);
  const countRisk = remainingCount != null && remainingCount <= renewalCountThreshold(kind);
  const expiryRisk = remainingDays != null && remainingDays <= 30;
  const paceRisk = predictedDepletionDays != null && predictedDepletionDays <= 30;
  if (!countRisk && !expiryRisk && !paceRisk) return null;

  const reasons: string[] = [];
  if (remainingDays != null && remainingDays < 0) reasons.push("기간 만료");
  else if (expiryRisk) reasons.push(`만료 D-${remainingDays}`);
  if (countRisk) reasons.push(`잔여 ${remainingCount}회`);
  if (paceRisk && predictedDepletionDate) reasons.push(`예상 소진 ${predictedDepletionDate}`);
  const urgent =
    (remainingDays != null && remainingDays <= 7) ||
    (predictedDepletionDays != null && predictedDepletionDays <= 7) ||
    (remainingCount != null && remainingCount <= (kind === "private" ? 1 : 2));
  const warning =
    urgent ||
    (remainingDays != null && remainingDays <= 14) ||
    (predictedDepletionDays != null && predictedDepletionDays <= 14) ||
    (remainingCount != null && remainingCount <= (kind === "private" ? 2 : 3));

  return {
    kind,
    priority: urgent ? "urgent" : warning ? "warning" : "follow",
    reason: reasons.join(" · "),
    remainingCount,
    remainingDays,
    predictedDepletionDate,
    predictedDepletionDays,
    usage,
    recommendation: renewalRecommendation(kind, usage.weeklyPace),
  };
}

export function renewalRecommendation(kind: RenewalTicketKind, weeklyPace: number): string {
  if (kind === "private") {
    if (weeklyPace >= 2) return "프라이빗 30회 중심 상담";
    if (weeklyPace >= 1) return "프라이빗 20회 중심 상담";
    return "프라이빗 10회 중심 상담";
  }
  if (kind === "group") {
    if (weeklyPace >= 3) return "그룹 50회 중심 상담";
    if (weeklyPace >= 2) return "그룹 30회 중심 상담";
    return "그룹 20회 중심 상담";
  }
  return "현재 이용 패턴 기준 재등록 상담";
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function dateText(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function daysBetween(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00+09:00`).getTime();
  const end = new Date(`${endDate}T00:00:00+09:00`).getTime();
  return Math.floor((end - start) / DAY_MS);
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00+09:00`);
  value.setUTCDate(value.getUTCDate() + days);
  return dateText(value);
}
