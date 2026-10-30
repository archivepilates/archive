import { INSTRUCTOR_SIGNATURE_REMINDER_POLICY, planInstructorSignatureReminder } from './instructor-signature-reminder.mjs';
import { processInstructorSignatureReminder, instructorReminderSelectionResult } from './instructor-signature-reminder-processing.mjs';
import { readPendingInstructorSignupEvidence } from './instructor-signature-reminder-source.mjs';
import { acquireStudioMateBrowserLock } from './studiomate-browser-lock.mjs';
import { captureStudioMateNativeApiClient, readExactStudioMateMember, readStudioMateUserTickets } from './studiomate-native-contract-source.mjs';
import { readSignupMemberIdentity } from './instructor-signup-order-identity.mjs';
import { sendContractReminderSms } from './contract-signature-reminder-browser.mjs';
import { contractReminderDispatchWindow, assertContractReminderDispatchAllowed } from './contract-signature-reminder-window.mjs';
import { MemberDispatchDeferredError } from './member-dispatch-window.mjs';
import { verifyInstructorPaidOrder } from './imweb-instructor-order-source.mjs';

export function instructorReminderScheduled({ apply, jobId, loginOnly, refreshCompletedFields, recheckCompletedDocument }) {
  return apply === true && !jobId && !loginOnly && !refreshCompletedFields && !recheckCompletedDocument;
}

export function createInstructorReminderTransportGuard({ now = () => new Date() } = {}) {
  let plan, markStarted, armed = false, postCount = 0, windowDenied = false, error;
  return {
    arm(value, mark) { plan = value; markStarted = mark; armed = true; },
    disarm() { armed = false; },
    get postCount() { return postCount; },
    get windowDenied() { return windowDenied; },
    get error() { return error; },
    allows(request) {
      if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return true;
      if (request.method() !== 'POST' || request.url() !== 'https://api.studiomate.kr/v2/staff/sms'
        || !armed || postCount !== 0 || !plan || typeof markStarted !== 'function') return false;
      let payload;
      try { payload = request.postDataJSON(); } catch { return false; }
      if (!Array.isArray(payload?.users) || payload.users.length !== 1 || String(payload.users[0]) !== plan.memberId
        || payload.title !== plan.smsTitle || payload.message !== plan.smsMessage) return false;
      if (!contractReminderDispatchWindow(now()).allowed) { windowDenied = true; return false; }
      try { markStarted(); } catch (failure) { error = failure; return false; }
      postCount += 1;
      return true;
    },
  };
}

export async function runInstructorSignatureReminder({ db, id, eformPage, apply, scheduled, now = () => new Date() }) {
  const [jobSnapshot, registrationSnapshot] = await Promise.all([
    db.doc(`eformsignInstructorMemberJobs/${id}`).get(), db.doc(`instructorLessonRegistrations/${id}`).get(),
  ]);
  const initial = { job: jobSnapshot.data(), registration: registrationSnapshot.data() };
  const plan = planInstructorSignatureReminder({ id, ...initial, now: now() });
  if (plan.status !== 'ready' || !apply || !scheduled)
    return plan.status === 'ready' ? { status: 'dry_run', reason: plan.reason, jobId: id }
      : instructorReminderSelectionResult(id, initial.job, plan);
  let context, release, documentPage;
  const transport = createInstructorReminderTransportGuard({ now });
  try {
    release = await acquireStudioMateBrowserLock({ owner: 'instructor-signature-reminder', waitMs: 10000 });
    const { chromium } = await import('playwright');
    context = await chromium.launchPersistentContext(`${process.env.HOME}/ArchiveIN/automation/browser-profile`, {
      headless: true, serviceWorkers: 'block', acceptDownloads: false,
    });
    await context.route('**/*', route => transport.allows(route.request()) ? route.continue() : route.abort());
    const bootstrap = await context.newPage();
    const api = await captureStudioMateNativeApiClient(bootstrap);
    documentPage = await eformPage.context().newPage();
    const smsPage = await context.newPage();
    return await processInstructorSignatureReminder({
      db, id, apply, scheduled, now,
      readLive: async ({ job, registration }) => {
        await verifyInstructorPaidOrder(db, registration);
        const document = await readPendingInstructorSignupEvidence(documentPage, job);
        const memberRead = await readExactStudioMateMember(api, job.memberPhone);
        const memberCheckedAt = now().toISOString();
        if (memberRead.status !== 'verified' || memberRead.matchCount !== 1 || memberRead.member?.inactive !== false)
          throw new Error('instructor_reminder_native_identity_unverified');
        const ticketRead = await readStudioMateUserTickets(api, job.studiomateMemberId);
        const ticketCheckedAt = now().toISOString();
        const matches = ticketRead.tickets?.filter(ticket => ticket.title === job.ticketName
          && ticket.availabilityStartAt === job.lessonDate && ticket.expireAt === job.lessonDate
          && (!registration.evidence?.ticketId || ticket.userTicketId === String(registration.evidence.ticketId)));
        if (ticketRead.status !== 'verified' || matches?.length !== 1) throw new Error('instructor_reminder_native_ticket_unverified');
        const ticket = matches[0];
        if (ticket.memberId !== job.studiomateMemberId || !ticket.verified || !ticket.complete
          || !['active', 'scheduled'].includes(ticket.status) || ticket.refunded !== false || ticket.cancelled !== false
          || ticket.payment?.verified !== true || ticket.payment.complete !== true || ticket.payment.refundedAmount !== 0)
          throw new Error('instructor_reminder_native_ticket_unverified');
        const identityPage = await context.newPage();
        try {
          const identity = await readSignupMemberIdentity(identityPage, job);
          await identityPage.waitForFunction(() => [...document.querySelectorAll('input')]
            .some(input => input.getClientRects().length && input.value === '강사회원'), null, { timeout: 15000 });
          if (identity.status !== 'verified' || identity.member.memberId !== memberRead.member.memberId
            || identity.member.phone !== memberRead.member.phone || identity.member.name !== memberRead.member.name)
            throw new Error('instructor_reminder_native_identity_unverified');
          const checkedAt = now().toISOString();
          return { checkedAt, document,
            member: { ...identity.member, verified: true, memberGrade: '강사회원', inactive: false, checkedAt: memberCheckedAt },
            ticket: { verified: true, memberId: job.studiomateMemberId, lessonDate: job.lessonDate,
              title: ticket.title, userTicketId: ticket.userTicketId, refunded: false, cancelled: false, checkedAt: ticketCheckedAt } };
        } finally { await identityPage.close(); }
      },
      sendSms: async (currentPlan, beforeFinalSend) => {
        try {
          return await sendContractReminderSms(smsPage, currentPlan, async () => {
            const markTransportStarted = await beforeFinalSend();
            assertContractReminderDispatchAllowed(now());
            return () => transport.arm(currentPlan, markTransportStarted);
          }, { now: () => now().getTime() });
        } catch (error) {
          if (transport.error) throw transport.error;
          if (transport.windowDenied && transport.postCount === 0) throw new MemberDispatchDeferredError(now());
          throw error;
        } finally { transport.disarm(); }
      },
    });
  } catch (error) {
    if (error.code === 'STUDIOMATE_BROWSER_BUSY') return { status: 'deferred', reason: 'native_browser_busy', jobId: id };
    return { status: 'review', stage: 'preclaim', reason: 'live_reader_unavailable', jobId: id };
  } finally {
    try { await documentPage?.close(); } finally {
      try { await context?.close(); } finally { await release?.(); }
    }
  }
}

export { INSTRUCTOR_SIGNATURE_REMINDER_POLICY };
