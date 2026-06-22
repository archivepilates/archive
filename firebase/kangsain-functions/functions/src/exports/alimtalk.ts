import { logger } from "firebase-functions";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { approveAlimtalkBatchHandler } from "../alimtalk/approvalGate";
import { pricingInquiryAlimtalkHandler } from "../alimtalk/pricingInquiryAlimtalk";
import { processAlimtalkQueue } from "../alimtalk/processAlimtalkQueue";
import { queueDailyAlimtalkCandidates, queueReservationOpenAlimtalkCandidates } from "../alimtalk/queueDailyAlimtalk";
import { sendDailyAlimtalkReport } from "../alimtalk/sendDailyAlimtalkReport";
import { syncAlimtalkTemplateStatuses } from "../alimtalk/templateStatus";
import { notionToken } from "../config/secrets";
import { publicLongRequestOptions, scheduleOptions } from "../runtime/functionOptions";

const alimtalkQueueScheduleOptions = {
  ...scheduleOptions,
  secrets: [...scheduleOptions.secrets, notionToken],
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
    ...alimtalkQueueScheduleOptions,
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

export const scheduledQueueAndSendReservationOpenAlimtalk = onSchedule(
  {
    ...alimtalkQueueScheduleOptions,
    schedule: "30 12 * * 1",
  },
  async () => {
    await syncAlimtalkTemplateStatuses();
    const queueSummary = await queueReservationOpenAlimtalkCandidates();
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
    await syncAlimtalkTemplateStatuses();
  },
);

export const approveAlimtalkBatch = onRequest(alimtalkQueueRequestOptions, approveAlimtalkBatchHandler);
export const pricingInquiryAlimtalk = onRequest(alimtalkQueueRequestOptions, pricingInquiryAlimtalkHandler);
