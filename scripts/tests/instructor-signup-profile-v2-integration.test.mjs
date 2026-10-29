import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { beforeEach, test } from 'node:test';
import { signupProfileV2Id, parseSignupProfileV2, readCompletedSignupProfileV2,
  signupV2Projection, assertSignupProfileV2Source } from '../lib/instructor-signup-profile-v2.mjs';
import { parseCompletedRecipientStatus } from '../lib/instructor-signup-order-identity.mjs';
import { SIGNUP_PROFILE_FIELDS } from '../lib/instructor-signup-profile.mjs';

const NOW = new Date('2026-10-30T03:00:00Z');
const DOC = 'a'.repeat(32), OTHER_DOC = 'c'.repeat(32);
const REG = 'ilr_' + 'b'.repeat(24), OTHER_REG = 'ilr_' + 'd'.repeat(24);
const TEMPLATE = 'a5b5ea6b85ec44c8bcb4af1e980e94eb';
const PROVIDER_COMPLETED = '2025-12-30T06:36:27.123Z';
const clone = structuredClone;
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
beforeEach(t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  t.mock.method(globalThis, 'fetch', () => assert.fail('No live network permitted'));
});

function fixture({ baseline = false } = {}) {
  const source = { jobId: baseline ? 'completed_signup_profile_baseline_v2_' + DOC : REG,
    registrationId: baseline ? '' : REG, studioId: '5330', studiomateMemberId: '9000001',
    memberName: '합성회원', memberPhone: '01000000001', documentId: DOC,
    documentName: '2025-12-30_강사회원가입서_합성회원', status: 'done', externalEffectStarted: true,
    ...(baseline ? { source: 'completed_signup_profile_baseline_v2', sendAllowed: false, baselineOnly: true } : {}) };
  const fields = { memberName: source.memberName, memberPhone: '+82 10-0000-0001', birthDate: '900102',
    address: '서울특별시 강남구 테헤란로 123 합성빌딩 704호', career: '5년', affiliation: '합성 필라테스' };
  const profile = { version: 2, documentId: DOC, templateId: TEMPLATE, memberName: source.memberName,
    memberPhone: source.memberPhone, birthDateRaw: fields.birthDate, addressRaw: fields.address,
    career: fields.career, affiliation: fields.affiliation };
  const completedMs = Date.parse(PROVIDER_COMPLETED);
  const statusInput = { responseUrl: `https://kr-service.eformsign.com/v1.0/companies/848f6dc7fa024a6cb28a2994c0835e53/documents/${DOC}/status`,
    method: 'GET', httpStatus: 200, selectedDocumentId: DOC, templateId: TEMPLATE, job: source,
    observedAt: NOW.toISOString(), body: { code: '-1', status: '200', result: { status: {
      document_title: source.documentName,
      steps: [{ seq: 1, action: 'doc_create' }, { seq: 2, action: 'doc_accept_participant', execute_date: completedMs - 60000,
        owner: { members: [source.memberName + '(+821000000001)'], groups: null, external_creators: null } },
      { seq: 3, action: 'doc_complete', execute_date: String(completedMs) }],
      current_infos: [{ step_seq: 3, current_writer: null, waitingExternalApproval: false }],
    } } } };
  const completion = parseCompletedRecipientStatus(statusInput);
  const projection = signupV2Projection({ job: source, profile, completion, memberId: source.studiomateMemberId,
    registrationId: source.registrationId, now: NOW });
  Object.assign(source, { submittedProfile: profile, profileMemoJobId: projection.memoId, completionProof: completion });
  const job = { jobId: projection.memoId, registrationId: source.registrationId, profileSourceJobId: source.jobId,
    source: 'instructor_member_eformsign', studioId: '5330', memberId: '9000001', studiomateMemberId: '9000001',
    memberName: source.memberName, memberPhone: source.memberPhone, content: projection.content, profileUpdate: projection.profileUpdate };
  const registration = baseline ? undefined : { registrationId: REG, studioId: '5330', studiomateMemberId: '9000001',
    memberName: source.memberName, memberPhone: source.memberPhone, lessonDate: '2026-11-28' };
  const evidence = { found: true, documentId: DOC, text: '완료 ' + source.documentName,
    href: `https://www.eformsign.com/eform/document/view_service.html?document_id=${DOC}&form_id=${TEMPLATE}` };
  return { source, fields, profile, completion, projection, statusInput, job, registration, evidence };
}

test('actual completed status parser supplies exact recipient and provider milliseconds to v2 projection', () => {
  const f = fixture();
  assert.equal(f.completion.providerCompletedAt, PROVIDER_COMPLETED);
  assert.deepEqual(f.completion.recipients, [{ name: '합성회원', phone: '01000000001' }]);
  assert.equal(f.projection.memoId, 'instructor_member_completion_' + DOC);
  assert.equal(f.projection.profileUpdate.sourceHash, sha(f.profile));
  assert.equal(f.projection.completionProof, f.completion);
  assert.match(f.projection.content, /완료 시각: 2025-12-30 15:36:27\.123 KST/);
  assert.doesNotMatch(f.projection.content, /900102|테헤란로|01000000001|동의|건강/);
});

test('v2 parse preserves unguessed raw field values, document identity and source without mutation', () => {
  const f = fixture(), before = clone(f);
  assert.equal(parseSignupProfileV2(f.profile, f.source, DOC), f.profile);
  assert.equal(f.profile.birthDateRaw, '900102');
  assert.deepEqual(f, before);
});
for (const [label, change] of Object.entries({
  version: f => { f.profile.version = 1; }, document: f => { f.profile.documentId = OTHER_DOC; },
  sourceDocument: f => { f.source.documentId = OTHER_DOC; }, template: f => { f.profile.templateId = 'wrong'; },
  nativeId: f => { f.source.studiomateMemberId = 'excel_synthetic'; }, studio: f => { f.source.studioId = 'wrong'; },
  name: f => { f.profile.memberName = '다른회원'; }, phone: f => { f.profile.memberPhone = '01000000002'; },
  maskedPhone: f => { f.profile.memberPhone = '010****0001'; }, missingRaw: f => { delete f.profile.addressRaw; },
  longRaw: f => { f.profile.career = 'a'.repeat(1001); },
})) test('parse rejects ' + label, () => {
  const f = fixture(); change(f); assert.throws(() => parseSignupProfileV2(f.profile, f.source, DOC));
});

function mockReader(f, { duplicateField, fields = f.fields } = {}) {
  const events = [], selectors = [];
  const field = selector => {
    const key = Object.keys(SIGNUP_PROFILE_FIELDS).find(k => '#' + SIGNUP_PROFILE_FIELDS[k] === selector);
    assert(key, selector); selectors.push(selector);
    return { waitFor: async () => {}, count: async () => key === duplicateField ? 2 : 1, inputValue: async () => fields[key] };
  };
  const page = { goto: async url => events.push(['goto', url]),
    locator: selector => {
      assert.equal(selector, '#viewer_frame');
      return { waitFor: async () => {}, elementHandle: async () => ({ contentFrame: async () => ({
        waitForFunction: async (_fn, { id, expected }) => {
          assert.equal(id, SIGNUP_PROFILE_FIELDS.memberName);
          assert.equal(fields.memberName.replace(/\s+/g, ''), expected);
        },
      }) }) };
    }, frameLocator: selector => { assert.equal(selector, '#viewer_frame'); return { locator: field }; } };
  return { page, events, selectors };
}
test('completed-form extraction reads exactly the six mapped fields through a mock viewer only', async () => {
  const f = fixture(), m = mockReader(f);
  const profile = await readCompletedSignupProfileV2(m.page, f.source, f.evidence);
  assert.deepEqual(profile, f.profile);
  for (const id of Object.values(SIGNUP_PROFILE_FIELDS)) assert(m.selectors.includes('#' + id));
  assert.deepEqual(m.events, [['goto', f.evidence.href]]);
});
for (const [label, change] of Object.entries({
  notFound: e => { e.found = false; }, unsigned: e => { e.text = 'In progress'; },
  otherDocument: e => { e.documentId = OTHER_DOC; }, wrongOrigin: e => { e.href = e.href.replace('www.eformsign.com', 'example.invalid'); },
  wrongUrlDocument: e => { e.href = e.href.replace(DOC, OTHER_DOC); }, wrongTemplate: e => { e.href = e.href.replace(TEMPLATE, OTHER_DOC); },
})) test('reader rejects ' + label + ' before navigation', async () => {
  const f = fixture(), m = mockReader(f); change(f.evidence);
  await assert.rejects(readCompletedSignupProfileV2(m.page, f.source, f.evidence));
  assert.deepEqual(m.events, []);
});
test('reader rejects duplicate viewer fields and mismatched full phone without calling external verification', async () => {
  const f = fixture();
  await assert.rejects(readCompletedSignupProfileV2(mockReader(f, { duplicateField: 'address' }).page, f.source, f.evidence));
  const fields = { ...f.fields, memberPhone: '01000000002' };
  await assert.rejects(readCompletedSignupProfileV2(mockReader(f, { fields }).page, f.source, f.evidence));
});

for (const [label, change] of Object.entries({
  wrongDocument: f => { f.completion.documentId = OTHER_DOC; },
  wrongTemplate: f => { f.completion.templateId = OTHER_DOC; },
  wrongRecipient: f => { f.completion.recipients[0].phone = '01000000002'; },
  wrongName: f => { f.completion.recipients[0].name = '다른회원'; },
  twoRecipients: f => { f.completion.recipients.push(clone(f.completion.recipients[0])); },
  noRecipient: f => { f.completion.recipients = []; },
  incomplete: f => { f.completion.status = 'in_progress'; },
  noProviderTime: f => { delete f.completion.providerCompletedAt; },
  futureProviderTime: f => { f.completion.providerCompletedAt = '2099-01-01T00:00:00Z'; },
})) test('projection rejects ' + label, () => {
  const f = fixture(); change(f);
  assert.throws(() => signupV2Projection({ job: f.source, profile: f.profile, completion: f.completion,
    memberId: '9000001', registrationId: REG, now: NOW }));
});

test('regular source validation returns the exact signed profile without mutation', () => {
  const f = fixture(), before = clone(f);
  assert.equal(assertSignupProfileV2Source(f.job, f.source, f.registration), f.profile);
  assert.deepEqual(f, before);
});
test('backfill baseline is document-keyed with empty registration IDs, never a fabricated ilr', () => {
  const f = fixture({ baseline: true }), before = clone(f);
  assert.equal(assertSignupProfileV2Source(f.job, f.source, undefined), f.profile);
  assert.equal(f.job.registrationId, ''); assert.equal(f.source.registrationId, '');
  assert.equal(f.job.profileSourceJobId, 'completed_signup_profile_baseline_v2_' + DOC);
  assert.deepEqual(f, before);
});
for (const [label, change] of Object.entries({
  sourceHash: f => { f.job.profileUpdate.sourceHash = 'bad'; }, rawDob: f => { f.job.profileUpdate.birthDateRaw = '20000101'; },
  rawAddress: f => { f.job.profileUpdate.addressRaw = 'changed'; }, content: f => { f.job.content += 'changed'; },
  missingRegistration: f => { f.registration = undefined; }, member: f => { f.registration.studiomateMemberId = '999'; },
  sourceMember: f => { f.source.studiomateMemberId = '999'; }, memberPhone: f => { f.registration.memberPhone = '01000000002'; },
  memberName: f => { f.registration.memberName = '다른회원'; }, cancelled: f => { f.registration.cancellation = {}; },
  pendingSource: f => { f.source.status = 'pending'; }, staleSource: f => { f.source.completionProof.observedAt = '2026-10-29T02:59:59.999Z'; },
  futureSource: f => { f.source.completionProof.observedAt = '2026-10-30T03:00:00.001Z'; },
  missingTime: f => { delete f.source.completionProof.observedAt; },
})) test('assertV2Source rejects ' + label + ' without changing inputs', () => {
  const f = fixture(); change(f); const before = clone(f);
  assert.throws(() => assertSignupProfileV2Source(f.job, f.source, f.registration));
  assert.deepEqual(f, before);
});

// These strict regressions intentionally expose missing source/registration binding guards.
// Do not weaken them to accommodate an implementation that selects the wrong canonical job.
for (const [label, change] of Object.entries({
  wrongMemoRegistration: f => { f.job.registrationId = OTHER_REG; },
  wrongCanonicalRegistration: f => { f.registration.registrationId = OTHER_REG; },
  missingSourceRegistration: f => { delete f.source.registrationId; },
  missingMemoRegistration: f => { delete f.job.registrationId; },
  missingCanonicalRegistrationId: f => { delete f.registration.registrationId; },
  wrongSourceJob: f => { f.job.profileSourceJobId = 'other_source_job'; },
})) test('assertV2Source must reject binding mismatch: ' + label, () => {
  const f = fixture(); change(f);
  assert.throws(() => assertSignupProfileV2Source(f.job, f.source, f.registration));
});
test('projection must bind an explicitly supplied regular registration ID to its source', () => {
  const f = fixture();
  assert.throws(() => signupV2Projection({ job: f.source, profile: f.profile, completion: f.completion,
    memberId: '9000001', registrationId: OTHER_REG, now: NOW }));
});
test('baseline validation must reject a memo job carrying a fabricated registration ID', () => {
  const f = fixture({ baseline: true }); f.job.registrationId = REG;
  assert.throws(() => assertSignupProfileV2Source(f.job, f.source, undefined));
});
