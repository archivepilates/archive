import assert from "node:assert/strict";
import test from "node:test";
import type { AlimtalkCandidateDoc } from "../../firebase/kangsain-functions/functions/src/types/models";
import { genericInstructorLessonQueueBlock } from "../../firebase/kangsain-functions/functions/src/alimtalk/instructorLessonDeliveryGuard";
import {
  instructorLessonApprovalCutoffIssue,
  instructorLessonApprovalId,
  instructorLessonContentFingerprint,
  splitInstructorLessonCandidates,
} from "../../firebase/kangsain-functions/functions/src/alimtalk/instructorLessonSampleApproval";

function candidate(
  overrides: Partial<AlimtalkCandidateDoc> = {},
): AlimtalkCandidateDoc {
  const timestamp = { toMillis: () => 0 } as AlimtalkCandidateDoc["createdAt"];
  return {
    candidateId: "candidate-1",
    studioId: "5330",
    memberId: "member-1",
    memberName: "테스트",
    memberPhone: "01011112222",
    type: "instructor_lesson_material",
    status: "candidate",
    templateCode: "KA01TP260724090746135DWCIb2boEw7",
    title: "강사레슨 수업자료",
    reason: "강사레슨 D-1",
    sourceDate: "2026-08-28",
    payload: {
      lessonDate: "2026-08-29",
      managementNumber: "support-movement-260829",
      shortLinkId: "method-link",
    },
    lastError: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

test("separates even one instructor lesson candidate from the normal auto-send queue", () => {
  const instructor = candidate();
  const normal = candidate({ candidateId: "normal-1", type: "new_member" });
  const result = splitInstructorLessonCandidates([normal, instructor]);
  assert.deepEqual(
    result.instructorLesson.map((item) => item.candidateId),
    ["candidate-1"],
  );
  assert.deepEqual(
    result.other.map((item) => item.candidateId),
    ["normal-1"],
  );
});

test("keeps approvals separate by lesson date and management number", () => {
  const saturday = instructorLessonApprovalId(
    "5330",
    "2026-08-28",
    "support-movement-260829",
  );
  const sunday = instructorLessonApprovalId(
    "5330",
    "2026-08-29",
    "support-movement-260830",
  );
  assert.notEqual(saturday, sunday);
  assert.equal(
    saturday,
    instructorLessonApprovalId("5330", "2026-08-28", "support-movement-260829"),
  );
});

test("invalidates approval when the date-specific content contract changes", () => {
  const original = candidate();
  const changedLink = candidate({
    payload: { ...original.payload, shortLinkId: "changed-link" },
  });
  const changedDate = candidate({
    payload: {
      ...original.payload,
      lessonDate: "2026-08-30",
      managementNumber: "support-movement-260830",
    },
  });
  assert.notEqual(
    instructorLessonContentFingerprint(original),
    instructorLessonContentFingerprint(changedLink),
  );
  assert.notEqual(
    instructorLessonContentFingerprint(original),
    instructorLessonContentFingerprint(changedDate),
  );
});

test("keeps the approved content contract stable when only the live roster changes", () => {
  const original = candidate();
  const changedRecipient = candidate({
    memberId: "member-2",
    memberName: "다른 예약자",
    memberPhone: "01033334444",
  });
  assert.equal(
    instructorLessonContentFingerprint(original),
    instructorLessonContentFingerprint(changedRecipient),
  );
});

test("requires approval before 18:00 KST on the D-1 source date", () => {
  assert.equal(
    instructorLessonApprovalCutoffIssue(
      "2026-08-28",
      new Date("2026-08-28T08:59:00Z"),
    ),
    "",
  );
  assert.match(
    instructorLessonApprovalCutoffIssue(
      "2026-08-28",
      new Date("2026-08-28T09:00:00Z"),
    ),
    /18:00 KST/,
  );
  assert.match(
    instructorLessonApprovalCutoffIssue(
      "2026-08-28",
      new Date("2026-08-29T00:00:00Z"),
    ),
    /승인 가능일/,
  );
});

test("blocks every generic queue path for instructor lesson material", () => {
  assert.equal(
    genericInstructorLessonQueueBlock(candidate({ type: "new_member" })),
    null,
  );
  assert.equal(
    genericInstructorLessonQueueBlock(candidate())?.status,
    "skipped",
  );
  assert.deepEqual(
    genericInstructorLessonQueueBlock(
      candidate({
        payload: { ...candidate().payload, deliveryMode: "approved_live" },
      }),
    )?.status,
    "failed",
  );
});
