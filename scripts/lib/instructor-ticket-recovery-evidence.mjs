import {
  instructorLessonRegistrationId,
  normalizeInstructorLessonName,
  normalizeInstructorLessonPhone,
} from './instructor-lesson-registration-contract.mjs';
import { IMWEB_LESSON_POLICY } from './imweb-instructor-order-policy.mjs';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const check = condition => {
  if (!condition) throw Object.assign(new Error('Instructor ticket recovery paid source binding mismatch.'), {
    code: 'INSTRUCTOR_TICKET_RECOVERY_PAID_BINDING_MISMATCH',
  });
};
const name = value => {
  check(typeof value === 'string');
  const normalized = value.replace(/\s+/g, ' ').trim();
  check(normalized.length > 0 && normalized.length <= 40);
  return normalizeInstructorLessonName(normalized);
};
const phone = value => {
  check(typeof value === 'string');
  const normalized = normalizeInstructorLessonPhone(value);
  check(/^010\d{8}$/.test(normalized));
  return normalized;
};

// The caller must freshly verify the paid order; this only binds that assessment to both actual targets.
export function assertInstructorTicketRecoveryPaidBinding({ registration, job, assessment } = {}) {
  check(record(registration) && record(job) && record(assessment));
  check(record(registration.externalOrder) && record(job.externalOrder));
  check(assessment.status === 'ready');
  const studioId = IMWEB_LESSON_POLICY.studioId;
  check(registration.studioId === studioId && job.studioId === studioId);
  const memberName = name(assessment.memberName);
  const memberPhone = phone(assessment.memberPhone);
  const lessonDate = assessment.lessonDate;
  check(typeof lessonDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(lessonDate));
  const dateMillis = Date.parse(`${lessonDate}T00:00:00Z`);
  check(Number.isFinite(dateMillis) && new Date(dateMillis).toISOString().slice(0, 10) === lessonDate);
  const registrationId = instructorLessonRegistrationId(studioId, memberPhone, lessonDate);
  const rows = [assessment, registration, job, registration.externalOrder, job.externalOrder];
  for (const row of rows) {
    check(row.registrationId === registrationId && row.lessonDate === lessonDate);
    check(name(row.memberName) === memberName && phone(row.memberPhone) === memberPhone);
    if (Object.hasOwn(row, 'studioId')) check(row.studioId === studioId);
  }
  const amount = assessment.paidAmount;
  check(Number.isSafeInteger(amount) && amount === IMWEB_LESSON_POLICY.expectedPrice);
  check(registration.ticketPrice === amount && job.ticketPrice === amount);
  check(typeof assessment.orderNo === 'string' && /^\d{15}$/.test(assessment.orderNo));
  check(typeof assessment.itemNo === 'string' && assessment.itemNo.startsWith(`${assessment.orderNo}-`)
    && assessment.itemNo.length > assessment.orderNo.length + 1);
  for (const external of [registration.externalOrder, job.externalOrder]) {
    check(external.orderNo === assessment.orderNo && external.itemNo === assessment.itemNo
      && external.paidAmount === amount);
  }
  return true;
}
