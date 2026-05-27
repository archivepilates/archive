import {
  ALIMTALK_MEMBER_EXCLUSION_REASONS,
  ALIMTALK_TEMPLATE_POLICIES,
  INSTRUCTOR_LESSON_ALIMTALK_CHANNEL_ID,
  GROUP_SURVEY_ALIMTALK_START_DATE,
  LONG_ABSENCE_ALIMTALK_START_DATE,
  LONG_ABSENCE_MIN_DAYS,
  NEW_MEMBER_ALIMTALK_START_DATE,
  NEW_MEMBER_ALIMTALK_WINDOW_DAYS,
  PRIVATE_SURVEY_ALIMTALK_START_DATE,
  SENDABLE_ALIMTALK_CANDIDATE_TYPES,
  type AlimtalkDedupePolicy,
  type SendableAlimtalkCandidateType,
} from "./templatePolicies";

export {
  ALIMTALK_MEMBER_EXCLUSION_REASONS,
  GROUP_SURVEY_ALIMTALK_START_DATE,
  INSTRUCTOR_LESSON_ALIMTALK_CHANNEL_ID,
  LONG_ABSENCE_ALIMTALK_START_DATE,
  LONG_ABSENCE_MIN_DAYS,
  NEW_MEMBER_ALIMTALK_START_DATE,
  NEW_MEMBER_ALIMTALK_WINDOW_DAYS,
  PRIVATE_SURVEY_ALIMTALK_START_DATE,
  type AlimtalkDedupePolicy,
  type SendableAlimtalkCandidateType,
};

export const ALIMTALK_TEMPLATES = Object.fromEntries(
  Object.entries(ALIMTALK_TEMPLATE_POLICIES).map(([type, policy]) => [
    type,
    {
      code: policy.code,
      label: policy.label,
      status: policy.status,
    },
  ]),
) as {
  readonly [Type in keyof typeof ALIMTALK_TEMPLATE_POLICIES]: {
    readonly code: (typeof ALIMTALK_TEMPLATE_POLICIES)[Type]["code"];
    readonly label: (typeof ALIMTALK_TEMPLATE_POLICIES)[Type]["label"];
    readonly status: (typeof ALIMTALK_TEMPLATE_POLICIES)[Type]["status"];
  };
};

export const ALIMTALK_TEMPLATE_CHANNEL_IDS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.values(ALIMTALK_TEMPLATE_POLICIES)
    .filter((policy) => policy.channelId)
    .map((policy) => [policy.code, policy.channelId || ""]),
);

export const CANDIDATE_TEMPLATE_CODES: Record<SendableAlimtalkCandidateType, string> = Object.fromEntries(
  SENDABLE_ALIMTALK_CANDIDATE_TYPES.map((type) => [type, ALIMTALK_TEMPLATE_POLICIES[type].code]),
) as Record<SendableAlimtalkCandidateType, string>;

export const STATIC_APPROVED_ALIMTALK_TEMPLATE_CODES: ReadonlySet<string> = new Set(
  Object.values(ALIMTALK_TEMPLATE_POLICIES)
    .filter((policy) => policy.status === "approved")
    .map((policy) => policy.code),
);

export const APPROVED_ALIMTALK_TEMPLATE_CODES = STATIC_APPROVED_ALIMTALK_TEMPLATE_CODES;

export const ALIMTALK_DEDUPE_POLICIES_BY_TEMPLATE_CODE: Record<string, AlimtalkDedupePolicy> = Object.fromEntries(
  Object.values(ALIMTALK_TEMPLATE_POLICIES).map((policy) => [policy.code, policy.dedupePolicy]),
);

export function alimtalkDedupePolicy(templateCode: string): AlimtalkDedupePolicy {
  return (
    ALIMTALK_DEDUPE_POLICIES_BY_TEMPLATE_CODE[templateCode] || {
      label: "기본 30일",
      windowDays: 30,
    }
  );
}
