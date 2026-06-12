import type { CallableRequest } from "firebase-functions/v2/https";
import { requireStaff } from "../security/authGuards";
import { AppError } from "../utils/errors";

export async function submitBookingAttendanceHandler(request: CallableRequest): Promise<never> {
  await requireStaff(request);
  throw new AppError(
    "PERMISSION_DENIED",
    "StudioMate API 출결 쓰기는 중단되었습니다. 출석 체크인은 ARCHIVE CORE 체크인 기록으로만 처리합니다.",
  );
}
