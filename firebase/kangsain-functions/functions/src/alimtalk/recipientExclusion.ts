import type { AlimtalkCandidateDoc, AlimtalkCandidateType, MemberProfileDoc } from "../types/models";
import { refs } from "../firestore/refs";
import { ALIMTALK_MEMBER_EXCLUSION_REASONS } from "./templates";
import { normalizeRecipientPhone } from "./testRecipients";

const AUTOMATIC_MEMBER_TYPES = new Set<AlimtalkCandidateType>([
  "reservation_open",
  "new_member",
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
  return automaticMemberExclusionReason(
    {
      memberId: candidate.memberId,
      phone: profile?.phone || candidate.memberPhone,
      memberGrade: profile?.memberGrade || "",
    },
    activeStaffPhones,
  );
}
