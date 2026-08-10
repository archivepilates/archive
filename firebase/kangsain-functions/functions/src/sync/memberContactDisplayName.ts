import type { Timestamp } from "firebase-admin/firestore";

export const INSTRUCTOR_MEMBER_GRADE = "강사회원";

export function formatMemberContactDisplayName(
  name: string,
  registeredAt: Timestamp | null,
  memberGrade: string,
): string {
  const normalizedName = name.trim();
  const compactRegisteredAt = registeredAt ? compactDateKst(registeredAt.toDate()) : "";
  if (isInstructorMemberGrade(memberGrade)) {
    return [normalizedName, "강사회원", compactRegisteredAt].filter(Boolean).join(" ");
  }
  return [normalizedName, "회원", compactRegisteredAt].filter(Boolean).join(" ");
}

export function resolveMemberGrade(sourceValue: string, previousValue: string): string {
  return normalizeMemberGrade(sourceValue) || normalizeMemberGrade(previousValue);
}

export function resolveQueuedMemberContactDisplayName(
  queuedDisplayName: string,
  memberName: string,
  memberGrade: string,
  registeredAt: Timestamp | null,
): string {
  if (!isInstructorMemberGrade(memberGrade)) return queuedDisplayName.trim() || memberName.trim();
  return formatMemberContactDisplayName(memberName, registeredAt, memberGrade);
}

export function buildInstructorLessonContactGroupNames(dates: string[]): string[] {
  const normalizedDates = [...new Set(dates.map(normalizeIsoDate).filter(Boolean))].sort();
  if (!normalizedDates.length) return [];
  return ["강사레슨", ...normalizedDates.map((date) => `강사레슨 ${date}`)];
}

export function isInstructorMemberGrade(value: string): boolean {
  return normalizeMemberGrade(value) === INSTRUCTOR_MEMBER_GRADE;
}

export function normalizeMemberGrade(value: string): string {
  return String(value || "").trim().replace(/\s+/g, "");
}

function compactDateKst(date: Date): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date).replace(/^20/, "").replaceAll("-", "");
}

function normalizeIsoDate(value: string): string {
  const match = String(value || "")
    .trim()
    .replaceAll(".", "-")
    .match(/^(20\d{2})-(\d{1,2})-(\d{1,2})/);
  if (!match) return "";
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}
