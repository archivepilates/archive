const NETWORK_CODES = new Set(['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH']);
export const TRANSIENT_READ_CODE = 'IMWEB_TRANSIENT_READ_FAILED';

// Inspect structured metadata only; never retain CLI output containing customer data.
export function imwebRequestFailure(error, { readOnly = false } = {}) {
  let payload = error;
  try { if (error.stdout) payload = JSON.parse(String(error.stdout)); } catch { /* Unknown errors fail immediately. */ }
  const status = Number(payload?.statusCode || payload?.error?.statusCode);
  const transient = readOnly && (status >= 400
    ? status === 429 || status >= 500 && status <= 599
    : NETWORK_CODES.has(error.code) || NETWORK_CODES.has(payload?.error?.code));
  return Object.assign(new Error(transient
    ? '아임웹 일시적 조회 오류: 다음 정기 실행에서 다시 확인합니다.'
    : '아임웹 요청 실패: 인증·원본·처리 결과 확인필요 (자동 쓰기 재시도 없음)'), {
    code: transient ? TRANSIENT_READ_CODE : 'IMWEB_REQUEST_FAILED',
  });
}

export function isTransientReadFailure(error) {
  return error?.code === TRANSIENT_READ_CODE;
}
