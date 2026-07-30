import type { StaffDoc, ContactSyncJobDoc } from "../types/models";
import { refs } from "../firestore/refs";
import { nowTimestamp } from "../utils/date";
import { stableHash } from "../utils/hash";

export function staffContactIdentityChanged(before: StaffDoc | undefined, after: StaffDoc): boolean {
  if (!before) return true;
  return (
    before.name !== after.name ||
    normalizePhone(before.phone || "") !== normalizePhone(after.phone || "") ||
    before.role !== after.role ||
    before.active !== after.active
  );
}

export async function queueActiveStaffContactSync(staff: StaffDoc): Promise<{ queued: boolean; jobId?: string }> {
  const phone = normalizePhone(staff.phone || "");
  if (!staff.active || !staff.name || !phone) return { queued: false };

  const contactId = `staff_${staff.staffId}`;
  const contactDisplayName = formatStaffContactDisplayName(staff);
  const contactHash = stableHash({
    staffId: staff.staffId,
    name: staff.name,
    contactDisplayName,
    phone,
    role: staff.role,
    active: staff.active,
  });
  const previousContact = (await refs.memberContactIndexDoc(contactId).get()).data();
  const shouldQueueHomeSync =
    !previousContact ||
    previousContact.contactHash !== contactHash ||
    previousContact.contactTargets?.home_archivepilates !== "synced";
  if (!shouldQueueHomeSync) return { queued: false };

  const jobId = `contact_${contactId}_home_${contactHash.slice(0, 16)}`;
  await refs.memberContactIndexDoc(contactId).set(
    {
      memberId: contactId,
      studioId: staff.studioId,
      name: staff.name,
      contactDisplayName,
      phone,
      phoneLast4: phone.slice(-4),
      registeredAt: null,
      activeTicketCount: 0,
      activeTicketNames: [],
      contactHash,
      source: "studiomate_api",
      contactTargets: {
        archivepilates_gmail: previousContact?.contactTargets?.archivepilates_gmail || "skipped",
        home_archivepilates: "pending",
      },
      homeContactResourceName: previousContact?.homeContactResourceName || "",
      lastContactSyncJobId: jobId,
      contactLastError: null,
      contactUpdatedAt: previousContact?.contactUpdatedAt || null,
      syncedAt: nowTimestamp(),
      updatedAt: nowTimestamp(),
    },
    { merge: true },
  );

  const job: ContactSyncJobDoc = {
    jobId,
    studioId: staff.studioId,
    memberId: contactId,
    memberName: staff.name,
    contactDisplayName,
    memberPhone: phone,
    target: "home_archivepilates",
    status: "pending",
    attempts: 0,
    maxAttempts: 5,
    nextRunAt: nowTimestamp(),
    lastError: null,
    sourceReason: "staff_profile_refresh",
    createdAt: nowTimestamp(),
    updatedAt: nowTimestamp(),
  };
  await refs.contactSyncJob(jobId).set(job, { merge: true });
  return { queued: true, jobId };
}

function formatStaffContactDisplayName(staff: StaffDoc): string {
  if (staff.role === "owner") return `${staff.name} 원장님`;
  if (staff.role === "manager") return `${staff.name} 매니저님`;
  return `${staff.name} 강사님`;
}

function normalizePhone(value: string): string {
  let digits = String(value || "").replace(/\D+/g, "");
  if (digits.startsWith("82") && digits.length >= 11) digits = `0${digits.slice(2)}`;
  if (digits.length === 10 && digits.startsWith("10")) digits = `0${digits}`;
  return digits;
}
