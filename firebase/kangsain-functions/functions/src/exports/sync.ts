import { logger } from "firebase-functions";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { onDocumentCreated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { syncDashboardFromSheets } from "../sync/syncDashboardFromSheets";
import { syncLecturesDaily } from "../sync/syncLecturesDaily";
import { syncLecturesRange } from "../sync/syncLecturesRange";
import { pollManagerNotices } from "../sync/pollManagerNotices";
import { processContactSyncJobs } from "../sync/processContactSyncJobs";
import { processWriteQueue } from "../queue/processWriteQueue";
import { createDueParkingDiscountJobs } from "../parking/parkingOperations";
import { syncManagerStaffs } from "../sync/syncManagerStaffs";
import { sendAttendanceReminder } from "../push/sendAttendanceReminder";
import { getStaffByUid } from "../firestore/staffRepository";
import { isManagerRole, requireManager, requireStaff } from "../security/authGuards";
import { nowTimestamp } from "../utils/date";
import { toHttpsError } from "../utils/errors";
import { callableOptions, longCallableOptions, longRequestOptions, scheduleOptions } from "../runtime/functionOptions";
import type { StaffDoc } from "../types/models";
import { queueActiveStaffContactSync, staffContactIdentityChanged } from "../sync/queueStaffContactSync";

export const scheduledSyncLecturesDaily = onSchedule(
  {
    ...scheduleOptions,
    schedule: "5 0 * * *",
  },
  async () => {
    await syncLecturesDaily();
  },
);

export const scheduledPollManagerNotices = onSchedule(
  {
    ...scheduleOptions,
    schedule: "every 10 minutes",
  },
  async () => {
    await pollManagerNotices();
  },
);

export const scheduledProcessWriteQueue = onSchedule(
  {
    ...scheduleOptions,
    schedule: "every 1 minutes",
  },
  async () => {
    await processWriteQueue();
  },
);

export const scheduledProcessContactSyncJobs = onSchedule(
  {
    ...scheduleOptions,
    schedule: "every 5 minutes",
  },
  async () => {
    await processContactSyncJobs();
  },
);

export const queueStaffContactSync = onDocumentWritten(
  {
    ...scheduleOptions,
    document: "staffs/{staffId}",
  },
  async (event) => {
    const before = event.data?.before.data() as StaffDoc | undefined;
    const after = event.data?.after.data() as StaffDoc | undefined;
    if (!after || !staffContactIdentityChanged(before, after)) return;
    await queueActiveStaffContactSync(after);
  },
);

export const scheduledAttendanceReminder = onSchedule(
  {
    ...scheduleOptions,
    schedule: "0 * * * *",
  },
  async () => {
    await sendAttendanceReminder();
  },
);

export const scheduledCreateParkingDiscountJobs = onSchedule(
  {
    ...scheduleOptions,
    schedule: "every 10 minutes",
  },
  async () => {
    await createDueParkingDiscountJobs({
      source: "core_parking_scheduler",
      requestedByUid: "scheduler",
      scanMode: "scheduled_window",
    });
  },
);

export const scheduledSyncDashboardDaily = onSchedule(
  {
    ...scheduleOptions,
    schedule: "20 0 * * *",
  },
  async () => {
    await syncDashboardFromSheets();
  },
);

export const syncDashboardNow = onRequest(longRequestOptions, async (request, response) => {
  if (request.method === "OPTIONS") {
    response.set("Access-Control-Allow-Origin", "*");
    response.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    response.set("Access-Control-Allow-Headers", "Content-Type,Authorization");
    response.status(204).send("");
    return;
  }
  try {
    const result = await syncDashboardFromSheets();
    response.set("Access-Control-Allow-Origin", "*");
    response.status(200).json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("syncDashboardNow failed", { message });
    response.set("Access-Control-Allow-Origin", "*");
    response.status(500).json({ ok: false, error: message });
  }
});

export const adminSyncLecturesRange = onCall(longCallableOptions, async (request) => {
  try {
    const staff = await requireStaff(request);
    requireManager(staff);
    const startDate = String(request.data?.startDate || "");
    const endDate = String(request.data?.endDate || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      throw new HttpsError("invalid-argument", "startDate/endDate가 필요합니다");
    }
    const lecturesResult = await syncLecturesRange({ studioId: staff.studioId, startDate, endDate });
    let dashboardResult: Awaited<ReturnType<typeof syncDashboardFromSheets>> | null = null;
    let dashboardError = "";
    try {
      dashboardResult = await syncDashboardFromSheets();
      if (dashboardResult.warning) dashboardError = dashboardResult.warning;
    } catch (dashboardErr) {
      dashboardError = dashboardErr instanceof Error ? dashboardErr.message : String(dashboardErr);
      logger.warn("adminSyncLecturesRange dashboard sync failed", { dashboardError });
    }
    return { ...lecturesResult, dashboard: dashboardResult, dashboardError };
  } catch (err) {
    logger.error("adminSyncLecturesRange failed", err);
    throw toHttpsError(err);
  }
});

export const adminSyncManagerStaffs = onCall(callableOptions, async (request) => {
  try {
    const staff = await requireStaff(request);
    requireManager(staff);
    return await syncManagerStaffs({ studioId: staff.studioId, managerStaffId: staff.staffId });
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const adminPollManagerNotices = onCall(callableOptions, async (request) => {
  try {
    const staff = await requireStaff(request);
    requireManager(staff);
    return await pollManagerNotices({ studioId: staff.studioId });
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const processAdminSyncRequest = onDocumentCreated(
  {
    ...scheduleOptions,
    document: "adminSyncRequests/{requestId}",
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const ref = snap.ref;
    const data = snap.data() as {
      requestId?: string;
      requestMode?: string;
      studioId?: string;
      startDate?: string;
      endDate?: string;
      createdByUid?: string;
      status?: string;
    };
    if (data.requestMode === "emergency_excel") {
      logger.info("processAdminSyncRequest skipped emergency Excel request for Mac mini runner", {
        requestId: event.params.requestId,
      });
      return;
    }
    const startDate = String(data.startDate || "");
    const endDate = String(data.endDate || "");
    try {
      await ref.set({ status: "running", startedAt: nowTimestamp(), lastError: null }, { merge: true });
      if (data.status !== "pending") throw new Error("이미 처리된 동기화 요청입니다");
      if (!data.createdByUid) throw new Error("요청자 정보가 없습니다");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        throw new Error("startDate/endDate가 필요합니다");
      }
      const staff = await getStaffByUid(data.createdByUid);
      if (!staff || !staff.active || !isManagerRole(staff.role)) throw new Error("운영자 권한이 필요합니다");
      const studioId = String(data.studioId || staff.studioId);
      let noticeError = "";
      let dashboardError = "";
      try {
        await pollManagerNotices({ studioId });
      } catch (err) {
        noticeError = err instanceof Error ? err.message : String(err);
        logger.warn("processAdminSyncRequest notice sync failed", { requestId: event.params.requestId, noticeError });
      }
      const lecturesResult = await syncLecturesRange({ studioId, startDate, endDate });
      try {
        const dashboardResult = await syncDashboardFromSheets();
        if (dashboardResult.warning) dashboardError = dashboardResult.warning;
      } catch (err) {
        dashboardError = err instanceof Error ? err.message : String(err);
        logger.warn("processAdminSyncRequest dashboard sync failed", {
          requestId: event.params.requestId,
          dashboardError,
        });
      }
      await ref.set(
        {
          status: "success",
          completedAt: nowTimestamp(),
          result: { ...lecturesResult, noticeError, dashboardError },
          lastError: null,
        },
        { merge: true },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("processAdminSyncRequest failed", { requestId: event.params.requestId, message });
      await ref.set(
        {
          status: "error",
          completedAt: nowTimestamp(),
          lastError: message,
        },
        { merge: true },
      );
    }
  },
);
