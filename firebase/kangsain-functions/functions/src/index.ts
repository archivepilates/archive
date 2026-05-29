import "./config/firebase";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { REGION, TIMEZONE } from "./config/constants";
import { allSecrets, notionToken } from "./config/secrets";
import { toHttpsError } from "./utils/errors";
import { syncLecturesDaily } from "./sync/syncLecturesDaily";
import { syncLecturesRange } from "./sync/syncLecturesRange";
import { pollManagerNotices } from "./sync/pollManagerNotices";
import { processWriteQueue } from "./queue/processWriteQueue";
import { processContactSyncJobs } from "./sync/processContactSyncJobs";
import { getInstructorHomeHandler } from "./callable/getInstructorHome";
import { submitBookingAttendanceHandler } from "./callable/submitBookingAttendance";
import { submitMemberMemoHandler } from "./callable/submitMemberMemo";
import { getMemberMemoHistoryHandler } from "./callable/getMemberMemoHistory";
import { searchMembersHandler } from "./callable/searchMembers";
import { registerFcmTokenHandler } from "./callable/registerFcmToken";
import {
  adminIssueStaffTempCodeHandler,
  loginStaffWithPinHandler,
  setupStaffPinWithTempCodeHandler,
} from "./callable/staffPinAuth";
import { sendAttendanceReminder } from "./push/sendAttendanceReminder";
import { isManagerRole, requireStaff, requireManager } from "./security/authGuards";
import { syncManagerStaffs } from "./sync/syncManagerStaffs";
import { syncDashboardFromSheets } from "./sync/syncDashboardFromSheets";
import { preSecurityRawMirror } from "./sync/preSecurityRawMirror";
import { processAlimtalkQueue } from "./alimtalk/processAlimtalkQueue";
import { approveAlimtalkBatchHandler } from "./alimtalk/approvalGate";
import { queueDailyAlimtalkCandidates } from "./alimtalk/queueDailyAlimtalk";
import { sendDailyAlimtalkReport } from "./alimtalk/sendDailyAlimtalkReport";
import { syncAlimtalkTemplateStatuses } from "./alimtalk/templateStatus";
import { getStaffByUid } from "./firestore/staffRepository";
import { nowTimestamp } from "./utils/date";
import { redirectShortLinkHandler } from "./utils/shortLinks";
import {
  ingestPrivateSurveyResponseHandler,
  processDueStaffSurveyAlimtalks,
  processMissingSurveySubmissionAlerts,
  processPrivateSurveyIntakeHandler,
  privateSurveyResponseViewHandler,
  syncPrivateSurveyNotionBackfill,
  syncPrivateSurveyResponsesFromSheet,
} from "./privateSurvey/privateSurveyResponse";
import {
  enqueueApprovedPrivateLessonReportAlimtalks,
  createAndSendTomorrowPrivateLessonCharts,
  enqueuePendingPrivateLessonChartGptTasks,
  notionPrivateLessonReportWebhookHandler,
  privateLessonChartApiHandler,
  privateLessonReportViewHandler,
} from "./privateLessonChart/privateLessonChart";
import { receiveInBodyWebhookHandler } from "./inbody/inbodyWebhook";

const callableOptions = { region: REGION, secrets: allSecrets, invoker: "public" as const };
const longCallableOptions = { ...callableOptions, timeoutSeconds: 540, memory: "512MiB" as const };
const longRequestOptions = {
  region: REGION,
  secrets: allSecrets,
  timeoutSeconds: 540,
  memory: "512MiB" as const,
};
const scheduleOptions = {
  region: REGION,
  timeZone: TIMEZONE,
  secrets: allSecrets,
  timeoutSeconds: 540,
  memory: "512MiB" as const,
};
const privateSurveyIngestOptions = {
  region: REGION,
  secrets: allSecrets,
  timeoutSeconds: 120,
  memory: "256MiB" as const,
};
const privateSurveyIntakeOptions = {
  ...scheduleOptions,
  secrets: [...allSecrets, notionToken],
};
const privateLessonChartRequestOptions = {
  region: REGION,
  secrets: [...allSecrets, notionToken],
  timeoutSeconds: 120,
  memory: "256MiB" as const,
  invoker: "public" as const,
};
const publicRequestOptions = {
  region: REGION,
  timeoutSeconds: 60,
  memory: "256MiB" as const,
  invoker: "public" as const,
};
const publicLongRequestOptions = {
  ...longRequestOptions,
};

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

export const scheduledProcessAlimtalkQueue = onSchedule(
  {
    ...scheduleOptions,
    schedule: "every 5 minutes",
  },
  async () => {
    await processAlimtalkQueue();
  },
);

export const scheduledQueueAndSendAlimtalkDaily = onSchedule(
  {
    ...scheduleOptions,
    schedule: "30 11 * * *",
  },
  async () => {
    await syncAlimtalkTemplateStatuses();
    const queueSummary = await queueDailyAlimtalkCandidates();
    const processSummary = { processed: 0, sent: 0, failed: 0 };
    for (let index = 0; index < 10; index += 1) {
      const result = await processAlimtalkQueue();
      processSummary.processed += result.processed;
      processSummary.sent += result.sent;
      processSummary.failed += result.failed;
      if (!result.processed) break;
    }
    try {
      await sendDailyAlimtalkReport({ queueSummary, processSummary });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("scheduledQueueAndSendAlimtalkDaily report failed", { message });
    }
  },
);

export const scheduledSyncAlimtalkTemplateStatuses = onSchedule(
  {
    ...scheduleOptions,
    schedule: "0 10 * * *",
  },
  async () => {
    await syncAlimtalkTemplateStatuses();
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

export const scheduledSyncDashboardDaily = onSchedule(
  {
    ...scheduleOptions,
    schedule: "20 0 * * *",
  },
  async () => {
    await syncDashboardFromSheets();
  },
);

export const scheduledSyncPrivateSurveyResponses = onSchedule(
  {
    ...scheduleOptions,
    schedule: "every 5 minutes",
  },
  async () => {
    await syncPrivateSurveyResponsesFromSheet();
  },
);

export const scheduledProcessStaffSurveyAlimtalks = onSchedule(
  {
    ...scheduleOptions,
    schedule: "every 10 minutes",
  },
  async () => {
    await processMissingSurveySubmissionAlerts();
    await processDueStaffSurveyAlimtalks();
  },
);

export const scheduledSyncPrivateSurveyNotion = onSchedule(
  {
    ...privateSurveyIntakeOptions,
    schedule: "every 30 minutes",
  },
  async () => {
    await syncPrivateSurveyNotionBackfill();
  },
);

export const scheduledCreatePrivateLessonChartRequests = onSchedule(
  {
    ...privateSurveyIntakeOptions,
    schedule: "0 18 * * *",
  },
  async () => {
    await createAndSendTomorrowPrivateLessonCharts();
  },
);

export const scheduledEnqueuePrivateLessonChartGptTasks = onSchedule(
  {
    ...privateSurveyIntakeOptions,
    schedule: "every 10 minutes",
  },
  async () => {
    await enqueuePendingPrivateLessonChartGptTasks();
  },
);

export const scheduledEnqueuePrivateLessonReportAlimtalks = onSchedule(
  {
    ...privateSurveyIntakeOptions,
    schedule: "10 9,15,21 * * *",
  },
  async () => {
    await enqueueApprovedPrivateLessonReportAlimtalks();
  },
);

export const scheduledPreSecurityRawMirror = onSchedule(
  {
    ...scheduleOptions,
    schedule: "20 12 12 5 *",
  },
  async () => {
    await preSecurityRawMirror();
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

function isInBodyWebhookRequest(request: any): boolean {
  const path = String(request.path || request.originalUrl || request.url || "");
  return path.includes("/api/inbody/webhook") || Boolean(request.get?.("x-archive-inbody-secret"));
}

export const ingestPrivateSurveyResponse = onRequest(privateSurveyIngestOptions, async (request, response) => {
  if (isInBodyWebhookRequest(request)) {
    await receiveInBodyWebhookHandler(request, response);
    return;
  }
  await ingestPrivateSurveyResponseHandler(request, response);
});

export const privateSurveyResponseView = onRequest(publicRequestOptions, privateSurveyResponseViewHandler);

export const privateLessonChartApi = onRequest(privateLessonChartRequestOptions, privateLessonChartApiHandler);

export const privateLessonReportView = onRequest(publicRequestOptions, privateLessonReportViewHandler);

export const notionPrivateLessonReportWebhook = onRequest(
  privateLessonChartRequestOptions,
  notionPrivateLessonReportWebhookHandler,
);

export const redirectShortLink = onRequest(publicRequestOptions, redirectShortLinkHandler);

export const approveAlimtalkBatch = onRequest(publicLongRequestOptions, approveAlimtalkBatchHandler);

export const processPrivateSurveyIntake = onDocumentCreated(
  {
    ...privateSurveyIntakeOptions,
    document: "privateSurveyIntakes/{intakeId}",
  },
  processPrivateSurveyIntakeHandler,
);

export const getInstructorHome = onCall(callableOptions, async (request) => {
  try {
    return await getInstructorHomeHandler(request);
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const loginStaffWithPin = onCall(callableOptions, async (request) => {
  try {
    return await loginStaffWithPinHandler(request);
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const setupStaffPinWithTempCode = onCall(callableOptions, async (request) => {
  try {
    return await setupStaffPinWithTempCodeHandler(request);
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const submitBookingAttendance = onCall(callableOptions, async (request) => {
  try {
    return await submitBookingAttendanceHandler(request);
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const submitMemberMemo = onCall(callableOptions, async (request) => {
  try {
    return await submitMemberMemoHandler(request);
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const getMemberMemoHistory = onCall(callableOptions, async (request) => {
  try {
    return await getMemberMemoHistoryHandler(request);
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const searchMembers = onCall(callableOptions, async (request) => {
  try {
    return await searchMembersHandler(request);
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const registerFcmToken = onCall(callableOptions, async (request) => {
  try {
    return await registerFcmTokenHandler(request);
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const adminIssueStaffTempCode = onCall(callableOptions, async (request) => {
  try {
    const staff = await requireStaff(request);
    return await adminIssueStaffTempCodeHandler(request, staff);
  } catch (err) {
    throw toHttpsError(err);
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
