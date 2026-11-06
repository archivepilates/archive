const requiredKeys = [
  "policy", "schemaVersion", "source", "studioId", "categoryId", "signType", "status",
  "contractId", "payloadHash", "createdAt", "verifiedAt", "independentReloadVerified",
  "originalMemberAndPassesPreserved", "termsUnchecked",
];
const allowedKeys = new Set([...requiredKeys, "auditPath"]);
const digest = value => typeof value === "string" && value.length === 64 && /^[a-f0-9]{64}$/.test(value);

function isoTime(value) {
  if (typeof value !== "string") return NaN;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match || match[0] !== value) return NaN;
  const [, year, month, day, hour, minute, second, zone, offsetHour, offsetMinute] = match;
  const leap = +year % 4 === 0 && (+year % 100 !== 0 || +year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (+month < 1 || +month > 12 || +day < 1 || +day > days[+month - 1] ||
    +hour > 23 || +minute > 59 || +second > 59 ||
    (zone !== "Z" && (+offsetHour > 14 || +offsetMinute > 59 || (+offsetHour === 14 && +offsetMinute !== 0))))
    return NaN;
  return Date.parse(value);
}

// This proves the shared creation endpoint/category, not independent tests of every template.
export function validateContractCreationVerification(value, { now = Date.now() } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Number.isFinite(now)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some(key => !allowedKeys.has(key) || !Object.hasOwn(descriptors[key], "value")) ||
    requiredKeys.some(key => !Object.hasOwn(descriptors, key))) return false;
  if (value.policy !== "studiomate_join_create_v1" || value.schemaVersion !== 1 ||
    value.source !== "studiomate_native_create" || value.studioId !== "5330" ||
    value.categoryId !== 1 || value.signType !== 1 || value.status !== "verified" ||
    !digest(value.contractId) || !digest(value.payloadHash) ||
    value.independentReloadVerified !== true || value.originalMemberAndPassesPreserved !== true ||
    value.termsUnchecked !== true) return false;
  if (Object.hasOwn(value, "auditPath") &&
    (typeof value.auditPath !== "string" || !value.auditPath.trim())) return false;
  const createdAt = isoTime(value.createdAt);
  const verifiedAt = isoTime(value.verifiedAt);
  return Number.isFinite(createdAt) && Number.isFinite(verifiedAt) && createdAt <= verifiedAt && verifiedAt <= now;
}
