import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { beforeEach, test } from 'node:test';
import { deriveInstructorLessonRegistrationState as deriveJs } from '../lib/instructor-lesson-registration-contract.mjs';

const require = createRequire(new URL('../../firebase/kangsain-functions/functions/package.json', import.meta.url));
const ts = require('typescript');
const path = new URL('../../firebase/kangsain-functions/functions/src/instructorLessonRegistration/instructorLessonRegistrationState.ts', import.meta.url);
// Compile only the pure state function in memory, never import a Firebase entrypoint.
const compiled = ts.transpileModule(readFileSync(path, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
vm.runInNewContext(compiled, { exports }, { timeout: 1000 });
const deriveTs = exports.deriveInstructorLessonRegistrationState;
assert.equal(typeof deriveTs, 'function');
const implementations = [['JS', deriveJs], ['TS', input => JSON.parse(JSON.stringify(deriveTs(input)))]];
const keys = ['member', 'ticket', 'eformsign', 'memo', 'confirmation'];
const verified = () => Object.fromEntries(keys.map(key => [key, { status: 'verified' }]));

beforeEach(t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Live access is forbidden in pure state tests'));
});

for (const [name, derive] of implementations) {
  test(`${name}: Team intake is supported without changing its mode or intake-only marker`, () => {
    const input = { mode: 'team_intake', intakeOnly: true, steps: verified() };
    Object.values(input.steps).forEach(Object.freeze);
    Object.freeze(input.steps);
    Object.freeze(input);
    const before = JSON.stringify(input);
    assert.deepEqual(derive(input), { status: 'completed', nextAction: '없음' });
    assert.equal(JSON.stringify(input), before);
    assert.equal(derive({ mode: 'team_intake' }).status, 'processing');
    assert.equal(derive({ mode: 'unresolved', steps: verified() }).status, 'processing');
  });

  for (const key of keys) for (const status of ['failed', 'review_required']) {
    test(`${name}: Team ${key}=${status} requires operator action`, () => {
      assert.equal(derive({ mode: 'team_intake', steps: { ...verified(), [key]: { status } } }).status, 'action_required');
    });
  }

  for (const key of ['member', 'ticket']) {
    test(`${name}: Team requires verified ${key} before signup/completion`, () => {
      for (const status of ['pending', 'processing', 'not_required', undefined]) {
        assert.equal(derive({ mode: 'team_intake', steps: { ...verified(), [key]: { status } } }).status, 'processing');
      }
    });
  }

  test(`${name}: Team signup waits like new_member, including sent or not-required records`, () => {
    for (const status of ['pending', 'queued', 'sent', 'waiting_external', 'not_required', undefined]) {
      const steps = { ...verified(), eformsign: { status } };
      const result = derive({ mode: 'team_intake', steps });
      assert.equal(result.status, 'waiting_signature');
      assert.deepEqual(result, derive({ mode: 'new_member', steps }));
    }
  });

  test(`${name}: Team memo waits like new_member after verified signup`, () => {
    for (const status of ['pending', 'queued', 'processing', 'not_required', undefined]) {
      const steps = { ...verified(), memo: { status } };
      const result = derive({ mode: 'team_intake', steps });
      assert.equal(result.status, 'memo_pending');
      assert.deepEqual(result, derive({ mode: 'new_member', steps }));
    }
  });

  test(`${name}: Team confirmation must be verified, never inferred from a send or bypassed`, () => {
    for (const status of ['pending', 'queued', 'sent', 'waiting_external', 'not_required', undefined]) {
      const result = derive({ mode: 'team_intake', steps: { ...verified(), confirmation: { status } } });
      assert.equal(result.status, 'confirmation_pending');
      assert.equal(result.nextAction, '팀레슨 예약확정 안내 확인 대기');
      assert.doesNotMatch(result.nextAction, /자동 발송/);
    }
    assert.equal(derive({ mode: 'team_intake', steps: { ...verified(), bookings: { status: 'pending' } } }).status, 'completed');
  });

  test(`${name}: standard new/returning completion and signup behavior stay unchanged`, () => {
    for (const mode of ['new_member', 'returning_member']) {
      assert.equal(derive({ mode, steps: { ...verified(), confirmation: { status: 'not_required' } } }).status, 'completed');
      assert.deepEqual(derive({ mode, steps: { ...verified(), confirmation: { status: 'pending' } } }), {
        status: 'confirmation_pending', nextAction: '수강권 발급 후 예약확정 알림톡 자동 발송 대기',
      });
    }
    assert.equal(derive({ mode: 'returning_member', steps: {
      member: { status: 'verified' }, ticket: { status: 'verified' }, confirmation: { status: 'verified' },
    } }).status, 'completed');
    assert.equal(derive({ mode: 'new_member', steps: {
      member: { status: 'verified' }, ticket: { status: 'verified' }, confirmation: { status: 'verified' },
    } }).status, 'waiting_signature');
  });
}

test('Team JS/TS parity across all five-step status combinations', () => {
  const statuses = ['pending', 'verified', 'not_required', 'sent', 'failed', 'review_required'];
  for (let index = 0; index < statuses.length ** keys.length; index++) {
    let remaining = index;
    const steps = {};
    for (const key of keys) {
      steps[key] = { status: statuses[remaining % statuses.length] };
      remaining = Math.floor(remaining / statuses.length);
    }
    const input = { mode: 'team_intake', steps };
    assert.deepEqual(JSON.parse(JSON.stringify(deriveTs(input))), deriveJs(input), JSON.stringify(steps));
  }
});
