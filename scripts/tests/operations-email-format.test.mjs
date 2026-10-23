import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatOperationsReport, renderOperationsEmail, normalizeOperationsIdentity, operationsReportLabels, kstTimestamp, buildOperationsReportMime } from '../lib/operations-email-format.mjs';
import { holdingFingerprint } from '../lib/studiomate-holding-source.mjs';
import { systemHealthEmail } from '../lib/system-health-email.mjs';
import { deliverAutomationReport, reportMessageId } from '../../firebase/kangsain-functions/macmini-studiomate/automation-report-delivery.mjs';

test('reports lead with problem counts, root cause, impact and action, not zero repairs', () => {
  const report = systemHealthEmail({ status: 'action_required', findingCount: 1, criticalCount: 0, actionRequiredCount: 1, warningCount: 0, repairedCount: 0, restartRequestedCount: 0, mode: 'quick', runId: 'fixture', finishedAt: '2026-10-10T23:40:00.000Z', findings: [{ title: '회원 계약 확인', cause: 'member_coverage_review_1', impact: '원천 한 건 검토', suggestedAction: '원장 대조' }] }, '/tmp/fixture.json');
  assert.equal(report.subject, '[시스템점검][확인필요] 점검 필요 1건 · 2026-10-11');
  for (const text of ['ARCHIVE CORE', 'member_coverage_review_1', '원천 한 건 검토', '원장 대조', '재실행 요청은 복구 완료가 아닙니다']) assert.ok(report.body.includes(text));
  assert.doesNotMatch(report.body, /ARCHIVE IN/);
});

test('shared contract includes sections and KST date rollover', () => {
  const report = formatOperationsReport({ area: '친구초대', status: '성공', title: '자동 적립 복구', observedAt: '2026-10-10T23:00:00Z', context: '자동 적립', conclusion: '완료' });
  assert.equal(report.subject, '[친구초대][성공] 자동 적립 복구 · 2026-10-11');
  for (const section of ['주체:', '결론:', '핵심:', '검증:', '주의:', '다음:', '상세:']) assert.ok(report.body.includes(section));
  assert.equal(kstTimestamp('bad'), '확인 불가');
});

test('legacy identity correction preserves live endpoints and paths', () => {
  const text = '주체: ARCHIVE IN / 점검\nhttps://in.archivepilates.com/private-chart/\n/Users/archivepilates/ArchiveIN/file\n이전 ARCHIVE IN 기록';
  assert.equal(normalizeOperationsIdentity(text), text.replace('주체: ARCHIVE IN', '주체: ARCHIVE CORE'));
});

test('HTML escapes untrusted source text and retains safe detail links', () => {
  const html = renderOperationsEmail('<img onerror=bad>', '주체: ARCHIVE IN / 점검\n핵심:\n<script>bad</script>\nhttps://core.archivepilates.com/automation/');
  assert.doesNotMatch(html, /<script>|<img|ARCHIVE IN/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /max-width:640px/);
  assert.match(html, /href="https:\/\/core.archivepilates.com\/automation\/"/);
  assert.deepEqual(operationsReportLabels('[시스템점검][실패] 오류', '자동화 실패'), ['시스템점검 보고', '자동화 실패']);
});

test('domain/status labels are combined without changing delivery reconciliation', async () => {
  const calls = [];
  const result = await deliverAutomationReport({ gmailFetch: async (url, options) => { calls.push({ url, options }); return url.endsWith('/send') ? { id: 'sent' } : {}; }, raw: 'fixture', labelIds: ['domain', 'status', 'status'] });
  assert.equal(result.messageId, 'sent');
  assert.deepEqual(JSON.parse(calls[1].options.body).addLabelIds, ['domain', 'status']);
});

test('MIME has identical plain/HTML content, wrapped encoding and stable delivery identity', () => {
  const input = { from: 'home@archivepilates.com', to: 'home@archivepilates.com', subject: '[시스템점검][실패] 오류', body: '주체: ARCHIVE IN / 점검\n결론: 확인 필요\n'.repeat(30), messageId: reportMessageId('a'.repeat(64)), boundary: 'fixture' };
  const mime = buildOperationsReportMime(input);
  const parts = mime.split('--fixture\r\n').slice(1);
  assert.equal(parts.length, 2);
  const plain = Buffer.from(parts[0].split('\r\n\r\n')[1].trim(), 'base64').toString('utf8');
  const html = Buffer.from(parts[1].split('\r\n\r\n')[1].split('--fixture--')[0].trim(), 'base64').toString('utf8');
  assert.equal(plain, normalizeOperationsIdentity(input.body));
  assert.match(html, /결론: 확인 필요/);
  assert.match(mime, /Message-ID: <automation-aaaa/);
  assert.doesNotMatch(html, /ARCHIVE IN/);
  for (const line of mime.split('\r\n')) assert.ok(line.length < 998);
  assert.throws(() => buildOperationsReportMime({ ...input, to: 'home@example.test\r\nBcc:other@example.test' }), /Invalid report header/);
});

test('holding error notification keys satisfy the sender contract and are stable', () => {
  const source = readFileSync(new URL('../run-automatic-holding-notices.ts', import.meta.url), 'utf8');
  const expressions = [...source.matchAll(/AUTOMATION_REPORT_EVENT_ID:\s*(holdingFingerprint\([^\n]+\)),/g)].map(match => match[1]);
  assert.equal(expressions.length, 3);
  const evaluate = (expression, rows = [{ id: 'b', reason: 'waiting' }, { id: 'a', reason: 'waiting' }]) => new Function('holdingFingerprint', 'job', 'reason', 'receiptReviews', 'busy', `return ${expression}`)(holdingFingerprint, { jobId: 'fixture' }, 'review', rows, { patch: { browserBusySince: '2026-10-24T00:00:00.000Z' } });
  for (const expression of expressions) {
    assert.doesNotThrow(() => reportMessageId(evaluate(expression)));
    assert.equal(evaluate(expression), evaluate(expression));
  }
  const receiptExpression = expressions.find(expression => expression.includes('holding_receipt_review'));
  assert.ok(receiptExpression);
  assert.equal(evaluate(receiptExpression), evaluate(receiptExpression, [{ id: 'a', reason: 'waiting' }, { id: 'b', reason: 'waiting' }]));
  assert.doesNotMatch(source, /AUTOMATION_REPORT_EVENT_ID:\s*`holding_/);
});
