import type { CallableRequest } from "firebase-functions/v2/https";
import { getBooking } from "../firestore/bookingRepository";
import { refs } from "../firestore/refs";
import { enqueueBookingAttendanceJob } from "../queue/enqueueWriteJob";
import { rebuildInstructorView } from "../sync/rebuildInstructorViews";
import { requireStaff, assertOwnStaff } from "../security/authGuards";
import type { AttendanceStatus } from "../types/models";
import { AppError } from "../utils/errors";
import { nowTimestamp } from "../utils/date";

const ALLOWED: AttendanceStatus[] = ["attended", "absent", "late_cancel", "unchecked"];

export async function submitBookingAttendanceHandler(request: CallableRequest): Promise<unknown> {
  const staff = await requireStaff(request);
  const bookingId = String(request.data?.bookingId || "");
  const attendanceStatus = String(request.data?.attendanceStatus || "") as AttendanceStatus;
  if (!bookingId || !ALLOWED.includes(attendanceStatus)) throw new AppError("INVALID_ARGUMENT", "출석 변경 요청 값이 올바르지 않습니다");

  const booking = await getBooking(bookingId);
  if (!booking) throw new AppError("INVALID_ARGUMENT", "예약을 찾을 수 없습니다");
  assertOwnStaff(staff, booking.staffId);
  if (booking.appStatus === "wait") throw new AppError("INVALID_ARGUMENT", "예약대기 회원은 출석/결석을 변경할 수 없습니다");

  await refs.booking(bookingId).set({
    attendanceStatus,
    syncStatus: "pending",
    lastChangedBy: request.auth?.uid || "unknown",
    updatedAt: nowTimestamp(),
  }, { merge: true });

  const job = await enqueueBookingAttendanceJob({
    studioId: booking.studioId,
    bookingId,
    attendanceStatus,
    createdByUid: request.auth?.uid || "unknown",
  });
  await rebuildInstructorView({ studioId: booking.studioId, staffId: booking.staffId, date: booking.lectureDate });

  return { ok: true, bookingId, attendanceStatus, jobId: job.jobId };
}

