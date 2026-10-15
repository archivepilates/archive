import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  assertRefundJobStillWithinValidity,
  assertRefundSourceUnchanged,
  buildRefundDocumentName,
  currentRefundTicketSourceSnapshot,
  EFORMSIGN_PROGRESS_DOCUMENTS_URL,
  EFORMSIGN_REFUND_FIELD_IDS,
  EFORMSIGN_REFUND_TEMPLATE_ID,
  EFORMSIGN_REFUND_TEMPLATE_URL,
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
    purchasedAt: null,
    paymentAt: null,
    expiresAt: "2026-12-31T14:59:59.000Z",
  },
  paymentAmount: 100000,
  penaltyAmount: 10000,
  usedAmount: 0,
  refundAmount: 90000,
  calculationHash: "hash",
  templateId: EFORMSIGN_REFUND_TEMPLATE_ID,
};

test("eform worker uses tested readiness and scoped evidence with native validation before dispatch", async () => {
  const source = await readFile(new URL("../process-eformsign-refund-jobs.mjs", import.meta.url), "utf8");
  assert.match(source, /last = await readRefundSendEvidence\(page, documentName, recipientPhone\)/);
  assert.match(source, /await waitForRefundTemplateReady\(page/);
  assert.match(source, /await readNativeRefundSource\(/);
  assert.match(source, /studiomateMemberId: refundNativeMemberPointer\(job, profile\)/);
  assert.doesNotMatch(source, /findDocumentIdOnPage|bodyText: await page\.locator\("body"\)/);
  assert.equal((source.match(/await assertLiveRefundSource\(job\)/g) || []).length, 2);
});

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

test("환불동의서 v9 필드 계약은 라이브 양식 순서와 일치한다", () => {
  assert.deepEqual(EFORMSIGN_REFUND_FIELD_IDS, {
    memberName: "ozinput_24",
    memberPhone: "ozinput_27",
    paymentAmount: "ozinput_29",
    penaltyAmount: "ozinput_30",
    usedAmount: "ozinput_31",
    refundAmount: "ozinput_32",
    companySignerName: "ozinput_38",
    companySignature: "oziviw_39",
  });
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
  assert.equal(staleRefundJobRecoveryStatus({ status: "failed", sendClickedAt: {}, attempts: 3 }), "send_review_required");
});

const sourceProfile = {
  studioId: baseJob.studioId,
  activeTickets: [{
    userTicketId: "test",
    name: baseJob.ticketName,
    status: "active",
    paymentAmount: 100000,
    maxCount: 10,
    remainingCount: 10,
    availableFrom: "2026-08-01T00:00:00.000Z",
    expiresAt: "2026-12-31T14:59:59.000Z",
  }],
};

test("Firestore 필드 순서가 달라도 같은 환불동의서 원천은 통과한다", () => {
  const reordered = Object.fromEntries(Object.entries(baseJob.ticketSourceSnapshot).sort(([a], [b]) => a.localeCompare(b)));
  const job = normalizeRefundJob({ ...baseJob, ticketSourceSnapshot: reordered });
  assert.doesNotThrow(() => assertRefundSourceUnchanged(job, sourceProfile));
  assert.doesNotThrow(() => assertRefundSourceUnchanged({ ...job, ticketSourceSnapshot: reordered }, sourceProfile));
});

test("동일 계산 해시라도 환불동의서 원천 필드 변경은 모두 차단한다", () => {
  const changedValues = {
    ticketKey: "userTicket:other",
    ticketName: "Changed pass",
    status: "inactive",
    paymentAmount: 99999,
    totalCount: 11,
    remainingCount: 9,
    availableFrom: "2026-08-02T00:00:00.000Z",
    purchasedAt: "2026-07-31T00:00:00.000Z",
    paymentAt: "2026-07-31T00:00:00.000Z",
    expiresAt: "2026-12-30T14:59:59.000Z",
  };
  for (const [key, value] of Object.entries(changedValues)) {
    const job = normalizeRefundJob({ ...baseJob, ticketSourceSnapshot: { ...baseJob.ticketSourceSnapshot, [key]: value } });
    assert.equal(job.calculationHash, baseJob.calculationHash);
    assert.throws(() => assertRefundSourceUnchanged(job, sourceProfile), /원천이 변경/, key);
  }
});

test("환불동의서 스냅샷의 누락 필드와 알 수 없는 필드를 차단한다", () => {
  for (const key of Object.keys(baseJob.ticketSourceSnapshot)) {
    const snapshot = { ...baseJob.ticketSourceSnapshot };
    delete snapshot[key];
    assert.throws(() => normalizeRefundJob({ ...baseJob, ticketSourceSnapshot: snapshot }), /스냅샷/, key);
    assert.throws(() => assertRefundSourceUnchanged({ ...baseJob, ticketSourceSnapshot: snapshot }, sourceProfile), /스냅샷/, key);
  }
  for (const snapshot of [undefined, null, [], "snapshot", {}, { ...baseJob.ticketSourceSnapshot, unexpected: true }]) {
    assert.throws(() => normalizeRefundJob({ ...baseJob, ticketSourceSnapshot: snapshot }), /스냅샷/);
    assert.throws(() => assertRefundSourceUnchanged({ ...baseJob, ticketSourceSnapshot: snapshot }, sourceProfile), /스냅샷/);
  }
});

test("환불동의서 스냅샷의 잘못된 값은 정규화로 숨기지 않는다", () => {
  for (const patch of [
    { ticketKey: "" }, { ticketName: {} }, { status: null }, { status: "" },
    { paymentAmount: "100000" }, { paymentAmount: NaN }, { paymentAmount: Infinity },
    { totalCount: -1 }, { totalCount: 10.5 }, { remainingCount: false },
    { availableFrom: "invalid" }, { purchasedAt: {} }, { paymentAt: "" },
    { expiresAt: null }, { expiresAt: "invalid" },
  ]) {
    const job = { ...baseJob, ticketSourceSnapshot: { ...baseJob.ticketSourceSnapshot, ...patch } };
    assert.throws(() => normalizeRefundJob(job), /스냅샷/);
    assert.throws(() => assertRefundSourceUnchanged(job, sourceProfile), /스냅샷/);
  }
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
    isUnambiguousSendSuccess({
      evidenceScope: "send_confirmation",
      bodyText: `${documentName} 문서를 전송했습니다. 수신자 010-0000-0000`,
      documentName,
      documentId: "doc_123",
      recipientPhone: "01000000000",
    }),
    true,
  );
  assert.equal(isUnambiguousSendSuccess({ bodyText: "문서를 전송했습니다.", documentName }), false);
  assert.equal(isUnambiguousSendSuccess({ url: "https://www.eformsign.com/eform/document/sent", documentName }), false);
  assert.equal(
    isUnambiguousSendSuccess({
      evidenceScope: "document_record",
      url: EFORMSIGN_PROGRESS_DOCUMENTS_URL,
      bodyText: `${documentName} 진행 중 수신자 테스트회원(+821000000000)`,
      documentName,
      documentId: "doc_123",
      recipientPhone: "01000000000",
    }),
    true,
  );
  assert.equal(
    isUnambiguousSendSuccess({
      evidenceScope: "document_record",
      bodyText: `${documentName} 진행 중 수신자 다른회원(+821011112222)`,
      documentName,
      documentId: "doc_123",
      recipientPhone: "01000000000",
    }),
    false,
  );
  assert.equal(isUnambiguousSendSuccess({ bodyText: `${documentName} 전송 버튼을 눌러주세요.`, documentName }), false);
  assert.equal(
    isUnambiguousSendSuccess({
      evidenceScope: "send_confirmation",
      bodyText: `${documentName} 문서를 전송했습니다. 수신자 010-0000-0000`,
      documentName,
      documentId: "",
      recipientPhone: "01000000000",
    }),
    false,
  );
});

test("영문 전송 완료와 진행 중 문서함도 동일한 세 가지 증거를 요구한다", () => {
  const documentName = "synthetic_refund_agreement";
  const proof = { documentName, documentId: "synthetic-document", recipientPhone: "01000000000" };
  const successEvidence = [
    { evidenceScope: "send_confirmation", bodyText: `${documentName} The document has been sent. Recipient: 010-0000-0000` },
    { evidenceScope: "send_confirmation", bodyText: `${documentName} The document has been successfully sent. Recipient: 010-0000-0000` },
    { evidenceScope: "send_confirmation", bodyText: `${documentName} Document sent successfully. Recipient: 010-0000-0000` },
    { evidenceScope: "document_record", url: EFORMSIGN_PROGRESS_DOCUMENTS_URL, bodyText: `${documentName} In progress Recipient: +821000000000` },
    { evidenceScope: "document_record", url: EFORMSIGN_PROGRESS_DOCUMENTS_URL, bodyText: `${documentName} Processing Recipient: 010-0000-0000` },
    { evidenceScope: "document_record", url: EFORMSIGN_PROGRESS_DOCUMENTS_URL, bodyText: `${documentName} Completed Recipient: 010-0000-0000` },
  ];
  for (const evidence of successEvidence) {
    assert.equal(isUnambiguousSendSuccess({ ...proof, ...evidence }), true, evidence.bodyText);
    assert.equal(isUnambiguousSendSuccess({ ...proof, ...evidence, documentId: "" }), false);
    assert.equal(isUnambiguousSendSuccess({ ...proof, ...evidence, documentName: "missing-name" }), false);
    assert.equal(isUnambiguousSendSuccess({ ...proof, ...evidence, recipientPhone: "01011112222" }), false);
    assert.equal(isUnambiguousSendSuccess({ ...proof, ...evidence, recipientPhone: "" }), false);
    assert.equal(isUnambiguousSendSuccess({ ...proof, ...evidence, bodyText: evidence.bodyText.replace(/\+821000000000|010-0000-0000/g, "010-****-0000") }), false);
  }
  for (const text of ["Send document", "Draft", "Document was not sent.", "Document sent unsuccessfully.", "Failed to send document."]) {
    assert.equal(isUnambiguousSendSuccess({ ...proof, evidenceScope: "send_confirmation", bodyText: `${documentName} ${text} Recipient: 010-0000-0000` }), false, text);
  }
  assert.equal(isUnambiguousSendSuccess({ ...proof, evidenceScope: "document_record", url: EFORMSIGN_REFUND_TEMPLATE_URL, bodyText: `${documentName} In progress Recipient: 010-0000-0000` }), false);
});

test("전송 완료와 문서 기록은 각각 명시된 증거 범위가 있어야 한다", () => {
  const proof = { documentName: "synthetic_refund_agreement", documentId: "synthetic-document", recipientPhone: "01000000000" };
  const confirmation = { ...proof, bodyText: `${proof.documentName} Document sent. Recipient: 010-0000-0000` };
  const record = { ...proof, url: EFORMSIGN_PROGRESS_DOCUMENTS_URL, bodyText: `${proof.documentName} Completed Recipient: 010-0000-0000` };
  for (const evidence of [confirmation, record]) {
    for (const evidenceScope of [undefined, null, "", "body", "whole_page", true, {}]) {
      assert.equal(isUnambiguousSendSuccess({ ...evidence, evidenceScope }), false);
    }
  }
  assert.equal(isUnambiguousSendSuccess({ ...confirmation, evidenceScope: "send_confirmation" }), true);
  assert.equal(isUnambiguousSendSuccess({ ...record, evidenceScope: "document_record" }), true);
  assert.equal(isUnambiguousSendSuccess({ ...confirmation, evidenceScope: "document_record" }), false);
  assert.equal(isUnambiguousSendSuccess({ ...record, evidenceScope: "send_confirmation" }), false);
});

test("한글과 영문 부정·실패·초안 증거는 양성 문구가 섞여도 차단한다", () => {
  const proof = { documentName: "synthetic_refund_agreement", documentId: "synthetic-document", recipientPhone: "01000000000", url: EFORMSIGN_PROGRESS_DOCUMENTS_URL };
  for (const evidenceScope of ["send_confirmation", "document_record"]) {
    for (const message of [
      "No document sent.", "Document was not sent.", "Document has never been sent.",
      "Document sent unsuccessfully.", "Failed to send document.", "Document sent. Delivery failed.",
      "Not completed", "Not in progress", "Completed Draft", "Completed Pending", "Completed Canceled",
      "문서를 전송하지 않았습니다.", "문서 전송 실패", "전송이 완료되지 않았습니다.",
      "문서를 전송할 수 없습니다.", "문서를 전송하지 못했습니다.", "미전송 완료", "미완료",
      "전송 완료 아님", "완료 취소", "완료 임시 저장", "완료 초안", "완료 전송 대기",
      "문서를 전송했습니다. 오류", "Document sent. 문서 전송 실패",
    ]) {
      assert.equal(isUnambiguousSendSuccess({ ...proof, evidenceScope,
        bodyText: `${proof.documentName} ${message} Recipient: 010-0000-0000` }), false, `${evidenceScope}: ${message}`);
    }
  }
});

test("문서 목록 기록은 수신자나 문서함 문구만으로 성공하지 않는다", () => {
  const proof = { evidenceScope: "document_record", documentName: "synthetic_refund_agreement",
    documentId: "synthetic-document", recipientPhone: "01000000000", url: EFORMSIGN_PROGRESS_DOCUMENTS_URL };
  for (const status of ["Recipient", "Documents", "수신자", "문서함", "Draft", "임시저장", "초안", "Incomplete", "Uncompleted"]) {
    assert.equal(isUnambiguousSendSuccess({ ...proof,
      bodyText: `${proof.documentName} ${status} 010-0000-0000` }), false, status);
  }
  for (const status of ["진행 중", "처리 중", "완료", "In progress", "Processing", "Completed"]) {
    assert.equal(isUnambiguousSendSuccess({ ...proof,
      bodyText: `${proof.documentName} ${status} 010-0000-0000` }), true, status);
  }
});

test("완료 메뉴와 다른 행의 전화번호는 현재 문서 기록의 증거가 아니다", () => {
  const proof = { documentName: "synthetic_refund_agreement", documentId: "synthetic-document", recipientPhone: "01000000000", url: EFORMSIGN_PROGRESS_DOCUMENTS_URL };
  const wholeBody = "Navigation: Completed | synthetic_refund_agreement Draft Recipient: 010-1111-2222 | Other document Recipient: 010-0000-0000";
  assert.equal(isUnambiguousSendSuccess({ ...proof, bodyText: wholeBody }), false);
  assert.equal(isUnambiguousSendSuccess({ ...proof, evidenceScope: "document_record", bodyText: wholeBody }), false);
  assert.equal(isUnambiguousSendSuccess({ ...proof, evidenceScope: "document_record",
    bodyText: `${proof.documentName} Completed Recipient: 010-1111-2222` }), false);
  assert.equal(isUnambiguousSendSuccess({ ...proof, evidenceScope: "document_record",
    bodyText: `${proof.documentName} Draft Recipient: 010-0000-0000` }), false);
});

test("양쪽 증거 범위 모두 전체 문서명·문서 식별자·전화번호가 필요하다", () => {
  for (const evidenceScope of ["send_confirmation", "document_record"]) {
    const proof = { evidenceScope, documentName: "synthetic_refund_agreement_full_name", documentId: "synthetic-document",
      recipientPhone: "01000000000", url: EFORMSIGN_PROGRESS_DOCUMENTS_URL };
    const bodyText = `${proof.documentName} ${evidenceScope === "send_confirmation" ? "Document sent." : "Completed"} Recipient: 010-0000-0000`;
    assert.equal(isUnambiguousSendSuccess({ ...proof, bodyText }), true);
    for (const patch of [{ documentName: "" }, { documentName: null }, { documentId: "" }, { documentId: " " },
      { documentId: null }, { documentId: {} }, { recipientPhone: "" }, { recipientPhone: "01011112222" }]) {
      assert.equal(isUnambiguousSendSuccess({ ...proof, bodyText, ...patch }), false);
    }
    assert.equal(isUnambiguousSendSuccess({ ...proof, bodyText: bodyText.replace(proof.documentName, "synthetic_refund_agreement") }), false);
    assert.equal(isUnambiguousSendSuccess({ ...proof, bodyText: bodyText.replace("010-0000-0000", "010-****-0000") }), false);
  }
});

test("이폼싸인 문서 식별자는 문서 URL에서만 추출한다", () => {
  assert.equal(
    extractEformsignDocumentId("https://www.eformsign.com/eform/document/detail?document_id=doc_123"),
    "doc_123",
  );
  assert.equal(extractEformsignDocumentId("https://www.eformsign.com/eform/document/sent"), "");
  assert.equal(extractEformsignDocumentId("https://www.eformsign.com/eform/document/sent?id=navigation_123"), "");
});
