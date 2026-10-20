import test from 'node:test';
import assert from 'node:assert/strict';
import { assertStaffNoteOnly } from '../release-imweb-staff-core-rules.mjs';

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
