import { nowTimestamp } from "../utils/date";
import type { ConsultationDoc } from "../types/models";
import { refs } from "./refs";

export async function upsertConsultationIfChanged(consultation: ConsultationDoc): Promise<boolean> {
  const ref = refs.consultation(consultation.consultationId);
  const current = await ref.get();
  const data = current.data();
  if (
    current.exists &&
    data?.sourceHash === consultation.sourceHash &&
    data.memberId === consultation.memberId &&
    data.memberName === consultation.memberName &&
    data.memberPhone === consultation.memberPhone &&
    data.status === consultation.status &&
    arrayEqual(data.staffIds, consultation.staffIds) &&
    arrayEqual(data.staffNames, consultation.staffNames)
  ) {
    return false;
  }
  await ref.set(consultation, { merge: true });
  return true;
}

export async function markMissingConsultationsDeleted(input: {
  studioId: string;
  date: string;
  activeConsultationIds: Set<string>;
}): Promise<string[]> {
  const snap = await refs
    .consultations()
    .where("studioId", "==", input.studioId)
    .where("date", "==", input.date)
    .get();
  const missing = snap.docs.filter((doc) => {
    const consultation = doc.data();
    return consultation.status !== "deleted" && !input.activeConsultationIds.has(consultation.consultationId);
  });
  if (!missing.length) return [];
  const batch = refs.consultations().firestore.batch();
  missing.forEach((doc) => {
    const consultation = doc.data();
    batch.set(
      doc.ref,
      {
        status: "deleted",
        sourceHash: `deleted_${consultation.sourceHash}`,
        updatedAt: nowTimestamp(),
        syncedAt: nowTimestamp(),
      },
      { merge: true },
    );
  });
  await batch.commit();
  return missing.map((doc) => doc.data().consultationId);
}

function arrayEqual(a: unknown, b: unknown): boolean {
  const left = Array.isArray(a) ? a : [];
  const right = Array.isArray(b) ? b : [];
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
