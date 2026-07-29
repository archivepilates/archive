import type {
  PrivateLessonChartMediaFile,
  PrivateLessonChartRecordDoc,
  PrivateLessonReportSnapshot,
} from "../types/models";
import { nowTimestamp } from "../utils/date";
import { stableHash } from "../utils/hash";

export function currentPrivateLessonReportRevision(record: PrivateLessonChartRecordDoc): string {
  return stableHash({
    summary: cleanText(record.publicSummary || record.gptDraftSummary),
    nextDirection: cleanText(record.publicNextDirection || record.gptDraftNextDirection),
    homework: cleanText(record.postRecord?.homework),
    media: includedMedia(record).map((file) => ({
      mediaId: file.mediaId,
      driveFileId: file.driveFileId,
      includeInReport: file.includeInReport,
    })),
    sourceHash: String(record.gptSourceHash || ""),
  }).slice(0, 24);
}

export function createPrivateLessonReportSnapshot(
  record: PrivateLessonChartRecordDoc,
  revision = currentPrivateLessonReportRevision(record),
): PrivateLessonReportSnapshot {
  return {
    revision,
    summary: cleanText(record.publicSummary || record.gptDraftSummary),
    nextDirection: cleanText(record.publicNextDirection || record.gptDraftNextDirection),
    homework: cleanText(record.postRecord?.homework),
    includedMedia: includedMedia(record),
    memberName: String(record.memberName || ""),
    staffName: String(record.staffName || ""),
    lessonDate: String(record.lessonDate || ""),
    lessonStartAt: record.lessonStartAt || null,
    sessionNumber: Number(record.sessionNumber || 0),
    createdAt: nowTimestamp(),
  };
}

export function privateLessonReportMutationLockReason(
  record: PrivateLessonChartRecordDoc | null | undefined,
): string {
  const approvalStatus = String(record?.publicReportApproval?.status || "");
  if (approvalStatus === "processing") return "회원 알림톡 발송이 시작되어 수정할 수 없습니다.";
  if (
    approvalStatus === "sent" ||
    Boolean(record?.publicReportApproval?.sentAt) ||
    Boolean(record?.sentRevision) ||
    record?.gptStatus === "published"
  ) {
    return "회원 리포트 알림톡 발송 완료 후에는 수정할 수 없습니다.";
  }
  return "";
}

export function reportUrlForRevision(rawUrl: string, revision: string): string {
  if (!rawUrl || !revision) return rawUrl;
  const url = new URL(rawUrl);
  url.searchParams.set("rev", revision);
  return url.toString();
}

function includedMedia(record: PrivateLessonChartRecordDoc): PrivateLessonChartMediaFile[] {
  return (record.media?.files || [])
    .filter((file) => file.includeInReport !== false)
    .map((file) => ({ ...file }));
}

function cleanText(value: unknown): string {
  return String(value == null ? "" : value).trim();
}
