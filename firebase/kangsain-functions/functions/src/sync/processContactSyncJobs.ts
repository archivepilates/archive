import { Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { db } from "../config/firebase";
import { refs } from "../firestore/refs";
import { getActiveStaffs } from "../firestore/staffRepository";
import { HomePeopleClient, normalizePhone } from "../google/peopleClient";
import type { ContactSyncJobDoc } from "../types/models";
import { nowTimestamp } from "../utils/date";
import { errorMessage } from "../utils/errors";
import { nextRetryAt } from "../queue/retryPolicy";
import { assertSingleExistingContact, chooseRunnableContactJobs } from "./contactJobSelection";
import {
  type ActiveStaffContactIndex,
  buildActiveStaffContactIndex,
  shouldPreserveExistingContactName,
  shouldSkipProtectedStaffContactJob,
} from "./protectedContactRules";

export async function processContactSyncJobs(): Promise<{ processed: number }> {
  const now = Timestamp.now();
  const due = await refs
    .contactSyncJobs()
    .where("target", "==", "home_archivepilates")
    .where("status", "in", ["pending", "retry"])
    .where("nextRunAt", "<=", now)
    .orderBy("nextRunAt", "asc")
    .limit(100)
    .get();

  const dueJobs: Array<{ job: ContactSyncJobDoc; nextRunAtMillis: number }> = [];
  let malformed = 0;

  for (const snap of due.docs) {
    const job = snap.data();
    const nextRunAtMillis = timestampMillis(job.nextRunAt);
    if (nextRunAtMillis === null) {
      malformed++;
      try {
        await failMalformedJob(snap.id, job, "contactSyncJobs job has missing or malformed nextRunAt");
      } catch (err) {
        logger.warn("Failed to mark malformed contact sync job", { jobId: snap.id, message: errorMessage(err) });
      }
      continue;
    }

    dueJobs.push({ job, nextRunAtMillis });
  }

  const runnableJobs = chooseRunnableContactJobs(dueJobs);

  if (!runnableJobs.length) {
    logger.info("processContactSyncJobs completed", { processed: 0, malformed });
    return { processed: 0 };
  }

  const client = new HomePeopleClient();
  const contactsByPhone = await client.listContactsByPhone();
  const activeStaffContactsByStudio = await loadActiveStaffContactsByStudio(runnableJobs);
  const seenPhones = new Set<string>();
  let processed = 0;

  for (const job of runnableJobs) {
    const claimed = await claimJob(job);
    if (!claimed) continue;
    const phoneKey = normalizePhone(claimed.memberPhone);
    if (seenPhones.has(phoneKey)) {
      await finishJob(claimed, { action: "skipped", resourceName: undefined });
      processed++;
      continue;
    }
    seenPhones.add(phoneKey);
    await processJob(claimed, client, contactsByPhone, activeStaffContactsByStudio.get(claimed.studioId));
    processed++;
  }

  logger.info("processContactSyncJobs completed", { processed, malformed });
  return { processed };
}

function timestampMillis(value: unknown): number | null {
  if (!(value instanceof Timestamp)) return null;
  try {
    return value.toMillis();
  } catch {
    return null;
  }
}

async function loadActiveStaffContactsByStudio(
  jobs: ContactSyncJobDoc[],
): Promise<Map<string, ActiveStaffContactIndex>> {
  const studioIds = [...new Set(jobs.map((job) => job.studioId).filter(Boolean))];
  const entries = await Promise.all(
    studioIds.map(
      async (studioId) => [studioId, buildActiveStaffContactIndex(await getActiveStaffs(studioId))] as const,
    ),
  );
  return new Map(entries);
}

async function failMalformedJob(jobId: string, job: ContactSyncJobDoc, message: string): Promise<void> {
  logger.warn("Skipping malformed contact sync job", { jobId, memberId: job.memberId, message });
  await refs.contactSyncJob(jobId).set(
    {
      status: "failed",
      lastError: message,
      updatedAt: nowTimestamp(),
    },
    { merge: true },
  );
  if (!job.memberId) return;
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
  activeStaffContacts?: ActiveStaffContactIndex,
): Promise<void> {
  try {
    const phoneKey = normalizePhone(job.memberPhone);
    const existing = contactsByPhone.get(phoneKey) || [];
    assertSingleExistingContact(existing.length);
    if (shouldSkipProtectedStaffContactJob(job, activeStaffContacts)) {
      await finishProtectedStaffJob(job, existing[0]?.resourceName);
      return;
    }
    if (job.sourceReason === "consultation_schedule" && shouldPreserveExistingConsultationContact(existing)) {
      await finishJob(job, { action: "skipped", resourceName: existing[0]?.resourceName });
      return;
    }
    const result = await client.upsertByPhone({
      existing,
      name: job.contactDisplayName || job.memberName,
      phone: job.memberPhone,
      memo: job.contactMemo,
    });
    await finishJob(job, result);
  } catch (err) {
    await failJob(job, err);
  }
}

async function finishProtectedStaffJob(job: ContactSyncJobDoc, resourceName?: string): Promise<void> {
  await refs.contactSyncJob(job.jobId).set(
    {
      status: "done",
      result: { action: "skipped", resourceName },
      lastError: null,
      updatedAt: nowTimestamp(),
    },
    { merge: true },
  );
  await refs.memberContactIndexDoc(job.memberId).set(
    {
      contactTargets: {
        archivepilates_gmail: "skipped",
        home_archivepilates: "skipped",
      },
      homeContactResourceName: resourceName || "",
      contactLastError: null,
      updatedAt: nowTimestamp(),
    },
    { merge: true },
  );
}

function shouldPreserveExistingConsultationContact(existing: Array<{ name: string }>): boolean {
  if (existing.length !== 1) return false;
  return shouldPreserveExistingContactName(existing[0].name);
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
