import assert from 'node:assert/strict';
import { readFile, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { planInstructorOrderLifecycleRecovery } from './lib/instructor-order-lifecycle-recovery.mjs';
import { readImwebOrder } from './lib/imweb-instructor-orders.mjs';
import { orderFingerprint, orderLedgerId } from './lib/imweb-instructor-order-policy.mjs';
import { normalizeInstructorLessonPhone } from './lib/instructor-lesson-registration-contract.mjs';
import { makeLessonVideoSolapiRequest } from './lib/lesson-video-notice-solapi.mjs';

const args = process.argv.slice(2), apply = args.includes('--apply');
const values = name => args.filter(a => a.startsWith(`--${name}=`)).map(a => a.slice(name.length + 3));
const ids = values('registration-id').sort(), orderNo = values('order-no')[0];
const proofPath = values('native-proof')[0], expectedCommit = values('expected-runtime-commit')[0];
const allowed = ['registration-id', 'order-no', 'native-proof', 'expected-runtime-commit'];
assert(args.every(a => a === '--apply' || allowed.some(k => a.startsWith(`--${k}=`))));
assert(allowed.slice(1).every(k => values(k).length === 1));
assert.equal(orderNo, '202610266625770', 'This one-off recovery is limited to the approved order.');
assert.deepEqual(ids, ['ilr_4006901a399cfb2de470f887', 'ilr_f03859cd89abc16534c9a9d5']);
assert(proofPath?.startsWith('/Users/archivepilates/ArchiveIN/operations/') && path.resolve(proofPath) === proofPath);
const root = path.resolve(import.meta.dirname, '..');
assert(/^[a-f0-9]{40}$/.test(expectedCommit || ''));
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), expectedCommit);
assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(), '');
if (apply) {
  assert.equal(root, '/Users/archivepilates/dev/archive-in-runtime');
  assert.equal(execFileSync('git', ['rev-parse', 'origin/main'], { cwd: root, encoding: 'utf8' }).trim(), expectedCommit);
}
const require = createRequire('/Users/archivepilates/dev/archive-in-runtime/package.json');
const admin = require('./firebase/kangsain-functions/functions/node_modules/firebase-admin');
const app = admin.initializeApp({ credential: admin.credential.cert(JSON.parse(await readFile(
  '/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json', 'utf8'))), projectId: 'archive-pilates' });
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fresh = value => Number.isFinite(Date.parse(value)) && Date.now() - Date.parse(value) >= -60000
  && Date.now() - Date.parse(value) <= 120000;
try {
  const db = app.firestore(), key = `purchase-confirmation-${orderNo}-v1`;
  const auditRef = db.doc(`workLanes/instructor-lesson-registration/reports/${key}`);
  assert.equal((await auditRef.get()).exists, false, 'Prior recovery exists; read back, do not replay.');
  const ledgerRef = db.doc(`imwebInstructorLessonOrders/${orderLedgerId(orderNo)}`);
  const refs = [ledgerRef];
  for (const id of ids) for (const c of ['instructorLessonRegistrations', 'studiomateInstructorLessonJobs', 'eformsignInstructorMemberJobs'])
    refs.push(db.doc(`${c}/${id}`));
  const snapshots = await db.getAll(...refs);
  assert(snapshots.every(s => s.exists));
  const ledger = snapshots[0].data();
  const registrations = ids.map((_, i) => snapshots[1 + i * 3].data());
  const jobs = ids.map((_, i) => snapshots[2 + i * 3].data());
  const eformJobs = ids.map((_, i) => snapshots[3 + i * 3].data());
  const order = readImwebOrder(orderNo), sourceReadAt = new Date().toISOString();
  const native = JSON.parse(await readFile(proofPath, 'utf8'));
  assert.equal(native.members?.length, ids.length);
  const provider = makeLessonVideoSolapiRequest(), evidence = [], historyQueries = [], historyBefore = [];
  for (const r of registrations) {
    const n = native.members.find(m => m.registrationId === r.registrationId);
    assert(n && fresh(n.checkedAt) && n.member?.status === 'verified' && n.ticketRead?.status === 'verified');
    assert.equal(String(n.member.member.memberId), r.evidence.studiomateMemberId);
    assert.equal(n.member.member.name, r.memberName);
    assert.equal(normalizeInstructorLessonPhone(n.member.member.phone), normalizeInstructorLessonPhone(r.memberPhone));
    const tickets = n.ticketRead.tickets.filter(t => t.title === r.ticketName
      && t.availabilityStartAt === r.lessonDate && t.expireAt === r.lessonDate);
    assert.equal(tickets.length, 1, 'Exactly one current source ticket is required.');
    const t = tickets[0];
    assert(t.verified && t.complete && t.active && t.usable && !t.cancelled && !t.refunded);
    assert.equal(t.memberId, r.evidence.studiomateMemberId); assert.equal(t.studioId, r.studioId);
    assert(/^[1-9]\d*$/.test(t.userTicketId));
    if (r.evidence.ticketId) assert.equal(r.evidence.ticketId, t.userTicketId);
    const originalJob = jobs.find(j => j.registrationId === r.registrationId);
    if (originalJob.ticketId) assert.equal(originalJob.ticketId, t.userTicketId);
    assert(t.payment?.verified && t.payment.complete && t.payment.status === 'paid');
    assert.equal(t.payment.refundedAmount, 0); assert.equal(t.payment.paidAmount, r.ticketPrice);
    assert.equal(t.payment.totalAmount, r.externalOrder.paidAmount);
    const candidateRef = db.doc('alimtalkCandidates/' + r.evidence.confirmationCandidateId);
    const c = await candidateRef.get(); assert(c.exists && c.get('status') === 'sent');
    assert.equal(c.get('memberPhone'), r.memberPhone);
    assert.equal(c.get('payload.registrationId'), r.registrationId);
    refs.push(candidateRef); snapshots.push(c);
    for (const collection of ['alimtalkCandidates', 'alimtalkSends']) {
      const query = db.collection(collection).where('memberPhone', '==', r.memberPhone).limit(201);
      const result = await query.get(); assert(result.size < 201, 'Incomplete history.');
      historyQueries.push(query); historyBefore.push(result.docs.map(s => [s.id, sha(s.data())]).sort());
      if (collection === 'alimtalkSends') {
        const sends = result.docs.filter(s => s.get('candidateId') === r.evidence.confirmationCandidateId);
        assert.equal(sends.length, 1);
        assert.equal(sends[0].get('status'), 'done');
        assert.equal(sends[0].get('solapiMessageId'), r.evidence.confirmationSolapiMessageId);
      }
    }
    const p = await provider('/messages/v4/list?' + new URLSearchParams({
      messageId: r.evidence.confirmationSolapiMessageId, limit: '5' }), 'GET');
    const messages = Object.values(p.messageList || {});
    assert(!p.nextKey && messages.length === 1);
    const m = messages[0];
    assert.equal(m.messageId, r.evidence.confirmationSolapiMessageId); assert.equal(m.to, r.memberPhone);
    assert.equal(m.status, 'COMPLETE'); assert.equal(String(m.statusCode), '4000');
    assert.equal(m.kakaoOptions?.templateId, 'KA01TP2608241233353269Jgtoiwnzi6');
    evidence.push({ registrationId: r.registrationId, nativeCheckedAt: n.checkedAt, ticketId: t.userTicketId,
      candidateId: c.id, messageId: m.messageId, providerCheckedAt: new Date().toISOString(),
      providerStatus: m.status, providerCode: m.statusCode });
  }
  const approval = { orderNo, registrationIds: ids, operationKey: key, actor: 'operator-approved-order-lifecycle-recovery',
    approvedAt: new Date().toISOString() };
  const input = { order, ledger, registrations, jobs, eformJobs, approval };
  const plan = planInstructorOrderLifecycleRecovery(input);
  const assertFresh = () => assert(fresh(sourceReadAt) && evidence.every(e => fresh(e.nativeCheckedAt) && fresh(e.providerCheckedAt)), 'Source proof expired.');
  assertFresh();
  if (apply) {
    const secondOrder = readImwebOrder(orderNo);
    assert.equal(orderFingerprint(secondOrder), orderFingerprint(order), 'Concurrent Imweb source change.');
    await db.runTransaction(async tx => {
      const currentAudit = await tx.get(auditRef); assert.equal(currentAudit.exists, false);
      const current = [];
      for (const ref of refs) current.push(await tx.get(ref));
      for (let i = 0; i < current.length; i++) assert(current[i].exists && current[i].updateTime.isEqual(snapshots[i].updateTime), 'Concurrent canonical change.');
      for (let i = 0; i < historyQueries.length; i++) {
        const result = await tx.get(historyQueries[i]); assert(result.size < 201);
        assert.deepEqual(result.docs.map(s => [s.id, sha(s.data())]).sort(), historyBefore[i], 'Concurrent message history change.');
      }
      assertFresh();
      const currentPlan = planInstructorOrderLifecycleRecovery({ ...input, ledger: current[0].data(),
        registrations: ids.map((_, i) => current[1 + i * 3].data()),
        jobs: ids.map((_, i) => current[2 + i * 3].data()), eformJobs: ids.map((_, i) => current[3 + i * 3].data()) });
      assert.deepEqual(currentPlan, plan);
      const timestamp = admin.firestore.FieldValue.serverTimestamp();
      tx.create(auditRef, { approval, beforeLedger: ledger, beforeRegistrations: registrations,
        preservedJobsHash: sha({ jobs, eformJobs }), order, evidence, plan, sourceCommit: expectedCommit, createdAt: timestamp });
      tx.update(ledgerRef, { ...plan.ledgerPatch, updatedAt: timestamp });
      for (const p of plan.registrationPatches) tx.update(db.doc('instructorLessonRegistrations/' + p.registrationId),
        { ...p.patch, updatedAt: timestamp });
    }, { maxAttempts: 1 });
    const after = await db.getAll(...refs);
    for (let i = 0; i < ids.length; i++) {
      const r = after[1 + i * 3].data();
      assert.equal(r.status, 'completed'); assert.equal(r.externalOrderReviewRequired, false);
      assert.equal(r.operatorChecks.paymentConfirmed, true); assert.equal(r.lastError, null);
      assert.deepEqual(r.steps, registrations[i].steps); assert.deepEqual(r.evidence, registrations[i].evidence);
      assert.deepEqual(after[2 + i * 3].data(), jobs[i]); assert.deepEqual(after[3 + i * 3].data(), eformJobs[i]);
    }
    assert.equal(after[0].get('status'), 'queued'); assert.equal(after[0].get('attendeeResolution.status'), 'approved');
    for (let i = 7; i < after.length; i++) assert.deepEqual(after[i].data(), snapshots[i].data());
    for (let i = 0; i < historyQueries.length; i++) {
      const result = await historyQueries[i].get(); assert(result.size < 201);
      assert.deepEqual(result.docs.map(s => [s.id, sha(s.data())]).sort(), historyBefore[i]);
    }
  }
  const result = { ok: true, mode: apply ? 'applied' : 'dry-run', orderNo, count: ids.length,
    statuses: plan.registrationPatches.map(p => p.patch.status), planHash: sha(plan), sourceCommit: expectedCommit,
    newTickets: 0, newMessages: 0, jobsChanged: 0, checkedAt: new Date().toISOString() };
  const directory = path.dirname(proofPath); await mkdir(directory, { recursive: true, mode: 0o700 });
  const handle = await open(path.join(directory, `${key}-${apply ? 'applied' : 'plan'}-${Date.now()}.json`), 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(result, null, 2)); await handle.sync(); } finally { await handle.close(); }
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(JSON.stringify({ ok: false, code: 'ORDER_LIFECYCLE_RECOVERY_STOPPED',
    reason: error.code === 'ERR_ASSERTION' ? error.message.split('\n')[0] : 'Source or validation unavailable',
    replay: false, nextAction: 'Read current audit and source before any further action.' })); process.exitCode = 1;
} finally { await app.delete(); }
