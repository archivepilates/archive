import { Timestamp, type CollectionReference } from "firebase-admin/firestore";

export function isSocialPublishJobDue(job: {
  status: string;
  nextRunAt: { toMillis(): number };
  updatedAt: { toMillis(): number };
}, now: number): boolean {
  if (job.status === "processing") return job.updatedAt.toMillis() < now - 30 * 60_000;
  return ["pending", "retry"].includes(job.status) && job.nextRunAt.toMillis() <= now;
}

export async function loadDueSocialPublishJobs(collection: CollectionReference, now: Timestamp) {
  const pending = await collection.where("status", "in", ["pending", "retry"])
    .where("nextRunAt", "<=", now).orderBy("nextRunAt", "asc").limit(30).get();
  const stale = await collection.where("status", "==", "processing")
    .where("updatedAt", "<", Timestamp.fromMillis(now.toMillis() - 30 * 60_000))
    .orderBy("updatedAt", "asc").limit(30).get();
  return [...pending.docs, ...stale.docs];
}
