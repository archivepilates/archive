import { onRequest } from "firebase-functions/v2/https";
import { onDocumentCreated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { receiveInBodyWebhookHandler } from "../inbody/inbodyWebhook";
import {
  createAndSendTomorrowPrivateLessonCharts,
  generatePendingPrivateLessonChartReports,
  notionPrivateLessonReportWebhookHandler,
  privateLessonChartApiHandler,
  privateLessonReportViewHandler,
  reconcileCurrentMonthPrivateLessonCharts,
} from "../privateLessonChart/privateLessonChart";
import {
  syncPrivateLessonSessionOnRecordWrite,
  syncPrivateLessonSessionOnRequestWrite,
} from "../privateLessonChart/privateLessonSession";
import {
  ingestPrivateSurveyResponseHandler,
  processDueStaffSurveyAlimtalks,
  processMissingSurveySubmissionAlerts,
  processPrivateSurveyIntakeHandler,
  privateSurveyResponseViewHandler,
  syncPrivateSurveyNotionBackfill,
  syncPrivateSurveyResponsesFromSheet,
} from "../privateSurvey/privateSurveyResponse";
import {
  memberSignupContractHandler,
  purgeUnsignedDiscardedMemberSignupContracts,
} from "../memberSignup/memberSignupContract";
import { onsiteWelcomeRequestHandler } from "../memberSignup/onsiteWelcomeRequest";
import { methodCueCardReviewHandler } from "../method/methodCueCardReview";
import {
  privateLessonChartRequestOptions,
  privateLessonChartScheduleOptions,
  privateSurveyIngestOptions,
  privateSurveyIntakeOptions,
  publicDriveRequestOptions,
  publicRequestOptions,
  publicSolapiRequestOptions,
  scheduleOptions,
} from "../runtime/functionOptions";
import { redirectShortLinkHandler } from "../utils/shortLinks";

export const scheduledSyncPrivateSurveyResponses = onSchedule(
  {
    ...scheduleOptions,
    schedule: "every 10 minutes",
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
    await processDueStaffSurveyAlimtalks();
  },
);

export const scheduledProcessMissingSurveySubmissionAlerts = onSchedule(
  {
    ...scheduleOptions,
    schedule: "every 60 minutes",
  },
  async () => {
    await processMissingSurveySubmissionAlerts();
  },
);

export const scheduledSyncPrivateSurveyNotion = onSchedule(
  {
    ...privateSurveyIntakeOptions,
    schedule: "0 6,14,22 * * *",
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

export const scheduledReconcileCurrentMonthPrivateLessonCharts = onSchedule(
  {
    ...privateLessonChartScheduleOptions,
    schedule: "30 23 * * *",
  },
  async () => {
    await reconcileCurrentMonthPrivateLessonCharts();
  },
);

export const scheduledGeneratePrivateLessonChartReports = onSchedule(
  {
    ...privateLessonChartScheduleOptions,
    schedule: "every 60 minutes",
  },
  async () => {
    await generatePendingPrivateLessonChartReports();
  },
);

export const scheduledPurgeDiscardedMemberSignupContracts = onSchedule(
  {
    ...privateSurveyIntakeOptions,
    schedule: "20 4 * * *",
  },
  async () => {
    await purgeUnsignedDiscardedMemberSignupContracts();
  },
);

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

export const memberSignupContract = onRequest(publicDriveRequestOptions, memberSignupContractHandler);

export const onsiteWelcomeRequest = onRequest(publicSolapiRequestOptions, onsiteWelcomeRequestHandler);

export const methodCueCardReview = onRequest(publicDriveRequestOptions, methodCueCardReviewHandler);

export const notionPrivateLessonReportWebhook = onRequest(
  privateLessonChartRequestOptions,
  notionPrivateLessonReportWebhookHandler,
);

export const redirectShortLink = onRequest(publicRequestOptions, redirectShortLinkHandler);

export const processPrivateSurveyIntake = onDocumentCreated(
  {
    ...privateSurveyIntakeOptions,
    document: "privateSurveyIntakes/{intakeId}",
  },
  processPrivateSurveyIntakeHandler,
);

export const syncPrivateLessonSessionFromRequest = onDocumentWritten(
  {
    ...privateSurveyIntakeOptions,
    document: "privateLessonChartRequests/{requestId}",
  },
  syncPrivateLessonSessionOnRequestWrite,
);

export const syncPrivateLessonSessionFromRecord = onDocumentWritten(
  {
    ...privateSurveyIntakeOptions,
    document: "privateLessonChartRecords/{recordId}",
  },
  syncPrivateLessonSessionOnRecordWrite,
);
