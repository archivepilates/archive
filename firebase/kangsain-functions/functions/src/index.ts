import "./config/firebase";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { REGION, TIMEZONE } from "./config/constants";
import { allSecrets } from "./config/secrets";
import { toHttpsError } from "./utils/errors";
import { syncLecturesDaily } from "./sync/syncLecturesDaily";
import { syncLecturesRange } from "./sync/syncLecturesRange";
import { pollManagerNotices } from "./sync/pollManagerNotices";
import { processWriteQueue } from "./queue/processWriteQueue";
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
import { requireStaff, requireManager } from "./security/authGuards";
import { syncManagerStaffs } from "./sync/syncManagerStaffs";

const callableOptions = { region: REGION, secrets: allSecrets };
const longCallableOptions = { ...callableOptions, timeoutSeconds: 540, memory: "512MiB" as const };
const scheduleOptions = {
  region: REGION,
  timeZone: TIMEZONE,
  secrets: allSecrets,
  timeoutSeconds: 540,
  memory: "512MiB" as const,
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

export const scheduledAttendanceReminder = onSchedule(
  {
    ...scheduleOptions,
    schedule: "0 * * * *",
  },
  async () => {
    await sendAttendanceReminder();
  },
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
    return await syncLecturesRange({ studioId: staff.studioId, startDate, endDate });
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
