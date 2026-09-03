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
  if (normalizeMemberGrade(memberGrade) === INSTRUCTOR_MEMBER_GRADE) {
    return [normalizedName, "강사회원", compactRegisteredAt].filter(Boolean).join(" ");
  }
  return [normalizedName, "회원", compactRegisteredAt].filter(Boolean).join(" ");
}

export function resolveInstructorLessonDates(rows, previousDates = []) {
  const currentDates = rows
    .filter((row) => /강사\s*레슨/i.test(String(row["수강권명"] || row["수강권"] || "")))
    .map((row) => normalizeIsoDate(row["수강권시작일"] || ""))
    .filter(Boolean);
  return [...new Set([...previousDates.map(normalizeIsoDate).filter(Boolean), ...currentDates])].sort();
}

export function buildInstructorLessonContactGroupNames(dates) {
  const normalizedDates = [...new Set(dates.map(normalizeIsoDate).filter(Boolean))].sort();
  if (!normalizedDates.length) return [];
  return ["강사레슨", ...normalizedDates.map((date) => `강사레슨 ${date}`)];
}

export function normalizeMemberGrade(value) {
  return String(value || "").trim().replace(/\s+/g, "");
}

function normalizeIsoDate(value) {
  const match = String(value || "")
    .trim()
    .replaceAll(".", "-")
    .match(/^(20\d{2})-(\d{1,2})-(\d{1,2})/);
  if (!match) return "";
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}
