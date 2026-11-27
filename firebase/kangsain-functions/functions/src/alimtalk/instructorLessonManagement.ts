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
  "2026-10-24": "external-feedback",
  "2026-10-25": "external-feedback",
};

// The November #10 workshop uses short Korean A–D titles and the ordinary 2T pass.
const METHOD_10_STUDIOMATE_TITLES: Readonly<Record<string, RegExp>> = {
  "2026-11-28": /^11월\s+강사레슨\s+[AB]$/i,
  "2026-11-29": /^11월\s+강사레슨\s+[CD]$/i,
};

export function instructorLessonManagementNumberFor(input: {
  title: string;
  lessonDate: string;
  teamLesson?: boolean;
}): string {
  const lessonDate = normalizedLessonDate(input.lessonDate);
  if (!lessonDate) return "";
  // A canonical Team pass gets its own date-bound route, not a guessed METHOD topic.
  const method10 = !input.teamLesson && METHOD_10_STUDIOMATE_TITLES[lessonDate]?.test(input.title.trim());
  const topicSlug = method10 ? "full-body-integration" : input.teamLesson
    ? instructorLessonTopicSlug(input.title) || "team"
    : INSTRUCTOR_LESSON_TOPIC_SLUG_BY_DATE[lessonDate] || instructorLessonTopicSlug(input.title);
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
  const topic = topicWords.join("-");
  // StudioMate team labels are not material topics.
  return /^(?:[a-z]|team(?:-[a-z])?)$/.test(topic) ? "" : topic;
}

function normalizedLessonDate(value: string): string {
  const match = String(value || "")
    .trim()
    .match(/(\d{4})[-./년\s]*(\d{1,2})[-./월\s]*(\d{1,2})/);
  if (!match) return "";
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}
