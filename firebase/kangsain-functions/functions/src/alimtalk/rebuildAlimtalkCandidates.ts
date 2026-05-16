import { logger } from "firebase-functions";
import type { AlimtalkCandidateDoc, MemberProfileDoc } from "../types/models";
import { refs } from "../firestore/refs";
import { addDays, dateRange, nowTimestamp } from "../utils/date";
import { stableHash } from "../utils/hash";
import {
  ALIMTALK_MEMBER_EXCLUSION_REASONS,
  CANDIDATE_TEMPLATE_CODES,
  NEW_MEMBER_ALIMTALK_START_DATE,
  NEW_MEMBER_ALIMTALK_WINDOW_DAYS,
  type SendableAlimtalkCandidateType,
} from "./templates";

export async function rebuildAlimtalkCandidatesForRange(input: {
  studioId: string;
  startDate: string;
  endDate: string;
}): Promise<{ candidates: number; candidateIds: string[] }> {
  const profilesSnap = await refs.memberProfiles().where("studioId", "==", input.studioId).get();

  const writes: Array<Promise<unknown>> = [];
  const candidateIds: string[] = [];
  const profiles = profilesSnap.docs.map((snap) => snap.data());
  dateRange(input.startDate, input.endDate).forEach((sourceDate) => {
    profiles.forEach((profile) => {
      directTicketCandidates(profile, sourceDate).forEach((candidate) => {
        candidateIds.push(candidate.candidateId);
        writes.push(upsertCandidate(candidate));
      });
    });
  });

  profiles
    .filter(
      (profile) =>
        profile.isNewMember &&
        !ALIMTALK_MEMBER_EXCLUSION_REASONS[profile.memberId] &&
        activeProfileTickets(profile, input.endDate).length > 0 &&
        registeredDate(profile) >= NEW_MEMBER_ALIMTALK_START_DATE &&
        registeredDate(profile) >= newMemberWindowStartDate(input.endDate) &&
        registeredDate(profile) <= input.endDate,
    )
    .forEach((profile) => {
      const sourceDate = registeredDate(profile);
      if (!sourceDate || !profile.phone) return;
      const candidateId = `new_member_${profile.memberId}_${sourceDate}`;
      candidateIds.push(candidateId);
      writes.push(
        upsertCandidate({
          candidateId,
          studioId: profile.studioId,
          memberId: profile.memberId,
          memberName: profile.name,
          memberPhone: profile.phone,
          type: "new_member",
          status: "candidate",
          templateCode: CANDIDATE_TEMPLATE_CODES.new_member,
          title: "신규회원",
          reason: `최초등록 ${sourceDate}`,
          sourceDate,
          payload: {
            memberName: profile.name,
            registeredDate: sourceDate,
            activeTicketNames: activeProfileTickets(profile, input.endDate)
              .map((ticket) => ticket.name)
              .filter(Boolean)
              .join(", "),
          },
          lastError: null,
          createdAt: nowTimestamp(),
          updatedAt: nowTimestamp(),
        }),
      );
    });

  await Promise.all(writes);
  logger.info("rebuildAlimtalkCandidatesForRange completed", { studioId: input.studioId, candidates: writes.length });
  return { candidates: writes.length, candidateIds };
}

function directTicketCandidates(profile: MemberProfileDoc, sourceDate: string): AlimtalkCandidateDoc[] {
  if (!profile.memberId || !profile.name || !profile.phone) return [];
  if (ALIMTALK_MEMBER_EXCLUSION_REASONS[profile.memberId]) return [];
  return activeProfileTickets(profile, sourceDate)
    .map((ticket) => directTicketCandidate(profile, ticket, sourceDate))
    .filter((candidate): candidate is AlimtalkCandidateDoc => Boolean(candidate));
}

function directTicketCandidate(
  profile: MemberProfileDoc,
  ticket: NonNullable<MemberProfileDoc["activeTickets"]>[number],
  sourceDate: string,
): AlimtalkCandidateDoc | null {
  if (hasOtherActiveTicket(profile, ticket, sourceDate)) return null;
  const memberId = profile.memberId;
  const memberName = profile.name;
  const memberPhone = profile.phone;
  if (!memberId || !memberName || !memberPhone) return null;
  const type = alimtalkTypeFromTicket(ticket, sourceDate);
  if (!type) return null;
  const templateCode = CANDIDATE_TEMPLATE_CODES[type];
  if (!templateCode) return null;
  const payload = ticketPayload(ticket, sourceDate);
  const candidateId = `ticket_${stableHash({
    date: sourceDate,
    memberId,
    type,
    ticketName: payload.ticketName,
  }).slice(0, 24)}`;
  return {
    candidateId,
    studioId: profile.studioId,
    memberId,
    memberName,
    memberPhone,
    type,
    status: "candidate",
    templateCode,
    title: "수강권",
    reason: ticketReason(type, payload),
    sourceDate,
    payload: {
      memberName: profile.name,
      reason: ticketReason(type, payload),
      date: sourceDate,
      ...payload,
    },
    lastError: null,
    createdAt: nowTimestamp(),
    updatedAt: nowTimestamp(),
  };
}

function alimtalkTypeFromTicket(
  ticket: NonNullable<MemberProfileDoc["activeTickets"]>[number],
  sourceDate: string,
): SendableAlimtalkCandidateType | null {
  const remaining = Number(ticket.remainingCount);
  if (Number.isFinite(remaining) && remaining >= 0) {
    if (isPrivateProfileTicket(ticket) && remaining <= 3) return "private_count_low";
    if (!isPrivateProfileTicket(ticket) && remaining < 5) return "remaining_low";
  }
  const days = Number(remainingDays(ticket.expiresAt, sourceDate));
  if (Number.isFinite(days) && days <= 14) {
    if (isPrivateProfileTicket(ticket)) return "private_ticket_expiring";
    return "ticket_expiring";
  }
  return null;
}

function ticketReason(type: SendableAlimtalkCandidateType, payload: Record<string, string>): string {
  if (type === "remaining_low" || type === "private_count_low") return `잔여횟수 부족 · ${payload.remainingCount}회`;
  return `기간만료 임박 · ${payload.remainingDays}일`;
}

function hasOtherActiveTicket(
  profile: MemberProfileDoc | undefined,
  target: NonNullable<MemberProfileDoc["activeTickets"]>[number],
  sourceDate: string,
): boolean {
  const targetKey = profileTicketIdentity(target);
  return activeProfileTickets(profile, sourceDate).some((ticket) => profileTicketIdentity(ticket) !== targetKey);
}

function activeProfileTickets(
  profile: MemberProfileDoc | undefined,
  sourceDate: string,
): NonNullable<MemberProfileDoc["activeTickets"]> {
  return (profile?.activeTickets || []).filter((ticket) => isActiveProfileTicket(ticket, sourceDate));
}

function isActiveProfileTicket(
  ticket: NonNullable<MemberProfileDoc["activeTickets"]>[number],
  sourceDate: string,
): boolean {
  if (!ticket.name) return false;
  if (!isLessonProfileTicket(ticket)) return false;
  if (ticket.expiryLevel === "expired") return false;
  if (ticket.expiresAt && expiryDateText(ticket.expiresAt) < sourceDate) return false;
  const remaining = Number(ticket.remainingCount);
  return !Number.isFinite(remaining) || remaining > 0;
}

function isLessonProfileTicket(ticket: NonNullable<MemberProfileDoc["activeTickets"]>[number]): boolean {
  const classType = String(ticket.classType || "").toUpperCase();
  const name = String(ticket.name || "");
  if (classType === "I") return false;
  if (/토삭스|삭스|양말|기간연장|체험|체험권|강사레슨/.test(name)) return false;
  return true;
}

function isPrivateProfileTicket(ticket: NonNullable<MemberProfileDoc["activeTickets"]>[number]): boolean {
  const classType = String(ticket.classType || "").toUpperCase();
  const name = String(ticket.name || "");
  return classType === "P" || classType === "PRIVATE" || /프라이빗|개인/.test(name);
}

function profileTicketIdentity(ticket: NonNullable<MemberProfileDoc["activeTickets"]>[number]): string {
  if (ticket.userTicketId) return `user:${ticket.userTicketId}`;
  const expiresAt = ticket.expiresAt?.toMillis() || "";
  return [ticket.ticketId || "", ticket.name || "", expiresAt].filter(Boolean).join("|");
}

function ticketPayload(
  ticket: NonNullable<MemberProfileDoc["activeTickets"]>[number],
  sourceDate: string,
): Record<string, string> {
  return {
    ticketId: ticket.ticketId || "",
    userTicketId: ticket.userTicketId || "",
    ticketName: ticket.name || "",
    remainingCount: ticket.remainingCount == null ? "" : String(ticket.remainingCount),
    expiresAt: formatKoreanDate(ticket.expiresAt),
    remainingDays: remainingDays(ticket.expiresAt, sourceDate),
  };
}

function formatKoreanDate(value: NonNullable<MemberProfileDoc["activeTickets"]>[number]["expiresAt"]): string {
  const date = value?.toDate?.();
  if (!date) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  })
    .format(date)
    .replace(/\s/g, " ");
}

function remainingDays(
  value: NonNullable<MemberProfileDoc["activeTickets"]>[number]["expiresAt"],
  sourceDate: string,
): string {
  const date = value?.toDate?.();
  if (!date) return "";
  const expiryText = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(date);
  const today = new Date(`${sourceDate}T00:00:00+09:00`).getTime();
  const expiry = new Date(`${expiryText}T00:00:00+09:00`).getTime();
  return String(Math.max(0, Math.ceil((expiry - today) / (24 * 60 * 60 * 1000))));
}

function expiryDateText(value: NonNullable<MemberProfileDoc["activeTickets"]>[number]["expiresAt"]): string {
  const date = value?.toDate?.();
  if (!date) return "";
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(date);
}

async function upsertCandidate(candidate: AlimtalkCandidateDoc): Promise<void> {
  const ref = refs.alimtalkCandidate(candidate.candidateId);
  const previous = (await ref.get()).data();
  if (previous && ["queued", "sent", "skipped"].includes(previous.status)) {
    await ref.set({ updatedAt: nowTimestamp() }, { merge: true });
    return;
  }
  await ref.set(
    {
      ...candidate,
      status: previous?.status || candidate.status,
      createdAt: previous?.createdAt || candidate.createdAt,
      updatedAt: nowTimestamp(),
    },
    { merge: true },
  );
}

function registeredDate(profile: MemberProfileDoc): string {
  const date = profile.registeredAt?.toDate();
  if (!date) return "";
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(date);
}

function newMemberWindowStartDate(endDate: string): string {
  return addDays(endDate, -(NEW_MEMBER_ALIMTALK_WINDOW_DAYS - 1));
}
