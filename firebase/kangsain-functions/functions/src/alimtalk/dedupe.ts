import { refs } from "../firestore/refs";
import type { AlimtalkCandidateDoc } from "../types/models";
import { stableHash } from "../utils/hash";

export async function findCompletedDuplicate(dedupeKey: string, windowDays: number | null): Promise<string> {
  if (!dedupeKey) return "";
  const snap = await refs
    .alimtalkSends()
    .where("dedupeKey", "==", dedupeKey)
    .where("status", "==", "done")
    .limit(1)
    .get();
  const cutoffMs = windowDays == null ? 0 : Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const duplicate = snap.docs.find((doc) => {
    if (windowDays == null) return true;
    const data = doc.data();
    const sentMs = data.createdAt?.toMillis?.() || data.updatedAt?.toMillis?.() || 0;
    return !sentMs || sentMs >= cutoffMs;
  });
  return duplicate?.id || "";
}

export async function findCompletedDuplicateForCandidate(
  candidate: AlimtalkCandidateDoc,
  dedupeKey: string,
  windowDays: number | null,
): Promise<string> {
  const exact = await findCompletedDuplicate(dedupeKey, windowDays);
  if (exact) return exact;
  if (!isTicketReminder(candidate)) return "";

  const cutoffMs = windowDays == null ? 0 : Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const snap = await refs
    .alimtalkSends()
    .where("memberPhone", "==", candidate.memberPhone)
    .where("templateCode", "==", candidate.templateCode)
    .where("status", "==", "done")
    .limit(20)
    .get();
  for (const sendDoc of snap.docs) {
    const send = sendDoc.data();
    const sentMs = send.createdAt?.toMillis?.() || send.updatedAt?.toMillis?.() || 0;
    if (windowDays != null && sentMs && sentMs < cutoffMs) continue;
    const previousCandidate = (await refs.alimtalkCandidate(send.candidateId || sendDoc.id).get()).data();
    if (!previousCandidate || !isTicketReminder(previousCandidate)) continue;
    if (ticketReminderFingerprint(previousCandidate) === ticketReminderFingerprint(candidate)) return sendDoc.id;
  }
  return "";
}

export function alimtalkDedupeKey(candidate: AlimtalkCandidateDoc): string {
  return stableHash({
    studioId: candidate.studioId,
    memberId: candidate.memberId,
    memberPhone: normalizePhone(candidate.memberPhone),
    type: candidate.type,
    templateCode: candidate.templateCode,
    scope: dedupeScope(candidate),
  });
}

export function normalizePhone(value: string): string {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("8210")) return `0${digits.slice(2)}`;
  return digits;
}

function dedupeScope(candidate: AlimtalkCandidateDoc): Record<string, string> {
  const payload = candidate.payload || {};
  const type = String(candidate.type);
  if (type === "new_member") return { memberId: candidate.memberId };
  if (type === "private_survey") return { memberId: candidate.memberId };
  if (type === "group_survey") return { memberId: candidate.memberId };
  if (type === "long_absence") return { memberId: candidate.memberId };
  if (type === "instructor_lesson_material") {
    return {
      lessonDate: String(payload.lessonDate || payload.classDate || payload.sourceDate || candidate.sourceDate || ""),
      managementNumber: String(payload.managementNumber || payload.materialNumber || payload.archiveMethodId || ""),
    };
  }
  if (type === "private_lesson_report") {
    return {
      recordId: String(payload.recordId || candidate.sourceActionKey || candidate.candidateId || ""),
    };
  }
  if (type === "reservation_open") {
    return {
      reservationWeek: String(payload.reservationWeek || payload.weekLabel || ""),
    };
  }
  if (["ticket_expiring", "remaining_low", "private_count_low", "private_ticket_expiring"].includes(type)) {
    return {
      ticketIdentity: ticketReminderFingerprint(candidate),
    };
  }
  return {
    ticketName: String(payload.ticketName || payload.ticket || ""),
  };
}

function isTicketReminder(candidate: AlimtalkCandidateDoc): boolean {
  return ["ticket_expiring", "remaining_low", "private_count_low", "private_ticket_expiring"].includes(
    String(candidate.type),
  );
}

function ticketReminderFingerprint(candidate: AlimtalkCandidateDoc): string {
  const payload = candidate.payload || {};
  const explicitTicketId = String(payload.userTicketId || payload.ticketId || "").trim();
  if (explicitTicketId) return `${String(candidate.type || "")}|ticket:${explicitTicketId}`;
  return [
    String(candidate.type || ""),
    String(payload.ticketName || payload.ticket || "").trim(),
    String(payload.expiresAt || payload.expiryDate || payload.expireDate || "").trim(),
  ].join("|");
}
