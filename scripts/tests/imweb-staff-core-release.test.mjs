import test from 'node:test';
import assert from 'node:assert/strict';
import { assertStaffNoteOnly, assertStudentShareNoteOnly, assertWebhookOnboardingNoteOnly } from '../release-imweb-staff-core-rules.mjs';

test('CORE release accepts exactly one new staff policy note and no other changes', () => {
  const before = '<main>\n</main>\n';
  const line = '  <div class="rule-note" id="imweb-staff-video-policy"><strong>Staff</strong></div>\n';
  const after = '<main>\n'+line+'</main>\n';
  assertStaffNoteOnly(before, after);
  for (const bad of [before, after+line, after.replace('<main>', '<other>')]) {
    assert.throws(() => assertStaffNoteOnly(before, bad));
  }
  assert.throws(() => assertStaffNoteOnly(after, after));
});

test('student-share release adds its note without replacing historical rules or other assets', () => {
  const before = '<main>\n  <p>Existing staff note stays untouched</p>\n</main>\n';
  const line = '  <div class="rule-note" id="imweb-student-share-first-grant-policy"><strong>40 days</strong></div>\n';
  const after = before.replace('</main>', line+'</main>');
  assertStudentShareNoteOnly(before, after);
  for (const bad of [before, after+line, after.replace('untouched', 'changed'), after.replace('40 days', '40\ndays')]) {
    assert.throws(() => assertStudentShareNoteOnly(before, bad));
  }
  assert.throws(() => assertStudentShareNoteOnly(after, after));
});

test('webhook onboarding release permits one operational note without other changes', () => {
  const before = '<main>\n  <p>Prior grant and STAFF protections stay</p>\n</main>\n';
  const line = '  <div class="rule-note" id="imweb-app-webhook-onboarding-policy"><strong>Pending review</strong></div>\n';
  const after = before.replace('</main>', line+'</main>');
  assertWebhookOnboardingNoteOnly(before, after);
  for (const bad of [before, after+line, after.replace('protections stay', 'protection removed')])
    assert.throws(() => assertWebhookOnboardingNoteOnly(before, bad));
});
