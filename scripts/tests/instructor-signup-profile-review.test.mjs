import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { beforeEach, test } from 'node:test';
import { nativeProfileReviewHash, planSignupProfileReviewResolution, profileSourceHash, profileReviewApprovalHash }
  from '../lib/instructor-signup-profile-review.mjs';
import { assertSignupProfileV2Source, signupV2Projection } from '../lib/instructor-signup-profile-v2.mjs';
import { parseCompletedRecipientStatus } from '../lib/instructor-signup-order-identity.mjs';
import { INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_ID as TEMPLATE }
  from '../lib/instructor-lesson-registration-contract.mjs';

const NOW = new Date('2026-11-01T03:00:00.000Z');
const DOC = 'a'.repeat(32), OTHER_DOC = 'c'.repeat(32);
const REG = 'ilr_' + 'b'.repeat(24), MEMBER = '9000001';
const COMPLETED = '2025-12-30T06:36:27.123Z';
const ROAD = '서울특별시 강남구 테헤란로 123', DETAIL = '합성빌딩 704호';
const OTHER_ROAD = '부산광역시 해운대구 센텀중앙로 97', OTHER_DETAIL = '합성타워 905호';
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clone = structuredClone;

beforeEach(t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const forbidden = () => assert.fail('Synthetic review tests must not call live services');
  t.mock.method(globalThis, 'fetch', forbidden);
  for (const [target, methods] of [[http, ['request', 'get']], [https, ['request', 'get']],
    [net, ['connect', 'createConnection']], [tls, ['connect']]]) {
    for (const method of methods) t.mock.method(target, method, forbidden);
  }
});

// Use the same real completion parser/projection as the v2 source integration tests.
function fixture({ manual = false } = {}) {
  const source = { jobId: REG, registrationId: REG, studioId: '5330', studiomateMemberId: MEMBER,
    memberName: '합성회원', memberPhone: '01000000001', documentId: DOC,
    documentName: '2025-12-30_강사회원가입서_합성회원', status: 'done', externalEffectStarted: true };
  const profile = { version: 2, documentId: DOC, templateId: TEMPLATE, memberName: source.memberName,
    memberPhone: source.memberPhone, birthDateRaw: '900102', addressRaw: ROAD + ' ' + DETAIL,
    career: '5년', affiliation: '합성 필라테스' };
  const completedMs = Date.parse(COMPLETED);
  const completion = parseCompletedRecipientStatus({ job: source, selectedDocumentId: DOC, templateId: TEMPLATE,
    method: 'GET', httpStatus: 200, observedAt: NOW.toISOString(),
    responseUrl: `https://kr-service.eformsign.com/v1.0/companies/848f6dc7fa024a6cb28a2994c0835e53/documents/${DOC}/status`,
    body: { code: '-1', status: '200', result: { status: { document_title: source.documentName,
      steps: [{ seq: 1, action: 'doc_create' },
        { seq: 2, action: 'doc_accept_participant', execute_date: completedMs - 60000,
          owner: { members: [source.memberName + '(+821000000001)'], groups: null, external_creators: null } },
        { seq: 3, action: 'doc_complete', execute_date: String(completedMs) }],
      current_infos: [{ step_seq: 3, current_writer: null, waitingExternalApproval: false }],
    } } } });
  const projection = signupV2Projection({ job: source, profile, completion, memberId: MEMBER,
    registrationId: REG, now: NOW });
  Object.assign(source, { submittedProfile: profile, profileMemoJobId: projection.memoId, completionProof: completion });
  const job = { jobId: projection.memoId, registrationId: REG, profileSourceJobId: REG,
    source: 'instructor_member_eformsign', studioId: '5330', memberId: MEMBER, studiomateMemberId: MEMBER,
    memberName: source.memberName, memberPhone: source.memberPhone, content: projection.content,
    profileUpdate: projection.profileUpdate, status: 'done', memoWriteState: 'verified',
    profileSyncStatus: 'review_required', attempts: 2, externalEffectStarted: true,
    completedAt: '2026-11-01T02:55:00.000Z',
    profileStatus: { version: 2, checkedAt: '2026-11-01T02:55:00.000Z',
      birthDate: { status: 'already_equal', expectedHash: sha('1990-01-02') },
      address: { status: 'review', reason: 'postal_exact_match_unavailable', stage: 'result_selection' },
      beforeFieldHashes: { birthDate: sha('1990-01-02'), address: sha(''), detail: sha(''), protectedHash: sha('protected') } } };
  const registration = { registrationId: REG, studioId: '5330', studiomateMemberId: MEMBER,
    memberName: source.memberName, memberPhone: source.memberPhone, lessonDate: '2026-11-28',
    mode: 'new_member', status: 'action_required', nextAction: '확인필요 항목 검토',
    evidence: { eformsignDocumentId: DOC },
    steps: { member: { status: 'verified' }, ticket: { status: 'verified' },
      eformsign: { status: 'verified', documentId: DOC },
      memo: { status: 'review_required', label: '가입서 정보 반영', jobId: job.jobId },
      confirmation: { status: 'verified', messageId: 'synthetic-prior-confirmation' } } };
  const memo = { memoId: job.jobId, studioId: '5330', memberId: MEMBER, content: job.content,
    syncStatus: 'synced', syncedAt: job.completedAt };
  const native = { memberId: MEMBER, name: source.memberName, phone: source.memberPhone,
    memberGrade: '강사회원', birthDate: '1990-01-02', address: manual ? OTHER_ROAD : ROAD,
    detail: manual ? OTHER_DETAIL : DETAIL };
  const proof = { kind: 'studiomate_live_editor_readonly', jobId: job.jobId, documentId: DOC,
    profileUpdateHash: sha(job.profileUpdate), memberWrites: 0, checkedAt: NOW.toISOString(), native };
  const approval = { confirmed: true, ref: 'operator:synthetic-review:20261101', confirmedAt: NOW.toISOString(),
    mode: manual ? 'operator_confirmed_current_address' : 'signed_fields_equal',
    nativeProfileHash: sha([MEMBER, source.memberName, source.memberPhone, native.birthDate, native.address, native.detail]) };
  approval.operationHash = sha([job.jobId, job.registrationId, job.profileUpdate.documentId, job.profileUpdate.sourceHash,
    sha(job.profileUpdate), approval.mode, approval.nativeProfileHash]);
  return { job, source, registration, memo, proof, approval, now: new Date(NOW) };
}

function approveCurrent(f) {
  f.approval.nativeProfileHash = nativeProfileReviewHash(f.proof.native);
  f.approval.operationHash = profileReviewApprovalHash({ job: f.job, mode: f.approval.mode, native: f.proof.native });
}

function reproject(f) {
  const p = signupV2Projection({ job: f.source, profile: f.source.submittedProfile,
    completion: f.source.completionProof, memberId: f.job.memberId, registrationId: f.source.registrationId, now: f.now });
  f.source.profileMemoJobId = p.memoId;
  Object.assign(f.job, { jobId: p.memoId, registrationId: f.source.registrationId, profileSourceJobId: f.source.jobId,
    content: p.content, profileUpdate: p.profileUpdate });
  Object.assign(f.memo, { memoId: p.memoId, content: p.content });
  Object.assign(f.proof, { jobId: p.memoId, documentId: f.source.documentId, profileUpdateHash: sha(p.profileUpdate) });
  f.registration.registrationId = f.source.registrationId;
  f.registration.evidence.eformsignDocumentId = f.source.documentId;
  f.registration.steps.eformsign.documentId = f.source.documentId;
  f.registration.steps.memo.jobId = p.memoId;
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function assertPrivateOutput(result, f) {
  const serialized = JSON.stringify(result);
  for (const secret of [f.source.submittedProfile.addressRaw, f.job.profileUpdate.birthDateRaw,
    f.proof.native.address, f.proof.native.detail, f.proof.native.birthDate, f.proof.native.phone,
    '+821000000001', '010-0000-0001']) {
    assert(!serialized.includes(secret), 'Review output must not contain raw private fields');
  }
  function inspect(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert(!['native', 'birthDateRaw', 'addressRaw', 'memberPhone', 'phone', 'content', 'profileUpdate'].includes(key),
        'Only review metadata may be returned: ' + key);
      inspect(child);
    }
  }
  inspect(result);
}

function assertMetadataOnly(result, f) {
  assert.deepEqual(Object.keys(result).sort(), ['jobPatch', 'memoPatch', 'registrationPatch', 'review']);
  assert.deepEqual(Object.keys(result.jobPatch).sort(), ['operatorProfileReview', 'profileStatus', 'profileSyncStatus']);
  assert.deepEqual(Object.keys(result.memoPatch).sort(), ['profileStatus', 'profileSyncStatus']);
  assert.deepEqual(Object.keys(result.registrationPatch).sort(), ['nextAction', 'profileEnrichment', 'status', 'steps.memo']);
  const updatedJob = { ...f.job, ...result.jobPatch }, updatedMemo = { ...f.memo, ...result.memoPatch };
  for (const key of ['jobId', 'registrationId', 'profileSourceJobId', 'status', 'memoWriteState', 'attempts',
    'claimToken', 'externalEffectStarted', 'completedAt', 'content', 'profileUpdate']) {
    assert.deepEqual(updatedJob[key], f.job[key], 'No queue reset/content change: ' + key);
  }
  assert.equal(updatedMemo.syncStatus, 'synced');
  assert.equal(updatedMemo.content, f.memo.content);
  assert.equal(updatedMemo.syncedAt, f.memo.syncedAt);
  assert.equal(result.jobPatch.profileSyncStatus, 'synced');
  assert.equal(result.memoPatch.profileSyncStatus, 'synced');
  assert.deepEqual(result.jobPatch.profileStatus, result.memoPatch.profileStatus);
  assert.deepEqual(result.registrationPatch.profileEnrichment.fields, result.jobPatch.profileStatus);
  assert.deepEqual(result.registrationPatch.profileEnrichment.operatorReview, result.review);
  assert.equal(result.registrationPatch.profileEnrichment.status, 'synced');
  assert.equal(result.registrationPatch['steps.memo'].status, 'verified');
  assert.equal(result.registrationPatch['steps.memo'].jobId, f.job.jobId);
  assert.deepEqual(result.review.previousAddress, f.job.profileStatus.address);
  assert.equal(result.review.approvalRef, f.approval.ref);
  assert.equal(result.review.nativeProfileHash, f.approval.nativeProfileHash);
  assert.equal(result.review.documentId, f.source.documentId);
  assert.equal(result.review.memberId, MEMBER);
  assert.equal(result.review.approvedAt, f.approval.confirmedAt);
  assert.equal(result.review.nativeCheckedAt, f.proof.checkedAt);
  assert.equal(result.review.resolvedAt, f.now.toISOString());
  const fields = result.jobPatch.profileStatus;
  assert.equal(fields.birthDate.status, 'already_equal');
  assert.equal(fields.birthDate.expectedHash, f.job.profileStatus.birthDate.expectedHash);
  assert.deepEqual(fields.beforeFieldHashes, f.job.profileStatus.beforeFieldHashes);
  assert.equal(fields.checkedAt, f.proof.checkedAt);
  assert.equal(fields.address.status, 'verified');
  assert.equal(fields.address.sourceAddressHash, sha(f.job.profileUpdate.addressRaw));
  assert.equal(fields.address.nativeAddressHash, sha([f.proof.native.address, f.proof.native.detail]));
  assert.deepEqual(fields.address.operatorReview, result.review);
  assertPrivateOutput(result, f);
}

test('synthetic fixture passes the actual v2 source validator with mocked source freshness', () => {
  const f = fixture(), before = clone(f);
  assert.equal(assertSignupProfileV2Source(f.job, f.source, f.registration), f.source.submittedProfile);
  assert.deepEqual(f, before);
});

for (const manual of [false, true]) test(manual
  ? 'explicit exact-hash operator override preserves a differing current native address'
  : 'fresh signed-field match resolves only completed memo review metadata', () => {
  const f = fixture({ manual }), before = clone(f);
  const result = planSignupProfileReviewResolution(deepFreeze(f));
  assertMetadataOnly(result, f);
  assert.equal(result.review.mode, f.approval.mode);
  assert.equal(result.review.signedAddressMatches, !manual);
  assert.equal(result.jobPatch.profileStatus.address.verificationBasis,
    manual ? 'operator_confirmed_native_profile' : 'native_signed_fields_equal');
  assert.equal(result.registrationPatch.status, 'completed');
  assert.equal(result.registrationPatch.nextAction, '없음');
  assert.deepEqual(f, before);
});

test('signed matching uses normalized road/name/phone and whitespace without changing native values', () => {
  const f = fixture();
  Object.assign(f.proof.native, { name: '  합성회원  ', phone: '+82 10-0000-0001',
    address: '서울 강남구 테헤란로 123', detail: ' 합성빌딩   704호 ' });
  f.approval.nativeProfileHash = sha([MEMBER, '합성회원', '01000000001', '1990-01-02',
    f.proof.native.address, f.proof.native.detail]);
  f.approval.operationHash = profileReviewApprovalHash({ job: f.job, mode: f.approval.mode, native: f.proof.native });
  const before = clone(f), result = planSignupProfileReviewResolution(f);
  assert.equal(result.review.signedAddressMatches, true);
  assertMetadataOnly(result, f);
  assert.deepEqual(f, before);
});

test('hash helpers bind the exact native values and profile update independently', () => {
  const f = fixture(), n = f.proof.native;
  assert.equal(profileSourceHash(f.job.profileUpdate), sha(f.job.profileUpdate));
  assert.equal(nativeProfileReviewHash(n), f.approval.nativeProfileHash);
  assert.equal(profileReviewApprovalHash({ job: f.job, mode: f.approval.mode, native: n }),
    sha([f.job.jobId, f.job.registrationId, DOC, f.job.profileUpdate.sourceHash,
      sha(f.job.profileUpdate), f.approval.mode, nativeProfileReviewHash(n)]));
  for (const key of ['memberId', 'name', 'phone', 'birthDate', 'address', 'detail']) {
    assert.notEqual(nativeProfileReviewHash({ ...n, [key]: n[key] + '1' }), nativeProfileReviewHash(n), key);
  }
});

function blocked(label, mutate, expected, options) {
  test('blocks ' + label + ' without mutation or private error output', () => {
    const f = fixture(options);
    // Prove rejection is due to the test mutation, not an invalid baseline fixture.
    assert.equal(planSignupProfileReviewResolution(f).jobPatch.profileSyncStatus, 'synced');
    mutate(f);
    const before = clone(f);
    const invalidClock=f.now instanceof Date&&!Number.isFinite(f.now.getTime()),clock=f.now;
    assert.throws(() => planSignupProfileReviewResolution(deepFreeze(f)), error => {
      assert.equal(error.code, 'ERR_ASSERTION');
      if (expected) assert.match(error.message, expected);
      for (const secret of [ROAD, DETAIL, OTHER_ROAD, OTHER_DETAIL, '900102', '1990-01-02', '01000000001']) {
        assert(!error.message.includes(secret), 'Rejection must not disclose private values');
      }
      return true;
    });
    // Node 22 does not consider two distinct invalid Date objects equal.
    if(invalidClock){
      assert.equal(f.now,clock);
      assert(Number.isNaN(f.now.getTime()));
      assert.deepEqual({...f,now:null},{...before,now:null});
    }else assert.deepEqual(f, before);
  });
}

blocked('a different base address in signed mode', f => { f.proof.native.address = OTHER_ROAD;
  approveCurrent(f); }, /SIGNED_ADDRESS_MISMATCH/);
blocked('a different detail in signed mode', f => { f.proof.native.detail = OTHER_DETAIL;
  approveCurrent(f); }, /SIGNED_ADDRESS_MISMATCH/);
for (const mode of [undefined, '', 'manual', 'operator_confirmed', 'signed_fields_equal']) {
  blocked('manual mismatch with newly approved mode ' + String(mode), f => { f.approval.mode = mode; approveCurrent(f); },
    mode === 'signed_fields_equal' ? /SIGNED_ADDRESS_MISMATCH/ : /UNSUPPORTED_REVIEW_DECISION/, { manual: true });
}
for (const manual of [false, true]) {
  const options = { manual };
  for (const [label, mutate] of Object.entries({
    missing: f => { delete f.approval; },
    unconfirmed: f => { f.approval.confirmed = false; },
    truthyNotBoolean: f => { f.approval.confirmed = 'true'; },
    missingHash: f => { delete f.approval.nativeProfileHash; },
    wrongHash: f => { f.approval.nativeProfileHash = 'f'.repeat(64); },
    missingOperationHash: f => { delete f.approval.operationHash; },
    wrongOperationHash: f => { f.approval.operationHash = 'f'.repeat(64); },
    missingRef: f => { delete f.approval.ref; },
    unsafeRef: f => { f.approval.ref = 'operator ref with spaces'; },
    oversizedRef: f => { f.approval.ref = 'a'.repeat(181); },
  })) blocked(`${manual ? 'manual' : 'signed'} approval ${label}`, mutate, /EXACT_OPERATOR_APPROVAL_REQUIRED/, options);
  for (const [label, confirmedAt] of Object.entries({
    stale: new Date(NOW.getTime() - 24 * 3600000 - 1).toISOString(),
    future: new Date(NOW.getTime() + 1).toISOString(), invalid: 'not-a-date', missing: undefined,
  })) blocked(`${manual ? 'manual' : 'signed'} approval time ${label}`, f => {
    f.approval.confirmedAt = confirmedAt;
  }, /STALE_OPERATOR_APPROVAL/, options);
}
blocked('native changed after manual approval', f => { f.proof.native.detail += ' changed'; },
  /EXACT_OPERATOR_APPROVAL_REQUIRED/, { manual: true });
blocked('DOB mismatch even with a manually approved current address', f => {
  f.proof.native.birthDate = '1990-01-03'; approveCurrent(f);
}, /BIRTH_DATE_MISMATCH/, { manual: true });
blocked('unusable current address even with manual approval', f => {
  f.proof.native.address = ''; approveCurrent(f);
}, /NATIVE_ADDRESS_REQUIRED/, { manual: true });

for (const [label, mutate] of Object.entries({
  missingProof: f => { delete f.proof; },
  nonNativeProof: f => { f.proof.kind = 'cached_profile'; },
  wrongProofJob: f => { f.proof.jobId = 'other_memo'; },
  wrongProofDocument: f => { f.proof.documentId = OTHER_DOC; },
  wrongProfileUpdateHash: f => { f.proof.profileUpdateHash = 'f'.repeat(64); },
  missingProfileUpdateHash: f => { delete f.proof.profileUpdateHash; },
  proofOfMemberWrites: f => { f.proof.memberWrites = 1; },
  unprovenZeroWrites: f => { delete f.proof.memberWrites; },
})) blocked(label, mutate, /NATIVE_PROOF_BINDING_REQUIRED/);
for (const [label, checkedAt] of Object.entries({
  stale: new Date(NOW.getTime() - 5 * 60000 - 1).toISOString(),
  future: new Date(NOW.getTime() + 1).toISOString(), invalid: 'not-a-date', missing: undefined,
})) blocked('native proof time ' + label, f => { f.proof.checkedAt = checkedAt; }, /STALE_NATIVE_PROOF/);
for (const [label, mutate] of Object.entries({
  missingNative: f => { delete f.proof.native; },
  wrongNativeMember: f => { f.proof.native.memberId = '9000002'; },
  fallbackNativeMember: f => { f.proof.native.memberId = 'excel_9000001'; },
  wrongNativeName: f => { f.proof.native.name = '다른합성회원'; },
  wrongNativePhone: f => { f.proof.native.phone = '01000000002'; },
  maskedNativePhone: f => { f.proof.native.phone = '010****0001'; },
  missingNativePhone: f => { delete f.proof.native.phone; },
  ordinaryMember: f => { f.proof.native.memberGrade = '일반회원'; },
  missingGrade: f => { delete f.proof.native.memberGrade; },
  missingDob: f => { delete f.proof.native.birthDate; },
  missingAddress: f => { delete f.proof.native.address; },
  missingDetail: f => { delete f.proof.native.detail; },
})) blocked(label, mutate, /EXACT_NATIVE_IDENTITY_REQUIRED/);

for (const [label, mutate] of Object.entries({
  wrongSourceHash: f => { f.job.profileUpdate.sourceHash = 'f'.repeat(64); },
  changedSignedAddress: f => { f.source.submittedProfile.addressRaw = OTHER_ROAD; },
  changedSignedDob: f => { f.job.profileUpdate.birthDateRaw = '900103'; },
  wrongSourceDocument: f => { f.source.documentId = OTHER_DOC; },
  wrongUpdateDocument: f => { f.job.profileUpdate.documentId = OTHER_DOC; },
  wrongSourceJob: f => { f.job.profileSourceJobId = 'other_source'; },
  wrongSourceMember: f => { f.source.studiomateMemberId = '9000002'; },
  wrongJobMember: f => { f.job.memberId = '9000002'; },
  wrongRegistrationMember: f => { f.registration.studiomateMemberId = '9000002'; },
  wrongRegistrationId: f => { f.registration.registrationId = 'ilr_' + 'd'.repeat(24); },
  wrongRegistrationPhone: f => { f.registration.memberPhone = '01000000002'; },
  wrongSourcePhone: f => { f.source.memberPhone = '01000000002'; },
  wrongJobPhone: f => { f.job.memberPhone = '01000000002'; },
  wrongRegistrationName: f => { f.registration.memberName = '다른합성회원'; },
  missingRegistration: f => { delete f.registration; },
  pendingSource: f => { f.source.status = 'pending'; },
  unknownSource: f => { f.source.status = 'unknown'; },
  incompleteDocument: f => { f.source.completionProof.status = 'in_progress'; },
  wrongCompletedRecipient: f => { f.source.completionProof.recipients[0].phone = '01000000002'; },
  changedCanonicalContent: f => { f.job.content += '\nchanged'; },
})) blocked(label, mutate);

for (const [label, observedAt] of Object.entries({
  stale: new Date(NOW.getTime() - 24 * 3600000 - 1).toISOString(),
  future: new Date(NOW.getTime() + 1).toISOString(), invalid: 'not-a-date', missing: undefined,
})) blocked('24-hour source proof ' + label, f => {
  f.source.completionProof.observedAt = observedAt;
}, /Completed document source needs a fresh readback/);

for (const [label, mutate] of Object.entries({
  wrongMemo: f => { f.memo.memoId = 'other_memo'; },
  wrongMemoStudio: f => { f.memo.studioId = '9999'; },
  wrongMemoMember: f => { f.memo.memberId = '9000002'; },
  changedMemoContent: f => { f.memo.content += '\nchanged'; },
  missingMemo: f => { delete f.memo; },
})) blocked(label, mutate, /CANONICAL_MEMO_NOT_SYNCED/);
for (const status of ['pending', 'retry', 'unknown', 'failed', 'review_required']) {
  blocked('memo sync status ' + status, f => { f.memo.syncStatus = status; }, /CANONICAL_MEMO_NOT_SYNCED/);
}
for (const status of ['pending', 'retry', 'unknown', 'processing', 'failed', 'review_required']) {
  blocked('queue status ' + status, f => { f.job.status = status; }, /COMPLETED_MEMO_REVIEW_REQUIRED/);
}
for (const state of ['pending', 'retry', 'unknown', 'failed']) {
  blocked('memo write state ' + state, f => { f.job.memoWriteState = state; }, /COMPLETED_MEMO_REVIEW_REQUIRED/);
}
for (const status of ['pending', 'retry', 'unknown', 'synced']) {
  blocked('profile review status conflict ' + status, f => { f.job.profileSyncStatus = status; }, /COMPLETED_MEMO_REVIEW_REQUIRED/);
}
blocked('active claim', f => { f.job.claimToken = 'synthetic-active-claim'; }, /COMPLETED_MEMO_REVIEW_REQUIRED/);
blocked('unresolved failure', f => { f.job.failureCode = 'UNKNOWN_SAVE'; }, /COMPLETED_MEMO_REVIEW_REQUIRED/);
for (const status of ['pending', 'retry', 'unknown', 'failed', 'verified']) {
  blocked('registration memo status conflict ' + status, f => { f.registration.steps.memo.status = status; }, /FIELD_REVIEW_SCOPE_CHANGED/);
}
for (const status of ['pending', 'retry', 'unknown', 'failed', 'review_required']) {
  blocked('unverified eform ' + status, f => { f.registration.steps.eformsign.status = status; }, /FIELD_REVIEW_SCOPE_CHANGED/);
}
for (const lastError of ['unrelated-ticket-error', { code: 'CONFIRMATION_SEND_UNKNOWN' }]) {
  blocked('unrelated lastError ' + JSON.stringify(lastError), f => { f.registration.lastError = lastError; }, /FIELD_REVIEW_SCOPE_CHANGED/);
}
for (const key of ['cancellation', 'cancellationJobId', 'refund', 'refunded']) {
  blocked('registration ' + key, f => { f.registration[key] = key === 'refunded' ? true : { status: 'pending' }; });
}
for (const status of ['cancelled', 'canceled', 'rejected', 'refunded', 'refund_pending', 'cancellation_pending',
  'cancellation_review', 'completed', 'pending', 'processing', 'unknown', 'retry', 'action_required ', undefined]) {
  blocked('closed registration status ' + status, f => { f.registration.status = status; }, /CLOSED_REGISTRATION/);
}
for (const now of [null, '2026-11-01', new Date(NaN)]) {
  blocked('invalid review clock ' + String(now), f => { f.now = now; }, /INVALID_REVIEW_CLOCK/);
}

test('completion-only signed source remains outside field-review resolution scope', () => {
  const f = fixture();
  const profile = { version: 2, mode: 'completion_only', documentId: DOC, templateId: TEMPLATE,
    memberName: f.source.memberName, memberPhone: f.source.memberPhone, fieldReviewReason: 'signed_fields_unverified' };
  f.source.submittedProfile = profile;
  f.job.profileUpdate = signupV2Projection({ job: f.source, profile, completion: f.source.completionProof,
    memberId: MEMBER, registrationId: REG, now: NOW }).profileUpdate;
  f.proof.profileUpdateHash = sha(f.job.profileUpdate);
  assert.equal(assertSignupProfileV2Source(f.job, f.source, f.registration), profile);
  const before = clone(f);
  assert.throws(() => planSignupProfileReviewResolution(f), /FIELD_REVIEW_SCOPE_CHANGED/);
  assert.deepEqual(f, before);
});

test('source freshness uses mocked Date.now, not only the supplied review clock', t => {
  const f = fixture();
  t.mock.timers.setTime(NOW.getTime() + 24 * 3600000 + 1);
  assert.throws(() => planSignupProfileReviewResolution(f), /Completed document source needs a fresh readback/);
});
test('inclusive 24-hour source/approval and five-minute native proof limits are accepted', () => {
  const f = fixture();
  f.source.completionProof.observedAt = new Date(NOW.getTime() - 24 * 3600000).toISOString();
  f.approval.confirmedAt = f.source.completionProof.observedAt;
  f.proof.checkedAt = new Date(NOW.getTime() - 5 * 60000).toISOString();
  assertMetadataOnly(planSignupProfileReviewResolution(f), f);
});

for (const mode of ['new_member', 'team_intake']) {
  for (const key of ['member', 'ticket', 'confirmation']) {
    for (const status of ['review_required', 'failed']) test(`${mode} keeps unrelated ${key} ${status} action_required`, () => {
      const f = fixture();
      f.registration.mode = mode;
      f.registration.steps[key] = { status, detail: 'Synthetic unrelated operator review', evidenceRef: 'synthetic:keep' };
      const before = clone(f), result = planSignupProfileReviewResolution(deepFreeze(f));
      assert.equal(result.registrationPatch.status, 'action_required');
      assert.equal(result.registrationPatch.nextAction, '확인필요 항목 검토');
      assertMetadataOnly(result, f);
      assert.deepEqual(f, before);
    });
  }
}
test('resolving memo review derives confirmation_pending rather than falsely completing registration', () => {
  const f = fixture();
  f.registration.steps.confirmation.status = 'pending';
  const before = clone(f), result = planSignupProfileReviewResolution(f);
  assert.equal(result.registrationPatch.status, 'confirmation_pending');
  assert.notEqual(result.registrationPatch.nextAction, '없음');
  assertMetadataOnly(result, f);
  assert.deepEqual(f, before);
});

for (const manual of [false, true]) {
  for (const [label, change] of Object.entries({
    document: f => {
      f.source.documentId = OTHER_DOC;
      f.source.submittedProfile.documentId = OTHER_DOC;
      f.source.completionProof.documentId = OTHER_DOC;
      reproject(f);
    },
    source: f => { f.source.submittedProfile.career = '6년'; reproject(f); },
    registration: f => {
      f.source.registrationId = 'ilr_' + 'd'.repeat(24);
      f.source.jobId = f.source.registrationId;
      reproject(f);
    },
    native: f => {
      if (manual) f.proof.native.detail = '합성타워 906호';
      else f.proof.native.address = '서울 강남구 테헤란로 123';
      // Rebind only the native hash: the old operation approval must still fail.
      f.approval.nativeProfileHash = nativeProfileReviewHash(f.proof.native);
    },
  })) test(`${manual ? 'manual' : 'signed'} approval cannot be replayed across ${label}`, () => {
    const f = fixture({ manual });
    assert.equal(planSignupProfileReviewResolution(f).jobPatch.profileSyncStatus, 'synced');
    const oldOperationHash = f.approval.operationHash;
    change(f);
    assert.equal(assertSignupProfileV2Source(f.job, f.source, f.registration), f.source.submittedProfile);
    const before = clone(f);
    assert.throws(() => planSignupProfileReviewResolution(deepFreeze(clone(f))), /EXACT_OPERATOR_APPROVAL_REQUIRED/);
    assert.deepEqual(f, before);
    assert.equal(f.approval.operationHash, oldOperationHash);
    // A new exact-operation approval is sufficient; no unrelated guard caused rejection.
    approveCurrent(f);
    assert.notEqual(f.approval.operationHash, oldOperationHash);
    assertMetadataOnly(planSignupProfileReviewResolution(f), f);
  });
}

for (const mode of ['signed_fields_equal', 'operator_confirmed_current_address']) {
  test('changing approval mode requires a new operation approval from ' + mode, () => {
    const f = fixture();
    f.approval.mode = mode;
    approveCurrent(f);
    assert.equal(planSignupProfileReviewResolution(f).jobPatch.profileSyncStatus, 'synced');
    f.approval.mode = mode === 'signed_fields_equal' ? 'operator_confirmed_current_address' : 'signed_fields_equal';
    assert.throws(() => planSignupProfileReviewResolution(f), /EXACT_OPERATOR_APPROVAL_REQUIRED/);
    approveCurrent(f);
    assert.equal(planSignupProfileReviewResolution(f).review.mode, f.approval.mode);
  });
}

test('operation approval hash independently binds every declared component', () => {
  const f = fixture(), input = { job: f.job, mode: f.approval.mode, native: f.proof.native };
  const expected = sha([f.job.jobId, f.job.registrationId, DOC, f.job.profileUpdate.sourceHash,
    sha(f.job.profileUpdate), f.approval.mode, nativeProfileReviewHash(f.proof.native)]);
  assert.equal(profileReviewApprovalHash(input), expected);
  for (const change of [
    value => { value.job.jobId = 'different_memo'; },
    value => { value.job.registrationId = 'different_registration'; },
    value => { value.job.profileUpdate.documentId = OTHER_DOC; },
    value => { value.job.profileUpdate.sourceHash = 'e'.repeat(64); },
    value => { value.job.profileUpdate.addressRaw = OTHER_ROAD; },
    value => { value.job.profileUpdate.birthDateRaw = '900103'; },
    value => { value.mode = 'operator_confirmed_current_address'; },
    value => { value.native.detail = OTHER_DETAIL; },
  ]) {
    const changed = clone(input);
    change(changed);
    assert.notEqual(profileReviewApprovalHash(changed), expected);
  }
});

for (const [label, mutate] of Object.entries({
  missingRequiredEvidence: f => { delete f.registration.evidence; },
  missingRequiredDocument: f => { delete f.registration.evidence.eformsignDocumentId; },
  nullRequiredDocument: f => { f.registration.evidence.eformsignDocumentId = null; },
  wrongRequiredDocument: f => { f.registration.evidence.eformsignDocumentId = OTHER_DOC; },
  wrongStepDocument: f => { f.registration.steps.eformsign.documentId = OTHER_DOC; },
  wrongEformStepJob: f => { f.registration.steps.eformsign.jobId = 'other_source_job'; },
  wrongEformEvidenceJob: f => { f.registration.evidence.eformsignJobId = 'other_source_job'; },
  wrongMemoStepJob: f => { f.registration.steps.memo.jobId = 'other_memo'; },
  wrongMemoStepMemoJob: f => { f.registration.steps.memo.memoJobId = 'other_memo'; },
  wrongMemoStepProfileMemoJob: f => { f.registration.steps.memo.profileMemoJobId = 'other_memo'; },
  wrongEvidenceMemoJob: f => { f.registration.evidence.memoJobId = 'other_memo'; },
  wrongEvidenceProfileMemoJob: f => { f.registration.evidence.profileMemoJobId = 'other_memo'; },
  emptyOptionalDocument: f => { f.registration.steps.eformsign.documentId = ''; },
  emptyOptionalJob: f => { f.registration.steps.memo.memoJobId = ''; },
})) blocked('registration cross-reference ' + label, mutate, /REGISTRATION_STEP_BINDING_CHANGED/);

for (const optional of ['omitted', 'null', 'exact']) test('optional step/evidence references may be ' + optional, () => {
  const f = fixture();
  const references = [[f.registration.steps.eformsign, 'documentId', DOC],
    [f.registration.steps.eformsign, 'jobId', f.source.jobId],
    [f.registration.evidence, 'eformsignJobId', f.source.jobId],
    ...['jobId', 'memoJobId', 'profileMemoJobId'].map(key => [f.registration.steps.memo, key, f.job.jobId]),
    ...['memoJobId', 'profileMemoJobId'].map(key => [f.registration.evidence, key, f.job.jobId])];
  for (const [object, key, exact] of references) {
    if (optional === 'omitted') delete object[key];
    else object[key] = optional === 'null' ? null : exact;
  }
  const before = clone(f), result = planSignupProfileReviewResolution(deepFreeze(f));
  assert.equal(result.registrationPatch.status, 'completed');
  assert.equal(result.registrationPatch['steps.memo'].jobId, f.registration.steps.memo.jobId);
  assertPrivateOutput(result, f);
  assert.deepEqual(f, before);
});

test('profile status allowlist excludes raw metadata at every prior profile level', () => {
  const f = fixture({ manual: true });
  Object.assign(f.job.profileStatus, { version: 99, rawAddress: f.source.submittedProfile.addressRaw,
    native: clone(f.proof.native), memberPhone: f.job.memberPhone, arbitrary: { privateValue: ROAD } });
  Object.assign(f.job.profileStatus.birthDate, { value: f.proof.native.birthDate, birthDateRaw: '900102',
    memberPhone: f.job.memberPhone });
  Object.assign(f.job.profileStatus.address, { value: f.proof.native.address, detail: f.proof.native.detail,
    addressRaw: f.source.submittedProfile.addressRaw, lookupEvidence: { rawValue: ROAD } });
  f.job.profileStatus.beforeFieldHashes.unrecognized = f.job.memberPhone;
  const before = clone(f), result = planSignupProfileReviewResolution(deepFreeze(f));
  const fields = result.jobPatch.profileStatus;
  assert.deepEqual(Object.keys(fields).sort(), ['address', 'beforeFieldHashes', 'birthDate', 'checkedAt', 'version']);
  assert.equal(fields.version, 2);
  assert.deepEqual(fields.birthDate, { status: 'already_equal', expectedHash: sha('1990-01-02') });
  assert.deepEqual(fields.beforeFieldHashes, {
    birthDate: sha('1990-01-02'), address: sha(''), detail: sha(''), protectedHash: sha('protected') });
  assert.deepEqual(result.review.previousAddress, {
    status: 'review', reason: 'postal_exact_match_unavailable', stage: 'result_selection' });
  assertPrivateOutput(result, f);
  assert.deepEqual(f, before);
});

for (const key of ['status', 'reason', 'stage']) {
  for (const unsafe of [ROAD, '1990-01-02', '01000000001', 'unsafe code', 'a'.repeat(101), { raw: DETAIL }]) {
    test(`prior address ${key} excludes unsafe value ${JSON.stringify(unsafe)}`, () => {
      const f = fixture();
      f.job.profileStatus.address[key] = unsafe;
      const before = clone(f), result = planSignupProfileReviewResolution(deepFreeze(f));
      assert.equal(result.review.previousAddress[key], null);
      assertPrivateOutput(result, f);
      assert.deepEqual(f, before);
    });
  }
}

for (const invalid of ['1990-01-02', '01000000001', 'f'.repeat(63), 'G'.repeat(64), null, { raw: ROAD }]) {
  test('prior field hashes exclude malformed or raw values ' + JSON.stringify(invalid), () => {
    const f = fixture();
    f.job.profileStatus.birthDate.expectedHash = invalid;
    f.job.profileStatus.beforeFieldHashes = { birthDate: invalid, address: invalid, detail: invalid,
      protectedHash: invalid, unknownHash: sha('unrecognized') };
    const result = planSignupProfileReviewResolution(f);
    assert.deepEqual(result.jobPatch.profileStatus.birthDate, { status: 'already_equal' });
    assert(!Object.hasOwn(result.jobPatch.profileStatus, 'beforeFieldHashes'));
    assertPrivateOutput(result, f);
  });
}

for (const source of ['native_full_match', 'current_year_rule']) test('known birth resolution retains only approved metadata for ' + source, () => {
  const f = fixture();
  const resolution = { policy: 'yy_kst_current_year_v1', source, referenceAt: NOW.toISOString(),
    value: f.proof.native.birthDate, memberPhone: f.job.memberPhone, addressRaw: ROAD };
  f.job.profileStatus.birthDate.resolution = resolution;
  const before = clone(f), result = planSignupProfileReviewResolution(deepFreeze(f));
  assert.deepEqual(result.jobPatch.profileStatus.birthDate.resolution,
    { policy: resolution.policy, source, referenceAt: resolution.referenceAt });
  assertPrivateOutput(result, f);
  assert.deepEqual(f, before);
});
for (const resolution of [null, {}, { policy: 'unrecognized', source: 'native_full_match', referenceAt: NOW.toISOString() },
  { policy: 'yy_kst_current_year_v1', source: 'unknown', referenceAt: NOW.toISOString() },
  { policy: 'yy_kst_current_year_v1', source: 'native_full_match', referenceAt: 'not-a-date' }]) {
  test('unknown or invalid birth resolution is excluded ' + JSON.stringify(resolution), () => {
    const f = fixture();
    f.job.profileStatus.birthDate.resolution = resolution;
    const result = planSignupProfileReviewResolution(f);
    assert(!Object.hasOwn(result.jobPatch.profileStatus.birthDate, 'resolution'));
    assertPrivateOutput(result, f);
  });
}

test('raw metadata in an existing memo step cannot leak through the resolution patch', () => {
  const f = fixture();
  Object.assign(f.registration.steps.memo, { memberPhone: f.job.memberPhone, birthDateRaw: f.job.profileUpdate.birthDateRaw,
    addressRaw: f.job.profileUpdate.addressRaw });
  const before = clone(f), result = planSignupProfileReviewResolution(deepFreeze(f));
  assertPrivateOutput(result, f);
  assert.deepEqual(f, before);
});

test('raw DOB cannot be copied as a parseable date-only birth resolution reference', () => {
  const f = fixture();
  f.job.profileStatus.birthDate.resolution = { policy: 'yy_kst_current_year_v1', source: 'native_full_match',
    referenceAt: f.proof.native.birthDate };
  const before = clone(f), result = planSignupProfileReviewResolution(deepFreeze(f));
  assertPrivateOutput(result, f);
  assert.deepEqual(f, before);
});
