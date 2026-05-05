import { logger } from "firebase-functions";
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
  await db.collection("apiLogs").add({
    ...entry,
    createdAt: nowTimestamp(),
  });
}
