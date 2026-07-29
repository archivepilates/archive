import assert from "node:assert/strict";
import test from "node:test";
import {
  createPrivateLessonReportSnapshot,
  currentPrivateLessonReportRevision,
  privateLessonReportMutationLockReason,
  reportUrlForRevision,
} from "../../firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonReportRevision";
import { privateLessonSessionProjection } from "../../firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonSession";

const nowDate = new Date("2026-07-29T03:00:00.000Z");
const now = {
  toMillis: () => nowDate.getTime(),
  toDate: () => nowDate,
};

test("report revision changes when member-visible content changes", () => {
  const base = reportRecord();
  const revision = currentPrivateLessonReportRevision(base);
  assert.equal(revision.length, 24);
  assert.equal(currentPrivateLessonReportRevision({ ...base }), revision);
  assert.notEqual(
    currentPrivateLessonReportRevision({ ...base, publicNextDirection: "다음에는 호흡 연결을 확인합니다." }),
    revision,
  );
  assert.notEqual(
    currentPrivateLessonReportRevision({
      ...base,
      media: {
        files: [
          {
            mediaId: "media-1",
            driveFileId: "drive-1",
            fileName: "lesson.mov",
            mimeType: "video/quicktime",
            size: 100,
            includeInReport: true,
          },
        ],
      },
    }),
    revision,
  );
});

test("approved snapshot and URL remain bound to one revision", () => {
  const record = reportRecord();
  const revision = currentPrivateLessonReportRevision(record);
  const snapshot = createPrivateLessonReportSnapshot(record, revision);
  assert.equal(snapshot.revision, revision);
  assert.equal(snapshot.summary, "오늘의 핵심");
  assert.equal(snapshot.nextDirection, "다음 수업 방향");
  assert.equal(
    reportUrlForRevision("https://in.archivepilates.com/api/privateLessonReport?recordId=plc-1&token=x", revision),
    `https://in.archivepilates.com/api/privateLessonReport?recordId=plc-1&token=x&rev=${revision}`,
  );
});

test("report is editable before send and locked while processing or after send", () => {
  assert.equal(privateLessonReportMutationLockReason(reportRecord()), "");
  assert.match(
    privateLessonReportMutationLockReason({
      ...reportRecord(),
      publicReportApproval: { status: "processing" },
    }),
    /발송이 시작/,
  );
  assert.match(
    privateLessonReportMutationLockReason({
      ...reportRecord(),
      publicReportApproval: { status: "sent", sentAt: now },
    }),
    /발송 완료/,
  );
});

test("private lesson session projection follows the four operator stages", () => {
  const request = chartRequest();
  assert.equal(privateLessonSessionProjection(request.requestId, request, undefined).workflowStage, "preparation");
  assert.equal(
    privateLessonSessionProjection(request.requestId, { ...request, preStatus: "submitted" }, undefined).workflowStage,
    "recording",
  );
  assert.equal(
    privateLessonSessionProjection(request.requestId, request, {
      ...reportRecord(),
      postSubmittedAt: now,
      gptStatus: "draft_created",
    }).workflowStage,
    "report_review",
  );
  assert.equal(
    privateLessonSessionProjection(request.requestId, request, {
      ...reportRecord(),
      gptStatus: "published",
      publicReportApproval: { status: "sent", sentAt: now },
      sentRevision: "revision-1",
    }).workflowStage,
    "delivered",
  );
});

test("cancelled and unverified rounds are explicit side states", () => {
  const request = chartRequest();
  assert.equal(
    privateLessonSessionProjection(request.requestId, { ...request, status: "cancelled" }, undefined).workflowStage,
    "cancelled",
  );
  assert.equal(
    privateLessonSessionProjection(request.requestId, { ...request, sessionNumber: null }, undefined).workflowStage,
    "needs_review",
  );
});

function chartRequest(): any {
  return {
    requestId: "plc-1",
    studioId: "5330",
    bookingId: "booking-1",
    lectureId: "lecture-1",
    memberId: "member-1",
    memberName: "테스트회원",
    memberPhone: "00000000000",
    memberPhoneLast4: "0000",
    staffId: "staff-1",
    staffName: "테스트강사",
    staffPhone: "00000000001",
    lessonDate: "2026-07-29",
    lessonStartAt: now,
    lessonEndAt: now,
    sessionNumber: 3,
    accessTokenHash: "hash",
    preUrl: "https://example.com/pre",
    postUrl: "https://example.com/post",
    preShortUrl: "https://example.com/s/pre",
    postShortUrl: "https://example.com/s/post",
    status: "pending",
    preStatus: "pending",
    postStatus: "pending",
    alimtalk: { status: "template_pending", templateName: "test", lastError: null },
    createdAt: now,
    updatedAt: now,
  };
}

function reportRecord(): any {
  return {
    recordId: "plc-1",
    requestId: "plc-1",
    studioId: "5330",
    bookingId: "booking-1",
    memberId: "member-1",
    memberName: "테스트회원",
    memberPhone: "00000000000",
    memberPhoneLast4: "0000",
    staffId: "staff-1",
    staffName: "테스트강사",
    lessonDate: "2026-07-29",
    lessonStartAt: now,
    sessionNumber: 3,
    gptStatus: "pending",
    gptDraftSummary: "오늘의 핵심",
    publicSummary: "오늘의 핵심",
    gptDraftNextDirection: "다음 수업 방향",
    publicNextDirection: "다음 수업 방향",
    postRecord: { homework: "호흡 연습" },
    media: { files: [] },
    publicReportApproval: { status: "pending" },
    createdAt: now,
    updatedAt: now,
  };
}
