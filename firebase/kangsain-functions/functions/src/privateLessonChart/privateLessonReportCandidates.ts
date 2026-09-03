import { db } from "../config/firebase";
import { refs } from "../firestore/refs";
import type { AlimtalkCandidateDoc } from "../types/models";
import { nowTimestamp } from "../utils/date";

export async function invalidatePendingPrivateLessonReportCandidates(
  recordId: string,
  lastError: string,
): Promise<number> {
  if (!recordId) return 0;
  const [legacySnap, revisionSnap] = await Promise.all([
    refs.alimtalkCandidate(`private_lesson_report_${recordId}`).get(),
    refs.alimtalkCandidates().where("sourceActionKey", "==", recordId).limit(50).get(),
  ]);
  const candidates = new Map<string, AlimtalkCandidateDoc>();
  if (legacySnap.data()) candidates.set(legacySnap.id, legacySnap.data()!);
  for (const doc of revisionSnap.docs) candidates.set(doc.id, doc.data());
  const mutable = [...candidates.entries()].filter(([, candidate]) =>
    ["candidate", "queued", "failed"].includes(String(candidate.status || "")),
  );
  if (!mutable.length) return 0;
  const batch = db.batch();
  const now = nowTimestamp();
  for (const [candidateId] of mutable) {
    batch.set(
      refs.alimtalkCandidate(candidateId),
      {
        status: "skipped",
        reasonCode: "private_report_changed_before_send",
        lastError,
        updatedAt: now,
      },
      { merge: true },
    );
  }
  await batch.commit();
  return mutable.length;
}
