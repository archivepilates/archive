import { nowTimestamp } from "../utils/date";
import type { LectureDoc } from "../types/models";
import { refs } from "./refs";

export async function upsertLectureIfChanged(lecture: LectureDoc): Promise<boolean> {
  const ref = refs.lecture(lecture.lectureId);
  const current = await ref.get();
  if (current.exists && current.data()?.sourceHash === lecture.sourceHash) return false;
  await ref.set(lecture, { merge: true });
  return true;
}

export async function getLecture(lectureId: string): Promise<LectureDoc | null> {
  const snap = await refs.lecture(lectureId).get();
  return snap.exists ? (snap.data() ?? null) : null;
}

export async function getLecturesByStaffDate(studioId: string, staffId: string, date: string): Promise<LectureDoc[]> {
  const snap = await refs
    .lectures()
    .where("studioId", "==", studioId)
    .where("staffId", "==", staffId)
    .where("date", "==", date)
    .get();
  return snap.docs.map((doc) => doc.data());
}

export async function getLecturesByDate(studioId: string, date: string): Promise<LectureDoc[]> {
  const snap = await refs.lectures().where("studioId", "==", studioId).where("date", "==", date).get();
  return snap.docs.map((doc) => doc.data());
}

export async function markMissingLecturesDeleted(input: {
  studioId: string;
  date: string;
  activeLectureIds: Set<string>;
}): Promise<string[]> {
  const snap = await refs.lectures().where("studioId", "==", input.studioId).where("date", "==", input.date).get();
  const missing = snap.docs.filter((doc) => {
    const lecture = doc.data();
    return lecture.status !== "deleted" && !input.activeLectureIds.has(lecture.lectureId);
  });
  if (!missing.length) return [];
  const batch = refs.lectures().firestore.batch();
  missing.forEach((doc) => {
    const lecture = doc.data();
    batch.set(
      doc.ref,
      {
        status: "deleted",
        bookingCount: 0,
        waitCount: 0,
        cancelCount: lecture.bookingCount + lecture.waitCount + lecture.cancelCount,
        sourceHash: `deleted_${lecture.sourceHash}`,
        updatedAt: nowTimestamp(),
        syncedAt: nowTimestamp(),
      },
      { merge: true },
    );
  });
  await batch.commit();
  return missing.map((doc) => doc.data().lectureId);
}
