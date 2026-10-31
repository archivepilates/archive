import { randomUUID } from 'node:crypto';
import { isMemberDispatchDeferred } from './member-dispatch-window.mjs';
import { contractReminderDispatchWindow, assertContractReminderDispatchAllowed } from './contract-signature-reminder-window.mjs';
import { INSTRUCTOR_SIGNATURE_REMINDER_POLICY, planInstructorSignatureReminder, assertInstructorSignatureReminderLive } from './instructor-signature-reminder.mjs';
import { memberSmsReceiptFields, acceptedMemberSmsMarker } from './member-sms-solapi.mjs';

const JOBS = 'eformsignInstructorMemberJobs';
const REGISTRATIONS = 'instructorLessonRegistrations';
const stop = reason => { throw Object.assign(new Error(reason), { reminderSkip: reason }); };

export function instructorReminderSelectionResult(id, job, plan) {
  const row = job?.signatureReminder;
  if (plan.reason === 'reminder_already_recorded' && !(row?.status === 'accepted'
    && row.key === `instructor_signature_reminder_${job.documentId}` && acceptedMemberSmsMarker(row)))
    return { status: 'review', stage: 'postclaim', reason: plan.reason, jobId: id, documentId: job.documentId };
  return { status: plan.status, reason: plan.reason, jobId: id };
}

export async function processInstructorSignatureReminder({ db, id, readLive, sendSms, now = () => new Date(), apply = false, scheduled = false }) {
  const ref = db.doc(`${JOBS}/${id}`), registrationRef = db.doc(`${REGISTRATIONS}/${id}`);
  const read = async () => {
    const [job, registration] = await Promise.all([ref.get(), registrationRef.get()]);
    return { job: job.data(), registration: registration.data() };
  };
  const initial = await read();
  const plan = planInstructorSignatureReminder({ id, ...initial, now: now() });
  if (plan.status !== 'ready') return instructorReminderSelectionResult(id, initial.job, plan);
  if (!apply || !scheduled) return { status: 'dry_run', reason: 'no_dispatch', jobId: id, documentId: plan.documentId };
  const deferred = () => ({ ...contractReminderDispatchWindow(now()), status: 'deferred', jobId: id, documentId: plan.documentId });
  if (!contractReminderDispatchWindow(now()).allowed) return deferred();
  let claimed = false, dispatchStarted = false, attemptedAt;
  const dispatchToken = randomUUID();
  const settle = async patch => db.runTransaction(async tx => {
    const source = await tx.get(ref), marker = source.data()?.signatureReminder;
    if (marker?.key !== plan.key || marker.fingerprint !== plan.fingerprint || marker.dispatchToken !== dispatchToken)
      throw new Error('instructor_reminder_claim_changed');
    if (marker.status === 'accepted') return marker;
    if (marker.status !== 'attempting') throw new Error('instructor_reminder_claim_not_attempting');
    const updated = { ...marker, ...patch, updatedAt: now().toISOString() };
    tx.update(ref, { signatureReminder: updated });
    return updated;
  });
  const currentPlan = value => {
    const current = planInstructorSignatureReminder({ id, ...value, now: now() });
    if (current.status !== 'ready' || current.fingerprint !== plan.fingerprint) stop('source_or_duplicate_changed');
    return current;
  };
  try {
    assertContractReminderDispatchAllowed(now());
    const firstLive = await readLive({ ...initial, plan });
    assertContractReminderDispatchAllowed(now());
    assertInstructorSignatureReminderLive({ ...initial, plan, live: firstLive, now: now() });
    const receipt = await sendSms(plan, async () => {
      assertContractReminderDispatchAllowed(now());
      const fresh = await read();
      currentPlan(fresh);
      const live = await readLive({ ...fresh, plan });
      assertContractReminderDispatchAllowed(now());
      assertInstructorSignatureReminderLive({ ...fresh, plan, live, now: now() });
      await db.runTransaction(async tx => {
        // Every source job for this document participates in the same deduplication read.
        const peers = await tx.get(db.collection(JOBS).where('documentId', '==', plan.documentId).limit(101));
        const registration = await tx.get(registrationRef);
        if (peers.size > 100) stop('document_peer_coverage_incomplete');
        const own = peers.docs.find(row => row.id === id);
        if (!own) stop('canonical_source_missing');
        for (const peer of peers.docs) {
          const value = peer.data();
          if (peer.id !== id && (value.signatureReminder != null || value.completedAt || value.status === 'done'))
            stop('document_already_completed_or_claimed');
        }
        const job = own.data();
        currentPlan({ job, registration: registration.data() });
        assertInstructorSignatureReminderLive({ job, registration: registration.data(), plan, live, now: now() });
        assertContractReminderDispatchAllowed(now());
        attemptedAt = now().toISOString();
        tx.update(ref, { signatureReminder: {
          policy: INSTRUCTOR_SIGNATURE_REMINDER_POLICY, key: plan.key, documentId: plan.documentId,
          fingerprint: plan.fingerprint, status: 'attempting', attempts: 1, transportProvider: 'solapi',
          dispatchToken, attemptedAt, originalSentAt: plan.sentAt, dueAt: plan.dueAt,
          memberId: plan.memberId, deferrals: job.signatureReminder?.deferrals || [], updatedAt: attemptedAt,
        } });
      });
      claimed = true;
      assertContractReminderDispatchAllowed(now());
      assertInstructorSignatureReminderLive({ ...fresh, plan, live, now: now() });
      return () => {
        assertContractReminderDispatchAllowed(now());
        assertInstructorSignatureReminderLive({ ...fresh, plan, live, now: now() });
        dispatchStarted = true;
      };
    });
    if (!claimed || !dispatchStarted)
      throw new Error('instructor_reminder_sms_receipt_unverified');
    const fields = memberSmsReceiptFields(receipt, plan, { subject: 'ARCHIVE PILATES 가입서 안내' });
    const accepted = await settle({ status: 'accepted', ...fields, acceptedAt: now().toISOString(), deliveryStatus: 'not_verified' });
    return { status: 'accepted', jobId: id, documentId: plan.documentId,
      ...memberSmsReceiptFields(accepted, plan, { subject: 'ARCHIVE PILATES 가입서 안내' }), deliveryStatus: 'not_verified' };
  } catch (error) {
    if (isMemberDispatchDeferred(error) && (!dispatchStarted || error.providerPostCount === 0)) {
      if (claimed) {
        const window = contractReminderDispatchWindow(now());
        const marker = (await ref.get()).data()?.signatureReminder;
        await settle({ status: 'deferred', attempts: 0, deferredBeforeTransport: true, providerPostCount: 0,
          reason: window.reason, nextAllowedAt: window.nextAllowedAt,
          deferrals: [...(marker?.deferrals || []), { dispatchToken, attemptedAt, fingerprint: plan.fingerprint,
            deferredAt: now().toISOString(), providerPostCount: 0 }] });
      }
      return deferred();
    }
    if (error.reminderSkip && !claimed) return { status: 'skipped', reason: error.reminderSkip, jobId: id };
    let reason = claimed ? 'send_outcome_unknown' : 'source_or_claim_unverified';
    if (claimed) {
      try {
        const row = await settle({ status: 'review', reason });
        if (row.status === 'accepted') return { status: 'accepted', jobId: id, documentId: plan.documentId,
          ...memberSmsReceiptFields(row, plan, { subject: 'ARCHIVE PILATES 가입서 안내' }), deliveryStatus: 'not_verified' };
      } catch { reason = 'send_outcome_unknown_journal_unavailable'; }
    }
    const code = error.code || error.message;
    const sourceCode = /^(?:instructor_(?:signature_reminder|reminder)_[a-z_]+|contract_reminder_[a-z_]+|member_sms_[a-z_]+|INSTRUCTOR_ORDER_[A-Z_]+)$/.test(code)
      ? code : 'unverified';
    return { status: 'review', stage: claimed ? 'postclaim' : 'preclaim', reason, sourceCode, jobId: id, documentId: plan.documentId };
  }
}
