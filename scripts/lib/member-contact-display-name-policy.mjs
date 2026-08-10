export const INSTRUCTOR_MEMBER_GRADE = "강사회원";

export function resolveMemberGrade(rows) {
  const grades = rows.map((row) => normalizeMemberGrade(row["등급"] || row["회원구분"] || "")).filter(Boolean);
  if (grades.includes(INSTRUCTOR_MEMBER_GRADE)) return INSTRUCTOR_MEMBER_GRADE;
  return grades[0] || "";
}

export function formatExcelMemberContactDisplayName({
  name,
  compactRegisteredAt,
  memberGrade,
  activeStaff,
}) {
  const normalizedName = String(name || "").trim();
  if (activeStaff) return `${normalizedName} 아카이브`;
  if (normalizeMemberGrade(memberGrade) === INSTRUCTOR_MEMBER_GRADE) return `${normalizedName} 강사회원`;
  return [normalizedName, "회원", compactRegisteredAt].filter(Boolean).join(" ");
}

export function normalizeMemberGrade(value) {
  return String(value || "").trim().replace(/\s+/g, "");
}
