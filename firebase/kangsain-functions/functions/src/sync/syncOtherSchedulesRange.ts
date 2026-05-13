import { logger } from "firebase-functions";
import { DEFAULT_MANAGER_STAFF_ID, DEFAULT_STUDIO_ID } from "../config/constants";
import { markMissingOtherSchedulesDeleted, upsertOtherScheduleIfChanged } from "../firestore/otherScheduleRepository";
import { saveRawMirrorBatch } from "../firestore/rawMirrorRepository";
import { refs } from "../firestore/refs";
import { normalizeOtherSchedule } from "../studiomate/normalizers";
import { StudioMateClient } from "../studiomate/studiomateClient";
import { dateRange, nowTimestamp } from "../utils/date";

export async function syncOtherSchedulesRange(input: {
  studioId?: string;
  staffId?: string;
  startDate: string;
  endDate: string;
}): Promise<{ otherSchedulesChanged: number; otherSchedulesDeleted: number; totalOtherSchedules: number; warning?: string }> {
  const studioId = input.studioId || DEFAULT_STUDIO_ID;
  const staffId = input.staffId || DEFAULT_MANAGER_STAFF_ID;
  const client = new StudioMateClient(studioId);
  let rawSchedules: any[] = [];
  try {
    rawSchedules = await client.getEtcSchedules({ startDate: input.startDate, endDate: input.endDate });
  } catch (err) {
    const warning = err instanceof Error ? err.message : String(err);
    logger.warn("syncOtherSchedulesRange skipped", { studioId, startDate: input.startDate, endDate: input.endDate, warning });
    await refs.syncState(`otherSchedulesRange_${studioId}`).set(
      {
        syncName: `otherSchedulesRange_${studioId}`,
        studioId,
        status: "warning",
        lastRunAt: nowTimestamp(),
        range: { startDate: input.startDate, endDate: input.endDate },
        lastError: warning,
      },
      { merge: true },
    );
    return { otherSchedulesChanged: 0, otherSchedulesDeleted: 0, totalOtherSchedules: 0, warning };
  }

  await saveRawMirrorBatch({
    studioId,
    dataset: "managerEtcSchedules",
    sourcePath: "/v2/staff/etcSchedule",
    records: rawSchedules,
    mirrorDate: input.startDate === input.endDate ? input.startDate : todayDate(),
  });

  let otherSchedulesChanged = 0;
  const scheduleIdsByDate = new Map<string, Set<string>>();
  for (const rawSchedule of rawSchedules) {
    const schedule = normalizeOtherSchedule(rawSchedule, studioId);
    if (!schedule.scheduleId || !schedule.date) continue;
    const dateIds = scheduleIdsByDate.get(schedule.date) || new Set<string>();
    dateIds.add(schedule.scheduleId);
    scheduleIdsByDate.set(schedule.date, dateIds);
    if (await upsertOtherScheduleIfChanged(schedule)) otherSchedulesChanged++;
  }

  let otherSchedulesDeleted = 0;
  for (const date of dateRange(input.startDate, input.endDate)) {
    otherSchedulesDeleted += (
      await markMissingOtherSchedulesDeleted({
        studioId,
        date,
        activeScheduleIds: scheduleIdsByDate.get(date) || new Set<string>(),
      })
    ).length;
  }

  await refs.syncState(`otherSchedulesRange_${studioId}`).set(
    {
      syncName: `otherSchedulesRange_${studioId}`,
      studioId,
      status: "success",
      lastRunAt: nowTimestamp(),
      lastSuccessAt: nowTimestamp(),
      range: { startDate: input.startDate, endDate: input.endDate },
      totalOtherSchedules: rawSchedules.length,
      otherSchedulesChanged,
      otherSchedulesDeleted,
      errorCount: 0,
      lastError: null,
    },
    { merge: true },
  );

  logger.info("syncOtherSchedulesRange completed", {
    studioId,
    startDate: input.startDate,
    endDate: input.endDate,
    totalOtherSchedules: rawSchedules.length,
    otherSchedulesChanged,
    otherSchedulesDeleted,
  });
  return { otherSchedulesChanged, otherSchedulesDeleted, totalOtherSchedules: rawSchedules.length };
}

function todayDate(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
