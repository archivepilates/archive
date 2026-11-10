import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildSettlementClassCounts, reconcileSettlementClassCounts, settlementClassCountPresentation } from '../lib/settlement-class-counts.mjs';
import { renderSettlementRecipientDocument } from '../lib/settlement-recipient-template.mjs';

const row = overrides => ({ classDate: '2026-10-01', classTime: '10:00', endTime: '10:50', weekday: '목',
  instructorName: '검증용 강사', memberName: '검증 회원', originalType: '프라이빗', finalType: '프라이빗',
  ticketName: '개인 10회권', attendance: '출석', revenue: 10000, ...overrides });
const get = rows => buildSettlementClassCounts(rows, '202610').get('검증용 강사');

test('group totals include ordinary and instructor lessons separately, never participant counts', () => {
  const counts = get([row({finalType:'그룹'}), row({finalType:'그룹',memberName:'다른 회원'}),
    row({finalType:'강사레슨',classTime:'11:00'}), row({finalType:'강사레슨',classTime:'11:00',memberName:'다른 회원'})]);
  assert.equal(counts.groupSessions, 1); assert.equal(counts.lessonSessions, 1); assert.equal(counts.totalSessions, 2);
  assert.deepEqual(settlementClassCountPresentation(counts).groupMetric.details, ['일반 그룹 1회','강사레슨 1회']);
});
test('solo and verified duet tickets separate unique sessions from member settlement units', () => {
  const counts = get([row(), row({classTime:'11:00',ticketName:'듀엣 20회권'}),
    row({classTime:'11:00',ticketName:'듀엣 20회권',memberName:'다른 회원'})]);
  assert.equal(counts.privateSessions, 2); assert.equal(counts.privateSettlementUnits, 3);
  assert.equal(counts.soloSessions, 1); assert.equal(counts.duetSessions, 1);
  assert.match(settlementClassCountPresentation(counts).privateDetail, /개인 1회 · 듀엣 1회 · 회원별 정산 3건/);
});
test('exact duplicate rows do not inflate classes or settlement units', () => {
  const counts = get([row(), row()]); assert.equal(counts.privateSessions, 1); assert.equal(counts.privateSettlementUnits, 1);
});
test('no-show half weight and absent duet participant preserve existing financial basis', () => {
  const counts = get([row({attendance:'노쇼'}),row({classTime:'11:00',ticketName:'듀엣권'}),
    row({classTime:'11:00',ticketName:'듀엣권',memberName:'다른 회원',attendance:'결석'})]);
  assert.equal(counts.privateSessions, 2); assert.equal(counts.privateSettlementUnits, 1.5); assert.equal(counts.duetSessions, 1);
});
test('absent-only ordinary groups retain the ledger session rule; absent private and lessons do not', () => {
  const counts = get([row({finalType:'그룹',attendance:'결석'}),row({classTime:'11:00',attendance:'결석'}),
    row({finalType:'강사레슨',classTime:'12:00',attendance:'결석'})]);
  assert.equal(counts.groupSessions, 1); assert.equal(counts.privateSessions, 0); assert.equal(counts.lessonSessions, 0);
});
test('native class IDs separate concurrent source classes when available', () => {
  assert.equal(get([row({classId:'class-a'}),row({classId:'class-b',memberName:'다른 회원'})]).privateSessions, 2);
  assert.equal(get([row({classId:'class-a'}),row({classId:'class-b'})]).privateSessions, 2);
  assert.throws(() => get([row({classId:'class-a'}),row({classId:'class-a',classDate:'2026-10-02'})]));
  const runner=readFileSync(new URL('../generate-monthly-settlement-statements.mjs',import.meta.url),'utf8');
  assert(runner.includes('classId: clean(row.classId)'));
});
test('ambiguous concurrent classes, changed member rows and mixed ticket kinds fail closed', () => {
  for (const other of [{memberName:'다른 회원'}, {endTime:'11:00'}, {revenue:20000}, {ticketName:'듀엣권'}])
    assert.throws(() => get([row(), row(other)]), /SOURCE_REVIEW_REQUIRED/);
});
test('wrong month, missing source, unknown attendance and missing identity are not inferred as zero', () => {
  assert.throws(() => get([]));
  for (const change of [{classDate:'2026-11-01'}, {endTime:''}, {memberName:''}, {ticketName:''}, {ticketName:'unclassified-ticket'}, {attendance:'취소'}])
    assert.throws(() => get([row(change)]));
});
test('count reconciliation blocks stale or incomplete source without changing ledger fields', () => {
  const counts = get([row()]), ledger={groupCount:0,lessonCount:0,privateCount:1,privatePay:12345};
  const before=structuredClone(ledger);assert.equal(reconcileSettlementClassCounts(counts,ledger),counts);assert.deepEqual(ledger,before);
  assert.throws(() => reconcileSettlementClassCounts(counts,{...ledger,privateCount:2}));
  assert.throws(() => reconcileSettlementClassCounts(undefined,ledger));
});
test('triples are explicit; invalid arithmetic is rejected', () => {
  const counts=get([row({ticketName:'트리플권'})]);assert.equal(counts.tripleSessions,1);
  assert.match(settlementClassCountPresentation(counts).privateDetail,/트리플 1회/);
  assert.throws(() => settlementClassCountPresentation({...counts,totalSessions:99}));
});
test('recipient displays safe breakdowns and keeps the exact payout supplied by the financial caller', () => {
  const p=settlementClassCountPresentation(get([row()]));
  const html=renderSettlementRecipientDocument({month:'202610',name:'검증용 강사',totalClasses:p.totalClasses,payout:'123,456원',
    metrics:[p.groupMetric,p.privateMetric,{label:'평균',value:'1명'},{label:'세전',value:'130,000원',details:['<script>not markup</script>']} ]});
  for(const text of ['총 수업 1회','일반 그룹 0회','강사레슨 0회','듀엣 0회','회원별 정산 1건','123,456원'])assert(html.includes(text));
  assert(!html.includes('<script>'));assert(html.includes('&lt;script&gt;'));
});
