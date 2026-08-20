import assert from "node:assert/strict";
import test from "node:test";
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
