import { DEFAULT_STUDIO_ID } from "../config/constants";
import { getLecture } from "../firestore/lectureRepository";
import { syncLecturesRange } from "./syncLecturesRange";

export async function refreshLectureById(input: {
  studioId?: string;
  lectureId: string;
  fallbackDate?: string;
}): Promise<unknown> {
  const studioId = input.studioId || DEFAULT_STUDIO_ID;
  const existing = await getLecture(input.lectureId);
  const date = existing?.date || input.fallbackDate;
  if (!date) return { refreshed: false, reason: "missing lecture date" };
  return syncLecturesRange({ studioId, startDate: date, endDate: date });
}
