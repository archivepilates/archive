import assert from "node:assert/strict";
import test from "node:test";
import { payloadShape, statusConditions, phoneValueFlags, recipientFormatFlags } from "../diagnose-instructor-signup-enrichment.mjs";
import { INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_ID as TEMPLATE } from "../lib/instructor-lesson-registration-contract.mjs";

const documentId = "a".repeat(32);
function fixture() {
  return { responseUrl: `https://kr-service.eformsign.com/v1.0/companies/848f6dc7fa024a6cb28a2994c0835e53/documents/${documentId}/status`,
    httpStatus: 200, observedAt: "2026-10-30T01:00:00Z", doc: { documentId, title: "Synthetic document", templateId: TEMPLATE },
    body: { code: "-1", status: "200", result: { status: { document_title: "Synthetic document",
      steps: [{ action: "doc_create", seq: 1 },
        { action: "doc_accept_participant", seq: 2, execute_date: Date.parse("2026-10-29T00:00:00Z"),
          owner: { members: ["Synthetic Instructor (01000000001)"], groups: null, external_creators: null } },
        { action: "doc_complete", seq: 3, execute_date: Date.parse("2026-10-29T01:00:00Z") }],
      current_infos: [{ step_seq: 3, current_writer: null, waitingExternalApproval: false }] } } } };
}

test("request body shape retains keys, types and counts without primitive values", () => {
  const shape = payloadShape({ input: { document_id: "NEVER_PERSIST", access_token: "NEVER_PERSIST",
    answers: [{ address: "NEVER_PERSIST" }], flag: true, number: 123 }, empty: null });
  assert.equal(shape.fields.input.fields.document_id.type, "string");
  assert.equal(shape.fields.input.fields.answers.count, 1);
  assert.doesNotMatch(JSON.stringify(shape), /NEVER_PERSIST|123|address/);
});

test("request body shape is depth and key bounded", () => {
  const value = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`field_${i}`, "NEVER_PERSIST"]));
  assert.equal(Object.keys(payloadShape(value).fields).length, 40);
  assert.equal(payloadShape(value).truncated, true);
  assert.equal(payloadShape({ a: { b: { c: { d: { e: "NEVER_PERSIST" } } } } }).fields.a.fields.b.fields.c.fields.d.truncated, true);
});

test("phone flags distinguish missing leading zero, country prefix, blank and genuine mismatch without values", () => {
  const recipient = "01012345678";
  const dropped = phoneValueFlags("1012345678", recipient);
  assert.equal(dropped.starts10, true); assert.equal(dropped.digitCount, 10);
  assert.equal(dropped.normalizedEqualsRecipient, false); assert.equal(dropped.suffixLast8EqualsRecipient, true);
  const country = phoneValueFlags("+82 10-1234-5678", recipient);
  assert.equal(country.starts8210, true); assert.equal(country.normalizedEqualsRecipient, true);
  assert.equal(phoneValueFlags("", recipient).empty, true);
  assert.equal(phoneValueFlags("01000000000", recipient).suffixLast8EqualsRecipient, false);
  assert.doesNotMatch(JSON.stringify({ dropped, country }), /1012345678|01012345678|12345678/);
});

test("phone flags mark mask, Hangul and date/email shape without DOB inference", () => {
  assert.equal(phoneValueFlags("010****5678", "01012345678").masked, true);
  assert.equal(phoneValueFlags("연락처", "01012345678").containsHangul, true);
  assert.equal(phoneValueFlags("1990-01-02", "01012345678").valueIsDate, true);
  assert.equal(phoneValueFlags("synthetic@example.invalid", "01012345678").valueIsEmail, true);
  assert.equal(phoneValueFlags("", "").normalizedEqualsRecipient, false);
  assert.equal(phoneValueFlags("", "").suffixLast8EqualsRecipient, false);
});

test("recipient format shapes distinguish emails, full phones and malformed wrappers without values", () => {
  const email = recipientFormatFlags("Synthetic (synthetic@example.invalid)");
  assert.equal(email.looksEmail, true); assert.equal(email.includesFullPhoneAnywhere, false);
  assert.deepEqual(email.parenCount, { open: 1, close: 1 });
  assert.equal(recipientFormatFlags("Synthetic +82 10-1234-5678").includesFullPhoneAnywhere, true);
  assert.equal(recipientFormatFlags("Synthetic (01012345678)").includesFullPhoneAnywhere, true);
  assert.equal(recipientFormatFlags("Synthetic (1012345678)").includesFullPhoneAnywhere, false);
  assert.equal(recipientFormatFlags(null).memberItemType, "null");
  assert.equal(recipientFormatFlags({ phone: "01012345678" }).memberItemType, "object");
  assert.doesNotMatch(JSON.stringify(email), /Synthetic|synthetic@|example.invalid/);
});

test("valid status records only structural proof and the original parser verdict", () => {
  const result = statusConditions(fixture());
  assert.equal(result.parserAccepted, true);
  assert.deepEqual(result.failedConditions, []);
  assert.equal(result.stepCount, 3);
  assert.equal(result.steps[1].memberCount, 1);
  assert.equal(result.current.writerPresent, false);
  assert.doesNotMatch(JSON.stringify(result), /Synthetic|01000000001|2026-10|document_title|execute_date/);
});

for (const [label, mutate, condition] of [
  ["extra workflow step", f => f.body.result.status.steps.push({ action: "doc_approve", seq: 4 }), "threeSteps"],
  ["different recipient action", f => { f.body.result.status.steps[1].action = "doc_accept_member"; }, "participantAction"],
  ["unsigned completion", f => { f.body.result.status.steps[2].execute_date = 0; }, "completionTimePositive"],
  ["masked recipient", f => { f.body.result.status.steps[1].owner.members[0] = "Synthetic (010****0001)"; }, "recipientFormatRecognized"],
  ["other title", f => { f.body.result.status.document_title = "Other"; }, "titleMatchesInventory"],
  ["pending writer", f => { f.body.result.status.current_infos[0].current_writer = "NEVER_PERSIST"; }, "currentWriterNull"],
  ["future completion", f => { f.body.result.status.steps[2].execute_date = Date.parse("2026-11-01T00:00:00Z"); }, "completionNotAfterObservation"],
]) test(`status diagnostic identifies ${label} without relaxing the parser`, () => {
  const input = fixture(); mutate(input);
  const result = statusConditions(input);
  assert.equal(result.parserAccepted, false); assert.ok(result.failedConditions.includes(condition));
  assert.doesNotMatch(JSON.stringify(result), /NEVER_PERSIST|01000000001/);
});
