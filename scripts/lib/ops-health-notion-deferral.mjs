export const INCIDENT_CHART_IDS = ['plc_280084398', 'plc_281189166', 'plc_281189167'];

export function notionIncidentDeferral(record, request, nowMs = Date.now()) {
  const same = key => typeof record?.[key] === 'string' && record[key] && record[key] === request?.[key];
  const noContent = value => value == null || (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length);
  const sync = record?.notionSync || {};
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(record?.lessonDate || '');
  const lessonEnd = validDate ? Date.parse(`${record.lessonDate}T23:59:59+09:00`) : NaN;
  const eligible = INCIDENT_CHART_IDS.includes(record?.recordId)
    && record.recordId === record.requestId && same('requestId') && same('memberId') && same('staffId') && same('bookingId')
    && record.studioId === '5330' && request.studioId === '5330'
    && record.gptStatus === 'waiting_post' && request.status === 'pending'
    && request.preStatus === 'pending' && request.postStatus === 'pending'
    && !record.preSubmittedAt && !record.postSubmittedAt && !record.cancelledAt
    && noContent(record.prePlan) && noContent(record.postRecord)
    && !record.notionProjectionControl && !record.notionProjectionLease?.token
    && Number(record.notionProjectionLease?.untilMs || 0) <= nowMs
    && !sync.pageId && !sync.instructorPageId && !sync.creationTitle && !sync.leaseToken
    && Number(sync.leaseUntilMs || 0) <= nowMs && !sync.sourceVersion
    && sync.status === 'failed'
    && sync.error === 'Notion 회원 폴더 자동 연결 확인 필요: 회원·강사·제출 원본 신원이 일치하지 않습니다.'
    && Number.isFinite(lessonEnd) && lessonEnd > nowMs;
  if (!eligible) return null;
  const next = { ...sync, status: 'pending', error: '', deferredReason: 'awaiting_submission',
    deferredAt: new Date(nowMs).toISOString() };
  delete next.syncedAt;
  return next;
}
