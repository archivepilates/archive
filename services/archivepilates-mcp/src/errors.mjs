export class OperationError extends Error {
  constructor(code, message) { super(message); this.name = 'OperationError'; this.code = code; this.safe = true; }
}

export function requireValue(condition, code, message) {
  if (!condition) throw new OperationError(code, message);
}

export function safeError(error) {
  return error instanceof OperationError
    ? { code: error.code, message: error.message }
    : { code: 'SOURCE_UNAVAILABLE', message: '원본 조회 또는 처리 결과를 확인하지 못했습니다. 자동 재시도하지 않았습니다.' };
}

export function id(value) {
  requireValue(typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value),
    'INVALID_ARGUMENT', '원본 식별자를 확인해 주세요.');
  return value;
}

export function text(value, max = 1000) {
  requireValue(typeof value === 'string' && value.trim().length > 0 && value.length <= max
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),
  'INVALID_ARGUMENT', '입력 내용과 길이를 확인해 주세요.');
  return value.normalize('NFC').replace(/\r\n?/g, '\n').trim();
}

export function millis(value) {
  const number = typeof value?.toMillis === 'function' ? value.toMillis()
    : value instanceof Date ? value.getTime() : typeof value === 'number' ? value
      : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function iso(value) { const time = millis(value); return time ? new Date(time).toISOString() : null; }
export const phone = value => String(value || '').replace(/\D/g, '');
export const maskedPhone = value => /^01[016789]\d{7,8}$/.test(phone(value))
  ? `${phone(value).slice(0, 3)}-****-${phone(value).slice(-4)}` : null;
