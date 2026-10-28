import assert from "node:assert/strict";
import test from "node:test";
import { issuedInstructorTicketId, instructorTicketReceipt, assertExistingInstructorTicketBinding } from "../lib/instructor-ticket-issue-evidence.mjs";

for (const payload of [[{ id: 123 }], { data: [{ id: 123 }] }, { data: { id: 123 } }, { id: 123 }]) {
  test(`one explicit native issuance id is retained: ${JSON.stringify(payload)}`, () => assert.equal(issuedInstructorTicketId(payload), "123"));
}
for (const payload of [null, {}, { data: [] }, [{ id: 123 }, { id: 456 }], { data: { member: { id: 123 } } }, { id: "excel_123" }]) {
  test(`missing or ambiguous receipt is never inferred: ${JSON.stringify(payload)}`, () => assert.throws(() => issuedInstructorTicketId(payload)));
}
const job = { ticketId: "123", studiomateMemberId: "42", lessonDate: "2026-11-29", ticketPrice: 70000, externalOrder: { orderNo: "209901010000001", paidAmount: 70000 } };
test("a rendered card without id requires the same job's exact issuance receipt", () => {
  assert.throws(() => assertExistingInstructorTicketBinding(job, {}));
  const receipt = instructorTicketReceipt(job, "123");
  assert.equal(assertExistingInstructorTicketBinding({ ...job, ticketIssueReceipt: receipt }, {}), "123");
  for (const [key, value] of Object.entries({ ticketId: "999", memberId: "43", lessonDate: "2026-11-28", paidAmount: 140000, orderNo: "209901010000002" })) {
    assert.throws(() => assertExistingInstructorTicketBinding({ ...job, ticketIssueReceipt: { ...receipt, [key]: value } }, {}));
  }
});
test("an actual card id mismatch cannot be bypassed by an exact receipt", () => {
  assert.throws(() => assertExistingInstructorTicketBinding({ ...job, ticketIssueReceipt: instructorTicketReceipt(job, "123") }, { ticketId: "456" }));
});
