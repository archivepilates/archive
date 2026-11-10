import assert from "node:assert/strict";
import test from "node:test";
import {
  assertActor, assertAssignee, assertRead, fixedException, InquiryError, planHash,
  transition, validateSubmission, type Actor, type InquiryRow,
} from "../../firebase/kangsain-functions/functions/src/memberInquiries/policy";
import { memberInquiryContract as contract } from "../../firebase/packages/contracts/src/member-inquiries";

const NOW = "2026-11-09T13:00:00.000Z";
const owner: Actor = { staffId: "manager-1", name: "테스트관리자", studioId: "5330", role: "manager", active: true };
const worker: Actor = { staffId: "worker-1", name: "테스트직원", studioId: "5330", role: "instructor", active: true,
  employmentStatus: "current", employmentSource: "studiomate_staff_tab_browser_scan" };
const categoryAnswers: Record<string, Record<string, unknown>> = {
  renewal: { lesson: "그룹레슨", start: "현재 수강권 종료 후" },
  booking: { request: "수업 취소", mode: "자유예약" },
  holding: { ticket: "횟수권", duration: "1주" },
  conversion: { current: "그룹레슨", desired: "프라이빗", start: "상담 후 결정" },
  fixed: { request: "이용 규정 문의" },
  other: { topic: "시설 이용", reply: "이용 방법 안내" },
};

function body(category = "renewal", overrides: Record<string, unknown> = {}): any {
  return { requestKey: "a".repeat(48), category, memberName: "테스트회원", memberPhone: "01000000000",
    answers: { ...categoryAnswers[category] }, details: "", contact: "문자", privacyConsent: true,
    privacyVersion: contract.privacyVersion, policyVersion: contract.policyVersion, website: "", ...overrides };
}
function row(category = "renewal", overrides: Record<string, unknown> = {}): InquiryRow {
  return { ...validateSubmission(body(category)), id: "mi_" + "b".repeat(32), studioId: "5330",
    revision: 1, status: "in_review", assignedStaffId: worker.staffId, approval: null, completion: null, ...overrides };
}
function reviewInput(overrides: Record<string, unknown> = {}): any {
  return { action: "review", expectedRevision: 1, resolutionKind: "guidance", policyFit: "within_policy",
    plan: "현재 수강료 기준으로 상담 안내", memberReply: "담당자가 안내드리겠습니다.", internalNote: "", ...overrides };
}
function reviewed(source: InquiryRow = row(), overrides: Record<string, unknown> = {}): InquiryRow {
  return { ...source, ...transition(source, worker, reviewInput({ expectedRevision: source.revision, ...overrides }), NOW) } as InquiryRow;
}
function approved(source: InquiryRow = reviewed()): InquiryRow {
  return { ...source, ...transition(source, owner, { action: "approve", expectedRevision: source.revision,
    expectedReviewHash: source.reviewHash, reason: fixedException(source) ? "예외 상담안 검토" : "" }, NOW) } as InquiryRow;
}
function executionInput(source: InquiryRow, overrides: Record<string, unknown> = {}): any {
  return { action: "record_execution", expectedRevision: source.revision, expectedReviewHash: source.reviewHash,
    executionNote: "Manual processing checked", executionEvidence: "Synthetic processing record", ...overrides };
}
function notificationInput(source: InquiryRow, overrides: Record<string, unknown> = {}): any {
  return { action: "record_notification", expectedRevision: source.revision, expectedReviewHash: source.reviewHash,
    notificationOutcome: "manual_contact_recorded", notificationChannel: "phone",
    notificationNote: "Manual contact checked", notificationEvidence: "Synthetic contact record", ...overrides };
}
function evidenced(source: InquiryRow = approved()): InquiryRow {
  const executed = { ...source, ...transition(source, worker, executionInput(source), NOW) } as InquiryRow;
  return { ...executed, ...transition(executed, worker, notificationInput(executed), NOW) } as InquiryRow;
}
function rejects(status: number, action: () => unknown): void {
  assert.throws(action, (error: unknown) => error instanceof InquiryError && error.status === status);
}

for (const category of Object.keys(categoryAnswers)) {
  test(`accepts one valid ${category} inquiry without free text`, () => {
    const result = validateSubmission(body(category));
    assert.equal(result.category, category);
    assert.equal(result.memberName, "테스트회원");
    assert.equal(result.memberPhone, "01000000000");
    assert.equal(result.details, "");
    assert.equal(result.privacyConsent, true);
  });
}

test("normalizes deliberate phone separators and international prefix", () => {
  assert.equal(validateSubmission(body("renewal", { memberPhone: "+82 10-0000-0000" })).memberPhone, "01000000000");
});
test("rejects arbitrary characters instead of silently changing the phone", () => {
  rejects(400, () => validateSubmission(body("renewal", { memberPhone: "010abc00000000" })));
});

for (const [name, patch] of Object.entries({
  category: { category: "refund" },
  unknownChoice: { answers: { lesson: "무료 무제한", start: "이번 달" } },
  missingChoice: { answers: { lesson: "그룹레슨" } },
  unknownQuestion: { answers: { ...categoryAnswers.renewal, payment: "paid" } },
  consent: { privacyConsent: false },
  policyVersion: { policyVersion: "old" },
  privacyVersion: { privacyVersion: "old" },
  requestKey: { requestKey: "short" },
  honeypot: { website: "https://example.invalid" },
  phone: { memberPhone: "0100000000" },
  emptyName: { memberName: " " },
  controlText: { details: "입력\u0000오류" },
  tooLongText: { details: "가".repeat(201) },
  invalidContact: { contact: "공개 댓글" },
  clientAuthority: { approval: { decision: "approve" } },
  sourceRecord: { memberId: "native-member-fixture", currentTicket: { remaining: 100 } },
})) {
  test(`submission rejects ${name}`, () => rejects(400, () => validateSubmission(body("renewal", patch))));
}

test("validated payload carries member intent, not client identity or execution authority", () => {
  const result = validateSubmission(body());
  for (const key of ["requestKey", "memberId", "approval", "status", "externalExecutionAuthorized", "currentTicket"])
    assert.equal(Object.hasOwn(result, key), false);
  assert.deepEqual(result.answers, categoryAnswers.renewal);
});

test("rejects stale answers to booking questions hidden by cancellation choice", () => {
  rejects(400, () => validateSubmission(body("booking", { answers: { ...categoryAnswers.booking, nextDay: ["월"], nextTime: "오전" } })));
});
test("rejects stale fixed-schedule answers hidden by a guidance request", () => {
  rejects(400, () => validateSubmission(body("fixed", { answers: { request: "이용 규정 문의", days: ["월"], time: "오전" } })));
});
test("requires active change questions and rejects duplicate or contradictory multiple choices", () => {
  const change = { request: "다른 수업으로 변경", mode: "자유예약" };
  rejects(400, () => validateSubmission(body("booking", { answers: change })));
  for (const nextDay of [["월", "월"], ["월", "상담 후 결정"], ["없는요일"]])
    rejects(400, () => validateSubmission(body("booking", { answers: { ...change, nextDay, nextTime: "오전" } })));
  const result = validateSubmission(body("booking", { answers: { ...change, nextDay: ["수", "월"], nextTime: "오전" } }));
  assert.deepEqual(result.answers.nextDay, ["수", "월"].sort());
});
test("validates calendar dates, month and clock time rather than regex shape alone", () => {
  for (const classDate of ["2026-02-29", "2026-13-01", "2026-11-31"])
    rejects(400, () => validateSubmission(body("booking", { answers: { ...categoryAnswers.booking, classDate } })));
  for (const classTime of ["24:00", "12:60", "9:00"])
    rejects(400, () => validateSubmission(body("booking", { answers: { ...categoryAnswers.booking, classTime } })));
  rejects(400, () => validateSubmission(body("fixed", { answers: { request: "이용 규정 문의", month: "2026-13" } })));
  assert.equal(validateSubmission(body("booking", { answers: { ...categoryAnswers.booking, classDate: "2028-02-29", classTime: "19:30" } })).answers.classDate, "2028-02-29");
});

test("all active same-studio instructors, owners and managers can read assigned or unassigned inquiries without a special flag", () => {
  for (const actor of [worker, { ...worker, memberInquiryAccess: false }, owner, { ...owner, role: "owner" }]) {
    assert.doesNotThrow(() => assertActor(actor));
    assert.doesNotThrow(() => assertRead(actor, row()));
    assert.doesNotThrow(() => assertRead(actor, row("renewal", { assignedStaffId: "other-worker" })));
    assert.doesNotThrow(() => assertRead(actor, row("renewal", { assignedStaffId: "" })));
    rejects(403, () => assertRead(actor, row("renewal", { studioId: "another-studio" })));
  }
});
for (const actor of [
  { ...worker, active: false }, { ...worker, role: "viewer" },
  { ...worker, role: "member" }, { ...worker, studioId: "another-studio" },
  { ...worker, staffId: "" }, { ...owner, active: false },
]) test(`actor fails closed: ${JSON.stringify(actor)}`, () => rejects(403, () => assertActor(actor)));

test("assignee requires canonical current instructor employment but preserves legacy operator compatibility", () => {
  for (const actor of [worker, { ...worker, memberInquiryAccess: false }, owner, { ...owner, role: "owner" },
    { ...owner, employmentStatus: "current" }, { ...owner, role: "owner", employmentStatus: "current" }])
    assert.doesNotThrow(() => assertAssignee(actor));
});

for (const role of ["instructor", "manager", "owner"]) {
  for (const employmentStatus of ["retired", "inactive", "unknown", ""]) {
    test(`assignee rejects explicit ${employmentStatus || "empty"} employment for ${role} despite active account`, () => {
      const actor = { ...worker, role, employmentStatus };
      assert.doesNotThrow(() => assertActor(actor));
      rejects(403, () => assertAssignee(actor));
    });
  }
}

for (const [name, patch] of Object.entries({
  missingStatus: { employmentStatus: undefined }, missingSource: { employmentSource: undefined },
  invalidSource: { employmentSource: "excel_import" }, emptySource: { employmentSource: "" },
  disabled: { active: false }, foreign: { studioId: "another-studio" },
  invalidRole: { role: "viewer" }, missingIdentity: { staffId: "" },
})) {
  test(`assignee rejects ${name}`, () => rejects(403, () => assertAssignee({ ...worker, ...patch })));
}

test("historic retired assignee remains readable without changing its saved assignment", () => {
  const retired = { ...worker, employmentStatus: "retired" };
  const source = row("renewal", { assignedStaffName: retired.name });
  const before = structuredClone(source);
  for (const actor of [worker, retired, owner]) assert.doesNotThrow(() => assertRead(actor, source));
  rejects(403, () => assertAssignee(retired));
  assert.deepEqual(source, before);
});

for (const actor of [
  { ...worker, employmentStatus: "retired" }, { ...worker, employmentStatus: undefined },
  { ...worker, employmentSource: undefined }, { ...worker, employmentSource: "excel_import" },
  { ...owner, employmentStatus: "retired" }, { ...owner, role: "owner", employmentStatus: "retired" },
]) {
  test(`claim rejects ineligible assignee ${actor.role}/${actor.employmentStatus}/${actor.employmentSource}`, () => {
    const source = row("renewal", { assignedStaffId: "", status: "received" });
    const before = structuredClone(source);
    rejects(403, () => transition(source, actor, { action: "claim", expectedRevision: 1 }, NOW));
    assert.deepEqual(source, before);
  });
}

test("read-all permission does not let an instructor review or claim another employee's inquiry", () => {
  const source = row("renewal", { assignedStaffId: "other-worker" });
  assert.doesNotThrow(() => assertRead(worker, source));
  rejects(403, () => transition(source, worker, reviewInput(), NOW));
  rejects(403, () => transition(source, worker, { action: "claim", expectedRevision: 1 }, NOW));
  assert.equal(transition(source, owner, reviewInput(), NOW).status, "awaiting_approval");
  assert.equal(transition(source, owner, { action: "claim", expectedRevision: 1, assignmentReason: "Manager handoff" }, NOW).assignedStaffId, owner.staffId);
});
test("claim requires a bounded handoff reason only when changing an existing assignee", () => {
  const source = row();
  const before = structuredClone(source);
  for (const assignmentReason of [undefined, "", "  ", "x".repeat(501)])
    rejects(400, () => transition(source, owner, { action: "claim", expectedRevision: 1, assignmentReason }, NOW));
  const next = transition(source, owner, { action: "claim", expectedRevision: 1, assignmentReason: "  Manager handoff  " }, NOW);
  assert.equal(next.handoffReason, "Manager handoff");
  assert.equal(transition(source, owner, { action: "claim", expectedRevision: 1, assignmentReason: "x".repeat(500) }, NOW).handoffReason.length, 500);
  assert.equal(transition(source, worker, { action: "claim", expectedRevision: 1 }, NOW).handoffReason, "");
  assert.equal(transition(row("renewal", { assignedStaffId: "" }), owner, { action: "claim", expectedRevision: 1 }, NOW).handoffReason, "");
  assert.deepEqual(source, before);
});
test("an instructor can claim an unassigned inquiry before reviewing it", () => {
  const source = row("renewal", { assignedStaffId: "", status: "received" });
  rejects(403, () => transition(source, worker, reviewInput(), NOW));
  const claimed = { ...source, ...transition(source, worker, { action: "claim", expectedRevision: 1 }, NOW) } as InquiryRow;
  assert.equal(claimed.assignedStaffId, worker.staffId);
  assert.equal(claimed.status, "in_review");
  assert.equal(transition(claimed, worker, reviewInput({ expectedRevision: claimed.revision }), NOW).status, "awaiting_approval");
});

test("review binds the full plan and clears previous approval, execution, notification and completion", () => {
  const source = evidenced();
  const next = transition(source, worker, reviewInput({ expectedRevision: source.revision, plan: "수정한 상담안" }), NOW);
  assert.equal(next.status, "awaiting_approval");
  assert.equal(next.approval, null);
  assert.equal(next.completion, null);
  assert.equal(next.execution, null);
  assert.equal(next.notification, null);
  assert.notEqual(next.reviewHash, source.reviewHash);
  assert.equal(next.reviewHash, planHash(source, next.review));
  assert.equal(source.status, "approved");
});
for (const source of [
  row("booking", { answers: { request: "수업 취소", mode: "고정예약" } }),
  row("booking", { answers: { request: "다른 수업으로 변경", mode: "고정예약", nextDay: ["월"], nextTime: "오전" } }),
  row("fixed", { answers: { request: "취소·변경 예외 상담" } }),
]) {
  test(`fixed cancellation/change requires exception classification: ${source.category}/${source.answers.request}`, () => {
    assert.equal(fixedException(source), true);
    rejects(400, () => transition(source, worker, reviewInput(), NOW));
    rejects(400, () => transition(source, worker, reviewInput({ policyFit: "exception", resolutionKind: "manual_processing" }), NOW));
    assert.equal(reviewed(source, { policyFit: "exception", resolutionKind: "exception_review" }).review.policyFit, "exception");
  });
}
test("fixed guidance and a new fixed application are not mislabeled as cancellation exceptions", () => {
  assert.equal(fixedException(row("fixed")), false);
  assert.equal(fixedException(row("fixed", { answers: { request: "새 고정예약 신청", days: ["월"], time: "오전" } })), false);
});
test("ticket conversion cannot be declared within policy even by a manager", () => {
  rejects(400, () => transition(row("conversion"), owner, reviewInput(), NOW));
  assert.equal(reviewed(row("conversion"), { policyFit: "insufficient", resolutionKind: "manual_processing" }).status, "awaiting_approval");
});
test("review rejects missing or oversized plan/reply/note", () => {
  for (const patch of [{ plan: " " }, { memberReply: "" }, { plan: "가".repeat(2001) },
    { memberReply: "가".repeat(1501) }, { internalNote: "가".repeat(1001) }])
    rejects(400, () => transition(row(), worker, reviewInput(patch), NOW));
});

for (const action of ["approve", "reject", "needs_information"]) {
  test(`only manager may ${action} the exact review`, () => {
    const source = reviewed();
    const input = { action, expectedRevision: source.revision, expectedReviewHash: source.reviewHash, reason: "검토 사유" };
    rejects(403, () => transition(source, worker, input, NOW));
    const next = transition(source, owner, input, NOW);
    assert.equal(next.status, action === "approve" ? "approved" : action === "reject" ? "rejected" : "needs_information");
    assert.equal(next.approval.scope, "inquiry_plan_only");
    assert.equal(next.approval.externalExecutionAuthorized, false);
  });
}
test("manager must record an exception reason for fixed cancellation review", () => {
  const source = reviewed(row("fixed", { answers: { request: "취소·변경 예외 상담" } }), { policyFit: "exception", resolutionKind: "exception_review" });
  rejects(400, () => transition(source, owner, { action: "approve", expectedRevision: source.revision, expectedReviewHash: source.reviewHash, reason: "" }, NOW));
});
test("stale, fractional, missing revisions and wrong review hashes never approve", () => {
  const source = reviewed();
  for (const expectedRevision of [source.revision - 1, 1.5, undefined])
    rejects(409, () => transition(source, owner, { action: "approve", expectedRevision, expectedReviewHash: source.reviewHash }, NOW));
  rejects(409, () => transition(source, owner, { action: "approve", expectedRevision: source.revision, expectedReviewHash: "stale-hash" }, NOW));
});
test("changing reviewed member intent or review content invalidates the approval plan", () => {
  const source = reviewed();
  const changedRows = [
    { ...source, details: "달라진 문의" }, { ...source, memberName: "다른테스트회원" },
    { ...source, memberPhone: "01000000001" }, { ...source, answers: { ...source.answers, start: "다음 달" } },
    { ...source, review: { ...source.review, plan: "승인 전 변경된 내용" } },
  ];
  for (const changed of changedRows)
    rejects(409, () => transition(changed, owner, { action: "approve", expectedRevision: changed.revision, expectedReviewHash: source.reviewHash }, NOW));
});
test("Firestore map key reordering preserves the review hash and exact-plan approval", () => {
  const source = reviewed();
  const reordered = { ...source,
    answers: Object.fromEntries(Object.entries(source.answers).reverse()),
    review: Object.fromEntries(Object.entries(source.review).reverse()),
  } as InquiryRow;
  assert.deepEqual(reordered.answers, source.answers);
  assert.deepEqual(reordered.review, source.review);
  assert.equal(planHash(reordered, reordered.review), source.reviewHash);
  const next = transition(reordered, owner, { action: "approve", expectedRevision: source.revision,
    expectedReviewHash: source.reviewHash }, NOW);
  assert.equal(next.status, "approved");
  assert.equal(next.approval.reviewHash, source.reviewHash);
});
test("approval rejects a review from a superseded policy version even if its hash is recomputed", () => {
  const source = reviewed();
  source.review = { ...source.review, policyVersion: "old" };
  source.reviewHash = planHash(source, source.review);
  rejects(409, () => transition(source, owner, { action: "approve", expectedRevision: source.revision, expectedReviewHash: source.reviewHash }, NOW));
});

test("completion requires current manager approval and both recorded manual verifications", () => {
  const source = evidenced();
  const input = { action: "complete", expectedRevision: source.revision, expectedReviewHash: source.reviewHash,
    completionNote: "상담 결과를 확인했습니다.", evidence: "합성 테스트 확인 기록" };
  const next = transition(source, worker, input, NOW);
  assert.equal(next.status, "completed");
  assert.equal(next.completion.recordedManually, true);
  assert.equal(next.completion.providerSendVerified, false);
  assert.equal(next.memberNotificationStatus, "not_sent_by_system");
  for (const bad of [reviewed(), { ...source, approval: null }, { ...source, review: { ...source.review, plan: "변경됨" } }])
    rejects(409, () => transition(bad as InquiryRow, worker, { ...input, expectedRevision: bad.revision }, NOW));
  rejects(409, () => transition(source, worker, { ...input, expectedReviewHash: "old" }, NOW));
  rejects(400, () => transition(source, worker, { ...input, evidence: "" }, NOW));
  rejects(400, () => transition(source, worker, { ...input, completionNote: " " }, NOW));
});
test("read-all permission does not authorize completing another assignee's approved inquiry", () => {
  const source = { ...evidenced(), assignedStaffId: "other-worker" } as InquiryRow;
  const input = { action: "complete", expectedRevision: source.revision, expectedReviewHash: source.reviewHash,
    completionNote: "상담 결과 확인", evidence: "합성 테스트 기록" };
  assert.doesNotThrow(() => assertRead(worker, source));
  rejects(403, () => transition(source, worker, input, NOW));
  assert.equal(transition(source, owner, input, NOW).status, "completed");
});
test("completed inquiries reject every mutating policy transition", () => {
  const source = evidenced();
  const completed = { ...source, ...transition(source, worker, { action: "complete", expectedRevision: source.revision,
    expectedReviewHash: source.reviewHash, completionNote: "완료 확인", evidence: "합성 확인 기록" }, NOW) } as InquiryRow;
  for (const action of ["claim", "review", "approve", "reject", "needs_information", "record_execution", "record_notification", "complete"])
    rejects(409, () => transition(completed, owner, { ...reviewInput(), action, expectedRevision: completed.revision, expectedReviewHash: completed.reviewHash }, NOW));
});

for (const [action, inputFor, fields] of [
  ["record_execution", executionInput, ["executionNote", "executionEvidence"]],
  ["record_notification", notificationInput, ["notificationNote", "notificationEvidence"]],
] as const) {
  test(`${action} requires current approval, canonical revision/hash and assignee permission`, () => {
    const source = approved();
    const before = structuredClone(source);
    for (const bad of [reviewed(), { ...source, approval: null },
      { ...source, approval: { ...source.approval, reviewHash: "foreign-review" } },
      { ...source, review: { ...source.review, plan: "Changed plan" } }])
      rejects(409, () => transition(bad as InquiryRow, worker, inputFor(bad as InquiryRow), NOW));
    for (const expectedRevision of [undefined, source.revision - 1, 1.5])
      rejects(409, () => transition(source, worker, inputFor(source, { expectedRevision }), NOW));
    for (const expectedReviewHash of [undefined, "stale-hash", reviewed(row("renewal", { id: "mi_" + "c".repeat(32) })).reviewHash])
      rejects(409, () => transition(source, worker, inputFor(source, { expectedReviewHash }), NOW));
    rejects(403, () => transition(source, { ...worker, staffId: "other-worker" }, inputFor(source), NOW));
    rejects(403, () => transition(source, { ...owner, studioId: "other" }, inputFor(source), NOW));
    assert.deepEqual(source, before);
  });
  test(`${action} rejects missing, blank and oversized note or evidence`, () => {
    const source = approved();
    for (const [index, field] of fields.entries())
      for (const value of [undefined, "", "  ", "x".repeat(index === 0 ? 1501 : 501)])
        rejects(400, () => transition(source, worker, inputFor(source, { [field]: value }), NOW));
  });
}

test("execution and notification records are manual evidence, not external execution or provider proof", () => {
  const source = approved();
  const executed = transition(source, worker, executionInput(source), NOW);
  assert.deepEqual(executed.execution, { by: worker.staffId, at: NOW, reviewHash: source.reviewHash,
    note: "Manual processing checked", evidence: "Synthetic processing record", recordedManually: true, externalChangeVerifiedBySystem: false });
  for (const notificationChannel of ["phone", "kakao", "sms", "onsite"])
    assert.deepEqual(transition(source, worker, notificationInput(source, { notificationChannel }), NOW).notification,
      { by: worker.staffId, at: NOW, reviewHash: source.reviewHash, outcome: "manual_contact_recorded", channel: notificationChannel,
        note: "Manual contact checked", evidence: "Synthetic contact record", recordedManually: true, providerSendVerified: false });
  assert.equal(transition(source, worker, notificationInput(source, {
    notificationOutcome: "not_required", notificationChannel: "none" }), NOW).notification.providerSendVerified, false);
});

test("notification outcome and channel combinations fail closed", () => {
  const source = approved();
  for (const patch of [{ notificationOutcome: "not_required", notificationChannel: "phone" },
    { notificationOutcome: "manual_contact_recorded", notificationChannel: "none" },
    { notificationOutcome: "sent" }, { notificationChannel: "email" },
    { notificationOutcome: undefined }, { notificationChannel: undefined }])
    rejects(400, () => transition(source, worker, notificationInput(source, patch), NOW));
});

test("completion rejects missing, stale or foreign execution and notification evidence", () => {
  const source = evidenced();
  const foreign = evidenced(approved(reviewed(row("renewal", { id: "mi_" + "c".repeat(32) }))));
  for (const field of ["execution", "notification"])
    for (const value of [null, undefined, { ...source[field], reviewHash: "stale-hash" }, foreign[field]]) {
      const bad = { ...source, [field]: value } as InquiryRow;
      rejects(409, () => transition(bad, worker, { action: "complete", expectedRevision: bad.revision,
        expectedReviewHash: bad.reviewHash, completionNote: "Manual completion", evidence: "Synthetic record" }, NOW));
    }
});

test("a changed review and fresh approval never reuse previous manual evidence", () => {
  const source = evidenced();
  const next = reviewed(source, { plan: "Replacement plan" });
  const reapproved = approved(next);
  assert.notEqual(reapproved.reviewHash, source.reviewHash);
  assert.equal(reapproved.execution, null);
  assert.equal(reapproved.notification, null);
  rejects(409, () => transition(reapproved, worker, { action: "complete", expectedRevision: reapproved.revision,
    expectedReviewHash: reapproved.reviewHash, completionNote: "Manual completion", evidence: "Synthetic record" }, NOW));
  assert.equal(evidenced(reapproved).execution.reviewHash, reapproved.reviewHash);
});
