import { refs } from "../firestore/refs";
import type { AlimtalkCandidateDoc } from "../types/models";
import { stableHash } from "../utils/hash";
import { normalizeInstructorLessonManagementNumber } from "./instructorLessonManagement";
import { ALIMTALK_TEMPLATES } from "./templates";
import { hasExplicitAlimtalkTestOverride } from "./testRecipients";

const MEMBER_CARE_TYPES = new Set([
  "ticket_expiring",
  "remaining_low",
  "private_count_low",
  "private_ticket_expiring",
  "long_absence",
]);

const RENEWAL_MEMBER_CARE_TYPES = new Set([
  "ticket_expiring",
  "remaining_low",
  "private_count_low",
  "private_ticket_expiring",
]);

const MEMBER_CARE_TYPE_BY_TEMPLATE = new Map<string, string>([
  [ALIMTALK_TEMPLATES.ticket_expiring.code, "ticket_expiring"],
  [ALIMTALK_TEMPLATES.remaining_low.code, "remaining_low"],
  [ALIMTALK_TEMPLATES.private_count_low.code, "private_count_low"],
  [ALIMTALK_TEMPLATES.private_ticket_expiring.code, "private_ticket_expiring"],
  [ALIMTALK_TEMPLATES.long_absence.code, "long_absence"],
]);

export async function findCompletedDuplicate(dedupeKey: string, windowDays: number | null): Promise<string> {
  if (!dedupeKey) return "";
  const snap = await refs.alimtalkSends().where("dedupeKey", "==", dedupeKey).where("status", "==", "done").get();
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
  if (hasExplicitAlimtalkTestOverride(candidate)) return "";
  if (MEMBER_CARE_TYPES.has(candidate.type)) {
    const recentMemberCareSend = await findRecentMemberCareDuplicate(candidate, 14);
    if (recentMemberCareSend) return recentMemberCareSend;
  }
  const exact = await findCompletedDuplicate(dedupeKey, windowDays);
  if (exact) return exact;
  if (candidate.type === "reservation_open") {
    const sameWeekSend = await refs.alimtalkSend(candidate.candidateId).get();
    if (sameWeekSend.exists) {
      const send = sameWeekSend.data();
      const sentMs = send?.createdAt?.toMillis?.() || send?.updatedAt?.toMillis?.() || 0;
      const cutoffMs = windowDays == null ? 0 : Date.now() - windowDays * 24 * 60 * 60 * 1000;
      if (send?.status === "done" && (!windowDays || !sentMs || sentMs >= cutoffMs)) {
        return sameWeekSend.id;
      }
    }
  }
  if (candidate.type === "instructor_lesson_material") {
    const sameLessonSend = await findInstructorLessonDuplicate(candidate, windowDays);
    if (sameLessonSend) return sameLessonSend;
  }
  if (!isTicketReminder(candidate)) return "";

  const cutoffMs = windowDays == null ? 0 : Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const snap = await refs
    .alimtalkSends()
    .where("memberPhone", "==", candidate.memberPhone)
    .where("templateCode", "==", candidate.templateCode)
    .where("status", "==", "done")
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

async function findRecentMemberCareDuplicate(candidate: AlimtalkCandidateDoc, windowDays: number): Promise<string> {
  const queries = [];
  if (candidate.memberId) {
    queries.push(refs.alimtalkSends().where("memberId", "==", candidate.memberId).where("status", "==", "done").get());
  }
  if (candidate.memberPhone) {
    queries.push(
      refs.alimtalkSends().where("memberPhone", "==", candidate.memberPhone).where("status", "==", "done").get(),
    );
  }
  if (!queries.length) return "";

  const snapshots = await Promise.all(queries);
  const documents = snapshots.flatMap((snap) => snap.docs);
  const uniqueDocuments = new Map<string, (typeof documents)[number]>();
  documents.forEach((doc) => uniqueDocuments.set(doc.id, doc));

  const cutoffMs = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  let latestId = "";
  let latestSentMs = -1;
  for (const sendDoc of uniqueDocuments.values()) {
    if (sendDoc.id === candidate.candidateId) continue;
    const send = sendDoc.data();
    const sentMs = send.createdAt?.toMillis?.() || send.updatedAt?.toMillis?.() || 0;
    if (sentMs && sentMs < cutoffMs) continue;
    const previousCandidate = (await refs.alimtalkCandidate(send.candidateId || sendDoc.id).get()).data();
    const previousType = String(
      previousCandidate?.type || MEMBER_CARE_TYPE_BY_TEMPLATE.get(String(send.templateCode || "")) || "",
    );
    if (!MEMBER_CARE_TYPES.has(previousType)) continue;
    const comparablePreviousCandidate = previousCandidate || {
      ...candidate,
      candidateId: send.candidateId || sendDoc.id,
      type: previousType as AlimtalkCandidateDoc["type"],
      templateCode: String(send.templateCode || ""),
      payload: {},
    };
    if (!memberCareCandidatesConflict(candidate, comparablePreviousCandidate)) continue;
    const comparisonMs = sentMs || Number.MAX_SAFE_INTEGER;
    if (comparisonMs > latestSentMs) {
      latestId = sendDoc.id;
      latestSentMs = comparisonMs;
    }
  }
  return latestId;
}

export function memberCareCandidatesConflict(
  current: AlimtalkCandidateDoc,
  previous: AlimtalkCandidateDoc,
): boolean {
  const sameMemberId = Boolean(current.memberId && previous.memberId && current.memberId === previous.memberId);
  const currentPhone = normalizePhone(current.memberPhone);
  const previousPhone = normalizePhone(previous.memberPhone);
  const samePhone = Boolean(currentPhone && previousPhone && currentPhone === previousPhone);
  if (!sameMemberId && !samePhone) return false;
  if (!MEMBER_CARE_TYPES.has(current.type) || !MEMBER_CARE_TYPES.has(previous.type)) return false;
  if (current.type === "long_absence" || previous.type === "long_absence") return true;
  if (!RENEWAL_MEMBER_CARE_TYPES.has(current.type) || !RENEWAL_MEMBER_CARE_TYPES.has(previous.type)) return false;
  const currentIdentity = renewalReminderIdentity(current);
  const previousIdentity = renewalReminderIdentity(previous);
  return Boolean(currentIdentity && previousIdentity && currentIdentity === previousIdentity);
}

async function findInstructorLessonDuplicate(
  candidate: AlimtalkCandidateDoc,
  windowDays: number | null,
): Promise<string> {
  const phone = normalizePhone(candidate.memberPhone);
  if (!phone) return "";
  const cutoffMs = windowDays == null ? 0 : Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const snap = await refs
    .alimtalkSends()
    .where("memberPhone", "==", candidate.memberPhone)
    .where("status", "==", "done")
    .get();
  const expectedScope = JSON.stringify(dedupeScope(candidate));
  for (const sendDoc of snap.docs) {
    const send = sendDoc.data();
    const sentMs = send.createdAt?.toMillis?.() || send.updatedAt?.toMillis?.() || 0;
    if (windowDays != null && sentMs && sentMs < cutoffMs) continue;
    const previousCandidate = (await refs.alimtalkCandidate(send.candidateId || sendDoc.id).get()).data();
    if (!previousCandidate || previousCandidate.type !== "instructor_lesson_material") continue;
    if (JSON.stringify(dedupeScope(previousCandidate)) === expectedScope) return sendDoc.id;
  }
  return "";
}

export function alimtalkDedupeKey(candidate: AlimtalkCandidateDoc): string {
  if (candidate.type === "instructor_lesson_confirmation") {
    return stableHash({
      studioId: candidate.studioId,
      memberPhone: normalizePhone(candidate.memberPhone),
      type: candidate.type,
      templateCode: candidate.templateCode,
      scope: dedupeScope(candidate),
    });
  }
  const versionIndependent = ["private_survey", "reservation_open", "instructor_lesson_material"].includes(
    String(candidate.type),
  );
  const memberPhone = versionIndependent ? "" : normalizePhone(candidate.memberPhone);
  const templateCode = versionIndependent ? "" : candidate.templateCode;
  return stableHash({
    studioId: candidate.studioId,
    memberId: candidate.memberId,
    memberPhone,
    type: candidate.type,
    templateCode,
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
  if (type === "onsite_welcome") return { memberId: candidate.memberId };
  if (type === "private_survey") return { memberId: candidate.memberId };
  if (type === "group_survey") return { memberId: candidate.memberId };
  if (type === "long_absence") return { memberId: candidate.memberId };
  if (type === "pricing_info") return { inquiryPhone: normalizePhone(candidate.memberPhone) };
  if (type === "recommended_meal_survey") return { memberPhone: normalizePhone(candidate.memberPhone) };
  if (type === "recommended_meal_report") {
    return { reportId: String(payload.reportId || candidate.sourceActionKey || candidate.candidateId || "") };
  }
  if (type === "instructor_lesson_confirmation") {
    return {
      lessonDate: String(payload.lessonDate || ""),
      managementNumber: normalizeInstructorLessonManagementNumber(String(payload.managementNumber || "")),
    };
  }
  if (type === "instructor_lesson_material") {
    return {
      lessonDate: String(payload.lessonDate || payload.classDate || payload.sourceDate || candidate.sourceDate || ""),
      managementNumber: normalizeInstructorLessonManagementNumber(
        String(payload.managementNumber || payload.materialNumber || payload.archiveMethodId || ""),
      ),
    };
  }
  if (type === "private_lesson_report") {
    return {
      recordId: String(payload.recordId || candidate.sourceActionKey || candidate.candidateId || ""),
    };
  }
  if (type === "inbody_report") {
    return {
      reportToken: String(payload.reportToken || payload.inbodyReportToken || candidate.sourceActionKey || candidate.candidateId || ""),
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
  return renewalReminderIdentity(candidate);
}

export function renewalReminderIdentity(candidate: AlimtalkCandidateDoc): string {
  const payload = candidate.payload || {};
  const renewalCaseId = String(payload.renewalCaseId || "").trim();
  if (renewalCaseId) return `case:${renewalCaseId}`;
  const explicitTicketId = String(payload.userTicketId || payload.ticketId || "").trim();
  if (explicitTicketId) return `ticket:${explicitTicketId}`;
  const kind = String(candidate.type || "").startsWith("private_") ? "private" : "group";
  const ticketName = String(payload.ticketName || payload.ticket || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!ticketName) return "";
  return `${kind}|name:${ticketName}`;
}
