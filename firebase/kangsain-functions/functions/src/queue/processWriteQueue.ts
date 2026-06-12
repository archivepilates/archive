import { Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { db } from "../config/firebase";
import { refs } from "../firestore/refs";
import { getBooking } from "../firestore/bookingRepository";
import type { AttendanceStatus, WriteQueueJobDoc } from "../types/models";
import { StudioMateClient } from "../studiomate/studiomateClient";
import { errorMessage } from "../utils/errors";
import { nowTimestamp } from "../utils/date";
import { nextRetryAt } from "./retryPolicy";
import { refreshLectureById } from "../sync/refreshLectureById";

export async function processWriteQueue(): Promise<{ processed: number }> {
  const due = await refs
    .writeQueue()
    .where("status", "in", ["pending", "retry"])
    .where("nextRunAt", "<=", Timestamp.now())
    .orderBy("nextRunAt", "asc")
    .limit(50)
    .get();

  let processed = 0;
  for (const snap of due.docs) {
    const claimed = await claimJob(snap.data());
    if (!claimed) continue;
    await processJob(claimed);
    processed++;
  }
  logger.info("processWriteQueue completed", { processed });
  return { processed };
}

async function claimJob(job: WriteQueueJobDoc): Promise<WriteQueueJobDoc | null> {
  const ref = refs.writeJob(job.jobId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.data();
    if (!current || !["pending", "retry"].includes(current.status)) return null;
    const next = { ...current, status: "processing" as const, updatedAt: nowTimestamp() };
    tx.set(ref, next, { merge: true });
    return next;
  });
}

async function processJob(job: WriteQueueJobDoc): Promise<void> {
  try {
    if (job.type === "bookingAttendanceUpdate") await processAttendanceJob(job);
    else if (job.type === "memberMemoCreate") await processMemoJob(job);
    else if (job.type === "lectureRefresh") await processLectureRefreshJob(job);
    else throw new Error(`Unsupported job type: ${job.type}`);

    await refs.writeJob(job.jobId).set({ status: "done", updatedAt: nowTimestamp(), lastError: null }, { merge: true });
  } catch (err) {
    const attempts = job.attempts + 1;
    const failed = attempts >= job.maxAttempts;
    await refs.writeJob(job.jobId).set(
      {
        status: failed ? "failed" : "retry",
        attempts,
        nextRunAt: failed ? job.nextRunAt : nextRetryAt(attempts),
        lastError: errorMessage(err),
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
    if (job.type === "bookingAttendanceUpdate" && failed) {
      await refs
        .booking(String(job.payload.bookingId || ""))
        .set({ syncStatus: "failed", updatedAt: nowTimestamp() }, { merge: true });
    }
  }
}

async function processAttendanceJob(job: WriteQueueJobDoc): Promise<void> {
  const bookingId = String(job.payload.bookingId || "");
  const attendanceStatus = String(job.payload.attendanceStatus || "") as AttendanceStatus;
  const booking = await getBooking(bookingId);
  if (!booking) throw new Error(`Booking not found: ${bookingId}`);
  if (booking.appStatus !== "reserved")
    throw new Error(`Attendance can only be changed for reserved bookings: ${bookingId} (${booking.appStatus})`);
  const allowBeforeStart = job.payload.allowBeforeStart === true;
  if (!allowBeforeStart && !canUpdateAttendanceAfterClassStart(booking.lectureStartAt?.toDate()))
    throw new Error(`Attendance can only be changed after lecture start: ${bookingId}`);
  const client = new StudioMateClient(job.studioId);
  await client.updateBookingStatus({ bookingId, status: toStudioMateAttendanceStatus(attendanceStatus) });
  await refs.booking(bookingId).set({ syncStatus: "synced", updatedAt: nowTimestamp() }, { merge: true });
}

async function processMemoJob(job: WriteQueueJobDoc): Promise<void> {
  const memberId = String(job.payload.memberId || "");
  const content = String(job.payload.content || "");
  const client = new StudioMateClient(job.studioId);
  await client.createMemo({ memberId, content });
}

async function processLectureRefreshJob(job: WriteQueueJobDoc): Promise<void> {
  await refreshLectureById({
    studioId: job.studioId,
    lectureId: String(job.payload.lectureId || ""),
    fallbackDate: String(job.payload.fallbackDate || ""),
  });
}

function toStudioMateAttendanceStatus(status: AttendanceStatus): string {
  if (status === "attended") return "attendance";
  if (status === "absent") return "absence";
  if (status === "late_cancel") return "absence";
  return "booked";
}

function canUpdateAttendanceAfterClassStart(lectureStartAt?: Date): boolean {
  return Boolean(lectureStartAt && lectureStartAt.getTime() <= Date.now());
}
