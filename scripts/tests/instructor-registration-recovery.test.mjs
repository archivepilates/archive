import assert from "node:assert/strict";
import test from "node:test";
import { planInstructorRegistrationRecovery } from "../lib/instructor-registration-recovery.mjs";
import { INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_ID } from "../lib/instructor-lesson-registration-contract.mjs";

// All identities, source IDs, dates, amounts and provider results below are synthetic.
// The account/template literals are required policy selectors, not receiver data.
const NOW = "2099-06-01T03:00:00.000Z";
const LESSON_DATE = "2099-06-15";
const LEGACY_ERROR = "다인 주문 수강자 중 취소·변경·미확인 건이 있어 공동 처리 중단";
const RECEIPT_ERROR = "수강권 발급 응답의 고유번호를 한 건으로 확인하지 못했습니다. 재발급하지 않습니다.";
const NEW_BIND_ACTION = "bind_existing_new_member_ticket";
const ACTIONS = ["bind_existing_ticket", "retry_unsent_eform", NEW_BIND_ACTION];
const at = (offset) => new Date(Date.parse(NOW) + offset).toISOString();

function fixture(action = "bind_existing_ticket") {
  const returning = action === "bind_existing_ticket";
  const registration = {
    registrationId: "synthetic-registration-a",
    studioId: "synthetic-studio-a",
    mode: returning ? "returning_member" : "new_member",
    status: "action_required",
    memberName: "Synthetic Instructor A",
    memberPhone: "010-0000-0000",
    lessonDate: LESSON_DATE,
    ticketPrice: 12345,
    source: { type: "imweb_paid_order", orderId: "synthetic-source-order-a" },
    externalOrder: { orderNo: "synthetic-order-a", paidAmount: 12345 },
    operatorChecks: { paymentConfirmed: true, seatConfirmed: true },
    evidence: {
      studiomateMemberId: "900000001",
      ticketId: returning ? undefined : "900000002",
      confirmationCandidateId: "synthetic-candidate-a",
      confirmationSolapiMessageId: "synthetic-message-a",
    },
    steps: {
      member: { status: "verified", detail: "synthetic member readback" },
      ticket: { status: returning ? "review_required" : "verified" },
      confirmation: {
        status: "verified", label: "synthetic confirmed Alimtalk",
        detail: "Already accepted; never resend", sentAt: at(-3600000),
        evidence: { candidateId: "synthetic-candidate-a", messageId: "synthetic-message-a" },
      },
      eformsign: { status: returning ? "not_required" : "failed" },
      memo: { status: returning ? "not_required" : "pending" },
      bookings: { status: "pending", detail: "synthetic untouched step" },
    },
  };
  const job = {
    registrationId: registration.registrationId,
    mode: registration.mode,
    status: returning ? "review_required" : "failed",
    currentStep: returning ? "ticket" : "eformsign",
    effectType: returning ? "ticket_issue" : null,
    externalEffectStarted: returning,
    effectStartedAt: returning ? at(-60000) : null,
    lastError: returning ? "synthetic unknown issuance" : LEGACY_ERROR,
    attempts: 3,
    maxAttempts: 3,
    attemptHistory: [{ attempt: 1, outcome: "synthetic retry" }, { attempt: 3, outcome: "synthetic failure" }],
    claimToken: "synthetic-claim", claimedAt: at(-60000), claimedBy: "synthetic-worker",
    leaseExpiresAt: at(60000), nextRunAt: at(60000), nextSourceCheckAt: at(60000),
  };
  const native = {
    checkedAt: at(-1000),
    member: {
      status: "verified",
      member: { memberId: "900000001", phone: "+82 10 0000 0000", memberGrade: "강사회원" },
    },
    ticketRead: {
      status: "verified",
      tickets: [{
        title: "강사레슨 (2T)", userTicketId: "900000002", memberId: "900000001",
        studioId: registration.studioId, availabilityStartAt: LESSON_DATE, expireAt: LESSON_DATE,
        issuedAt: at(-60000), usable: true, active: true, cancelled: false, refunded: false,
        verified: true, complete: true,
        payment: { verified: true, complete: true, status: "paid", refundedAmount: 0, paidAmount: 12345, totalAmount: 12345 },
      }],
    },
    eformAbsence: {
      complete: true, account: "archivepilates@gmail.com", registrationId: registration.registrationId,
      memberName: registration.memberName, templateId: INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_ID,
      progressCount: 0, completedCount: 0, checkedAt: at(-1000),
    },
    confirmation: { verified: true, candidateId: "synthetic-candidate-a", messageId: "synthetic-message-a" },
  };
  if (action === NEW_BIND_ACTION) {
    delete registration.evidence.ticketId;
    delete registration.evidence.confirmationCandidateId;
    delete registration.evidence.confirmationSolapiMessageId;
    registration.evidence.memberCreatedByRegistration = true;
    registration.steps.ticket = { status: "review_required", detail: RECEIPT_ERROR };
    registration.steps.eformsign = { status: "pending", detail: "synthetic onboarding pending" };
    registration.steps.confirmation = { status: "pending", detail: "synthetic confirmation not yet created" };
    delete native.confirmation;
    native.confirmationAbsent = true;
    Object.assign(job, {
      memberCreatedByRegistration: true, studiomateMemberId: "900000001",
      studioId: registration.studioId, lessonDate: LESSON_DATE,
      status: "review_required", currentStep: "ticket", effectType: "ticket_issue",
      externalEffectStarted: true, effectStartedAt: at(-60000), lastError: RECEIPT_ERROR,
      attempts: 1, maxAttempts: 3, attemptHistory: [{ attempt: 1, outcome: "synthetic receipt parse failure" }],
    });
  }
  return {
    action, registration, job, native,
    approval: { operationKey: `synthetic-operation-${action}`, action, registrationId: registration.registrationId,
      actor: "synthetic-operator", approvedAt: at(-60000) },
    now: new Date(NOW),
  };
}

function freezeTree(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

function plan(input) {
  const before = structuredClone(input);
  freezeTree(input);
  try {
    return planInstructorRegistrationRecovery(input);
  } finally {
    assert.deepStrictEqual(input, before, "planner must not mutate any input, including on rejection");
  }
}

function assertPreserved(input, result) {
  const { jobPatch, registrationPatch } = result;
  const mergedJob = { ...input.job, ...jobPatch };
  assert.equal(mergedJob.attempts, input.job.attempts);
  assert.deepStrictEqual(mergedJob.attemptHistory, input.job.attemptHistory);
  assert.equal(Object.hasOwn(jobPatch, "attempts"), false);
  assert.equal(Object.hasOwn(jobPatch, "attemptHistory"), false);
  assert.deepStrictEqual(registrationPatch.steps.confirmation, input.registration.steps.confirmation);
  assert.deepStrictEqual(registrationPatch.steps.member, input.registration.steps.member);
  assert.deepStrictEqual(registrationPatch.steps.bookings, input.registration.steps.bookings);
  assert.equal(Object.keys(registrationPatch).some((key) => key.startsWith("evidence.confirmation")), false);
  assert.equal(registrationPatch["evidence.ticketId"], "900000002");
  for (const key of ["receiver", "recipients", "memberPhone", "memberName", "send", "sendStartedAt", "documentId", "providerMessageId"]) {
    assert.equal(Object.hasOwn(jobPatch, key), false, `recovery must not enqueue a new ${key}`);
    assert.equal(Object.hasOwn(registrationPatch, key), false);
  }
}

function rejects(label, mutate, actions = ACTIONS) {
  for (const action of actions) {
    test(`${action} rejects ${label} without mutating inputs`, () => {
      const input = fixture(action);
      mutate(input);
      assert.throws(() => plan(input), { name: "Error" });
    });
  }
}

test("bind_existing_ticket binds one exact returning-member effect without issuance or confirmation resend", () => {
  const input = fixture();
  const result = plan(input);
  assertPreserved(input, result);
  assert.equal(result.registrationPatch.status, "completed");
  assert.equal(result.registrationPatch.steps.ticket.status, "verified");
  assert.equal(result.registrationPatch.steps.eformsign.status, "not_required");
  assert.equal(result.registrationPatch.steps.memo.status, "not_required");
  assert.equal(result.jobPatch.status, "done");
  assert.equal(result.jobPatch.currentStep, "complete");
  assert.equal(result.jobPatch.ticketId, "900000002");
  assert.equal(result.jobPatch.externalEffectStarted, false);
  assert.equal(Object.hasOwn(result.jobPatch, "maxAttempts"), false);
  for (const key of ["effectType", "effectStartedAt", "claimToken", "claimedAt", "claimedBy", "leaseExpiresAt", "nextRunAt", "lastError"]) {
    assert.equal(result.jobPatch[key], null, key);
  }
  assert.deepStrictEqual(result.jobPatch.ticketIssueReceipt, {
    version: 1, status: "verified_by_operator_readback", ticketId: "900000002", memberId: "900000001",
    lessonDate: LESSON_DATE, paidAmount: 12345, orderNo: "synthetic-order-a", checkedAt: at(-1000),
  });
  assert.equal(result.registrationPatch["evidence.ticketPaymentAmount"], 12345);
});

test("retry_unsent_eform queues only the legacy unsent new-member form and retains confirmed Alimtalk", () => {
  const input = fixture("retry_unsent_eform");
  const result = plan(input);
  assertPreserved(input, result);
  assert.equal(result.jobPatch.status, "pending");
  assert.equal(result.jobPatch.maxAttempts, input.job.attempts + 1);
  assert.equal(result.registrationPatch.status, "waiting_signature");
  assert.equal(result.registrationPatch.steps.eformsign.status, "queued");
  assert.deepStrictEqual(result.registrationPatch.steps.ticket, input.registration.steps.ticket);
  assert.deepStrictEqual(result.registrationPatch.steps.memo, input.registration.steps.memo);
  for (const key of ["claimToken", "claimedAt", "claimedBy", "nextSourceCheckAt", "lastError"]) assert.equal(result.jobPatch[key], null, key);
});

test("new-member binding verifies the existing ticket and leaves onboarding for follow-up without reissuance", () => {
  const input = fixture(NEW_BIND_ACTION);
  const result = plan(input);
  assertPreserved(input, result);
  assert.equal(result.jobPatch.status, "pending");
  assert.equal(result.jobPatch.currentStep, "followup");
  assert.equal(result.jobPatch.ticketId, "900000002");
  assert.equal(result.jobPatch.maxAttempts, 3);
  assert.equal(result.jobPatch.externalEffectStarted, false);
  assert.equal(result.registrationPatch.status, "waiting_signature");
  assert.equal(result.registrationPatch.steps.ticket.status, "verified");
  assert.equal(result.registrationPatch["evidence.ticketPaymentAmount"], 12345);
  for (const key of ["effectType", "effectStartedAt", "claimToken", "claimedAt", "claimedBy", "leaseExpiresAt",
    "nextRunAt", "nextSourceCheckAt", "lastError"]) assert.equal(result.jobPatch[key], null, key);
  for (const key of ["eformsign", "memo", "confirmation"]) {
    assert.deepStrictEqual(result.registrationPatch.steps[key], input.registration.steps[key]);
    assert.notEqual(result.registrationPatch.steps[key].status, "not_required");
  }
  assert.equal(Object.hasOwn(result.jobPatch, "mode"), false);
  assert.equal(Object.hasOwn(result.registrationPatch, "mode"), false);
  assert.equal(Object.hasOwn(result.jobPatch, "completedAt"), false);
  assert.equal(Object.hasOwn(result.registrationPatch, "completedAt"), false);
  assert.deepStrictEqual(result.jobPatch.ticketIssueReceipt, {
    version: 1, status: "verified_by_operator_readback", ticketId: "900000002", memberId: "900000001",
    lessonDate: LESSON_DATE, paidAmount: 12345, orderNo: "synthetic-order-a", checkedAt: at(-1000),
  });
});

test("an exact new-member receipt failure cannot use the returning-member binding action", () => {
  const input = fixture(NEW_BIND_ACTION);
  input.action = input.approval.action = "bind_existing_ticket";
  assert.throws(() => plan(input), /한정 연결/);
});

for (const eformStatus of ["pending", "queued", "waiting_external"]) {
  for (const memoStatus of ["pending", "queued", "waiting_external"]) {
    test(`new-member binding preserves unsent eform=${eformStatus} memo=${memoStatus}`, () => {
      const input = fixture(NEW_BIND_ACTION);
      input.registration.steps.eformsign = { status: eformStatus, detail: "synthetic unsent form" };
      input.registration.steps.memo = { status: memoStatus, jobId: "synthetic-memo-a" };
      const result = plan(input);
      assertPreserved(input, result);
      for (const key of ["eformsign", "memo"]) {
        assert.deepStrictEqual(result.registrationPatch.steps[key], input.registration.steps[key]);
        assert.notEqual(result.registrationPatch.steps[key].status, "not_required");
      }
      assert.equal(result.jobPatch.currentStep, "followup");
    });
  }
}

for (const [attempts, maxAttempts, expected] of [[0, 0, 1], [1, 3, 3], [3, 3, 4], [9, 4, 10], [3, 99, 99]]) {
  test(`new-member binding retains ${attempts} attempts and never lowers budget ${maxAttempts}`, () => {
    const input = fixture(NEW_BIND_ACTION);
    Object.assign(input.job, { attempts, maxAttempts });
    const result = plan(input);
    assertPreserved(input, result);
    assert.equal(result.jobPatch.maxAttempts, expected);
  });
}

for (const offset of [-120000, -1000, 1000, 120000]) {
  test(`new-member binding accepts issuance ${offset}ms from the original effect`, () => {
    const input = fixture(NEW_BIND_ACTION);
    input.native.ticketRead.tickets[0].issuedAt = new Date(Date.parse(input.job.effectStartedAt) + offset).toISOString();
    assertPreserved(input, plan(input));
  });
}

for (const attempts of [0, 1, 3, 9]) {
  test(`retry budget preserves ${attempts} attempts and permits exactly one additional attempt`, () => {
    const input = fixture("retry_unsent_eform");
    input.job.attempts = attempts;
    input.job.maxAttempts = 99;
    const result = plan(input);
    assertPreserved(input, result);
    assert.equal(result.jobPatch.maxAttempts, attempts + 1);
  });
}

for (const offset of [-120000, 120000]) {
  test(`bind_existing_ticket accepts issuance exactly ${offset}ms from the original effect`, () => {
    const input = fixture();
    input.native.ticketRead.tickets[0].issuedAt = new Date(Date.parse(input.job.effectStartedAt) + offset).toISOString();
    assertPreserved(input, plan(input));
  });
}
for (const action of ACTIONS) {
  test(`${action} accepts native freshness at the inclusive 120s boundary`, () => {
    const input = fixture(action);
    input.native.checkedAt = at(-120000);
    input.native.eformAbsence.checkedAt = at(-120000);
    input.approval.approvedAt = at(-48 * 3600000);
    assertPreserved(input, plan(input));
  });
  test(`${action} is deterministic for the same immutable evidence`, () => {
    const input = fixture(action);
    assert.deepStrictEqual(plan(input), plan(input));
  });
}

for (const [label, mutate] of [
  ["missing approval", f => { f.approval = null; }],
  ["missing operation key", f => { delete f.approval.operationKey; }],
  ["wrong approval action", f => { f.approval.action = "synthetic-other-action"; }],
  ["wrong approval registration", f => { f.approval.registrationId = "synthetic-registration-b"; }],
  ["missing approving actor", f => { delete f.approval.actor; }],
  ["invalid approval time", f => { f.approval.approvedAt = "synthetic-invalid-time"; }],
  ["approval older than 48 hours", f => { f.approval.approvedAt = at(-48 * 3600000 - 1); }],
  ["approval more than 60 seconds in the future", f => { f.approval.approvedAt = at(60001); }],
  ["wrong job registration", f => { f.job.registrationId = "synthetic-registration-b"; }],
  ["cancellation record", f => { f.registration.cancellation = { jobId: "synthetic-cancellation-a" }; }],
  ["source review hold", f => { f.registration.externalOrderReviewRequired = true; }],
  ["wrong source type", f => { f.registration.source.type = "synthetic-mirror"; }],
  ["missing external order", f => { delete f.registration.externalOrder; }],
  ["unconfirmed payment", f => { f.registration.operatorChecks.paymentConfirmed = false; }],
  ["unconfirmed seat", f => { f.registration.operatorChecks.seatConfirmed = false; }],
  ["unverified registered member", f => { f.registration.steps.member.status = "pending"; }],
  ["missing native proof", f => { f.native = null; }],
  ["invalid native timestamp", f => { f.native.checkedAt = "synthetic-invalid-time"; }],
  ["native proof older than 120 seconds", f => { f.native.checkedAt = at(-120001); }],
  ["native proof more than 60 seconds in the future", f => { f.native.checkedAt = at(60001); }],
  ["unverified native member", f => { f.native.member.status = "review_required"; }],
  ["wrong native member", f => { f.native.member.member.memberId = "900000099"; }],
  ["wrong native phone", f => { f.native.member.member.phone = "010-0000-0001"; }],
  ["non-instructor grade", f => { f.native.member.member.memberGrade = "synthetic ordinary member"; }],
  ["unverified full ticket read", f => { f.native.ticketRead.status = "partial"; }],
  ["missing native ticket", f => { f.native.ticketRead.tickets = []; }],
  ["duplicate matching native pass", f => { f.native.ticketRead.tickets.push({ ...f.native.ticketRead.tickets[0], userTicketId: "900000003" }); }],
  ["duplicate rows of the same native pass", f => { f.native.ticketRead.tickets.push(structuredClone(f.native.ticketRead.tickets[0])); }],
]) rejects(label, mutate);

for (const status of ["cancelled", "canceled", "rejected", "cancellation_pending", "cancellation_review"]) {
  rejects(`registration status ${status}`, f => { f.registration.status = status; });
}

for (const [key, value] of Object.entries({
  title: "synthetic wrong pass", availabilityStartAt: "2099-06-14", expireAt: "2099-06-16",
  usable: false, active: false, cancelled: true, refunded: true, userTicketId: "excel_synthetic-ticket",
  memberId: "900000099", studioId: "synthetic-studio-b", verified: false, complete: false,
})) rejects(`ticket ${key} mismatch`, f => { f.native.ticketRead.tickets[0][key] = value; });

for (const [key, value] of Object.entries({
  verified: false, complete: false, status: "refunded", refundedAmount: 1, paidAmount: 24690, totalAmount: 24690,
})) rejects(`ticket payment ${key} mismatch`, f => { f.native.ticketRead.tickets[0].payment[key] = value; });

for (const id of ["0", "-1", "1.5", "0900000002", "", "synthetic-ticket"]) {
  rejects(`non-native ticket ID ${JSON.stringify(id)}`, f => { f.native.ticketRead.tickets[0].userTicketId = id; });
}
rejects("wrong registered member ID", f => { f.registration.evidence.studiomateMemberId = "900000099"; });
rejects("wrong registered phone", f => { f.registration.memberPhone = "010-0000-0001"; });
rejects("wrong registered lesson date", f => { f.registration.lessonDate = "2099-06-16"; });
rejects("wrong personal order amount", f => { f.registration.externalOrder.paidAmount = 24690; });
rejects("wrong registered ticket price", f => { f.registration.ticketPrice = 24690; });

const BIND_ONLY = ["bind_existing_ticket"];
for (const [label, mutate] of [
  ["job not under review", f => { f.job.status = "pending"; }],
  ["wrong current step", f => { f.job.currentStep = "member"; }],
  ["wrong effect type", f => { f.job.effectType = "synthetic-other-effect"; }],
  ["no issuance effect marker", f => { f.job.externalEffectStarted = false; }],
  ["new-member registration", f => { f.registration.mode = "new_member"; }],
  ["new-member job", f => { f.job.mode = "new_member"; }],
  ["missing effect time", f => { delete f.job.effectStartedAt; }],
  ["invalid issuance time", f => { f.native.ticketRead.tickets[0].issuedAt = "synthetic-invalid-time"; }],
  ["issuance 120001ms after effect", f => { f.native.ticketRead.tickets[0].issuedAt = at(60001); }],
  ["issuance 120001ms before effect", f => { f.native.ticketRead.tickets[0].issuedAt = at(-180001); }],
  ["wrong job ticket binding", f => { f.job.ticketId = "900000099"; }],
  ["wrong registration ticket binding", f => { f.registration.evidence.ticketId = "900000099"; }],
]) rejects(label, mutate, BIND_ONLY);

const NEW_BIND_ONLY = [NEW_BIND_ACTION];
for (const [label, mutate] of [
  ["returning-member registration", f => { f.registration.mode = "returning_member"; }],
  ["returning-member job", f => { f.job.mode = "returning_member"; }],
  ["missing registered creation evidence", f => { delete f.registration.evidence.memberCreatedByRegistration; }],
  ["false registered creation evidence", f => { f.registration.evidence.memberCreatedByRegistration = false; }],
  ["missing job creation evidence", f => { delete f.job.memberCreatedByRegistration; }],
  ["false job creation evidence", f => { f.job.memberCreatedByRegistration = false; }],
  ["registered simulation", f => { f.registration.evidence.newMemberSimulation = true; }],
  ["job simulation", f => { f.job.newMemberSimulation = true; }],
  ["job not under review", f => { f.job.status = "pending"; }],
  ["ticket step not under review", f => { f.registration.steps.ticket.status = "pending"; }],
  ["wrong current step", f => { f.job.currentStep = "eformsign"; }],
  ["wrong effect type", f => { f.job.effectType = "eform_send"; }],
  ["no issuance marker", f => { f.job.externalEffectStarted = false; }],
  ["missing receipt error", f => { delete f.job.lastError; }],
  ["generic issuance error", f => { f.job.lastError = "synthetic transport outcome unknown"; }],
  ["eform send failure", f => { f.job.lastError = LEGACY_ERROR; }],
  ["different send-stage error", f => { f.job.lastError = '[eformsign:send_dialog] TimeoutError timeoutMs=30000 {"path":"/eform/document/view_service.html","framePresent":true,"viewerStatus":"1","processText":"Send"}'; }],
  ["missing job identity", f => { delete f.job.studiomateMemberId; }],
  ["wrong job identity", f => { f.job.studiomateMemberId = "900000099"; }],
  ["wrong job studio", f => { f.job.studioId = "synthetic-studio-b"; }],
  ["wrong job lesson date", f => { f.job.lessonDate = "2099-06-16"; }],
  ["missing effect time", f => { delete f.job.effectStartedAt; }],
  ["invalid issuance time", f => { f.native.ticketRead.tickets[0].issuedAt = "synthetic-invalid-time"; }],
  ["issuance 120001ms after effect", f => { f.native.ticketRead.tickets[0].issuedAt = at(60001); }],
  ["issuance 120001ms before effect", f => { f.native.ticketRead.tickets[0].issuedAt = at(-180001); }],
  ["wrong job ticket binding", f => { f.job.ticketId = "900000099"; }],
  ["onboarding incorrectly not required", f => { f.registration.steps.eformsign.status = "not_required"; }],
  ["memo incorrectly not required", f => { f.registration.steps.memo.status = "not_required"; }],
  ["missing onboarding step", f => { delete f.registration.steps.eformsign; }],
  ["missing memo step", f => { delete f.registration.steps.memo; }],
  ["failed onboarding step", f => { f.registration.steps.eformsign.status = "failed"; }],
  ["failed memo step", f => { f.registration.steps.memo.status = "failed"; }],
  ["existing registered document", f => { f.registration.evidence.eformsignDocumentId = "synthetic-document-a"; }],
  ["missing document absence proof", f => { delete f.native.eformAbsence; }],
  ["incomplete document absence proof", f => { f.native.eformAbsence.complete = false; }],
  ["wrong document absence account", f => { f.native.eformAbsence.account = "synthetic-operator@example.invalid"; }],
  ["wrong document absence registration", f => { f.native.eformAbsence.registrationId = "synthetic-registration-b"; }],
  ["wrong document absence name", f => { f.native.eformAbsence.memberName = "Synthetic Instructor B"; }],
  ["wrong document absence template", f => { f.native.eformAbsence.templateId = "synthetic-template-b"; }],
  ["existing in-progress document", f => { f.native.eformAbsence.progressCount = 1; }],
  ["existing completed document", f => { f.native.eformAbsence.completedCount = 1; }],
  ["missing document absence timestamp", f => { delete f.native.eformAbsence.checkedAt; }],
  ["invalid document absence timestamp", f => { f.native.eformAbsence.checkedAt = "synthetic-invalid-time"; }],
  ["stale document absence proof", f => { f.native.eformAbsence.checkedAt = at(-120001); }],
  ["future document absence proof", f => { f.native.eformAbsence.checkedAt = at(60001); }],
  ["missing canonical confirmation absence", f => { delete f.native.confirmationAbsent; }],
  ["existing canonical confirmation", f => { f.native.confirmationAbsent = false; }],
  ["non-boolean canonical confirmation absence", f => { f.native.confirmationAbsent = "true"; }],
  ["confirmation step with send evidence", f => { f.registration.steps.confirmation.sentAt = at(-1000); }],
  ["confirmation step with a prior candidate", f => { f.registration.steps.confirmation.evidence = { candidateId: "synthetic-candidate-a" }; }],
  ["confirmation step with a prior message", f => { f.registration.steps.confirmation.evidence = { messageId: "synthetic-message-a" }; }],
]) rejects(label, mutate, NEW_BIND_ONLY);

for (const status of ["queued", "sent", "verified", "not_required", "failed", "review_required"]) {
  rejects(`confirmation status ${status}`, f => { f.registration.steps.confirmation.status = status; }, NEW_BIND_ONLY);
}
for (const field of ["confirmationCandidateId", "confirmationSolapiMessageId"]) {
  for (const value of ["synthetic-prior-send", null, ""]) {
    rejects(`present ${field} ${JSON.stringify(value)}`, f => { f.registration.evidence[field] = value; }, NEW_BIND_ONLY);
  }
}
for (const field of ["progressCount", "completedCount"]) {
  for (const value of [undefined, "0", -1]) {
    rejects(`invalid document absence ${field} ${JSON.stringify(value)}`, f => { f.native.eformAbsence[field] = value; }, NEW_BIND_ONLY);
  }
}
for (const status of ["sent", "verified"]) {
  rejects(`existing eform status ${status}`, f => { f.registration.steps.eformsign.status = status; }, NEW_BIND_ONLY);
}
rejects("completed memo", f => { f.registration.steps.memo.status = "verified"; }, NEW_BIND_ONLY);
for (const field of ["sendStartedAt", "sendClickedAt", "sentAt", "documentId", "documentUrl", "completedAt", "providerMessageId"]) {
  rejects(`job send/document marker ${field}`, f => { f.job[field] = "synthetic-prior-effect"; }, NEW_BIND_ONLY);
  rejects(`eform step send/document marker ${field}`, f => { f.registration.steps.eformsign[field] = "synthetic-prior-effect"; }, NEW_BIND_ONLY);
}

for (const field of ["attempts", "maxAttempts"]) {
  for (const value of [-1, 1.5, "invalid", Number.MAX_SAFE_INTEGER + 1]) {
    rejects(`invalid ${field} ${value}`, f => { f.job[field] = value; }, NEW_BIND_ONLY);
  }
}
rejects("attempt budget overflow", f => { f.job.attempts = Number.MAX_SAFE_INTEGER; }, NEW_BIND_ONLY);

const RETRY_ONLY = ["retry_unsent_eform"];
for (const [label, mutate] of [
  ["returning-member registration", f => { f.registration.mode = "returning_member"; }],
  ["unverified existing ticket step", f => { f.registration.steps.ticket.status = "pending"; }],
  ["form not failed", f => { f.registration.steps.eformsign.status = "queued"; }],
  ["job not failed", f => { f.job.status = "retry"; }],
  ["non-legacy failure", f => { f.job.lastError = "synthetic transport outcome unknown"; }],
  ["missing legacy failure", f => { delete f.job.lastError; }],
  ["existing registered document", f => { f.registration.evidence.eformsignDocumentId = "synthetic-document-a"; }],
  ["incomplete absence proof", f => { f.native.eformAbsence.complete = false; }],
  ["wrong absence account", f => { f.native.eformAbsence.account = "synthetic-operator@example.invalid"; }],
  ["wrong absence registration", f => { f.native.eformAbsence.registrationId = "synthetic-registration-b"; }],
  ["wrong absence name", f => { f.native.eformAbsence.memberName = "Synthetic Instructor B"; }],
  ["wrong absence template", f => { f.native.eformAbsence.templateId = "synthetic-template-b"; }],
  ["existing in-progress document", f => { f.native.eformAbsence.progressCount = 1; }],
  ["existing completed document", f => { f.native.eformAbsence.completedCount = 1; }],
  ["invalid absence timestamp", f => { f.native.eformAbsence.checkedAt = "synthetic-invalid-time"; }],
  ["stale absence proof", f => { f.native.eformAbsence.checkedAt = at(-120001); }],
  ["future absence proof", f => { f.native.eformAbsence.checkedAt = at(60001); }],
  ["unverified confirmation step", f => { f.registration.steps.confirmation.status = "pending"; }],
  ["unverified confirmation proof", f => { f.native.confirmation.verified = false; }],
  ["wrong confirmation candidate", f => { f.native.confirmation.candidateId = "synthetic-candidate-b"; }],
  ["wrong confirmation message", f => { f.native.confirmation.messageId = "synthetic-message-b"; }],
  ["wrong registered confirmation candidate", f => { f.registration.evidence.confirmationCandidateId = "synthetic-candidate-b"; }],
  ["wrong registered confirmation message", f => { f.registration.evidence.confirmationSolapiMessageId = "synthetic-message-b"; }],
  ["missing confirmation candidate binding on both sides", f => { delete f.native.confirmation.candidateId; delete f.registration.evidence.confirmationCandidateId; }],
  ["missing confirmation message binding on both sides", f => { delete f.native.confirmation.messageId; delete f.registration.evidence.confirmationSolapiMessageId; }],
  ["wrong already-verified registration ticket binding", f => { f.registration.evidence.ticketId = "900000099"; }],
]) rejects(label, mutate, RETRY_ONLY);

for (const [key, value] of Object.entries({
  externalEffectStarted: true, effectStartedAt: at(-60000), sendStartedAt: at(-60000),
  sendClickedAt: at(-60000), sentAt: at(-60000), documentId: "synthetic-document-a",
  documentUrl: "https://example.invalid/synthetic-document-a", completedAt: at(-60000),
  providerMessageId: "synthetic-provider-message-a",
})) rejects(`accepted or ambiguous eform marker ${key}`, f => { f.job[key] = value; }, RETRY_ONLY);

for (const status of ["sending", "sent", "completed", "send_review_required", "review_required"]) {
  rejects(`accepted or ambiguous eform job status ${status}`, f => { f.job.status = status; }, RETRY_ONLY);
}

test("unknown recovery action is rejected even with matching approval", () => {
  const input = fixture("retry_unsent_eform");
  input.action = input.approval.action = "synthetic-unknown-action";
  assert.throws(() => plan(input), { name: "Error" });
});

function retainedReceipt(input) {
  return {
    version: 1, status: "accepted_pending_readback", ticketId: "900000002", memberId: "900000001",
    lessonDate: input.registration.lessonDate, orderNo: input.registration.externalOrder.orderNo,
    paidAmount: input.registration.externalOrder.paidAmount, receivedAt: at(-60000),
  };
}

for (const action of ACTIONS) {
  test(`${action} accepts an exactly bound retained receipt and preserves prior attempts and confirmation`, () => {
    const input = fixture(action);
    input.job.ticketIssueReceipt = retainedReceipt(input);
    const result = plan(input);
    assertPreserved(input, result);
    const receipt = { ...input.job, ...result.jobPatch }.ticketIssueReceipt;
    for (const key of ["ticketId", "memberId", "lessonDate", "orderNo", "paidAmount"]) {
      assert.equal(receipt[key], input.job.ticketIssueReceipt[key], key);
    }
    if (action === "retry_unsent_eform") {
      assert.deepStrictEqual(receipt, input.job.ticketIssueReceipt);
      assert.equal(result.jobPatch.maxAttempts, input.job.attempts + 1);
    }
  });
}

for (const [key, value] of Object.entries({
  ticketId: "900000099", memberId: "900000098", lessonDate: "2099-06-16",
  orderNo: "synthetic-order-b", paidAmount: 24690,
})) {
  rejects(`contradictory retained issuance receipt ${key}`, input => {
    input.job.ticketIssueReceipt = { ...retainedReceipt(input), [key]: value };
  });
  rejects(`missing retained issuance receipt ${key}`, input => {
    input.job.ticketIssueReceipt = retainedReceipt(input);
    delete input.job.ticketIssueReceipt[key];
  });
}

rejects("empty retained issuance receipt", input => { input.job.ticketIssueReceipt = {}; });
