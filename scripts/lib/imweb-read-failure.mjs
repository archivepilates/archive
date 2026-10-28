const NETWORK_CODES = new Set(['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH']);
export const TRANSIENT_READ_CODE = 'IMWEB_TRANSIENT_READ_FAILED';
export const LOCAL_WRITE_QUOTA_CODE = 'IMWEB_LOCAL_WRITE_QUOTA_EXCEEDED';
const LOCAL_QUOTA = 'write_quota_exceeded';

// Only structured, uncontradicted CLI safety evidence proves non-dispatch.
export function isLocalImwebWriteQuotaFailure(error) {
  if (!error || typeof error !== 'object') return false;
  const payloads = [error];
  for (const stream of [error.stdout, error.stderr]) {
    if (stream === undefined || stream === null || String(stream).trim() === '') continue;
    try {
      const parsed = JSON.parse(String(stream));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
      payloads.push(parsed);
    } catch { return false; }
  }
  let found = false;
  for (const payload of payloads) {
    const normalized = payload.code === LOCAL_WRITE_QUOTA_CODE
      && payload.failureDetails?.classification === LOCAL_QUOTA
      && payload.failureDetails?.quotaScope === 'local_cli'
      && payload.failureDetails?.dispatchState === 'blocked_before_dispatch';
    const body = payload.error;
    if (body !== undefined && (!body || typeof body !== 'object' || Array.isArray(body))) return false;
    if (body && body.code !== LOCAL_QUOTA && body.classification !== LOCAL_QUOTA) return false;
    found ||= normalized || body?.code === LOCAL_QUOTA || body?.classification === LOCAL_QUOTA;
    const pending = [{ value: payload, depth: 0 }];
    const seen = new Set();
    while (pending.length) {
      const { value, depth } = pending.pop();
      if (seen.has(value) || depth > 8) return false;
      seen.add(value);
      if (value.ok === true || value.success === true) return false;
      if (/network|transport|timeout|abort/i.test(String(value.name || ''))) return false;
      for (const key of Object.getOwnPropertyNames(value)) {
        const item = value[key];
        if (['stdout', 'stderr', 'message', 'stack'].includes(key)) continue;
        if (['statusCode', 'status_code', 'httpStatus', 'http_status', 'error_code', 'transportCode', 'transport_code', 'signal', 'errno',
          'providerRequestId', 'provider_request_id', 'requestId', 'request_id', 'dispatchedAt', 'acceptedAt', 'appliedAt', 'sentAt'].includes(key)
            && item !== undefined && item !== null) return false;
        if (key === 'status' && item !== undefined && item !== null
            && !(value === error && [0, 1, 2].includes(item))
            && !['blocked_before_dispatch', 'not_dispatched'].includes(item)) return false;
        if (key === 'classification' && item !== LOCAL_QUOTA) return false;
        if (key === 'quotaScope' && item !== 'local_cli') return false;
        if (['dispatchState', 'dispatchStatus', 'dispatch_status'].includes(key)
            && !['blocked_before_dispatch', 'not_dispatched'].includes(item)) return false;
        if (key === 'code' && item !== undefined && item !== LOCAL_QUOTA
            && !(value === error && (normalized || [0, 1, 2].includes(item)))) return false;
        if (['kind', 'type', 'name'].includes(key) && /api|auth|permission|network|http|transport|captcha|security|timeout|abort/i.test(String(item))) return false;
        if (['dispatched', 'requestDispatched', 'request_dispatched', 'providerAttempted', 'provider_attempted',
          'accepted', 'applied', 'requestSent', 'request_sent', 'sent', 'attempted', 'externalEffectStarted', 'external_effect_started',
          'killed', 'timedOut', 'networkError', 'transportError', 'captchaRequired', 'securityWarning', 'authRequired', 'permissionDenied'].includes(key)
            && item !== undefined && item !== false) return false;
        if (['attemptCount', 'attempt_count'].includes(key) && item !== 0) return false;
        if (item && typeof item === 'object') pending.push({ value: item, depth: depth + 1 });
      }
    }
  }
  return found;
}

export function sanitizeImwebFailureDetails(value = {}) {
  value ||= {};
  const details = {};
  if (['member_list', 'order_list', 'order_get', 'config_context', 'other_request'].includes(value.operation)) details.operation = value.operation;
  if (['member_scan', 'order_scan', 'order_readback', 'point_prepare', 'point_send', 'point_verify', 'ledger_processing'].includes(value.phase)) details.phase = value.phase;
  if (['invalid_json', 'invalid_envelope', 'source_validation', 'conflicting_status'].includes(value.failureKind)) details.failureKind = value.failureKind;
  if ([1, 2].includes(value.readAttempts)) details.readAttempts = value.readAttempts;
  if (['inviter', 'invitee'].includes(value.role)) details.role = value.role;
  if (Number.isInteger(value.statusCode) && value.statusCode >= 100 && value.statusCode <= 599) details.statusCode = value.statusCode;
  if (typeof value.providerCode === 'string' && /^\d{1,10}$/.test(value.providerCode)) details.providerCode = value.providerCode;
  if (NETWORK_CODES.has(value.transportCode)) details.transportCode = value.transportCode;
  if (value.classification === LOCAL_QUOTA && value.quotaScope === 'local_cli'
      && value.dispatchState === 'blocked_before_dispatch') {
    Object.assign(details, { classification: LOCAL_QUOTA, quotaScope: 'local_cli', dispatchState: 'blocked_before_dispatch' });
  }
  return details;
}

// Inspect structured metadata only; never retain CLI output containing customer data.
export function imwebRequestFailure(error, { readOnly = false, operation } = {}) {
  if (!readOnly && isLocalImwebWriteQuotaFailure(error)) {
    return Object.assign(new Error('Imweb local write quota blocked before dispatch; native follow-up requires the original approval'), {
      code: LOCAL_WRITE_QUOTA_CODE,
      failureDetails: sanitizeImwebFailureDetails({ operation, classification: LOCAL_QUOTA,
        quotaScope: 'local_cli', dispatchState: 'blocked_before_dispatch' }),
    });
  }
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
      failureKind: uniqueStatuses.length > 1 ? 'conflicting_status' : undefined,
      providerCode, transportCode }),
  });
}

export function isTransientReadFailure(error) {
  return error?.code === TRANSIENT_READ_CODE;
}
