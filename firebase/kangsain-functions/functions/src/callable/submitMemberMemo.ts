import type { CallableRequest } from "firebase-functions/v2/https";
import { getBooking } from "../firestore/bookingRepository";
import { refs } from "../firestore/refs";
import { enqueueMemberMemoJob } from "../queue/enqueueWriteJob";
import { rebuildInstructorView } from "../sync/rebuildInstructorViews";
import { requireStaff, assertOwnStaff } from "../security/authGuards";
import { AppError } from "../utils/errors";
import { nowTimestamp } from "../utils/date";

export async function submitMemberMemoHandler(request: CallableRequest): Promise<unknown> {
  const staff = await requireStaff(request);
  const bookingId = String(request.data?.bookingId || "");
  const memberId = String(request.data?.memberId || "");
  const lectureId = String(request.data?.lectureId || "");
  const content = String(request.data?.content || "").trim();
  const visibility = String(request.data?.visibility || "staff_and_manager");
  const memoType = String(request.data?.memoType || "member_note");
  if (!bookingId || !memberId || !lectureId || !content) throw new AppError("INVALID_ARGUMENT", "메모 입력값이 올바르지 않습니다");
  if (!["staff_and_manager", "manager_only", "creator_only"].includes(visibility)) throw new AppError("INVALID_ARGUMENT", "메모 공개 범위가 올바르지 않습니다");

  const booking = await getBooking(bookingId);
  if (!booking) throw new AppError("INVALID_ARGUMENT", "예약을 찾을 수 없습니다");
  assertOwnStaff(staff, booking.staffId);

  const memoRef = refs.memberMemos().doc();
  await memoRef.set({
    memoId: memoRef.id,
    studioId: booking.studioId,
    memberId,
    memberName: booking.memberName,
    lectureId,
    bookingId,
    staffId: booking.staffId,
    staffName: booking.staffName,
    memoType,
    visibility,
    content,
    syncStatus: "pending",
    createdByUid: request.auth?.uid || "unknown",
    createdAt: nowTimestamp(),
    updatedAt: nowTimestamp(),
  });
  await refs.booking(bookingId).set({ lastMemoPreview: content.slice(0, 80), updatedAt: nowTimestamp() }, { merge: true });
  const job = await enqueueMemberMemoJob({
    studioId: booking.studioId,
    memberId,
    content,
    createdByUid: request.auth?.uid || "unknown",
  });
  await rebuildInstructorView({ studioId: booking.studioId, staffId: booking.staffId, date: booking.lectureDate });
  return { ok: true, memoId: memoRef.id, jobId: job.jobId };
}

