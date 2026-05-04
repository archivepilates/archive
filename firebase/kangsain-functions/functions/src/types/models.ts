import type { Timestamp } from "firebase-admin/firestore";

export type StaffRole = "owner" | "manager" | "instructor" | "viewer";
export type LessonType = "private" | "group" | "semi_private" | "unknown";
export type AppBookingStatus = "reserved" | "cancel" | "wait" | "wait_cancel" | "unknown";
export type AttendanceStatus = "unchecked" | "attended" | "absent" | "late_cancel";
export type SyncStatus = "synced" | "pending" | "failed" | "conflict";
export type TicketExpiryLevel = "normal" | "soon" | "expired" | "unknown";
export type QueueStatus = "pending" | "processing" | "retry" | "success" | "failed";
export type WriteJobType = "bookingAttendanceUpdate" | "memberMemoCreate" | "lectureRefresh" | "instructorViewRebuild";

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
  studioId: string;
  name: string;
  phone?: string;
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

export interface BookingDoc {
  bookingId: string;
  lectureId: string;
  studioId: string;
  memberId: string;
  memberName: string;
  staffId: string;
  staffName: string;
  lectureDate: string;
  lectureStartAt: Timestamp | null;
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
    groupAverageMembers: number;
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

export interface DailyGroupStatsDoc {
  statId: string;
  studioId: string;
  date: string;
  groupLectureCount: number;
  groupBookingCount: number;
  averageMembers: number;
  byStaff: Record<string, {
    staffName: string;
    groupLectureCount: number;
    groupBookingCount: number;
    averageMembers: number;
  }>;
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

