const nativeId = value => /^[1-9]\d{0,63}$/.test(String(value ?? ""));

export function issuedInstructorTicketId(payload) {
  const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data
    : payload?.data && typeof payload.data === "object" ? [payload.data] : [payload];
  const ids = rows.map(row => row?.id).filter(nativeId).map(String);
  if (ids.length !== 1) throw new Error("수강권 발급 응답의 고유번호를 한 건으로 확인하지 못했습니다. 재발급하지 않습니다.");
  return ids[0];
}

export function instructorTicketReceipt(job, ticketId) {
  if (!nativeId(ticketId) || !nativeId(job.studiomateMemberId)) throw new Error("발급 접수 고유번호 연결 확인필요");
  return {
    version: 1, status: "accepted_pending_readback", ticketId: String(ticketId),
    memberId: String(job.studiomateMemberId), lessonDate: job.lessonDate,
    paidAmount: job.externalOrder?.paidAmount ?? job.ticketPrice,
    orderNo: job.externalOrder?.orderNo || null,
  };
}

export function assertExistingInstructorTicketBinding(job, ticket) {
  const receipt = job.ticketIssueReceipt;
  const id = String(ticket?.ticketId || "");
  const receipted = receipt?.ticketId === String(job.ticketId || "")
    && receipt.memberId === String(job.studiomateMemberId || "")
    && receipt.lessonDate === job.lessonDate
    && receipt.orderNo === (job.externalOrder?.orderNo || null)
    && receipt.paidAmount === (job.externalOrder?.paidAmount ?? job.ticketPrice);
  if (!nativeId(job.ticketId) || (id ? id !== String(job.ticketId) : !receipted))
    throw new Error("기존 수강권의 고유번호·발급 접수 연결 확인필요: 자동 재발급 금지");
  return String(job.ticketId);
}
