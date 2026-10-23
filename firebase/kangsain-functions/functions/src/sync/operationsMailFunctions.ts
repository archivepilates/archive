import { logger } from "firebase-functions";
import { onMessagePublished } from "firebase-functions/v2/pubsub";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { REGION } from "../config/constants";
import { db } from "../config/firebase";
import { googleDwdServiceAccountJson } from "../config/secrets";
import { OPS_MAIL } from "./operationsMailPolicy";
import { OperationsMailGmailClient, parseOperationsMailPush, runOperationsMailIngress } from "./operationsMailIngress";

const options = {
  region: REGION, secrets: [googleDwdServiceAccountJson], memory: "256MiB" as const,
  timeoutSeconds: 120, maxInstances: 1, concurrency: 1,
};

export const receiveOperationsMailPush = onMessagePublished({ ...options, topic: OPS_MAIL.topic.split("/").pop()!, retry: true }, async event => {
  let push: unknown;
  try { push = event.data.message.json; }
  catch { logger.warn("operations_mail_push_invalid_json"); return; }
  if (!parseOperationsMailPush(push)) { logger.warn("operations_mail_push_scope_rejected"); return; }
  const result = await runOperationsMailIngress(db, new OperationsMailGmailClient(), { source: "push", push });
  logger.info("operations_mail_push_processed", result);
});

// One maintenance schedule handles missed notifications and watch renewal together.
export const scheduledMaintainOperationsMail = onSchedule({ ...options, schedule: "every 5 minutes", timeZone: "Asia/Seoul" }, async () => {
  const result = await runOperationsMailIngress(db, new OperationsMailGmailClient(), { source: "maintenance" });
  logger.info("operations_mail_maintenance_processed", result);
});
