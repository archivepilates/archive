import type { CallableRequest } from "firebase-functions/v2/https";
import type { StaffDoc } from "../types/models";
import { AppError } from "../utils/errors";

export type CoreInstructorStaff = StaffDoc & {
  employmentStatus?: string;
  employmentSource?: string;
  coreAccessEnabled?: boolean;
  coreMustChangePassword?: boolean;
  coreAuthAfter?: number;
  corePasswordChangeLockUntil?: number;
};

export function assertCoreSessionFresh(staff: CoreInstructorStaff, auth: CallableRequest["auth"]): void {
  if (staff.coreAuthAfter === undefined && staff.role !== "instructor") return;
  if (!auth || staff.uid !== auth.uid || !Number.isSafeInteger(staff.coreAuthAfter) ||
      Number(staff.coreAuthAfter) < 0 || !Number.isSafeInteger(auth.token.auth_time) ||
      auth.token.auth_time < Number(staff.coreAuthAfter))
    throw new AppError("AUTH_REQUIRED", "로그인 세션이 종료됐습니다. 다시 로그인하세요");
}

export function coreInstructorAccessIssue(
  staff: CoreInstructorStaff,
  auth: CallableRequest["auth"],
  allowFirstLogin = false,
): string {
  if (!auth || !staff || ![staff.uid, staff.staffId, staff.studioId, auth.uid].every(value => typeof value === "string" && value.trim()) ||
      staff.uid !== auth.uid || staff.staffId !== auth.token.staffId ||
      staff.studioId !== auth.token.studioId || auth.token.role !== "instructor") return "identity_mismatch";
  if (staff.role !== "instructor" || staff.active !== true || staff.coreAccessEnabled !== true)
    return "account_disabled";
  if (staff.employmentStatus !== "current" || staff.employmentSource !== "studiomate_staff_tab_browser_scan")
    return "not_current_staff";
  if (!allowFirstLogin && staff.coreMustChangePassword !== false) return "password_change_required";
  if (!Number.isSafeInteger(staff.coreAuthAfter) || Number(staff.coreAuthAfter) < 0 || !Number.isSafeInteger(auth.token.auth_time) || auth.token.auth_time < Number(staff.coreAuthAfter))
    return "fresh_login_required";
  return "";
}

export function assertCoreInstructorAccess(staff: CoreInstructorStaff, auth: CallableRequest["auth"], allowFirstLogin = false): void {
  const issue = coreInstructorAccessIssue(staff, auth, allowFirstLogin);
  if (issue === "fresh_login_required") assertCoreSessionFresh(staff, auth);
  if (issue) throw new AppError("PERMISSION_DENIED", issue === "password_change_required"
    ? "먼저 초기 비밀번호를 변경하세요" : "사용 가능한 강사 계정이 없습니다. 다시 로그인하거나 운영자에게 확인하세요");
}

export function validCorePassword(password: unknown): password is string {
  return typeof password === "string" && password.length >= 8 && password.length <= 64 &&
    password !== "111111" && password.trim() === password;
}

export function ownsCoreBooking(staff: StaffDoc, booking: Record<string, any>, request?: Record<string, any>): boolean {
  if (![staff.staffId, staff.studioId, booking.memberId, booking.bookingId, booking.lectureDate].every(value => typeof value === "string" && value.trim()) ||
      booking.staffId !== staff.staffId || booking.studioId !== staff.studioId || !booking.memberId ||
      ["cancelled", "canceled", "deleted"].includes(String(booking.appStatus || "")) ||
      /취소|삭제/.test(String(booking.sourceStatus || ""))) return false;
  if (request && (request.staffId !== staff.staffId || request.studioId !== staff.studioId ||
      request.memberId !== booking.memberId || request.lessonDate !== booking.lectureDate ||
      request.bookingId !== booking.bookingId || request.status === "cancelled" || request.manualTest === true)) return false;
  return true;
}

export function safeCoreChartUrl(value: unknown, requestId?: string): string {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol === "https:" && url.hostname === "in.archivepilates.com" && !url.username && !url.password && !url.port &&
        /^\/(?:archivein\/)?private-chart\/?$/.test(url.pathname) && url.searchParams.get("r") && url.searchParams.get("t") &&
        (!requestId || url.searchParams.get("r") === requestId))
      return url.href;
  } catch { /* Invalid source URLs cannot become instructor actions. */ }
  return "";
}
