import test from 'node:test';
import assert from 'node:assert/strict';
import { notionIncidentDeferral, INCIDENT_CHART_IDS } from '../lib/ops-health-notion-deferral.mjs';
const now = Date.parse('2026-11-02T00:00:00Z');
const record = () => ({ recordId: INCIDENT_CHART_IDS[0], requestId: INCIDENT_CHART_IDS[0], memberId: '123',
  staffId: '456', bookingId: 'booking', studioId: '5330', lessonDate: '2026-11-05', gptStatus: 'waiting_post',
  notionSync: { status: 'failed', sourceVersion: '', targetVersion: 'version', attemptedAt: '2026-11-01T14:30:00Z',
    syncedAt: '2026-11-01T14:30:01Z', error: 'Notion 회원 폴더 자동 연결 확인 필요: 회원·강사·제출 원본 신원이 일치하지 않습니다.' } });
const request = () => ({ requestId: INCIDENT_CHART_IDS[0], memberId: '123', staffId: '456', bookingId: 'booking',
  studioId: '5330', status: 'pending', preStatus: 'pending', postStatus: 'pending' });
test('exact empty-shell failure becomes explicit waiting without mutating its source', () => {
  const d = record(), before = structuredClone(d), next = notionIncidentDeferral(d, request(), now);
  assert.equal(next.status, 'pending');
  assert.equal(next.deferredReason, 'awaiting_submission');
  assert.equal(next.targetVersion, 'version');
  assert.equal(next.attemptedAt, before.notionSync.attemptedAt);
  assert.equal(next.syncedAt, undefined);
  assert.deepEqual(d, before);
});
test('changed identity, content, state, provider intent or failure never gets cleared', () => {
  for (const patch of [{ recordId: 'other' }, { memberId: 'different' }, { prePlan: { text: 'submitted' } },
    { postRecord: { text: 'submitted' } }, { postSubmittedAt: 'present' }, { cancelledAt: 'present' },
    { notionProjectionControl: { aliasOfRecordId: 'other' } }, { notionProjectionLease: { token: 'active', untilMs: now + 1 } },
    { lessonDate: '2026-11-01' },
    ...[{ status: 'synced' }, { error: 'auth failure' }, { pageId: 'page' }, { instructorPageId: 'page' },
      { creationTitle: 'intent' }, { sourceVersion: 'already_synced' }].map(p => ({ notionSync: { ...record().notionSync, ...p } }))]) {
    assert.equal(notionIncidentDeferral({ ...record(), ...patch }, request(), now), null);
  }
  assert.equal(notionIncidentDeferral(record(), { ...request(), postStatus: 'submitted' }, now), null);
});
