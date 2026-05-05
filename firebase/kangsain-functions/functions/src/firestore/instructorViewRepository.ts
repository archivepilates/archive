import type { InstructorViewDoc } from "../types/models";
import { refs } from "./refs";

export async function saveInstructorView(view: InstructorViewDoc): Promise<void> {
  await refs.instructorView(view.staffId, view.date).set(view, { merge: true });
}

export async function getInstructorViews(staffId: string, dates: string[]): Promise<InstructorViewDoc[]> {
  const snaps = await Promise.all(dates.map((date) => refs.instructorView(staffId, date).get()));
  return snaps.filter((snap) => snap.exists).map((snap) => snap.data() as InstructorViewDoc);
}
