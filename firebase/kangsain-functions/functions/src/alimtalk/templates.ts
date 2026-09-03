import type { AlimtalkCandidateType } from "../types/models";

export const INSTRUCTOR_LESSON_ALIMTALK_CHANNEL_ID = "KA01PF260511123407631PSoAflYAVXs";
export const INSTRUCTOR_LESSON_ALIMTALK_TEMPLATE_CODE = "KA01TP260825074722212ylmndmsB3V4";
export const INSTRUCTOR_LESSON_CONFIRMATION_ALIMTALK_TEMPLATE_CODE = "KA01TP2608241233353269Jgtoiwnzi6";
export const INSTRUCTOR_LESSON_CONFIRMATION_ALIMTALK_IMAGE_ID = "ST01FZ260825101204154cOImfLX8Ri7";

export const NEW_MEMBER_ALIMTALK_START_DATE = "2026-05-16";
export const NEW_MEMBER_ALIMTALK_WINDOW_DAYS = 3;
export const PRIVATE_SURVEY_ALIMTALK_START_DATE = "2026-05-19";
export const GROUP_SURVEY_ALIMTALK_START_DATE = "2026-05-21";
export const LONG_ABSENCE_ALIMTALK_START_DATE = "2026-05-24";
export const RESERVATION_OPEN_ALIMTALK_TEMPLATE_CODE = "KA01TP26072806273194229P2ZesQwPp";
export const RESERVATION_OPEN_ALIMTALK_IMAGE_ID = "ST01FZ260728062730347ZXJsa4lUJuP";
export const LEGACY_PRIVATE_SURVEY_ALIMTALK_TEMPLATE_CODE = "KA01TP260514153632171uiWXYoeiOLS";
export const LEGACY_STAFF_PRIVATE_CHART_ALIMTALK_TEMPLATE_CODE = "KA01TP260527182741301uIuSTL01YQ1";
export const NATIVE_PRIVATE_SURVEY_ALIMTALK_TEMPLATE_CODE = "KA01TP260729144645970fv13He8mfsK";
export const NATIVE_STAFF_PRIVATE_SURVEY_ALIMTALK_TEMPLATE_CODE = "KA01TP260808034937468FF5LLYH823H";
export const NATIVE_STAFF_PRIVATE_CHART_ALIMTALK_TEMPLATE_CODE = "KA01TP260903104439283cNjQW0YrrtV";
export const NATIVE_PRIVATE_SURVEY_ALIMTALK_IMAGE_ID = "ST01FZ2605141601264576AUwmK3Bqgl";
export const NATIVE_STAFF_PRIVATE_CHART_ALIMTALK_IMAGE_ID = "ST01FZ260527183751162YVedKZ3LQIu";
export const RECOMMENDED_MEAL_ALIMTALK_TEMPLATE_CODE = "KA01TP260802163827071E2TTuX6CsWp";
export const RECOMMENDED_MEAL_ALIMTALK_IMAGE_ID = "ST01FZ260730122108103pEzxH5jOOpU";
export const RECOMMENDED_MEAL_ALIMTALK_CHANNEL_ID = "KA01PF260511123220162lk0NUjstpVl";
export const RECOMMENDED_MEAL_REPORT_ALIMTALK_TEMPLATE_CODE =
  process.env.RECOMMENDED_MEAL_REPORT_ALIMTALK_TEMPLATE_ID || "KA01TP260731123545629Sx4N5CZa5BF";

export const ALIMTALK_MEMBER_EXCLUSION_REASONS: Record<string, string> = {
  "1982133": "스텝 계정 알림톡 제외",
  "2022993": "스텝 계정 알림톡 제외",
  "3270886": "출산예정 회원 알림톡 제외",
  "3834419": "출산예정 회원 알림톡 제외",
};

export type SendableAlimtalkCandidateType =
  | "reservation_open"
  | "new_member"
  | "onsite_welcome"
  | "private_survey"
  | "group_survey"
  | "instructor_lesson_confirmation"
  | "instructor_lesson_material"
  | "private_lesson_report"
  | "inbody_report"
  | "ticket_expiring"
  | "remaining_low"
  | "private_count_low"
  | "private_ticket_expiring"
  | "long_absence"
  | "pricing_info"
  | "recommended_meal_survey"
  | "recommended_meal_report";

export const ALIMTALK_TEMPLATES = {
  reservation_open: {
    code: RESERVATION_OPEN_ALIMTALK_TEMPLATE_CODE,
    label: "스튜디오메이트 예약 안내 v4",
    status: "approved",
  },
  new_member: {
    code: "",
    label: "신규회원 웰컴 v3 삭제됨",
    status: "deleted",
  },
  onsite_welcome: {
    code: process.env.ONSITE_WELCOME_ALIMTALK_TEMPLATE_ID || "KA01TP260602101939427lPhGyuDLvFM",
    label: "신규회원 웰컴 v5",
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
    code:
      process.env.PRIVATE_SURVEY_ALIMTALK_TEMPLATE_ID ||
      NATIVE_PRIVATE_SURVEY_ALIMTALK_TEMPLATE_CODE,
    label: "프라이빗 사전설문 안내 v2",
    status: "approved",
  },
  group_survey: {
    code: "KA01TP2605210729364330NbhZVAu9zA",
    label: "그룹 첫 수업 사전확인 안내 v1",
    status: "approved",
  },
  private_ticket_expiring: {
    code: "KA01TP260514153314927WH270IppWQS",
    label: "프라이빗 기간권 잔여기간 안내 v1",
    status: "approved",
  },
  long_absence: {
    code: "KA01TP260524083643752cySb9BoDOjN",
    label: "장기 미방문 수업안내 v1",
    status: "approved",
  },
  staff_private_survey: {
    code:
      process.env.STAFF_PRIVATE_SURVEY_ALIMTALK_TEMPLATE_ID ||
      NATIVE_STAFF_PRIVATE_SURVEY_ALIMTALK_TEMPLATE_CODE,
    label: "담당강사 사전설문 제출 안내 v2",
    status: "approved",
  },
  staff_private_chart: {
    code:
      process.env.STAFF_PRIVATE_CHART_ALIMTALK_TEMPLATE_ID ||
      NATIVE_STAFF_PRIVATE_CHART_ALIMTALK_TEMPLATE_CODE,
    label: "강사용 프라이빗 오늘 기록 안내 v4",
    status: "pending",
  },
  staff_group_survey: {
    code: "KA01TP260522041704111wu4Z0cu9cgl",
    label: "첫 그룹수업 회원 확인 v1",
    status: "approved",
  },
  instructor_lesson_confirmation: {
    code: INSTRUCTOR_LESSON_CONFIRMATION_ALIMTALK_TEMPLATE_CODE,
    label: "강사레슨_예약확정 안내 v1",
    status: "approved",
  },
  instructor_lesson_material: {
    code: INSTRUCTOR_LESSON_ALIMTALK_TEMPLATE_CODE,
    label: "강사레슨_수업자료 안내 v3",
    status: "approved",
  },
  private_lesson_report: {
    code: "KA01TP260528081225871Fr92FW901Vo",
    label: "프라이빗 회원 리포트 안내 v1",
    status: "approved",
  },
  inbody_report: {
    code: "KA01TP260528090148593isshfXtt8vE",
    label: "회원용 인바디 리포트 안내 v1",
    status: "pending",
  },
  pricing_info: {
    code: process.env.PRICING_INFO_ALIMTALK_TEMPLATE_ID || "KA01TP260611053817155zqYlw27wEOU",
    label: "회원용_수강료 안내 링크 v1",
    status: "approved",
  },
  recommended_meal_survey: {
    code: RECOMMENDED_MEAL_ALIMTALK_TEMPLATE_CODE,
    label: "아카이브 추천식단 프로그램 v2",
    status: "approved",
  },
  recommended_meal_report: {
    code: RECOMMENDED_MEAL_REPORT_ALIMTALK_TEMPLATE_CODE,
    label: "아카이브 추천식단 도착 안내 v1",
    status: "pending",
  },
} as const;

export const ALIMTALK_TEMPLATE_CHANNEL_IDS: Readonly<Record<string, string>> = {
  [ALIMTALK_TEMPLATES.instructor_lesson_confirmation.code]: INSTRUCTOR_LESSON_ALIMTALK_CHANNEL_ID,
  [ALIMTALK_TEMPLATES.instructor_lesson_material.code]: INSTRUCTOR_LESSON_ALIMTALK_CHANNEL_ID,
  [ALIMTALK_TEMPLATES.recommended_meal_survey.code]: RECOMMENDED_MEAL_ALIMTALK_CHANNEL_ID,
  [ALIMTALK_TEMPLATES.recommended_meal_report.code]: RECOMMENDED_MEAL_ALIMTALK_CHANNEL_ID,
};

export const CANDIDATE_TEMPLATE_CODES: Record<SendableAlimtalkCandidateType, string> = {
  reservation_open: ALIMTALK_TEMPLATES.reservation_open.code,
  new_member: ALIMTALK_TEMPLATES.new_member.code,
  onsite_welcome: ALIMTALK_TEMPLATES.onsite_welcome.code,
  private_survey: ALIMTALK_TEMPLATES.private_survey.code,
  group_survey: ALIMTALK_TEMPLATES.group_survey.code,
  instructor_lesson_confirmation: ALIMTALK_TEMPLATES.instructor_lesson_confirmation.code,
  instructor_lesson_material: ALIMTALK_TEMPLATES.instructor_lesson_material.code,
  private_lesson_report: ALIMTALK_TEMPLATES.private_lesson_report.code,
  inbody_report: ALIMTALK_TEMPLATES.inbody_report.code,
  ticket_expiring: ALIMTALK_TEMPLATES.ticket_expiring.code,
  remaining_low: ALIMTALK_TEMPLATES.remaining_low.code,
  private_count_low: ALIMTALK_TEMPLATES.private_count_low.code,
  private_ticket_expiring: ALIMTALK_TEMPLATES.private_ticket_expiring.code,
  long_absence: ALIMTALK_TEMPLATES.long_absence.code,
  pricing_info: ALIMTALK_TEMPLATES.pricing_info.code,
  recommended_meal_survey: ALIMTALK_TEMPLATES.recommended_meal_survey.code,
  recommended_meal_report: ALIMTALK_TEMPLATES.recommended_meal_report.code,
};

export const STATIC_APPROVED_ALIMTALK_TEMPLATE_CODES: ReadonlySet<string> = new Set(
  Object.values(ALIMTALK_TEMPLATES)
    .filter((template) => template.status === "approved")
    .map((template) => template.code),
);

export const APPROVED_ALIMTALK_TEMPLATE_CODES = STATIC_APPROVED_ALIMTALK_TEMPLATE_CODES;

export interface AlimtalkDedupePolicy {
  label: string;
  windowDays: number | null;
}

export const ALIMTALK_DEDUPE_POLICIES_BY_TEMPLATE_CODE: Record<string, AlimtalkDedupePolicy> = {
  [ALIMTALK_TEMPLATES.reservation_open.code]: {
    label: "예약 오픈 안내 주간 반복",
    windowDays: 6,
  },
  ...(ALIMTALK_TEMPLATES.new_member.code
    ? {
        [ALIMTALK_TEMPLATES.new_member.code]: {
          label: "신규회원 웰컴 영구 1회",
          windowDays: null,
        },
      }
    : {}),
  ...(ALIMTALK_TEMPLATES.onsite_welcome.code
    ? {
        [ALIMTALK_TEMPLATES.onsite_welcome.code]: {
          label: "현장 웰컴 영구 1회",
          windowDays: null,
        },
      }
    : {}),
  [ALIMTALK_TEMPLATES.ticket_expiring.code]: {
    label: "수강권별 기간 안내 30일",
    windowDays: 30,
  },
  [ALIMTALK_TEMPLATES.remaining_low.code]: {
    label: "수강권별 횟수 안내 30일",
    windowDays: 30,
  },
  [ALIMTALK_TEMPLATES.private_count_low.code]: {
    label: "프라이빗 수강권별 횟수 안내 30일",
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
    label: "프라이빗 수강권별 기간 안내 30일",
    windowDays: 30,
  },
  [ALIMTALK_TEMPLATES.long_absence.code]: {
    label: "장기 미방문 안내 14일",
    windowDays: 14,
  },
  [ALIMTALK_TEMPLATES.instructor_lesson_confirmation.code]: {
    label: "강사레슨 예약확정 수업별 1회",
    windowDays: null,
  },
  [ALIMTALK_TEMPLATES.instructor_lesson_material.code]: {
    label: "강사레슨 수업자료 수업별 1회",
    windowDays: null,
  },
  [ALIMTALK_TEMPLATES.private_lesson_report.code]: {
    label: "프라이빗 회원 리포트 회차별 1회",
    windowDays: null,
  },
  [ALIMTALK_TEMPLATES.inbody_report.code]: {
    label: "인바디 리포트별 1회",
    windowDays: null,
  },
  [ALIMTALK_TEMPLATES.pricing_info.code]: {
    label: "수강료 문의 안내 7일",
    windowDays: 7,
  },
  ...(ALIMTALK_TEMPLATES.recommended_meal_survey.code
    ? {
        [ALIMTALK_TEMPLATES.recommended_meal_survey.code]: {
          label: "추천식단 프로그램 설문 30일",
          windowDays: 30,
        },
      }
    : {}),
  ...(ALIMTALK_TEMPLATES.recommended_meal_report.code
    ? {
        [ALIMTALK_TEMPLATES.recommended_meal_report.code]: {
          label: "추천식단 리포트별 1회",
          windowDays: null,
        },
      }
    : {}),
};

export function alimtalkDedupePolicy(templateCode: string): AlimtalkDedupePolicy {
  return (
    ALIMTALK_DEDUPE_POLICIES_BY_TEMPLATE_CODE[templateCode] || {
      label: "기본 30일",
      windowDays: 30,
    }
  );
}
