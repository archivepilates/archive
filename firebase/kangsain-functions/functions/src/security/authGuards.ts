import type { CallableRequest } from "firebase-functions/v2/https";
import { AppError } from "../utils/errors";
import { getStaffByUid } from "../firestore/staffRepository";
import type { StaffDoc } from "../types/models";

export async function requireStaff(request: CallableRequest): Promise<StaffDoc> {
  const uid = request.auth?.uid;
  if (!uid) throw new AppError("AUTH_REQUIRED", "로그인이 필요합니다");
  const staff = await getStaffByUid(uid);
  if (!staff || !staff.active) throw new AppError("PERMISSION_DENIED", "사용 가능한 강사 계정이 없습니다");
  return staff;
}

export function requireManager(staff: StaffDoc): void {
  if (!["owner", "manager"].includes(staff.role)) throw new AppError("PERMISSION_DENIED", "운영자 권한이 필요합니다");
}

export function assertOwnStaff(staff: StaffDoc, targetStaffId: string): void {
  if (["owner", "manager"].includes(staff.role)) return;
  if (staff.staffId !== targetStaffId) throw new AppError("PERMISSION_DENIED", "담당 강사의 데이터만 접근할 수 있습니다");
}

