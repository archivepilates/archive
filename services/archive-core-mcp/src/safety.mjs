import { createHash } from 'node:crypto';

export class CoreError extends Error {
  constructor(code, message) { super(message); this.code = code; this.safe = true; }
}
export function assert(condition, code, message) { if (!condition) throw new CoreError(code, message); }
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}
export const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
export function identifier(value) {
  assert(typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value), 'INVALID_ARGUMENT', '정확한 원본 ID가 필요합니다.');
  return value;
}
const secretKey = /password|pinhash|pinsalt|tempcode|accesstoken|refreshtoken|idtoken|authorization|apikey|secret|privatekey|credential|tokenhash|token$/i;
const isSecret = key => secretKey.test(key.replace(/[^A-Za-z0-9]/g, ''));
const sensitiveKey = /^(answers|inbody|metrics|measurement|summary|pain|health|healthFlags|allergies|medications|diagnosis|medicalHistory|birthDate|birthday|birthdate|dateOfBirth|residentNumber|cardNumber|bankAccount|payload)$/i;
export function rejectSecrets(value, depth = 0) {
  assert(depth < 16, 'INVALID_ARGUMENT', '입력 구조가 너무 깊습니다.');
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert(!['__proto__', 'prototype', 'constructor'].includes(key) && !isSecret(key),
      'FORBIDDEN_FIELD', '인증·비밀 값은 MCP 업무 도구로 변경하거나 전달할 수 없습니다.');
    rejectSecrets(child, depth + 1);
  }
}
export function publicResult(value, { review = false } = {}, depth = 0) {
  if (depth > 12) return '[bounded]';
  if (typeof value === 'string') {
    if (/^data:/i.test(value) || /-----BEGIN .*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|AIza[A-Za-z0-9_-]{30,}/.test(value)) return '[redacted]';
    if (/^https?:\/\//i.test(value)) {
      try {
        const u = new URL(value);
        if (u.username || u.password || [...u.searchParams.keys()].some(key => isSecret(key) || /^(r|t|key)$/i.test(key))) {
          value = u.origin + u.pathname + '?[private]';
        }
      } catch { return '[private URL]'; }
    }
    return value.slice(0, 12000).replace(/(?<![A-Za-z0-9])(?:\+82[- ]?|0)1[016789][- ]?\d{3,4}[- ]?\d{4}(?![A-Za-z0-9])/g,
      phone => '***-****-' + phone.replace(/\D/g, '').slice(-4));
  }
  if (value?.toDate instanceof Function) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.slice(0, 100).map(v => publicResult(v, { review }, depth + 1));
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (isSecret(key) || ['__proto__', 'prototype', 'constructor'].includes(key)
      || (!review && sensitiveKey.test(key))) continue;
    output[key] = publicResult(child, { review }, depth + 1);
  }
  return output;
}
export function memberWindow(now = Date.now()) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', hourCycle: 'h23' }).format(now));
  return hour >= 9 && hour < 23;
}
export function bounded(value, max = 180000) {
  assert(Buffer.byteLength(JSON.stringify(value)) <= max, 'INPUT_TOO_LARGE', '요청을 더 작은 단위로 나눠 주세요.');
  return value;
}
