import { Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { db } from "../config/firebase";
import { refs } from "../firestore/refs";
import { HomePeopleClient, normalizePhone } from "../google/peopleClient";
import type { ContactSyncJobDoc } from "../types/models";
import { nowTimestamp } from "../utils/date";
import { errorMessage } from "../utils/errors";
import { nextRetryAt } from "../queue/retryPolicy";

export async function processContactSyncJobs(): Promise<{ processed: number }> {
  const due = await refs
    .contactSyncJobs()
    .where("status", "in", ["pending", "retry"])
    .limit(50)
    .get();

  const dueJobs = due.docs
    .map((snap) => snap.data())
    .filter((job) => job.target === "home_archivepilates")
    .filter((job) => job.nextRunAt.toMillis() <= Timestamp.now().toMillis())
    .sort((a, b) => a.nextRunAt.toMillis() - b.nextRunAt.toMillis())
    .slice(0, 25);

  if (!dueJobs.length) {
    logger.info("processContactSyncJobs completed", { processed: 0 });
    return { processed: 0 };
  }

  const client = new HomePeopleClient();
  const contactsByPhone = await client.listContactsByPhone();
  const seenPhones = new Set<string>();
  let processed = 0;

  for (const job of dueJobs) {
    const claimed = await claimJob(job);
    if (!claimed) continue;
    const phoneKey = normalizePhone(claimed.memberPhone);
    if (seenPhones.has(phoneKey)) {
      await finishJob(claimed, { action: "skipped", resourceName: undefined });
      processed++;
      continue;
    }
    seenPhones.add(phoneKey);
    await processJob(claimed, client, contactsByPhone);
    processed++;
  }

  logger.info("processContactSyncJobs completed", { processed });
  return { processed };
}

async function claimJob(job: ContactSyncJobDoc): Promise<ContactSyncJobDoc | null> {
  const ref = refs.contactSyncJob(job.jobId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.data();
    if (!current || !["pending", "retry"].includes(current.status)) return null;
    const next = { ...current, status: "processing" as const, updatedAt: nowTimestamp() };
    tx.set(ref, next, { merge: true });
    return next;
  });
}

async function processJob(
  job: ContactSyncJobDoc,
  client: HomePeopleClient,
  contactsByPhone: Map<string, Parameters<HomePeopleClient["upsertByPhone"]>[0]["existing"]>,
): Promise<void> {
  try {
    const phoneKey = normalizePhone(job.memberPhone);
    const result = await client.upsertByPhone({
      existing: contactsByPhone.get(phoneKey) || [],
      name: job.memberName,
      phone: job.memberPhone,
    });
    await finishJob(job, result);
  } catch (err) {
    await failJob(job, err);
  }
}

async function finishJob(
  job: ContactSyncJobDoc,
  result: { action: "created" | "updated" | "skipped"; resourceName?: string },
): Promise<void> {
  await refs.contactSyncJob(job.jobId).set(
    {
      status: "done",
      result,
      lastError: null,
      updatedAt: nowTimestamp(),
    },
    { merge: true },
  );
  await refs.memberContactIndexDoc(job.memberId).set(
    {
      contactTargets: {
        archivepilates_gmail: "skipped",
        home_archivepilates: "synced",
      },
      homeContactResourceName: result.resourceName || "",
      contactLastError: null,
      contactUpdatedAt: nowTimestamp(),
      updatedAt: nowTimestamp(),
    },
    { merge: true },
  );
}

async function failJob(job: ContactSyncJobDoc, err: unknown): Promise<void> {
  const attempts = job.attempts + 1;
  const failed = attempts >= job.maxAttempts;
  const message = errorMessage(err);
  await refs.contactSyncJob(job.jobId).set(
    {
      status: failed ? "failed" : "retry",
      attempts,
      nextRunAt: failed ? job.nextRunAt : nextRetryAt(attempts),
      lastError: message,
      updatedAt: nowTimestamp(),
    },
    { merge: true },
  );
  if (failed) {
    await refs.memberContactIndexDoc(job.memberId).set(
      {
        contactTargets: {
          archivepilates_gmail: "skipped",
          home_archivepilates: "failed",
        },
        contactLastError: message,
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
  }
}
