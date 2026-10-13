import { logger } from "firebase-functions";
import { onCall, onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { REGION, TIMEZONE } from "../config/constants";
import { requireManager, requireStaff } from "../security/authGuards";
import { toHttpsError } from "../utils/errors";
import { instagramAccessToken, instagramUserId } from "../social/metaInstagramClient";
import { db } from "../config/firebase";
import {
  REEL_APPROVAL_COLLECTION,
  reelApprovalHandler,
  validReelApproval,
  type ReelApproval,
} from "../social/youtubeReelApprovalGate";
import {
  approveInstagramContentHandler,
  getInstagramContentDashboardHandler,
  holdInstagramContentHandler,
  publishDueInstagramContent,
  saveInstagramContentDraftHandler,
  syncInstagramInsights,
} from "../social/socialContentOperations";

const socialSecrets = [instagramAccessToken, instagramUserId];

export const approveYoutubeReel = onRequest(
  { region: REGION, invoker: "public", timeoutSeconds: 30, memory: "256MiB", maxInstances: 2 },
  reelApprovalHandler({
    async get(id) {
      return (await db.collection(REEL_APPROVAL_COLLECTION).doc(id).get()).data() as ReelApproval | undefined;
    },
    async approve(id, token, expected) {
      const ref = db.collection(REEL_APPROVAL_COLLECTION).doc(id);
      return db.runTransaction(async (tx) => {
        const doc = (await tx.get(ref)).data() as ReelApproval | undefined;
        const now = Date.now();
        if (
          !validReelApproval(doc, id, token, now) ||
          !doc ||
          !["pending", "approved", "published"].includes(doc.status)
        )
          return undefined;
        for (const key of [
          "videoId",
          "channelId",
          "title",
          "contentHash",
          "fileSha256",
          "tokenHash",
          "expiresAt",
          "isTest",
        ] as const)
          if (doc[key] !== expected[key]) return undefined;
        if (doc.status !== "pending") return doc;
        const update = {
          status: "approved" as const,
          approvedAt: now,
          approvedBy: "email-button" as const,
          needsWorker: true,
        };
        tx.update(ref, update);
        return { ...doc, ...update };
      });
    },
  }),
);
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

export const saveInstagramContentDraft = onCall({ ...socialCallableOptions, secrets: [] }, async (request) => {
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

export const holdInstagramContent = onCall({ ...socialCallableOptions, secrets: [] }, async (request) => {
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
