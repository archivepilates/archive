import test from "node:test";
import assert from "node:assert/strict";
import { manualInstructorD1TimeIssue, manualInstructorD1ApprovalProof, type InstructorLessonApprovalDoc } from "../../firebase/kangsain-functions/functions/src/alimtalk/instructorLessonSampleApproval";

const now = (time: string) => new Date("2026-11-27T" + time + "+09:00");
test("only allows same-day manual recovery after the existing 14:00 KST job and before 23:00", () => {
  assert.ok(manualInstructorD1TimeIssue("2026-11-27", "2026-11-28", now("13:59:59")));
  assert.equal(manualInstructorD1TimeIssue("2026-11-27", "2026-11-28", now("14:00:00")), "");
  assert.equal(manualInstructorD1TimeIssue("2026-11-27", "2026-11-28", now("22:59:59")), "");
  assert.ok(manualInstructorD1TimeIssue("2026-11-27", "2026-11-28", now("23:00:00")));
  assert.ok(manualInstructorD1TimeIssue("2026-11-26", "2026-11-27", now("16:00:00")));
  assert.ok(manualInstructorD1TimeIssue("2026-11-27", "2026-11-29", now("16:00:00")));
});
test("approval proof is bound to approved content, recipients, source date, and exact provider sample", () => {
  const approval = { studioId:"5330", sourceDate:"2026-11-27",lessonDate:"2026-11-28",managementNumber:"full-body-integration-261128",templateCode:"v3",
    approvedTargetKeys:["a","b"],contentFingerprint:"content",candidateIds:["id1","id2"],sampleSolapiMessageId:"message" } as InstructorLessonApprovalDoc;
  const proof = manualInstructorD1ApprovalProof(approval);
  assert.match(proof,/^[a-f0-9]{64}$/);
  assert.equal(proof, manualInstructorD1ApprovalProof({...approval,candidateIds:["id2","id1"]}));
  for (const changed of [{sampleSolapiMessageId:"different"},{approvedTargetKeys:["a","c"]},{contentFingerprint:"changed"},{sourceDate:"2026-11-26"},{managementNumber:"other-261128"}]) {
    assert.notEqual(proof,manualInstructorD1ApprovalProof({...approval,...changed}));
  }
});
