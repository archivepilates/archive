import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { resolveSignupBirthDateV2, normalizeSignupBirthDateV2, SIGNUP_SIX_DIGIT_BIRTH_POLICY } from '../lib/instructor-signup-profile-v2-policy.mjs';

const source = readFileSync(new URL('../verify-instructor-signup-enrichment.mjs', import.meta.url), 'utf8');
const start = source.indexOf("if(['verified','already_equal'].includes(progress.birthDate.status))");
const end = source.indexOf("if(progress.address.status==='verified')", start);
assert(start > 0 && end > start);
const check = new vm.Script(source.slice(start, end));
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const reference = new Date('2026-12-31T14:59:59.999Z');
const later = Date.parse('2027-01-02T00:00:00Z');
function proof(raw, native = '') {
  const resolved = resolveSignupBirthDateV2({expected: raw, current: native, now: reference});
  assert.equal(resolved.status, 'verified');
  return {raw, value: resolved.value, progress: {birthDate: {status: 'verified', resolution: resolved.resolution,
    expectedHash: sha(resolved.value)}, beforeFieldHashes: {birthDate: sha(native)}}};
}
function verify(row) {
  const DateAtReadback = class extends Date { static now() { return later; } };
  return check.runInNewContext({assert, sha, resolveSignupBirthDateV2, normalizeSignupBirthDateV2,
    SIGNUP_SIX_DIGIT_BIRTH_POLICY, Date: DateAtReadback, values: {birthDate: row.value},
    progress: row.progress, job: {profileUpdate: {birthDateRaw: row.raw}}});
}

test('actual read-only verifier freezes current-year conversion after KST New Year', () => {
  const row = proof('270101');
  assert.equal(row.value, '1927-01-01');
  assert.equal(resolveSignupBirthDateV2({expected: row.raw, now: new Date(later)}).value, '2027-01-01');
  assert.doesNotThrow(() => verify(row));
});
test('actual verifier preserves matching native century after rollover', () => {
  const row = proof('200102', '1920-01-02');
  row.progress.birthDate.status = 'already_equal';
  assert.equal(row.progress.birthDate.resolution.source, 'native_full_match');
  assert.doesNotThrow(() => verify(row));
});
for (const [label, change] of Object.entries({
  changedNative: row => {row.value = '2027-01-01';},
  changedRaw: row => {row.raw = '270102';},
  changedHash: row => {row.progress.birthDate.expectedHash = 'a'.repeat(64);},
  missingHash: row => {delete row.progress.birthDate.expectedHash;},
  unknownPolicy: row => {row.progress.birthDate.resolution.policy = 'unknown';},
  unknownSource: row => {row.progress.birthDate.resolution.source = 'unknown';},
  invalidClock: row => {row.progress.birthDate.resolution.referenceAt = 'invalid';},
  futureClock: row => {row.progress.birthDate.resolution.referenceAt = '2028-01-01T00:00:00Z';},
  shiftedClock: row => {row.progress.birthDate.resolution.referenceAt = '2027-01-01T15:00:00Z';},
})) test('actual verifier rejects ' + label, () => {
  const row = proof('270101'); change(row); assert.throws(() => verify(row));
});
test('historical operator-reviewed and unresolved rows still verify preserved field hash', () => {
  for (const status of ['operator_verified', 'review', 'conflict']) {
    const row = {raw: '900102', value: '1990-01-02', progress: {birthDate: {status},
      beforeFieldHashes: {birthDate: sha('1990-01-02')}}};
    assert.doesNotThrow(() => verify(row));
    row.value = '1990-01-03'; assert.throws(() => verify(row));
  }
});
test('legacy full-year results need no new resolution metadata', () => {
  const row = {raw: '19900102', value: '1990-01-02', progress: {birthDate: {status: 'verified'}}};
  assert.doesNotThrow(() => verify(row));
  row.raw = '900102'; assert.throws(() => verify(row));
});
