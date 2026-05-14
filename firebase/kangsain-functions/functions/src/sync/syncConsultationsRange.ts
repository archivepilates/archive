import { logger } from "firebase-functions";
import { DEFAULT_MANAGER_STAFF_ID, DEFAULT_STUDIO_ID } from "../config/constants";
import { markMissingConsultationsDeleted, upsertConsultationIfChanged } from "../firestore/consultationRepository";
import { saveRawMirrorBatch } from "../firestore/rawMirrorRepository";
import { refs } from "../firestore/refs";
import { ManagerClient } from "../studiomate/managerClient";
import { normalizeConsultation } from "../studiomate/normalizers";
import type { ConsultationDoc, ContactSyncJobDoc } from "../types/models";
import { dateRange, nowTimestamp } from "../utils/date";
import { stableHash } from "../utils/hash";

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
    await queueConsultationContactSync(consultation);
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

async function queueConsultationContactSync(consultation: ConsultationDoc): Promise<void> {
  if (!consultation.memberPhone || !consultation.memberName || consultation.status === "deleted") return;

  const contactId = consultation.memberId || `consultation_${consultation.consultationId}`;
  const contactHash = stableHash({
    name: consultation.memberName,
    phone: consultation.memberPhone,
    consultationId: consultation.consultationId,
    source: "consultation_schedule",
  });
  const previousContact = (await refs.memberContactIndexDoc(contactId).get()).data();
  const shouldQueueHomeSync =
    !previousContact ||
    previousContact.contactHash !== contactHash ||
    previousContact.contactTargets?.home_archivepilates !== "synced";
  const jobId = `contact_${contactId}_home_${contactHash.slice(0, 16)}`;

  await refs.memberContactIndexDoc(contactId).set(
    {
      memberId: contactId,
      studioId: consultation.studioId,
      name: consultation.memberName,
      phone: consultation.memberPhone,
      phoneLast4: consultation.memberPhone.slice(-4),
      registeredAt: null,
      activeTicketCount: previousContact?.activeTicketCount || 0,
      activeTicketNames: previousContact?.activeTicketNames || [],
      contactHash,
      source: "studiomate_api",
      contactTargets: {
        archivepilates_gmail: previousContact?.contactTargets?.archivepilates_gmail || "skipped",
        home_archivepilates: shouldQueueHomeSync
          ? "pending"
          : previousContact?.contactTargets?.home_archivepilates || "synced",
      },
      homeContactResourceName: previousContact?.homeContactResourceName || "",
      lastContactSyncJobId: shouldQueueHomeSync ? jobId : previousContact?.lastContactSyncJobId || "",
      contactLastError: shouldQueueHomeSync ? null : previousContact?.contactLastError || null,
      contactUpdatedAt: previousContact?.contactUpdatedAt || null,
      syncedAt: nowTimestamp(),
      updatedAt: nowTimestamp(),
    },
    { merge: true },
  );

  if (!shouldQueueHomeSync) return;
  const job: ContactSyncJobDoc = {
    jobId,
    studioId: consultation.studioId,
    memberId: contactId,
    memberName: consultation.memberName,
    memberPhone: consultation.memberPhone,
    target: "home_archivepilates",
    status: "pending",
    attempts: 0,
    maxAttempts: 5,
    nextRunAt: nowTimestamp(),
    lastError: null,
    sourceReason: "consultation_schedule",
    createdAt: nowTimestamp(),
    updatedAt: nowTimestamp(),
  };
  await refs.contactSyncJob(jobId).set(job, { merge: true });
}
