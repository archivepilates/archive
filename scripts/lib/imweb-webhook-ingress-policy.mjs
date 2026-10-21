import { createHash, timingSafeEqual } from 'node:crypto';

export const IMWEB_APP_CODE = 'ga202609279410fb87e608a';
export const IMWEB_SITE_CODE = 'S20260516852c71a014d08';
export const IMWEB_UNIT_CODE = 'u2026051698c99ea234719';
export const MAX_PAYLOAD_BYTES = 64 * 1024;
export const MAX_EVENT_ITEMS = 50;
export const EVENT_ROUTES = Object.freeze({
  signup: 'END_USER_SIGN_UP',
  'signup-bulk': 'END_USER_SIGN_UP_BULK',
  grade: 'END_USER_GRADE_UPDATE',
});

const EVENT_TYPES = new Set(Object.values(EVENT_ROUTES));
const EVENT_KEYS = {
  END_USER_SIGN_UP: ['memberUid', 'siteCode', 'unitCode'],
  END_USER_SIGN_UP_BULK: ['memberUidList', 'siteCode', 'unitCode'],
  END_USER_GRADE_UPDATE: ['gradeCodes', 'memberUid', 'siteCode', 'unitCode'],
};

function fail(code) {
  // Never attach input, member identifiers or secrets to errors.
  const error = new Error(code);
  error.code = code;
  throw error;
}

export function sha256(value) {
  if (typeof value !== 'string' && !Buffer.isBuffer(value)) fail('invalid_hash_input');
  return createHash('sha256').update(value).digest('hex');
}

// Exact header bytes, not Bearer parsing, HMAC, trimming or case folding.
// The receiver owns header selection, secret provisioning and authentication order.
export function verifySecretDigest(headerValue, expectedSha256) {
  if (typeof headerValue !== 'string' || headerValue.length === 0 || !headerValue.isWellFormed()
    || Buffer.byteLength(headerValue) > MAX_PAYLOAD_BYTES
    || typeof expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(expectedSha256)) return false;
  return timingSafeEqual(Buffer.from(sha256(headerValue), 'hex'), Buffer.from(expectedSha256, 'hex'));
}

function isRecord(value) {
  return value !== null && typeof value === 'object'
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

// Bounded canonical JSON: sorted object keys, preserved array order, no toJSON,
// accessors, prototypes, implicit conversions, sparse arrays or non-JSON values.
function sortedJson(value) {
  const ancestors = new Set();
  let bytes = 0;
  function token(text) {
    bytes += Buffer.byteLength(text);
    if (bytes > MAX_PAYLOAD_BYTES) fail('payload_too_large');
    return text;
  }
  function visit(item, depth) {
    if (depth > 64) fail('invalid_payload');
    if (item === null || typeof item === 'boolean') return token(JSON.stringify(item));
    if (typeof item === 'string') {
      if (Buffer.byteLength(item) > MAX_PAYLOAD_BYTES) fail('payload_too_large');
      return token(JSON.stringify(item));
    }
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) fail('invalid_payload');
      return token(JSON.stringify(item));
    }
    if (!Array.isArray(item) && !isRecord(item)) fail('invalid_payload');
    if (ancestors.has(item)) fail('invalid_payload');
    const keys = Reflect.ownKeys(item);
    if (keys.length > MAX_PAYLOAD_BYTES) fail('payload_too_large');
    if (keys.some(key => typeof key !== 'string')) fail('invalid_payload');
    ancestors.add(item);
    const array = Array.isArray(item);
    if (array && (keys.length !== item.length + 1
      || !keys.every(key => key === 'length' || /^(0|[1-9][0-9]*)$/.test(key)))) fail('invalid_payload');
    const entries = array ? keys.filter(key => key !== 'length') : keys.sort();
    if (array && entries.some((key, index) => key !== String(index))) fail('invalid_payload');
    const parts = [token(array ? '[' : '{')];
    for (const [index, key] of entries.entries()) {
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('invalid_payload');
      if (index) parts.push(token(','));
      if (!array) parts.push(token(JSON.stringify(key)), token(':'));
      parts.push(visit(descriptor.value, depth + 1));
    }
    parts.push(token(array ? ']' : '}'));
    ancestors.delete(item);
    return parts.join('');
  }
  return visit(value, 0);
}

function parsePayload(body) {
  let value = body;
  if (Buffer.isBuffer(value)) {
    if (value.length > MAX_PAYLOAD_BYTES) fail('payload_too_large');
    try {
      value = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(value);
    } catch {
      fail('invalid_payload');
    }
  }
  if (typeof value === 'string') {
    if (Buffer.byteLength(value) > MAX_PAYLOAD_BYTES) fail('payload_too_large');
    try {
      value = JSON.parse(value);
    } catch {
      fail('invalid_payload');
    }
  }
  const json = sortedJson(value);
  return { value, json };
}

export function payloadDigest(body) {
  return sha256(parsePayload(body).json);
}

function envelope(body, eventType) {
  if (typeof eventType !== 'string' || !EVENT_TYPES.has(eventType)) fail('unsupported_event');
  const parsed = parsePayload(body);
  if (!isRecord(parsed.value)) fail('invalid_schema');
  if (!Object.hasOwn(parsed.value, 'siteCode') || parsed.value.siteCode !== IMWEB_SITE_CODE) fail('site_mismatch');
  if (!Object.hasOwn(parsed.value, 'unitCode') || parsed.value.unitCode !== IMWEB_UNIT_CODE) fail('unit_mismatch');
  return parsed;
}

// A receipt identifies content only; it does not authenticate or accept a schema.
export function deliveryReceiptKey(body, eventType) {
  const { json } = envelope(body, eventType);
  return sha256(JSON.stringify([eventType, IMWEB_SITE_CODE, IMWEB_UNIT_CODE, sha256(json)]));
}

function validateMemberUid(memberUid) {
  // Preserve opaque provider identity exactly; do not infer email/case equivalence.
  if (typeof memberUid !== 'string' || memberUid.length === 0
    || Buffer.byteLength(memberUid) > 256
    || /[\s\p{Cc}\p{Cf}\p{Cs}]/u.test(memberUid)) fail('invalid_member_uid');
  return memberUid;
}

function uniqueList(value, validate, code, allowEmpty = false) {
  if (!Array.isArray(value) || value.length > MAX_EVENT_ITEMS || (!allowEmpty && value.length === 0)) {
    fail(code);
  }
  return [...new Set(value.map(validate))];
}

// Preparatory policy only. Call only after authentication. Never log this result:
// memberUid/List is for canonical lookup, not a stable id; grades may be stale.
export function normalizeEvent(body, eventType) {
  const { value, json } = envelope(body, eventType);
  const expectedKeys = EVENT_KEYS[eventType];
  const keys = Object.keys(value).sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    fail('invalid_schema');
  }
  let identity;
  if (eventType === EVENT_ROUTES['signup-bulk']) {
    const memberUidList = uniqueList(value.memberUidList, validateMemberUid, 'invalid_member_uid_list');
    identity = { memberUidList, memberUidSha256List: memberUidList.map(sha256) };
  } else {
    const memberUid = validateMemberUid(value.memberUid);
    identity = { memberUid, memberUidSha256: sha256(memberUid) };
    if (eventType === EVENT_ROUTES.grade) {
      const gradeCodes = uniqueList(value.gradeCodes, code => {
        if (typeof code !== 'string' || !/^g[0-9a-f]{21}$/.test(code)) fail('invalid_grade_code');
        return code;
      }, 'invalid_grade_codes', true);
      // Empty means a recheck hint too, never authorization to remove rights.
      identity = { ...identity, gradeCodes, gradeCodesAuthoritative: false };
    }
  }
  return {
    appCode: IMWEB_APP_CODE,
    eventType,
    siteCode: IMWEB_SITE_CODE,
    unitCode: IMWEB_UNIT_CODE,
    ...identity,
    payloadSha256: sha256(json),
    hint: 'member_lookup_required',
    grantsAccess: false,
  };
}
