export function normalizeInstructorLessonManagementNumber(rawManagementNumber: string): string {
  const raw = String(rawManagementNumber || "").trim().toLowerCase();
  if (!raw) return "";

  const decoded = safeDecodeURIComponent(raw);
  const pathPart = decoded.split(/[?#]/)[0] || "";
  const methodSuffix = pathPart.includes("/method/") ? pathPart.split("/method/").pop() || "" : pathPart;
  const compact = methodSuffix.split("/").filter(Boolean).pop() || methodSuffix;
  const tokens = compact
    .split("-")
    .map((token) => token.trim())
    .filter(Boolean);

  if (!tokens.length) return "";
  if (!/^\d{6}$/.test(tokens[tokens.length - 1])) return "";

  const topicDateRemoved = tokens.slice(0, -1);
  const topicWords: string[] = [];
  let hasStarted = false;

  for (const token of topicDateRemoved) {
    if (!/^[a-z]+$/.test(token)) {
      if (!hasStarted) {
        continue;
      }
      break;
    }
    hasStarted = true;
    topicWords.push(token);
  }

  if (!topicWords.length) return "";
  return `${topicWords.join("-")}-${tokens[tokens.length - 1]}`;
}

export function isValidInstructorLessonManagementNumber(managementNumber: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*-\d{6}$/.test(String(managementNumber || ""));
}

const INSTRUCTOR_LESSON_TOPIC_SLUG_BY_DATE: Readonly<Record<string, string>> = {
  "2026-08-29": "support-movement",
  "2026-08-30": "support-movement",
};

export function instructorLessonManagementNumberFor(input: {
  title: string;
  lessonDate: string;
}): string {
  const lessonDate = normalizedLessonDate(input.lessonDate);
  if (!lessonDate) return "";
  const topicSlug = INSTRUCTOR_LESSON_TOPIC_SLUG_BY_DATE[lessonDate] || instructorLessonTopicSlug(input.title);
  if (!topicSlug) return "";
  const managementNumber = `${topicSlug}-${lessonDate.slice(2).replace(/-/g, "")}`;
  return isValidInstructorLessonManagementNumber(managementNumber) ? managementNumber : "";
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function instructorLessonTopicSlug(title: string): string {
  const normalizedText = String(title || "")
    .toLowerCase()
    .replace(/_/g, "-");
  const tokens = normalizedText.split(/[^a-z0-9]+/g).flatMap((token) => token.split("-").filter(Boolean));
  const topicWords: string[] = [];
  let hasStarted = false;

  for (const token of tokens) {
    if (!/^[a-z]+$/.test(token)) {
      if (!hasStarted) continue;
      break;
    }
    hasStarted = true;
    topicWords.push(token);
  }
  return topicWords.join("-");
}

function normalizedLessonDate(value: string): string {
  const match = String(value || "")
    .trim()
    .match(/(\d{4})[-./년\s]*(\d{1,2})[-./월\s]*(\d{1,2})/);
  if (!match) return "";
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}
