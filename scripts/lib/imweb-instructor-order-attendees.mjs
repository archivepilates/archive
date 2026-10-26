import { IMWEB_LESSON_POLICY as policy, createInstructorOrderAttendeeResolution,
  validateInstructorOrderAttendeeResolution, assertInstructorOrderAttendeeFamily, orderLedgerId, orderFingerprint } from './imweb-instructor-order-policy.mjs';
import { registrationDocument, activeIdentities } from './imweb-instructor-orders.mjs';
import { memberDispatchWindow } from './member-dispatch-window.mjs';

const collection = (db, name, id) => db.collection(name).doc(id);
const refsFor = (db, resolution) => resolution.attendees.map(a => ({ attendee: a,
  registration: collection(db, 'instructorLessonRegistrations', a.registrationId),
  job: collection(db, 'studiomateInstructorLessonJobs', a.registrationId),
}));
const blocked = r => r?.cancellation || r?.externalEffectStarted || r?.ticketId || r?.evidence || r?.completedAt;

export async function admitInstructorOrderAttendees(db, order, attendees,
  { apply = false, now = new Date(), actor, basis } = {}) {
  const resolution = createInstructorOrderAttendeeResolution(order, attendees, { actor, basis, now });
  const ledgerRef = collection(db, 'imwebInstructorLessonOrders', orderLedgerId(resolution.orderNo));
  const auditRef = db.doc(`workLanes/instructor-lesson-registration/reports/attendees-${resolution.resolutionKey}`);
  const refs = refsFor(db, resolution);
  return db.runTransaction(async tx => {
    const ledger = await tx.get(ledgerRef);
    const old = ledger.data() || {};
    const rows = [];
    for (const ref of refs) rows.push({ ...ref, regSnap: await tx.get(ref.registration), jobSnap: await tx.get(ref.job) });
    if (old.attendeeResolution) {
      if (old.attendeeResolution.resolutionKey !== resolution.resolutionKey || old.status !== 'queued') throw new Error('기존 다인 승인 변경·보류: 재승인 검토 필요');
      validateInstructorOrderAttendeeResolution(order, old.attendeeResolution, { now });
      assertInstructorOrderAttendeeFamily(old.attendeeResolution, rows.map(r => r.regSnap.data()));
      return { status: 'unchanged', registrationIds: refs.map(r => r.attendee.registrationId), attendeeResolutionVerified: true };
    }
    if (old.fingerprint && old.fingerprint !== resolution.sourceFingerprint) throw new Error('기존 접수 후 주문 변경: 자동 배분 금지');
    if (old.registrationId && !refs.some(r => r.attendee.registrationId === old.registrationId)) throw new Error('기존 주문 대표 수강자 연결 확인필요');
    if (old.registrationIds && (old.registrationIds.length !== refs.length || old.registrationIds.some(id => !refs.some(r => r.attendee.registrationId === id)))) throw new Error('기존 공동 명단 변경 확인필요');
    for (const row of rows) {
      const r = row.regSnap.data();
      if (row.jobSnap.exists || (r && (r.source?.type !== 'imweb_order_review' || r.source.sourceId !== resolution.orderNo
        || r.registrationId !== row.attendee.registrationId || r.memberName !== row.attendee.memberName
        || r.memberPhone !== row.attendee.memberPhone || r.lessonDate !== resolution.lessonDate
        || r.status !== 'action_required' || blocked(r)
        || Object.values(r.steps || {}).some(s => !['pending', 'not_required'].includes(s.status))))) throw new Error('기존 등록·작업·외부 효과 확인필요: 재생성 금지');
      // Accepted, ambiguous or even prepared effects must not be overwritten by an operator resolution.
      if ((await tx.get(collection(db, 'eformsignInstructorMemberJobs', row.attendee.registrationId))).exists) throw new Error('기존 가입서 작업 보존: 재생성 금지');
      for (const name of ['eformsignInstructorMemberJobs', 'alimtalkCandidates', 'alimtalkSends']) {
        const key = name === 'alimtalkCandidates' || name === 'alimtalkSends' ? 'payload.registrationId' : 'registrationId';
        if (!(await tx.get(db.collection(name).where(key, '==', row.attendee.registrationId).limit(1))).empty) throw new Error('기존 가입서·안내 이력 확인필요: 공동 접수 중단');
      }
    }
    const [registrations, holders, bookings, lectureRows] = await Promise.all([
      tx.get(db.collection('instructorLessonRegistrations').where('lessonDate', '==', resolution.lessonDate)),
      tx.get(db.collection('memberProfiles').where('studioId', '==', policy.studioId).where('activeTicketNames', 'array-contains', '강사레슨 (2T)')),
      tx.get(db.collection('bookings').where('studioId', '==', policy.studioId).where('lectureDate', '==', resolution.lessonDate)),
      tx.get(db.collection('lectures').where('studioId', '==', policy.studioId).where('date', '==', resolution.lessonDate)),
    ]);
    const lectures = lectureRows.docs.filter(d => /강사\s*레슨/.test([d.data().title, d.data().name, d.data().lectureTitle, d.data().lessonTitle].join(' ')));
    const slots = new Map();
    for (const d of lectures) {
      const l = d.data(), start = l.startAt?.toMillis?.() || l.startTime;
      if (!start || !Number.isInteger(l.capacity) || l.capacity <= 0) throw new Error('수업 정원 원본 확인필요');
      slots.set(String(start), (slots.get(String(start)) || 0) + l.capacity);
    }
    const capacity = slots.size ? Math.min(policy.capacity, Math.max(...slots.values())) : policy.capacity;
    const members = activeIdentities(registrations, holders, resolution.lessonDate, bookings, lectures);
    for (const a of resolution.attendees) members.add(a.memberPhone);
    if (members.size > capacity) throw new Error('공동 접수 정원 초과: 전체 보류');
    const audit = await tx.get(auditRef);
    if (audit.exists) throw new Error('기존 공동 승인 감사기록 존재: 상태 불일치 검토 필요');
    const window = memberDispatchWindow(now);
    if (!window.allowed && !window.nextAllowedAt) throw new Error('통신 허용시각 확인필요');
    const nextRunAt = window.allowed ? now : new Date(window.nextAllowedAt);
    if (!apply) return { status: 'ready', mode: 'dry-run', count: refs.length, capacity, occupiedAfter: members.size,
      resolutionKey: resolution.resolutionKey, nextRunAt: nextRunAt.toISOString() };
    // One transaction admits the complete family; raw source and prior rows remain audit-only.
    tx.create(auditRef, { order, previousLedger: old, previousRegistrations: rows.map(r => r.regSnap.data() || null), resolution, createdAt: now });
    const assessed = validateInstructorOrderAttendeeResolution(order, resolution, { now });
    for (const row of rows) {
      const input = { ...assessed, ...row.attendee, paidAmount: row.attendee.paidAmount,
        totalPaidAmount: resolution.totalPaidAmount, quantity: refs.length, attendeeResolutionKey: resolution.resolutionKey };
      const doc = registrationDocument(input, now);
      doc.createdAt = row.regSnap.data()?.createdAt || now;
      doc.createdBy = { staffId: actor, name: '운영자 확인 다인 접수', email: null };
      doc.externalOrderReviewRequired = false;
      doc.operatorChecks.basis = basis;
      doc.nextAction = window.allowed ? doc.nextAction : '회원·수강권 자동 처리 가능 시간 대기 (09:00 이후)';
      doc.nextAllowedAt = window.nextAllowedAt;
      doc.orderAllocation = { resolutionKey: resolution.resolutionKey, auditPath: auditRef.path || `workLanes/instructor-lesson-registration/reports/attendees-${resolution.resolutionKey}` };
      if (row.regSnap.exists) tx.set(row.registration, doc, { merge: true });
      else tx.create(row.registration, doc);
      tx.create(row.job, { jobId: row.attendee.registrationId, registrationId: row.attendee.registrationId,
        studioId: policy.studioId, memberName: row.attendee.memberName, memberPhone: row.attendee.memberPhone,
        lessonDate: resolution.lessonDate, paymentMethod: 'card', ticketName: '강사레슨 (2T)', ticketPrice: row.attendee.paidAmount,
        externalOrder: input, status: 'pending', currentStep: 'member', attempts: 0, maxAttempts: 3,
        externalEffectStarted: false, nextRunAt, nextAllowedAt: window.nextAllowedAt, createdAt: now, updatedAt: now });
    }
    tx.set(ledgerRef, { orderNo: resolution.orderNo, itemNo: resolution.itemNo,
      registrationId: old.registrationId || assessed.registrationId, registrationIds: refs.map(r => r.attendee.registrationId),
      attendeeResolution: resolution, fingerprint: resolution.sourceFingerprint, paymentAmount: resolution.totalPaidAmount,
      status: 'queued', reason: '실제 수강자 공동 승인·개인별 결제 연결 완료', lastVerifiedAt: now, updatedAt: now }, { merge: true });
    return { status: 'queued', count: refs.length, registrationIds: refs.map(r => r.attendee.registrationId), nextRunAt: nextRunAt.toISOString(), resolutionKey: resolution.resolutionKey };
  });
}

export async function reconcileInstructorOrderAttendees(db, order, { apply = false, now = new Date() } = {}) {
  const ledgerRef = collection(db, 'imwebInstructorLessonOrders', orderLedgerId(order.orderNo));
  return db.runTransaction(async tx => {
    const ledger = await tx.get(ledgerRef), data = ledger.data() || {}, resolution = data.attendeeResolution;
    if (!resolution || !Array.isArray(resolution.attendees) || resolution.attendees.length < 2) throw new Error('공동 승인 원장 구조 확인필요');
    const rows = [];
    for (const ref of refsFor(db, resolution)) {
      const forms = await tx.get(db.collection('eformsignInstructorMemberJobs').where('registrationId', '==', ref.attendee.registrationId));
      rows.push({ ...ref, reg: await tx.get(ref.registration), work: await tx.get(ref.job), forms });
    }
    let reason = '';
    try {
      if (data.status !== 'queued' || data.fingerprint !== resolution.sourceFingerprint) throw new Error('기존 공동 보류 상태');
      validateInstructorOrderAttendeeResolution(order, resolution, { now });
      assertInstructorOrderAttendeeFamily(resolution, rows.map(r => r.reg.data()));
    } catch { reason = '다인 주문 변경·환불·취소 또는 수강자 연결 불일치: 공동 처리 보류'; }
    if (!reason) return { status: 'unchanged', orderNo: resolution.orderNo, attendeeResolutionVerified: true };
    if (apply) {
      for (const row of rows) {
        if (row.reg.exists) tx.update(row.registration, { externalOrderReviewRequired: true,
          'operatorChecks.paymentConfirmed': false, status: row.reg.data().status === 'cancelled' ? 'cancelled' : 'action_required', lastError: reason, updatedAt: now });
        if (row.work.exists && ['pending', 'retry'].includes(row.work.data().status)) tx.update(row.job, { status: 'review_required', lastError: reason, updatedAt: now });
        for (const f of row.forms.docs) if (['pending', 'retry', 'queued'].includes(f.data().status)) tx.update(f.ref, { status: 'send_review_required', lastError: reason, updatedAt: now });
      }
      tx.set(ledgerRef, { status: 'review_required', attendeeResolution: { ...resolution, status: 'blocked' },
        lastObservedFingerprint: orderFingerprint(order), reason, updatedAt: now }, { merge: true });
    }
    return { status: 'review_required', orderNo: resolution.orderNo, reason };
  });
}
