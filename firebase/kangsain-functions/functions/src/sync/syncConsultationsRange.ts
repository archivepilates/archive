import { logger } from "firebase-functions";
import { DEFAULT_MANAGER_STAFF_ID, DEFAULT_STUDIO_ID } from "../config/constants";
import { markMissingConsultationsDeleted, upsertConsultationIfChanged } from "../firestore/consultationRepository";
import { saveRawMirrorBatch } from "../firestore/rawMirrorRepository";
import { refs } from "../firestore/refs";
import { ManagerClient } from "../studiomate/managerClient";
import { normalizeConsultation } from "../studiomate/normalizers";
import type { ConsultationDoc, ContactSyncJobDoc, MemberProfileDoc } from "../types/models";
import { dateRange, nowTimestamp } from "../utils/date";
import { stableHash } from "../utils/hash";
import { isProtectedStaffContact } from "./protectedContactRules";

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
  const profileLookup = await uniqueMemberProfilesByName(studioId);
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
    const consultation = enrichConsultationMember(normalizeConsultation(rawConsultation, studioId), profileLookup);
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

async function uniqueMemberProfilesByName(studioId: string): Promise<Map<string, MemberProfileDoc>> {
  const snap = await refs.memberProfiles().where("studioId", "==", studioId).get();
  const profilesByName = new Map<string, MemberProfileDoc | null>();
  snap.docs.forEach((doc) => {
    const profile = doc.data();
    if (!profile.name || !profile.phone) return;
    const key = normalizeName(profile.name);
    if (!key) return;
    profilesByName.set(key, profilesByName.has(key) ? null : profile);
  });
  return new Map(
    [...profilesByName.entries()].filter((entry): entry is [string, MemberProfileDoc] => Boolean(entry[1])),
  );
}

function enrichConsultationMember(
  consultation: ConsultationDoc,
  profilesByName: Map<string, MemberProfileDoc>,
): ConsultationDoc {
  if ((consultation.memberId && consultation.memberPhone) || !consultation.memberName) return consultation;
  const profile = profilesByName.get(normalizeName(consultation.memberName));
  if (!profile) return consultation;
  return {
    ...consultation,
    memberId: consultation.memberId || profile.memberId,
    memberPhone: consultation.memberPhone || profile.phone || "",
  };
}

function normalizeName(value: unknown): string {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "");
}

function todayDate(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function queueConsultationContactSync(consultation: ConsultationDoc): Promise<void> {
  if (!consultation.memberPhone || !consultation.memberName || consultation.status === "deleted") return;
  if (isProtectedStaffContact({ name: consultation.memberName, phone: consultation.memberPhone })) return;

  const contactId = consultation.memberId || `consultation_${consultation.consultationId}`;
  const contactDisplayName = formatConsultationContactDisplayName(consultation);
  const contactHash = stableHash({
    name: consultation.memberName,
    contactDisplayName,
    phone: consultation.memberPhone,
    consultationId: consultation.consultationId,
    date: consultation.date,
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
      contactDisplayName,
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
    contactDisplayName,
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

function formatConsultationContactDisplayName(consultation: ConsultationDoc): string {
  return [consultation.memberName, compactConsultationDate(consultation), consultationContactKind(consultation)]
    .filter(Boolean)
    .join(" ");
}

function compactConsultationDate(consultation: ConsultationDoc): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(consultation.date)) {
    return consultation.date.replace(/^20/, "").replaceAll("-", "");
  }
  const startAt = consultation.startAt?.toDate();
  if (!startAt) return "";
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(startAt).replace(/^20/, "").replaceAll("-", "");
}

function consultationContactKind(consultation: ConsultationDoc): "상담" | "체험" {
  const text = [consultation.channel, consultation.memo].filter(Boolean).join(" ");
  return /체험|trial|experience/i.test(text) ? "체험" : "상담";
}
