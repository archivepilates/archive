import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { beforeEach, test } from 'node:test';
import { canonicalSignupPhone } from '../lib/instructor-signup-profile.mjs';
import { parseSignupProfileV2, signupV2Projection } from '../lib/instructor-signup-profile-v2.mjs';
import { parseCompletedRecipientStatus } from '../lib/instructor-signup-order-identity.mjs';
import { resolvedEformErrorPatch } from '../lib/eformsign-send-readiness.mjs';
import { deriveInstructorLessonRegistrationState, normalizeInstructorLessonName,
  normalizeInstructorLessonPhone, INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_ID as TEMPLATE,
} from '../lib/instructor-lesson-registration-contract.mjs';

const NOW = new Date('2026-10-30T03:00:00.000Z');
const COMPLETED = '2025-12-30T06:36:27.123Z';
const DOC = 'a'.repeat(32), REG = 'ilr_' + 'b'.repeat(24), OTHER = 'ilr_' + 'c'.repeat(24);
const MEMBER = '9000001', MEMO = 'instructor_member_completion_' + DOC;
const CONSENT = 'instructorMemberConsents/consent_5330_' + MEMBER;
const MEMO_PATH = 'memberMemos/' + MEMO, QUEUE_PATH = 'studiomateMemoWriteJobs/' + MEMO;
const sourcePath = id => 'eformsignInstructorMemberJobs/' + id;
const registrationPath = id => 'instructorLessonRegistrations/' + id;
const clone = structuredClone;
const plain = value => JSON.parse(JSON.stringify(value));
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Parse declarations only: importing this executable worker would start real jobs.
const require = createRequire(new URL('../../firebase/kangsain-functions/functions/package.json', import.meta.url));
const ts = require('typescript');
const worker = new URL('../process-eformsign-instructor-member-jobs.mjs', import.meta.url);
const tree = ts.createSourceFile(worker.pathname, readFileSync(worker, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const declarations = ['finalizeCompletedDocument', 'deriveRegistrationPatch', 'stepValue'].map(name => {
  const node = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert(node, 'Actual worker declaration missing: ' + name);
  return node.getText(tree);
}).join('\n');

beforeEach(t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  t.mock.method(globalThis, 'fetch', () => assert.fail('Synthetic finalizer tests must not use live services'));
});

function fixture(id = REG) {
  const job = { jobId: id, registrationId: id, studioId: '5330', studiomateMemberId: MEMBER,
    memberName: '합성회원', memberPhone: '01000000001', documentId: DOC,
    documentName: '2025-12-30_강사회원가입서_합성회원', documentUrl: 'https://example.invalid/synthetic',
    status: 'checking_completion', claimToken: 'synthetic-claim-' + id,
    externalEffectStarted: true, lessonDate: '2026-11-28', completedAt: '2026-10-30T02:59:00.000Z' };
  const profile = { version: 2, documentId: DOC, templateId: TEMPLATE, memberName: job.memberName,
    memberPhone: job.memberPhone, birthDateRaw: '19900102',
    addressRaw: '서울특별시 강남구 테헤란로 123 합성빌딩 704호', career: '5년', affiliation: '합성 필라테스' };
  const ms = Date.parse(COMPLETED);
  const completion = parseCompletedRecipientStatus({ job, selectedDocumentId: DOC, templateId: TEMPLATE,
    method: 'GET', httpStatus: 200, observedAt: NOW.toISOString(),
    responseUrl: 'https://kr-service.eformsign.com/v1.0/companies/848f6dc7fa024a6cb28a2994c0835e53/documents/' + DOC + '/status',
    body: { code: '-1', status: '200', result: { status: { document_title: job.documentName,
      steps: [{ seq: 1, action: 'doc_create' },
        { seq: 2, action: 'doc_accept_participant', execute_date: ms - 60000,
          owner: { members: [job.memberName + '(+821000000001)'], groups: null, external_creators: null } },
        { seq: 3, action: 'doc_complete', execute_date: String(ms) }],
      current_infos: [{ step_seq: 3, current_writer: null, waitingExternalApproval: false }],
    } } } });
  const registration = { registrationId: id, studioId: '5330', studiomateMemberId: MEMBER,
    memberName: job.memberName, memberPhone: job.memberPhone, mode: 'new_member',
    status: 'waiting_signature', lessonDate: job.lessonDate, unrelated: { preserve: true },
    steps: { member: { status: 'verified' }, ticket: { status: 'verified' },
      confirmation: { status: 'verified', providerMessageId: 'synthetic-receipt' },
      eformsign: { status: 'sent' }, memo: { status: 'queued' } },
    evidence: { sourceTicketId: 'synthetic-free-ticket', ticketPrice: 0 } };
  return { job, registration, profile, completion, evidence: { found: true, documentId: DOC } };
}

function fakeFirestore(f) {
  const docs = new Map([[sourcePath(f.job.jobId), clone(f.job)], [registrationPath(f.job.jobId), clone(f.registration)]]);
  const writes = [], attempts = [];
  const ref = path => ({ path, id: path.split('/').at(-1) });
  const resolve = (value, old) => {
    if (value && typeof value === 'object' && '$arrayUnion' in value) return [...new Set([...(old || []), ...value.$arrayUnion])];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return clone(value);
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, resolve(v, old?.[key])]));
  };
  const merge = (old, patch) => {
    const result = clone(old || {});
    for (const [key, value] of Object.entries(patch)) {
      const parts = key.split('.');
      let target = result;
      for (const part of parts.slice(0, -1)) target = target[part] ||= {};
      const leaf = parts.at(-1);
      const normalized = resolve(value, target[leaf]);
      target[leaf] = normalized && typeof normalized === 'object' && !Array.isArray(normalized)
        ? merge(target[leaf], normalized) : normalized;
    }
    return result;
  };
  const db = { collection: collection => ({ doc: id => ref(collection + '/' + id) }),
    runTransaction: async action => {
      const pending = [];
      const transaction = { get: async r => {
        assert.equal(pending.length, 0, 'Firestore reads must precede writes');
        return { exists: docs.has(r.path), data: () => clone(docs.get(r.path)) };
      }, set: (r, patch, options) => {
        attempts.push(r.path); pending.push({ path: r.path, patch: plain(patch), merge: options?.merge === true });
      }, update: (r, patch) => {
        assert(docs.has(r.path)); attempts.push(r.path); pending.push({ path: r.path, patch: plain(patch), merge: true });
      } };
      await action(transaction);
      for (const write of pending) {
        docs.set(write.path, write.merge ? merge(docs.get(write.path), write.patch) : resolve(write.patch));
        writes.push(write);
      }
    } };
  const context = vm.createContext({ db, Date, canonicalSignupPhone, parseSignupProfileV2, signupV2Projection,
    resolvedEformErrorPatch, deriveInstructorLessonRegistrationState, normalizeInstructorLessonName,
    normalizeInstructorLessonPhone, FieldValue: { serverTimestamp: () => NOW.toISOString(),
      arrayUnion: (...values) => ({ $arrayUnion: values }) } });
  const finalize = vm.runInContext(declarations + '\nfinalizeCompletedDocument;', context);
  return { docs, writes, attempts, run: input => finalize(ref(sourcePath(input.job.jobId)), input.job,
    input.evidence, input.profile, input.completion) };
}

test('regular v2 creates exactly three downstream documents and binds real provider completion', async () => {
  const f = fixture(), m = fakeFirestore(f), before = clone(f), originalPaths = new Set(m.docs.keys());
  await m.run(f);
  assert.deepEqual([...m.docs.keys()].filter(path => !originalPaths.has(path)).sort(), [CONSENT, MEMO_PATH, QUEUE_PATH].sort());
  assert.equal(m.writes.length, 5);
  assert.deepEqual(m.writes.map(w => w.path).sort(), [CONSENT, MEMO_PATH, QUEUE_PATH, sourcePath(REG), registrationPath(REG)].sort());
  const queue = m.docs.get(QUEUE_PATH), source = m.docs.get(sourcePath(REG)), memo = m.docs.get(MEMO_PATH);
  assert.equal(queue.status, 'pending'); assert.equal(queue.attempts, 0); assert.equal(queue.maxAttempts, 3);
  assert.equal(queue.source, 'instructor_member_eformsign'); assert.equal(queue.profileSourceJobId, REG);
  assert.deepEqual(queue.registrationIds, [REG]); assert.equal(queue.registrationId, REG);
  assert.equal(queue.profileUpdate.sourceHash, sha(f.profile)); assert.equal(queue.writeMode, 'playwright');
  assert.equal(memo.syncStatus, 'pending'); assert.equal(memo.content, queue.content);
  assert.match(memo.content, /2025-12-30 15:36:27\.123 KST/);
  assert.doesNotMatch(memo.content, /19900102|테헤란로|01000000001/);
  assert.equal(source.status, 'done'); assert.equal(source.claimToken, null); assert.equal(source.profileMemoJobId, MEMO);
  assert.equal(source.completedAt, COMPLETED); assert.deepEqual(source.completionProof, f.completion);
  assert.deepEqual(source.submittedProfile, f.profile);
  assert.equal(m.docs.get(CONSENT).completedAt, COMPLETED);
  assert.equal(m.docs.get(CONSENT).consentScope, 'instructor_lesson_recording_content_and_lesson_promotion');
  const registration = m.docs.get(registrationPath(REG));
  assert.deepEqual(registration.steps.confirmation, f.registration.steps.confirmation);
  assert.deepEqual(registration.evidence.sourceTicketId, f.registration.evidence.sourceTicketId);
  assert.equal(registration.evidence.ticketPrice, 0); assert.deepEqual(registration.unrelated, f.registration.unrelated);
  assert.equal(registration.steps.eformsign.status, 'verified'); assert.equal(registration.steps.memo.status, 'queued');
  assert.deepEqual(f, before);
});

test('existing consent projection retains scope, prior registrations and unrelated evidence', async () => {
  const f = fixture(), m = fakeFirestore(f);
  m.docs.set(CONSENT, { consentId: CONSENT.split('/').at(-1), registrationIds: [OTHER],
    consentScope: 'instructor_lesson_recording_content_and_lesson_promotion', audit: { synthetic: 'retain' } });
  await m.run(f);
  assert.deepEqual(m.docs.get(CONSENT).registrationIds, [OTHER, REG]);
  assert.equal(m.docs.get(CONSENT).consentScope, 'instructor_lesson_recording_content_and_lesson_promotion');
  assert.deepEqual(m.docs.get(CONSENT).audit, { synthetic: 'retain' });
  assert.equal(m.docs.get(CONSENT).completedAt, COMPLETED);
});

for (const [status, profileSyncStatus, expected] of [
  ['done', 'synced', 'verified'], ['done', 'review_required', 'review_required'],
  ['review_required', 'review_required', 'review_required'], ['failed', 'review_required', 'review_required'],
  ['cancelled', 'review_required', 'review_required'],
]) test('same document reuse preserves ' + status + '/' + profileSyncStatus + ' without requeue', async () => {
  const f = fixture(), m = fakeFirestore(f);
  await m.run(f);
  Object.assign(m.docs.get(QUEUE_PATH), { status, profileSyncStatus, attempts: 2,
    lastError: 'synthetic retained detail', profileStatus: { birthDate: { status: 'conflict' } } });
  m.docs.get(MEMO_PATH).syncStatus = status === 'done' ? 'synced' : 'failed';
  const existingQueue = clone(m.docs.get(QUEUE_PATH)), existingMemo = clone(m.docs.get(MEMO_PATH));
  const next = fixture(OTHER);
  m.docs.set(sourcePath(OTHER), clone(next.job)); m.docs.set(registrationPath(OTHER), clone(next.registration));
  m.writes.length = 0;
  await m.run(next);
  const queue = m.docs.get(QUEUE_PATH);
  assert.deepEqual(queue, { ...existingQueue, registrationIds: [REG, OTHER], updatedAt: NOW.toISOString() });
  assert.deepEqual(m.docs.get(MEMO_PATH), existingMemo);
  const queueWrite = m.writes.find(w => w.path === QUEUE_PATH);
  assert.deepEqual(Object.keys(queueWrite.patch).sort(), ['registrationIds', 'updatedAt']);
  assert.equal(queue.profileSourceJobId, REG); assert.equal(queue.registrationId, REG);
  assert.equal(m.docs.get(registrationPath(OTHER)).steps.memo.status, expected);
  assert.equal(m.docs.get(sourcePath(OTHER)).completedAt, COMPLETED);
  assert.equal(m.writes.some(w => w.path === MEMO_PATH), false);
});

for (const [label, forge] of [
  ['sourceHash', update => { update.sourceHash = 'forged'; }],
  ['raw birth date', update => { update.birthDateRaw = '20000101'; }],
  ['raw address', update => { update.addressRaw += ' altered'; }],
]) test('same document forged ' + label + ' rejects before any transaction write', async () => {
  const f = fixture(), m = fakeFirestore(f);
  await m.run(f); forge(m.docs.get(QUEUE_PATH).profileUpdate);
  const next = fixture(OTHER);
  m.docs.set(sourcePath(OTHER), clone(next.job)); m.docs.set(registrationPath(OTHER), clone(next.registration));
  const before = clone([...m.docs]); m.writes.length = 0; m.attempts.length = 0;
  await assert.rejects(m.run(next));
  assert.deepEqual(m.attempts, []); assert.deepEqual(m.writes, []); assert.deepEqual([...m.docs], before);
});
