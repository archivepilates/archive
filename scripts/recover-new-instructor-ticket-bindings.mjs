import { readFile, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { planInstructorRegistrationRecovery } from './lib/instructor-registration-recovery.mjs';
import { verifyInstructorPaidOrder } from './lib/imweb-instructor-order-source.mjs';
import { normalizeInstructorLessonPhone, normalizeInstructorLessonName } from './lib/instructor-lesson-registration-contract.mjs';
import { assertInstructorTicketRecoveryPaidBinding } from './lib/instructor-ticket-recovery-evidence.mjs';

const args = process.argv.slice(2), apply = args.includes('--apply');
const values = name => args.filter(a => a.startsWith(`--${name}=`)).map(a => a.slice(name.length + 3));
const ids = values('registration-id'), proofPath = values('proof')[0], absencePath = values('absence')[0], expectedCommit = values('expected-runtime-commit')[0];
const allowed = ['registration-id', 'proof', 'absence', 'expected-runtime-commit'];
assert(ids.length > 0 && ids.length <= 2 && ids.length === new Set(ids).size && ids.every(id => /^ilr_[a-f0-9]{24}$/.test(id)));
assert(args.every(a => a === '--apply' || allowed.some(k => a.startsWith(`--${k}=`))));
assert(allowed.slice(1).every(k => values(k).length <= 1));
for (const p of [proofPath, absencePath]) assert(p?.startsWith('/Users/archivepilates/ArchiveIN/operations/') && path.resolve(p) === p);
const root = path.resolve(import.meta.dirname, '..');
if (apply) {
  assert.equal(root, '/Users/archivepilates/dev/archive-in-runtime');
  assert(/^[a-f0-9]{40}$/.test(expectedCommit || ''));
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), expectedCommit);
  execFileSync('git', ['diff', '--quiet', 'HEAD'], { cwd: root });
}
const require = createRequire('/Users/archivepilates/dev/archive-in-runtime/package.json');
const admin = require('./firebase/kangsain-functions/functions/node_modules/firebase-admin');
const app = admin.initializeApp({ credential: admin.credential.cert(JSON.parse(await readFile('/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json', 'utf8'))), projectId: 'archive-pilates' });
const db = app.firestore();
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
try {
  const proof = JSON.parse(await readFile(proofPath, 'utf8'));
  const absence = JSON.parse(await readFile(absencePath, 'utf8'));
  for (const id of ids) {
    const regRef = db.doc('instructorLessonRegistrations/' + id), jobRef = db.doc('studiomateInstructorLessonJobs/' + id);
    const eformRef = db.doc('eformsignInstructorMemberJobs/' + id);
    const operationKey = 'new-ticket-binding-20261029-' + id;
    const auditRef = db.doc('workLanes/instructor-lesson-registration/reports/' + operationKey);
    if ((await auditRef.get()).exists) { console.log(JSON.stringify({ registrationId: id, status: 'already_applied', replayed: false })); continue; }
    const regSnap = await regRef.get(), jobSnap = await jobRef.get();
    assert(regSnap.exists && jobSnap.exists);
    const r = regSnap.data(), job = jobSnap.data();
    const paid = await verifyInstructorPaidOrder(db, r); assert.equal(paid.assessment.status, 'ready');
    assertInstructorTicketRecoveryPaidBinding({ registration: r, job, assessment: paid.assessment });
    const member = proof.members.find(m => m.registrationId === id);
    assert(member?.member?.member && normalizeInstructorLessonName(member.member.member.name) === normalizeInstructorLessonName(r.memberName));
    const native = { ...member,
      eformAbsence: absence.proofs.find(p => p.registrationId === id), confirmationAbsent: true };
    const approval = { action: 'bind_existing_new_member_ticket', registrationId: id, operationKey,
      actor: 'operator-approved-current-chat-error-recovery', approvedAt: new Date().toISOString() };
    const sourcePhone = normalizeInstructorLessonPhone(r.memberPhone);
    const target = data => data.payload?.registrationId === id || data.type === 'instructor_lesson_confirmation'
      || String(data.candidateId || '').startsWith('instructor_lesson_confirmation_');
    const candidatesQuery = db.collection('alimtalkCandidates').where('memberPhone', '==', sourcePhone).limit(201);
    const sendsQuery = db.collection('alimtalkSends').where('memberPhone', '==', sourcePhone).limit(201);
    async function assertNoPrior(tx) {
      const eform = tx ? await tx.get(eformRef) : await eformRef.get();
      assert.equal(eform.exists, false, 'Existing eform job must be reconciled instead.');
      const candidates = tx ? await tx.get(candidatesQuery) : await candidatesQuery.get();
      const sends = tx ? await tx.get(sendsQuery) : await sendsQuery.get();
      assert(candidates.size < 201 && sends.size < 201, 'Incomplete recipient history.');
      assert.equal(candidates.docs.filter(s => target(s.data())).length, 0, 'Existing confirmation must not be recreated.');
      assert.equal(sends.docs.filter(s => target(s.data())).length, 0, 'Existing send must not be replayed.');
    }
    await assertNoPrior();
    const plan = planInstructorRegistrationRecovery({ action: approval.action, registration: r, job, native, approval });
    if (apply) await db.runTransaction(async tx => {
      const currentReg = await tx.get(regRef), currentJob = await tx.get(jobRef), audit = await tx.get(auditRef);
      if (audit.exists) return;
      assert(currentReg.updateTime.isEqual(regSnap.updateTime) && currentJob.updateTime.isEqual(jobSnap.updateTime), 'Concurrent source change.');
      await assertNoPrior(tx);
      const fresh = planInstructorRegistrationRecovery({ action: approval.action, registration: currentReg.data(), job: currentJob.data(), native, approval });
      const now = admin.firestore.FieldValue.serverTimestamp();
      tx.create(auditRef, { approval, beforeRegistration: r, beforeJob: job, nativeProof: native,
        planHash: sha(fresh), sourceCommit: expectedCommit, createdAt: now });
      tx.update(jobRef, { ...fresh.jobPatch, updatedAt: now });
      tx.update(regRef, { ...fresh.registrationPatch, updatedAt: now });
    });
    const directory = '/Users/archivepilates/ArchiveIN/operations/core-meal-lesson-check-20261029';
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const handle = await open(path.join(directory, operationKey + (apply ? '-applied' : '-plan') + '.json'), 'wx', 0o600);
    const evidence = { registrationId: id, mode: apply ? 'apply' : 'plan', planHash: sha(plan),
      jobStatus: plan.jobPatch.status, registrationStatus: plan.registrationPatch.status,
      originalAttempts: job.attempts, retainedAttempts: plan.jobPatch.attempts ?? job.attempts,
      nativeTicketId: plan.jobPatch.ticketId, noNewTicketIssued: true, manualSends: 0,
      checkedAt: new Date().toISOString() };
    try { await handle.writeFile(JSON.stringify(evidence, null, 2)); await handle.sync(); } finally { await handle.close(); }
    console.log(JSON.stringify(evidence));
  }
} catch {
  console.error(JSON.stringify({ ok: false, code: 'NEW_TICKET_RECOVERY_STOPPED', replay: false,
    nextAction: 'Reconcile current canonical audit and source before any retry.' })); process.exitCode = 1;
} finally { await app.delete(); }
