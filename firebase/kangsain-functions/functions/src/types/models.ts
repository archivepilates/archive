import type { Timestamp } from "firebase-admin/firestore";

export type StaffRole = "owner" | "manager" | "instructor" | "viewer";
export type LessonType = "private" | "group" | "semi_private" | "unknown";
export type AppBookingStatus = "reserved" | "cancel" | "wait" | "wait_cancel" | "unknown";
export type AttendanceStatus = "unchecked" | "attended" | "absent" | "late_cancel";
export type SyncStatus = "synced" | "pending" | "failed" | "conflict";
export type TicketExpiryLevel = "normal" | "soon" | "expired" | "unknown";
export type QueueStatus = "pending" | "processing" | "retry" | "done" | "failed";
export type WriteJobType =
  | "bookingAttendanceUpdate"
  | "memberMemoCreate"
  | "lectureRefresh"
  | "instructorViewRebuild"
  | "memberProfileRefresh"
  | "googleContactSync";
export type MemoType = "member_note" | "lesson_note" | "private_instructor_note";
export type MemoVisibility = "staff_and_manager" | "manager_only" | "creator_only";

export interface StudioDoc {
  studioId: string;
  name: string;
  timezone: string;
  active: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface StaffDoc {
  staffId: string;
  uid?: string;
  email?: string;
  studioId: string;
  name: string;
  phone?: string;
  phoneLast4?: string;
  color?: string;
  themeColor?: string;
  backgroundColor?: string;
  pinHash?: string;
  pinSalt?: string;
  pinSetAt?: Timestamp | null;
  tempCodeHash?: string;
  tempCodeSalt?: string;
  tempCodeExpiresAt?: Timestamp | null;
  tempCodeIssuedAt?: Timestamp | null;
  loginFailedCount?: number;
  loginLockedUntil?: Timestamp | null;
  role: StaffRole;
  active: boolean;
  studiomateStaffId: string;
  visibleLectureStaffNames: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface LectureDoc {
  lectureId: string;
  studioId: string;
  date: string;
  startAt: Timestamp | null;
  endAt: Timestamp | null;
  roomName: string;
  divisionName: string;
  lessonType: LessonType;
  staffId: string;
  staffName: string;
  title: string;
  status: string;
  capacity: number;
  bookingCount: number;
  waitCount: number;
  cancelCount: number;
  sourceHash: string;
  sourceUpdatedAt: Timestamp | null;
  syncedAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ConsultationDoc {
  consultationId: string;
  studioId: string;
  date: string;
  startAt: Timestamp | null;
  endAt: Timestamp | null;
  staffId: string;
  staffName: string;
  staffIds: string[];
  staffNames: string[];
  memberId: string;
  memberName: string;
  memberPhone: string;
  channel: string;
  status: "scheduled" | "deleted" | "unknown";
  memo: string;
  sourceHash: string;
  sourceUpdatedAt: Timestamp | null;
  syncedAt: Timestamp;
  updatedAt: Timestamp;
}

export interface OtherScheduleDoc {
  scheduleId: string;
  studioId: string;
  date: string;
  startAt: Timestamp | null;
  endAt: Timestamp | null;
  staffId: string;
  staffName: string;
  staffIds: string[];
  staffNames: string[];
  title: string;
  category: string;
  status: "scheduled" | "deleted" | "unknown";
  memo: string;
  sourceHash: string;
  sourceUpdatedAt: Timestamp | null;
  syncedAt: Timestamp;
  updatedAt: Timestamp;
}

export interface BookingDoc {
  bookingId: string;
  lectureId: string;
  studioId: string;
  memberId: string;
  memberName: string;
  memberPhone: string;
  memberRegisteredAt: Timestamp | null;
  staffId: string;
  staffName: string;
  lectureDate: string;
  lectureStartAt: Timestamp | null;
  lectureEndAt: Timestamp | null;
  lessonType?: LessonType;
  sourceStatus: string;
  appStatus: AppBookingStatus;
  attendanceStatus: AttendanceStatus;
  syncStatus: SyncStatus;
  supersededByBookingId?: string | null;
  ticketName: string;
  ticketClassType?: string;
  ticketType?: string;
  ticketRemainingCount: number | null;
  ticketExpiresAt: Timestamp | null;
  ticketExpiryLevel: TicketExpiryLevel;
  sessionOrder?: {
    category?: "group" | "private" | "unknown" | string;
    cumulativeRound?: number | null;
    privateCumulativeRound?: number | null;
    groupCumulativeRound?: number | null;
    counted?: boolean;
    excludedReason?: string | null;
    supersededByBookingId?: string | null;
    computedFrom?: string;
    computedAt?: Timestamp;
  };
  sessionOrderCorrection?: {
    fromPrivateCumulativeRound?: number | null;
    toPrivateCumulativeRound?: number | null;
    fromCounted?: boolean | null;
    toCounted?: boolean | null;
    reason: string;
    correctedAt: Timestamp;
  };
  parkingPreRegistrationId?: string;
  parkingVehicleId?: string;
  parkingCarLast4?: string;
  parkingStatus?: string;
  parkingPreRegistrationStatus?: string;
  parkingPreRegisteredAt?: Timestamp;
  memberTagIds: string[];
  lastMemoPreview: string;
  lastMemoAt: Timestamp | null;
  lastChangedBy: string;
  sourceHash: string;
  sourceUpdatedAt: Timestamp | null;
  syncedAt: Timestamp;
  updatedAt: Timestamp;
}

export interface InstructorViewDoc {
  viewId: string;
  studioId: string;
  staffId: string;
  date: string;
  summary: {
    totalLectures: number;
    totalBookings: number;
    uncheckedAttendanceCount: number;
    reservedCount: number;
    cancelCount: number;
    waitCount: number;
  };
  lectures: Array<Record<string, unknown>>;
  updatedAt: Timestamp;
}

export interface AttendanceSummaryDoc {
  summaryId: string;
  studioId: string;
  memberId: string;
  periodStart: string;
  periodEnd: string;
  attended: number;
  absent: number;
  cancel: number;
  waitCancel: number;
  total: number;
  updatedAt: Timestamp;
}

export interface AdminActionDoc {
  actionId: string;
  studioId: string;
  date: string;
  periodStart: string;
  periodEnd: string;
  actions: Array<{
    actionKey: string;
    type: "ticket_expiring" | "attendance_drop" | "long_absence" | "low_class" | "attendance_unchecked";
    label: string;
    title: string;
    body: string;
    level: "good" | "wait" | "bad";
    memberId?: string;
    memberName?: string;
    lectureId?: string;
    staffId?: string;
    staffName?: string;
    sort: string;
  }>;
  summary: {
    total: number;
    ticketExpiring: number;
    attendanceDrop: number;
    longAbsence: number;
    lowClass: number;
    attendanceUnchecked: number;
  };
  completedActionKeys?: string[];
  completedByUid?: string;
  completedAt?: Timestamp;
  updatedAt: Timestamp;
}

export interface NoticeDoc {
  noticeId: string;
  studioId: string;
  staffId: string;
  msgType: string;
  label: string;
  refType: string;
  refStatus: string;
  refLectureId: string;
  refBookingId: string;
  refDate: string;
  refDates: string[];
  updatedFor: string;
  sourceCreatedAt: string;
  sourceUpdatedAt: string;
  processed: boolean;
  processedAt: Timestamp | null;
  raw: Record<string, unknown>;
  createdAt: Timestamp;
}

export interface WriteQueueJobDoc {
  jobId: string;
  studioId: string;
  type: WriteJobType;
  status: QueueStatus;
  attempts: number;
  maxAttempts: number;
  nextRunAt: Timestamp;
  createdByUid: string;
  payload: Record<string, unknown>;
  lastError: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface MemberTagDoc {
  memberId: string;
  studioId: string;
  tags: Array<{
    tagId: string;
    label: string;
    level: "info" | "positive" | "warning" | "danger";
    source: "manual" | "auto_attendance" | "auto_memo" | "auto_profile" | "auto_pattern";
    sourceMemoId?: string;
    sourceDate?: string;
    locked?: boolean;
    updatedAt: Timestamp;
  }>;
  updatedAt: Timestamp;
}

export interface MemberProfileDoc {
  memberId: string;
  studioId: string;
  name: string;
  normalizedName?: string;
  phone?: string;
  phoneLast4?: string;
  email?: string;
  birthDate?: string;
  gender?: string;
  memberGrade?: string;
  instructorLessonDates?: string[];
  memoPreview?: string;
  activeTicketNames?: string[];
  activeTicketCount?: number;
  activeTickets?: Array<{
    userTicketId?: string;
    ticketId?: string;
    name: string;
    remainingCount: number | null;
    usableCount?: number | null;
    maxCount?: number | null;
    availableFrom?: Timestamp | null;
    expiresAt: Timestamp | null;
    expiryLevel: TicketExpiryLevel;
    status?: string;
    classType?: string;
    paymentAmount?: number | null;
    amountTotal?: number | null;
    price?: number | null;
    paymentAt?: Timestamp | null;
    purchasedAt?: Timestamp | null;
    sourceFile?: string;
    sourceImportId?: string;
  }>;
  ticketStatusSummary?: {
    hasHoldingTicket?: boolean;
    holdingTicketCount?: number;
    holdingTickets?: Array<{
      name: string;
      status: string;
      availableFrom?: Timestamp | null;
      expiresAt?: Timestamp | null;
      updatedAtText?: string;
    }>;
  };
  isNewMember?: boolean;
  newMemberBasis?: "registered_at" | "first_seen_booking" | "unknown";
  registeredAt: Timestamp | null;
  sourceUpdatedAt?: Timestamp | null;
  syncedAt: Timestamp;
  updatedAt: Timestamp;
}

export type MemberSignupContractStatus = "draft" | "opened" | "submitted" | "expired" | "cancelled";
export type MemberSignupStudioMateSyncStatus =
  | "pending_excel_reconcile"
  | "manual_required"
  | "retry"
  | "processing"
  | "syncing"
  | "synced"
  | "done"
  | "failed"
  | "skipped";

export interface MemberSignupContractDoc {
  contractId: string;
  studioId: string;
  memberId: string;
  memberName: string;
  memberPhone: string;
  memberPhoneLast4: string;
  status: MemberSignupContractStatus;
  accessTokenHash: string;
  source: "studiomate_profile" | "studiomate_playwright_lookup" | "manual_sample" | "manual";
  member: {
    name: string;
    phone: string;
    gender?: string;
    birthDate?: string;
    email?: string;
    address?: string;
    visitRoute?: string;
    exercisePurpose?: string;
    recommender?: string;
  };
  purchase: {
    ticketName?: string;
    startDate?: string;
    endDate?: string;
    paymentMethod?: string;
    paidAmount?: string;
    unpaidAmount?: string;
  };
  termsVersion: string;
  agreements?: {
    refundAndCancellation: boolean;
    facilityUse: boolean;
    privacyUse: boolean;
    marketingAdConsent?: boolean;
    finalConfirmation: boolean;
  };
  marketingAdConsentAt?: Timestamp | null;
  marketingAdConsentSource?: "memberSignup";
  marketingAdConsentTermsVersion?: string;
  studiomateProfileSyncStatus?: MemberSignupStudioMateSyncStatus | string;
  studiomateSyncStatus?: MemberSignupStudioMateSyncStatus | string;
  studiomateProfileSync?: {
    status: MemberSignupStudioMateSyncStatus | string;
    reason?: string;
    updatedAt?: Timestamp | null;
  };
  signature?: {
    signerName: string;
    signedAtText: string;
    signedAt: Timestamp;
    userAgent: string;
    ipHash: string;
    signatureImageDataUrl?: string;
    signatureImageHash?: string;
  };
  driveArchive?: {
    status: "processing" | "saved" | "failed";
    fileId?: string;
    url?: string;
    folderId?: string;
    folderUrl?: string;
    lastError?: string;
    savedAt?: Timestamp | null;
    updatedAt?: Timestamp | null;
  };
  openedAt?: Timestamp | null;
  submittedAt?: Timestamp | null;
  expiresAt?: Timestamp | null;
  cancelledAt?: Timestamp | null;
  cancelReason?: string;
  purgeAfter?: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type OnsiteWelcomeRequestStatus =
  | "pending"
  | "running"
  | "lookup_ready"
  | "ready"
  | "sent"
  | "error"
  | "cancelled";

export interface OnsiteWelcomeRequestDoc {
  requestId: string;
  studioId: string;
  status: OnsiteWelcomeRequestStatus;
  accessTokenHash: string;
  phone: string;
  phoneLast4: string;
  memberNameHint?: string;
  source: "onsite_welcome_page";
  progressPercent: number;
  progressLabel: string;
  claimedBy?: string;
  lookup?: {
    source: "studiomate_playwright_lookup";
    memberId?: string;
    memberName?: string;
    memberPhone?: string;
    ticketName?: string;
    startDate?: string;
    endDate?: string;
    rawTextPreview?: string;
  };
  contractId?: string;
  signupUrl?: string;
  alimtalkCandidateId?: string;
  alimtalkSendId?: string;
  lastError?: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  startedAt?: Timestamp | null;
  completedAt?: Timestamp | null;
}

export type ContactSyncTarget = "archivepilates_gmail" | "home_archivepilates";
export type ContactSyncStatus = "pending" | "synced" | "skipped" | "failed";
export type AlimtalkCandidateType =
  | "reservation_open"
  | "new_member"
  | "onsite_welcome"
  | "private_survey"
  | "group_survey"
  | "instructor_lesson_confirmation"
  | "instructor_lesson_material"
  | "private_lesson_report"
  | "inbody_report"
  | "ticket_expiring"
  | "remaining_low"
  | "private_count_low"
  | "private_ticket_expiring"
  | "long_absence"
  | "pricing_info"
  | "recommended_meal_survey"
  | "recommended_meal_report"
  | "manual_review";
export type AlimtalkCandidateStatus =
  | "candidate"
  | "reviewed"
  | "queued"
  | "processing"
  | "sent"
  | "skipped"
  | "failed";

export interface MemberContactIndexDoc {
  memberId: string;
  studioId: string;
  name: string;
  contactDisplayName?: string;
  contactMemo?: string;
  memberGrade?: string;
  contactGroupNames?: string[];
  phone: string;
  phoneLast4: string;
  registeredAt: Timestamp | null;
  activeTicketCount: number;
  source: "studiomate_api";
  contactTargets: Record<ContactSyncTarget, ContactSyncStatus>;
  contactHash?: string;
  activeTicketNames?: string[];
  homeContactResourceName?: string;
  lastContactSyncJobId?: string;
  contactLastError?: string | null;
  contactUpdatedAt?: Timestamp | null;
  syncedAt: Timestamp;
  updatedAt: Timestamp;
}

export interface AlimtalkCandidateDoc {
  candidateId: string;
  studioId: string;
  memberId: string;
  memberName: string;
  memberPhone: string;
  type: AlimtalkCandidateType;
  status: AlimtalkCandidateStatus;
  templateCode: string;
  title: string;
  reason: string;
  sourceActionKey?: string;
  sourceDate: string;
  payload: Record<string, string>;
  dedupeKey?: string;
  reasonCode?: string;
  skipCode?: string;
  attempts?: number;
  maxAttempts?: number;
  queuedBy?: "operator" | "auto";
  reviewedByUid?: string;
  reviewedAt?: Timestamp | null;
  sentAt?: Timestamp | null;
  lastError: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface AlimtalkSendDoc {
  sendId: string;
  studioId: string;
  candidateId: string;
  memberId: string;
  memberName: string;
  memberPhone: string;
  templateCode: string;
  dedupeKey?: string;
  dedupePolicy?: string;
  dedupeWindowDays?: number | null;
  status: QueueStatus;
  attempts: number;
  maxAttempts: number;
  nextRunAt: Timestamp;
  solapiMessageId?: string;
  variables?: Record<string, string>;
  lastError: string | null;
  createdByUid: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type RenewalWorkflowStatus = "open" | "contacted" | "considering" | "snoozed" | "resolved" | "excluded";

export interface RenewalCaseDoc {
  caseId: string;
  studioId: string;
  memberId: string;
  memberName: string;
  kind: "group" | "private" | "lesson";
  active: boolean;
  workflowStatus: RenewalWorkflowStatus;
  ticketIdentity: string;
  ticketName: string;
  priority: "urgent" | "warning" | "follow" | "waiting";
  reason: string;
  remainingCount: number | null;
  remainingDays: number | null;
  predictedDepletionDate: string;
  weeklyUsagePace: number;
  nextBookingDate: string;
  recommendation: string;
  sourceDate: string;
  sourceCollection: "memberProfiles";
  sourceCandidateId?: string;
  operatorNote?: string;
  nextActionAt?: Timestamp | null;
  operatorUpdatedAt?: Timestamp | null;
  operatorUpdatedByUid?: string;
  autoResolvedReason?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PrivateSurveyResponseDoc {
  responseId: string;
  studioId: string;
  surveyType?: "private" | "group";
  source: {
    kind?: "google_sheet" | "native";
    spreadsheetId: string;
    sheetName: string;
    rowNumber: number;
  };
  submittedAt: Timestamp | null;
  submittedAtText: string;
  memberName: string;
  memberPhone: string;
  memberPhoneLast4: string;
  experienceType: string;
  summary: {
    goal: string;
    focusArea: string;
    painOrMedicalNote: string;
    exerciseLevel: string;
    concernOrDifficulty: string;
    expectationOrImportantFactor: string;
    referralSource: string;
    lifestyleOrPreviousIssue: string;
  };
  rawAnswers: Record<string, string>;
  matching: {
    status: "matched" | "not_found" | "ambiguous" | "no_booking";
    memberId: string;
    memberName: string;
    memberPhone: string;
    bookingId: string;
    lectureId: string;
    lectureDate: string;
    lectureStartAt: Timestamp | null;
    staffId: string;
    staffName: string;
    reason: string;
  };
  delivery: {
    detailUrl: string;
    alimtalkStatus: "skipped" | "pending" | "sent" | "failed";
    alimtalkReason: string;
  };
  notionSync?: {
    status: "pending" | "synced" | "skipped" | "failed";
    action?: "created" | "updated";
    memberPageId?: string;
    intakePageId?: string;
    syncedAt?: string;
    error?: string;
  } | null;
  finalizationStatus?: "pending" | "processing" | "ready" | "failed";
  finalizationError?: string | null;
  finalizationStartedAt?: Timestamp | null;
  finalizedAt?: Timestamp | null;
  accessTokenHash: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PrivateSurveyRequestDoc {
  requestId: string;
  schemaVersion: 1;
  studioId: string;
  memberId: string;
  memberName: string;
  memberPhone: string;
  memberPhoneLast4: string;
  bookingId: string;
  lectureId: string;
  lectureDate: string;
  lessonStartAt: Timestamp | null;
  staffId: string;
  staffName: string;
  sourceCandidateId: string;
  shortLinkId: string;
  shortUrl: string;
  accessTokenHash: string;
  tokenVersion: 1;
  status: "pending" | "submitted" | "expired" | "cancelled";
  responseId?: string;
  expiresAt: Timestamp | null;
  submittedAt?: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type PrivateLessonChartMode = "pre" | "post";
export type PrivateLessonChartRequestStatus =
  | "pending"
  | "pre_submitted"
  | "post_submitted"
  | "completed"
  | "cancelled";
export type PrivateLessonChartGptStatus =
  | "waiting_post"
  | "pending"
  | "processing"
  | "draft_created"
  | "approved"
  | "published"
  | "failed";

export interface PrivateLessonSessionNumberCorrection {
  from: number | null;
  to: number;
  reason: string;
  correctedAt: Timestamp;
}

export interface PrivateLessonChartRequestDoc {
  requestId: string;
  studioId: string;
  bookingId: string;
  lectureId: string;
  memberId: string;
  memberName: string;
  memberPhone: string;
  memberPhoneLast4: string;
  staffId: string;
  staffName: string;
  staffPhone: string;
  lessonDate: string;
  lessonStartAt: Timestamp | null;
  lessonEndAt: Timestamp | null;
  sessionNumber: number;
  sessionNumberCorrection?: PrivateLessonSessionNumberCorrection;
  rescheduleCorrection?: {
    fromBookingId?: string | null;
    toBookingId?: string | null;
    fromLessonStartAt?: Timestamp | null;
    toLessonStartAt?: Timestamp | null;
    fromSessionNumber?: number | null;
    toSessionNumber?: number | null;
    reason: string;
    correctedAt: Timestamp;
  };
  cancellationReason?: string | null;
  cancelledAt?: Timestamp | null;
  accessTokenHash: string;
  preUrl: string;
  postUrl: string;
  mediaUploadUrl?: string;
  preShortUrl: string;
  postShortUrl: string;
  mediaUploadShortUrl?: string;
  status: PrivateLessonChartRequestStatus;
  preStatus: "pending" | "submitted";
  postStatus: "pending" | "submitted";
  alimtalk: {
    status: "template_pending" | "queued" | "sent" | "failed" | "skipped";
    templateName: string;
    templateId?: string;
    reasonCode?: string;
    solapiMessageId?: string;
    sentAt?: Timestamp;
    lastError: string | null;
  };
  intakeSummary?: {
    responseId?: string;
    submittedAtText?: string;
    experienceType?: string;
    goal?: string;
    focusArea?: string;
    painOrMedicalNote?: string;
    exerciseLevel?: string;
    concernOrDifficulty?: string;
    expectationOrImportantFactor?: string;
    referralSource?: string;
    lifestyleOrPreviousIssue?: string;
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PrivateLessonChartRecordDoc {
  recordId: string;
  requestId: string;
  studioId: string;
  bookingId: string;
  lectureId: string;
  memberId: string;
  memberName: string;
  memberPhone: string;
  staffId: string;
  staffName: string;
  lessonDate: string;
  lessonStartAt: Timestamp | null;
  sessionNumber: number;
  sessionNumberCorrection?: PrivateLessonSessionNumberCorrection;
  rescheduleCorrection?: {
    fromBookingId?: string | null;
    toBookingId?: string | null;
    fromLessonStartAt?: Timestamp | null;
    toLessonStartAt?: Timestamp | null;
    fromSessionNumber?: number | null;
    toSessionNumber?: number | null;
    reason: string;
    correctedAt: Timestamp;
  };
  cancellationReason?: string | null;
  cancelledAt?: Timestamp | null;
  prePlan?: Record<string, unknown>;
  postRecord?: Record<string, unknown>;
  preSubmittedAt?: Timestamp | null;
  postSubmittedAt?: Timestamp | null;
  gptStatus: PrivateLessonChartGptStatus;
  gptTaskId?: string;
  gptProvider?: "gemini" | "macmini_gpt" | string;
  gptModel?: string;
  gptSourceHash?: string;
  gptError?: string | null;
  gptDraftSummary?: string;
  gptDraftNextDirection?: string;
  publicReportUrl?: string;
  publicReportCanonicalUrl?: string;
  publicSummary?: string;
  publicNextDirection?: string;
  manualReportEdit?: {
    editedAt?: Timestamp;
    editedBy?: string;
    source?: string;
  } | null;
  media?: {
    rootFolderId?: string;
    memberFolderId?: string;
    sessionFolderId?: string;
    sessionFolderUrl?: string;
    files?: PrivateLessonChartMediaFile[];
    updatedAt?: Timestamp;
  };
  publicReportApproval?: {
    status: "pending" | "approved" | "queued" | "processing" | "sent" | "failed";
    approvedAt?: Timestamp | null;
    approvedBy?: string;
    candidateId?: string | null;
    sentAt?: Timestamp;
    lastError?: string | null;
  };
  reportRevision?: string;
  approvedRevision?: string;
  sentRevision?: string;
  approvedReportSnapshot?: PrivateLessonReportSnapshot | null;
  sentReportSnapshot?: PrivateLessonReportSnapshot | null;
  legacySentReportSnapshot?: PrivateLessonReportSnapshot | null;
  notionSync?: {
    status: "pending" | "synced" | "failed";
    pageId?: string;
    pageUrl?: string;
    instructorPageId?: string;
    instructorPageUrl?: string;
    syncedAt?: string;
    error?: string;
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PrivateLessonReportSnapshot {
  revision: string;
  summary: string;
  nextDirection: string;
  homework: string;
  includedMedia: PrivateLessonChartMediaFile[];
  memberName: string;
  staffName: string;
  lessonDate: string;
  lessonStartAt: Timestamp | null;
  sessionNumber: number;
  createdAt: Timestamp;
}

export type PrivateLessonWorkflowStage =
  | "preparation"
  | "recording"
  | "report_review"
  | "delivered"
  | "cancelled"
  | "needs_review";

export interface PrivateLessonSessionDoc {
  sessionId: string;
  studioId: string;
  bookingId: string;
  bookingAliases: string[];
  occurrenceId: string;
  memberId: string;
  memberName: string;
  staffId: string;
  staffName: string;
  lessonDate: string;
  lessonStartAt: Timestamp | null;
  sessionNumber: number | null;
  roundVerified: boolean;
  workflowStage: PrivateLessonWorkflowStage;
  preStatus: "pending" | "submitted";
  postStatus: "pending" | "submitted";
  reportStatus: "pending" | "draft" | "approved" | "processing" | "sent" | "failed";
  deliveryStatus: "pending" | "queued" | "processing" | "sent" | "failed";
  reportRevision: string;
  approvedRevision: string;
  sentRevision: string;
  nextAction: string;
  cancellationReason: string;
  lastError: string;
  legacyRequestId: string;
  legacyRecordId: string;
  notionProjection?: {
    status: "pending" | "synced" | "failed";
    pageId?: string;
    pageUrl?: string;
    updatedAt?: Timestamp;
    error?: string;
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PrivateLessonChartMediaFile {
  mediaId: string;
  fileName: string;
  mimeType: string;
  size: number;
  driveFileId: string;
  driveUrl: string;
  previewUrl: string;
  thumbnailUrl?: string;
  iconUrl?: string;
  folderId: string;
  includeInReport: boolean;
  uploadedAt: Timestamp;
  uploadedBy: string;
  source: "private_chart_teacher_upload";
  status: "uploaded";
}

export interface ContactSyncJobDoc {
  jobId: string;
  studioId: string;
  memberId: string;
  memberName: string;
  contactDisplayName?: string;
  contactMemo?: string;
  contactGroupNames?: string[];
  memberPhone: string;
  target: ContactSyncTarget;
  status: QueueStatus;
  attempts: number;
  maxAttempts: number;
  nextRunAt: Timestamp;
  lastError: string | null;
  result?: {
    action: "created" | "updated" | "skipped";
    resourceName?: string;
  };
  sourceReason:
    | "member_profile_refresh"
    | "staff_profile_refresh"
    | "notice_member_signup"
    | "notice_ticket_update"
    | "consultation_schedule"
    | "consultation_member_excel"
    | "manual_resync";
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface MemberMemoDoc {
  memoId: string;
  studioId: string;
  memberId: string;
  memberName: string;
  lectureId: string;
  bookingId: string;
  lectureDate: string;
  staffId: string;
  staffName: string;
  memoType: MemoType;
  visibility: MemoVisibility;
  content: string;
  syncStatus: SyncStatus;
  createdByUid: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface TokenCacheDoc {
  tokenKey: string;
  service: "studiomate" | "manager";
  studioId: string;
  staffId?: string;
  token: string;
  issuedAt: Timestamp;
  expiresAt: Timestamp;
  lastUsedAt: Timestamp;
}

export interface FcmTokenDoc {
  tokenId: string;
  studioId: string;
  staffId: string;
  uid: string;
  token: string;
  platform: "web" | "ios" | "android" | "unknown";
  deviceLabel: string;
  createdAt: Timestamp;
  lastSeenAt: Timestamp;
}
