import { logger } from "firebase-functions";
import { onCall, onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { approveAlimtalkBatchHandler } from "../alimtalk/approvalGate";
import { processAlimtalkQueue } from "../alimtalk/processAlimtalkQueue";
import { operatorSendPricingInquiryAlimtalkHandler } from "../alimtalk/pricingInquiryAlimtalk";
import { queueDailyAlimtalkCandidates, queueReservationOpenAlimtalkCandidates } from "../alimtalk/queueDailyAlimtalk";
import { sendDailyAlimtalkReport } from "../alimtalk/sendDailyAlimtalkReport";
import { syncAlimtalkTemplateStatuses } from "../alimtalk/templateStatus";
import { callableOptions, publicLongRequestOptions, scheduleOptions } from "../runtime/functionOptions";
import { requireManager, requireStaff } from "../security/authGuards";
import { toHttpsError } from "../utils/errors";

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

export const scheduledQueueAndSendReservationOpenAlimtalk = onSchedule(
  {
    ...scheduleOptions,
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

export const approveAlimtalkBatch = onRequest(publicLongRequestOptions, approveAlimtalkBatchHandler);

export const operatorSendPricingInquiryAlimtalk = onCall(callableOptions, async (request) => {
  try {
    const staff = await requireStaff(request);
    requireManager(staff);
    return await operatorSendPricingInquiryAlimtalkHandler(request, staff);
  } catch (err) {
    throw toHttpsError(err);
  }
});
