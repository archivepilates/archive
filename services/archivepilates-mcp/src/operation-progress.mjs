import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { OperationError, requireValue } from './errors.mjs';

const script = fileURLToPath(new URL('../../../scripts/read-member-operation-progress.mjs', import.meta.url));
const root = fileURLToPath(new URL('../../../', import.meta.url));
export const progressUnavailable = () => new OperationError('SOURCE_UNAVAILABLE',
  '업무 진행 원장을 확인하지 못했습니다. 빌드·연결 상태를 확인하세요. 재실행·발송·원장 변경은 하지 않았습니다.');
export const progressInput = input => requireValue(input && input.kind === 'holding'
  && typeof input.operationId === 'string' && /^holding_operator_notice_[a-f0-9]{64}$/.test(input.operationId)
  && Object.keys(input).every(key => ['kind', 'operationId'].includes(key)),
'INVALID_ARGUMENT', '정확한 holding 업무 ID가 필요합니다.');
const names = ['detection', 'sourceCheck', 'providerAcceptance', 'providerDelivery', 'memoQueued', 'memoSynced'];
const publicNames = ['detection', 'source_check', 'provider_acceptance', 'provider_delivery', 'memo_queued', 'memo_synced'];
const collections = ['holdingNoticeEvents', 'alimtalkCandidates', 'alimtalkSends', 'holdingNoticeClaims', 'memberMemos', 'studiomateMemoWriteJobs'];
const reasons = ['evidence_missing', 'source_read_failed', 'source_binding_mismatch', 'policy_mismatch', 'message_link_mismatch',
  'memo_link_mismatch', 'memo_evidence_unverified', 'acceptance_marker_unverified', 'operation_review_required', 'timestamp_missing', 'canonical_event_recorded', 'source_links_verified',
  'acceptance_verified', 'acceptance_unverified', 'delivery_complete_4000', 'delivery_failed', 'delivery_unconfirmed',
  'memo_queue_recorded', 'memo_synced', 'memo_sync_failed', 'memo_sync_unconfirmed'];
const stageReasons = {
  detection: ['evidence_missing', 'timestamp_missing', 'canonical_event_recorded', 'source_binding_mismatch'],
  sourceCheck: ['evidence_missing', 'timestamp_missing', 'source_links_verified', 'source_binding_mismatch', 'policy_mismatch'],
  providerAcceptance: ['evidence_missing', 'timestamp_missing', 'acceptance_verified', 'acceptance_unverified'],
  providerDelivery: ['evidence_missing', 'timestamp_missing', 'delivery_complete_4000', 'delivery_failed', 'delivery_unconfirmed'],
  memoQueued: ['evidence_missing', 'timestamp_missing', 'memo_link_mismatch', 'memo_queue_recorded'],
  memoSynced: ['evidence_missing', 'timestamp_missing', 'memo_synced', 'memo_sync_failed', 'memo_sync_unconfirmed'],
};
const verifiedReasons = ['canonical_event_recorded', 'source_links_verified', 'acceptance_verified',
  'delivery_complete_4000', 'memo_queue_recorded', 'memo_synced'];
const codeAllowlist = ['evidence_missing', 'source_read_failed', 'source_binding_mismatch', 'policy_mismatch',
  'message_link_mismatch', 'memo_link_mismatch', 'memo_evidence_unverified', 'acceptance_marker_unverified',
  'operation_review_required', 'timestamp_missing', 'delivery_failed', 'memo_sync_failed'];
const statusReasons = {
  unknown: ['evidence_missing', 'timestamp_missing', 'acceptance_unverified', 'delivery_unconfirmed', 'memo_sync_unconfirmed'],
  pending: ['delivery_unconfirmed', 'memo_sync_unconfirmed'],
  blocked: ['source_binding_mismatch', 'policy_mismatch', 'memo_link_mismatch'],
  failed: ['delivery_failed', 'memo_sync_failed'],
};
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

export function operationProgressView(value, input) {
  progressInput(input);
  const valid = condition => requireValue(condition, 'SOURCE_UNAVAILABLE', progressUnavailable().message);
  valid(value && ['not_found', 'in_progress', 'completed', 'review_required'].includes(value.status)
    && Array.isArray(value.stages) && value.stages.length === names.length);
  value = { ...value, status: value.status === 'not_found' ? 'unknown' : value.status === 'completed' ? 'complete' : value.status,
    stages: Object.fromEntries(Array.from(value.stages, (stage, index) => {
      valid(stage?.stage === publicNames[index] && ['confirmed', 'pending', 'failed', 'unknown', 'review_required'].includes(stage.status));
      return [names[index], { ...stage, status: stage.status === 'confirmed' ? 'verified' : stage.status === 'review_required' ? 'blocked' : stage.status }];
    })) };
  valid(value?.version === 'member-operation-progress-v1' && value.kind === input.kind && value.operationId === input.operationId
    && timestamp(value.checkedAt) && value.readOnly === true && value.liveReadback === false && value.allowedForExternalActions === false
    && ['unknown', 'review_required', 'in_progress', 'complete'].includes(value.status)
    && [null, 'holding_delivery_memo_v1', 'holding_acceptance_memo_v2'].includes(value.policy)
    && value.stages && Object.keys(value.stages).length === names.length
    && Array.isArray(value.codes) && value.codes.length <= reasons.length
    && new Set(value.codes).size === value.codes.length && value.codes.every(code => codeAllowlist.includes(code))
    && ['none', 'review_source_records', 'review_acceptance', 'check_delivery_record', 'check_memo_queue', 'check_memo_sync'].includes(value.nextAction));
  const stages = Object.fromEntries(names.map((name, index) => {
    const stage = value.stages[name];
    valid(stage && ['unknown', 'verified', 'pending', 'blocked', 'failed'].includes(stage.status)
      && (stage.at === null || timestamp(stage.at)) && stageReasons[name].includes(stage.reasonCode)
      && (stage.status !== 'verified' || timestamp(stage.at) && stage.reasonCode === verifiedReasons[index])
      && (stage.status === 'verified' || statusReasons[stage.status].includes(stage.reasonCode)));
    return [name, { status: stage.status, at: stage.at, reasonCode: stage.reasonCode }];
  }));
  valid(value.source?.kind === 'canonical_document_snapshot' && value.source.freshness === 'unknown'
    && value.source.liveReadback === false && Array.isArray(value.source.evidence) && value.source.evidence.length === 6);
  const evidence = Array.from(value.source.evidence, (row, index) => {
    valid(row?.collection === collections[index] && [true, false, null].includes(row.exists)
      && (row.observedAt === null || timestamp(row.observedAt)) && (row.exists === true || row.observedAt === null));
    return { collection: collections[index], exists: row.exists, observedAt: row.observedAt };
  });
  valid(stages.providerAcceptance.status !== 'verified' || stages.sourceCheck.status === 'verified');
  valid(stages.providerDelivery.status !== 'verified' || stages.providerAcceptance.status === 'verified');
  valid(stages.memoQueued.status !== 'verified' || stages.sourceCheck.status === 'verified'
    && (value.policy === 'holding_delivery_memo_v1' ? stages.providerDelivery.status === 'verified' : stages.providerAcceptance.status === 'verified'));
  valid(stages.memoSynced.status !== 'verified' || stages.memoQueued.status === 'verified');
  valid(stages.detection.status !== 'verified' || evidence[0].exists === true);
  valid(stages.sourceCheck.status !== 'verified' || evidence.slice(1, 4).every(row => row.exists === true) && value.policy !== null);
  valid(stages.memoQueued.status !== 'verified' || evidence.slice(4).every(row => row.exists === true));
  valid(value.status !== 'complete' || names.every(name => stages[name].status === 'verified')
    && value.codes.length === 0 && evidence.every(row => row.exists === true) && value.policy !== null && value.nextAction === 'none');
  valid(value.nextAction !== 'none' || value.status === 'complete');
  valid(value.codes.length === 0 || value.status === 'review_required');
  valid(value.status !== 'unknown' || value.codes.length === 0 && evidence.every(row => row.exists === false)
    && names.every(name => stages[name].status === 'unknown'));
  return { version: 'member-operation-progress-v1', kind: input.kind, operationId: input.operationId,
    checkedAt: value.checkedAt, readOnly: true, liveReadback: false, allowedForExternalActions: false,
    status: value.status === 'unknown' ? 'not_found' : value.status === 'complete' ? 'completed' : value.status, policy: value.policy,
    stages: names.map((name, index) => ({ stage: publicNames[index], ...stages[name],
      status: stages[name].status === 'verified' ? 'confirmed' : stages[name].status === 'blocked' ? 'review_required' : stages[name].status })),
    source: { kind: 'canonical_document_snapshot', freshness: 'unknown', liveReadback: false, evidence },
    codes: [...value.codes], nextAction: value.nextAction };
}

export function createOperationProgressReader({ credentialPath, spawnImpl = spawn, timeoutMs = 45000,
  maxOutputBytes = 128 * 1024, killGraceMs = 2000 } = {}) {
  return async (input, { signal } = {}) => {
    progressInput(input);
    requireValue(typeof credentialPath === 'string' && credentialPath.length > 0 && !signal?.aborted,
      'SOURCE_UNAVAILABLE', progressUnavailable().message);
    return new Promise((resolve, reject) => {
      let child;
      try {
        child = spawnImpl(process.execPath, [script, input.kind, input.operationId], { cwd: root,
          env: { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: credentialPath },
          shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch { reject(progressUnavailable()); return; }
      let failed = false, bytes = 0, chunks = [], killTimer;
      const stop = () => {
        if (failed) return;
        failed = true; chunks = []; child.kill('SIGTERM');
        killTimer = setTimeout(() => child.kill('SIGKILL'), killGraceMs);
      };
      const timer = setTimeout(stop, timeoutMs);
      signal?.addEventListener('abort', stop, { once: true });
      child.stdout.on('data', data => {
        bytes += Buffer.byteLength(data);
        if (bytes > maxOutputBytes) stop();
        if (!failed) chunks.push(Buffer.from(data));
      });
      child.stderr.on('data', data => { bytes += Buffer.byteLength(data); if (bytes > maxOutputBytes) stop(); });
      child.once('error', stop);
      child.once('close', code => {
        clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', stop);
        if (failed || code !== 0) { reject(progressUnavailable()); return; }
        try { resolve(operationProgressView(JSON.parse(Buffer.concat(chunks).toString('utf8')), input)); }
        catch { reject(progressUnavailable()); }
      });
      if (signal?.aborted) stop();
    });
  };
}
