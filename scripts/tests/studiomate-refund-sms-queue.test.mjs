import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  assertRefundSmsSourceUnchanged,
  classifyStudioMateSmsSendEvidence,
  normalizeRefundSmsJob,
  staleRefundSmsJobRecoveryStatus,
} from "../lib/studiomate-refund-sms-contract.mjs";

const baseJob = {
  jobId: "refund_sms_test",
  caseId: "refund_case_test",
  studioId: "5330",
  memberId: "member_test",
  studiomateMemberId: "1234",
  memberName: "테스트회원",
  memberPhone: "010-0000-0000",
  ticketKey: "userTicket:test",
  ticketName: "10주(주2회)",
  ticketExpiresAt: "2026-12-31T23:59:59+09:00",
  ticketSourceSnapshot: {
    ticketKey: "userTicket:test",
    ticketName: "10주(주2회)",
    status: "active",
    paymentAmount: 398000,
    totalCount: null,
    remainingCount: null,
    availableFrom: "2026-06-29T00:00:00.000Z",
    purchasedAt: null,
    paymentAt: null,
    expiresAt: "2026-12-31T14:59:59.000Z",
  },
  calculationHash: "calculation-hash",
  smsTitle: "ARCHIVE PILATES 환불 안내",
  smsMessage: "[ARCHIVE PILATES 환불 예상금액 안내]\n\n예상 환불금액: 119,400원",
};

test("SMS dispatch uses the verified native ID and repeats the source guard before final send", async () => {
  const source = await readFile(new URL("../process-studiomate-refund-sms-jobs.mjs", import.meta.url), "utf8");
  assert.match(source, /sendRefundSms\(page, job, live\.nativeSource\.studiomateMemberId/);
  assert.match(source, /fresh\.nativeSource\.studiomateMemberId !== live\.nativeSource\.studiomateMemberId/);
  assert.match(source, /studiomateMemberId: refundNativeMemberPointer\(job, profile\)/);
  assert.doesNotMatch(source, /resolveStudioMateMemberId/);
  assert.equal((source.match(/assertLiveRefundSource\(job, page\)/g) || []).length, 3);
});

const profile = {
  studioId: "5330",
  activeTickets: [{
    userTicketId: "test",
    name: "10주(주2회)",
    status: "active",
    paymentAmount: 398000,
    availableFrom: "2026-06-29T00:00:00.000Z",
    expiresAt: "2026-12-31T14:59:59.000Z",
  }],
};

test("환불 문자 작업은 고정된 제목·본문과 정상 회원 원천만 허용한다", () => {
  const job = normalizeRefundSmsJob(baseJob);
  assert.equal(job.memberPhone, "01000000000");
  assert.throws(() => normalizeRefundSmsJob({ ...baseJob, smsTitle: "임의 제목" }), /승인되지 않은/);
  assert.throws(() => normalizeRefundSmsJob({ ...baseJob, smsMessage: "임의 본문" }), /승인되지 않은/);
});

test("발송 직전 수강권과 계산 해시가 모두 같아야 한다", () => {
  const job = normalizeRefundSmsJob(baseJob);
  const refundCase = {
    studioId: "5330",
    calculationHash: "calculation-hash",
    smsNotice: { jobId: "refund_sms_test" },
  };
  assert.doesNotThrow(() => assertRefundSmsSourceUnchanged(job, profile, refundCase));
  assert.throws(
    () => assertRefundSmsSourceUnchanged(job, profile, { ...refundCase, calculationHash: "changed" }),
    /계산값이 변경/,
  );
});

test("최종 클릭 이후 중단된 작업은 자동 재시도하지 않는다", () => {
  assert.equal(staleRefundSmsJobRecoveryStatus({ status: "processing", attempts: 1, maxAttempts: 3 }), "retry");
  assert.equal(staleRefundSmsJobRecoveryStatus({ status: "sending", attempts: 1, maxAttempts: 3 }), "send_review_required");
  assert.equal(staleRefundSmsJobRecoveryStatus({ status: "processing", sendClickedAt: {} }), "send_review_required");
  assert.equal(staleRefundSmsJobRecoveryStatus({ status: "processing", attempts: 3, maxAttempts: 3 }), "failed");
  assert.equal(staleRefundSmsJobRecoveryStatus({ status: "failed", sendClickedAt: {}, attempts: 3 }), "send_review_required");
});

const refundCase = {
  studioId: baseJob.studioId,
  calculationHash: baseJob.calculationHash,
  smsNotice: { jobId: baseJob.jobId },
};

test("Firestore 필드 순서가 달라도 같은 환불 문자 원천은 통과한다", () => {
  const reordered = Object.fromEntries(Object.entries(baseJob.ticketSourceSnapshot).sort(([a], [b]) => a.localeCompare(b)));
  const job = normalizeRefundSmsJob({ ...baseJob, ticketSourceSnapshot: reordered });
  assert.doesNotThrow(() => assertRefundSmsSourceUnchanged(job, profile, refundCase));
  assert.doesNotThrow(() => assertRefundSmsSourceUnchanged({ ...job, ticketSourceSnapshot: reordered }, profile, refundCase));
});

test("동일 계산 해시라도 환불 문자 원천 필드 변경은 모두 차단한다", () => {
  const changedValues = {
    ticketKey: "userTicket:other",
    ticketName: "Changed pass",
    status: "inactive",
    paymentAmount: 397999,
    totalCount: 10,
    remainingCount: 9,
    availableFrom: "2026-06-30T00:00:00.000Z",
    purchasedAt: "2026-06-28T00:00:00.000Z",
    paymentAt: "2026-06-28T00:00:00.000Z",
    expiresAt: "2026-12-30T14:59:59.000Z",
  };
  for (const [key, value] of Object.entries(changedValues)) {
    const job = normalizeRefundSmsJob({ ...baseJob, ticketSourceSnapshot: { ...baseJob.ticketSourceSnapshot, [key]: value } });
    assert.equal(job.calculationHash, baseJob.calculationHash);
    assert.throws(() => assertRefundSmsSourceUnchanged(job, profile, refundCase), /원천이 변경/, key);
  }
});

test("환불 문자 스냅샷의 누락 필드와 알 수 없는 필드를 차단한다", () => {
  for (const key of Object.keys(baseJob.ticketSourceSnapshot)) {
    const snapshot = { ...baseJob.ticketSourceSnapshot };
    delete snapshot[key];
    assert.throws(() => normalizeRefundSmsJob({ ...baseJob, ticketSourceSnapshot: snapshot }), /스냅샷/, key);
    assert.throws(() => assertRefundSmsSourceUnchanged({ ...baseJob, ticketSourceSnapshot: snapshot }, profile, refundCase), /스냅샷/, key);
  }
  for (const snapshot of [undefined, null, [], "snapshot", {}, { ...baseJob.ticketSourceSnapshot, unexpected: true }]) {
    assert.throws(() => normalizeRefundSmsJob({ ...baseJob, ticketSourceSnapshot: snapshot }), /스냅샷/);
    assert.throws(() => assertRefundSmsSourceUnchanged({ ...baseJob, ticketSourceSnapshot: snapshot }, profile, refundCase), /스냅샷/);
  }
});

test("환불 문자 스냅샷의 잘못된 값은 정규화로 숨기지 않는다", () => {
  for (const patch of [
    { ticketKey: "" }, { ticketName: {} }, { status: null }, { status: "" },
    { paymentAmount: "398000" }, { paymentAmount: NaN }, { paymentAmount: Infinity },
    { totalCount: -1 }, { totalCount: 10.5 }, { remainingCount: false },
    { availableFrom: "invalid" }, { purchasedAt: {} }, { paymentAt: "" },
    { expiresAt: null }, { expiresAt: "invalid" },
  ]) {
    const job = { ...baseJob, ticketSourceSnapshot: { ...baseJob.ticketSourceSnapshot, ...patch } };
    assert.throws(() => normalizeRefundSmsJob(job), /스냅샷/);
    assert.throws(() => assertRefundSmsSourceUnchanged(job, profile, refundCase), /스냅샷/);
  }
});

test("같은 수강권이어도 다른 계산 해시와 다른 문자 작업은 차단한다", () => {
  const job = normalizeRefundSmsJob(baseJob);
  assert.throws(() => assertRefundSmsSourceUnchanged(job, profile, { ...refundCase, calculationHash: "other-hash" }), /계산값이 변경/);
  assert.throws(() => assertRefundSmsSourceUnchanged(job, profile, { ...refundCase, smsNotice: { jobId: "other-job" } }), /대기열 작업이 일치/);
});

test("환불 문자도 만료와 현재 회원·수강권 상태 검증을 유지한다", () => {
  assert.throws(() => normalizeRefundSmsJob({ ...baseJob, ticketExpiresAt: "2000-01-01T00:00:00.000Z" }), /만료/);
  const job = normalizeRefundSmsJob(baseJob);
  assert.throws(() => assertRefundSmsSourceUnchanged(job, { ...profile, studioId: "other-studio" }, refundCase), /스튜디오 원천이 변경/);
  assert.throws(() => assertRefundSmsSourceUnchanged(job, { ...profile, activeTickets: [] }, refundCase), /찾지 못했습니다/);
  for (const patch of [{ status: "refunded" }, { expiresAt: "2000-01-01T00:00:00.000Z" }]) {
    assert.throws(() => assertRefundSmsSourceUnchanged(job, { ...profile, activeTickets: [{ ...profile.activeTickets[0], ...patch }] }, refundCase), /상태가 변경|만료/);
  }
});

test("메시지 API 성공과 모달 종료가 함께 확인될 때만 발송 완료로 본다", () => {
  assert.equal(
    classifyStudioMateSmsSendEvidence({
      responseUrl: "https://api.studiomate.kr/v2/staff/messages/send",
      responseStatus: 200,
      dialogClosed: true,
    }),
    "sent",
  );
  assert.equal(
    classifyStudioMateSmsSendEvidence({ responseUrl: "", responseStatus: 0, dialogClosed: true }),
    "send_review_required",
  );
});
