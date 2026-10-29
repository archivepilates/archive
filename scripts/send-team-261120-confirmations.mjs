import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TEAM_EVENT, TEAM_CALENDAR_DIR, buildTeamCalendar } from './build-team-261120-calendar.mjs';
import { validateTeamTestTemplate } from './test-team-261121-confirmation.mjs';
import { TEAM_IDS, TEAM_DIRECTORY, assertTeamLectures } from './lib/team-261120-scope.mjs';
import { instructorLessonRegistrationId } from './lib/instructor-lesson-registration-contract.mjs';
import { assertMemberDispatchAllowed, isMemberDispatchDeferred } from './lib/member-dispatch-window.mjs';
import { TEMPLATE, CHANNEL, MANAGEMENT, stableHash, assertRegistration, confirmationVariables,
  confirmationKey, confirmationSendId, isConfirmationHistory, receiptMessageId,
  verifyProviderMessage, approvalFor, d1PromiseVerified } from './lib/team-261120-confirmation.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const LIMIT = 501;
const LECTURES = '/v2/staff/lectures?start_date=2026-11-20&end_date=2026-11-20&limit=100&page=1&sort_by_name=start_on&sort_by_type=asc&with=room%3Bdivision%3Bstaff.profile';

export function confirmationArguments(args) {
  const apply = args.includes('--apply'), expected = args.find(a => a.startsWith('--expected-commit='))?.slice(18);
  assert(new Set(args).size === args.length && args.length === (apply ? 2 : 0)
    && args.every(a => a === '--apply' || a.startsWith('--expected-commit=')), 'INVALID_ARGUMENTS');
  assert(!apply || /^[a-f0-9]{40}$/.test(expected || ''), 'EXPECTED_COMMIT_REQUIRED');
  return { apply, expected };
}
export function assertConfirmationSource(git, expected) {
  assert.equal(git(['rev-parse', 'HEAD']), expected, 'SOURCE_COMMIT_MISMATCH');
  assert.equal(git(['status', '--porcelain']), '', 'CLEAN_SOURCE_REQUIRED');
  git(['ls-files', '--error-unmatch', 'scripts/send-team-261120-confirmations.mjs',
    'scripts/lib/team-261120-confirmation.mjs', 'scripts/lib/team-261120-scope.mjs',
    'scripts/tests/team-261120-confirmations.test.mjs', 'scripts/build-team-261120-calendar.mjs',
    'archivein/method/team-261120/calendar/index.html', 'archivein/method/team-261120/calendar/' + TEAM_EVENT.icsName]);
}

export async function verifyCalendar(fetcher = fetch) {
  await buildTeamCalendar({ check: true });
  for (const file of ['index.html', TEAM_EVENT.icsName]) {
    const response = await fetcher(TEAM_EVENT.url + file, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30000) });
    assert(response.ok && (file !== TEAM_EVENT.icsName || /text\/calendar/i.test(response.headers.get('content-type') || '')), 'CALENDAR_UNAVAILABLE');
    assert.equal(sha(Buffer.from(await response.arrayBuffer())), sha(await fs.readFile(path.join(TEAM_CALENDAR_DIR, file))), 'CALENDAR_BYTES_MISMATCH');
  }
}

export async function providerHistory(request, phone, now = Date.now()) {
  const rows = [], cursors = new Set(), ids = new Set(); let cursor;
  do {
    const query = new URLSearchParams({ to: phone, dateType: 'CREATED', startDate: '1970-01-01T00:00:00Z',
      endDate: new Date(now).toISOString(), limit: '500', ...(cursor ? { nextKey: cursor } : {}) });
    const p = await request('/messages/v4/list?' + query, 'GET');
    assert(p?.messageList && typeof p.messageList === 'object', 'INCOMPLETE_PROVIDER_HISTORY');
    for (const row of Object.values(p.messageList)) {
      assert(row?.to === phone && typeof row.messageId === 'string' && !ids.has(row.messageId), 'PROVIDER_HISTORY_IDENTITY_OR_CURSOR');
      ids.add(row.messageId); rows.push(row);
    }
    cursor = p.nextKey;
    assert(!cursor || typeof cursor === 'string' && !cursors.has(cursor), 'PROVIDER_HISTORY_CURSOR');
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return rows;
}

export async function readFreshTeamNative({ page, phone, memberId, capture, readMember, readTickets }) {
  // capture navigates to /users/contract and observes new native GET headers. Never retain
  // its roughly two-minute signature across recipients or retry authentication failures.
  const api = await capture(page);
  return { member: await readMember(api, phone), tickets: await readTickets(api, memberId), lectures: await api.get(LECTURES) };
}

// No external effects occur on import. Tests inject every I/O boundary and use synthetic identities.
export async function runTeamConfirmations({ db, request, readNative, fetcher = fetch, clock = Date.now,
  git = a => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(),
  args = [], d1Proof, timestamp = () => new Date(clock()), registrationIdFor = instructorLessonRegistrationId,
} = {}) {
  const { apply, expected } = confirmationArguments(args);
  const commit = git(['rev-parse', 'HEAD']);
  if (apply) assertConfirmationSource(git, expected);
  const read = (ref, tx) => tx ? tx.get(ref) : ref.get();
  const doc = (collection, id) => db.doc(collection + '/' + id);
  const query = async (collection, field, value, tx) => {
    const result = await read(db.collection(collection).where(field, '==', value).limit(LIMIT), tx);
    assert(result.size < LIMIT, 'CANONICAL_HISTORY_TRUNCATED');
    return result.docs;
  };
  const bindingFor = (id, r) => assertRegistration(id, r, registrationIdFor);
  const registrations = [];
  for (const id of TEAM_IDS) {
    const row = await read(doc('instructorLessonRegistrations', id));
    assert(row.exists, 'CANONICAL_REGISTRATION_MISSING');
    const r = row.data(), binding = bindingFor(id, r);
    registrations.push({ id, r, binding, key: confirmationKey(binding.memberId, binding.phone),
      sendId: confirmationSendId(binding.memberId, binding.phone) });
  }
  assert(new Set(registrations.map(p => p.binding.phone)).size === 6
    && new Set(registrations.map(p => p.binding.memberId)).size === 6, 'EXACT_SIX_DISTINCT_IDENTITIES_REQUIRED');
  // A durable claim, including an incomplete/unknown claim, is a read-only reconciliation exit.
  for (const p of registrations) {
    const c = await read(doc('alimtalkCandidates', p.key)), s = await read(doc('alimtalkSends', p.sendId));
    if (c.exists || s.exists || p.r.teamConfirmationDispatch || p.r.evidence?.confirmationCandidateId
      || p.r.evidence?.confirmationSolapiMessageId) return { ok: false, mode: 'read_only', reason: 'PRIOR_CLAIM_RECONCILE_ONLY', recipientCount: 6, replay: false };
  }

  async function history(p, tx, owned) {
    const reg = await read(doc('instructorLessonRegistrations', p.id), tx);
    assert(reg.exists, 'CANONICAL_REGISTRATION_MISSING');
    const r = reg.data(), binding = bindingFor(p.id, r);
    assert.deepEqual(binding, p.binding, 'REGISTRATION_CHANGED');
    assert(!r.externalEffectStarted || owned && r.teamConfirmationDispatch?.key === p.key, 'REGISTRATION_BUSY');
    const sameDate = (await query('instructorLessonRegistrations', 'memberPhone', binding.phone, tx))
      .filter(row => row.data().lessonDate === TEAM_EVENT.date);
    assert(sameDate.length === 1 && sameDate[0].id === p.id, 'AMBIGUOUS_CANONICAL_REGISTRATION');
    const memberRegs = await query('instructorLessonRegistrations', 'studiomateMemberId', binding.memberId, tx);
    assert(!memberRegs.some(row => row.id !== p.id && (!row.data().lessonDate || row.data().lessonDate === TEAM_EVENT.date)), 'AMBIGUOUS_MEMBER_REGISTRATION');
    if (!owned) assert(!r.teamConfirmationDispatch && !r.evidence?.confirmationCandidateId
      && !r.evidence?.confirmationSolapiMessageId && !['sent', 'verified', 'queued', 'processing'].includes(r.steps?.confirmation?.status), 'PRIOR_REGISTRATION_NOTICE');
    const cancelId = 'ilc_' + sha(`5330|${binding.memberId}|${TEAM_EVENT.date}`).slice(0, 32);
    assert(!(await read(doc('studiomateInstructorLessonCancellations', cancelId), tx)).exists, 'CANCELLATION_EXISTS');
    for (const [field, value] of [['registrationId', p.id], ['memberPhone', binding.phone], ['memberId', binding.memberId]]) {
      const cancels = await query('studiomateInstructorLessonCancellations', field, value, tx);
      assert(!cancels.some(row => field === 'registrationId' || !row.data().lessonDate
        || row.data().lessonDate === TEAM_EVENT.date || !/^\d{4}-\d{2}-\d{2}$/.test(row.data().lessonDate)), 'CANCELLATION_EXISTS');
    }
    const candidates = new Map(), sends = new Map();
    for (const [collection, target] of [['alimtalkCandidates', candidates], ['alimtalkSends', sends]]) {
      for (const [field, value] of [['memberPhone', binding.phone], ['phone', binding.phone], ['memberId', binding.memberId],
        ['registrationId', p.id], ['payload.registrationId', p.id], ['source.registrationId', p.id]]) {
        for (const row of await query(collection, field, value, tx)) target.set(row.id, row);
      }
    }
    for (const s of sends.values()) {
      const parentId = s.data().candidateId;
      if (!parentId) continue;
      assert(typeof parentId === 'string' && !parentId.includes('/'), 'INVALID_PARENT_CANDIDATE');
      const parent = await read(doc('alimtalkCandidates', parentId), tx);
      assert(parent.exists, 'MISSING_PARENT_CANDIDATE');
      candidates.set(parentId, parent);
    }
    for (const candidate of candidates.values()) {
      for (const row of await query('alimtalkSends', 'candidateId', candidate.id, tx)) {
        assert((owned && row.id === p.sendId) || !isConfirmationHistory(candidate.data()), 'PRIOR_LINKED_CONFIRMATION');
        sends.set(row.id, row);
      }
    }
    for (const [rows, ownId] of [[candidates, p.key], [sends, p.sendId]]) for (const row of rows.values()) {
      if (owned && row.id === ownId) continue;
      assert(!isConfirmationHistory(row.data()) && row.data().payload?.registrationId !== p.id
        && row.data().registrationId !== p.id && row.data().source?.registrationId !== p.id, 'PRIOR_OR_UNKNOWN_CONFIRMATION');
    }
    return r;
  }

  const template = await request('/kakao/v2/templates/' + TEMPLATE, 'GET');
  validateTeamTestTemplate(template);
  const approval = approvalFor(template);
  await verifyCalendar(fetcher);
  async function planFor(p) {
    const checkedAt = clock();
    const currentTemplate = await request('/kakao/v2/templates/' + TEMPLATE, 'GET');
    validateTeamTestTemplate(currentTemplate);
    assert.equal(stableHash(approvalFor(currentTemplate)), stableHash(approval), 'TEMPLATE_APPROVAL_CHANGED');
    const r = await history(p);
    const native = await readNative(p.binding.phone, p.binding.memberId);
    assertTeamLectures(native.lectures);
    const variables = confirmationVariables(p.id, r, native.member, native.tickets, native.lectures, registrationIdFor);
    const provider = await providerHistory(request, p.binding.phone, clock());
    assert(!provider.some(isConfirmationHistory), 'PRIOR_PROVIDER_CONFIRMATION');
    assert(clock() >= checkedAt && clock() - checkedAt < 120000, 'STALE_NATIVE_SOURCE');
    return { ...p, variables, checkedAt, sourceHash: stableHash({ binding: p.binding,
      member: native.member, tickets: native.tickets, lectures: native.lectures }) };
  }
  // Validate all six before claiming the first recipient. Refresh again for each actual effect.
  for (const p of registrations) await planFor(p);
  // Main may verify existing manual operations. This proof does not assert that D-1
  // automation is linked/active, and this sender creates no D-1 jobs or workflow.
  const d1Ready = d1PromiseVerified(d1Proof, template, clock());
  if (!apply) return { ok: true, mode: 'plan', recipientCount: 6, nativeVerified: true, calendarVerified: true,
    templateVerified: true, sendReady: d1Ready, gates: d1Ready ? [] : ['D1_PROMISE_MAIN_REVIEW_REQUIRED'], writes: 0 };
  assert(d1Ready, 'D1_PROMISE_MAIN_REVIEW_REQUIRED');
  let active, effectStarted = false, acceptedCount = 0, deliveredCount = 0;
  const fresh = p => {
    assert(clock() >= p.checkedAt && clock() - p.checkedAt < 120000, 'STALE_NATIVE_SOURCE');
    assert(d1PromiseVerified(d1Proof, template, clock()), 'D1_PROMISE_MAIN_REVIEW_REQUIRED');
    assertMemberDispatchAllowed(clock());
  };
  const owned = (p, candidate, send) => {
    for (const [row, id] of [[candidate, p.key], [send, p.sendId]]) {
      assert(row && (row.candidateId === p.key) && row.sourceActionKey === p.key
        && row.sourceCommit === commit && row.memberId === p.binding.memberId && row.memberPhone === p.binding.phone
        && row.registrationId === p.id && row.payload?.registrationId === p.id && row.payload.sourceTicketId === p.binding.ticketId
        && row.source?.registrationId === p.id && row.source.hash === p.sourceHash && row.manualDispatchOnly === true
        && row.maxAttempts === 1 && stableHash(row.variables) === stableHash(p.variables)
        && stableHash(row.approval) === stableHash(approval), 'CLAIM_BINDING_CHANGED');
      if (id === p.sendId) assert(row.sendId === p.sendId, 'SEND_BINDING_CHANGED');
    }
  };
  try {
    for (const input of registrations) {
      const p = await planFor(input), c = doc('alimtalkCandidates', p.key), s = doc('alimtalkSends', p.sendId);
      const reg = doc('instructorLessonRegistrations', p.id);
      fresh(p); assertConfirmationSource(git, expected);
      const claimed = await db.runTransaction(async tx => {
        const cs = await tx.get(c), ss = await tx.get(s);
        if (cs.exists || ss.exists) return false;
        await history(p, tx); fresh(p);
        const at = timestamp(), common = { studioId: '5330', memberId: p.binding.memberId, memberName: p.binding.name,
          memberPhone: p.binding.phone, registrationId: p.id, type: 'instructor_lesson_confirmation', templateCode: TEMPLATE,
          sourceDate: TEAM_EVENT.date, sourceActionKey: p.key, candidateId: p.key, attempts: 0, maxAttempts: 1,
          manualDispatchOnly: true, externalEffectStarted: false, isTest: false, variables: p.variables, approval,
          sourceCommit: commit, payload: { registrationId: p.id, sourceTicketId: p.binding.ticketId,
            lessonDate: TEAM_EVENT.date, managementNumber: MANAGEMENT }, source: { type: 'instructorLessonRegistrations',
            path: 'instructorLessonRegistrations/' + p.id, registrationId: p.id, checkedAt: new Date(p.checkedAt).toISOString(), hash: p.sourceHash },
          createdAt: at, updatedAt: at };
        tx.create(c, { ...common, status: 'reviewed', dispatchState: 'claimed', reasonCode: 'manual_dispatch_only' });
        tx.create(s, { ...common, sendId: p.sendId, status: 'processing', providerOutcome: 'not_attempted' });
        return true;
      });
      if (!claimed) return { ok: false, mode: 'read_only', reason: 'PRIOR_CLAIM_RECONCILE_ONLY', recipientCount: 6, acceptedCount, deliveredCount, replay: false };
      active = { p, c, s, reg }; effectStarted = false;
      // A second all-channel read precedes the final transactional cancellation/history check.
      assert(!(await providerHistory(request, p.binding.phone, clock())).some(isConfirmationHistory), 'PRIOR_PROVIDER_CONFIRMATION');
      await db.runTransaction(async tx => {
        const cs = await tx.get(c), ss = await tx.get(s);
        owned(p, cs.data(), ss.data());
        assert(cs.data().status === 'reviewed' && ss.data().status === 'processing'
          && cs.data().attempts === 0 && ss.data().attempts === 0 && !cs.data().externalEffectStarted, 'CLAIM_NOT_IDLE');
        await history(p, tx, true); fresh(p);
        // Keep reviewed: the ordinary worker selects queued/processing. The registration flag also
        // participates in the existing cancellation transaction, closing the post-check race.
        tx.update(c, { attempts: 1, externalEffectStarted: true, dispatchState: 'attempting', updatedAt: timestamp() });
        tx.update(s, { attempts: 1, externalEffectStarted: true, providerOutcome: 'attempting', updatedAt: timestamp() });
        tx.update(reg, { externalEffectStarted: true, teamConfirmationDispatch: { key: p.key, sendId: p.sendId,
          sourceTicketId: p.binding.ticketId, sourceCommit: commit, state: 'attempting' },
        'evidence.confirmationCandidateId': p.key, updatedAt: timestamp() });
      });
      fresh(p); effectStarted = true;
      const receipt = await request('/messages/v4/send-many/detail', 'POST', { messages: [{ to: p.binding.phone, type: 'ATA',
        kakaoOptions: { pfId: CHANNEL, templateId: TEMPLATE, disableSms: true, variables: p.variables },
        customFields: { archiveActionKey: p.key, purpose: 'approved_team_confirmation', registrationId: p.id, sourceTicketId: p.binding.ticketId } }],
      strict: true, allowDuplicates: false, showMessageList: true });
      const messageId = receiptMessageId(receipt, p.binding.phone);
      // Persist acceptance/message ID before ANY further provider GET. Unknown writes are never retried.
      await db.runTransaction(async tx => {
        const cs = await tx.get(c), ss = await tx.get(s), rs = await tx.get(reg);
        owned(p, cs.data(), ss.data());
        assert(cs.data().dispatchState === 'attempting' && ss.data().providerOutcome === 'attempting'
          && rs.data()?.teamConfirmationDispatch?.key === p.key, 'RECEIPT_CLAIM_CHANGED');
        const patch = { solapiMessageId: messageId, providerOutcome: 'accepted', acceptedAt: timestamp(),
          deliveryStatus: 'unverified', updatedAt: timestamp() };
        tx.update(c, { ...patch, status: 'sent', dispatchState: 'accepted' });
        tx.update(s, { ...patch, status: 'accepted' });
        tx.update(reg, { 'evidence.confirmationSolapiMessageId': messageId,
          'teamConfirmationDispatch.state': 'accepted', 'steps.confirmation': { status: 'sent', label: '예약확정 안내',
            detail: '제공자 접수 확인 · 최종 전달 미확인' }, updatedAt: timestamp() });
      });
      acceptedCount++;
      const rows = (await providerHistory(request, p.binding.phone, clock())).filter(row => row.messageId === messageId);
      assert(rows.length === 1, 'EXACT_PROVIDER_MESSAGE_REQUIRED');
      const delivery = verifyProviderMessage(rows[0], p, template, messageId);
      await db.runTransaction(async tx => {
        const cs = await tx.get(c), ss = await tx.get(s), rs = await tx.get(reg);
        owned(p, cs.data(), ss.data());
        assert(cs.data().solapiMessageId === messageId && ss.data().solapiMessageId === messageId
          && rs.data()?.teamConfirmationDispatch?.key === p.key, 'ACCEPTED_CLAIM_CHANGED');
        const patch = { ...delivery, providerReadbackAt: timestamp(), updatedAt: timestamp() };
        tx.update(c, { ...patch, dispatchState: 'verified', reasonCode: delivery.deliveryStatus === 'delivered' ? null : 'delivery_not_complete' });
        tx.update(s, { ...patch, status: delivery.deliveryStatus === 'delivered' ? 'done' : 'accepted' });
        tx.update(reg, { externalEffectStarted: false, 'teamConfirmationDispatch.state': 'verified',
          'steps.confirmation': { status: delivery.deliveryStatus === 'delivered' ? 'verified' : 'sent', label: '예약확정 안내',
            detail: delivery.deliveryStatus === 'delivered' ? '제공자 최종 전달 COMPLETE 4000 확인' : '제공자 접수 확인 · 최종 전달 미완료' }, updatedAt: timestamp() });
      });
      if (delivery.deliveryStatus === 'delivered') deliveredCount++;
      active = null; effectStarted = false;
      if (delivery.deliveryStatus === 'failed') return { ok: false, mode: 'apply', reason: 'DELIVERY_FAILED_RECONCILE_ONLY', recipientCount: 6, acceptedCount, deliveredCount, replay: false };
    }
    return { ok: true, mode: 'apply', recipientCount: 6, acceptedCount, deliveredCount, replay: false };
  } catch (error) {
    if (active) {
      const { p, c, s, reg } = active;
      await db.runTransaction(async tx => {
        const cs = await tx.get(c), ss = await tx.get(s), rs = await tx.get(reg);
        owned(p, cs.data(), ss.data());
        const accepted = Boolean(cs.data().solapiMessageId);
        const reason = !effectStarted && isMemberDispatchDeferred(error) ? 'quiet_hours_deferred'
          : effectStarted ? 'provider_outcome_reconcile_only' : 'pre_effect_review_required';
        const patch = { attempts: effectStarted ? 1 : 0, externalEffectStarted: effectStarted, reviewRequired: true,
          reasonCode: reason, updatedAt: timestamp() };
        tx.update(c, { ...patch, status: accepted ? 'sent' : 'reviewed', dispatchState: reason });
        tx.update(s, { ...patch, status: accepted ? 'accepted' : effectStarted ? 'review_required' : 'deferred',
          providerOutcome: accepted ? 'accepted' : effectStarted ? 'unknown' : 'not_attempted' });
        if (rs.data()?.teamConfirmationDispatch?.key === p.key) tx.update(reg, {
          externalEffectStarted: effectStarted, 'teamConfirmationDispatch.state': reason, updatedAt: timestamp() });
      }).catch(() => {});
    }
    // Diagnostics deliberately contain no names, phones, payloads, source records or credentials.
    return { ok: false, mode: 'apply', reason: !effectStarted && isMemberDispatchDeferred(error) ? 'QUIET_HOURS_DEFERRED'
      : 'TEAM_CONFIRMATIONS_STOPPED', recipientCount: 6, acceptedCount, deliveredCount, effectStarted, replay: false };
  }
}

async function main() {
  const args = process.argv.slice(2), { apply, expected } = confirmationArguments(args);
  const git = a => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (apply) { assertConfirmationSource(git, expected); assertMemberDispatchAllowed(); }
  assert(!process.env.FIRESTORE_EMULATOR_HOST, 'PRODUCTION_EMULATOR_CONFLICT');
  const require = createRequire(new URL('../firebase/kangsain-functions/functions/package.json', import.meta.url));
  const admin = require('firebase-admin');
  const credentials = JSON.parse(await fs.readFile('/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json', 'utf8'));
  assert(credentials.project_id === 'archive-pilates' && credentials.client_email === 'archive-codex-operator@archive-pilates.iam.gserviceaccount.com');
  const app = admin.initializeApp({ credential: admin.credential.cert(credentials), projectId: 'archive-pilates' }, 'team-confirmations-' + Date.now());
  let context, release;
  try {
    const { acquireStudioMateBrowserLock } = await import('./lib/studiomate-browser-lock.mjs');
    const { captureStudioMateNativeApiClient, readExactStudioMateMember, readStudioMateUserTickets } = await import('./lib/studiomate-native-contract-source.mjs');
    const { makeLessonVideoSolapiRequest } = await import('./lib/lesson-video-notice-solapi.mjs');
    const runtimeRequire = createRequire('/Users/archivepilates/dev/archive-in-runtime/package.json');
    let page;
    const readNative = async (phone, memberId) => {
      if (!page) {
        release = await acquireStudioMateBrowserLock({ owner: 'approved-team-confirmations-261120', waitMs: 120000 });
        context = await runtimeRequire('playwright').chromium.launchPersistentContext('/Users/archivepilates/ArchiveIN/automation/browser-profile', { headless: true });
        page = await context.newPage();
        await page.route('**/*', r => !['GET', 'HEAD', 'OPTIONS'].includes(r.request().method()) ? r.abort() : r.continue());
      }
      return readFreshTeamNative({ page, phone, memberId, capture: captureStudioMateNativeApiClient,
        readMember: readExactStudioMateMember, readTickets: readStudioMateUserTickets });
    };
    let d1Proof;
    try { d1Proof = JSON.parse(await fs.readFile(path.join(TEAM_DIRECTORY, 'team-261120-confirmation-d1-proof.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const result = await runTeamConfirmations({ args, db: app.firestore(), request: makeLessonVideoSolapiRequest(), readNative,
      git, d1Proof, timestamp: () => admin.firestore.FieldValue.serverTimestamp() });
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
  } finally {
    try { await context?.close(); }
    finally { try { await release?.(); } finally { await app.delete(); } }
  }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => { console.error(JSON.stringify({ ok: false, reason: 'TEAM_261120_CONFIRMATIONS_STOPPED', replay: false })); process.exitCode = 1; });
}
