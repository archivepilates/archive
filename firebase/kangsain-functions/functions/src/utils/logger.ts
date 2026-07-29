import { logger } from "firebase-functions";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../config/firebase";
import { nowTimestamp } from "./date";

export async function logApiCall(entry: {
  studioId: string;
  service: "studiomate" | "manager";
  endpoint: string;
  requestId: string;
  status: "success" | "failed";
  httpStatus?: number;
  durationMs: number;
  relatedJobId?: string;
  errorMessage?: string;
}): Promise<void> {
  logger.info("external api call", entry);
  const createdAt = nowTimestamp();
  const retentionDays = entry.status === "failed" ? 180 : 30;
  await db.collection("apiLogs").add({
    ...entry,
    createdAt,
    expireAt: Timestamp.fromMillis(createdAt.toMillis() + retentionDays * 24 * 60 * 60 * 1000),
  });
}
