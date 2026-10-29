import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { TEAM_EVENT } from './build-team-261121-calendar.mjs';
import { validateTeamTestTemplate, TEAM_TEST_ID } from './test-team-261121-confirmation.mjs';
import { TEAM_CONFIRMATION_TARGETS as TARGETS, TEAM_CONFIRMATION_TEMPLATE as TEMPLATE,
  TEAM_CONFIRMATION_CHANNEL as CHANNEL, teamConfirmationVariables, teamConfirmationKey, teamConfirmationSendId,
  isTeamConfirmationHistory, teamConfirmationReceipt } from './lib/team-261121-confirmation.mjs';
import { instructorLessonRegistrationId } from './lib/instructor-lesson-registration-contract.mjs';
import { acquireStudioMateBrowserLock } from './lib/studiomate-browser-lock.mjs';
import { captureStudioMateNativeApiClient, readExactStudioMateMember, readStudioMateUserTickets } from './lib/studiomate-native-contract-source.mjs';
import { makeLessonVideoSolapiRequest } from './lib/lesson-video-notice-solapi.mjs';
import { assertMemberDispatchAllowed } from './lib/member-dispatch-window.mjs';

const DIR = '/Users/archivepilates/ArchiveIN/operations/november-instructor-confirmation-20261029';
const AUDIT_HASH = '7e789ceebaa1610d2e7ef836e869b7201706396d3825a2fb8ddff7cc35e25100';
const args = process.argv.slice(2), apply = args.includes('--apply');
assert(args.length === (apply ? 2 : 0) && args.every(a => a === '--apply' || a.startsWith('--expected-commit=')));
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim(), commit = git('rev-parse', 'HEAD');
if (apply) { assert.equal(args.find(a => a.startsWith('--expected-commit='))?.slice(18), commit); git('diff', '--quiet', 'HEAD'); assertMemberDispatchAllowed(); }
const sha = x => createHash('sha256').update(typeof x === 'string' || Buffer.isBuffer(x) ? x : JSON.stringify(x)).digest('hex');
const auditBytes = await fs.readFile(DIR + '/audit-initial.json'); assert.equal(sha(auditBytes), AUDIT_HASH);
const audit = JSON.parse(auditBytes), inputs = TARGETS.map(t => {
  const rows = audit.rows.filter(r => r.member?.memberId === t.memberId && r.name === t.name
    && r.date === TEAM_EVENT.date && r.ticketName === 'Team 강사레슨');
  assert.equal(rows.length, 1); return rows[0];
});
assert.equal(new Set(inputs.map(x => x.phone)).size, 5);
const require = createRequire('/Users/archivepilates/dev/archive-in-runtime/package.json');
const admin = require('./firebase/kangsain-functions/functions/node_modules/firebase-admin'), { chromium } = require('playwright');
const app = admin.initializeApp({ credential: admin.credential.cert(JSON.parse(await fs.readFile('/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json', 'utf8'))), projectId: 'archive-pilates' });
let context, release, activeClaim = null, effectStarted = false;
const db = app.firestore(), get = makeLessonVideoSolapiRequest(), results = [];
const read = (ref, tx) => tx ? tx.get(ref) : ref.get();
async function provider(phone) {
  const p = await get('/messages/v4/list?' + new URLSearchParams({ to: phone, dateType: 'CREATED',
    startDate: '2026-09-01T00:00:00Z', endDate: new Date().toISOString(), limit: '500' }), 'GET');
  assert(!p.nextKey && p.messageList && typeof p.messageList === 'object');
  const rows = Object.values(p.messageList); assert(rows.every(m => m.to === phone)); return rows;
}
async function history(input, tx, owned = null) {
  const id = instructorLessonRegistrationId('5330', input.phone, TEAM_EVENT.date);
  const regs = await read(db.collection('instructorLessonRegistrations').where('memberPhone', '==', input.phone).limit(101), tx);
  assert(regs.size < 101 && !regs.docs.some(r => r.data().lessonDate === TEAM_EVENT.date), 'Existing Team intake requires reconciliation, not bypass.');
  const cancelId = 'ilc_' + sha(`5330|${input.member.memberId}|${TEAM_EVENT.date}`).slice(0, 32);
  const paths = ['instructorLessonRegistrations/' + id, 'studiomateInstructorLessonJobs/' + id,
    'eformsignInstructorMemberJobs/' + id, 'studiomateInstructorLessonCancellations/' + cancelId];
  for (const p of paths) assert(!(await read(db.doc(p), tx)).exists, 'Existing member workflow requires reconciliation.');
  const cancellations = await read(db.collection('studiomateInstructorLessonCancellations').where('registrationId', '==', id).limit(2), tx);
  assert(cancellations.empty);
  for (const collection of ['alimtalkCandidates', 'alimtalkSends']) for (const [field, value] of [['memberPhone', input.phone], ['memberId', input.member.memberId]]) {
    const rows = await read(db.collection(collection).where(field, '==', value).limit(201), tx);
    assert(rows.size < 201 && !rows.docs.some(s => !(owned && s.id === (collection === 'alimtalkCandidates' ? owned.key : owned.sendId))
      && isTeamConfirmationHistory(s.data())), 'Prior or ambiguous notice blocks another send.');
    if (collection === 'alimtalkSends') for (const s of rows.docs) {
      if (owned && s.id === owned.sendId) continue;
      const parentId = s.data().candidateId;
      if (parentId) { assert(typeof parentId === 'string' && !parentId.includes('/'));
        const parent = await read(db.doc('alimtalkCandidates/' + parentId), tx);
        assert(!parent.exists || !isTeamConfirmationHistory(parent.data()), 'Prior linked notice blocks another send.'); }
    }
  }
}
async function nativePlan(api, input) {
  const checkedAt = new Date().toISOString(), source = await readExactStudioMateMember(api, input.phone);
  assert(source.status === 'verified' && source.member.memberId === input.member.memberId && source.member.phone === input.phone);
  const tickets = await readStudioMateUserTickets(api, source.member.memberId); assert.equal(tickets.status, 'verified');
  const variables = teamConfirmationVariables(source.member, tickets.tickets);
  const lectures = await api.get('/v2/staff/lectures?start_date=2026-11-21&end_date=2026-11-21&limit=100&page=1&sort_by_name=start_on&sort_by_type=asc&with=room%3Bdivision%3Bstaff.profile');
  assert(Array.isArray(lectures.data) && lectures.meta?.last_page === 1 && lectures.meta?.current_page === 1 && lectures.data.length === lectures.meta?.total);
  for (const s of TEAM_EVENT.sessions) { const r = lectures.data.find(r => String(r.id) === s.lectureId); assert(r && r.title === '강사레슨(team)'
    && r.description === s.description && r.start_on === `2026-11-21 ${s.start}:00` && r.end_on === `2026-11-21 ${s.end}:00`); }
  await history(input); assert(!(await provider(input.phone)).some(isTeamConfirmationHistory));
  return { member: source.member, variables, checkedAt, sourceHash: sha({ member: source.member, tickets: tickets.tickets, lectures: lectures.data }) };
}
try {
  const template = await get('/kakao/v2/templates/' + TEMPLATE, 'GET'); validateTeamTestTemplate(template);
  const preview = await db.doc('alimtalkCandidates/' + TEAM_TEST_ID).get();
  assert(preview.data()?.status === 'sent' && preview.data().providerStatusCode === '4000');
  for (const [key, value] of Object.entries(preview.data().variables)) if (key !== '#{이름}') assert.equal(value,
    ({ '#{수업일}': TEAM_EVENT.dateText, '#{수업시간}': TEAM_EVENT.timeText, '#{수업구성}': TEAM_EVENT.composition, '#{관리번호}': 'team-261121' })[key]);
  for (const suffix of ['index.html', TEAM_EVENT.icsName]) { const r = await fetch(TEAM_EVENT.url + suffix, { cache: 'no-store' });
    assert(r.ok && (suffix !== TEAM_EVENT.icsName || /text\/calendar/.test(r.headers.get('content-type'))));
    assert.equal(sha(Buffer.from(await r.arrayBuffer())), sha(await fs.readFile('archivein/method/team-261121/calendar/' + suffix))); }
  release = await acquireStudioMateBrowserLock({ owner: 'approved-team-confirmations-261121', waitMs: 120000 });
  context = await chromium.launchPersistentContext('/Users/archivepilates/ArchiveIN/automation/browser-profile', { headless: true });
  const page = await context.newPage(); await page.route('**/*', r => r.request().url().includes('studiomate') && !['GET', 'HEAD', 'OPTIONS'].includes(r.request().method()) ? r.abort() : r.continue());
  const api = await captureStudioMateNativeApiClient(page);
  for (const input of inputs) { const prior = await db.doc('alimtalkCandidates/' + teamConfirmationKey(input.member.memberId, input.phone)).get();
    assert(!prior.exists, 'A previous claim exists; read back and never replay.'); await nativePlan(api, input); }
  if (!apply) { console.log(JSON.stringify({ ok: true, mode: 'plan', recipients: TARGETS.map(t => t.name), count: 5, templateVerified: true, nativeTicketsAndScheduleVerified: true, priorNotices: 0, registrationWrites: 0 })); }
  else for (const input of inputs) {
    const plan = await nativePlan(api, input), key = teamConfirmationKey(plan.member.memberId, plan.member.phone);
    const sendId = teamConfirmationSendId(plan.member.memberId, plan.member.phone);
    const c = db.doc('alimtalkCandidates/' + key), s = db.doc('alimtalkSends/' + sendId), auditRef = db.doc('workLanes/instructor-lesson-registration/reports/' + key);
    const fresh = () => { assert(Date.now() - Date.parse(plan.checkedAt) >= 0 && Date.now() - Date.parse(plan.checkedAt) < 120000); assertMemberDispatchAllowed(); };
    const owned = (candidate, send) => { assert(candidate?.candidateId === key && send?.candidateId === key && send.sendId === sendId
      && candidate.sourceCommit === commit && send.sourceCommit === commit && candidate.source?.hash === plan.sourceHash
      && candidate.memberPhone === plan.member.phone && send.memberPhone === plan.member.phone
      && sha(candidate.variables) === sha(plan.variables) && sha(send.variables) === sha(plan.variables)
      && !Object.hasOwn(candidate.payload || {}, 'registrationId') && candidate.sourceActionKey === key); };
    fresh();
    const approval = { actor: 'operator-current-chat-20261029', action: 'send_approved_team_confirmation_once',
      previewCandidateId: TEAM_TEST_ID, lessonDate: TEAM_EVENT.date, recipientMemberIds: TARGETS.map(t => t.memberId),
      templateId: TEMPLATE, contentHash: sha({ content: template.content, buttons: template.buttons, event: TEAM_EVENT }), approvedAt: new Date().toISOString() };
    await db.runTransaction(async tx => {
      const existing = await tx.get(c), existingSend = await tx.get(s), previousAudit = await tx.get(auditRef);
      assert(!existing.exists && !existingSend.exists && !previousAudit.exists); await history(input, tx); fresh();
      const at = admin.firestore.FieldValue.serverTimestamp(), common = { studioId: '5330', memberId: plan.member.memberId, memberName: plan.member.name,
        memberPhone: plan.member.phone, templateCode: TEMPLATE, sourceActionKey: key, attempts: 0, maxAttempts: 1,
        manualDispatchOnly: true, externalEffectStarted: false, isTest: false, variables: plan.variables, approval, sourceCommit: commit,
        payload: { lessonDate: TEAM_EVENT.date, managementNumber: 'team-261121', teamConfirmationKey: key, sourceTicketId: TARGETS.find(t => t.memberId === plan.member.memberId).ticketId },
        source: { type: 'studiomate_native_ticket', checkedAt: plan.checkedAt, hash: plan.sourceHash }, createdAt: at, updatedAt: at };
      // reviewed is excluded from the ordinary queued/processing worker selection.
      tx.create(c, { ...common, status: 'reviewed', reasonCode: 'operator_dispatch_claimed', candidateId: key, type: 'instructor_lesson_confirmation' });
      tx.create(s, { ...common, status: 'processing', sendId, candidateId: key });
      tx.create(auditRef, { approval, sourceHash: plan.sourceHash, sourceCheckedAt: plan.checkedAt, sourceCommit: commit,
        createsRegistration: false, issuesTicket: false, createsEform: false, createdAt: at });
    });
    activeClaim = { c, s }; effectStarted = false; fresh();
    await db.runTransaction(async tx => { const cs = await tx.get(c), ss = await tx.get(s); owned(cs.data(), ss.data()); assert(cs.data()?.status === 'reviewed' && ss.data()?.status === 'processing');
      await history(input, tx, { key, sendId }); fresh();
      // Cancellation recognizes processing; maxAttempts=1 prevents a stale worker retry.
      tx.update(c, { status: 'processing', attempts: 1, externalEffectStarted: true, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      tx.update(s, { attempts: 1, externalEffectStarted: true }); });
    fresh(); effectStarted = true;
    const receipt = await get('/messages/v4/send-many/detail', 'POST', { messages: [{ to: plan.member.phone, type: 'ATA',
      kakaoOptions: { pfId: CHANNEL, templateId: TEMPLATE, disableSms: true, variables: plan.variables },
      customFields: { archiveActionKey: key, purpose: 'approved_team_confirmation' } }], strict: true, allowDuplicates: false, showMessageList: true });
    const messageId = teamConfirmationReceipt(receipt, plan.member.phone);
    await db.runTransaction(async tx => { const cs = await tx.get(c), ss = await tx.get(s); owned(cs.data(), ss.data());
      assert(cs.data()?.status === 'processing' && ss.data()?.status === 'processing'); tx.update(c, { solapiMessageId: messageId }); tx.update(s, { solapiMessageId: messageId }); });
    const rows = (await provider(plan.member.phone)).filter(m => m.messageId === messageId);
    assert(rows.length === 1 && rows[0].kakaoOptions?.templateId === TEMPLATE && rows[0].customFields?.archiveActionKey === key);
    let rendered = template.content; for (const [k, v] of Object.entries(plan.variables)) rendered = rendered.split(k).join(v);
    assert.equal(rows[0].text, rendered);
    await db.runTransaction(async tx => { const cs = await tx.get(c), ss = await tx.get(s); owned(cs.data(), ss.data()); assert(cs.data()?.status === 'processing' && ss.data()?.status === 'processing');
      const at = admin.firestore.FieldValue.serverTimestamp(), common = { solapiMessageId: messageId, acceptedAt: new Date(rows[0].dateCreated),
        providerStatus: rows[0].status, providerStatusCode: rows[0].statusCode, providerReadbackAt: new Date().toISOString(), updatedAt: at };
      tx.update(c, { ...common, status: 'sent', reasonCode: null, sentAt: new Date(rows[0].dateCreated) }); tx.update(s, { ...common, status: 'done' }); });
    const result = { name: plan.member.name, candidateId: key, sendId, messageId, acceptedAt: rows[0].dateCreated, sourceCommit: commit, checkedAt: new Date().toISOString(), replayed: false };
    results.push(result); activeClaim = null; effectStarted = false;
    const handle = await fs.open(DIR + '/' + key + '-accepted.json', 'wx', 0o600); try { await handle.writeFile(JSON.stringify(result, null, 2)); } finally { await handle.close(); }
    console.log(JSON.stringify(result));
  }
} catch {
  if (activeClaim) { const patch = { status: 'review_required', attempts: effectStarted ? 1 : 0, externalEffectStarted: effectStarted,
    lastError: effectStarted ? '접수 결과 확인 필요 · 재발송 금지' : '전송 전 확인 중단 · 공급자 요청 없음', updatedAt: admin.firestore.FieldValue.serverTimestamp() };
    await db.runTransaction(async tx => { const c = await tx.get(activeClaim.c), s = await tx.get(activeClaim.s);
      if (c.data()?.status === 'sent' || s.data()?.status === 'done') return;
      tx.update(activeClaim.c, patch); tx.update(activeClaim.s, patch); }).catch(() => {}); }
  console.error(JSON.stringify({ ok: false, code: 'TEAM_CONFIRMATIONS_STOPPED', acceptedCount: results.length, effectStarted, replay: false })); process.exitCode = 1;
} finally { await context?.close(); await release?.(); await app.delete(); }
