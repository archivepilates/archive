import { Timestamp } from "firebase-admin/firestore";
import { WRITE_QUEUE_MAX_ATTEMPTS } from "../config/constants";
import type { AttendanceStatus, WriteQueueJobDoc } from "../types/models";
import { queueJobIdFor } from "../utils/idempotency";
import { nowTimestamp } from "../utils/date";
import { enqueueWriteJob } from "../firestore/writeQueueRepository";

export async function enqueueBookingAttendanceJob(input: {
  studioId: string;
  bookingId: string;
  attendanceStatus: AttendanceStatus;
  createdByUid: string;
}): Promise<WriteQueueJobDoc> {
  return enqueueTypedJob("bookingAttendanceUpdate", input.studioId, input.createdByUid, {
    bookingId: input.bookingId,
    attendanceStatus: input.attendanceStatus,
  });
}

export async function enqueueMemberMemoJob(input: {
  studioId: string;
  memberId: string;
  content: string;
  createdByUid: string;
}): Promise<WriteQueueJobDoc> {
  return enqueueTypedJob("memberMemoCreate", input.studioId, input.createdByUid, {
    memberId: input.memberId,
    content: input.content,
  });
}

export async function enqueueLectureRefreshJob(input: {
  studioId: string;
  lectureId: string;
  fallbackDate?: string;
  createdByUid: string;
}): Promise<WriteQueueJobDoc> {
  return enqueueTypedJob("lectureRefresh", input.studioId, input.createdByUid, {
    lectureId: input.lectureId,
    fallbackDate: input.fallbackDate || "",
  });
}

async function enqueueTypedJob(
  type: WriteQueueJobDoc["type"],
  studioId: string,
  createdByUid: string,
  payload: Record<string, unknown>,
): Promise<WriteQueueJobDoc> {
  const now = nowTimestamp();
  const job: WriteQueueJobDoc = {
    jobId: queueJobIdFor({ type, studioId, payload, createdByUid, createdAtBucket: Math.floor(Date.now() / 1000) }),
    studioId,
    type,
    status: "pending",
    attempts: 0,
    maxAttempts: WRITE_QUEUE_MAX_ATTEMPTS,
    nextRunAt: Timestamp.now(),
    createdByUid,
    payload,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };
  await enqueueWriteJob(job);
  return job;
}

