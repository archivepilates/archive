const NETWORK_CODES = new Set(['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH']);
export const TRANSIENT_READ_CODE = 'IMWEB_TRANSIENT_READ_FAILED';

export function sanitizeImwebFailureDetails(value = {}) {
  value ||= {};
  const details = {};
  if (['member_list', 'config_context', 'other_request'].includes(value.operation)) details.operation = value.operation;
  if (['member_scan', 'point_prepare', 'point_send', 'point_verify', 'ledger_processing'].includes(value.phase)) details.phase = value.phase;
  if (['inviter', 'invitee'].includes(value.role)) details.role = value.role;
  if (Number.isInteger(value.statusCode) && value.statusCode >= 100 && value.statusCode <= 599) details.statusCode = value.statusCode;
  if (typeof value.providerCode === 'string' && /^\d{1,10}$/.test(value.providerCode)) details.providerCode = value.providerCode;
  if (NETWORK_CODES.has(value.transportCode)) details.transportCode = value.transportCode;
  return details;
}

// Inspect structured metadata only; never retain CLI output containing customer data.
export function imwebRequestFailure(error, { readOnly = false, operation } = {}) {
  const payloads = [error];
  for (const stream of [error?.stdout, error?.stderr]) {
    try {
      const candidate = JSON.parse(String(stream));
      if (candidate && typeof candidate === 'object' && (candidate.error || candidate.statusCode || candidate.status_code)) {
        payloads.push(candidate);
      }
    } catch { /* Unknown errors fail immediately. */ }
  }
  // CLI 0.1.13 uses error.status_code; API success/error bodies use statusCode.
  const statuses = payloads.flatMap(payload => [payload?.statusCode, payload?.status_code,
    payload?.error?.statusCode, payload?.error?.status_code]).filter(value => value !== undefined).map(Number);
  const uniqueStatuses = [...new Set(statuses)];
  // Conflicting streams or explicit auth/validation status always fail closed.
  const status = uniqueStatuses.find(value => value >= 400 && value < 500 && value !== 429) ?? uniqueStatuses[0];
  const transportCode = payloads.flatMap(payload => [payload?.code, payload?.error?.code]).find(code => NETWORK_CODES.has(code));
  const transient = readOnly && (uniqueStatuses.length
    ? uniqueStatuses.length === 1 && (status === 429 || status >= 500 && status <= 599)
    : NETWORK_CODES.has(transportCode));
  const providerCode = payloads.map(payload => payload?.error?.error_code).find(value => typeof value === 'string' && /^\d{1,10}$/.test(value));
  return Object.assign(new Error(transient
    ? '아임웹 일시적 조회 오류: 다음 정기 실행에서 다시 확인합니다.'
    : '아임웹 요청 실패: 인증·원본·처리 결과 확인필요 (자동 쓰기 재시도 없음)'), {
    code: transient ? TRANSIENT_READ_CODE : 'IMWEB_REQUEST_FAILED',
    failureDetails: sanitizeImwebFailureDetails({ operation, statusCode: status,
      providerCode, transportCode }),
  });
}

export function isTransientReadFailure(error) {
  return error?.code === TRANSIENT_READ_CODE;
}
