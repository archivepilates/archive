import assert from 'node:assert/strict';
import { readFile, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { acquireStudioMateBrowserLock } from './lib/studiomate-browser-lock.mjs';
import { captureStudioMateNativeApiClient, readExactStudioMateMember, readStudioMateUserTickets } from './lib/studiomate-native-contract-source.mjs';
import { planInstructorExistingTicketAdoption, planInstructorComplimentaryTicketAdoption } from './lib/instructor-existing-ticket-adoption.mjs';
import { instructorLessonRegistrationId } from './lib/instructor-lesson-registration-contract.mjs';
import { makeLessonVideoSolapiRequest } from './lib/lesson-video-notice-solapi.mjs';
import { assertMemberDispatchAllowed } from './lib/member-dispatch-window.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2), apply = args.includes('--apply');
const complimentary = args.includes('--complimentary-only');
const TARGETS = new Set(complimentary ? ['안소은', '정유리'] : ['김예지', '김윤화', '이주홍']);
assert(args.length === (apply ? 3 : 1) + Number(complimentary)
  && args.every(a => a === '--apply' || a === '--complimentary-only' || a.startsWith('--audit=') || a.startsWith('--expected-commit=')));
const auditPath = args.find(a => a.startsWith('--audit='))?.slice(8);
assert(auditPath?.startsWith('/Users/archivepilates/ArchiveIN/operations/november-instructor-confirmation-20261029/') && path.resolve(auditPath) === auditPath);
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
if (apply) {
  const expectedCommit = args.find(a => a.startsWith('--expected-commit='))?.slice(18);
  assert(/^[a-f0-9]{40}$/.test(expectedCommit || ''));
  assert.equal(git('rev-parse', 'HEAD'), expectedCommit);
  git('diff', '--quiet', 'HEAD');
  if (ROOT === '/Users/archivepilates/dev/archive-in-runtime') {
    git('fetch', 'origin', 'main');
    assert.equal(git('rev-parse', 'HEAD'), git('rev-parse', 'origin/main'));
  } else {
    // This is the approved one-off data operation, not activation of a production worker.
    assert.equal(ROOT, '/Users/archivepilates/codex-worktrees/november-instructor-confirmation-20261029');
    assert.equal(git('branch', '--show-current'), 'codex/mini/november-instructor-confirmation-20261029');
  }
}
const audit = JSON.parse(await readFile(auditPath, 'utf8'));
const inputs = audit.rows.filter(r => TARGETS.has(r.name) && r.date === (complimentary ? '2026-11-28' : '2026-11-29'));
assert.equal(inputs.length, TARGETS.size);
const planAdoption = complimentary ? planInstructorComplimentaryTicketAdoption : planInstructorExistingTicketAdoption;
const require = createRequire('/Users/archivepilates/dev/archive-in-runtime/package.json');
const { chromium } = require('playwright');
const admin = require('./firebase/kangsain-functions/functions/node_modules/firebase-admin');
const app = admin.initializeApp({ credential: admin.credential.cert(JSON.parse(await readFile('/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json', 'utf8'))), projectId: 'archive-pilates' });
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
let context, release;
try {
  const db = app.firestore(), get = makeLessonVideoSolapiRequest();
  const template = await get('/kakao/v2/templates/KA01TP2608241233353269Jgtoiwnzi6', 'GET');
  assert.equal(template.status, 'APPROVED');
  for (const k of ['templateId', 'content', 'buttons', 'pfId']) assert.equal(hash(template[k] ?? null), hash(audit.template[k] ?? null), 'Approved template changed.');
  release = await acquireStudioMateBrowserLock({ owner: 'november-existing-ticket-adoption-readonly', waitMs: 120000 });
  context = await chromium.launchPersistentContext('/Users/archivepilates/ArchiveIN/automation/browser-profile', { headless: true });
  const page = await context.newPage();
  await page.route('**/*', r => r.request().url().includes('studiomate') && !['GET', 'HEAD', 'OPTIONS'].includes(r.request().method()) ? r.abort() : r.continue());
  const api = await captureStudioMateNativeApiClient(page);
  for (const input of inputs) {
    const id = instructorLessonRegistrationId('5330', input.phone, input.date);
    assert.equal(id, input.registrationId);
    const ref = db.doc('instructorLessonRegistrations/' + id);
    const key = 'november-existing-confirmation-20261029-' + id;
    const reportRef = db.doc('workLanes/instructor-lesson-registration/reports/' + key);
    if ((await reportRef.get()).exists) { console.log(JSON.stringify({ name: input.name, registrationId: id, status: 'already_applied', replayed: false })); continue; }
    const checkedAt = new Date().toISOString();
    const native = await readExactStudioMateMember(api, input.phone);
    assert.equal(native.status, 'verified');
    const tickets = await readStudioMateUserTickets(api, native.member.memberId);
    assert.equal(tickets.status, 'verified');
    const registrationQuery = db.collection('instructorLessonRegistrations').where('memberPhone', '==', input.phone).limit(101);
    const histories = await registrationQuery.get();
    assert(histories.size < 101);
    const all = histories.docs.map(s => ({ id: s.id, ...s.data() }));
    assert(!all.some(r => r.lessonDate === input.date), 'Any existing same-date registration must be reconciled.');
    const candidateQuery = db.collection('alimtalkCandidates').where('memberPhone', '==', input.phone).limit(201);
    const sendsQuery = db.collection('alimtalkSends').where('memberPhone', '==', input.phone).limit(201);
    const cancellationQuery = db.collection('studiomateInstructorLessonCancellations').where('registrationId', '==', id).limit(2);
    const cancelId = 'ilc_' + createHash('sha256').update(`5330|${native.member.memberId}|${input.date}`).digest('hex').slice(0, 32);
    const [year, month, day] = input.date.split('-').map(Number);
    const datePattern = new RegExp(`${year}년\\s*${month}월\\s*${day}일|${input.date.replaceAll('-', '[-./]')}`);
    const relevant = d => d.payload?.registrationId === id || d.payload?.lessonDate === input.date
      || d.sourceActionKey === id || datePattern.test(d.variables?.['#{수업일}'] || '');
    async function history(tx) {
      const read = ref => tx ? tx.get(ref) : ref.get();
      const current = await read(ref), job = await read(db.doc('studiomateInstructorLessonJobs/' + id));
      const eform = await read(db.doc('eformsignInstructorMemberJobs/' + id));
      const cancellation = await read(db.doc('studiomateInstructorLessonCancellations/' + cancelId));
      const cancellations = await read(cancellationQuery);
      assert(!current.exists && !job.exists && !eform.exists && !cancellation.exists && cancellations.empty, 'Existing target state requires reconciliation.');
      const cs = await read(candidateQuery), ss = await read(sendsQuery);
      assert(cs.size < 201 && ss.size < 201);
      assert(!cs.docs.some(s => relevant(s.data())) && !ss.docs.some(s => relevant(s.data())), 'Prior confirmation state must not be replayed.');
      return { candidates: [], sends: [], currentRegistration: null };
    }
    const currentHistory = await history();
    const provider = await get('/messages/v4/list?' + new URLSearchParams({ to: input.phone, dateType: 'CREATED', startDate: '2026-09-01T00:00:00Z', endDate: new Date().toISOString(), limit: '500' }), 'GET');
    assert(!provider.nextKey);
    const providerRows = Object.values(provider.messageList || {}).filter(m => datePattern.test(m.text || '')
      && (m.kakaoOptions?.templateId === template.templateId || /강사레슨/.test(m.text || '')));
    const source = { ...input, ...currentHistory, checkedAt, nativeStatus: native.status,
      member: { memberId: native.member.memberId, name: native.member.name, phone: native.member.phone,
        memberGrade: native.member.memberGrade, inactive: native.member.inactive },
      ticketReadStatus: tickets.status, tickets: tickets.tickets.filter(t => t.title === input.ticketName && t.availabilityStartAt === input.date && t.expireAt === input.date),
      providerRows, providerCheckedAt: new Date().toISOString(),
      priorRegistrations: all.filter(r => r.lessonDate !== input.date).map(r => ({ id: r.id, date: r.lessonDate,
        mode: r.mode, status: r.status, memberId: r.evidence?.studiomateMemberId, eformStatus: r.steps?.eformsign?.status })) };
    const approval = { action: complimentary ? 'adopt_existing_complimentary_ticket_notice' : 'adopt_existing_paid_returning_ticket_notice', registrationId: id,
      actor: 'operator-approved-current-chat-november-confirmation-recovery', operationKey: key, approvedAt: new Date().toISOString(),
      ...(complimentary ? { complimentaryConfirmed: true, expectedAmount: 0, memberId: native.member.memberId } : {}) };
    const plan = planAdoption({ source, approval });
    if (apply) {
      assertMemberDispatchAllowed();
      await db.runTransaction(async tx => {
        const report = await tx.get(reportRef);
        assert(!report.exists, 'Concurrent adoption must not be replayed.');
        await history(tx);
        const freshHistory = await tx.get(registrationQuery);
        assert.equal(freshHistory.size, histories.size, 'Recipient registrations changed.');
        assert(!freshHistory.docs.some(s => s.data().lessonDate === input.date));
        for (const snap of histories.docs) assert(freshHistory.docs.find(s => s.id === snap.id)?.updateTime?.isEqual(snap.updateTime), 'Prior registration changed.');
        const freshPlan = planAdoption({ source, approval });
        assertMemberDispatchAllowed();
        const at = admin.firestore.FieldValue.serverTimestamp();
        tx.create(reportRef, { approval, sourceProof: source, planHash: hash(freshPlan), sourceCommit: git('rev-parse', 'HEAD'), createdAt: at });
        tx.create(ref, { ...freshPlan.registration, createdAt: at, updatedAt: at });
      });
    }
    const result = { name: input.name, registrationId: id, mode: apply ? 'apply' : 'plan', planHash: hash(plan),
      ticketId: source.tickets[0].userTicketId, newTicketIssued: false, memberCreated: false, manualSends: 0,
      sourceCommit: git('rev-parse', 'HEAD'), checkedAt: new Date().toISOString() };
    const directory = '/Users/archivepilates/ArchiveIN/operations/november-instructor-confirmation-20261029';
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const handle = await open(path.join(directory, key + (apply ? '-apply' : '-plan') + '.json'), 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(result, null, 2)); await handle.sync(); } finally { await handle.close(); }
    console.log(JSON.stringify(result));
  }
} catch {
  console.error(JSON.stringify({ ok: false, code: 'EXISTING_TICKET_ADOPTION_STOPPED', replay: false,
    nextAction: 'Reconcile exact canonical audit and current sources before any further action.' })); process.exitCode = 1;
} finally { await context?.close(); await release?.(); await app.delete(); }
