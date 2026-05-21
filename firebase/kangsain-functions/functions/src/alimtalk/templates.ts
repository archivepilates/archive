import type { AlimtalkCandidateType } from "../types/models";

export const NEW_MEMBER_ALIMTALK_START_DATE = "2026-05-16";
export const NEW_MEMBER_ALIMTALK_WINDOW_DAYS = 3;
export const PRIVATE_SURVEY_ALIMTALK_START_DATE = "2026-05-19";
export const GROUP_SURVEY_ALIMTALK_START_DATE = "2026-05-21";

export const ALIMTALK_MEMBER_EXCLUSION_REASONS: Record<string, string> = {
  "3270886": "출산예정 회원 알림톡 제외",
  "3834419": "출산예정 회원 알림톡 제외",
};

export type SendableAlimtalkCandidateType =
  | "new_member"
  | "private_survey"
  | "group_survey"
  | "ticket_expiring"
  | "remaining_low"
  | "private_count_low"
  | "private_ticket_expiring";

export const ALIMTALK_TEMPLATES = {
  reservation_open: {
    code: "KA01TP2605131325462341f8ACO2THW6",
    label: "예약 안내 v2",
    status: "approved",
  },
  new_member: {
    code: "KA01TP260514081318309wQGfeIJxIAJ",
    label: "신규회원 웰컴 v3",
    status: "approved",
  },
  ticket_expiring: {
    code: "KA01TP260514145047261araXgWLVFRs",
    label: "그룹 기간권 잔여기간 안내 v3",
    status: "approved",
  },
  remaining_low: {
    code: "KA01TP260514145047393VpTbcCZKkCV",
    label: "그룹 횟수권 잔여횟수 안내 v3",
    status: "approved",
  },
  private_count_low: {
    code: "KA01TP260514152235608d9icGOBotnV",
    label: "프라이빗 횟수권 잔여횟수 안내 v1",
    status: "approved",
  },
  private_survey: {
    code: "KA01TP260514153632171uiWXYoeiOLS",
    label: "프라이빗 사전설문 안내 v1",
    status: "approved",
  },
  group_survey: {
    code: "KA01TP2605210729364330NbhZVAu9zA",
    label: "그룹 첫 수업 사전확인 안내 v1",
    status: "inspecting",
  },
  private_ticket_expiring: {
    code: "KA01TP260514153314927WH270IppWQS",
    label: "프라이빗 기간권 잔여기간 안내 v1",
    status: "approved",
  },
} as const;

export const CANDIDATE_TEMPLATE_CODES: Record<SendableAlimtalkCandidateType, string> = {
  new_member: ALIMTALK_TEMPLATES.new_member.code,
  private_survey: ALIMTALK_TEMPLATES.private_survey.code,
  group_survey: ALIMTALK_TEMPLATES.group_survey.code,
  ticket_expiring: ALIMTALK_TEMPLATES.ticket_expiring.code,
  remaining_low: ALIMTALK_TEMPLATES.remaining_low.code,
  private_count_low: ALIMTALK_TEMPLATES.private_count_low.code,
  private_ticket_expiring: ALIMTALK_TEMPLATES.private_ticket_expiring.code,
};

export const APPROVED_ALIMTALK_TEMPLATE_CODES: ReadonlySet<string> = new Set(
  Object.values(ALIMTALK_TEMPLATES)
    .filter((template) => template.status === "approved")
    .map((template) => template.code),
);

export interface AlimtalkDedupePolicy {
  label: string;
  windowDays: number | null;
}

export const ALIMTALK_DEDUPE_POLICIES_BY_TEMPLATE_CODE: Record<string, AlimtalkDedupePolicy> = {
  [ALIMTALK_TEMPLATES.reservation_open.code]: {
    label: "예약 오픈 안내 주간 반복",
    windowDays: 6,
  },
  [ALIMTALK_TEMPLATES.new_member.code]: {
    label: "신규회원 웰컴 영구 1회",
    windowDays: null,
  },
  [ALIMTALK_TEMPLATES.ticket_expiring.code]: {
    label: "수강권 기간 안내 30일",
    windowDays: 30,
  },
  [ALIMTALK_TEMPLATES.remaining_low.code]: {
    label: "수강권 횟수 안내 30일",
    windowDays: 30,
  },
  [ALIMTALK_TEMPLATES.private_count_low.code]: {
    label: "프라이빗 횟수 안내 30일",
    windowDays: 30,
  },
  [ALIMTALK_TEMPLATES.private_survey.code]: {
    label: "프라이빗 사전설문 영구 1회",
    windowDays: null,
  },
  [ALIMTALK_TEMPLATES.group_survey.code]: {
    label: "그룹 첫 수업 사전확인 영구 1회",
    windowDays: null,
  },
  [ALIMTALK_TEMPLATES.private_ticket_expiring.code]: {
    label: "프라이빗 기간 안내 30일",
    windowDays: 30,
  },
};

export function alimtalkDedupePolicy(templateCode: string): AlimtalkDedupePolicy {
  return (
    ALIMTALK_DEDUPE_POLICIES_BY_TEMPLATE_CODE[templateCode] || {
      label: "기본 30일",
      windowDays: 30,
    }
  );
}
