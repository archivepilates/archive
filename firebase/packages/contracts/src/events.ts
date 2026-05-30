export const archiveEventTopics = {
  alimtalkCandidateQueued: "alimtalk.candidate.queued",
  alimtalkSendCompleted: "alimtalk.send.completed",
  privateLessonChartRequested: "private-chart.requested",
  privateLessonReportApproved: "private-chart.report.approved",
  studioMateExcelImported: "sync.studiomate-excel.imported",
  memberMemoChanged: "app.member-memo.changed",
} as const;

export type ArchiveEventTopic = (typeof archiveEventTopics)[keyof typeof archiveEventTopics];

export interface ArchiveEventEnvelope<TPayload = Record<string, unknown>> {
  eventId: string;
  topic: ArchiveEventTopic;
  occurredAt: string;
  source: string;
  schemaVersion: 1;
  payload: TPayload;
}

export interface MemberIdentityRef {
  memberId: string;
  memberName?: string;
  memberPhone?: string;
}

export interface AlimtalkCandidateQueuedPayload extends MemberIdentityRef {
  candidateId: string;
  templateCode: string;
  dedupeKey: string;
  sourceDate: string;
}

export interface PrivateLessonChartRequestedPayload extends MemberIdentityRef {
  requestId: string;
  bookingId: string;
  lessonDate: string;
  staffName?: string;
}

export interface StudioMateExcelImportedPayload {
  importId: string;
  sourceKind: "members" | "reservations" | "deleted-classes" | "sales" | "usage";
  sourceDate: string;
  importedRows: number;
}
