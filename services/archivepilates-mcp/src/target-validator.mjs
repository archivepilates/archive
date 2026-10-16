import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { id, OperationError, requireValue } from './errors.mjs';

const script = fileURLToPath(new URL('../../../scripts/read-alimtalk-target-validation.mjs', import.meta.url));
const root = fileURLToPath(new URL('../../../', import.meta.url));
export const unavailable = () => new OperationError('SOURCE_UNAVAILABLE',
  '알림톡 사전 검증 원본을 확인하지 못했습니다. 빌드·연결 상태를 확인하세요. 대체 조회·승인·발송은 하지 않았습니다.');

const reasons = {
  canonical_identity: ['ok', 'source_identity_mismatch'],
  attempt_ledger: ['ok', 'existing_attempt_requires_reconciliation'],
  eligibility: ['ok', 'eligibility_blocked', 'staff_excluded', 'template_snapshot_unverified', 'unsupported_candidate_type'],
  source: ['ok', 'source_blocked'],
  duplicate: ['ok', 'duplicate_blocked'],
  specialized_final_guard: ['existing_runtime_readback_required'],
  inspection: ['source_read_failed'],
};
const timestamp = value => typeof value === 'string' && value.length <= 30 && Number.isFinite(Date.parse(value));

export function targetValidationView(value, candidateId) {
  const valid = condition => requireValue(condition, 'SOURCE_UNAVAILABLE', unavailable().message);
  valid(value?.version === 'alimtalk-target-validation-v1' && timestamp(value.checkedAt)
    && value.readOnly === true && value.liveReadback === false && value.allowedForExternalActions === false
    && Array.isArray(value.results) && value.results.length === 1);
  const row = value.results[0];
  valid(row?.candidateId === candidateId && ['not_found', 'blocked', 'review_required', 'preflight_passed'].includes(row.status)
    && Array.isArray(row.checks) && row.checks.length <= 8);
  const checks = row.checks.map(check => {
    valid(check && Object.hasOwn(reasons, check.stage) && reasons[check.stage].includes(check.reasonCode)
      && ['passed', 'blocked', 'not_checked'].includes(check.status));
    return { stage: check.stage, status: check.status, reasonCode: check.reasonCode };
  });
  valid(row.status !== 'preflight_passed' || (checks.length > 0 && checks.every(check => check.status === 'passed')));
  let source = null;
  if (row.source !== undefined) {
    valid(row.source?.collection === 'alimtalkCandidates' && row.source.freshness === 'unknown'
      && row.source.liveReadback === false && (row.source.observedAt === null || timestamp(row.source.observedAt)));
    source = { collection: 'alimtalkCandidates', observedAt: row.source.observedAt === null
      ? null : new Date(row.source.observedAt).toISOString(), freshness: 'unknown', liveReadback: false };
  }
  return { ok: true, version: value.version, checkedAt: new Date(value.checkedAt).toISOString(),
    preflightOnly: true, readOnly: true, liveReadback: false, allowedForExternalActions: false,
    results: [{ candidateId, status: row.status, checks, source,
      remainingChecks: ['발송 시점 승인 확인', '기존 큐 선점·동시 실행 차단', '업무별 최종 원본·리포트 검증'] }],
    note: '저장 원장 사전 검증 스냅샷입니다. 통과해도 발송 허가·승인·실시간 원본 확인이 아닙니다. 후보·큐·발송 원장은 변경하지 않았습니다.' };
}

export function createTargetValidator({ credentialPath, spawnImpl = spawn, timeoutMs = 45000,
  maxOutputBytes = 128 * 1024, killGraceMs = 2000 } = {}) {
  return async (candidateId, { signal } = {}) => {
    id(candidateId);
    requireValue(/^[A-Za-z0-9_-]{1,160}$/.test(candidateId), 'INVALID_ARGUMENT', '정확한 후보 ID를 입력하세요.');
    requireValue(typeof credentialPath === 'string' && credentialPath.length > 0 && !signal?.aborted,
      'SOURCE_UNAVAILABLE', unavailable().message);
    return new Promise((resolve, reject) => {
      let child;
      try {
        child = spawnImpl(process.execPath, [script, candidateId], { cwd: root,
          env: { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: credentialPath },
          shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch { reject(unavailable()); return; }
      let failed = false, bytes = 0, chunks = [], killTimer;
      const stop = () => {
        if (failed) return;
        failed = true;
        chunks = [];
        child.kill('SIGTERM');
        killTimer = setTimeout(() => child.kill('SIGKILL'), killGraceMs);
      };
      const timer = setTimeout(stop, timeoutMs);
      const abort = () => stop();
      signal?.addEventListener('abort', abort, { once: true });
      child.stdout.on('data', data => {
        bytes += Buffer.byteLength(data);
        if (bytes > maxOutputBytes) stop();
        if (!failed) chunks.push(Buffer.from(data));
      });
      child.stderr.on('data', data => {
        bytes += Buffer.byteLength(data);
        if (bytes > maxOutputBytes) stop();
      });
      child.once('error', stop);
      // close follows process exit and stdio closure, including failed spawns.
      child.once('close', code => {
        clearTimeout(timer); clearTimeout(killTimer);
        signal?.removeEventListener('abort', abort);
        if (failed || code !== 0) { reject(unavailable()); return; }
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(unavailable()); }
      });
      if (signal?.aborted) stop();
    });
  };
}
