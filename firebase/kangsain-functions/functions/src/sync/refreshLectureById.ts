import { DEFAULT_STUDIO_ID } from "../config/constants";
import { getLecture } from "../firestore/lectureRepository";
import { syncLecturesRange } from "./syncLecturesRange";

export type RefreshLectureByIdResult =
  | { refreshed: false; reason: "missing lecture date"; date: "" }
  | { refreshed: true; date: string; result: Awaited<ReturnType<typeof syncLecturesRange>> };

export async function refreshLectureById(input: {
  studioId?: string;
  lectureId: string;
  fallbackDate?: string;
}): Promise<RefreshLectureByIdResult> {
  const studioId = input.studioId || DEFAULT_STUDIO_ID;
  const existing = input.lectureId ? await getLecture(input.lectureId) : null;
  const date = existing?.date || input.fallbackDate;
  if (!date) return { refreshed: false, reason: "missing lecture date", date: "" };
  const result = await syncLecturesRange({ studioId, startDate: date, endDate: date });
  return { refreshed: true, date, result };
}
