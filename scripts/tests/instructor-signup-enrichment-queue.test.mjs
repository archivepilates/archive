import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { beforeEach, test } from 'node:test';
import { buildSignupEnrichmentPlan, applySignupEnrichmentPlan } from '../lib/instructor-signup-enrichment-queue.mjs';

const NOW = new Date('2026-10-30T04:00:00.000Z');
const DOC = 'a'.repeat(32), TEMPLATE = 'a5b5ea6b85ec44c8bcb4af1e980e94eb';
const REG = 'ilr_' + 'b'.repeat(24);
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clone = structuredClone;
beforeEach(t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  t.mock.method(globalThis, 'fetch', () => assert.fail('No live network permitted'));
});

function row() {
  const member = { memberId: '9000001', name: 'Synthetic Instructor', phone: '01000000001', memberGrade: '강사회원', inactive: false };
  return { status: 'verified', baselineOnly: true, sendAllowed: false, documentId: DOC,
    documentName: '2025-12-30_강사회원가입서_Synthetic Instructor', member,
    profile: { version: 2, documentId: DOC, templateId: TEMPLATE, memberName: member.name, memberPhone: member.phone,
      birthDateRaw: '900102', addressRaw: 'Synthetic unverified address', career: '', affiliation: '' },
    completionProof: { documentId: DOC, selectedDocumentId: DOC, templateId: TEMPLATE, status: 'completed',
      recipients: [{ name: member.name, phone: member.phone }], providerCompletedAt: '2025-12-30T06:36:27.123Z', observedAt: '2026-10-30T03:59:00.000Z' },
    nativeCheckedAt: '2026-10-30T03:50:00.000Z', checkedAt: '2026-10-30T04:00:00.000Z' };
}

function memoryDb(initial = []) {
  const docs = new Map(clone(initial)), events = [], committed = [];
  return { docs, events, committed, failCreate: null,
    doc(path) { assert.equal(path.split('/').length, 2); return { path }; },
    async runTransaction(callback) {
      const changes = []; let writing = false;
      const result = await callback({
        get: async ref => {
          assert.equal(writing, false, 'All reads must precede any create');
          events.push(['get', ref.path]);
          const data = docs.get(ref.path);
          return { exists: data !== undefined, data: () => clone(data) };
        },
        create: (ref, value) => {
          writing = true; events.push(['create', ref.path]);
          assert(!docs.has(ref.path) && !changes.some(([path]) => path === ref.path));
          if (this.failCreate === ref.path) throw new Error('Synthetic transaction failure');
          changes.push([ref.path, clone(value)]);
        },
        set: () => assert.fail('Overwrite forbidden'), update: () => assert.fail('Update forbidden'),
      });
      for (const [path, value] of changes) { docs.set(path, value); committed.push(path); }
      return result;
    },
  };
}

function refs(plan) {
  return { source: 'eformsignInstructorMemberJobs/' + plan.source.jobId,
    memo: 'memberMemos/' + plan.projection.memoId, job: 'studiomateMemoWriteJobs/' + plan.projection.memoId };
}
async function seeded() {
  const plan = buildSignupEnrichmentPlan(row(), { now: NOW }), db = memoryDb();
  await applySignupEnrichmentPlan({ db, plan, stamp: 'synthetic-stamp', apply: true });
  db.events.length = 0; db.committed.length = 0;
  return { plan, db, paths: refs(plan) };
}

test('pure plan keeps stable document IDs, canonical schema and original audit hash', () => {
  const value = row(), before = clone(value), plan = buildSignupEnrichmentPlan(value, { now: NOW });
  assert.deepEqual(value, before);
  assert.equal(plan.source.jobId, 'instructor_profile_baseline_' + DOC);
  assert.equal(plan.projection.memoId, 'instructor_member_completion_' + DOC);
  assert.equal(plan.source.registrationId, ''); assert.equal(plan.source.status, 'done');
  assert.equal(plan.source.baselineOnly, true); assert.equal(plan.source.sendAllowed, false);
  assert.equal(plan.source.sourceAuditHash, sha({ documentId: DOC, member: value.member, profile: value.profile, completion: value.completionProof }));
  assert.equal(plan.projection.profileUpdate.birthDateRaw, '900102');
  assert.doesNotMatch(plan.projection.content, /900102|Synthetic unverified address|01000000001|동의/);
  assert.deepEqual(buildSignupEnrichmentPlan(value), plan);
});

for (const [label, change] of Object.entries({
  rowUnverified: r => { r.status = 'review'; }, inactive: r => { r.member.inactive = true; },
  inactiveMissing: r => { delete r.member.inactive; }, staffGrade: r => { r.member.memberGrade = '스텝'; },
  fallbackId: r => { r.member.memberId = 'excel_9000001'; }, wrongNativePhone: r => { r.member.phone = '01000000002'; },
  maskedPhone: r => { r.member.phone = '010****0001'; }, differentName: r => { r.member.name = 'Other Instructor'; },
  profileName: r => { r.profile.memberName = 'Other Instructor'; }, profilePhone: r => { r.profile.memberPhone = 'text01000000001'; },
  notCompleted: r => { r.completionProof.status = 'waiting'; }, wrongTemplate: r => { r.completionProof.templateId = 'b'.repeat(32); },
  wrongSelected: r => { r.completionProof.selectedDocumentId = 'b'.repeat(32); }, extraRecipient: r => { r.completionProof.recipients.push({ ...r.completionProof.recipients[0] }); },
  missingActualTime: r => { delete r.completionProof.providerCompletedAt; }, futureCompletion: r => { r.completionProof.providerCompletedAt = '2026-10-31T00:00:00Z'; },
  staleRow: r => { r.checkedAt = '2026-10-30T01:59:59.999Z'; }, staleNative: r => { r.nativeCheckedAt = '2026-10-30T01:59:59.999Z'; },
  absentNativeClock: r => { delete r.nativeCheckedAt; }, futureNative: r => { r.nativeCheckedAt = '2026-10-30T04:00:00.001Z'; },
  futureRow: r => { r.checkedAt = '2026-10-30T04:00:00.001Z'; }, chronology: r => { r.nativeCheckedAt = '2026-10-30T04:01:00Z'; },
  memoBinding: r => { r.profileMemoJobId = 'wrong'; }, sendAllowed: r => { r.sendAllowed = true; },
  unexpectedAnswers: r => { r.profile.health = 'DO_NOT_COPY'; }, missingField: r => { delete r.profile.birthDateRaw; },
})) test('rejects invalid row without mutation: ' + label, () => {
  const value = row(); change(value); const before = clone(value);
  assert.throws(() => buildSignupEnrichmentPlan(value, { now: NOW })); assert.deepEqual(value, before);
});

test('two-hour boundary is inclusive and default apply is read-only planned', async () => {
  const value = row(); value.nativeCheckedAt = '2026-10-30T02:00:00.000Z';
  const plan = buildSignupEnrichmentPlan(value, { now: NOW }), db = memoryDb();
  const result = await applySignupEnrichmentPlan({ db, plan });
  assert.equal(result.status, 'planned'); assert.equal(result.birthDateSource, 'review');
  assert.equal(db.docs.size, 0); assert.deepEqual(db.committed, []);
  assert.equal(db.events.filter(([type]) => type === 'get').length, 3);
});

test('creates exactly three canonical documents after all reads, never registration/consent/send', async () => {
  const plan = buildSignupEnrichmentPlan(row()), db = memoryDb(), before = clone(plan); let stamps = 0;
  const result = await applySignupEnrichmentPlan({ db, plan, stamp: () => { stamps++; return 'stamp'; }, apply: true });
  assert.equal(result.status, 'queued'); assert.equal(result.jobId, plan.projection.memoId); assert.equal(stamps, 1);
  assert.deepEqual(db.committed.sort(), Object.values(refs(plan)).sort());
  assert.deepEqual(db.events.map(([type]) => type), ['get', 'get', 'get', 'create', 'create', 'create']);
  assert.ok(db.committed.every(path => /^(eformsignInstructorMemberJobs|memberMemos|studiomateMemoWriteJobs)\//.test(path)));
  const source = db.docs.get(refs(plan).source), memo = db.docs.get(refs(plan).memo), job = db.docs.get(refs(plan).job);
  assert.equal(source.completedAt, row().completionProof.providerCompletedAt);
  assert.equal(source.sourceAuditHash, plan.source.sourceAuditHash);
  assert.equal(memo.visibility, 'manager_only'); assert.equal(memo.profileSyncStatus, 'pending');
  assert.equal(job.registrationId, ''); assert.equal(job.profileSourceJobId, source.jobId);
  assert.equal(job.attempts, 0); assert.equal(job.maxAttempts, 3); assert.deepEqual(plan, before);
});

test('duplicate rerun preserves completed/review work, timestamps and fields with zero changes', async () => {
  const { plan, db, paths } = await seeded();
  Object.assign(db.docs.get(paths.job), { status: 'done', attempts: 3, profileSyncResult: { birthDate: 'already_equal' } });
  db.docs.get(paths.memo).syncStatus = 'synced';
  const before = clone([...db.docs]);
  for (const apply of [false, true]) {
    const result = await applySignupEnrichmentPlan({ db, plan, stamp: () => assert.fail('No timestamp needed'), apply });
    assert.equal(result.status, 'existing_preserved'); assert.deepEqual([...db.docs], before);
  }
  assert.deepEqual(db.committed, []);
});

test('fresh observation of the same immutable signup preserves the original audit hash and all work', async () => {
  const { plan, db, paths } = await seeded();
  const value = row(); value.completionProof.observedAt = '2026-10-30T03:59:30.000Z';
  const refreshed = buildSignupEnrichmentPlan(value, { now: NOW });
  assert.notEqual(refreshed.source.sourceAuditHash, plan.source.sourceAuditHash);
  const before = clone([...db.docs]);
  assert.equal((await applySignupEnrichmentPlan({ db, plan: refreshed, apply: true })).status, 'existing_preserved');
  assert.equal(db.docs.get(paths.source).sourceAuditHash, plan.source.sourceAuditHash);
  assert.deepEqual([...db.docs], before); assert.deepEqual(db.committed, []);
});

for (const missing of ['source', 'memo', 'job']) test('partial baseline holds without writes: missing ' + missing, async () => {
  const { plan, db, paths } = await seeded(); db.docs.delete(paths[missing]);
  const before = clone([...db.docs]);
  await assert.rejects(applySignupEnrichmentPlan({ db, plan, stamp: 'stamp', apply: true }));
  assert.deepEqual([...db.docs], before); assert.deepEqual(db.committed, []);
});

for (const [label, mutate] of Object.entries({
  sourceAudit: (d, p) => { d.get(p.source).sourceAuditHash = 'invalid'; },
  sourceDocument: (d, p) => { d.get(p.source).documentId = 'b'.repeat(32); },
  memoMember: (d, p) => { d.get(p.memo).memberId = '9000002'; },
  memoContent: (d, p) => { d.get(p.memo).content += 'different'; },
  publicMemo: (d, p) => { d.get(p.memo).visibility = 'public'; },
  jobHash: (d, p) => { d.get(p.job).profileUpdate.sourceHash = 'b'.repeat(64); },
  jobRaw: (d, p) => { d.get(p.job).profileUpdate.birthDateRaw = '20000101'; },
  jobPhone: (d, p) => { d.get(p.job).memberPhone = '01000000002'; },
  jobRegistration: (d, p) => { d.get(p.job).registrationId = REG; },
  unknownSource: (d, p) => { d.delete(p.source); d.get(p.job).profileSourceJobId = 'unknown'; },
})) test('existing mismatch holds without overwrite/requeue: ' + label, async () => {
  const { plan, db, paths } = await seeded(); mutate(db.docs, paths); const before = clone([...db.docs]);
  await assert.rejects(applySignupEnrichmentPlan({ db, plan, stamp: 'stamp', apply: true }));
  assert.deepEqual([...db.docs], before); assert.deepEqual(db.committed, []);
});

async function regular() {
  const value = await seeded(), { plan, db, paths } = value;
  const source = db.docs.get(paths.source); db.docs.delete(paths.source);
  Object.assign(source, { jobId: REG, registrationId: REG });
  for (const key of ['baselineOnly', 'sendAllowed', 'source', 'sourceAuditHash']) delete source[key];
  source.completionProof.observedAt = '2026-10-28T04:00:00.000Z';
  source.externalEffectStarted = true;
  db.docs.set('eformsignInstructorMemberJobs/' + REG, source);
  Object.assign(db.docs.get(paths.job), { profileSourceJobId: REG, registrationId: REG, status: 'done', attempts: 1 });
  delete db.docs.get(paths.memo).source; delete db.docs.get(paths.memo).documentId;
  db.docs.set('instructorLessonRegistrations/' + REG, { registrationId: REG, studioId: '5330',
    studiomateMemberId: plan.source.studiomateMemberId, memberName: plan.source.memberName, memberPhone: plan.source.memberPhone, status: 'completed' });
  return value;
}

test('known regular source-backed v2 is preserved without creating a baseline or changing registration', async () => {
  const { plan, db, paths } = await regular(), before = clone([...db.docs]);
  assert.equal((await applySignupEnrichmentPlan({ db, plan, apply: true })).status, 'existing_preserved');
  assert.deepEqual([...db.docs], before); assert.equal(db.docs.has(paths.source), false);
  assert.deepEqual(db.committed, []); assert.equal(db.events.filter(([kind]) => kind === 'get').length, 5);
});

for (const mismatch of ['missingSource', 'missingRegistration', 'wrongRegistrationMember', 'cancelled', 'wrongProfile']) {
  test('regular source mismatch holds: ' + mismatch, async () => {
    const { plan, db } = await regular();
    if (mismatch === 'missingSource') db.docs.delete('eformsignInstructorMemberJobs/' + REG);
    if (mismatch === 'missingRegistration') db.docs.delete('instructorLessonRegistrations/' + REG);
    if (mismatch === 'wrongRegistrationMember') db.docs.get('instructorLessonRegistrations/' + REG).studiomateMemberId = '9000002';
    if (mismatch === 'cancelled') db.docs.get('instructorLessonRegistrations/' + REG).cancellation = { jobId: 'synthetic' };
    if (mismatch === 'wrongProfile') db.docs.get('eformsignInstructorMemberJobs/' + REG).submittedProfile.career = 'changed';
    const before = clone([...db.docs]);
    await assert.rejects(applySignupEnrichmentPlan({ db, plan, stamp: 'stamp', apply: true }));
    assert.deepEqual([...db.docs], before); assert.deepEqual(db.committed, []);
  });
}

test('plan tampering and missing stamp cannot create partial documents', async () => {
  for (const mutate of [p => { p.source.registrationId = REG; }, p => { p.source.sendAllowed = true; },
    p => { p.projection.memoId = 'other'; }, p => { p.source.extra = 'unexpected'; }]) {
    const plan = buildSignupEnrichmentPlan(row()), db = memoryDb(); mutate(plan);
    await assert.rejects(applySignupEnrichmentPlan({ db, plan, stamp: 'stamp', apply: true }));
    assert.equal(db.docs.size, 0);
  }
  const plan = buildSignupEnrichmentPlan(row()), db = memoryDb();
  await assert.rejects(applySignupEnrichmentPlan({ db, plan, apply: true }));
  assert.equal(db.docs.size, 0);
  db.failCreate = refs(plan).job;
  await assert.rejects(applySignupEnrichmentPlan({ db, plan, stamp: 'stamp', apply: true }));
  assert.equal(db.docs.size, 0); assert.deepEqual(db.committed, []);
});
