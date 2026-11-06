import assert from 'node:assert/strict';
import test from 'node:test';
import { canResolveHealthFinding } from '../lib/system-health-current-state.mjs';

const finding = { findingId: 'synthetic-legacy', checkKey: '', area: 'settlement',
  title: 'Monthly settlement statements 실행 결과 최신성 확인 필요',
  sourceRefs: ['/synthetic/202610/INDEX.html', '/synthetic/202610/INDEX_review.html'] };
const checks = new Set(['settlement:monthly-statements', ...finding.sourceRefs]);
test('legacy unkeyed settlement alert resolves only with exact completed artifact references', () => {
  assert.equal(canResolveHealthFinding(finding, new Set(), checks), true);
  for (const source of finding.sourceRefs) {
    const partial = new Set(checks); partial.delete(source);
    assert.equal(canResolveHealthFinding(finding, new Set(), partial), false);
  }
  assert.equal(canResolveHealthFinding(finding, new Set(), new Set(['settlement:monthly-statements'])), false);
  assert.equal(canResolveHealthFinding(finding, new Set(['synthetic-legacy']), checks), false);
  assert.equal(canResolveHealthFinding({ ...finding, sourceRefs: [] }, new Set(), checks), false);
  assert.equal(canResolveHealthFinding({ ...finding, sourceRefs: ['/synthetic/202609/INDEX.html'] }, new Set(), checks), false);
});
test('unrelated legacy failures and arbitrary settlement titles remain unresolved', () => {
  for (const patch of [{ title: 'Monthly settlement statements 최근 실행 실패' },
    { title: '정산 금액 확인필요' }, { area: 'other' }])
    assert.equal(canResolveHealthFinding({ ...finding, ...patch }, new Set(), checks), false);
});
