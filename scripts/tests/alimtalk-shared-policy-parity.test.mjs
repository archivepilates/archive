import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
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
  test(`${name}: execution bodies preserve baseline except exact welcome preflight deferral branches`, () => {
    const file = prefix + name;
    let current = read(file);
    if (name === 'processAlimtalkQueue.ts') {
      for (const branch of welcomePreflightBranches) {
        assert.equal(current.split(branch).length - 1, 1, 'Exact typed preflight branch must occur once');
        current = current.replace(branch, '');
      }
    }
    assert.deepEqual(functions(ast(current, file)), functions(ast(before(file), file)));
    const imports = ast(read(file), file).statements.filter(ts.isImportDeclaration);
    const shared = imports.find(node => node.moduleSpecifier.text === './targetValidationChecks');
    assert.ok(shared);
    const names = new Map(shared.importClause.namedBindings.elements.map(node => [node.name.text, node.propertyName?.text || node.name.text]));
    assert.equal(names.get('autoSendabilityIssue'), 'targetEligibilityIssue');
    assert.equal(names.get('findCompletedDuplicateForCandidate'), 'targetDuplicateIssue');
  });
}
test('eligibility send evaluator has exactly the previous rule body, with only optional template-read mode added', () => {
  const file = prefix + 'eligibility.ts';
  const old = functions(ast(before(file), file)).get('autoSendabilityIssue');
  const current = functions(ast(read(file), file)).get('evaluateAutoSendability')
    .replace('alimtalkTemplateReadiness(candidate.templateCode, options)', 'alimtalkTemplateReadiness(candidate.templateCode)');
  assert.equal(current, old);
  const checks = read(prefix + 'targetValidationChecks.ts');
  assert.match(checks, /options\.readOnly \? inspectAutoSendabilityIssue\(candidate, today\) : autoSendabilityIssue\(candidate, today\)/);
  assert.match(checks, /return findCompletedDuplicateForCandidate\(candidate, key, windowDays\)/);
});
for (const name of ['dedupe.ts', 'templates.ts', 'templateTargetRules.ts', 'recipientExclusion.ts', 'testRecipients.ts',
  'privateSurveySendGuard.ts', 'renewalSendGuard.ts', 'longAbsenceSendGuard.ts', 'approvalStore.ts']) {
  test(`${name}: canonical selection, history windows and exceptions are unchanged`, () => {
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
    assert.equal(read(prefix + name), before(prefix + name));
  });
}
