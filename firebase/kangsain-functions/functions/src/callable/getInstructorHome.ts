import type { CallableRequest } from "firebase-functions/v2/https";
import { getInstructorViews } from "../firestore/instructorViewRepository";
import { refs } from "../firestore/refs";
import { requireStaff } from "../security/authGuards";
import { addDays, todayKst } from "../utils/date";

export async function getInstructorHomeHandler(request: CallableRequest): Promise<unknown> {
  const staff = await requireStaff(request);
  const date = String(request.data?.date || todayKst());
  const days = Math.max(1, Math.min(Number(request.data?.days || 14), 14));
  const dates = Array.from({ length: days }, (_, index) => addDays(date, index));
  const views = await getInstructorViews(staff.staffId, dates);
  const sync = await refs.syncState(`lecturesRange_${staff.studioId}`).get();
  return {
    staff: { staffId: staff.staffId, name: staff.name, role: staff.role },
    today: views.find((view) => view.date === date) || null,
    days: views,
    syncStatus: {
      status: sync.data()?.status || "unknown",
      lastSyncedAt: sync.data()?.lastSuccessAt || null,
    },
  };
}

