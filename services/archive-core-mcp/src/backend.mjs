import { assert, CoreError, bounded } from './safety.mjs';

export function createBackend({ access, endpoints, fetcher = fetch }) {
  const allowed = new Set(endpoints);
  return async function invoke(endpoint, params, current, signal, { beforeDispatch } = {}) {
    assert(allowed.has(endpoint) && /^[A-Za-z][A-Za-z0-9]+$/.test(endpoint), 'UNKNOWN_ACTION', '등록된 CORE 업무만 실행할 수 있습니다.');
    const payload = JSON.stringify({ data: bounded(params) });
    const token = await access.token(current);
    assert(!signal?.aborted, 'CANCELLED', '요청이 실행 전에 취소됐습니다.');
    await beforeDispatch?.();
    let response, body;
    try {
      response = await fetcher('https://asia-northeast3-archive-pilates.cloudfunctions.net/' + endpoint, {
        method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: payload,
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000),
      });
      body = await response.json();
    } catch { throw new CoreError('OUTCOME_UNKNOWN', 'CORE 요청 결과를 확인하지 못했습니다. 자동 재시도하지 말고 원본과 작업 기록을 조회하세요.'); }
    assert(body && typeof body === 'object' && !Array.isArray(body), 'OUTCOME_UNKNOWN', 'CORE 완료 응답 형식을 확인하지 못했습니다. 재실행하지 마세요.');
    if (!response.ok || body.error) {
      const code = typeof body.error?.status === 'string' ? body.error.status.replace(/[^A-Z_]/g, '').slice(0, 60) : 'BACKEND_REJECTED';
      throw new CoreError(code, 'CORE 처리기가 요청을 거절했거나 결과를 확인하지 못했습니다. 기존 원장을 확인하고 자동 재시도하지 마세요.');
    }
    assert(Object.hasOwn(body, 'result') || Object.hasOwn(body, 'data'), 'OUTCOME_UNKNOWN', 'CORE 완료 응답을 확인하지 못했습니다. 재실행하지 마세요.');
    return bounded(Object.hasOwn(body, 'result') ? body.result : body.data, 500000);
  };
}
