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
import { googleDwdServiceAccountJson, privateSurveyWebhookSecret } from "../config/secrets";
import {
  iparkingAccountPoolJson,
  iparkingLoginId,
  iparkingLoginPassword,
  iparkingSubLoginId,
  iparkingSubLoginPassword,
} from "../parking/iparkingClient";
import {
  getParkingDashboardHandler,
  registerParkingVehicleHandler,
  removeParkingVehicleHandler,
  runParkingAutoApplyNowHandler,
} from "../parking/parkingOperations";
import {
  getInstructorLessonRegistrationDashboardHandler,
  operatorCreateInstructorLessonRegistrationHandler,
} from "../instructorLessonRegistration/instructorLessonRegistration";
import { recommendedMealSurveyApiHandler } from "../mealPlan/recommendedMealSurvey";
import {
  generateRecommendedMealProgramDraftForSubmittedResponse,
  generateRecommendedMealProgramDraftHandler,
  getRecommendedMealProgramReviewHandler,
  recommendedMealPlanApiHandler,
  saveRecommendedMealProgramDraftHandler,
} from "../mealPlan/recommendedMealProgram";
import { processParkingDiscountJobSnapshot } from "../parking/processParkingDiscountJob";
import { instructorLessonParkingPreRegistrationApiHandler } from "../parking/instructorLessonParkingPreRegistration";
import {
  callableOptions,
  publicRequestOptions,
  recommendedMealCallableOptions,
  recommendedMealEventOptions,
} from "../runtime/functionOptions";
import {
  getRefundMemberTicketsHandler,
  previewRefundHandler,
  queueRefundStudioMateSmsHandler,
  sendRefundAgreementHandler,
} from "../refund/refundOperations";
import { requireManager, requireStaff } from "../security/authGuards";
import {
  adjustInstructorEvaluationEssayScoreHandler,
  getInstructorEvaluationQuizHandler,
  instructorApplicantEvaluationApiHandler,
  submitInstructorEvaluationQuizHandler,
} from "../staffEvaluation/instructorEvaluationQuiz";
import { toHttpsError } from "../utils/errors";
import {
  getVideoWatchDashboardHandler,
  videoWatchEventApiHandler,
} from "../videoAnalytics/videoWatchAnalytics";

const parkingDiscountJobOptions = {
  region: REGION,
  document: "parkingDiscountJobs/{jobId}",
  secrets: [
    googleDwdServiceAccountJson,
    iparkingAccountPoolJson,
    iparkingLoginId,
    iparkingLoginPassword,
    iparkingSubLoginId,
    iparkingSubLoginPassword,
  ],
  timeoutSeconds: 60,
  memory: "256MiB" as const,
};

const instructorLessonParkingRequestOptions = {
  ...publicRequestOptions,
  secrets: [privateSurveyWebhookSecret],
};

const videoWatchRequestOptions = {
  ...publicRequestOptions,
  maxInstances: 3,
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

export const removeParkingVehicle = onCall(callableOptions, async (request) => {
  try {
    return await removeParkingVehicleHandler(request);
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

export const instructorApplicantEvaluationApi = onRequest(
  publicRequestOptions,
  instructorApplicantEvaluationApiHandler,
);

export const recommendedMealSurveyApi = onRequest(publicRequestOptions, recommendedMealSurveyApiHandler);

export const recommendedMealPlanApi = onRequest(publicRequestOptions, recommendedMealPlanApiHandler);

export const instructorLessonParkingPreRegistrationApi = onRequest(
  instructorLessonParkingRequestOptions,
  instructorLessonParkingPreRegistrationApiHandler,
);

export const videoWatchEventApi = onRequest(videoWatchRequestOptions, videoWatchEventApiHandler);

export const getVideoWatchDashboard = onCall(callableOptions, async (request) => {
  try {
    const staff = await requireStaff(request);
    requireManager(staff);
    return await getVideoWatchDashboardHandler(request);
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const getRecommendedMealProgramReview = onCall(callableOptions, async (request) => {
  try {
    const staff = await requireStaff(request);
    requireManager(staff);
    return await getRecommendedMealProgramReviewHandler(request, staff);
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const generateRecommendedMealProgramDraft = onCall(recommendedMealCallableOptions, async (request) => {
  try {
    const staff = await requireStaff(request);
    requireManager(staff);
    return await generateRecommendedMealProgramDraftHandler(request, staff);
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const saveRecommendedMealProgramDraft = onCall(callableOptions, async (request) => {
  try {
    const staff = await requireStaff(request);
    requireManager(staff);
    return await saveRecommendedMealProgramDraftHandler(request, staff);
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const generateRecommendedMealDraftOnSurveySubmitted = onDocumentCreated(
  {
    ...recommendedMealEventOptions,
    document: "recommendedMealProgramResponses/{responseId}",
  },
  async (event) => {
    const response = event.data?.data();
    if (!response) return;
    await generateRecommendedMealProgramDraftForSubmittedResponse(event.params.responseId, response);
  },
);

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

export const getRefundMemberTickets = onCall(callableOptions, async (request) => {
  try {
    return await getRefundMemberTicketsHandler(request);
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const previewRefund = onCall(callableOptions, async (request) => {
  try {
    return await previewRefundHandler(request);
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const sendRefundAgreement = onCall(callableOptions, async (request) => {
  try {
    return await sendRefundAgreementHandler(request);
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const queueRefundStudioMateSms = onCall(callableOptions, async (request) => {
  try {
    return await queueRefundStudioMateSmsHandler(request);
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const getInstructorLessonRegistrationDashboard = onCall(callableOptions, async (request) => {
  try {
    return await getInstructorLessonRegistrationDashboardHandler(request);
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const operatorCreateInstructorLessonRegistration = onCall(callableOptions, async (request) => {
  try {
    return await operatorCreateInstructorLessonRegistrationHandler(request);
  } catch (err) {
    throw toHttpsError(err);
  }
});
