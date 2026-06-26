import { onRequest } from "firebase-functions/v2/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { receiveInBodyWebhookHandler } from "../inbody/inbodyWebhook";
import {
  enqueueApprovedPrivateLessonReportAlimtalks,
  createAndSendTomorrowPrivateLessonCharts,
  generatePendingPrivateLessonChartReports,
  notionPrivateLessonReportWebhookHandler,
  privateLessonChartApiHandler,
  privateLessonReportViewHandler,
  reconcileCurrentMonthPrivateLessonCharts,
} from "../privateLessonChart/privateLessonChart";
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
  methodCueCardReviewOptions,
  privateLessonChartRequestOptions,
  privateLessonChartScheduleOptions,
  privateSurveyIngestOptions,
  privateSurveyIntakeOptions,
  publicRequestOptions,
  scheduleOptions,
} from "../runtime/functionOptions";
import { redirectShortLinkHandler } from "../utils/shortLinks";

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
    schedule: "every 10 minutes",
  },
  async () => {
    await generatePendingPrivateLessonChartReports();
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

export const memberSignupContract = onRequest(publicRequestOptions, memberSignupContractHandler);

export const onsiteWelcomeRequest = onRequest(publicRequestOptions, onsiteWelcomeRequestHandler);

export const methodCueCardReview = onRequest(methodCueCardReviewOptions, methodCueCardReviewHandler);

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
