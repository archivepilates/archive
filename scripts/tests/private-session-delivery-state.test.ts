import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { privateLessonSessionProjection } from "../../firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonSession";
import type {
  PrivateLessonChartRecordDoc,
  PrivateLessonChartRequestDoc,
} from "../../firebase/kangsain-functions/functions/src/types/models";

const requireFunctions = createRequire(new URL("../../firebase/kangsain-functions/functions/package.json", import.meta.url));
const { Timestamp } = requireFunctions("firebase-admin/firestore");
const now = Timestamp.fromDate(new Date("2026-09-05T03:00:00.000Z"));

function chartRequest(
  patch: Partial<PrivateLessonChartRequestDoc> = {},
): PrivateLessonChartRequestDoc {
  return {
    requestId: "session-delivery-test",
    studioId: "studio-test",
    bookingId: "booking-test",
    lectureId: "lecture-test",
    memberId: "member-test",
    memberName: "Test Member",
    memberPhone: "00000000000",
    memberPhoneLast4: "0000",
    staffId: "staff-test",
    staffName: "Test Staff",
    staffPhone: "00000000001",
    lessonDate: "2026-09-05",
    lessonStartAt: now,
    lessonEndAt: now,
    sessionNumber: 3,
    accessTokenHash: "test-hash",
    preUrl: "https://example.com/pre",
    postUrl: "https://example.com/post",
    preShortUrl: "https://example.com/s/pre",
    postShortUrl: "https://example.com/s/post",
    status: "pending",
    preStatus: "pending",
    postStatus: "pending",
    alimtalk: {
      status: "template_pending",
      templateName: "test",
      lastError: null,
    },
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

function chartRecord(
  patch: Partial<PrivateLessonChartRecordDoc> = {},
): PrivateLessonChartRecordDoc {
  const request = chartRequest();
  return {
    recordId: request.requestId,
    requestId: request.requestId,
    studioId: request.studioId,
    bookingId: request.bookingId,
    lectureId: request.lectureId,
    memberId: request.memberId,
    memberName: request.memberName,
    memberPhone: request.memberPhone,
    staffId: request.staffId,
    staffName: request.staffName,
    lessonDate: request.lessonDate,
    lessonStartAt: now,
    sessionNumber: request.sessionNumber,
    gptStatus: "pending",
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

for (const status of [
  undefined,
  "pending",
  "approved",
  "queued",
  "processing",
  "failed",
] as const) {
  test(`published report without send evidence stays in review: approval ${status ?? "absent"}`, () => {
    const request = chartRequest();
    const record = chartRecord({
      gptStatus: "published",
      publicReportApproval: status ? { status } : undefined,
      sentRevision: "",
    });
    const session = privateLessonSessionProjection(
      request.requestId,
      request,
      record,
    );

    assert.equal(session.workflowStage, "report_review");
    assert.equal(
      session.deliveryStatus,
      status === "approved" ? "pending" : status || "pending",
    );
    assert.equal(session.sentRevision, "");
    assert.notEqual(session.nextAction, "완료");
  });
}

const sentEvidence: Array<[string, Partial<PrivateLessonChartRecordDoc>]> = [
  ["approval status alone", { publicReportApproval: { status: "sent" } }],
  [
    "sent timestamp alone",
    { publicReportApproval: { status: "pending", sentAt: now } },
  ],
  ["sent revision alone", { sentRevision: "sent-revision-test" }],
  [
    "complete send outcome",
    {
      gptStatus: "published",
      publicReportApproval: { status: "sent", sentAt: now },
      sentRevision: "sent-revision-test",
    },
  ],
];

for (const [label, patch] of sentEvidence) {
  test(`actual send evidence marks the session delivered: ${label}`, () => {
    const request = chartRequest();
    const session = privateLessonSessionProjection(
      request.requestId,
      request,
      chartRecord(patch),
    );

    assert.equal(session.workflowStage, "delivered");
    assert.equal(session.nextAction, "완료");
    assert.equal(session.sentRevision, patch.sentRevision || "");
    assert.equal(
      session.deliveryStatus,
      patch.publicReportApproval?.status === "sent" ? "sent" : "pending",
    );
  });
}

test("a stale delivered projection is recomputed from published-only source evidence", () => {
  const request = chartRequest();
  const previous = privateLessonSessionProjection(
    request.requestId,
    request,
    chartRecord({
      publicReportApproval: { status: "sent", sentAt: now },
      sentRevision: "old-sent-revision",
    }),
  );
  const session = privateLessonSessionProjection(
    request.requestId,
    request,
    chartRecord({ gptStatus: "published" }),
    previous,
  );

  assert.equal(previous.workflowStage, "delivered");
  assert.equal(session.workflowStage, "report_review");
  assert.equal(session.deliveryStatus, "pending");
  assert.equal(session.sentRevision, "");
});

test("new requests and pre-only submissions remain in recording", () => {
  for (const preStatus of ["pending", "submitted"] as const) {
    const request = chartRequest({ preStatus });
    for (const record of [
      undefined,
      chartRecord({ preSubmittedAt: now, gptStatus: "waiting_post" }),
    ]) {
      const session = privateLessonSessionProjection(
        request.requestId,
        request,
        record,
      );
      assert.equal(session.workflowStage, "recording");
      assert.equal(session.preStatus, preStatus);
      assert.equal(session.postStatus, "pending");
      assert.equal(session.nextAction, "수업 후 기록 작성");
    }
  }
});

test("request or record post-submission evidence enters report review", () => {
  const request = chartRequest({ postStatus: "submitted" });
  assert.equal(
    privateLessonSessionProjection(request.requestId, request, undefined)
      .workflowStage,
    "report_review",
  );
  const pending = chartRequest();
  assert.equal(
    privateLessonSessionProjection(
      pending.requestId,
      pending,
      chartRecord({ postSubmittedAt: now }),
    ).workflowStage,
    "report_review",
  );
});

for (const gptStatus of ["draft_created", "approved"] as const) {
  test(`${gptStatus} report without send evidence remains in review`, () => {
    const request = chartRequest();
    const session = privateLessonSessionProjection(
      request.requestId,
      request,
      chartRecord({ gptStatus }),
    );
    assert.equal(session.workflowStage, "report_review");
    assert.equal(session.deliveryStatus, "pending");
  });
}

test("record-only projection still distinguishes publication from delivery", () => {
  for (const [patch, stage] of [
    [{ gptStatus: "published" }, "report_review"],
    [{ sentRevision: "sent-revision-test" }, "delivered"],
  ] as const) {
    const record = chartRecord(patch);
    assert.equal(
      privateLessonSessionProjection(record.requestId, undefined, record)
        .workflowStage,
      stage,
    );
  }
});

test("cancellation and round-review guards retain precedence over send evidence", () => {
  const request = chartRequest();
  const sent = chartRecord({
    publicReportApproval: { status: "sent", sentAt: now },
  });
  const cancelled = [
    privateLessonSessionProjection(
      request.requestId,
      chartRequest({ status: "cancelled" }),
      sent,
    ),
    privateLessonSessionProjection(
      request.requestId,
      chartRequest({ cancelledAt: now }),
      sent,
    ),
    privateLessonSessionProjection(request.requestId, request, {
      ...sent,
      cancelledAt: now,
    }),
    privateLessonSessionProjection(
      request.requestId,
      chartRequest({ status: "cancelled" }),
      sent,
      undefined,
      { roundVerified: false },
    ),
  ];
  for (const session of cancelled) {
    assert.equal(session.workflowStage, "cancelled");
    assert.equal(session.nextAction, "없음");
  }

  const needsReview = [
    privateLessonSessionProjection(
      request.requestId,
      chartRequest({ sessionNumber: 0 }),
      { ...sent, sessionNumber: 0 },
    ),
    privateLessonSessionProjection(
      request.requestId,
      request,
      sent,
      undefined,
      { roundVerified: false },
    ),
    privateLessonSessionProjection(
      request.requestId,
      chartRequest({ bookingId: "usage_booking_test" }),
      sent,
    ),
  ];
  for (const session of needsReview) {
    assert.equal(session.workflowStage, "needs_review");
    assert.equal(session.nextAction, "회차 확인");
  }
});
