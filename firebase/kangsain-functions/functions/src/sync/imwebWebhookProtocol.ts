import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const IMWEB_LANE = "workLanes/imweb-app-webhook-onboarding";
export const IMWEB_SITE = "S20260516852c71a014d08";
export const IMWEB_UNIT = "u2026051698c99ea234719";
export const IMWEB_EVENTS: Record<string, string> = {
  signup: "END_USER_SIGN_UP",
  "signup-bulk": "END_USER_SIGN_UP_BULK",
  grade: "END_USER_GRADE_UPDATE",
};
export const hashValue = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export function validProbeWindow(start: unknown, end: unknown, now: number): boolean {
  return typeof start === "number" && typeof end === "number" && Number.isFinite(start) && Number.isFinite(end) &&
    Number.isFinite(now) && start <= now && end > now && end > start && end - start <= 20 * 60_000;
}
export function matchesDigest(value: unknown, digest: unknown): boolean {
  if (typeof value !== "string" || value.length < 16 || value.length > 8192 ||
      typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest)) return false;
  return timingSafeEqual(Buffer.from(hashValue(value), "hex"), Buffer.from(digest, "hex"));
}
export function recordShape(value: unknown, depth = 0): unknown {
  if (depth > 4) return "bounded";
  if (Array.isArray(value)) return { type: "array", length: value.length, items: value.slice(0, 2).map(v => recordShape(v, depth + 1)) };
  if (value && typeof value === "object") {
    const allowed = new Set(["siteCode", "unitCode", "memberUid", "memberUidList", "gradeCodes"]);
    const entries = Object.entries(value);
    return { fields: Object.fromEntries(entries.filter(([key]) => allowed.has(key))
      .map(([key, child]) => [key, recordShape(child, depth + 1)])),
      unknownFieldCount: entries.filter(([key]) => !allowed.has(key)).length };
  }
  return value === null ? "null" : typeof value;
}
export function probeEvidence(headers: Record<string, unknown>, body: unknown, probeToken: string) {
  if (!/^[a-f0-9]{64}$/.test(probeToken)) throw Error("probe_key_required");
  const keyedHash = (value: string) => createHmac("sha256", probeToken).update(value).digest("hex");
  const authNames = new Set(["authorization", "x-imweb-signature", "x-imweb-auth", "x-imweb-token", "imweb-signature"]);
  const knownNames = new Set([...authNames, "content-type", "content-length", "user-agent", "accept", "host"]);
  const candidates = Object.entries(headers).filter(([name, value]) => authNames.has(name) &&
    typeof value === "string" && value.length >= 16 && value.length <= 8192 &&
    !value.includes("\n"));
  // Never persist raw headers, auth values, cookies, member identifiers or bodies.
  return { headerNames: Object.keys(headers).filter(name => knownNames.has(name)).sort(),
    unknownHeaderNameDigests: Object.keys(headers).filter(name => !knownNames.has(name)).map(keyedHash).sort(),
    candidateHeaderDigests: Object.fromEntries(candidates.map(([name, value]) => [name, keyedHash(String(value))])),
    bodyShape: recordShape(body) };
}
