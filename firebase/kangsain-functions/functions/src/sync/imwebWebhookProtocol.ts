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
export function recordShape(value: unknown, depth = 0, keyHash: (value: string) => string = hashValue): unknown {
  if (depth > 4) return "bounded";
  if (Array.isArray(value)) return { type: "array", length: value.length, items: value.slice(0, 2).map(v => recordShape(v, depth + 1, keyHash)) };
  if (value && typeof value === "object") {
    const allowed = new Set(["siteCode", "unitCode", "memberUid", "memberUidList", "gradeCodes"]);
    const entries = Object.entries(value);
    return { fields: Object.fromEntries(entries.filter(([key]) => allowed.has(key))
      .map(([key, child]) => [key, recordShape(child, depth + 1, keyHash)])),
      unknownFields: Object.fromEntries(entries.filter(([key]) => !allowed.has(key)).slice(0, 50)
        .map(([key, child]) => [keyHash(key), recordShape(child, depth + 1, keyHash)])),
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
    bodyShape: recordShape(body, 0, keyedHash) };
}

function exactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function validUid(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Buffer.byteLength(value) <= 256 &&
    !/[\s\p{Cc}\p{Cf}\p{Cs}]/u.test(value);
}
export function normalizeImwebWire(body: unknown, route: string) {
  if (!Object.hasOwn(IMWEB_EVENTS, route) || !exactKeys(body, ["eventType", "eventTime", "data"]) ||
      body.eventType !== IMWEB_EVENTS[route] || !Number.isSafeInteger(body.eventTime) || Number(body.eventTime) <= 0)
    throw Error("invalid_envelope");
  const data = body.data;
  const keys = route === "signup-bulk" ? ["siteCode", "unitCode", "memberUidList"] :
    route === "grade" ? ["siteCode", "unitCode", "memberUid", "gradeCodes"] : ["siteCode", "unitCode", "memberUid"];
  if (!exactKeys(data, keys)) throw Error("invalid_schema");
  let uids: string[];
  if (route === "signup-bulk") {
    if (!Array.isArray(data.memberUidList) || !data.memberUidList.length || data.memberUidList.length > 50 ||
        !data.memberUidList.every(validUid)) throw Error("invalid_identity");
    uids = [...new Set(data.memberUidList)];
  } else {
    if (!validUid(data.memberUid)) throw Error("invalid_identity");
    uids = [data.memberUid];
  }
  if (route === "grade" && (!Array.isArray(data.gradeCodes) || data.gradeCodes.length > 50 ||
      !data.gradeCodes.every(code => typeof code === "string" && /^g[0-9a-f]{21}$/.test(code))))
    throw Error("invalid_grade_codes");
  const ownSite = data.siteCode === IMWEB_SITE && data.unitCode === IMWEB_UNIT;
  const sampleUids = route === "signup-bulk" ? ["test_member1@imweb.me", "test_member2@imweb.me", "test_member3@imweb.me"] : ["test_member@imweb.me"];
  const providerSample = data.siteCode === "S2025012450f7813d2ddau" && data.unitCode === "u2025012465b0fbe8ce0dy" &&
    (route !== "signup-bulk" || (Array.isArray(data.memberUidList) && data.memberUidList.length === sampleUids.length)) &&
    uids.length === sampleUids.length && uids.every((uid, index) => uid === sampleUids[index]) &&
    (route !== "grade" || JSON.stringify(data.gradeCodes) === JSON.stringify(["g20250124563854a652d54", "g20250124563844c752d51"]));
  if (!ownSite && !providerSample) throw Error("site_mismatch");
  const canonical = [body.eventType, body.eventTime, data.siteCode, data.unitCode, uids,
    route === "grade" ? data.gradeCodes : []];
  return { eventType: String(body.eventType), eventTime: Number(body.eventTime),
    siteCode: String(data.siteCode), unitCode: String(data.unitCode), memberUids: uids,
    advisoryGradeCodes: route === "grade" ? data.gradeCodes as string[] : [],
    providerSample, receiptKey: hashValue(JSON.stringify(canonical)), grantsAllowed: false };
}
