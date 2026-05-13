import { refs } from "./refs";
import type { OtherScheduleDoc } from "../types/models";
import { nowTimestamp } from "../utils/date";

export async function upsertOtherScheduleIfChanged(schedule: OtherScheduleDoc): Promise<boolean> {
  const current = (await refs.otherSchedule(schedule.scheduleId).get()).data();
  if (
    current?.sourceHash === schedule.sourceHash &&
    current?.status === schedule.status &&
    current?.staffId === schedule.staffId &&
    current?.staffName === schedule.staffName &&
    arrayEqual(current?.staffIds, schedule.staffIds) &&
    arrayEqual(current?.staffNames, schedule.staffNames)
  ) {
    return false;
  }
  await refs.otherSchedule(schedule.scheduleId).set(schedule, { merge: true });
  return true;
}

export async function markMissingOtherSchedulesDeleted(input: {
  studioId: string;
  date: string;
  activeScheduleIds: Set<string>;
}): Promise<string[]> {
  const snap = await refs
    .otherSchedules()
    .where("studioId", "==", input.studioId)
    .where("date", "==", input.date)
    .get();
  const deleted: string[] = [];
  const batch = refs.otherSchedules().firestore.batch();
  snap.docs.forEach((doc) => {
    const schedule = doc.data();
    if (schedule.status !== "deleted" && !input.activeScheduleIds.has(schedule.scheduleId)) {
      deleted.push(schedule.scheduleId);
      batch.set(doc.ref, { status: "deleted", updatedAt: nowTimestamp() }, { merge: true });
    }
  });
  if (deleted.length) await batch.commit();
  return deleted;
}

function arrayEqual(a: unknown, b: unknown): boolean {
  const left = Array.isArray(a) ? a : [];
  const right = Array.isArray(b) ? b : [];
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
