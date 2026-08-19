import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRefundJobStillWithinValidity,
  assertRefundSourceUnchanged,
  buildRefundDocumentName,
  currentRefundTicketSourceSnapshot,
  EFORMSIGN_REFUND_TEMPLATE_ID,
  extractEformsignDocumentId,
  formatInputWon,
  isUnambiguousSendSuccess,
  normalizeRefundJob,
  staleRefundJobRecoveryStatus,
} from "../lib/eformsign-refund-browser-contract.mjs";

const baseJob = {
  jobId: "refund_test",
  caseId: "refund_case_12345678",
  memberName: "테스트회원",
  memberPhone: "010-0000-0000",
  memberId: "member_test",
  studioId: "5330",
  ticketName: "프라이빗 10회",
  ticketKey: "userTicket:test",
  ticketExpiresAt: "2026-12-31T23:59:59+09:00",
  ticketSourceSnapshot: {
    ticketKey: "userTicket:test",
    ticketName: "프라이빗 10회",
    status: "active",
    paymentAmount: 100000,
    totalCount: 10,
    remainingCount: 10,
    availableFrom: "2026-08-01T00:00:00.000Z",
    expiresAt: "2026-12-31T14:59:59.000Z",
  },
  paymentAmount: 100000,
  penaltyAmount: 10000,
  usedAmount: 0,
  refundAmount: 90000,
  calculationHash: "hash",
  templateId: EFORMSIGN_REFUND_TEMPLATE_ID,
};

test("환불 큐 작업은 승인된 템플릿과 정상 연락처만 허용한다", () => {
  const job = normalizeRefundJob(baseJob);
  assert.equal(job.memberPhone, "01000000000");
  assert.equal(job.templateId, EFORMSIGN_REFUND_TEMPLATE_ID);
  assert.throws(() => normalizeRefundJob({ ...baseJob, templateId: "other" }), /승인되지 않은/);
  assert.throws(() => normalizeRefundJob({ ...baseJob, memberPhone: "0101234" }), /연락처/);
});

test("환불 금액은 문서에서 바로 읽을 수 있는 원화 형식으로 입력한다", () => {
  assert.equal(formatInputWon(100000), "100,000원");
  assert.equal(formatInputWon(0), "0원");
});

test("큐 처리 직전 수강권이 만료되면 발송을 중단한다", () => {
  assert.doesNotThrow(() => assertRefundJobStillWithinValidity(baseJob, new Date("2026-12-31T12:00:00+09:00")));
  assert.throws(
    () => assertRefundJobStillWithinValidity(baseJob, new Date("2027-01-01T00:00:00+09:00")),
    /만료/,
  );
  assert.throws(() => assertRefundJobStillWithinValidity({}), /유효기간 원천/);
});

test("큐 이후 수강권 원천이 바뀌면 발송을 중단한다", () => {
  const job = normalizeRefundJob(baseJob);
  const profile = {
    studioId: "5330",
    activeTickets: [{
      userTicketId: "test",
      name: "프라이빗 10회",
      status: "active",
      paymentAmount: 100000,
      maxCount: 10,
      remainingCount: 10,
      availableFrom: "2026-08-01T00:00:00.000Z",
      expiresAt: "2026-12-31T14:59:59.000Z",
    }],
  };
  assert.doesNotThrow(() => assertRefundSourceUnchanged(job, profile));
  assert.throws(
    () => assertRefundSourceUnchanged(job, {
      ...profile,
      activeTickets: [{ ...profile.activeTickets[0], remainingCount: 9 }],
    }),
    /원천이 변경/,
  );
  assert.throws(
    () => assertRefundSourceUnchanged(job, { ...profile, activeTickets: [] }),
    /찾지 못했습니다/,
  );
});

test("중단된 큐는 최종 전송 클릭 여부에 따라 안전하게 복구한다", () => {
  assert.equal(staleRefundJobRecoveryStatus({ status: "processing", attempts: 1, maxAttempts: 3 }), "retry");
  assert.equal(staleRefundJobRecoveryStatus({ status: "sending", attempts: 1, maxAttempts: 3 }), "send_review_required");
  assert.equal(staleRefundJobRecoveryStatus({ status: "processing", sendClickedAt: {} }), "send_review_required");
  assert.equal(staleRefundJobRecoveryStatus({ status: "processing", attempts: 3, maxAttempts: 3 }), "failed");
});

test("식별자 없는 수강권 키는 잔여횟수와 만료일 변경에도 유지된다", () => {
  const baseTicket = {
    name: "사전등록 100회권",
    status: "active",
    availableFrom: "2026-08-01T00:00:00.000Z",
    purchasedAt: "2026-07-20T00:00:00.000Z",
    maxCount: 100,
    remainingCount: 100,
    expiresAt: "2027-03-01T00:00:00.000Z",
  };
  const before = currentRefundTicketSourceSnapshot(baseTicket).ticketKey;
  const after = currentRefundTicketSourceSnapshot({
    ...baseTicket,
    remainingCount: 99,
    expiresAt: "2027-03-05T00:00:00.000Z",
  }).ticketKey;
  assert.equal(after, before);
});

test("문서명에는 날짜, 회원명, 환불 건 식별자가 들어간다", () => {
  const name = buildRefundDocumentName(normalizeRefundJob(baseJob), new Date("2026-08-20T00:00:00+09:00"));
  assert.match(name, /^2026-08-20_환불동의서_테스트회원_/);
  assert.match(name, /12345678$/);
});

test("명확한 전송 완료 증거만 성공으로 판정한다", () => {
  const documentName = "2026-08-20_환불동의서_테스트회원_12345678";
  assert.equal(
    isUnambiguousSendSuccess({ bodyText: `${documentName} 문서를 전송했습니다.`, documentName, documentId: "doc_123" }),
    true,
  );
  assert.equal(isUnambiguousSendSuccess({ bodyText: "문서를 전송했습니다.", documentName }), false);
  assert.equal(isUnambiguousSendSuccess({ url: "https://www.eformsign.com/eform/document/sent", documentName }), false);
  assert.equal(
    isUnambiguousSendSuccess({
      url: "https://www.eformsign.com/eform/document/sent",
      bodyText: `${documentName} 진행 중 수신자 1명`,
      documentName,
      documentId: "doc_123",
    }),
    true,
  );
  assert.equal(isUnambiguousSendSuccess({ bodyText: `${documentName} 전송 버튼을 눌러주세요.`, documentName }), false);
  assert.equal(
    isUnambiguousSendSuccess({ bodyText: `${documentName} 문서를 전송했습니다.`, documentName, documentId: "" }),
    false,
  );
});

test("이폼싸인 문서 식별자는 문서 URL에서만 추출한다", () => {
  assert.equal(
    extractEformsignDocumentId("https://www.eformsign.com/eform/document/detail?document_id=doc_123"),
    "doc_123",
  );
  assert.equal(extractEformsignDocumentId("https://www.eformsign.com/eform/document/sent"), "");
  assert.equal(extractEformsignDocumentId("https://www.eformsign.com/eform/document/sent?id=navigation_123"), "");
});
