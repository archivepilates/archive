import { onCall, onRequest } from "firebase-functions/v2/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { getInstructorHomeHandler } from "../callable/getInstructorHome";
import {
  getKioskParkingJobStatusHandler,
  lookupKioskCheckinHandler,
  submitKioskCheckinHandler,
} from "../callable/kioskCheckin";
import { getMemberMemoHistoryHandler } from "../callable/getMemberMemoHistory";
import { registerFcmTokenHandler } from "../callable/registerFcmToken";
import { searchMembersHandler } from "../callable/searchMembers";
import {
  adminIssueStaffTempCodeHandler,
  loginStaffWithPinHandler,
  setupStaffPinWithTempCodeHandler,
} from "../callable/staffPinAuth";
import { submitBookingAttendanceHandler } from "../callable/submitBookingAttendance";
import { submitMemberMemoHandler } from "../callable/submitMemberMemo";
import { REGION } from "../config/constants";
import {
  iparkingLoginId,
  iparkingLoginPassword,
  iparkingSubLoginId,
  iparkingSubLoginPassword,
} from "../parking/iparkingClient";
import {
  getParkingDashboardHandler,
  registerParkingVehicleHandler,
  runParkingAutoApplyNowHandler,
} from "../parking/parkingOperations";
import { processParkingDiscountJobSnapshot } from "../parking/processParkingDiscountJob";
import { callableOptions, publicRequestOptions } from "../runtime/functionOptions";
import { requireStaff } from "../security/authGuards";
import {
  adjustInstructorEvaluationEssayScoreHandler,
  getInstructorEvaluationQuizHandler,
  instructorApplicantEvaluationApiHandler,
  submitInstructorEvaluationQuizHandler,
} from "../staffEvaluation/instructorEvaluationQuiz";
import { toHttpsError } from "../utils/errors";

const parkingDiscountJobOptions = {
  region: REGION,
  document: "parkingDiscountJobs/{jobId}",
  secrets: [iparkingLoginId, iparkingLoginPassword, iparkingSubLoginId, iparkingSubLoginPassword],
  timeoutSeconds: 60,
  memory: "256MiB" as const,
};

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

export const lookupKioskCheckin = onCall(callableOptions, async (request) => {
  try {
    return await lookupKioskCheckinHandler(request);
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const submitKioskCheckin = onCall(callableOptions, async (request) => {
  try {
    return await submitKioskCheckinHandler(request);
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const getKioskParkingJobStatus = onCall(callableOptions, async (request) => {
  try {
    return await getKioskParkingJobStatusHandler(request);
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const registerParkingVehicle = onCall(callableOptions, async (request) => {
  try {
    return await registerParkingVehicleHandler(request);
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const getParkingDashboard = onCall(callableOptions, async (request) => {
  try {
    return await getParkingDashboardHandler(request);
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const runParkingAutoApplyNow = onCall(callableOptions, async (request) => {
  try {
    return await runParkingAutoApplyNowHandler(request);
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

export const getInstructorEvaluationQuiz = onCall(callableOptions, async (request) => {
  try {
    const staff = await requireStaff(request);
    return await getInstructorEvaluationQuizHandler(request, staff);
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const submitInstructorEvaluationQuiz = onCall(callableOptions, async (request) => {
  try {
    const staff = await requireStaff(request);
    return await submitInstructorEvaluationQuizHandler(request, staff);
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const adjustInstructorEvaluationEssayScore = onCall(callableOptions, async (request) => {
  try {
    const staff = await requireStaff(request);
    return await adjustInstructorEvaluationEssayScoreHandler(request, staff);
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const instructorApplicantEvaluationApi = onRequest(publicRequestOptions, instructorApplicantEvaluationApiHandler);

export const processParkingDiscountJob = onDocumentCreated(parkingDiscountJobOptions, async (event) => {
  const snap = event.data;
  if (!snap) return;
  await processParkingDiscountJobSnapshot(snap);
});

export const adminIssueStaffTempCode = onCall(callableOptions, async (request) => {
  try {
    const staff = await requireStaff(request);
    return await adminIssueStaffTempCodeHandler(request, staff);
  } catch (err) {
    throw toHttpsError(err);
  }
});
