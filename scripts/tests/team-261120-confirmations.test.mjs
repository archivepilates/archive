import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { TEAM_EVENT, TEAM_CALENDAR_DIR } from '../build-team-261120-calendar.mjs';
import { TEAM_IDS, assertTeamLectures } from '../lib/team-261120-scope.mjs';
import { TEMPLATE, CHANNEL, MANAGEMENT, APPROVAL, stableHash, assertRegistration,
  confirmationVariables, confirmationKey, confirmationSendId, isConfirmationHistory, receiptMessageId,
  renderedText, verifyProviderMessage, templateHash, approvalFor, d1PromiseVerified } from '../lib/team-261120-confirmation.mjs';
import { confirmationArguments, assertConfirmationSource, verifyCalendar, providerHistory, readFreshTeamNative, runTeamConfirmations } from '../send-team-261120-confirmations.mjs';

const COMMIT = 'a'.repeat(40);
const START = Date.parse('2026-10-29T03:00:00Z');
const clone = structuredClone;
const valueAt = (row, field) => field.split('.').reduce((o, k) => o?.[k], row);
function patch(row, values) {
  for (const [field, value] of Object.entries(values)) {
    const parts = field.split('.'); let parent = row;
    for (const k of parts.slice(0, -1)) parent = parent[k] ||= {};
    parent[parts.at(-1)] = clone(value);
  }
}
function template() {
  return { templateId: TEMPLATE, channelId: CHANNEL, status: 'APPROVED', messageType: 'BA', emphasizeType: 'IMAGE',
    imageId: 'ST01FZ260825101204154cOImfLX8Ri7',
    content: '#{이름}님,\n\n아카이브 강사 레슨\n예약이 확정되었어요.\n\n[일정]\n#{수업일} #{수업시간}\n\n[수업 구성]\n#{수업구성}\n두 세션 모두 수강해요.\n\n[장소]\n아카이브필라테스 명지\n\n수업 배정과 큐카드는\n수업 D-1 알림톡으로 \n다시 안내해 드릴게요.',
    buttons: [
      { buttonType: 'WL', buttonName: '캘린더에 일정 추가', linkMo: 'https://in.archivepilates.com/method/#{관리번호}/calendar/', linkPc: 'https://in.archivepilates.com/method/#{관리번호}/calendar/' },
      { buttonType: 'WL', buttonName: '방문안내 보기', linkMo: 'https://archivepilates.notion.site/visitin', linkPc: 'https://archivepilates.notion.site/visitin' },
    ] };
}
function lectures() {
  const data = [
    { id: 98900618, start_on: '2026-11-20 14:00:00', end_on: '2026-11-20 14:50:00', staff: { id: 1983525 }, room: { name: '체어' } },
    { id: 98900887, start_on: '2026-11-20 15:00:00', end_on: '2026-11-20 15:50:00', staff: { id: 2222464 }, room: { name: '바렐' } },
  ].map(r => ({ ...r, max_trainee: 6, title: '강사레슨(team)', description: 'native description is NOT the operator-approved topic',
    course: { active: true, studio_id: 5330, instructor_id: r.staff.id, type: 'G', deleted_at: null } }));
  return { data, meta: { current_page: 1, last_page: 1, total: 2 } };
}
function identity(index = 0) {
  const phone = `0109000000${index}`, memberId = String(9000001 + index), ticketId = String(9100001 + index);
  const r = { registrationId: TEAM_IDS[index], studioId: '5330', courseKind: 'team', ticketName: 'Team 강사레슨',
    mode: 'team_intake', lessonDate: '2026-11-20', lessonTime: '14:00', lessonTopic: 'ARCHIVE METHOD #1 직장인 증후군',
    paymentAmount: 80000, paymentMethod: 'wiretransfer', memberName: `테스트${String.fromCharCode(65 + index)}`,
    memberPhone: phone, studiomateMemberId: memberId, status: 'waiting_signature',
    source: { type: 'archive_core_operator' }, steps: { member: { status: 'verified' }, ticket: { status: 'verified' },
      eformsign: { status: 'sent' }, confirmation: { status: 'pending' } },
    evidence: { studiomateMemberId: memberId, studiomateUserTicketId: ticketId, studiomateTicketId: ticketId } };
  const member = { status: 'verified', member: { memberId, name: r.memberName, phone, inactive: false, memberGrade: '강사회원' } };
  const tickets = { status: 'verified', reason: 'complete_native_ticket_list', tickets: [{
    memberId, studioId: '5330', userTicketId: ticketId, productId: '468880', title: 'Team 강사레슨', type: 'T',
    availableClassType: 'G', availabilityStartAt: '2026-11-20', expireAt: '2026-11-20', verified: true, complete: true,
    active: true, usable: true, cancelled: false, refunded: false, isShared: false, maxCoupon: 2,
    payment: { verified: true, complete: true, status: 'paid', totalAmount: 80000, paidAmount: 80000,
      outstandingAmount: 0, refundedAmount: 0, transactions: [{ method: 'bank_transfer', status: 'paid', amount: 80000 }] },
  }] };
  return { r, native: { member, tickets, lectures: lectures() }, phone, memberId, ticketId,
    key: confirmationKey(memberId, phone), sendId: confirmationSendId(memberId, phone) };
}
// This maps synthetic phones to the immutable six allowed IDs only inside tests. Production
// uses instructorLessonRegistrationId and exposes no CLI/environment identity override.
const syntheticRegistrationId = (studio, phone, date) => {
  assert.equal(studio, '5330'); assert.equal(date, TEAM_EVENT.date);
  return TEAM_IDS[Number(phone.at(-1))];
};
function proof(now = START, t = template()) {
  return { status: 'verified', reviewedBy: 'main_current_chat', scope: 'existing_template_d1_promise',
    managementNumber: MANAGEMENT, lessonDate: TEAM_EVENT.date, templateId: TEMPLATE, channelId: CHANNEL,
    templateHash: templateHash(t), approvalHash: stableHash(approvalFor(t)), evidenceRef: 'canonical-operator-review/synthetic-d1',
    checkedAt: new Date(now).toISOString() };
}

function fixture(options = {}) {
  const people = Array.from({ length: 6 }, (_, i) => identity(i));
  const store = new Map(people.map(p => ['instructorLessonRegistrations/' + p.r.registrationId, clone(p.r)]));
  const calls = [], writes = [], requests = [], records = [];
  let now = START, txCount = 0, activePost, nativeCount = 0;
  const snap = ref => ({ id: ref.path.split('/').at(-1), ref, exists: store.has(ref.path), data: () => clone(store.get(ref.path)) });
  const db = {
    doc: path => ({ path, get: async () => { calls.push({ read: path }); return snap(db.doc(path)); } }),
    collection: name => {
      const q = { collection: name, filters: [], count: Infinity,
        where(field, op, value) { assert.equal(op, '=='); return { ...q, filters: [...q.filters, [field, value]], where: q.where, limit: q.limit, get: q.get }; },
        limit(count) { return { ...q, count, filters: this.filters, get: q.get }; },
        async get() {
          const docs = [...store].filter(([p, row]) => p.startsWith(name + '/') && !p.slice(name.length + 1).includes('/')
            && this.filters.every(([field, value]) => valueAt(row, field) === value)).slice(0, this.count)
            .map(([p]) => snap(db.doc(p)));
          return { docs, size: docs.length, empty: !docs.length };
        } };
      return q;
    },
    async runTransaction(fn) {
      txCount++;
      await options.beforeTransaction?.({ txCount, store, people, setNow: n => { now = n; } });
      const pending = []; let wrote = false;
      const tx = { async get(ref) { assert(!wrote, 'all transaction reads precede writes'); return ref.get(); },
        create(ref, data) { assert(!store.has(ref.path)); wrote = true; pending.push({ operation: 'create', path: ref.path, data: clone(data) }); },
        update(ref, data) { assert(store.has(ref.path)); wrote = true; pending.push({ operation: 'update', path: ref.path, data: clone(data) }); } };
      const result = await fn(tx);
      for (const write of pending) {
        if (write.operation === 'create') store.set(write.path, write.data);
        else patch(store.get(write.path), write.data);
        writes.push(clone(write));
      }
      await options.afterTransaction?.({ txCount, store, people, setNow: n => { now = n; } });
      return result;
    },
  };
  const request = async (resource, method = 'GET', body) => {
    requests.push({ resource, method, body: clone(body) });
    assert(['GET', 'POST'].includes(method));
    if (resource.startsWith('/kakao/')) return options.template || template();
    if (method === 'POST') {
      assert.equal(resource, '/messages/v4/send-many/detail');
      assert.equal(body.messages.length, 1);
      assert.equal(body.strict, true); assert.equal(body.allowDuplicates, false); assert.equal(body.showMessageList, true);
      const message = body.messages[0], p = people.find(p => p.phone === message.to);
      assert(p && message.kakaoOptions.disableSms === true);
      assert.equal(store.get('alimtalkCandidates/' + p.key).status, 'reviewed');
      assert.equal(store.get('alimtalkCandidates/' + p.key).attempts, 1);
      assert.equal(store.get('instructorLessonRegistrations/' + p.r.registrationId).externalEffectStarted, true);
      activePost = { ...message, messageId: 'MSYNTHETIC' + records.length,
        text: renderedText(template(), message.kakaoOptions.variables), dateCreated: new Date(now).toISOString(),
        status: options.providerStatus || 'COMPLETE', statusCode: options.providerCode || '4000' };
      if (options.transportUnknown) throw Error('unknown synthetic outcome');
      records.push(activePost);
      return { messageList: [{ messageId: activePost.messageId, to: p.phone, kakaoOptions: { templateId: TEMPLATE } }] };
    }
    assert(resource.startsWith('/messages/v4/list?'));
    const params = new URL(resource, 'https://offline.invalid').searchParams;
    assert.equal(params.has('type'), false, 'all channels included');
    assert.equal(params.get('startDate'), '1970-01-01T00:00:00Z');
    const phone = params.get('to'), p = people.find(p => p.phone === phone);
    if (activePost?.to === phone) {
      const c = store.get('alimtalkCandidates/' + p.key), s = store.get('alimtalkSends/' + p.sendId);
      assert.equal(c?.solapiMessageId, activePost.messageId, 'message ID persisted before provider GET');
      assert.equal(s?.solapiMessageId, activePost.messageId);
      assert.equal(c.providerOutcome, 'accepted');
      assert.equal(store.get('instructorLessonRegistrations/' + p.r.registrationId).steps.confirmation.status, 'sent');
      if (options.readbackUnknown) throw Error('synthetic readback unavailable');
    }
    const rows = records.filter(m => m.to === phone).map(row => clone(row));
    if (options.priorProvider && !activePost) rows.push({ messageId: 'MPRIOR', to: phone, type: 'SMS',
      text: '강사 레슨 예약확정 · 날짜 확인필요', status: 'UNKNOWN', ...options.priorProvider });
    if (options.tamperProvider && activePost?.to === phone) options.tamperProvider(rows[0]);
    return { messageList: Object.fromEntries(rows.map(r => [r.messageId, r])) };
  };
  const fetcher = async url => {
    assert(url.startsWith(TEAM_EVENT.url));
    const filename = url.endsWith('.ics') ? TEAM_EVENT.icsName : 'index.html';
    const bytes = await fs.readFile(path.join(TEAM_CALENDAR_DIR, filename));
    return new Response(options.badCalendar ? 'different bytes' : bytes,
      { headers: { 'Content-Type': filename.endsWith('.ics') ? 'text/calendar' : 'text/html' } });
  };
  const gitCalls = [];
  const git = a => {
    gitCalls.push(a);
    if (a.join(' ') === 'rev-parse HEAD') return COMMIT;
    if (a.join(' ') === 'status --porcelain') return options.dirty ? '?? private-file' : '';
    if (a[0] === 'ls-files') { assert(a.includes('--error-unmatch')); if (options.untracked) throw Error('untracked'); return ''; }
    throw Error('unexpected git call');
  };
  const run = (apply = true, extra = {}) => runTeamConfirmations({ db, request, fetcher, git,
    readNative: async (phone, memberId) => {
      nativeCount++;
      const p = people.find(p => p.phone === phone); assert.equal(p.memberId, memberId);
      const result = clone(p.native); options.changeNative?.(result, { nativeCount }); return result;
    },
    clock: () => now, timestamp: () => new Date(now), registrationIdFor: syntheticRegistrationId,
    args: apply ? ['--apply', '--expected-commit=' + COMMIT] : [], d1Proof: options.noD1 ? undefined : proof(), ...extra });
  return { people, store, calls, writes, requests, records, run, fetcher, gitCalls, setNow: n => { now = n; } };
}

test('immutable authorization is exactly the six canonical IDs and approved composition', () => {
  assert.deepEqual(APPROVAL.registrationIds, TEAM_IDS);
  assert.equal(APPROVAL.source, 'human_current_chat');
  assert.equal(APPROVAL.composition, 'ARCHIVE METHOD #1 직장인 증후군\n민진쌤 체어\n은영쌤 바렐');
  assert.doesNotMatch(APPROVAL.composition, /블럭|스틱|리포머/);
  assert(Object.isFrozen(APPROVAL) && Object.isFrozen(APPROVAL.registrationIds));
});

test('canonical identity formula is enforced by default, with no runtime CLI override', () => {
  const p = identity();
  assert.throws(() => assertRegistration(p.r.registrationId, p.r), /CANONICAL_REGISTRATION_REQUIRED/);
  assertRegistration(p.r.registrationId, p.r, syntheticRegistrationId);
  assert.throws(() => confirmationArguments(['--registration-id-override=x']));
});

test('family stable keys are date/management scoped and not random or registration-version scoped', () => {
  const p = identity();
  assert.equal(p.key, 'instructor_lesson_confirmation_' + stableHash({ phone: p.phone, lessonDate: '2026-11-20',
    managementNumber: 'team-261120', templateCode: TEMPLATE }).slice(0, 24));
  assert.equal(p.sendId, stableHash({ studioId: '5330', memberPhone: p.phone, type: 'instructor_lesson_confirmation',
    templateCode: TEMPLATE, scope: { lessonDate: '2026-11-20', managementNumber: 'team-261120' } }));
});

test('sent or verified eformsign permits confirmation without an actual signature; native description is not the topic', () => {
  for (const stage of ['sent', 'verified']) {
    const p = identity(); p.r.steps.eformsign.status = stage;
    const v = confirmationVariables(p.r.registrationId, p.r, p.native.member, p.native.tickets, p.native.lectures, syntheticRegistrationId);
    assert.equal(v['#{수업일}'], '2026년 11월 20일(금)'); assert.equal(v['#{수업시간}'], '14:00~15:50');
    assert.equal(v['#{수업구성}'], APPROVAL.composition); assert.equal(v['#{관리번호}'], MANAGEMENT);
  }
});

for (const [label, change] of Object.entries({
  noNativeId: p => { delete p.r.studiomateMemberId; }, wrongMember: p => { p.native.member.member.memberId = 'other'; },
  wrongName: p => { p.native.member.member.name = '다른사람'; }, wrongPhone: p => { p.native.member.member.phone = '01090000111'; },
  inactive: p => { p.native.member.member.inactive = true; }, trialGrade: p => { p.native.member.member.memberGrade = '체험회원'; },
  noTicket: p => { p.native.tickets.tickets = []; }, duplicateTicket: p => { p.native.tickets.tickets.push(clone(p.native.tickets.tickets[0])); },
  wrongTicketId: p => { p.native.tickets.tickets[0].userTicketId = 'wrong'; }, incompleteTickets: p => { p.native.tickets.status = 'review'; },
  refunded: p => { p.native.tickets.tickets[0].refunded = true; }, unpaid: p => { p.native.tickets.tickets[0].payment.outstandingAmount = 80000; },
  wrongMethod: p => { p.native.tickets.tickets[0].payment.transactions[0].method = 'card'; },
  cancellation: p => { p.r.cancellation = {}; }, pendingEform: p => { p.r.steps.eformsign.status = 'pending'; },
  staleMirror: p => { p.r.source = { path: 'workLanes/provisional/inputs/source' }; },
  wrongLecture: p => { p.native.lectures.data[0].id = 999; }, incompleteLectures: p => { p.native.lectures.meta.last_page = 2; },
  wrongTopic: p => { p.r.lessonTopic = 'native description'; }, wrongTicketBinding: p => { p.r.evidence.studiomateTicketId = 'wrong'; },
})) test('source guard rejects ' + label, () => {
  const p = identity(); change(p);
  assert.throws(() => confirmationVariables(p.r.registrationId, p.r, p.native.member, p.native.tickets, p.native.lectures, syntheticRegistrationId));
});

test('prior same-date, contradictory and undated all-channel confirmations block unknown outcomes too', () => {
  for (const row of [{ templateCode: TEMPLATE }, { type: 'instructor_lesson_confirmation', status: 'unknown' },
    { text: '강사 레슨 예약이 확정되었어요.' }, { text: '강사레슨 예약확정 11/20' },
    { type: 'SMS', text: '강사 레슨 예약확정 2026년 11월 20일' }, { payload: { lessonDate: '2026-11-20' } },
    { templateCode: TEMPLATE, payload: { lessonDate: '2026-11-21' }, text: '2026-11-20' },
    { templateCode: TEMPLATE, payload: { lessonDate: {} } }]) assert(isConfirmationHistory(row));
  assert(!isConfirmationHistory({ templateCode: TEMPLATE, payload: { lessonDate: '2026-11-21' } }));
  assert(!isConfirmationHistory({ text: '자료 안내 2026-10-01' }));
});

test('provider GET exhausts pagination across all channels and fails on repeated cursors', async () => {
  const calls = [];
  const rows = await providerHistory(async (url, method) => {
    const q = new URL(url, 'https://offline.invalid').searchParams; calls.push(q);
    assert.equal(method, 'GET'); assert(!q.has('type'));
    return q.has('nextKey') ? { messageList: { M2: { messageId: 'M2', to: '01090000000', type: 'SMS' } } }
      : { messageList: { M1: { messageId: 'M1', to: '01090000000', type: 'ATA' } }, nextKey: 'cursor' };
  }, '01090000000', START);
  assert.equal(rows.length, 2); assert.equal(calls[1].get('nextKey'), 'cursor');
  await assert.rejects(providerHistory(async () => ({ messageList: {}, nextKey: 'same' }), '01090000000', START));
  await assert.rejects(providerHistory(async () => ({}), '01090000000', START));
});

test('D-1 gate binds existing-template review to current approval, content and source evidence, not a new workflow', () => {
  assert(d1PromiseVerified(proof(), template(), START));
  for (const p of [undefined, { ...proof(), templateHash: 'stale' }, { ...proof(), approvalHash: 'stale' },
    { ...proof(), evidenceRef: 'workLanes/provisional' }, { ...proof(), checkedAt: new Date(START - 86400000).toISOString() },
    { ...proof(), checkedAt: new Date(START + 1).toISOString() }]) assert(!d1PromiseVerified(p, template(), START));
});

test('strict args and clean tracked expected commit guard reject unsafe apply before I/O', () => {
  assert.deepEqual(confirmationArguments([]), { apply: false, expected: undefined });
  for (const args of [['--apply'], ['--apply', '--expected-commit=short'], ['--expected-commit=' + COMMIT],
    ['--apply', '--apply'], ['--apply', '--expected-commit=' + COMMIT, '--force']]) assert.throws(() => confirmationArguments(args));
  assert.throws(() => assertConfirmationSource(a => a[0] === 'rev-parse' ? COMMIT : 'dirty', COMMIT));
});

test('calendar verifies exact built HTML and ICS bytes without a live fetch', async () => {
  const f = fixture(); await verifyCalendar(f.fetcher);
  await assert.rejects(verifyCalendar(fixture({ badCalendar: true }).fetcher));
});

test('plan performs no writes and surfaces missing D-1 review without authorizing a send', async () => {
  const f = fixture({ noD1: true }), result = await f.run(false);
  assert.equal(result.recipientCount, 6); assert.equal(result.sendReady, false);
  assert.deepEqual(result.gates, ['D1_PROMISE_MAIN_REVIEW_REQUIRED']);
  assert.deepEqual(f.writes, []); assert(f.requests.every(r => r.method === 'GET'));
  assert.doesNotMatch(JSON.stringify(result), /010|테스트|memberPhone|ticketId/);
});

test('apply refuses missing D-1 proof and dirty/untracked sources before any claim or POST', async () => {
  for (const options of [{ noD1: true }, { dirty: true }, { untracked: true }]) {
    const f = fixture(options); await assert.rejects(f.run());
    assert.deepEqual(f.writes, []); assert(f.requests.every(r => r.method === 'GET'));
  }
});

test('six exact registration-linked sends keep candidates outside the worker; persist IDs before GET and verify delivery', async () => {
  const f = fixture(), result = await f.run();
  assert.deepEqual(result, { ok: true, mode: 'apply', recipientCount: 6, acceptedCount: 6, deliveredCount: 6, replay: false });
  assert.equal(f.requests.filter(r => r.method === 'POST').length, 6);
  for (const p of f.people) {
    const c = f.store.get('alimtalkCandidates/' + p.key), s = f.store.get('alimtalkSends/' + p.sendId);
    const r = f.store.get('instructorLessonRegistrations/' + p.r.registrationId);
    assert(c.manualDispatchOnly && c.maxAttempts === 1 && c.attempts === 1);
    assert.equal(c.payload.registrationId, p.r.registrationId); assert.equal(c.payload.sourceTicketId, p.ticketId);
    assert.equal(c.approval.source, 'human_current_chat'); assert.deepEqual(c.approval.registrationIds, TEAM_IDS);
    assert.equal(c.source.type, 'instructorLessonRegistrations');
    assert.equal(c.deliveryStatus, 'delivered'); assert.equal(s.status, 'done');
    assert.equal(r.steps.eformsign.status, 'sent'); assert.equal(r.steps.confirmation.status, 'verified');
    assert.equal(r.externalEffectStarted, false);
  }
  assert(!f.writes.some(w => w.path.startsWith('alimtalkCandidates/') && ['queued', 'processing'].includes(w.data.status)));
  const writeCount = f.writes.length, postCount = f.records.length;
  const second = await f.run(); assert.equal(second.mode, 'read_only'); assert.equal(second.replay, false);
  assert.equal(f.writes.length, writeCount); assert.equal(f.records.length, postCount);
  assert.doesNotMatch(JSON.stringify(result), /010|테스트|memberPhone|MSYNTHETIC|ticketId/);
});

test('provider acceptance is distinct from COMPLETE/4000 delivery', async () => {
  const f = fixture({ providerStatus: 'SENDING', providerCode: '2000' }), result = await f.run();
  assert.equal(result.acceptedCount, 6); assert.equal(result.deliveredCount, 0);
  assert.equal(f.store.get('alimtalkSends/' + f.people[0].sendId).status, 'accepted');
  assert.equal(f.store.get('instructorLessonRegistrations/' + TEAM_IDS[0]).steps.confirmation.status, 'sent');
});

test('any prior durable claim exits read-only without template, browser/native or provider calls', async () => {
  const f = fixture(); f.store.set('alimtalkSends/' + f.people[4].sendId, { status: 'review_required' });
  const result = await f.run(); assert.equal(result.reason, 'PRIOR_CLAIM_RECONCILE_ONLY');
  assert.deepEqual(f.requests, []); assert.deepEqual(f.writes, []);
});

for (const [label, change] of Object.entries({
  duplicateRegistration: f => { const p = f.people[0]; f.store.set('instructorLessonRegistrations/extra', clone(p.r)); },
  cancellationQueue: f => { const p = f.people[0]; f.store.set('studiomateInstructorLessonCancellations/cancel', { registrationId: p.r.registrationId }); },
  priorUnknownByPhone: f => { const p = f.people[0]; f.store.set('alimtalkCandidates/prior', { memberPhone: p.phone, templateCode: TEMPLATE, status: 'unknown' }); },
  priorUnknownByMember: f => { const p = f.people[0]; f.store.set('alimtalkSends/prior', { memberId: p.memberId, type: 'instructor_lesson_confirmation', status: 'unknown' }); },
  linkedParent: f => { const p = f.people[0]; f.store.set('alimtalkSends/prior', { memberPhone: p.phone, candidateId: 'parent' });
    f.store.set('alimtalkCandidates/parent', { templateCode: TEMPLATE }); },
  linkedChild: f => { const p = f.people[0]; f.store.set('alimtalkCandidates/parent', { memberId: p.memberId, payload: { lessonDate: '2026-11-20' } });
    f.store.set('alimtalkSends/child', { candidateId: 'parent' }); },
})) test('canonical preflight blocks ' + label + ' without writes', async () => {
  const f = fixture(); change(f); await assert.rejects(f.run());
  assert.deepEqual(f.writes, []); assert(!f.requests.some(r => r.method === 'POST'));
});

test('prior undated SMS at provider blocks all six before first claim', async () => {
  const f = fixture({ priorProvider: {} }); await assert.rejects(f.run());
  assert.deepEqual(f.writes, []); assert.equal(f.records.length, 0);
});

for (const [label, change] of Object.entries({
  cancellation: ({ store, people }) => { store.get('instructorLessonRegistrations/' + people[0].r.registrationId).cancellation = {}; },
  sourceTicket: ({ store, people }) => { store.get('instructorLessonRegistrations/' + people[0].r.registrationId).evidence.studiomateUserTicketId = 'other'; },
  duplicate: ({ store, people }) => { store.set('alimtalkSends/race', { memberPhone: people[0].phone, templateCode: TEMPLATE }); },
  ownParentUnknownChild: ({ store, people }) => { store.set('alimtalkSends/race', { candidateId: people[0].key }); },
  approval: ({ store, people }) => { store.get('alimtalkCandidates/' + people[0].key).approval.source = 'not_current_chat'; },
})) test('second transaction rechecks ' + label + ' before provider effect', async () => {
  const f = fixture({ beforeTransaction: state => { if (state.txCount === 2) change(state); } });
  const result = await f.run(); assert.equal(result.ok, false); assert.equal(f.records.length, 0);
  assert(!f.requests.some(r => r.method === 'POST'));
});

test('quiet-hour crossing immediately after final transaction defers without a provider attempt', async () => {
  const f = fixture({ afterTransaction: ({ txCount, setNow }) => { if (txCount === 2) setNow(Date.parse('2026-10-29T14:00:00Z')); } });
  // Start just before 23:00 KST; crossing the boundary is inside the same two-minute source budget.
  f.setNow(Date.parse('2026-10-29T13:59:59Z'));
  const result = await f.run(); assert.equal(result.reason, 'QUIET_HOURS_DEFERRED'); assert.equal(result.effectStarted, false);
  assert(!f.requests.some(r => r.method === 'POST'));
  const c = f.store.get('alimtalkCandidates/' + f.people[0].key);
  assert.equal(c.attempts, 0); assert.equal(c.reasonCode, 'quiet_hours_deferred');
  assert.equal(f.store.get('instructorLessonRegistrations/' + TEAM_IDS[0]).externalEffectStarted, false);
});

test('two-minute native source expiry after final transaction prevents POST', async () => {
  const f = fixture({ afterTransaction: ({ txCount, setNow }) => { if (txCount === 2) setNow(START + 120000); } });
  const result = await f.run(); assert.equal(result.ok, false); assert.equal(result.effectStarted, false);
  assert(!f.requests.some(r => r.method === 'POST'));
});

test('unknown POST retains a no-replay claim and cancellation guard; no retry in this or subsequent runs', async () => {
  const f = fixture({ transportUnknown: true }), result = await f.run();
  assert.equal(result.effectStarted, true); assert.equal(result.acceptedCount, 0);
  assert.equal(f.requests.filter(r => r.method === 'POST').length, 1);
  assert.equal(f.store.get('alimtalkSends/' + f.people[0].sendId).providerOutcome, 'unknown');
  assert.equal(f.store.get('instructorLessonRegistrations/' + TEAM_IDS[0]).externalEffectStarted, true);
  const writes = f.writes.length; const rerun = await f.run(); assert.equal(rerun.mode, 'read_only');
  assert.equal(f.writes.length, writes); assert.equal(f.requests.filter(r => r.method === 'POST').length, 1);
});

test('provider readback failure retains accepted message ID and never calls it delivery or resends', async () => {
  const f = fixture({ readbackUnknown: true }), result = await f.run();
  assert.equal(result.acceptedCount, 1); assert.equal(result.deliveredCount, 0);
  const c = f.store.get('alimtalkCandidates/' + f.people[0].key);
  assert(c.solapiMessageId); assert.equal(c.providerOutcome, 'accepted'); assert.equal(c.deliveryStatus, 'unverified');
  assert.equal((await f.run()).mode, 'read_only');
  assert.equal(f.requests.filter(r => r.method === 'POST').length, 1);
});

for (const [label, tamperProvider] of Object.entries({
  id: row => { row.messageId = 'MOTHER'; }, to: row => { row.to = '01090000111'; },
  text: row => { row.text += 'changed'; }, template: row => { row.kakaoOptions.templateId = 'other'; },
  channel: row => { row.kakaoOptions.pfId = 'other'; }, customFields: row => { row.customFields.registrationId = 'other'; },
})) test('exact provider readback rejects wrong ' + label + ' without replay', async () => {
  const f = fixture({ tamperProvider }), result = await f.run();
  assert.equal(result.ok, false); assert.equal(result.acceptedCount, 1); assert.equal(result.deliveredCount, 0);
  assert.equal(f.requests.filter(r => r.method === 'POST').length, 1);
});

test('receipt parser handles maps and arrays but rejects ambiguous/failing identities', () => {
  const row = { messageId: 'MSYNTHETIC', to: '01090000000' };
  assert.equal(receiptMessageId({ messageList: [row] }, row.to), row.messageId);
  assert.equal(receiptMessageId({ messageList: { x: row } }, row.to), row.messageId);
  for (const result of [{ messageList: [row, row] }, { messageList: [row], failedMessageList: [{ error: true }] },
    { messageList: [{ ...row, to: '01090000111' }] }, { messageList: [{ ...row, kakaoOptions: { templateId: 'other' } }] }]) {
    assert.throws(() => receiptMessageId(result, row.to));
  }
});

test('no live-read or write APIs are called by importing sender/helper; tests cover only fake adapters', () => {
  assert.equal(typeof runTeamConfirmations, 'function');
  assert.equal(typeof verifyProviderMessage, 'function');
  assertTeamLectures(lectures());
});

test('each native read recaptures GET headers on the same page, with no cached client between members/effects', async () => {
  const page = { synthetic: true }, seen = []; let captures = 0;
  const deps = { page, capture: async p => {
    assert.equal(p, page); const id = ++captures;
    return { id, get: async url => { seen.push(['lectures', id, url]); return lectures(); } };
  }, readMember: async (api, phone) => { seen.push(['member', api.id, phone]); return { status: 'verified' }; },
  readTickets: async (api, id) => { seen.push(['tickets', api.id, id]); return { status: 'verified' }; } };
  for (let i = 0; i < 12; i++) {
    await readFreshTeamNative({ ...deps, phone: identity(i % 6).phone, memberId: identity(i % 6).memberId });
  }
  assert.equal(captures, 12);
  for (let i = 0; i < 12; i++) assert.deepEqual(seen.slice(i * 3, i * 3 + 3).map(row => row[1]), [i + 1, i + 1, i + 1]);
});

test('native 403 stops that read without retry, recapture, ticket query or fallback source', async () => {
  let captures = 0, tickets = 0, lectureReads = 0;
  await assert.rejects(readFreshTeamNative({ page: {}, phone: identity().phone, memberId: identity().memberId,
    capture: async () => { captures++; return { get: async () => { lectureReads++; } }; },
    readMember: async () => { throw Object.assign(Error('synthetic auth failure'), { status: 403 }); },
    readTickets: async () => { tickets++; },
  }));
  assert.equal(captures, 1); assert.equal(tickets, 0); assert.equal(lectureReads, 0);
});

test('COMPLETE without 4000 is not delivered and stops further recipients without resending', async () => {
  const f = fixture({ providerStatus: 'COMPLETE', providerCode: '3000' }), result = await f.run();
  assert.equal(result.reason, 'DELIVERY_FAILED_RECONCILE_ONLY');
  assert.equal(result.acceptedCount, 1); assert.equal(result.deliveredCount, 0);
  assert.equal(f.requests.filter(r => r.method === 'POST').length, 1);
});
