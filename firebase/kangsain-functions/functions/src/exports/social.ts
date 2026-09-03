import { logger } from "firebase-functions";
import { onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { REGION, TIMEZONE } from "../config/constants";
import { requireManager, requireStaff } from "../security/authGuards";
import { toHttpsError } from "../utils/errors";
import { instagramAccessToken, instagramUserId } from "../social/metaInstagramClient";
import {
  approveInstagramContentHandler,
  getInstagramContentDashboardHandler,
  holdInstagramContentHandler,
  publishDueInstagramContent,
  saveInstagramContentDraftHandler,
  syncInstagramInsights,
} from "../social/socialContentOperations";

const socialSecrets = [instagramAccessToken, instagramUserId];
const socialCallableOptions = {
  region: REGION,
  secrets: socialSecrets,
  invoker: "public" as const,
};
const socialScheduleOptions = {
  region: REGION,
  timeZone: TIMEZONE,
  secrets: socialSecrets,
  timeoutSeconds: 540,
  memory: "512MiB" as const,
};

export const getInstagramContentDashboard = onCall(socialCallableOptions, async (request) => {
  try {
    const staff = await requireStaff(request);
    requireManager(staff);
    return await getInstagramContentDashboardHandler(request, staff);
  } catch (error) {
    throw toHttpsError(error);
  }
});

export const saveInstagramContentDraft = onCall(socialCallableOptions, async (request) => {
  try {
    const staff = await requireStaff(request);
    requireManager(staff);
    return await saveInstagramContentDraftHandler(request, staff);
  } catch (error) {
    throw toHttpsError(error);
  }
});

export const approveInstagramContent = onCall(socialCallableOptions, async (request) => {
  try {
    const staff = await requireStaff(request);
    requireManager(staff);
    return await approveInstagramContentHandler(request, staff);
  } catch (error) {
    throw toHttpsError(error);
  }
});

export const holdInstagramContent = onCall(socialCallableOptions, async (request) => {
  try {
    const staff = await requireStaff(request);
    requireManager(staff);
    return await holdInstagramContentHandler(request, staff);
  } catch (error) {
    throw toHttpsError(error);
  }
});

export const scheduledPublishInstagramContent = onSchedule(
  {
    ...socialScheduleOptions,
    schedule: "every 10 minutes",
  },
  async () => {
    const result = await publishDueInstagramContent();
    logger.info("scheduledPublishInstagramContent complete", result);
  },
);

export const scheduledSyncInstagramInsights = onSchedule(
  {
    ...socialScheduleOptions,
    schedule: "20 8 * * *",
  },
  async () => {
    const result = await syncInstagramInsights();
    logger.info("scheduledSyncInstagramInsights complete", result);
  },
);
