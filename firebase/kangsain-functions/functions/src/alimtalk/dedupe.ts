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
  if (type === "reservation_open") {
    return {
      reservationWeek: String(payload.reservationWeek || payload.weekLabel || ""),
    };
  }
  return {
    ticketName: String(payload.ticketName || payload.ticket || ""),
  };
}
