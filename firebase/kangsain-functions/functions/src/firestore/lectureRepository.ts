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
