import { logger } from "firebase-functions";
import { DEFAULT_MANAGER_STAFF_ID, DEFAULT_STUDIO_ID } from "../config/constants";
import { markMissingConsultationsDeleted, upsertConsultationIfChanged } from "../firestore/consultationRepository";
import { saveRawMirrorBatch } from "../firestore/rawMirrorRepository";
import { refs } from "../firestore/refs";
import { ManagerClient } from "../studiomate/managerClient";
import { normalizeConsultation } from "../studiomate/normalizers";
import { dateRange, nowTimestamp } from "../utils/date";

export async function syncConsultationsRange(input: {
  studioId?: string;
  staffId?: string;
  startDate: string;
  endDate: string;
}): Promise<{ consultationsChanged: number; consultationsDeleted: number; totalConsultations: number }> {
  const studioId = input.studioId || DEFAULT_STUDIO_ID;
  const staffId = input.staffId || DEFAULT_MANAGER_STAFF_ID;
  const client = new ManagerClient(studioId, staffId);
  const rawConsultations = await client.getCounsels({ startDate: input.startDate, endDate: input.endDate });
  await saveRawMirrorBatch({
    studioId,
    dataset: "managerCounsels",
    sourcePath: "/api/schedule/counsel",
    records: rawConsultations,
    mirrorDate: input.startDate === input.endDate ? input.startDate : todayDate(),
  });

  let consultationsChanged = 0;
  const consultationIdsByDate = new Map<string, Set<string>>();

  for (const rawConsultation of rawConsultations) {
    const consultation = normalizeConsultation(rawConsultation, studioId);
    if (!consultation.consultationId || !consultation.date) continue;
    const dateIds = consultationIdsByDate.get(consultation.date) || new Set<string>();
    dateIds.add(consultation.consultationId);
    consultationIdsByDate.set(consultation.date, dateIds);
    if (await upsertConsultationIfChanged(consultation)) consultationsChanged++;
  }

  let consultationsDeleted = 0;
  for (const date of dateRange(input.startDate, input.endDate)) {
    consultationsDeleted += (
      await markMissingConsultationsDeleted({
        studioId,
        date,
        activeConsultationIds: consultationIdsByDate.get(date) || new Set<string>(),
      })
    ).length;
  }

  await refs.syncState(`consultationsRange_${studioId}`).set(
    {
      syncName: `consultationsRange_${studioId}`,
      studioId,
      status: "success",
      lastRunAt: nowTimestamp(),
      lastSuccessAt: nowTimestamp(),
      range: { startDate: input.startDate, endDate: input.endDate },
      totalConsultations: rawConsultations.length,
      consultationsChanged,
      consultationsDeleted,
      errorCount: 0,
      lastError: null,
    },
    { merge: true },
  );

  logger.info("syncConsultationsRange completed", {
    studioId,
    startDate: input.startDate,
    endDate: input.endDate,
    totalConsultations: rawConsultations.length,
    consultationsChanged,
    consultationsDeleted,
  });
  return { consultationsChanged, consultationsDeleted, totalConsultations: rawConsultations.length };
}

function todayDate(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
