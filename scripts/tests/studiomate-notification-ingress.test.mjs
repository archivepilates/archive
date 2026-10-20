import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NOTIFICATION_INGRESS_VERSION, NOTIFICATION_POLL_MS, NOTIFICATION_REFRESH_MS,
  notificationHint, observeNotificationHints, planNotificationRefresh,
  enqueueNotificationRefresh, acknowledgeNotificationRefresh, preserveNotificationContactPlans,
} from '../lib/studiomate-notification-ingress.mjs';
import { acquireStudioMateSyncRun } from '../lib/studiomate-sync-run-lock.mjs';

const NOW = Date.UTC(2026, 9, 20, 3);
const hint = (title = '예약', body = 'synthetic booking A') => notificationHint({ title, body });
const BASE = hint('수강권 등록', 'synthetic baseline');
const BOOKING = hint();
const CANCEL = hint('예약 취소', 'synthetic booking A');
const SIGNATURE = hint('서명완료', 'synthetic contract A');
const baseline = () => observeNotificationHints(null, [BASE], NOW).state;
const pendingState = () => observeNotificationHints(baseline(), [BOOKING, BASE], NOW + 1).state;
const clone = value => JSON.parse(JSON.stringify(value));

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

// Only in-memory Firestore-shaped objects; no SDK, credentials, files, or network.
function fakeDb({ query = false, collision = null } = {}) {
  const docs = new Map(), reads = [], creates = [], sets = [], queries = [];
  let attempts = 0, injected = false;
  const snapshot = (path, data) => ({
    id: path.split('/').at(-1), ref: { path }, exists: data !== undefined,
    data: () => data === undefined ? undefined : structuredClone(data),
  });
  const db = {
    docs, reads, creates, sets, queries,
    get attempts() { return attempts; },
    doc(path) {
      assert.match(path, /^adminSyncRequests\/[^/]+$/);
      return { path };
    },
    async runTransaction(run) {
      // Simulate a create-precondition collision followed by Firestore's retry.
      for (let retry = 0; retry < 2; retry++) {
        attempts++;
        const staged = [];
        const result = await run({
          async get(ref) {
            if (ref.type === 'query') {
              queries.push(structuredClone(ref));
              return { docs: [...docs].filter(([path, data]) =>
                path.startsWith(`${ref.collection}/`) && ref.filters.every(([field, , value]) => data[field] === value))
                .slice(0, ref.count).map(([path, data]) => snapshot(path, data)) };
            }
            reads.push(ref.path);
            return snapshot(ref.path, docs.get(ref.path));
          },
          create(ref, data) { staged.push({ type: 'create', ref, data: structuredClone(data) }); },
          set(ref, data, options) {
            assert.deepEqual(options, { merge: true });
            staged.push({ type: 'set', ref, data: structuredClone(data) });
          },
        });
        if (collision && !injected && staged.some(write => write.type === 'create')) {
          injected = true;
          const write = staged.find(write => write.type === 'create');
          docs.set(write.ref.path, structuredClone(collision));
        }
        if (staged.some(write => write.type === 'create' && docs.has(write.ref.path))) continue;
        for (const write of staged) {
          if (write.type === 'create') {
            docs.set(write.ref.path, write.data);
            creates.push(write);
          } else {
            docs.set(write.ref.path, { ...docs.get(write.ref.path), ...write.data });
            sets.push(write);
          }
        }
        return result;
      }
      throw new Error('synthetic_transaction_retry_exhausted');
    },
  };
  if (query) {
    db.collection = name => {
      assert.equal(name, 'adminSyncRequests');
      return { where(field, operator, value) {
        assert.deepEqual([field, operator, value], ['status', '==', 'pending']);
        return { limit(count) { return { type: 'query', collection: name, filters: [[field, operator, value]], count }; } };
      } };
    };
  }
  return db;
}

test('first snapshot establishes a baseline without queuing historical hints', () => {
  const hints = freeze([BASE, BOOKING, CANCEL, SIGNATURE]);
  const result = observeNotificationHints(null, hints, NOW);
  assert.equal(result.baseline, true);
  assert.equal(result.received, 4);
  assert.equal(result.newHints, 0);
  assert.equal(result.actionable, 0);
  assert.deepEqual(result.kinds, []);
  assert.deepEqual(result.state.seen, hints.map(row => row.key));
  assert.deepEqual(result.state.pending, []);
  assert.equal(result.state.pendingSince, null);
  assert.equal(result.state.version, NOTIFICATION_INGRESS_VERSION);
  assert.equal(result.state.initializedAt, new Date(NOW).toISOString());
  assert.equal(result.state.nextPollAt, NOW + NOTIFICATION_POLL_MS);
  assert.equal(NOTIFICATION_POLL_MS, 120_000);
  assert.deepEqual(planNotificationRefresh(result.state, NOW), { status: 'idle' });
});

test('baseline and subsequent batches deduplicate repeated inputs without mutation', () => {
  const first = observeNotificationHints(null, [BASE, BASE], NOW);
  assert.equal(first.received, 1);
  const previous = freeze(first.state), before = clone(previous);
  const result = observeNotificationHints(previous, freeze([BOOKING, BOOKING, BASE, BASE]), NOW + 1);
  assert.equal(result.received, 2);
  assert.equal(result.newHints, 1);
  assert.equal(result.actionable, 1);
  assert.deepEqual(result.state.pending, [BOOKING.key]);
  assert.deepEqual(previous, before);
  const repeat = observeNotificationHints(freeze(result.state), [BOOKING, BOOKING, BASE, BASE], NOW + 2);
  assert.equal(repeat.newHints, 0);
  assert.equal(repeat.actionable, 0);
  assert.deepEqual(repeat.state.pending, [BOOKING.key]);
  assert.equal(repeat.state.pendingSince, NOW + 1);
});

test('display time and whitespace drift preserve the same hint key', () => {
  const first = notificationHint({ title: ' 예약 취소 ', body: ' synthetic\nbooking   A ', time: '방금 전' });
  const later = notificationHint({ title: '예약\t취소', body: 'synthetic booking\tA', time: '5분 전' });
  assert.deepEqual(first, CANCEL);
  assert.deepEqual(later, CANCEL);
  const state = observeNotificationHints(null, [first], NOW).state;
  const repeat = observeNotificationHints(state, [later], NOW + NOTIFICATION_POLL_MS);
  assert.equal(repeat.newHints, 0);
  assert.deepEqual(repeat.state.pending, []);
});

test('decomposed Korean text normalizes to the same title kind and content hash', () => {
  const title = '예약 취소', body = '합성 회원 예약 취소';
  const composed = notificationHint({ title, body });
  const decomposed = notificationHint({ title: title.normalize('NFD'), body: body.normalize('NFD') });
  assert.equal(decomposed.kind, 'reservation');
  assert.deepEqual(decomposed, composed);
});

test('new booking, cancellation, and signature each add a distinct pending hint', () => {
  const result = observeNotificationHints(baseline(), [BASE, BOOKING, CANCEL, SIGNATURE], NOW + 1);
  assert.equal(result.baseline, false);
  assert.equal(result.newHints, 3);
  assert.equal(result.actionable, 3);
  assert.deepEqual(result.kinds, ['reservation', 'contract']);
  assert.deepEqual(result.state.pending, [BOOKING.key, CANCEL.key, SIGNATURE.key]);
  assert.equal(result.state.pendingSince, NOW + 1);
  assert.equal(result.state.initializedAt, new Date(NOW).toISOString());
  assert.equal(new Set(result.state.pending).size, 3);
});

test('observed prepends distinguish booking, cancellation, and identical rebooking occurrences', () => {
  const booked = observeNotificationHints(baseline(), freeze([BOOKING, BASE]), NOW + 1);
  const cancelled = observeNotificationHints(freeze(booked.state), freeze([CANCEL, BOOKING, BASE]), NOW + 2);
  const previous = freeze(cancelled.state), before = clone(previous);
  const rebooking = notificationHint({ title: ' 예약 ', body: 'synthetic\nbooking   A', time: '방금 전' });
  assert.deepEqual(rebooking, BOOKING);
  const window = freeze([rebooking, CANCEL, BOOKING, BASE]);
  const rebooked = observeNotificationHints(previous, window, NOW + 3);
  for (const observation of [booked, cancelled, rebooked]) {
    assert.equal(observation.newHints, 1);
    assert.equal(observation.actionable, 1);
    assert.equal(observation.continuityLost, false);
    assert.deepEqual(observation.kinds, ['reservation']);
  }
  const occurrenceKey = rebooked.state.pending.find(key => !previous.pending.includes(key));
  assert.match(occurrenceKey, /^[a-f0-9]{64}$/);
  assert.notEqual(occurrenceKey, BOOKING.key);
  assert.notEqual(occurrenceKey, CANCEL.key);
  assert.deepEqual(rebooked.state.pending, [BOOKING.key, CANCEL.key, occurrenceKey]);
  assert.deepEqual(rebooked.state.window, window.map(row => row.key));
  assert.equal(rebooked.state.sequence, previous.sequence + 1);
  assert.deepEqual(new Set(rebooked.state.seen), new Set([BASE.key, BOOKING.key, CANCEL.key]));
  assert.deepEqual(previous, before);
  assert.deepEqual(window, [BOOKING, CANCEL, BOOKING, BASE]);
});

test('the same ordered window produces zero fresh hints after every JSON restart', () => {
  let state = baseline();
  const windows = [
    [BOOKING, BASE],
    [CANCEL, BOOKING, BASE],
    [BOOKING, CANCEL, BOOKING, BASE],
    [CANCEL, BOOKING, CANCEL, BOOKING, BASE],
    [BOOKING, CANCEL, BOOKING, CANCEL, BOOKING, BASE],
  ];
  for (const [index, window] of windows.entries()) {
    const at = NOW + index * 10 + 1;
    const observed = observeNotificationHints(freeze(clone(state)), freeze(window), at);
    assert.equal(observed.newHints, 1);
    assert.equal(observed.actionable, 1);
    state = observed.state;
    const requestId = planNotificationRefresh(state, at).requestId;
    for (let replay = 1; replay <= 2; replay++) {
      const persisted = freeze(clone(state)), before = clone(persisted);
      const repeat = observeNotificationHints(persisted, window, at + replay);
      assert.equal(repeat.newHints, 0);
      assert.equal(repeat.actionable, 0);
      assert.equal(repeat.ignored, 0);
      assert.deepEqual(repeat.kinds, []);
      assert.deepEqual(repeat.state.pending, persisted.pending);
      assert.deepEqual(repeat.state.window, persisted.window);
      assert.equal(repeat.state.sequence, persisted.sequence);
      assert.equal(planNotificationRefresh(repeat.state, at + replay).requestId, requestId);
      assert.deepEqual(persisted, before);
      state = repeat.state;
    }
  }
  assert.equal(state.pending.length, windows.length);
  assert.equal(new Set(state.pending).size, windows.length);
});

test('identical rebooking after acknowledgement queues a distinct request instead of replaying the original', async () => {
  const db = fakeDb(), requests = [], pendingKeys = [];
  let state = baseline();
  for (const [index, window] of [
    [BOOKING, BASE], [CANCEL, BOOKING, BASE], [BOOKING, CANCEL, BOOKING, BASE],
  ].entries()) {
    const at = NOW + 1 + index * NOTIFICATION_REFRESH_MS;
    const observed = observeNotificationHints(freeze(clone(state)), freeze(window), at);
    assert.equal(observed.newHints, 1);
    assert.equal(observed.state.pending.length, 1);
    const plan = freeze(planNotificationRefresh(observed.state, at));
    assert.equal(plan.status, 'ready');
    requests.push(plan.requestId);
    pendingKeys.push(plan.keys[0]);
    assert.deepEqual(await enqueueNotificationRefresh({ db, plan, timestamp: new Date(at) }), {
      status: 'queued', requestId: plan.requestId,
    });
    state = acknowledgeNotificationRefresh(freeze(observed.state), plan, at);
    const repeat = observeNotificationHints(freeze(clone(state)), window, at + 1);
    assert.equal(repeat.newHints, 0);
    assert.deepEqual(repeat.state.pending, []);
    assert.deepEqual(planNotificationRefresh(repeat.state, at + 1), { status: 'idle' });
    state = repeat.state;
  }
  assert.equal(new Set(requests).size, 3);
  assert.equal(new Set(pendingKeys).size, 3);
  assert.equal(pendingKeys[0], BOOKING.key);
  assert.equal(pendingKeys[1], CANCEL.key);
  assert.notEqual(pendingKeys[2], BOOKING.key);
  assert.equal(db.creates.length, 3);
});

test('a bounded window retains prepend identity when its oldest row drops off', () => {
  const booked = observeNotificationHints(baseline(), [BOOKING, BASE], NOW + 1).state;
  const cancelled = observeNotificationHints(booked, [CANCEL, BOOKING, BASE], NOW + 2).state;
  const rebooked = observeNotificationHints(freeze(cancelled), freeze([BOOKING, CANCEL, BOOKING]), NOW + 3);
  assert.equal(rebooked.newHints, 1);
  assert.equal(rebooked.actionable, 1);
  assert.equal(rebooked.continuityLost, false);
  assert.equal(rebooked.state.pending.length, 3);
  assert.notEqual(rebooked.state.pending[2], BOOKING.key);
  const repeat = observeNotificationHints(freeze(clone(rebooked.state)), [BOOKING, CANCEL, BOOKING], NOW + 4);
  assert.equal(repeat.newHints, 0);
  assert.deepEqual(repeat.state.pending, rebooked.state.pending);
});

for (const [title, kind] of [
  ['예약', 'reservation'], ['예약 취소', 'reservation'], ['예약취소(결석)', 'reservation'],
  ['예약 대기', 'reservation'], ['대기 취소', 'reservation'],
  ['수업 룸 변경', 'lecture'], ['수업 취소', 'lecture'], ['수업 변경', 'lecture'],
  ['수강권 등록', 'ticket'], ['수강권 환불', 'ticket'], ['수강권 사용불가 처리', 'ticket'],
  ['서명완료', 'contract'],
]) {
  test(`notification title ${JSON.stringify(title)} maps to ${kind}`, () => {
    const result = hint(title);
    assert.equal(result.kind, kind);
    assert.match(result.key, /^[a-f0-9]{64}$/);
    assert.deepEqual(Object.keys(result).sort(), ['key', 'kind']);
  });
}

test('holding and unknown titles are remembered but never become pending work', () => {
  const ignored = ['홀딩', '홀딩 신청', '수강권 홀딩', 'synthetic unknown'].map(title => hint(title));
  assert.ok(ignored.every(row => row.kind === 'ignored'));
  const result = observeNotificationHints(baseline(), [BASE, ...ignored], NOW + 1);
  assert.equal(result.newHints, ignored.length);
  assert.equal(result.ignored, ignored.length);
  assert.equal(result.actionable, 0);
  assert.deepEqual(result.kinds, []);
  assert.deepEqual(result.state.pending, []);
  assert.deepEqual(new Set(result.state.seen), new Set([BASE, ...ignored].map(row => row.key)));
  assert.equal(observeNotificationHints(result.state, ignored, NOW + 2).newHints, 0);
});

test('losing the rendered-window overlap marks continuity loss without inventing events', () => {
  const result = observeNotificationHints(baseline(), [BOOKING], NOW + 1);
  assert.equal(result.continuityLost, true);
  assert.equal(result.state.continuityLost, true);
  assert.deepEqual(result.state.pending, [BOOKING.key]);
  const historical = observeNotificationHints(result.state, [BOOKING, BASE], NOW + 2);
  assert.equal(historical.continuityLost, true);
  assert.equal(historical.state.continuityLost, true);
  assert.equal(historical.newHints, 0);
  assert.equal(historical.actionable, 0);
});

test('ordered window [A,B,C] to [B,C,B] discloses a gap without inventing fresh occurrences', () => {
  const [a, b, c] = [BOOKING, CANCEL, SIGNATURE];
  const previous = freeze(clone(observeNotificationHints(null, [a, b, c], NOW).state));
  const before = clone(previous), window = freeze([b, c, b]);
  const result = observeNotificationHints(previous, window, NOW + 1);
  assert.equal(result.continuityLost, true);
  assert.equal(result.state.continuityLost, true);
  assert.equal(result.newHints, 0);
  assert.equal(result.actionable, 0);
  assert.equal(result.ignored, 0);
  assert.deepEqual(result.kinds, []);
  assert.deepEqual(result.state.pending, []);
  assert.equal(result.state.sequence, previous.sequence);
  assert.deepEqual(result.state.seen, [b.key, c.key, a.key]);
  assert.deepEqual(result.state.window, [b.key, c.key, b.key]);
  assert.deepEqual(planNotificationRefresh(result.state, NOW + 1), { status: 'idle' });
  assert.deepEqual(previous, before);
  assert.deepEqual(window, [b, c, b]);
});

test('invalid rows reject before observation and leave all caller inputs intact', () => {
  for (const row of [null, {}, { title: '예약' }, { title: ' ', body: 'synthetic' },
    { title: '예약', body: '\n\t' }, { title: 'x'.repeat(101), body: 'synthetic' },
    { title: '예약', body: 'x'.repeat(4001) }]) {
    const before = structuredClone(row);
    freeze(row);
    assert.throws(() => notificationHint(row), /notification_row_invalid/);
    assert.deepEqual(row, before);
  }
  assert.equal(notificationHint({ title: 'x'.repeat(100), body: 'x'.repeat(4000) }).kind, 'ignored');
  const previous = freeze(pendingState()), before = clone(previous);
  const rows = freeze([{ title: '예약', body: 'synthetic next' }, { title: '', body: 'incomplete' }]);
  assert.throws(() => observeNotificationHints(previous, rows.map(notificationHint), NOW + 2), /notification_row_invalid/);
  assert.deepEqual(previous, before);
});

for (const [label, hints, now, error] of [
  ['empty', [], NOW, 'notification_snapshot_incomplete'],
  ['missing', undefined, NOW, 'notification_snapshot_incomplete'],
  ['non-array', {}, NOW, 'notification_snapshot_incomplete'],
  ['oversized', Array(101).fill(BASE), NOW, 'notification_snapshot_incomplete'],
  ['invalid clock', [BASE], NaN, 'notification_snapshot_incomplete'],
  ['infinite clock', [BASE], Infinity, 'notification_snapshot_incomplete'],
  ['missing hint', [BASE, null], NOW, 'notification_hint_invalid'],
  ['invalid key', [BASE, { key: 'not-a-hash', kind: 'reservation' }], NOW, 'notification_hint_invalid'],
  ['uppercase key', [{ key: 'A'.repeat(64), kind: 'reservation' }], NOW, 'notification_hint_invalid'],
  ['invalid kind', [{ key: BOOKING.key, kind: 'holding' }], NOW, 'notification_hint_invalid'],
]) {
  test(`${label} snapshot rejects atomically and preserves pending/seen input`, () => {
    const previous = freeze(pendingState()), before = clone(previous);
    const hintsBefore = structuredClone(hints);
    freeze(hints);
    assert.throws(() => observeNotificationHints(previous, hints, now), new RegExp(error));
    assert.deepEqual(previous, before);
    assert.deepEqual(hints, hintsBefore);
  });
}

test('incompatible persisted state requires review without changing the input', () => {
  for (const patch of [
    { version: 'synthetic-old-version' }, { studioId: 'synthetic-other-studio' },
    { seen: null }, { seen: {} }, { seen: ['invalid-key'] },
    { pending: null }, { pending: {} }, { pending: ['invalid-key'] },
  ]) {
    const previous = freeze({ ...pendingState(), ...patch }), before = clone(previous);
    assert.throws(() => observeNotificationHints(previous, [BASE, BOOKING], NOW + 2), /notification_state_review_required/);
    assert.deepEqual(previous, before);
  }
});

test('exactly 100 hints are accepted and seen history remains bounded at 5000', () => {
  const seen = Array.from({ length: 5000 }, (_, n) => hint('예약', `synthetic old ${n}`).key);
  const previous = freeze({ ...baseline(), seen });
  const fresh = Array.from({ length: 100 }, (_, n) => hint('예약', `synthetic new ${n}`));
  const result = observeNotificationHints(previous, freeze(fresh), NOW + 1);
  assert.equal(result.received, 100);
  assert.equal(result.actionable, 100);
  assert.equal(result.state.seen.length, 5000);
  assert.deepEqual(result.state.seen.slice(0, 100), fresh.map(row => row.key));
  assert.equal(result.state.pending.length, 100);
});

test('cooldown defers new hints until the exact fifteen-minute boundary', () => {
  assert.equal(NOTIFICATION_REFRESH_MS, 15 * 60_000);
  const state = pendingState(), plan = planNotificationRefresh(state, NOW + 1);
  const ack = acknowledgeNotificationRefresh(state, plan, NOW + 2);
  assert.deepEqual(planNotificationRefresh(ack, NOW + 3), { status: 'idle' });
  const next = freeze(observeNotificationHints(ack, [BASE, BOOKING, CANCEL], NOW + 3).state);
  const before = clone(next);
  assert.deepEqual(planNotificationRefresh(next, NOW + 2 + NOTIFICATION_REFRESH_MS - 1), { status: 'cooldown' });
  assert.equal(planNotificationRefresh(next, NOW + 2 + NOTIFICATION_REFRESH_MS).status, 'ready');
  assert.deepEqual(next, before);
});

test('replay, ordering, and observation-time drift preserve the request ID', () => {
  const state = freeze(observeNotificationHints(baseline(), [BASE, BOOKING, CANCEL], NOW + 1).state);
  const before = clone(state), first = planNotificationRefresh(state, NOW + 1);
  const reordered = planNotificationRefresh({ ...state, pending: [...state.pending].reverse(), observedAt: 'synthetic later' }, NOW + 50);
  assert.match(first.requestId, /^studiomate_notification_[a-f0-9]{64}$/);
  assert.equal(first.requestId, reordered.requestId);
  assert.deepEqual(first.keys, [...state.pending].sort());
  assert.deepEqual(first, planNotificationRefresh(state, NOW + 100));
  assert.notEqual(first.requestId, planNotificationRefresh(pendingState(), NOW + 1).requestId);
  assert.deepEqual(state, before);
});

test('JSON-persisted restart preserves baseline, pending work, request ID, and acknowledgement', () => {
  const state = pendingState(), plan = planNotificationRefresh(state, NOW + 1);
  const restart = clone(state);
  const repeated = observeNotificationHints(restart, [BOOKING, BASE], NOW + 2);
  assert.equal(repeated.baseline, false);
  assert.equal(repeated.actionable, 0);
  assert.equal(repeated.state.pendingSince, state.pendingSince);
  assert.equal(planNotificationRefresh(repeated.state, NOW + 2).requestId, plan.requestId);
  const ack = clone(acknowledgeNotificationRefresh(repeated.state, plan, NOW + 3));
  const afterRestart = observeNotificationHints(ack, [BOOKING, BASE], NOW + 4);
  assert.deepEqual(afterRestart.state.pending, []);
  assert.deepEqual(planNotificationRefresh(afterRestart.state, NOW + 4), { status: 'idle' });
  assert.equal(afterRestart.state.lastRequestId, plan.requestId);
});

test('refresh plans expose no member-facing authority, holding enablement, or raw content', () => {
  const state = pendingState(), plan = planNotificationRefresh(state, NOW + 1);
  assert.equal(state.livePushVerified, false);
  assert.equal(state.transport, 'browser_notification_list_poll');
  assert.equal(plan.data.notificationIsExecutionAuthority, false);
  assert.equal(plan.data.holdingNotificationEnabled, false);
  assert.equal(plan.data.requestMode, 'emergency_excel');
  assert.equal(plan.data.status, 'pending');
  assert.equal(plan.data.studioId, '5330');
  assert.equal(plan.data.source, NOTIFICATION_INGRESS_VERSION);
  assert.equal(plan.data.notificationHintCount, 1);
  assert.deepEqual(plan.data.notificationHintKeys, [BOOKING.key]);
  assert.doesNotMatch(JSON.stringify({ state, plan }), /synthetic booking A|synthetic baseline|canonicalBookingKey|memberId|phone/);
});

function contactPlanFixtures() {
  const profile = (memberId, extra = {}) => ({ memberId, studioId: '5330', source: 'synthetic_excel', ...extra });
  const syncJob = (memberId, status = 'pending') => ({
    jobId: `synthetic_contact_${memberId}`, memberId, target: 'synthetic_contact_target', status, attempts: 2,
  });
  const contactIndex = memberId => ({
    memberId, contactHash: `synthetic_hash_${memberId}`,
    contactTargets: { synthetic_contact_target: 'pending' }, lastContactSyncJobId: `synthetic_contact_${memberId}`,
  });
  const existing = { memberId: '701', matchType: 'existing', profileDoc: profile('701'), writeProfile: true,
    contactIndexDoc: contactIndex('701'), writeContactIndex: true, contactSyncJobDoc: syncJob('701'),
    studiomateMemberIdLookupJobDoc: null, memberGrade: 'regular' };
  const consultation = { memberId: 'consultation_excel_synthetic', matchType: 'consultation_excel',
    contactIndexDoc: contactIndex('consultation_excel_synthetic'), writeContactIndex: true,
    contactSyncJobDoc: syncJob('consultation_excel_synthetic') };
  return [
    ['existing changed member', existing],
    ['existing unchanged member', { ...existing, writeProfile: false, writeContactIndex: false, contactSyncJobDoc: null }],
    ['existing retry contact job', { ...existing, writeProfile: false, contactSyncJobDoc: syncJob('701', 'retry') }],
    ['temporary Excel profile and identity job', {
      ...existing, memberId: 'excel_synthetic', matchType: 'temporary_excel_id', profileDoc: profile('excel_synthetic'),
      studiomateMemberIdLookupJobDoc: { jobId: 'synthetic_identity_lookup', memberId: 'excel_synthetic',
        status: 'pending', attempts: 0, maxAttempts: 5, source: 'synthetic_excel' },
    }],
    ['consultation contact only', consultation],
    ['unchanged consultation contact', { ...consultation, writeContactIndex: false, contactSyncJobDoc: null }],
    ['protected staff profile', { ...existing, profileDoc: profile('701', { isStaff: true }), contactSyncJobDoc: null }],
    ['instructor profile', { ...existing, memberGrade: 'synthetic_instructor',
      profileDoc: profile('701', { instructorLessonDates: ['2026-10-20'] }) }],
  ];
}

for (const [label, input] of contactPlanFixtures()) {
  test(`notification contact preservation blocks contact writes for ${label} without changing profile/identity work`, () => {
    const plans = freeze([input]), before = structuredClone(plans);
    const result = preserveNotificationContactPlans(plans);
    assert.notEqual(result, plans);
    assert.equal(result.length, 1);
    assert.notEqual(result[0], input);
    assert.equal(result[0].writeContactIndex, false);
    assert.equal(result[0].contactSyncJobDoc, null);
    assert.deepEqual(result[0], { ...input, writeContactIndex: false, contactSyncJobDoc: null });
    for (const key of Object.keys(input).filter(key => !['writeContactIndex', 'contactSyncJobDoc'].includes(key))) {
      assert.equal(result[0][key], input[key], `${key} must remain untouched`);
    }
    for (const key of ['profileDoc', 'writeProfile', 'studiomateMemberIdLookupJobDoc']) {
      assert.equal(Object.hasOwn(result[0], key), Object.hasOwn(input, key));
    }
    assert.deepEqual(plans, before);
  });
}

test('notification contact preservation keeps mixed branch ordering and is idempotent', () => {
  const input = freeze(contactPlanFixtures().map(([, plan]) => plan)), before = structuredClone(input);
  const first = preserveNotificationContactPlans(input);
  const second = preserveNotificationContactPlans(freeze(first));
  assert.deepEqual(second, first);
  assert.deepEqual(first.map(plan => plan.memberId), input.map(plan => plan.memberId));
  assert.ok(first.every(plan => plan.writeContactIndex === false && plan.contactSyncJobDoc === null));
  assert.deepEqual(first.filter(plan => plan.profileDoc && plan.writeProfile).map(plan => plan.profileDoc),
    input.filter(plan => plan.profileDoc && plan.writeProfile).map(plan => plan.profileDoc));
  assert.deepEqual(first.filter(plan => plan.studiomateMemberIdLookupJobDoc).map(plan => plan.studiomateMemberIdLookupJobDoc),
    input.filter(plan => plan.studiomateMemberIdLookupJobDoc).map(plan => plan.studiomateMemberIdLookupJobDoc));
  assert.deepEqual(input, before);
});

test('notification contact preservation returns an independent empty list for no planned work', () => {
  const input = freeze([]), result = preserveNotificationContactPlans(input);
  assert.deepEqual(result, []);
  assert.notEqual(result, input);
  assert.deepEqual(input, []);
});

test('large pending plans retain all acknowledgement keys but bound their queue payload', () => {
  const keys = Array.from({ length: 130 }, (_, n) => hint('예약', `synthetic accumulated ${n}`).key);
  const plan = planNotificationRefresh(freeze({ ...baseline(), pending: keys }), NOW);
  assert.equal(plan.keys.length, 130);
  assert.equal(plan.data.notificationHintCount, 130);
  assert.equal(plan.data.notificationHintKeys.length, 100);
  assert.deepEqual(plan.data.notificationHintKeys, [...keys].sort().slice(0, 100));
});

test('enqueue creates exactly one request with explicit timestamps and replay is duplicate', async () => {
  const db = fakeDb(), plan = freeze(planNotificationRefresh(pendingState(), NOW + 1));
  const timestamp = new Date(NOW + 2), path = `adminSyncRequests/${plan.requestId}`;
  assert.equal('collection' in db, false);
  assert.deepEqual(await enqueueNotificationRefresh({ db, plan, timestamp }), { status: 'queued', requestId: plan.requestId });
  assert.deepEqual(db.docs.get(path), { ...plan.data, createdAt: timestamp, updatedAt: timestamp });
  assert.deepEqual(await enqueueNotificationRefresh({ db, plan, timestamp: new Date(NOW + 3) }), { status: 'duplicate', requestId: plan.requestId });
  assert.equal(db.creates.length, 1);
  assert.equal(db.docs.size, 1);
  assert.deepEqual(db.reads, [path, path]);
  assert.equal(db.docs.get(path).createdAt.getTime(), timestamp.getTime());
});

test('transaction create collision retries as duplicate without overwriting the winner', async () => {
  const winner = { status: 'pending', syntheticWinner: true };
  const db = fakeDb({ collision: winner }), plan = planNotificationRefresh(pendingState(), NOW + 1);
  assert.deepEqual(await enqueueNotificationRefresh({ db, plan, timestamp: NOW }), { status: 'duplicate', requestId: plan.requestId });
  assert.equal(db.attempts, 2);
  assert.equal(db.creates.length, 0);
  assert.deepEqual(db.docs.get(`adminSyncRequests/${plan.requestId}`), winner);
});

test('idle and cooldown enqueue never access a database', async () => {
  for (const status of ['idle', 'cooldown']) {
    assert.deepEqual(await enqueueNotificationRefresh({ db: null, plan: { status } }), { status });
  }
});

test('genuine transaction errors propagate without acknowledging or mutating input', async () => {
  const failure = Object.assign(new Error('synthetic transaction unavailable'), { code: 'UNAVAILABLE' });
  const state = freeze(pendingState()), before = clone(state), plan = freeze(planNotificationRefresh(state, NOW + 1));
  const db = { async runTransaction() { throw failure; } };
  await assert.rejects(enqueueNotificationRefresh({ db, plan, timestamp: NOW }), error => error === failure);
  assert.deepEqual(state, before);
});

test('pending Excel refresh coalesces atomically and stores a replayable receipt', async () => {
  const db = fakeDb({ query: true }), targetPath = 'adminSyncRequests/synthetic_pending';
  const existing = { requestMode: 'emergency_excel', status: 'pending', studioId: '5330',
    notificationHintKeys: [BASE.key, BOOKING.key], notificationIsExecutionAuthority: false,
    holdingNotificationEnabled: false, syntheticPreserved: true };
  db.docs.set(targetPath, structuredClone(existing));
  db.docs.set('adminSyncRequests/synthetic_other_mode', { requestMode: 'api', status: 'pending' });
  const plan = freeze(planNotificationRefresh(pendingState(), NOW + 1)), timestamp = new Date(NOW + 2);
  assert.deepEqual(await enqueueNotificationRefresh({ db, plan, timestamp }), { status: 'coalesced', requestId: 'synthetic_pending' });
  assert.deepEqual(db.queries, [{ type: 'query', collection: 'adminSyncRequests', filters: [['status', '==', 'pending']], count: 20 }]);
  assert.equal(db.sets.length, 1);
  assert.equal(db.creates.length, 1);
  assert.deepEqual(db.docs.get(targetPath), { ...existing, notificationObservedAt: plan.data.notificationObservedAt, updatedAt: timestamp });
  const receiptPath = `adminSyncRequests/${plan.requestId}`;
  assert.deepEqual(db.docs.get(receiptPath), { ...plan.data, status: 'coalesced', coalescedInto: 'synthetic_pending', createdAt: timestamp, updatedAt: timestamp });
  assert.deepEqual(await enqueueNotificationRefresh({ db, plan, timestamp: new Date(NOW + 3) }), { status: 'duplicate', requestId: 'synthetic_pending' });
  assert.equal(db.queries.length, 1);
  assert.equal(db.sets.length, 1);
  assert.equal(db.creates.length, 1);
});

test('coalescing merges fresh keys uniquely and caps target hints at 100', async () => {
  const db = fakeDb({ query: true });
  const existingKeys = Array.from({ length: 99 }, (_, n) => hint('예약', `synthetic target ${n}`).key);
  db.docs.set('adminSyncRequests/synthetic_target', { requestMode: 'emergency_excel', status: 'pending', notificationHintKeys: existingKeys });
  const state = { ...pendingState(), pending: [existingKeys[0], BOOKING.key, CANCEL.key] };
  const plan = planNotificationRefresh(freeze(state), NOW + 1);
  await enqueueNotificationRefresh({ db, plan, timestamp: NOW });
  const merged = db.docs.get('adminSyncRequests/synthetic_target').notificationHintKeys;
  assert.deepEqual(merged, [...new Set([...existingKeys, ...plan.keys])].slice(0, 100));
  assert.equal(merged.length, 100);
  assert.equal(new Set(merged).size, 100);
});

test('running/completed Excel requests and pending non-Excel requests never coalesce', async () => {
  const db = fakeDb({ query: true });
  const unrelated = [
    ['running', { requestMode: 'emergency_excel', status: 'running' }],
    ['completed', { requestMode: 'emergency_excel', status: 'done' }],
    ['other_mode', { requestMode: 'api', status: 'pending' }],
  ];
  for (const [id, data] of unrelated) db.docs.set(`adminSyncRequests/${id}`, structuredClone(data));
  const plan = planNotificationRefresh(pendingState(), NOW + 1);
  assert.deepEqual(await enqueueNotificationRefresh({ db, plan, timestamp: NOW }), { status: 'queued', requestId: plan.requestId });
  assert.equal(db.sets.length, 0);
  assert.equal(db.creates.length, 1);
  for (const [id, data] of unrelated) assert.deepEqual(db.docs.get(`adminSyncRequests/${id}`), data);
});

test('coalescing create collision rolls back the target merge before duplicate retry', async () => {
  const winner = { status: 'coalesced', coalescedInto: 'synthetic_other_target' };
  const db = fakeDb({ query: true, collision: winner });
  const target = { requestMode: 'emergency_excel', status: 'pending', notificationHintKeys: [BASE.key] };
  db.docs.set('adminSyncRequests/synthetic_target', structuredClone(target));
  const plan = planNotificationRefresh(pendingState(), NOW + 1);
  assert.deepEqual(await enqueueNotificationRefresh({ db, plan, timestamp: NOW }), { status: 'duplicate', requestId: 'synthetic_other_target' });
  assert.equal(db.attempts, 2);
  assert.equal(db.sets.length, 0);
  assert.equal(db.creates.length, 0);
  assert.deepEqual(db.docs.get('adminSyncRequests/synthetic_target'), target);
});

test('acknowledgement removes only the plan keys, preserving arrivals after planning', () => {
  const state = pendingState(), plan = freeze(planNotificationRefresh(state, NOW + 1));
  const later = freeze(observeNotificationHints(state, [BASE, BOOKING, CANCEL], NOW + 2).state);
  const before = clone(later), ack = acknowledgeNotificationRefresh(later, plan, NOW + 3);
  assert.deepEqual(ack.pending, [CANCEL.key]);
  assert.deepEqual(ack.seen, later.seen);
  assert.equal(ack.lastQueuedAt, NOW + 3);
  assert.equal(ack.lastRequestId, plan.requestId);
  assert.deepEqual(later, before);
  assert.deepEqual(acknowledgeNotificationRefresh(ack, plan, NOW + 3), ack);
});

test('acknowledgement retains a pending age while unhandled hints remain', () => {
  const state = pendingState(), plan = planNotificationRefresh(state, NOW + 1);
  const later = observeNotificationHints(state, [BASE, BOOKING, CANCEL], NOW + 2).state;
  const ack = acknowledgeNotificationRefresh(later, plan, NOW + 3);
  assert.deepEqual(ack.pending, [CANCEL.key]);
  assert.ok(Number.isFinite(ack.pendingSince), 'remaining pending work must not lose its age');
  assert.ok(ack.pendingSince <= NOW + 2, 'remaining work must not appear younger than its observation');
});

test('full acknowledgement clears pending age and preserves non-pending state', () => {
  const state = freeze(pendingState()), plan = freeze(planNotificationRefresh(state, NOW + 1));
  const ack = acknowledgeNotificationRefresh(state, plan, NOW + 2);
  assert.deepEqual(ack, { ...state, pending: [], pendingSince: null, lastQueuedAt: NOW + 2, lastRequestId: plan.requestId });
});

test('sync-run acquisition uses the dedicated non-waiting lock and returns its exact release', async () => {
  const calls = [];
  let releaseCount = 0;
  const release = async () => { releaseCount++; };
  const result = await acquireStudioMateSyncRun({ acquire: async options => { calls.push(options); return release; } });
  assert.deepEqual(calls, [{ lockPath: '~/ArchiveIN/automation/locks/studiomate-excel-sync-run.lock', owner: 'studiomate-excel-sync-run', waitMs: 0 }]);
  assert.equal(result.acquired, true);
  assert.equal(result.release, release);
  assert.equal(releaseCount, 0);
  await result.release();
  assert.equal(releaseCount, 1);
});

test('busy sync-run lock is non-fatal and provides no release for a foreign owner', async () => {
  const result = await acquireStudioMateSyncRun({ acquire: async () => {
    throw new Error('StudioMate browser profile is locked by synthetic-other-owner since synthetic-time.');
  } });
  assert.deepEqual(result, { acquired: false });
  assert.equal('release' in result, false);
});

test('genuine sync-run acquisition failures propagate unchanged', async () => {
  for (const failure of [
    Object.assign(new Error('synthetic permission denied'), { code: 'EACCES' }),
    Object.assign(new Error('synthetic disk full'), { code: 'ENOSPC' }),
    new Error('Invalid StudioMate lock timing options'),
    new Error('synthetic owner metadata failure'),
  ]) {
    await assert.rejects(acquireStudioMateSyncRun({ acquire: async () => { throw failure; } }), error => error === failure);
  }
});

test('injected ownership release survives busy contention and cannot release a later lease', async () => {
  let currentOwner = null;
  const acquire = async () => {
    if (currentOwner) throw new Error('StudioMate browser profile is locked by synthetic-owner');
    const token = Symbol('synthetic lease');
    currentOwner = token;
    return async () => { if (currentOwner === token) currentOwner = null; };
  };
  const first = await acquireStudioMateSyncRun({ acquire });
  try {
    const firstOwner = currentOwner;
    assert.deepEqual(await acquireStudioMateSyncRun({ acquire }), { acquired: false });
    assert.equal(currentOwner, firstOwner);
  } finally { await first.release(); }
  assert.equal(currentOwner, null);
  const second = await acquireStudioMateSyncRun({ acquire });
  try {
    const secondOwner = currentOwner;
    await first.release();
    assert.equal(currentOwner, secondOwner);
    assert.deepEqual(await acquireStudioMateSyncRun({ acquire }), { acquired: false });
  } finally { await second.release(); }
  assert.equal(currentOwner, null);
});

test('caller finally releases an acquired sync-run lease when its work fails', async () => {
  let released = false;
  const failure = new Error('synthetic work failed');
  await assert.rejects((async () => {
    const lease = await acquireStudioMateSyncRun({ acquire: async () => async () => { released = true; } });
    try { throw failure; } finally { await lease.release(); }
  })(), error => error === failure);
  assert.equal(released, true);
});

test('release failures remain visible to the caller', async () => {
  const failure = new Error('synthetic release failed');
  const lease = await acquireStudioMateSyncRun({ acquire: async () => async () => { throw failure; } });
  await assert.rejects(lease.release(), error => error === failure);
});
