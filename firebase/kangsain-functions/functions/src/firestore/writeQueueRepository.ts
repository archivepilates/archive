import type { WriteQueueJobDoc } from "../types/models";
import { refs } from "./refs";
import { Timestamp } from "firebase-admin/firestore";

export async function enqueueWriteJob(job: WriteQueueJobDoc): Promise<void> {
  await refs.writeJob(job.jobId).set(job, { merge: true });
}

export async function getDueWriteJobs(limit: number): Promise<WriteQueueJobDoc[]> {
  const snap = await refs
    .writeQueue()
    .where("status", "in", ["pending", "retry"])
    .where("nextRunAt", "<=", Timestamp.now())
    .orderBy("nextRunAt", "asc")
    .limit(limit)
    .get();
  return snap.docs.map((doc) => doc.data());
}
