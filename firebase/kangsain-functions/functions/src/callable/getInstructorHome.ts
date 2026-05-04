import type { CallableRequest } from "firebase-functions/v2/https";
import { getInstructorViews } from "../firestore/instructorViewRepository";
import { refs } from "../firestore/refs";
import { requireStaff, requireManager } from "../security/authGuards";
import { addDays, dateRange, todayKst } from "../utils/date";

export async function getInstructorHomeHandler(request: CallableRequest): Promise<unknown> {
  const staff = await requireStaff(request);
  const fromDate = String(request.data?.fromDate || request.data?.date || todayKst());
  const toDate = String(request.data?.toDate || addDays(fromDate, 13));
  const requestedStaffId = String(request.data?.staffId || staff.staffId);
  if (requestedStaffId !== staff.staffId) requireManager(staff);
  const dates = dateRange(fromDate, toDate).slice(0, 14);
  const views = await getInstructorViews(requestedStaffId, dates);
  const sync = await refs.syncState(`lecturesRange_${staff.studioId}`).get();
  return {
    staffId: requestedStaffId,
    staff: { staffId: staff.staffId, name: staff.name, role: staff.role },
    today: views.find((view) => view.date === fromDate) || null,
    days: views,
    lastSyncedAt: sync.data()?.lastSuccessAt || null,
    syncStatus: { status: sync.data()?.status || "unknown" },
  };
}
