import { logger } from "firebase-functions";
import { onCall, onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { approveAlimtalkBatchHandler } from "../alimtalk/approvalGate";
import { processAlimtalkQueue } from "../alimtalk/processAlimtalkQueue";
import { operatorSendPricingInquiryAlimtalkHandler } from "../alimtalk/pricingInquiryAlimtalk";
import { operatorSendRecommendedMealProgramAlimtalkHandler } from "../mealPlan/recommendedMealAlimtalk";
import { operatorPublishRecommendedMealPlanHandler } from "../mealPlan/recommendedMealReportAlimtalk";
import { queueDailyAlimtalkCandidates, queueReservationOpenAlimtalkCandidates } from "../alimtalk/queueDailyAlimtalk";
import { sendDailyAlimtalkReport } from "../alimtalk/sendDailyAlimtalkReport";
import { syncAlimtalkTemplateStatuses } from "../alimtalk/templateStatus";
import { notionToken } from "../config/secrets";
import { callableOptions, publicLongRequestOptions, scheduleOptions } from "../runtime/functionOptions";
import { requireManager, requireStaff } from "../security/authGuards";
import { toHttpsError } from "../utils/errors";

const alimtalkQueueScheduleOptions = {
  ...scheduleOptions,
  secrets: [...scheduleOptions.secrets, notionToken],
};

const alimtalkBulkQueueScheduleOptions = {
  ...alimtalkQueueScheduleOptions,
  memory: "1GiB" as const,
};

const alimtalkQueueRequestOptions = {
  ...publicLongRequestOptions,
  secrets: [...publicLongRequestOptions.secrets, notionToken],
};

export const scheduledProcessAlimtalkQueue = onSchedule(
  {
    ...alimtalkQueueScheduleOptions,
    schedule: "every 5 minutes",
  },
  async () => {
    await processAlimtalkQueue();
  },
);

export const scheduledQueueAndSendAlimtalkDaily = onSchedule(
  {
    ...alimtalkBulkQueueScheduleOptions,
    schedule: "30 11 * * *",
  },
  async () => {
    await syncAlimtalkTemplateStatusesSafely("scheduledQueueAndSendAlimtalkDaily");
    const queueSummary = await queueDailyAlimtalkCandidates();
    const processSummary = { processed: 0, sent: 0, failed: 0, deferred: 0 };
    for (let index = 0; index < 10; index += 1) {
      const result = await processAlimtalkQueue();
      processSummary.processed += result.processed;
      processSummary.sent += result.sent;
      processSummary.failed += result.failed;
      processSummary.deferred += result.deferred;
      if (!result.processed || result.processed === result.deferred) break;
    }
    try {
      await sendDailyAlimtalkReport({ queueSummary, processSummary });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("scheduledQueueAndSendAlimtalkDaily report failed", { message });
    }
  },
);

export const scheduledQueueAndSendReservationOpenAlimtalk = onSchedule(
  {
    ...alimtalkBulkQueueScheduleOptions,
    schedule: "30 12 * * 1",
  },
  async () => {
    await syncAlimtalkTemplateStatusesSafely("scheduledQueueAndSendReservationOpenAlimtalk");
    const queueSummary = await queueReservationOpenAlimtalkCandidates();
    const processSummary = { processed: 0, sent: 0, failed: 0, deferred: 0 };
    for (let index = 0; index < 10; index += 1) {
      const result = await processAlimtalkQueue();
      processSummary.processed += result.processed;
      processSummary.sent += result.sent;
      processSummary.failed += result.failed;
      processSummary.deferred += result.deferred;
      if (!result.processed || result.processed === result.deferred) break;
    }
    try {
      await sendDailyAlimtalkReport({ queueSummary, processSummary });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("scheduledQueueAndSendReservationOpenAlimtalk report failed", { message });
    }
  },
);

export const scheduledSyncAlimtalkTemplateStatuses = onSchedule(
  {
    ...scheduleOptions,
    schedule: "0 10 * * *",
  },
  async () => {
    await syncAlimtalkTemplateStatusesSafely("scheduledSyncAlimtalkTemplateStatuses");
  },
);

export const approveAlimtalkBatch = onRequest(alimtalkQueueRequestOptions, approveAlimtalkBatchHandler);

export const operatorSendPricingInquiryAlimtalk = onCall(callableOptions, async (request) => {
  try {
    const staff = await requireStaff(request);
    requireManager(staff);
    return await operatorSendPricingInquiryAlimtalkHandler(request, staff);
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const operatorSendRecommendedMealProgramAlimtalk = onCall(callableOptions, async (request) => {
  try {
    const staff = await requireStaff(request);
    requireManager(staff);
    return await operatorSendRecommendedMealProgramAlimtalkHandler(request, staff);
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const operatorPublishRecommendedMealPlan = onCall(callableOptions, async (request) => {
  try {
    const staff = await requireStaff(request);
    requireManager(staff);
    return await operatorPublishRecommendedMealPlanHandler(request, staff);
  } catch (err) {
    throw toHttpsError(err);
  }
});

async function syncAlimtalkTemplateStatusesSafely(context: string): Promise<void> {
  try {
    await syncAlimtalkTemplateStatuses();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Alimtalk template status sync failed; continuing scheduled job", { context, message });
  }
}
