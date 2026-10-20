import { createHash } from 'node:crypto';

export const NOTIFICATION_INGRESS_VERSION = 'studiomate-notification-hints-v1';
export const NOTIFICATION_POLL_MS = 120_000;
export const NOTIFICATION_REFRESH_MS = 15 * 60_000;
const normalize = value => String(value || '').normalize('NFC').replace(/\s+/g, ' ').trim();
const digest = value => createHash('sha256').update(value).digest('hex');
const kinds = new Map([
  ['예약', 'reservation'], ['예약 취소', 'reservation'], ['예약취소(결석)', 'reservation'],
  ['예약 대기', 'reservation'], ['대기 취소', 'reservation'],
  ['수업 룸 변경', 'lecture'], ['수업 취소', 'lecture'], ['수업 변경', 'lecture'],
  ['수강권 등록', 'ticket'], ['수강권 환불', 'ticket'], ['수강권 사용불가 처리', 'ticket'],
  ['서명완료', 'contract'],
]);

// A content hash is only a refresh hint, never a canonical booking/holding/send identity.
export function notificationHint(row) {
  const title = normalize(row?.title), body = normalize(row?.body);
  if (!title || !body || title.length > 100 || body.length > 4000) throw new Error('notification_row_invalid');
  return { key: digest(JSON.stringify(['5330', title, body])), kind: kinds.get(title) || 'ignored' };
}

export function observeNotificationHints(previous, hints, now = Date.now()) {
  if (!Number.isFinite(now) || !Array.isArray(hints) || hints.length < 1 || hints.length > 100)
    throw new Error('notification_snapshot_incomplete');
  if (hints.some(h => !/^[a-f0-9]{64}$/.test(h?.key || '') || !['reservation', 'lecture', 'ticket', 'contract', 'ignored'].includes(h.kind)))
    throw new Error('notification_hint_invalid');
  if (previous && (previous.version !== NOTIFICATION_INGRESS_VERSION || previous.studioId !== '5330'
    || !Array.isArray(previous.seen) || previous.seen.some(key => !/^[a-f0-9]{64}$/.test(key))
    || !Array.isArray(previous.pending) || previous.pending.some(key => !/^[a-f0-9]{64}$/.test(key))
    || previous.window !== undefined && (!Array.isArray(previous.window) || previous.window.some(key => !/^[a-f0-9]{64}$/.test(key)))
    || previous.sequence !== undefined && (!Number.isSafeInteger(previous.sequence) || previous.sequence < 0)))
    throw new Error('notification_state_review_required');
  const seen = new Set(previous?.seen || []);
  const unique = [...new Map(hints.map(h => [h.key, h])).values()];
  const window = hints.map(h => h.key);
  let overlap = 0;
  if (previous?.window) {
    for (let size = Math.min(window.length, previous.window.length); size > 0; size--) {
      if (window.slice(-size).every((key, index) => key === previous.window[index])) { overlap = size; break; }
    }
  }
  let sequence = previous?.sequence || 0;
  const prefix = overlap ? hints.slice(0, hints.length - overlap) : [];
  const arrivals = [...new Map(prefix.map(h => [h.key, h])).values()];
  const fresh = previous ? unique.filter(h => !seen.has(h.key)) : [];
  // A cancel/rebook can have identical text. An observed prepend is a new refresh
  // occurrence, while unchanged windows and relative-time drift remain duplicates.
  for (const hint of arrivals.filter(h => seen.has(h.key) && prefix[0]?.key === h.key
    && window.filter(key => key === h.key).length > (previous?.window || []).filter(key => key === h.key).length)) {
    fresh.push({ ...hint, key: digest(JSON.stringify([hint.key, 'observed-prepend', ++sequence])) });
  }
  const actionable = fresh.filter(h => h.kind !== 'ignored');
  const pending = [...new Set([...(previous?.pending || []), ...actionable.map(h => h.key)])];
  const continuityLost = !!previous && (previous.window ? overlap === 0 : !unique.some(h => seen.has(h.key)));
  // The bounded window is deliberately not treated as a complete event feed.
  const state = { ...previous, version: NOTIFICATION_INGRESS_VERSION, studioId: '5330',
    initializedAt: previous?.initializedAt || new Date(now).toISOString(),
    observedAt: new Date(now).toISOString(), nextPollAt: now + NOTIFICATION_POLL_MS,
    seen: [...new Set([...unique.map(h => h.key), ...seen])].slice(0, 5000),
    window, sequence,
    pending, pendingSince: previous?.pendingSince || (pending.length ? now : null),
    continuityLost: continuityLost || previous?.continuityLost || false,
    livePushVerified: false, transport: 'browser_notification_list_poll',
  };
  return { state, baseline: !previous, received: unique.length, newHints: fresh.length,
    actionable: actionable.length, ignored: fresh.length - actionable.length, continuityLost,
    kinds: [...new Set(actionable.map(h => h.kind))] };
}

export function preserveNotificationContactPlans(plans) {
  return plans.map(plan => ({ ...plan, writeContactIndex: false, contactSyncJobDoc: null }));
}

export function planNotificationRefresh(state, now = Date.now()) {
  if (!state?.pending?.length) return { status: 'idle' };
  if (state.lastQueuedAt && now - state.lastQueuedAt < NOTIFICATION_REFRESH_MS) return { status: 'cooldown' };
  const keys = [...state.pending].sort();
  return { status: 'ready', requestId: `studiomate_notification_${digest(JSON.stringify(keys))}`,
    data: { requestMode: 'emergency_excel', status: 'pending', studioId: '5330',
      source: NOTIFICATION_INGRESS_VERSION, notificationHintCount: keys.length,
      notificationHintKeys: keys.slice(0, 100), notificationObservedAt: state.observedAt,
      requestedByUid: 'macmini-notification-observer', progressPercent: 0,
      progressLabel: '알림 기반 기존 Excel 동기화 대기',
      // Member-facing decisions still belong exclusively to the existing canonical pipeline.
      notificationIsExecutionAuthority: false, holdingNotificationEnabled: false,
    }, keys };
}

export async function enqueueNotificationRefresh({ db, plan, timestamp }) {
  if (plan.status !== 'ready') return { status: plan.status };
  return db.runTransaction(async tx => {
    const ref = db.doc(`adminSyncRequests/${plan.requestId}`);
    const current = await tx.get(ref);
    if (current.exists) return { status: 'duplicate', requestId: current.data()?.coalescedInto || plan.requestId };
    if (typeof db.collection === 'function') {
      const pending = await tx.get(db.collection('adminSyncRequests').where('status', '==', 'pending').limit(20));
      const target = pending.docs.find(doc => doc.id !== plan.requestId && doc.data().requestMode === 'emergency_excel');
      if (target) {
        tx.set(target.ref, { notificationHintKeys: [...new Set([...(target.data().notificationHintKeys || []), ...plan.keys])].slice(0, 100),
          notificationObservedAt: plan.data.notificationObservedAt, updatedAt: timestamp }, { merge: true });
        tx.create(ref, { ...plan.data, status: 'coalesced', coalescedInto: target.id,
          createdAt: timestamp, updatedAt: timestamp });
        return { status: 'coalesced', requestId: target.id };
      }
    }
    tx.create(ref, { ...plan.data, createdAt: timestamp, updatedAt: timestamp });
    return { status: 'queued', requestId: plan.requestId };
  });
}

export function acknowledgeNotificationRefresh(state, plan, now = Date.now()) {
  const handled = new Set(plan.keys);
  const pending = state.pending.filter(key => !handled.has(key));
  return { ...state, pending,
    pendingSince: pending.length ? state.pendingSince : null,
    lastQueuedAt: now, lastRequestId: plan.requestId };
}
