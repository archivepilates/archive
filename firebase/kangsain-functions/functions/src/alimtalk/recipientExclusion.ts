import type { AlimtalkCandidateDoc, AlimtalkCandidateType, BookingDoc, MemberProfileDoc } from "../types/models";
import { refs } from "../firestore/refs";
import { ALIMTALK_MEMBER_EXCLUSION_REASONS } from "./templates";
import { normalizeRecipientPhone } from "./testRecipients";

const AUTOMATIC_MEMBER_TYPES = new Set<AlimtalkCandidateType>([
  "reservation_open",
  "new_member",
  "membership_welcome",
  "private_survey",
  "group_survey",
  "ticket_expiring",
  "remaining_low",
  "private_count_low",
  "private_ticket_expiring",
  "long_absence",
]);

const STAFF_MEMBER_GRADES = new Set(["스텝", "직원", "staff"]);
const ACTIVE_STAFF_CACHE_MS = 30 * 1000;

let activeStaffCache:
  | {
      studioId: string;
      expiresAtMs: number;
      phones: Set<string>;
    }
  | undefined;

export function isAutomaticMemberAlimtalkType(type: AlimtalkCandidateType): boolean {
  return AUTOMATIC_MEMBER_TYPES.has(type);
}

export function automaticMemberExclusionReason(
  profile: Pick<MemberProfileDoc, "memberId" | "phone" | "memberGrade">,
  activeStaffPhones: ReadonlySet<string>,
): string {
  const configuredReason = ALIMTALK_MEMBER_EXCLUSION_REASONS[profile.memberId];
  if (configuredReason) return configuredReason;
  const memberGrade = String(profile.memberGrade || "").replace(/\s+/g, "").toLowerCase();
  if (STAFF_MEMBER_GRADES.has(memberGrade)) return "스텝 계정 알림톡 제외";
  const phone = normalizeRecipientPhone(profile.phone || "");
  if (phone && activeStaffPhones.has(phone)) return "현재 근무 스텝 계정 알림톡 제외";
  return "";
}

export async function loadActiveStaffPhones(studioId: string): Promise<Set<string>> {
  if (activeStaffCache?.studioId === studioId && activeStaffCache.expiresAtMs > Date.now()) {
    return new Set(activeStaffCache.phones);
  }
  const snap = await refs.staffs().where("studioId", "==", studioId).where("active", "==", true).get();
  const phones = new Set(
    snap.docs
      .map((doc) => normalizeRecipientPhone(doc.data().phone || ""))
      .filter(Boolean),
  );
  activeStaffCache = {
    studioId,
    expiresAtMs: Date.now() + ACTIVE_STAFF_CACHE_MS,
    phones,
  };
  return new Set(phones);
}

export async function currentAutomaticMemberExclusionReason(candidate: AlimtalkCandidateDoc): Promise<string> {
  if (!isAutomaticMemberAlimtalkType(candidate.type)) return "";
  const [profileSnap, activeStaffPhones] = await Promise.all([
    candidate.memberId ? refs.memberProfile(candidate.memberId).get() : Promise.resolve(null),
    loadActiveStaffPhones(candidate.studioId),
  ]);
  const profile = profileSnap?.data();
  const staffIssue = automaticMemberExclusionReason(
    {
      memberId: candidate.memberId,
      phone: profile?.phone || candidate.memberPhone,
      memberGrade: profile?.memberGrade || "",
    },
    activeStaffPhones,
  );
  if (staffIssue) return staffIssue;
  const bookingId = candidate.type === "group_survey" ? String(candidate.payload?.bookingId || "") : "";
  const booking = bookingId ? (await refs.booking(bookingId).get()).data() : undefined;
  return automaticMemberProductIssue(candidate, profile, booking);
}

export function automaticMemberProductIssue(
  candidate: AlimtalkCandidateDoc,
  profile: MemberProfileDoc | undefined,
  booking?: BookingDoc,
): string {
  if (candidate.type === "group_survey") {
    if (!booking || booking.memberId !== candidate.memberId) return "그룹 설문 예약 원천 확인 필요";
    if (instructorLessonSource(booking.ticketName, booking.ticketClassType, booking.ticketType)) {
      return "강사레슨 예약 일반 설문 제외";
    }
  }
  if (candidate.type === "reservation_open" || candidate.type === "new_member") {
    if (!profile?.activeTickets?.length) return "일반 안내 수강권 원천 확인 필요";
    if (profile.activeTickets.every((ticket) => instructorLessonSource(ticket.name, ticket.classType))) {
      return "강사레슨 수강권 일반 안내 제외";
    }
  }
  return "";
}

function instructorLessonSource(name: unknown, ...codes: unknown[]): boolean {
  return /강사레슨/i.test(String(name || "")) || codes.some((code) =>
    /^(I|INSTRUCTOR)$/i.test(String(code || "").trim()) || /강사레슨/i.test(String(code || "")),
  );
}
