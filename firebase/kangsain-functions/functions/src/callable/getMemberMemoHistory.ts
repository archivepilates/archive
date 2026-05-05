import type { CallableRequest } from "firebase-functions/v2/https";
import { getRecentMemberBookings, staffHasHandledMember } from "../firestore/bookingRepository";
import { getMemberMemoHistory } from "../firestore/memberMemoRepository";
import { refs } from "../firestore/refs";
import { requireStaff, isManagerRole } from "../security/authGuards";
import { addDays, todayKst } from "../utils/date";
import { AppError } from "../utils/errors";

export async function getMemberMemoHistoryHandler(request: CallableRequest): Promise<unknown> {
  const staff = await requireStaff(request);
  const memberId = String(request.data?.memberId || "");
  const limit = Math.max(1, Math.min(Number(request.data?.limit || 20), 50));
  if (!memberId) throw new AppError("INVALID_ARGUMENT", "memberId가 필요합니다");

  const isManager = isManagerRole(staff.role);
  if (!isManager && !(await staffHasHandledMember(staff.studioId, staff.staffId, memberId))) {
    throw new AppError("PERMISSION_DENIED", "담당한 이력이 없는 회원입니다");
  }

  const endDate = todayKst();
  const summarySnap = await refs.attendanceSummary(memberId, endDate.replaceAll("-", "")).get();
  const fallbackBookings = summarySnap.exists
    ? []
    : await getRecentMemberBookings(staff.studioId, [memberId], addDays(endDate, -29), endDate);
  const memos = await getMemberMemoHistory({
    studioId: staff.studioId,
    memberId,
    uid: request.auth?.uid || "",
    isManager,
    limit,
  });

  const firstBooking = fallbackBookings[0];
  return {
    memberId,
    memberName: firstBooking?.memberName || memos[0]?.memberName || "",
    memos: memos.map((memo) => ({
      memoId: memo.memoId,
      content: memo.content,
      staffName: memo.staffName,
      createdAt: memo.createdAt,
      lectureDate: memo.lectureDate,
      lectureId: memo.lectureId,
    })),
    recent30Days: summarySnap.data() || buildFallbackSummary(fallbackBookings),
  };
}

function buildFallbackSummary(rows: Awaited<ReturnType<typeof getRecentMemberBookings>>) {
  return {
    attended: rows.filter((row) => row.attendanceStatus === "attended").length,
    absent: rows.filter((row) => row.attendanceStatus === "absent").length,
    cancel: rows.filter((row) => row.appStatus === "cancel").length,
    waitCancel: rows.filter((row) => row.appStatus === "wait_cancel").length,
    total: rows.length,
  };
}
