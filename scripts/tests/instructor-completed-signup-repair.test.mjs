import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planCompletedInstructorSignupRepair } from '../lib/instructor-completed-signup-repair.mjs';
import { deriveInstructorLessonRegistrationState } from '../lib/instructor-lesson-registration-contract.mjs';

const NOW = new Date('2026-10-29T14:10:00.000Z');
const ID = 'ilr_b4c0fd50f082d92a1735f196';
const DOC = 'f3a607291be0429c8add02b4ddcbb893';
const TEMPLATE = 'a5b5ea6b85ec44c8bcb4af1e980e94eb';
const KEYS = ['mode', 'steps.eformsign', 'steps.memo', 'evidence.eformsignDocumentId',
  'evidence.signupReconciliation', 'lastError', 'status', 'nextAction'].sort();
const clone = structuredClone;

function fixture() {
  const registration = {
    registrationId: ID, studioId: '5330', memberName: '안소은', memberPhone: '01000000001',
    lessonDate: '2026-11-28', mode: 'unresolved', status: 'processing', nextAction: '회원 유형 확인',
    ticketName: '강사레슨 (2T)', ticketPrice: 0, paymentMethod: null, lastError: null,
    steps: { member: { status: 'verified', detail: 'synthetic native verification' },
      ticket: { status: 'verified', detail: 'synthetic existing complimentary ticket' },
      confirmation: { status: 'verified', messageId: 'MSYNTHETIC', providerStatus: 'COMPLETE', providerStatusCode: '4000' },
      eformsign: { status: 'review_required', detail: '기존 가입서 이력 별도 확인 필요', originalMarker: 'preserve' },
      memo: { status: 'pending', originalMarker: 'preserve' },
      bookings: { status: 'not_required', existingIds: ['synthetic-booking'] },
      unrelated: { status: 'verified', extra: true } },
    evidence: { studiomateMemberId: '4342056', ticketId: '90000001', ticketPaymentAmount: 0, existingTicketAdopted: true,
      confirmationCandidateId: 'synthetic-existing-candidate', confirmationSolapiMessageId: 'MSYNTHETIC',
      complimentaryApproval: { expectedAmount: 0, operationKey: 'synthetic-original-approval', actor: 'operator' },
      unrelatedEvidence: { retained: true } },
    source: { type: 'studiomate_existing_complimentary_ticket_operator', sourceId: '90000001', approvalKey: 'synthetic-original-approval' },
    operatorChecks: { paymentConfirmed: true, seatConfirmed: true, complimentaryConfirmed: true, paymentBasis: 'operator_approved_complimentary' },
    externalOrder: null, createdAt: 'synthetic-creation-time', updatedAt: 'synthetic-cas-version', custom: { keep: ['all', 'unrelated'] },
  };
  const proof = { registrationId: ID, registrationUpdateTime: '2026-10-29T14:00:00.000Z',
    member: { memberId: '4342056', name: '안소은', phone: '01000000001', inactive: false, memberGrade: '강사회원' },
    nativeCheckedAt: '2026-10-29T14:09:00.000Z', checkedAt: '2026-10-29T14:09:59.000Z',
    completedSignup: { documentId: DOC, templateId: TEMPLATE, documentName: '2025-12-30_강사회원가입서__안소은',
      status: 'completed', memberName: '안소은', memberPhone: '01000000001', recipientCount: 1,
      completedAt: '2025-12-30T15:36:00+09:00', searchTotal: 1, historyHash: 'a'.repeat(64),
      checkedAt: '2026-10-29T14:09:58.000Z' } };
  return { registration, proof, now: new Date(NOW) };
}

function applyFlatPatch(source, patch) {
  const result = clone(source);
  for (const [field, value] of Object.entries(patch)) {
    const parts = field.split('.'); let parent = result;
    for (const part of parts.slice(0, -1)) parent = parent[part] ||= {};
    parent[parts.at(-1)] = clone(value);
  }
  return result;
}

test('pure plan returns exactly the permitted flat patch, derived completion and no new-send/memo-synced claim', () => {
  const f = fixture(), before = clone(f), patch = planCompletedInstructorSignupRepair(f);
  assert.deepEqual(Object.keys(patch).sort(), KEYS);
  assert.equal(patch.mode, 'returning_member');
  assert.equal(patch['steps.eformsign'].status, 'verified');
  assert.equal(patch['steps.memo'].status, 'not_required');
  assert.equal(patch['evidence.eformsignDocumentId'], DOC);
  assert.equal(patch.status, 'completed'); assert.equal(patch.nextAction, '없음');
  assert.equal(patch.lastError, null);
  assert.deepEqual({ status: patch.status, nextAction: patch.nextAction }, deriveInstructorLessonRegistrationState({
    mode: patch.mode, steps: { ...f.registration.steps, eformsign: patch['steps.eformsign'], memo: patch['steps.memo'] } }));
  assert.equal(patch['evidence.signupReconciliation'].historyHash, f.proof.completedSignup.historyHash);
  assert.match(patch['steps.eformsign'].detail, /신규 발송 없음/);
  assert.match(patch['steps.memo'].detail, /메모 생성 없음/);
  assert.doesNotMatch(JSON.stringify(patch), /"synced"|생년월일.*반영 완료|01000000001|studiomateMemoWriteJobs|eformsignInstructorMemberJobs/);
  assert.deepEqual(f, before);
});

test('applying the dotted patch preserves confirmation, free native ticket, source and all unrelated fields', () => {
  const f = fixture(), r = f.registration, patch = planCompletedInstructorSignupRepair(f), updated = applyFlatPatch(r, patch);
  for (const key of ['registrationId', 'studioId', 'memberName', 'memberPhone', 'lessonDate', 'ticketName',
    'ticketPrice', 'paymentMethod', 'source', 'operatorChecks', 'externalOrder', 'createdAt', 'updatedAt', 'custom']) {
    assert.deepEqual(updated[key], r[key], key);
  }
  for (const key of ['member', 'ticket', 'confirmation', 'bookings', 'unrelated']) assert.deepEqual(updated.steps[key], r.steps[key], key);
  for (const key of Object.keys(r.evidence)) assert.deepEqual(updated.evidence[key], r.evidence[key], key);
  assert.equal(updated.steps.eformsign.originalMarker, 'preserve');
  assert.equal(updated.steps.memo.originalMarker, 'preserve');
  assert.equal(updated.ticketPrice, 0); assert.equal(updated.evidence.ticketPaymentAmount, 0);
});

for (const [label, change] of Object.entries({
  wrongRegistration: f => { f.registration.registrationId = 'ilr_other'; },
  wrongProofRegistration: f => { f.proof.registrationId = 'ilr_other'; },
  wrongStudio: f => { f.registration.studioId = 'other'; },
  wrongDate: f => { f.registration.lessonDate = '2026-11-29'; },
  wrongCanonicalName: f => { f.registration.memberName = '다른회원'; },
  wrongCanonicalMember: f => { f.registration.evidence.studiomateMemberId = '999'; },
  conflictingTopLevelMember: f => { f.registration.studiomateMemberId = '999'; },
  wrongNativeMember: f => { f.proof.member.memberId = '999'; },
  wrongNativeName: f => { f.proof.member.name = '다른회원'; },
  wrongNativePhone: f => { f.proof.member.phone = '01000000002'; },
  maskedNativePhone: f => { f.proof.member.phone = '010****0001'; },
  inactiveNative: f => { f.proof.member.inactive = true; },
  wrongGrade: f => { f.proof.member.memberGrade = '일반회원'; },
  wrongDocument: f => { f.proof.completedSignup.documentId = 'b'.repeat(32); },
  wrongTemplate: f => { f.proof.completedSignup.templateId = 'b'.repeat(32); },
  wrongTitle: f => { f.proof.completedSignup.documentName = '2025-12-30_강사회원가입서_다른회원'; },
  unsignedDocument: f => { f.proof.completedSignup.status = 'in_progress'; },
  wrongSignupName: f => { f.proof.completedSignup.memberName = '다른회원'; },
  wrongSignupPhone: f => { f.proof.completedSignup.memberPhone = '01000000002'; },
  maskedSignupPhone: f => { f.proof.completedSignup.memberPhone = '010****0001'; },
  maskedCanonicalPhone: f => { f.registration.memberPhone = '010****0001'; },
  junkPhone: f => { f.proof.member.phone = 'junk01000000001'; },
  noRecipient: f => { f.proof.completedSignup.recipientCount = 0; },
  multipleRecipients: f => { f.proof.completedSignup.recipientCount = 2; },
  ambiguousSearch: f => { f.proof.completedSignup.searchTotal = 2; },
  missingHistory: f => { delete f.proof.completedSignup.historyHash; },
  invalidHistory: f => { f.proof.completedSignup.historyHash = 'not-a-sha256'; },
  wrongCompletionTime: f => { f.proof.completedSignup.completedAt = '2025-12-30T15:37:00+09:00'; },
  wrongMode: f => { f.registration.mode = 'new_member'; },
  wrongSignupStep: f => { f.registration.steps.eformsign.status = 'pending'; },
  wrongMemoStep: f => { f.registration.steps.memo.status = 'queued'; },
  memberUnverified: f => { f.registration.steps.member.status = 'pending'; },
  ticketUnverified: f => { f.registration.steps.ticket.status = 'review_required'; },
  confirmationUnverified: f => { f.registration.steps.confirmation.status = 'sent'; },
  missingCandidate: f => { delete f.registration.evidence.confirmationCandidateId; },
  missingMessage: f => { delete f.registration.evidence.confirmationSolapiMessageId; },
  cancellation: f => { f.registration.cancellation = { jobId: 'synthetic-cancel' }; },
  emptyCancellation: f => { f.registration.cancellation = {}; },
  falseCancellation: f => { f.registration.cancellation = false; },
  cancellationJob: f => { f.registration.cancellationJobId = 'synthetic-cancel'; },
  refunded: f => { f.registration.refunded = true; },
  sourceHold: f => { f.registration.externalOrderReviewRequired = true; },
  externalEffect: f => { f.registration.externalEffectStarted = true; },
  oldEffect: f => { f.registration.effectStartedAt = 'synthetic-effect'; },
  existingDoc: f => { f.registration.evidence.eformsignDocumentId = DOC; },
  existingJob: f => { f.registration.evidence.eformsignJobId = 'synthetic-job'; },
  existingReconciliation: f => { f.registration.evidence.signupReconciliation = {}; },
  paidPrice: f => { f.registration.ticketPrice = 70000; },
  changedTicketAmount: f => { f.registration.evidence.ticketPaymentAmount = 70000; },
  missingTicketId: f => { delete f.registration.evidence.ticketId; },
  ticketNotAdopted: f => { f.registration.evidence.existingTicketAdopted = false; },
  changedTicketSource: f => { f.registration.source.sourceId = 'different-ticket'; },
  mirrorSource: f => { f.registration.source.type = 'workLanes/provisional'; },
  missingFreeApproval: f => { f.registration.operatorChecks.complimentaryConfirmed = false; },
  wrongPaymentBasis: f => { f.registration.operatorChecks.paymentBasis = 'paid'; },
  wrongPaymentMethod: f => { f.registration.paymentMethod = 'card'; },
  unrelatedError: f => { f.registration.lastError = 'unrelated operational error'; },
  invalidClock: f => { f.now = new Date('invalid'); },
})) test('rejects ' + label + ' without mutating inputs', () => {
  const f = fixture(); change(f); const before = clone(f);
  assert.throws(() => planCompletedInstructorSignupRepair(f));
  assert.deepEqual(f, before);
});

for (const status of ['cancelled', 'canceled', 'rejected', 'cancellation_pending', 'cancellation_review', 'refunded', 'refund_pending', 'completed']) {
  test('rejects closed/cancelled registration status ' + status, () => {
    const f = fixture(); f.registration.status = status;
    assert.throws(() => planCompletedInstructorSignupRepair(f));
  });
}

for (const [label, target] of [['native', f => [f.proof, 'nativeCheckedAt']],
  ['document', f => [f.proof.completedSignup, 'checkedAt']], ['overall', f => [f.proof, 'checkedAt']]]) {
  for (const [state, value] of [['stale', '2026-10-29T13:59:59.999Z'], ['future', '2026-10-29T14:10:00.001Z'],
    ['invalid', 'invalid'], ['missing', undefined]]) test(`rejects ${state} ${label} proof timestamp`, () => {
    const f = fixture(), [row, key] = target(f); row[key] = value;
    assert.throws(() => planCompletedInstructorSignupRepair(f));
  });
}

test('accepts exactly ten-minute-old proof and rejects reversed chronology', () => {
  const f = fixture();
  f.proof.nativeCheckedAt = f.proof.completedSignup.checkedAt = f.proof.checkedAt = '2026-10-29T14:00:00.000Z';
  assert.equal(planCompletedInstructorSignupRepair(f).status, 'completed');
  f.proof.completedSignup.checkedAt = '2026-10-29T13:59:59.999Z';
  assert.throws(() => planCompletedInstructorSignupRepair(f));
  const reversed = fixture(); reversed.proof.nativeCheckedAt = reversed.proof.checkedAt;
  assert.throws(() => planCompletedInstructorSignupRepair(reversed));
});

test('normalizes full international/formatted phones and accepts the same completion instant in UTC', () => {
  const f = fixture(); f.proof.member.phone = '+82 10-0000-0001';
  f.proof.completedSignup.memberPhone = '010-0000-0001';
  f.proof.completedSignup.completedAt = '2025-12-30T06:36:00Z';
  assert.equal(planCompletedInstructorSignupRepair(f).status, 'completed');
});

for (const completedAt of ['2025-12-30T15:36:00+09:00', '2025-12-30T15:36:27.123+09:00',
  '2025-12-30T06:36:27.123Z', '2025-12-30T06:36:59.999Z']) {
  test('accepts the approved completion minute and preserves exact provider timestamp ' + completedAt, () => {
    const f = fixture(); f.proof.completedSignup.completedAt = completedAt;
    const patch = planCompletedInstructorSignupRepair(f);
    assert.equal(patch.status, 'completed');
    assert.equal(patch['evidence.signupReconciliation'].completedAt, completedAt);
    assert.equal(patch['evidence.signupReconciliation'].historyHash, f.proof.completedSignup.historyHash);
  });
}

for (const completedAt of ['2025-12-30T06:35:59.999Z', '2025-12-30T06:37:00.000Z',
  '2025-12-30T15:36:27.123Z', '2025-12-31T06:36:27.123Z']) {
  test('rejects completion outside the approved minute ' + completedAt, () => {
    const f = fixture(); f.proof.completedSignup.completedAt = completedAt;
    assert.throws(() => planCompletedInstructorSignupRepair(f), /COMPLETION_TIME_MISMATCH/);
  });
}

test('clears only the exact reviewed signup error and preserves confirmation evidence', () => {
  const f = fixture(); f.registration.lastError = f.registration.steps.eformsign.detail;
  const patch = planCompletedInstructorSignupRepair(f);
  assert.equal(patch.lastError, null);
  assert.equal(patch['steps.eformsign'].originalMarker, 'preserve');
  assert(!Object.hasOwn(patch, 'steps.confirmation'));
});

test('plan is allowed during quiet hours because it has no external effects or dispatch dependency', () => {
  const f = fixture(); // NOW is 23:10 KST.
  assert.equal(planCompletedInstructorSignupRepair(f).status, 'completed');
});

test('a second plan against the repaired registration is rejected instead of generating another repair', () => {
  const f = fixture(); f.registration = applyFlatPatch(f.registration, planCompletedInstructorSignupRepair(f));
  assert.throws(() => planCompletedInstructorSignupRepair(f));
});

test('returned reconciliation evidence is detached from proof objects', () => {
  const f = fixture(), patch = planCompletedInstructorSignupRepair(f), before = clone(f);
  patch['evidence.signupReconciliation'].historyHash = 'changed';
  patch['steps.eformsign'].status = 'changed'; patch['steps.memo'].status = 'changed';
  assert.deepEqual(f, before);
});
