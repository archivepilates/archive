import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { IMWEB_LESSON_POLICY as policy, assessInstructorOrder, assertSamePaidOrder, orderFingerprint, orderLedgerId, needsPaymentMethodReassessment } from './imweb-instructor-order-policy.mjs';
import { normalizeInstructorLessonPhone, isInstructorLessonWaitlist } from './instructor-lesson-registration-contract.mjs';
import { recordAutomationStatus } from './archive-core-ops-logging.mjs';
import { acquireStudioMateBrowserLock } from './studiomate-browser-lock.mjs';
import { imwebRequestFailure, isTransientReadFailure, sanitizeImwebFailureDetails } from './imweb-read-failure.mjs';
import { observeAutomationRun, sendAutomationHealthEmail } from './automation-failure-notifications.mjs';
import { formatOperationsReport } from './operations-email-format.mjs';

const emailContext = { area: '강사레슨', title: '홈페이지 자동접수', link: 'https://core.archivepilates.com/instructor-lessons/' };

export function imwebOrderRead(args, { execute = execFileSync,
  wait = milliseconds => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds) } = {}) {
  const readOnly = args[0] === 'order' && ['get', 'list'].includes(args[1]);
  const operation = readOnly ? `order_${args[1]}` : args[0] === 'config' && args[1] === 'context' ? 'config_context' : 'other_request';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = JSON.parse(execute(process.env.IMWEB_CLI_BIN || path.join(os.homedir(), '.local/bin/imweb'),
        ['--profile', 'default', '--output', 'json', ...args], { encoding: 'utf8', timeout: 45000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        throw Object.assign(new Error(), { failureKind: 'invalid_envelope' });
      }
      if (result.ok === false || result.error != null ||
        [result.statusCode, result.status_code].some(status => status !== undefined && Number(status) !== 200)) {
        throw Object.assign(new Error(), { stdout: JSON.stringify(result) });
      }
      return result;
    } catch (error) {
      const failure = imwebRequestFailure(error, { readOnly, operation });
      failure.failureDetails = sanitizeImwebFailureDetails({ ...failure.failureDetails,
        readAttempts: attempt + 1, failureKind: error instanceof SyntaxError ? 'invalid_json' : error.failureKind });
      // Only verified read failures retry; never repeat member-facing writes or auth failures.
      if (attempt === 0 && isTransientReadFailure(failure)) { wait(500); continue; }
      throw failure;
    }
  }
}
function readOrderSource(args, phase, read) {
  try { return read(args); }
  catch (error) {
    error.failureDetails = sanitizeImwebFailureDetails({ ...error.failureDetails, phase });
    throw error;
  }
}
function invalidOrderSource(message, phase, operation) {
  return Object.assign(new Error(message), { code: 'IMWEB_ORDER_SOURCE_INVALID',
    failureDetails: sanitizeImwebFailureDetails({ phase, operation, failureKind: 'source_validation' }) });
}
export function verifyImwebSite(read = imwebOrderRead, phase = 'order_scan') {
  const c = readOrderSource(['config', 'context'], phase, read);
  if (c.resolved_profile?.site_code !== policy.siteCode || c.resolved_profile?.unit_code !== policy.unitCode) {
    throw invalidOrderSource('아임웹 사이트 불일치: 주문 등록 중단', phase, 'config_context');
  }
}
export function readImwebOrder(orderNo, read = imwebOrderRead) {
  if (!/^\d{15}$/.test(String(orderNo))) throw new Error('Invalid order number');
  verifyImwebSite(read, 'order_readback');
  const { data } = readOrderSource(['order', 'get', String(orderNo)], 'order_readback', read);
  if (String(data?.orderNo) !== String(orderNo)) throw invalidOrderSource('아임웹 주문번호 불일치', 'order_readback', 'order_get');
  return data;
}
export function readRecentImwebOrders(read = imwebOrderRead, now = new Date()) {
  verifyImwebSite(read);
  const cutoff = now.getTime() - 30 * 86400000;
  const result = [];
  let previous = Infinity;
  for (let page = 1; page <= 10; page++) {
    const { data } = readOrderSource(['order', 'list', '--unit-code', policy.unitCode, '--page', String(page), '--limit', '50'], 'order_scan', read);
    if (!Array.isArray(data?.list) || data.currentPage !== page || !Number.isInteger(data.totalPage) || data.totalPage < 0 ||
      data.totalPage < page && data.list.length > 0) throw invalidOrderSource('아임웹 주문 페이지 구조 확인필요', 'order_scan', 'order_list');
    for (const order of data.list) {
      const time = Date.parse(order.wtime);
      if (!Number.isFinite(time) || time > previous) throw invalidOrderSource('아임웹 주문 시간 정렬 확인필요', 'order_scan', 'order_list');
      previous = time;
      if (time < cutoff) return result;
      result.push(order);
    }
    if (page >= data.totalPage || data.totalCount === 0) return result;
  }
  throw invalidOrderSource('최근 30일 주문 조회 상한 초과: 전체 조회 전 자동 등록 중단', 'order_scan', 'order_list');
}

const step = (status, label, detail = '') => ({ status, label, detail });
export function resolvedPaymentMethodIssue(item) {
  return item.status === 'queued' || (item.status === 'unchanged' && (item.paymentMethodReviewResolved === true || item.attendeeResolutionVerified === true));
}
export function registrationDocument(input, now) {
  return {
    registrationId: input.registrationId, idempotencyKey: input.registrationId, studioId: policy.studioId,
    memberName: input.memberName, memberPhone: input.memberPhone, phoneLast4: input.memberPhone.slice(-4),
    lessonDate: input.lessonDate, paymentMethod: input.paymentMethod, ticketName: '강사레슨 (2T)',
    ticketPrice: input.paidAmount, mode: 'unresolved', status: 'queued',
    operatorChecks: { paymentConfirmed: true, seatConfirmed: true, basis: 'verified_imweb_paid_order_and_capacity' },
    source: { type: 'imweb_paid_order', sourceId: input.orderNo, itemNo: input.itemNo, siteCode: policy.siteCode },
    externalOrder: input,
    createdBy: { staffId: 'imweb-order-automation', name: '홈페이지 결제 자동접수', email: null },
    steps: {
      member: step('pending', '회원·등급 확인'), ticket: step('pending', '강사레슨 (2T) 발급', `홈페이지 ${input.paidAmount.toLocaleString('ko-KR')}원 결제 / 주문 ${input.orderNo}`),
      bookings: step('not_required', '반배정·예약(수동)', '운영자가 StudioMate에서 직접 처리'),
      eformsign: step('pending', '강사회원 가입서 판정'), memo: step('pending', '가입서 완료 메모'),
      confirmation: step('pending', '예약확정 안내', '수강권 발급 검증 후 1회 발송'),
    },
    lastError: null, nextAction: 'StudioMate 회원·등급 확인', createdAt: now, updatedAt: now,
  };
}

export function activeIdentities(registrations, holders, date, bookings, lectures) {
  const members = new Set();
  const cancelledPhones = new Set(registrations.docs.map(doc => doc.data()).filter(d => d.studioId === policy.studioId
    && d.lessonDate === date && d.status === 'cancelled' && d.cancellation?.nativeVerified === true)
    .map(d => normalizeInstructorLessonPhone(d.memberPhone)).filter(Boolean));
  const add = (data, id) => { const phone = normalizeInstructorLessonPhone(data.memberPhone || data.phone);
    if (!cancelledPhones.has(phone)) members.add(phone || `id:${id}`); };
  for (const doc of registrations.docs) {
    const d = doc.data();
    if (isInstructorLessonWaitlist(d)) continue;
    if (d.studioId === policy.studioId && !['cancelled', 'canceled', 'rejected'].includes(d.status)
      && !d.newMemberSimulation && d.source?.type !== 'imweb_order_review') add(d, doc.id);
  }
  for (const doc of holders.docs) {
    const d = doc.data();
    if ((d.activeTickets || []).some(t => {
      if (t.name !== '강사레슨 (2T)') return false;
      const raw = t.availableFrom || t.startAt || t.startDate;
      const key = raw?.toDate ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(raw.toDate()) : String(raw || '').slice(0, 10);
      return key === date;
    })) add(d, doc.id);
  }
  const lectureIds = new Set(lectures.map(d => d.id));
  for (const doc of bookings.docs) {
    const d = doc.data();
    if (d.studioId !== policy.studioId || /cancel|delete|취소|삭제/i.test(String(d.status || d.reservationStatus || ''))) continue;
    if (d.ticketName === '강사레슨 (2T)' || lectureIds.has(String(d.lectureId || '')) || /강사\s*레슨/.test(d.lectureTitle || d.lessonTitle || '')) add(d, doc.id);
  }
  return members;
}

export async function importInstructorOrder(db, order, { apply = false, now = new Date(), tracked = false } = {}) {
  const allocationLedger = await db.collection('imwebInstructorLessonOrders').doc(orderLedgerId(order.orderNo)).get();
  if (allocationLedger.data()?.attendeeResolution) {
    const { reconcileInstructorOrderAttendees } = await import('./imweb-instructor-order-attendees.mjs');
    return reconcileInstructorOrderAttendees(db, order, { apply, now });
  }
  let input = assessInstructorOrder(order, { now });
  if (input.status === 'ignored') {
    if (!tracked) return input;
    const ledger = await db.collection('imwebInstructorLessonOrders').doc(orderLedgerId(order.orderNo)).get();
    if (!ledger.data()?.registrationId) return input;
    const registration = await db.collection('instructorLessonRegistrations').doc(ledger.data().registrationId).get();
    if (registration.data()?.externalOrder?.orderNo !== String(order.orderNo)) return input;
    input = { ...registration.data().externalOrder, status: 'review_required', reason: '접수 후 홈페이지 상품·결제 조건 변경: 운영자 확인' };
  }
  const fingerprint = orderFingerprint(order);
  const ledgerRef = db.collection('imwebInstructorLessonOrders').doc(orderLedgerId(order.orderNo));
  const registrationRef = db.collection('instructorLessonRegistrations').doc(input.registrationId);
  const jobRef = db.collection('studiomateInstructorLessonJobs').doc(input.registrationId);
  if (!apply) {
    const [ledger, existing] = await Promise.all([ledgerRef.get(), registrationRef.get()]);
    return { ...input, status: existing.exists ? 'duplicate' : input.status, ledgerExists: ledger.exists, mode: 'dry-run' };
  }
  return db.runTransaction(async tx => {
    const [ledger, registration, job] = await Promise.all([tx.get(ledgerRef), tx.get(registrationRef), tx.get(jobRef)]);
    const old = ledger.data() || {};
    const reg = registration.data();
    if (reg?.cancellation?.jobId) return { status: 'unchanged', orderNo: input.orderNo, reason: '운영자 수강 취소 요청 보존' };
    const promotableReview = reg?.source?.type === 'imweb_order_review'
      && reg.source.sourceId === input.orderNo && old.registrationId === input.registrationId
      && reg.status === 'action_required' && reg.lastError === old.reason
      && !reg.externalOrderReviewRequired && !reg.externalEffectStarted
      && !reg.evidence && !reg.ticketId && !reg.completedAt && !job.exists
      && Object.values(reg.steps || {}).every(s => ['pending', 'not_required'].includes(s.status));
    // Only the obsolete method-only hold may bypass an unchanged source fingerprint.
    const paymentMethodReassessment = input.status === 'ready' && old.status === 'review_required'
      && needsPaymentMethodReassessment(old.reason) && promotableReview;
    if (ledger.exists && old.fingerprint === fingerprint && !paymentMethodReassessment) return {
      status: 'unchanged', orderNo: input.orderNo,
      paymentMethodReviewResolved: old.status === 'queued' && old.registrationId === input.registrationId
        && reg?.source?.type === 'imweb_paid_order' && reg.source.sourceId === input.orderNo
        && !reg.externalOrderReviewRequired && job.data()?.externalOrder?.orderNo === input.orderNo,
    };
    if (old.status === 'duplicate') {
      tx.set(ledgerRef, { fingerprint, updatedAt: now }, { merge: true });
      return { status: 'duplicate', orderNo: input.orderNo, reason: '기존 수동 접수 또는 다른 주문과 중복: 자동 변경하지 않음' };
    }
    if (registration.exists && old.registrationId === input.registrationId && input.status === 'ready'
      && registration.data().source?.type === 'imweb_paid_order' && !registration.data().externalOrderReviewRequired) {
      try {
        assertSamePaidOrder({ externalOrder: registration.data().externalOrder }, order);
        tx.set(ledgerRef, { fingerprint, lastVerifiedAt: now, updatedAt: now }, { merge: true });
        return { status: 'unchanged', orderNo: input.orderNo };
      } catch { /* Material order changes require operator review below. */ }
    }
    // Changed recipient/date must never create a second job for an already admitted order.
    if (old.registrationId && old.registrationId !== input.registrationId) {
      const oldRef = db.collection('instructorLessonRegistrations').doc(old.registrationId);
      const oldJobRef = db.collection('studiomateInstructorLessonJobs').doc(old.registrationId);
      const [oldReg, oldJob] = await Promise.all([tx.get(oldRef), tx.get(oldJobRef)]);
      if (oldReg.data()?.cancellation?.jobId) {
        tx.set(ledgerRef, { fingerprint, status: 'review_required', reason: '수강 취소 후 주문 일정·수강자 변경: 기존 취소 이력 보존', updatedAt: now }, { merge: true });
        return { status: 'review_required', orderNo: input.orderNo, reason: '취소 이력 보존 · 새 일정 접수 운영자 확인' };
      }
      const reason = '홈페이지 주문 수강자·날짜 변경: 기존 발급 및 새 일정 운영자 확인';
      if (oldReg.exists && oldReg.data().source?.sourceId === input.orderNo) tx.update(oldRef, { status: 'action_required', lastError: reason, externalOrderReviewRequired: true, 'operatorChecks.paymentConfirmed': false, updatedAt: now });
      if (oldJob.exists && oldJob.data().externalOrder?.orderNo === input.orderNo && ['pending', 'retry'].includes(oldJob.data().status)) tx.update(oldJobRef, { status: 'review_required', lastError: reason, updatedAt: now });
      tx.set(ledgerRef, { fingerprint, status: 'review_required', reason, updatedAt: now }, { merge: true });
      return { status: 'review_required', orderNo: input.orderNo, reason };
    }
    let reason = input.status === 'ready' ? '' : input.reason;
    if (registration.exists && registration.data().source?.sourceId !== input.orderNo) {
      tx.set(ledgerRef, { orderNo: input.orderNo, registrationId: input.registrationId, fingerprint, status: 'duplicate', reason: '동일 연락처·수강일 접수 존재: 기존 발급 재확인', updatedAt: now });
      return { status: 'duplicate', orderNo: input.orderNo, registrationId: input.registrationId };
    }
    if (job.exists && !registration.exists) reason = '기존 작업 원본 불일치 확인필요';
    if (!reason && (!registration.exists || promotableReview)) {
      const [registrations, holders, bookingRows, lectureRows] = await Promise.all([
        tx.get(db.collection('instructorLessonRegistrations').where('lessonDate', '==', input.lessonDate)),
        tx.get(db.collection('memberProfiles').where('studioId', '==', policy.studioId).where('activeTicketNames', 'array-contains', '강사레슨 (2T)')),
        tx.get(db.collection('bookings').where('studioId', '==', policy.studioId).where('lectureDate', '==', input.lessonDate)),
        tx.get(db.collection('lectures').where('studioId', '==', policy.studioId).where('date', '==', input.lessonDate)),
      ]);
      const lectures = lectureRows.docs.filter(d => /강사\s*레슨/.test([d.data().title, d.data().name, d.data().lectureTitle, d.data().lessonTitle].join(' ')));
      const slots = new Map();
      for (const doc of lectures) {
        const d = doc.data();
        const start = d.startAt?.toMillis?.() || d.startTime;
        if (!start || !Number.isInteger(d.capacity) || d.capacity <= 0) { reason = '강사레슨 수업 정원 원본 확인필요'; break; }
        slots.set(String(start), (slots.get(String(start)) || 0) + d.capacity);
      }
      const capacity = slots.size ? Math.min(policy.capacity, Math.max(...slots.values())) : policy.capacity;
      const members = activeIdentities(registrations, holders, input.lessonDate, bookingRows, lectures);
      if (!members.has(input.memberPhone) && members.size >= capacity) reason = `강사레슨 정원 ${capacity}명 도달: 반배정·정원 운영자 확인`;
    }
    if (registration.exists && !promotableReview) {
      if (reason || old.fingerprint !== fingerprint) {
        reason ||= reg.lastError || '이미 접수된 홈페이지 주문 정보 변경 확인필요';
        tx.update(registrationRef, { status: 'action_required', externalOrderReviewRequired: true, 'operatorChecks.paymentConfirmed': false, lastError: reason, updatedAt: now });
        if (job.exists && ['pending', 'retry'].includes(job.data().status)) tx.update(jobRef, { status: 'review_required', lastError: reason, updatedAt: now });
      }
    } else {
      const doc = registrationDocument(input, now);
      if (reason) {
        Object.assign(doc, { status: 'action_required', source: { ...doc.source, type: 'imweb_order_review' }, lastError: reason, nextAction: '홈페이지 주문 확인', operatorChecks: { paymentConfirmed: false, seatConfirmed: false } });
      }
      if (promotableReview) tx.set(registrationRef, doc);
      else tx.create(registrationRef, doc);
      if (!reason) tx.create(jobRef, {
        jobId: input.registrationId, registrationId: input.registrationId, studioId: policy.studioId,
        memberName: input.memberName, memberPhone: input.memberPhone, lessonDate: input.lessonDate,
        paymentMethod: input.paymentMethod, ticketName: '강사레슨 (2T)', ticketPrice: input.paidAmount,
        externalOrder: input, status: 'pending', currentStep: 'member', attempts: 0, maxAttempts: 3,
        externalEffectStarted: false, createdAt: now, updatedAt: now,
      });
    }
    tx.set(ledgerRef, { orderNo: input.orderNo, itemNo: input.itemNo, registrationId: input.registrationId, fingerprint,
      status: reason ? 'review_required' : 'queued', reason: reason || input.reason, paymentAmount: input.paidAmount,
      lastVerifiedAt: now, updatedAt: now }, { merge: true });
    return { status: reason ? 'review_required' : 'queued', orderNo: input.orderNo, registrationId: input.registrationId, reason };
  });
}

export async function syncImwebInstructorOrders(db, { apply = false, orderNo = '', force = false, read = imwebOrderRead,
  recordStatus = recordAutomationStatus, attention = notifyAttention,
  notify = event => sendAutomationHealthEmail(emailContext, event),
  stateDir = path.join(os.homedir(), 'ArchiveIN/automation/imweb-instructor-orders') } = {}) {
  if (!apply) {
    const orders = orderNo ? [readImwebOrder(orderNo, read)] : readRecentImwebOrders(read);
    const items = [];
    for (const order of orders) items.push(await importInstructorOrder(db, order));
    return { ok: true, mode: 'dry-run', items };
  }
  await mkdir(stateDir, { recursive: true });
  const release = await acquireStudioMateBrowserLock({ lockPath: path.join(stateDir, 'scan.lock'), owner: 'imweb-instructor-order-scan', waitMs: 0, staleMs: 10 * 60 * 1000 });
  try {
    const file = path.join(stateDir, 'state.json');
    let state = {};
    try { state = JSON.parse(await readFile(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (!force && !orderNo && Date.now() - (state.attemptedAt || 0) < policy.intervalMs) return { ok: true, skipped: 'throttled' };
    state.attemptedAt = Date.now();
    await writeFile(file, JSON.stringify(state), { mode: 0o600 });
    const orders = orderNo ? [readImwebOrder(orderNo, read)] : readRecentImwebOrders(read);
    const fingerprints = state.fingerprints || {};
    const issues = state.issues || {};
    const watch = Object.fromEntries(Object.entries(state.watch || {}).filter(([, until]) => until > Date.now()));
    if (!orderNo) {
      const listed = new Set(orders.map(o => String(o.orderNo)));
      for (const no of Object.keys(watch)) if (!listed.has(no)) orders.push(readImwebOrder(no, read));
    }
    const items = [];
    for (const order of orders) {
      if (!orderNo && fingerprints[order.orderNo] === orderFingerprint(order)
        && !needsPaymentMethodReassessment(issues[order.orderNo])
        && !/복수 상품·인원|다인 주문|실제 수강자/.test(issues[order.orderNo] || '')) continue;
      if (assessInstructorOrder(order).status === 'ignored' && !watch[order.orderNo]) continue;
      // Re-read the exact source immediately before admitting any external work.
      const fresh = readImwebOrder(order.orderNo, read);
      const item = await importInstructorOrder(db, fresh, { apply: true, tracked: Boolean(watch[order.orderNo]) });
      items.push(item);
      if (['review_required', 'duplicate'].includes(item.status)) issues[item.orderNo] = item.reason || '기존 접수와 홈페이지 주문 연결 확인필요';
      else if (resolvedPaymentMethodIssue(item)) delete issues[item.orderNo];
      fingerprints[order.orderNo] = orderFingerprint(fresh);
      const assessment = assessInstructorOrder(fresh);
      if (assessment.lessonDate) watch[order.orderNo] = Date.parse(`${assessment.lessonDate}T23:59:59+09:00`) + 86400000;
    }
    const result = { ok: Object.keys(issues).length === 0, mode: 'apply', scanned: orders.length, items, issues, finishedAt: new Date().toISOString() };
    const next = { attemptedAt: Date.now(), fingerprints, watch, issues, result };
    await writeFile(`${file}.tmp`, JSON.stringify(next), { mode: 0o600 });
    await rename(`${file}.tmp`, file);
    await recordStatus(db, { automationId: 'imweb-instructor-lesson-orders', title: '홈페이지 강사레슨 자동접수', ownerArea: 'instructor-lessons', status: result.ok ? 'healthy' : 'warning', lastResult: `최근 30일 주문 ${orders.length}건 확인 / 변경 처리 ${items.length}건`, warnings: Object.entries(issues).map(([no, reason]) => `${no}: ${reason}`) });
    if (!orderNo) await observeAutomationRun(stateDir, { ok: result.ok, blocked: !result.ok }, notify);
    if (!result.ok) await attention(stateDir, Object.entries(issues).map(([no, reason]) => `${no}: ${reason}`).join('\n'));
    return result;
  } catch (error) {
    let alert;
    try {
      // A one-order manual check cannot clear or count toward the scheduled scan incident.
      if (!orderNo) alert = await observeAutomationRun(stateDir, { ok: false,
        transient: isTransientReadFailure(error), errorCode: error.code || 'ORDER_INTAKE_FAILED',
        failureDetails: sanitizeImwebFailureDetails(error.failureDetails) }, notify);
      else await attention(stateDir, String(error.message));
    } catch { console.error('홈페이지 자동접수 오류 알림 상태 저장 실패'); }
    if (alert) error.queryAlertObservedAt = alert.observedAt;
    try {
      const details = sanitizeImwebFailureDetails(error.failureDetails);
      await recordStatus(db, { automationId: 'imweb-instructor-lesson-orders', title: '홈페이지 강사레슨 자동접수', ownerArea: 'instructor', status: 'failed', lastResult: `${String(error.message).slice(0, 240)}${alert ? ` / 연속 실패 ${alert.consecutiveFailures}회` : ''}`,
        warnings: Object.entries(details).map(([name, value]) => `${name}: ${value}`) });
    } catch { console.error('홈페이지 자동접수 관제 상태 저장 실패'); }
    throw error;
  } finally { await release(); }
}

async function notifyAttention(stateDir, detail) {
  const file = path.join(stateDir, 'attention-email.json');
  const fingerprint = orderFingerprint(detail);
  let previous = {};
  try { previous = JSON.parse(await readFile(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (previous.fingerprint === fingerprint && Date.now() - previous.sentAt < 86400000) return;
  const root = new URL('../../', import.meta.url);
  const report = formatOperationsReport({ area: '강사레슨', status: '확인필요', title: '홈페이지 결제 접수 검토',
    observedAt: new Date().toISOString(), context: '홈페이지 강사레슨 자동접수',
    conclusion: '주문 원본 또는 접수 결과 확인이 필요합니다.', key: [`원인: ${detail.slice(0, 1200)}`],
    verification: ['접수 결과가 확정되지 않았습니다.'],
    caution: ['불확실한 주문은 신규 회원·수강권 발급을 중단합니다. 이미 발급된 건은 자동 삭제하지 않습니다.'],
    next: ['CORE에서 접수 단계와 아임웹 해당 주문을 확인하세요.'],
    details: [emailContext.link, 'https://archivepilates.imweb.me/admin'],
  });
  try {
    execFileSync(process.execPath, ['firebase/kangsain-functions/macmini-studiomate/send-automation-report.mjs'], {
      cwd: root, timeout: 45000, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GOOGLE_SERVICE_ACCOUNT_KEY: path.join(os.homedir(), 'ArchiveIN/secrets/google/archive-codex-operator.json'),
        AUTOMATION_REPORT_FROM: 'home@archivepilates.com', AUTOMATION_REPORT_TO: 'home@archivepilates.com',
        AUTOMATION_REPORT_SUBJECT: report.subject, AUTOMATION_REPORT_LABEL: '자동화 확인필요',
        AUTOMATION_REPORT_BODY: report.body,
      },
    });
    await writeFile(file, JSON.stringify({ fingerprint, sentAt: Date.now() }), { mode: 0o600 });
  } catch { console.error('홈페이지 강사레슨 확인필요 메일 발송 확인 실패'); }
}
