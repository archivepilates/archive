export function sanitizeLogText(value: unknown, maxLength = 300): string {
  return String(value ?? "")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]")
    .replace(/010\d{7,8}/g, "010********")
    .slice(0, maxLength);
}
