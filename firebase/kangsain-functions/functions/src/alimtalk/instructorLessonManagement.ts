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

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
