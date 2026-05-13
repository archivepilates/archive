import type { Timestamp } from "firebase-admin/firestore";

export type StaffRole = "owner" | "manager" | "instructor" | "viewer";
export type LessonType = "private" | "group" | "semi_private" | "unknown";
export type AppBookingStatus = "reserved" | "cancel" | "wait" | "wait_cancel" | "unknown";
export type AttendanceStatus = "unchecked" | "attended" | "absent" | "late_cancel";
export type SyncStatus = "synced" | "pending" | "failed" | "conflict";
export type TicketExpiryLevel = "normal" | "soon" | "expired" | "unknown";
export type QueueStatus = "pending" | "processing" | "retry" | "done" | "failed";
export type WriteJobType = "bookingAttendanceUpdate" | "memberMemoCreate" | "lectureRefresh" | "instructorViewRebuild";
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
  sourceStatus: string;
  appStatus: AppBookingStatus;
  attendanceStatus: AttendanceStatus;
  syncStatus: SyncStatus;
  ticketName: string;
  ticketRemainingCount: number | null;
  ticketExpiresAt: Timestamp | null;
  ticketExpiryLevel: TicketExpiryLevel;
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
  registeredAt: Timestamp | null;
  syncedAt: Timestamp;
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
