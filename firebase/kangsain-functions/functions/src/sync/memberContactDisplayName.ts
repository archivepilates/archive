import type { Timestamp } from "firebase-admin/firestore";

export const INSTRUCTOR_MEMBER_GRADE = "강사회원";

export function formatMemberContactDisplayName(
  name: string,
  registeredAt: Timestamp | null,
  memberGrade: string,
): string {
  const normalizedName = name.trim();
  if (isInstructorMemberGrade(memberGrade)) return `${normalizedName} 강사회원`;
  const compactRegisteredAt = registeredAt ? compactDateKst(registeredAt.toDate()) : "";
  return [normalizedName, "회원", compactRegisteredAt].filter(Boolean).join(" ");
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
