import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const require = createRequire(new URL('../../firebase/kangsain-functions/functions/package.json', import.meta.url));
const ts = require('typescript');
const root = new URL('../../', import.meta.url);
const base = '49f617ec76973b25cb2cf3e33bee156ea79cd527';
const prefix = 'firebase/kangsain-functions/functions/src/alimtalk/';
const read = file => readFileSync(new URL(file, root), 'utf8');
const before = file => execFileSync('git', ['show', `${base}:${file}`], { cwd: root, encoding: 'utf8' });
const ast = (text, file) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
const functions = source => new Map(source.statements.filter(ts.isFunctionDeclaration)
  .map(statement => [statement.name.text, statement.body.getText(source)]));
const welcomePreflightBranches = [
  `      if (err instanceof MembershipWelcomePreflightError) {
        const recorded = await deferMembershipWelcomePreflight({ db, timestamp: nowTimestamp }, claimed, err);
        if (recorded) deferred += 1;
        else {
          failed += 1;
          logger.error("Membership welcome preflight state conflict; no attempt recorded", { candidateId: claimed.candidateId });
        }
        continue;
      }
`,
  `    if (err instanceof MembershipWelcomePreflightError) {
      const recorded = await deferMembershipWelcomePreflight({ db, timestamp: nowTimestamp }, claimed, err);
      if (!recorded) logger.error("Membership welcome preflight state conflict; no attempt recorded", { candidateId: claimed.candidateId });
      return { processed: true, status: recorded ? "deferred" : "failed", lastError: recorded ? err.message : "membership_welcome_preflight_state_conflict" };
    }
`,
];

for (const name of ['processAlimtalkQueue.ts', 'instructorLessonSampleApproval.ts']) {
  test(`${name}: execution bodies preserve the reviewed quiet-hours release`, () => {
    const file = prefix + name;
    const audit = JSON.parse(read('scripts/fixtures/member-dispatch-execution-audit.json'));
    assert.equal(audit.approval, 'user_member_dispatch_quiet_hours_20261022');
    assert.equal(audit.policy, 'member_dispatch_kst_0900_2300_v1');
    const current = functions(ast(read(file), file));
    const expected = { ...audit.functions[name] };
    if (name === 'instructorLessonSampleApproval.ts') {
      // The already-released preflight recovery changed only these three bodies.
      const reviewedSource = execFileSync('git', ['show', `15ccdd571d27dc96434a5334aba3ed7bd887ab34:${file}`], { cwd: root, encoding: 'utf8' });
      const reviewed = functions(ast(reviewedSource, file));
      for (const key of ['canRecoverBlockedInstructorLessonSample', 'prepareInstructorLessonSampleApproval', 'remindPendingInstructorLessonApprovals']) {
        assert.ok(reviewed.has(key));
        expected[key] = createHash('sha256').update(reviewed.get(key)).digest('hex');
      }
    }
    assert.deepEqual(Object.fromEntries([...current].map(([key, body]) => [key, createHash('sha256').update(body).digest('hex')])), expected);
    for (const branch of name === 'processAlimtalkQueue.ts' ? welcomePreflightBranches : [])
      assert.equal(read(file).split(branch).length - 1, 1, 'Existing typed welcome preflight branch remains intact');
    const imports = ast(read(file), file).statements.filter(ts.isImportDeclaration);
    const shared = imports.find(node => node.moduleSpecifier.text === './targetValidationChecks');
    assert.ok(shared);
    const names = new Map(shared.importClause.namedBindings.elements.map(node => [node.name.text, node.propertyName?.text || node.name.text]));
    assert.equal(names.get('autoSendabilityIssue'), 'targetEligibilityIssue');
    assert.equal(names.get('findCompletedDuplicateForCandidate'), 'targetDuplicateIssue');
  });
}
test('eligibility preserves previous rules apart from the reviewed outdoor guard and optional template-read mode', () => {
  const file = prefix + 'eligibility.ts';
  const old = functions(ast(before(file), file)).get('autoSendabilityIssue');
  const current = functions(ast(read(file), file)).get('evaluateAutoSendability')
    .replace('  // A test override does not turn an outdoor booking into a regular group lesson.\n  const outdoorIssue = await currentOutdoorGroupSurveyExclusionReason(candidate);\n  if (outdoorIssue) return outdoorIssue;\n', '')
    .replace('alimtalkTemplateReadiness(candidate.templateCode, options)', 'alimtalkTemplateReadiness(candidate.templateCode)');
  assert.equal(current, old);
  const checks = read(prefix + 'targetValidationChecks.ts');
  assert.match(checks, /options\.readOnly \? inspectAutoSendabilityIssue\(candidate, today\) : autoSendabilityIssue\(candidate, today\)/);
  assert.match(checks, /return findCompletedDuplicateForCandidate\(candidate, key, windowDays\)/);
});
for (const name of ['dedupe.ts', 'templates.ts', 'templateTargetRules.ts', 'recipientExclusion.ts', 'testRecipients.ts',
  'privateSurveySendGuard.ts', 'renewalSendGuard.ts', 'longAbsenceSendGuard.ts', 'approvalStore.ts']) {
  test(`${name}: existing policy is preserved outside the reviewed outdoor exclusion`, () => {
    if (name === 'templates.ts') {
      const file = prefix + name;
      const metadata = new Set(['RESERVATION_OPEN_ALIMTALK_TEMPLATE', 'PRIVATE_SURVEY_NONWELCOME_CONTRACT',
        'PRIVATE_LESSON_REPORT_NONWELCOME_CONTRACT']);
      const seen = new Set();
      const current = ast(read(file), file);
      const policyStatements = current.statements.filter(statement => {
        if (!ts.isVariableStatement(statement)) return true;
        const declarations = statement.declarationList.declarations;
        const names = declarations.map(node => node.name.getText(current));
        if (!names.some(name => metadata.has(name))) return true;
        assert.equal(declarations.length, 1);
        assert.equal(names.length, 1);
        assert.equal(seen.has(names[0]), false);
        seen.add(names[0]);
        return false;
      });
      assert.deepEqual(seen, metadata, 'Only the three independently audited metadata declarations are additional');
      const baseline = ast(before(file), file);
      assert.deepEqual(policyStatements.map(node => node.getText(current)), baseline.statements.map(node => node.getText(baseline)));
      return;
    }
    let current = read(prefix + name);
    if (name === 'templateTargetRules.ts') {
      current = current.replace('      "예약에 연결된 수강권이 야외수업이 아님",\n', '')
        .replace('      "야외수업 예약 (출석 이력에서도 제외)",\n', '');
    }
    if (name === 'recipientExclusion.ts') {
      const parsed = ast(current, prefix + name);
      const added = parsed.statements.find(node => ts.isFunctionDeclaration(node)
        && node.name.text === 'currentOutdoorGroupSurveyExclusionReason');
      assert.ok(added);
      current = current.slice(0, added.getStart(parsed)) + current.slice(added.end + 2);
      current = current.replace('import { isOutdoorGroupSurveyBooking, OUTDOOR_GROUP_SURVEY_EXCLUSION_REASON } from "../privateSurvey/groupSurveyBookingPolicy";\n', '')
        .replace('    if (isOutdoorGroupSurveyBooking(booking)) return OUTDOOR_GROUP_SURVEY_EXCLUSION_REASON;\n', '');
    }
    assert.equal(current, before(prefix + name));
  });
}
