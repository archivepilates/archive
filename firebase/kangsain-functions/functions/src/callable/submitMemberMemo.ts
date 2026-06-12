import type { CallableRequest } from "firebase-functions/v2/https";
import { db } from "../config/firebase";
import { getBooking } from "../firestore/bookingRepository";
import { refs } from "../firestore/refs";
import { rebuildInstructorView } from "../sync/rebuildInstructorViews";
import { requireStaff, assertOwnStaff } from "../security/authGuards";
import type { MemoType, MemoVisibility } from "../types/models";
import { AppError } from "../utils/errors";
import { nowTimestamp } from "../utils/date";

export async function submitMemberMemoHandler(request: CallableRequest): Promise<unknown> {
  const staff = await requireStaff(request);
  const bookingId = String(request.data?.bookingId || "");
  const memberId = String(request.data?.memberId || "");
  const lectureId = String(request.data?.lectureId || "");
  const content = String(request.data?.content || "").trim();
  const visibility = String(request.data?.visibility || "staff_and_manager") as MemoVisibility;
  const memoType = String(request.data?.memoType || "member_note") as MemoType;
  if (!bookingId || !memberId || !lectureId || !content)
    throw new AppError("INVALID_ARGUMENT", "메모 입력값이 올바르지 않습니다");
  if (!["staff_and_manager", "manager_only", "creator_only"].includes(visibility))
    throw new AppError("INVALID_ARGUMENT", "메모 공개 범위가 올바르지 않습니다");
  if (!["member_note", "lesson_note", "private_instructor_note"].includes(memoType))
    throw new AppError("INVALID_ARGUMENT", "메모 종류가 올바르지 않습니다");

  const booking = await getBooking(bookingId);
  if (!booking) throw new AppError("INVALID_ARGUMENT", "예약을 찾을 수 없습니다");
  assertOwnStaff(staff, booking.staffId);

  const now = nowTimestamp();
  const memoRef = refs.memberMemos().doc();
  await memoRef.set({
    memoId: memoRef.id,
    studioId: booking.studioId,
    memberId,
    memberName: booking.memberName,
    lectureId,
    bookingId,
    lectureDate: booking.lectureDate,
    staffId: booking.staffId,
    staffName: booking.staffName,
    memoType,
    visibility,
    content,
    syncStatus: memoType === "member_note" ? "pending" : "synced",
    studioMateWriteMode: memoType === "member_note" ? "playwright" : "not_required",
    createdByUid: request.auth?.uid || "unknown",
    createdAt: now,
    updatedAt: now,
  });
  await refs
    .booking(bookingId)
    .set(
      { lastMemoPreview: content.slice(0, 60), lastMemoAt: now, updatedAt: now },
      { merge: true },
    );
  const jobId = memoType === "member_note" ? memoRef.id : null;
  if (jobId) {
    await db.collection("studiomateMemoWriteJobs").doc(jobId).set(
      {
        jobId,
        studioId: booking.studioId,
        source: "archive_core_member_memo",
        status: "pending",
        writeMode: "playwright",
        memberId,
        memberName: booking.memberName,
        memberPhone: booking.memberPhone || "",
        bookingId,
        lectureId,
        lectureDate: booking.lectureDate,
        staffId: booking.staffId,
        staffName: booking.staffName,
        content,
        attempts: 0,
        maxAttempts: 3,
        lastError: null,
        createdByUid: request.auth?.uid || "unknown",
        createdAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
  }
  await rebuildInstructorView({ studioId: booking.studioId, staffId: booking.staffId, date: booking.lectureDate });
  return { ok: true, memoId: memoRef.id, jobId };
}
