import assert from "node:assert/strict";
import { test } from "node:test";
import {
  INSTRUCTOR_SIGNATURE_REMINDER_POLICY,
  planInstructorSignatureReminder,
  assertInstructorSignatureReminderLive,
} from "../lib/instructor-signature-reminder.mjs";
import { INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_ID as TEMPLATE } from "../lib/instructor-lesson-registration-contract.mjs";

const ID = `ilr_${"a".repeat(24)}`, DOC = "b".repeat(32);
const NOW = new Date("2026-10-30T09:00:00+09:00");
const SENT = "2026-10-29T00:00:00.000Z";
const POLICY = "instructor_signup_signature_reminder_24h_v1";
function fixture() {
  return {
    id: ID, now: new Date(NOW),
    job: {
      jobId: ID, registrationId: ID, studioId: "5330", memberName: "합성 강사", memberPhone: "01000000001",
      studiomateMemberId: "9000001", documentId: DOC, documentName: "2026-10-29_강사회원가입서_합성 강사",
      ticketName: "강사레슨 (2T)", lessonDate: "2026-11-28", status: "waiting_completion",
      sentAt: SENT, sendClickedAt: "2026-10-28T23:59:59.000Z", externalEffectStarted: false,
    },
    registration: {
      registrationId: ID, studioId: "5330", memberName: "합성 강사", memberPhone: "01000000001",
      lessonDate: "2026-11-28", status: "waiting_signature",
      evidence: { studiomateMemberId: "9000001", eformsignDocumentId: DOC },
      steps: { ticket: { status: "verified" }, eformsign: { status: "sent" } },
    },
  };
}
function liveFixture() {
  const f = fixture(), checkedAt = f.now.toISOString();
  return {
    ...f, plan: planInstructorSignatureReminder(f),
    live: {
      checkedAt,
      document: {
        source: "eformsign_document_status", verified: true, documentId: DOC, templateId: TEMPLATE,
        documentName: f.job.documentName, status: "waiting", recipientName: f.job.memberName,
        recipientPhone: f.job.memberPhone, recipientCount: 1, checkedAt,
        expiresAt: '2026-11-05T00:00:00.000Z',
      },
      member: {
        verified: true, memberId: f.job.studiomateMemberId, name: f.job.memberName,
        phone: f.job.memberPhone, memberGrade: "강사회원", inactive: false, checkedAt,
      },
      ticket: {
        verified: true, memberId: f.job.studiomateMemberId, lessonDate: f.job.lessonDate,
        title: f.job.ticketName, refunded: false, cancelled: false, checkedAt,
      },
    },
  };
}
function defer(f) {
  const p = planInstructorSignatureReminder(f);
  assert.equal(p.status, "ready");
  f.job.signatureReminder = {
    policy: POLICY, key: p.key, fingerprint: p.fingerprint,
    status: "deferred", attempts: 0, deferredBeforeTransport: true, providerPostCount: 0,
  };
  return f.job.signatureReminder;
}
function rejectsLive(f, suffix) {
  const code = `instructor_signature_reminder_${suffix}`;
  assert.throws(() => assertInstructorSignatureReminderLive(f), error => {
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    assert.doesNotMatch(error.message, /합성|01000000001|9000001|https?:/);
    return true;
  });
}

test("exports the versioned policy and exact SMS-only plan without a contract/admin URL", () => {
  const f = fixture(), before = structuredClone(f), p = planInstructorSignatureReminder(f);
  assert.equal(INSTRUCTOR_SIGNATURE_REMINDER_POLICY, POLICY);
  assert.equal(p.status, "ready");
  assert.equal(p.reason, "eligible");
  for (const [key, value] of Object.entries({
    policy: POLICY, key: `instructor_signature_reminder_${DOC}`, jobId: ID, registrationId: ID,
    documentId: DOC, templateId: TEMPLATE, documentName: f.job.documentName,
    memberId: "9000001", memberName: f.job.memberName, memberPhone: f.job.memberPhone, studioId: "5330",
    sentAt: SENT, dueAt: NOW.toISOString(), lessonDate: f.job.lessonDate, ticketName: f.job.ticketName,
    smsTitle: "ARCHIVE PILATES 강사회원 가입서 작성 안내",
    smsMessage: "[ARCHIVE PILATES] 합성 강사님, 강사회원 가입서 작성이 아직 완료되지 않았습니다.\n이전에 보내드린 이폼싸인 작성 요청 문자에서 가입서를 확인하고 작성해 주세요.\n문의사항은 센터로 연락해 주세요.",
  })) assert.equal(p[key], value, key);
  assert.match(p.fingerprint, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(p.smsMessage, /https?:|www\.|form_id|document_id/);
  assert.deepEqual(f, before);
});

test("requires the full original 24 elapsed hours including quiet hours", () => {
  const f = fixture();
  f.job.sentAt = "2026-10-29T00:00:00.001Z";
  assert.equal(planInstructorSignatureReminder(f).reason, "under_24_hours");
  f.now = new Date(NOW.getTime() + 1);
  assert.equal(planInstructorSignatureReminder(f).status, "ready");
  f.now = new Date(NOW.getTime() + 2);
  assert.equal(planInstructorSignatureReminder(f).status, "ready");
});

test("Firestore sub-millisecond precision never makes the original 24h boundary early", () => {
  for (const sentAt of [
    { seconds: Date.parse(SENT) / 1000, nanoseconds: 1, toDate: () => new Date(SENT) },
    { _seconds: Date.parse(SENT) / 1000, _nanoseconds: 1 },
    { toMillis: () => Date.parse(SENT) + 0.25, toDate: () => new Date(SENT) },
  ]) {
    const f = fixture(); f.job.sentAt = sentAt;
    assert.equal(planInstructorSignatureReminder(f).reason, "under_24_hours");
    f.now = new Date(NOW.getTime() + 1);
    const p = planInstructorSignatureReminder(f);
    assert.equal(p.status, "ready");
    assert.equal(p.dueAt, f.now.toISOString());
    assert.equal(p.sentAt, "2026-10-29T00:00:00.001Z");
  }
});

for (const [label, timestamp] of [
  ["Date", new Date(SENT)],
  ["ISO with KST offset", "2026-10-29T09:00:00+09:00"],
  ["Firestore toDate", { toDate: () => new Date(SENT) }],
  ["Firestore toMillis", { toMillis: () => Date.parse(SENT) }],
  ["Firestore seconds", { seconds: Date.parse(SENT) / 1000, nanoseconds: 0 }],
  ["serialized Firestore seconds", { _seconds: Date.parse(SENT) / 1000, _nanoseconds: 0 }],
]) test(`supports original sentAt as ${label}`, () => {
  const f = fixture();
  f.job.sentAt = timestamp;
  assert.equal(planInstructorSignatureReminder(f).sentAt, SENT);
});

for (const timestamp of [undefined, null, "bad", "2026-10-29", "2026-10-29T09:00:00", 1793232000000,
  "2026-02-30T00:00:00Z", `${SENT}\n`, new Date(NaN), {}, { toDate() { throw Error("private content"); } },
  { seconds: 1, nanoseconds: -1 }, { seconds: 1, nanoseconds: 1_000_000_000 }, { toMillis: () => "1" },
]) test(`does not fall back from invalid original sentAt (${String(timestamp)})`, () => {
  const f = fixture();
  f.job.sentAt = timestamp;
  f.job.createdAt = "2026-01-01T00:00:00Z";
  f.job.lastCheckedAt = "2026-01-01T00:00:00Z";
  assert.equal(planInstructorSignatureReminder(f).reason, "original_send_unverified");
});

test("createdAt and lastCheckedAt cannot age or reset the reminder clock", () => {
  const f = fixture(), p = planInstructorSignatureReminder(f);
  f.job.createdAt = "2020-01-01T00:00:00Z";
  f.job.lastCheckedAt = f.now;
  f.job.updatedAt = f.now;
  f.registration.checkedAt = f.now;
  f.registration.updatedAt = f.now;
  assert.deepEqual(planInstructorSignatureReminder(f), p);
  f.job.sentAt = "2026-10-29T11:03:00Z";
  assert.equal(planInstructorSignatureReminder(f).reason, "under_24_hours");
});

for (const [clock, status] of [
  ["2026-10-31T00:00:00+09:00", "skipped"],
  ["2026-10-31T08:59:59.999+09:00", "skipped"],
  ["2026-10-31T09:00:00+09:00", "ready"],
  ["2026-10-31T19:59:59.999+09:00", "ready"],
  ["2026-10-31T20:00:00+09:00", "skipped"],
  ["2026-10-31T22:59:59+09:00", "skipped"],
  ["2026-10-31T23:00:00+09:00", "skipped"],
]) test(`inherits the contract-reminder window at ${clock}`, () => {
  const p = planInstructorSignatureReminder({ ...fixture(), now: new Date(clock) });
  assert.equal(p.status, status);
  if (status === "skipped") {
    assert.equal(p.reason, "outside_send_window");
    assert.match(p.nextAllowedAt, /T00:00:00\.000Z$/);
    assert.ok(Date.parse(p.nextAllowedAt) > Date.parse(clock));
  }
});

test("Oct29 evening sends remain under 24h, then defer until Oct31 09:00", () => {
  for (const sentAt of ["2026-10-29T20:03:00+09:00", "2026-10-29T20:40:00+09:00"]) {
    const f = fixture();
    f.job.sentAt = sentAt;
    f.job.sendClickedAt = sentAt;
    f.now = new Date("2026-10-30T19:59:59+09:00");
    assert.equal(planInstructorSignatureReminder(f).reason, "under_24_hours");
    f.now = new Date(Date.parse(sentAt) + 86_400_000);
    assert.equal(planInstructorSignatureReminder(f).reason, "outside_send_window");
    f.now = new Date("2026-10-31T09:00:00+09:00");
    assert.equal(planInstructorSignatureReminder(f).status, "ready");
  }
});

for (const [label, change, reason = "invalid_source"] of [
  ["noncanonical id", f => { f.id = `excel_${ID}`; }],
  ["short id", f => { f.id = "ilr_abc"; }],
  ["newline job id", f => { f.id = f.job.jobId = f.job.registrationId = `${ID}\n`; }],
  ["missing jobId", f => { delete f.job.jobId; }],
  ["mismatched jobId", f => { f.job.jobId = `ilr_${"c".repeat(24)}`; }],
  ["mismatched registrationId", f => { f.job.registrationId = `ilr_${"c".repeat(24)}`; }],
  ["wrong studio", f => { f.job.studioId = "other"; }],
  ["numeric studio", f => { f.job.studioId = 5330; }],
  ["fallback member id", f => { f.job.studiomateMemberId = "excel_123"; }],
  ["zero member id", f => { f.job.studiomateMemberId = "0"; }],
  ["leading zero member id", f => { f.job.studiomateMemberId = "0123"; }],
  ["numeric member id", f => { f.job.studiomateMemberId = 123; }],
  ["newline member id", f => { f.job.studiomateMemberId += "\n"; }],
  ["invalid document id", f => { f.job.documentId = "g".repeat(32); }],
  ["short document id", f => { f.job.documentId = "b".repeat(31); }],
  ["newline document id", f => { f.job.documentId += "\n"; }],
  ["wrong template", f => { f.job.templateId = "a".repeat(32); }],
  ["blank document name", f => { f.job.documentName = " "; }],
  ["blank ticket name", f => { f.job.ticketName = ""; }],
  ["empty member name", f => { f.job.memberName = ""; }],
  ["masked name", f => { f.job.memberName = "합* 강사"; }],
  ["newline name", f => { f.job.memberName = "합성\n강사"; }],
  ["padded name", f => { f.job.memberName = " 합성 강사"; }],
  ["masked phone", f => { f.job.memberPhone = "010****0001"; }],
  ["partial phone", f => { f.job.memberPhone = "0001"; }],
  ["partial 010 phone", f => { f.job.memberPhone = "0100000000"; }],
  ["newline phone", f => { f.job.memberPhone += "\n"; }],
  ["noncanonical phone", f => { f.job.memberPhone = "010-0000-0001"; }],
  ["baseline", f => { f.job.baselineOnly = true; }, "job_not_waiting"],
  ["send forbidden", f => { f.job.sendAllowed = false; }, "job_not_waiting"],
  ...["done", "completed", "cancelled", "review_required", "send_review_required", "sending", "pending", "retry"]
    .map(status => [`job ${status}`, f => { f.job.status = status; }, "job_not_waiting"]),
  ["job cancellation", f => { f.job.cancellation = { status: "pending" }; }, "job_not_waiting"],
  ["job refund", f => { f.job.refunded = true; }, "job_not_waiting"],
  ["job review flag", f => { f.job.reviewRequired = true; }, "job_not_waiting"],
  ["job signed", f => { f.job.signedAt = SENT; }, "job_not_waiting"],
  ["source send not clicked", f => { delete f.job.sendClickedAt; }, "original_send_unverified"],
  ["invalid clicked clock", f => { f.job.sendClickedAt = "invalid"; }, "original_send_unverified"],
  ["click after send", f => { f.job.sendClickedAt = f.now; }, "original_send_unverified"],
  ["unfinished original external effect", f => { f.job.externalEffectStarted = true; }, "original_send_unverified"],
  ["future send", f => { f.job.sentAt = "2026-11-01T00:00:00Z"; }, "original_send_unverified"],
  ["registration missing", f => { f.registration = undefined; }, "registration_binding_mismatch"],
  ["registration id", f => { f.registration.registrationId = "other"; }, "registration_binding_mismatch"],
  ["conflicting registration id alias", f => { f.registration.id = "other"; }, "registration_binding_mismatch"],
  ["registration studio", f => { f.registration.studioId = "other"; }, "registration_binding_mismatch"],
  ["registration name", f => { f.registration.memberName = "다른 강사"; }, "registration_binding_mismatch"],
  ["registration phone", f => { f.registration.memberPhone = "01000000002"; }, "registration_binding_mismatch"],
  ["registration native member", f => { f.registration.evidence.studiomateMemberId = "9000002"; }, "registration_binding_mismatch"],
  ["registration document", f => { f.registration.evidence.eformsignDocumentId = "c".repeat(32); }, "registration_binding_mismatch"],
  ["registration missing evidence", f => { delete f.registration.evidence; }, "registration_binding_mismatch"],
  ["conflicting native id alias", f => { f.registration.studiomateMemberId = "9000002"; }, "registration_binding_mismatch"],
  ["registration ticket name", f => { f.registration.ticketName = "Other"; }, "registration_binding_mismatch"],
  ...["cancelled", "cancellation_pending", "completed", "action_required", "queued"]
    .map(status => [`registration ${status}`, f => { f.registration.status = status; }, "registration_not_waiting"]),
  ["registration cancellation", f => { f.registration.cancellation = {}; }, "registration_not_waiting"],
  ["order review", f => { f.registration.externalOrderReviewRequired = true; }, "registration_not_waiting"],
  ["ticket unverified", f => { f.registration.steps.ticket.status = "pending"; }, "registration_not_waiting"],
  ...["verified", "completed", "review_required", "pending", "queued", "processing"]
    .map(status => [`eform ${status}`, f => { f.registration.steps.eformsign.status = status; }, "registration_not_waiting"]),
  ["past lesson", f => { f.job.lessonDate = f.registration.lessonDate = "2026-10-29"; }, "lesson_not_current"],
  ["lesson mismatch", f => { f.registration.lessonDate = "2026-11-29"; }, "lesson_not_current"],
  ["invalid lesson date", f => { f.job.lessonDate = f.registration.lessonDate = "2026-11-31"; }, "lesson_not_current"],
  ["invalid clock", f => { f.now = new Date(NaN); }, "invalid_clock"],
]) test(`planner skips ${label}`, () => {
  const f = fixture(); change(f);
  assert.deepEqual(planInstructorSignatureReminder(f), { status: "skipped", reason });
});

test("accepts both waiting job states, all approved eform steps and today's KST lesson", () => {
  for (const status of ["sent", "waiting_completion"]) {
    for (const step of ["sent", "waiting_external", "waiting_completion"]) {
      const f = fixture();
      f.job.status = status;
      f.registration.steps.eformsign.status = step;
      f.job.lessonDate = f.registration.lessonDate = "2026-10-30";
      assert.equal(planInstructorSignatureReminder(f).status, "ready");
    }
  }
});

for (const status of ["accepted", "sent", "delivered", "attempting", "processing", "review", "failed", "unknown", "deferred", null]) {
  test(`blocks existing ambiguous/terminal reminder ${status}`, () => {
    const f = fixture(); f.job.signatureReminder = { status };
    assert.equal(planInstructorSignatureReminder(f).reason, "reminder_already_recorded");
  });
}

test("only a bound zero-post pretransport deferral can be replanned without mutation", () => {
  const f = fixture(), original = planInstructorSignatureReminder(f);
  defer(f);
  const before = structuredClone(f);
  assert.deepEqual(planInstructorSignatureReminder(f), original);
  assert.deepEqual(f, before);
  const row = f.job.signatureReminder;
  delete row.providerPostCount;
  row.dispatchToken = "synthetic-token";
  row.attemptedAt = NOW.toISOString();
  row.deferrals = [{ dispatchToken: row.dispatchToken, attemptedAt: row.attemptedAt,
    fingerprint: row.fingerprint, providerPostCount: 0 }];
  assert.deepEqual(planInstructorSignatureReminder(f), original);
});

for (const [label, change] of [
  ["attempt", r => { r.attempts = 1; }], ["string attempts", r => { r.attempts = "0"; }],
  ["post", r => { r.providerPostCount = 1; }], ["unknown post count", r => { delete r.providerPostCount; }],
  ["missing pretransport proof", r => { delete r.deferredBeforeTransport; }],
  ["wrong policy", r => { r.policy = "other"; }], ["wrong key", r => { r.key += "other"; }],
  ["wrong fingerprint", r => { r.fingerprint = "f".repeat(64); }],
  ["receipt", r => { r.smsId = 123; }], ["accepted timestamp", r => { r.acceptedAt = SENT; }],
  ["transport start", r => { r.dispatchStarted = true; }],
  ["unknown outcome", r => { r.sendOutcomeUnknown = true; }],
  ["prior send click", r => { r.sendClickedAt = SENT; }],
  ["prior provider start", r => { r.providerPostStartedAt = SENT; }],
  ["conflicting earlier post", r => { r.deferrals = [{ providerPostCount: 1 }]; }],
  ["unbound historical proof", r => { r.deferrals = [{ providerPostCount: 0 }]; }],
  ["malformed deferrals", r => { r.deferrals = {}; }],
]) test(`deferral rejects ${label}`, () => {
  const f = fixture(); change(defer(f));
  assert.equal(planInstructorSignatureReminder(f).reason, "reminder_already_recorded");
});

test("fingerprint binds immutable identity, original sentAt, document and lesson content", () => {
  const baseline = planInstructorSignatureReminder(fixture());
  for (const change of [
    f => { f.job.documentId = f.registration.evidence.eformsignDocumentId = "c".repeat(32); },
    f => { f.job.memberName = f.registration.memberName = "다른 강사"; },
    f => { f.job.memberPhone = f.registration.memberPhone = "01000000002"; },
    f => { f.job.studiomateMemberId = f.registration.evidence.studiomateMemberId = "9000002"; },
    f => { f.job.documentName += "_changed"; },
    f => { f.job.ticketName += "_changed"; },
    f => { f.job.lessonDate = f.registration.lessonDate = "2026-11-29"; },
    f => { f.job.sentAt = "2026-10-28T23:59:59.999Z"; },
  ]) {
    const f = fixture(); change(f);
    const p = planInstructorSignatureReminder(f);
    assert.equal(p.status, "ready");
    assert.notEqual(p.fingerprint, baseline.fingerprint);
    f.job.signatureReminder = { policy: POLICY, key: baseline.key, fingerprint: baseline.fingerprint,
      status: "deferred", attempts: 0, deferredBeforeTransport: true, providerPostCount: 0 };
    assert.equal(planInstructorSignatureReminder(f).reason, "reminder_already_recorded");
  }
});

test("history-backed deferral rejects a mismatched token, timestamp or fingerprint", () => {
  for (const change of [
    r => { r.deferrals[0].dispatchToken = "other"; },
    r => { r.deferrals[0].attemptedAt = SENT; },
    r => { r.deferrals[0].fingerprint = "other"; },
    r => { r.dispatchToken = ""; },
    r => { r.attemptedAt = "invalid"; },
  ]) {
    const f = fixture(), r = defer(f);
    delete r.providerPostCount;
    r.dispatchToken = "synthetic-token";
    r.attemptedAt = NOW.toISOString();
    r.deferrals = [{ providerPostCount: 0, dispatchToken: r.dispatchToken,
      attemptedAt: r.attemptedAt, fingerprint: r.fingerprint }];
    change(r);
    assert.equal(planInstructorSignatureReminder(f).reason, "reminder_already_recorded");
  }
});

test("fresh exactly bound live evidence succeeds without mutating its arguments", () => {
  const f = liveFixture(), before = structuredClone(f);
  assert.equal(assertInstructorSignatureReminderLive(f), undefined);
  assert.deepEqual(f, before);
});

for (const field of ["aggregate", "document", "member", "ticket"]) {
  for (const [label, timestamp] of [
    ["missing", undefined], ["invalid", "invalid"],
    ["older than 60 seconds", new Date(NOW.getTime() - 60_001).toISOString()],
    ["future", new Date(NOW.getTime() + 1).toISOString()],
  ]) test(`live ${field} rejects ${label} checkedAt`, () => {
    const f = liveFixture(), row = field === "aggregate" ? f.live : f.live[field];
    row.checkedAt = timestamp;
    rejectsLive(f, "live_stale");
  });
}
test("all four live reads may be exactly 60 seconds old", () => {
  const f = liveFixture();
  for (const row of [f.live, f.live.document, f.live.member, f.live.ticket]) {
    row.checkedAt = new Date(NOW.getTime() - 60_000).toISOString();
  }
  assert.doesNotThrow(() => assertInstructorSignatureReminderLive(f));
});

for (const [label, change, code = "document_unverified"] of [
  ["non-status source", f => { f.live.document.source = "eformsign_list"; }],
  ["unverified document", f => { f.live.document.verified = false; }],
  ["wrong document", f => { f.live.document.documentId = "c".repeat(32); }],
  ["invalid document", f => { f.live.document.documentId = "bad"; }],
  ["wrong template", f => { f.live.document.templateId = "a".repeat(32); }],
  ["wrong document name", f => { f.live.document.documentName += "other"; }],
  ...["completed", "signed", "cancelled", "expired", "unknown"].map(status =>
    [`document ${status}`, f => { f.live.document.status = status; }]),
  ["conflicting signature", f => { f.live.document.signedAt = SENT; }],
  ["multiple recipients", f => { f.live.document.recipientCount = 2; }],
  ["unknown recipient count", f => { delete f.live.document.recipientCount; }],
  ["wrong recipient name", f => { f.live.document.recipientName = "다른 강사"; }],
  ["masked recipient name", f => { f.live.document.recipientName = "합* 강사"; }],
  ["wrong recipient phone", f => { f.live.document.recipientPhone = "01000000002"; }],
  ["masked recipient phone", f => { f.live.document.recipientPhone = "010****0001"; }],
  ["unverified member", f => { f.live.member.verified = false; }, "member_unverified"],
  ["wrong member id", f => { f.live.member.memberId = "9000002"; }, "member_unverified"],
  ["wrong member name", f => { f.live.member.name = "다른 강사"; }, "member_unverified"],
  ["wrong member phone", f => { f.live.member.phone = "01000000002"; }, "member_unverified"],
  ["ordinary member", f => { f.live.member.memberGrade = "일반회원"; }, "member_unverified"],
  ["inactive member", f => { f.live.member.inactive = true; }, "member_unverified"],
  ["unknown activity", f => { delete f.live.member.inactive; }, "member_unverified"],
  ["wrong member studio", f => { f.live.member.studioId = "other"; }, "member_unverified"],
  ["unverified ticket", f => { f.live.ticket.verified = false; }, "ticket_unverified"],
  ["wrong ticket member", f => { f.live.ticket.memberId = "9000002"; }, "ticket_unverified"],
  ["wrong ticket lesson", f => { f.live.ticket.lessonDate = "2026-11-29"; }, "ticket_unverified"],
  ["wrong ticket title", f => { f.live.ticket.title = "Other"; }, "ticket_unverified"],
  ["refunded ticket", f => { f.live.ticket.refunded = true; }, "ticket_unverified"],
  ["cancelled ticket", f => { f.live.ticket.cancelled = true; }, "ticket_unverified"],
  ["unknown refund", f => { delete f.live.ticket.refunded; }, "ticket_unverified"],
  ["unknown cancellation", f => { delete f.live.ticket.cancelled; }, "ticket_unverified"],
  ["wrong ticket studio", f => { f.live.ticket.studioId = "other"; }, "ticket_unverified"],
]) test(`live rejects ${label} with a safe stable code`, () => {
  const f = liveFixture(); change(f); rejectsLive(f, code);
});

for (const [label, change] of [
  ["current cancellation", f => { f.registration.cancellation = {}; }],
  ["current signature completion", f => { f.registration.steps.eformsign.status = "verified"; }],
  ["current accepted reminder", f => { f.job.signatureReminder = { status: "accepted" }; }],
  ["current identity changed", f => { f.job.memberPhone = f.registration.memberPhone = "01000000002"; }],
  ["plan SMS changed", f => { f.plan.smsMessage += "changed"; }],
  ["plan template changed", f => { f.plan.templateId = "a".repeat(32); }],
  ["plan fingerprint changed", f => { f.plan.fingerprint = "a".repeat(64); }],
  ["plan missing", f => { delete f.plan; }],
  ["clock invalid", f => { f.now = new Date(NaN); }],
  ["20:00 crossed", f => { f.now = new Date("2026-10-30T20:00:00+09:00"); }],
]) test(`live revalidates ${label}`, () => {
  const f = liveFixture(); change(f); rejectsLive(f, "source_unverified");
});

test("missing arguments fail closed with no personal information", () => {
  assert.equal(planInstructorSignatureReminder().reason, "invalid_source");
  assert.throws(() => assertInstructorSignatureReminderLive(), { code: "instructor_signature_reminder_source_unverified" });
});
