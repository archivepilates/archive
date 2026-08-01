export const archiveCoreCollections = {
  members: "members",
  memberAliases: "memberAliases",
  memberTickets: "memberTickets",
  memberPaymentEvents: "memberPaymentEvents",
  lessonOccurrences: "lessonOccurrences",
  reservations: "reservations",
  memberUsageEvents: "memberUsageEvents",
  privateSessionLedger: "privateSessionLedger",
  communicationCandidates: "communicationCandidates",
  communicationApprovals: "communicationApprovals",
  communicationSends: "communicationSends",
  communicationDedupeKeys: "communicationDedupeKeys",
  operatorActions: "operatorActions",
  sourceImports: "sourceImports",
  sourceImportRows: "sourceImportRows",
  automationRuns: "automationRuns",
  automationStatus: "automationStatus",
  dataQualityIssues: "dataQualityIssues",
  auditLogs: "auditLogs",
  staffs: "staffs",
  memberSummaries: "memberSummaries",
  memberPrivateStats: "memberPrivateStats",
  memberRevenueStats: "memberRevenueStats",
  memberTicketStats: "memberTicketStats",
  memberAttendanceStats: "memberAttendanceStats",
  dailyOperationSnapshots: "dailyOperationSnapshots",
  businessSnapshots: "businessSnapshots",
  ticketLiabilityReports: "ticketLiabilityReports",
} as const;

export type ArchiveCoreCollectionName = (typeof archiveCoreCollections)[keyof typeof archiveCoreCollections];

export const archiveCoreSourceCollections = [
  archiveCoreCollections.members,
  archiveCoreCollections.memberAliases,
  archiveCoreCollections.memberTickets,
  archiveCoreCollections.memberPaymentEvents,
  archiveCoreCollections.lessonOccurrences,
  archiveCoreCollections.reservations,
  archiveCoreCollections.communicationCandidates,
  archiveCoreCollections.communicationApprovals,
  archiveCoreCollections.communicationSends,
  archiveCoreCollections.communicationDedupeKeys,
  archiveCoreCollections.operatorActions,
  archiveCoreCollections.sourceImports,
  archiveCoreCollections.automationRuns,
  archiveCoreCollections.dataQualityIssues,
  archiveCoreCollections.auditLogs,
  archiveCoreCollections.staffs,
] as const;

export const archiveCoreComputedCollections = [
  archiveCoreCollections.privateSessionLedger,
  archiveCoreCollections.automationStatus,
  archiveCoreCollections.memberSummaries,
  archiveCoreCollections.memberPrivateStats,
  archiveCoreCollections.memberRevenueStats,
  archiveCoreCollections.memberTicketStats,
  archiveCoreCollections.memberAttendanceStats,
  archiveCoreCollections.dailyOperationSnapshots,
  archiveCoreCollections.businessSnapshots,
  archiveCoreCollections.ticketLiabilityReports,
] as const;

export const archiveCoreLegacyAuditCollections = [
  archiveCoreCollections.memberUsageEvents,
] as const;

export type ArchiveCoreSourceKind =
  | "studiomate_member_excel"
  | "studiomate_reservation_excel"
  | "studiomate_member_usage_excel"
  | "studiomate_deleted_class_excel"
  | "studiomate_sales_excel"
  | "settlement_drive_excel"
  | "firestore_existing"
  | "operator_manual";

export type ArchiveCoreImportStatus = "downloaded" | "normalizing" | "dry_run" | "applied" | "failed" | "superseded";

export type ArchiveCoreAutomationStatus = "healthy" | "running" | "warning" | "failed" | "paused" | "unknown";

export type ArchiveCoreDataQualityStatus = "open" | "reviewing" | "resolved" | "ignored";

export type ArchiveCoreDataQualitySeverity = "info" | "warning" | "critical";

export type ArchiveCoreLessonType = "group" | "private" | "semi_private" | "consultation" | "other" | "unknown";

export type ArchiveCoreUsageStatus =
  | "reserved"
  | "attended"
  | "absent"
  | "late_cancel"
  | "cancelled"
  | "deleted"
  | "unknown";

export interface ArchiveCoreComputationMeta {
  computedAt: string;
  computedFrom: string[];
  sourceImportIds: string[];
  sourceVersion?: string;
  stale: boolean;
  warnings: string[];
}

export interface ArchiveCoreDataQualityRef {
  confidence: "high" | "medium" | "low";
  source: ArchiveCoreSourceKind;
  matchedBy: "member_id" | "phone_name" | "phone" | "name" | "manual" | "unknown";
  warnings: string[];
}

export interface ArchiveCoreMemberTicketDocument {
  ticketId: string;
  studioId?: string;
  memberId: string;
  memberName?: string;
  memberPhone?: string;
  ticketName: string;
  lessonType: ArchiveCoreLessonType;
  classType?: string;
  startDate?: string;
  endDate?: string;
  maxCount?: number;
  remainingCount?: number;
  usableCount?: number;
  ticketStatus?: string;
  isActiveTicket?: boolean;
  sourceKind: ArchiveCoreSourceKind;
  sourceImportId?: string;
  sourceRowId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ArchiveCoreMemberPaymentEventDocument {
  paymentEventId: string;
  studioId?: string;
  memberId: string;
  memberName?: string;
  memberPhone?: string;
  ticketId?: string;
  ticketName?: string;
  paymentType?: string;
  paymentAmount: number;
  paymentAt?: string;
  paymentMethod?: string;
  sourceKind: ArchiveCoreSourceKind;
  sourceImportId?: string;
  sourceRowId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ArchiveCoreLessonOccurrenceDocument {
  lessonOccurrenceId: string;
  studioId?: string;
  lessonType: ArchiveCoreLessonType;
  lessonTitle?: string;
  staffName?: string;
  roomName?: string;
  capacity?: number;
  startsAt: string;
  endsAt?: string;
  sourceKind: ArchiveCoreSourceKind;
  sourceImportId?: string;
  sourceUsageEventIds?: string[];
  reservationCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ArchiveCoreReservationDocument {
  reservationId: string;
  studioId?: string;
  lessonOccurrenceId: string;
  memberId: string;
  memberName?: string;
  memberPhone?: string;
  startsAt: string;
  status: ArchiveCoreUsageStatus;
  sourceKind: ArchiveCoreSourceKind;
  sourceImportId?: string;
  sourceUsageEventId?: string;
  canonicalUsageKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface ArchiveCoreSourceImportDocument {
  importId: string;
  sourceKind: ArchiveCoreSourceKind;
  sourceFileName?: string;
  sourceFilePath?: string;
  downloadedAt?: string;
  importedAt?: string;
  updatedAt: string;
  status: ArchiveCoreImportStatus;
  rowCount: number;
  normalizedRows?: number;
  appliedRows?: number;
  skippedRows?: number;
  duplicateRows?: number;
  errorRows?: number;
  sourceVersion?: string;
  notes?: string[];
}

export interface ArchiveCoreAutomationStatusDocument {
  automationId: string;
  title: string;
  ownerArea: "studiomate" | "alimtalk" | "contacts" | "dashboard" | "private" | "core" | "other";
  status: ArchiveCoreAutomationStatus;
  lastRunAt?: string;
  nextRunAt?: string;
  updatedAt: string;
  lastResult?: string;
  sourceImportIds?: string[];
  runId?: string;
  warnings?: string[];
}

export interface ArchiveCoreDataQualityIssueDocument {
  issueId: string;
  issueType:
    | "duplicate_member"
    | "duplicate_booking"
    | "excel_fallback_superseded"
    | "missing_member_id"
    | "missing_phone"
    | "name_only_match"
    | "usage_gap"
    | "payment_gap"
    | "unknown";
  severity: ArchiveCoreDataQualitySeverity;
  status: ArchiveCoreDataQualityStatus;
  title: string;
  summary: string;
  memberId?: string;
  memberName?: string;
  sourceImportIds?: string[];
  sourcePaths?: string[];
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  resolution?: string;
}

export interface ArchiveCoreMemberUsageEventDocument {
  usageEventId: string;
  studioId?: string;
  memberId: string;
  memberName?: string;
  memberPhone?: string;
  lessonType: ArchiveCoreLessonType;
  usageStatus: ArchiveCoreUsageStatus;
  lessonTitle?: string;
  staffId?: string;
  staffName?: string;
  startsAt: string;
  endsAt?: string;
  ticketId?: string;
  ticketName?: string;
  sourceKind: ArchiveCoreSourceKind;
  sourceImportId?: string;
  sourceRowId?: string;
  canonicalUsageKey: string;
  supersedesUsageEventIds?: string[];
  quality: ArchiveCoreDataQualityRef;
  createdAt: string;
  updatedAt: string;
}

export interface ArchiveCorePrivateSessionLedgerDocument {
  ledgerId: string;
  studioId?: string;
  memberId: string;
  memberName?: string;
  usageEventId: string;
  canonicalUsageKey: string;
  startsAt: string;
  staffName?: string;
  ticketId?: string;
  ticketName?: string;
  cumulativePrivateRound: number;
  currentTicketRound?: number;
  currentTicketTotalRounds?: number;
  status: ArchiveCoreUsageStatus;
  computation: ArchiveCoreComputationMeta;
  createdAt: string;
  updatedAt: string;
}
