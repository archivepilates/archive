import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyNotionDocument, notionAttentionSummary } from '../lib/system-health-queue-policy.mjs';
import { healthFindingSourceRefs, systemHealthEmail } from '../lib/system-health-email.mjs';

const nowMs = Date.parse('2026-11-04T10:00:00Z');
const old = '2026-11-04T08:00:00Z';
const row = (id, data) => ({ doc: { id, data }, ...classifyNotionDocument(data, { nowMs }) });

test('counts source identity blocks, provider failures, pending delays and missing times separately', () => {
  const states = [
    row('pending', { notionSync: { status: 'pending', attemptedAt: old } }),
    row('identity', { notionSync: { status: 'failed', failedAt: old, error: 'Notion 회원 폴더 자동 연결 확인 필요: 회원·강사·제출 원본 신원이 일치하지 않습니다.' } }),
    row('provider', { notionSync: { status: 'failed', failedAt: old, error: 'provider unavailable' } }),
    row('unknown', { notionSync: { status: 'pending' } }),
    row('recent', { notionSync: { status: 'failed', failedAt: '2026-11-04T09:59:00Z' } }),
    row('waiting', { gptStatus: 'waiting_post', notionSync: { status: 'pending', deferredReason: 'awaiting_submission', attemptedAt: old } }),
  ];
  assert.deepEqual(notionAttentionSummary(states), { count: 4, overduePending: 1, overdueFailed: 2,
    unknownTimestamp: 1, identityUnverified: 1, sourceIds: ['pending', 'identity', 'provider', 'unknown'] });
});

test('explicit empty cancellation is excluded, arbitrary cancelled provider failures stay visible', () => {
  const cancelled = { gptStatus: 'waiting_post', cancelledAt: old,
    notionSync: { status: 'pending', deferredReason: 'cancelled_without_submission', deferredVersion: 'fixture', attemptedAt: old, error: '' } };
  const states = [row('safe', cancelled), row('unknown-write', { ...cancelled,
    notionSync: { status: 'failed', failedAt: old, error: 'provider outcome unknown' } })];
  assert.deepEqual(notionAttentionSummary(states).sourceIds, ['unknown-write']);
});

test('safe source references are bounded and deduplicated without leaking arbitrary links or text', () => {
  assert.deepEqual(healthFindingSourceRefs({ sourceRefs: ['privateLessonChartRecords/plc_123',
    'privateLessonChartRecords/plc_123', 'https://untrusted.invalid/token', 'secret/token',
    'privateLessonChartRecords/line\nbreak', 'privateLessonChartRecords/<script>'] }), ['privateLessonChartRecords/plc_123']);
  assert.equal(healthFindingSourceRefs({ sourceRefs: Array.from({ length: 20 }, (_, i) => `privateLessonChartRecords/plc_${i}`) }).length, 5);
});

test('email carries exact references and real observation time without claiming workflow completion', () => {
  const report = systemHealthEmail({ status: 'action_required', findingCount: 1, criticalCount: 0,
    actionRequiredCount: 1, warningCount: 0, repairedCount: 0, restartRequestedCount: 0, mode: 'quick',
    runId: 'fixture', finishedAt: '2026-11-04T10:00:00Z', findings: [{ title: '차트', cause: '원본 검증 보류',
      sourceRefs: ['privateLessonChartRecords/plc_123', 'privateLessonChartRecords/plc_456'] }] }, '/tmp/fixture.json');
  assert.match(report.body, /2026-11-04 19:00:00 KST/);
  for (const id of ['plc_123', 'plc_456']) assert.ok(report.body.includes(`원본 참조: privateLessonChartRecords/${id}`));
  assert.match(report.body, /재실행 요청은 복구 완료가 아닙니다/);
});
