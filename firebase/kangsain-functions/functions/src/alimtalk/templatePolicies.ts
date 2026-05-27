import type { AlimtalkCandidateType } from "../types/models";

export const INSTRUCTOR_LESSON_ALIMTALK_CHANNEL_ID = "KA01PF260511123407631PSoAflYAVXs";

export const NEW_MEMBER_ALIMTALK_START_DATE = "2026-05-16";
export const NEW_MEMBER_ALIMTALK_WINDOW_DAYS = 3;
export const PRIVATE_SURVEY_ALIMTALK_START_DATE = "2026-05-19";
export const GROUP_SURVEY_ALIMTALK_START_DATE = "2026-05-21";
export const LONG_ABSENCE_ALIMTALK_START_DATE = "2026-05-24";
export const LONG_ABSENCE_MIN_DAYS = 10;

export const SOLAPI_BUTTON_URL_MAX_LENGTH = 100;
export const SHORT_LINK_BUTTON_URL_TEMPLATE = "https://in.archivepilates.com/s/#{링크ID}/";
export const SURVEY_DETAIL_BUTTON_URL_TEMPLATE =
  "https://in.archivepilates.com/privateSurveyResponseView?id=#{설문ID}&token=#{접근토큰}";
export const GROUP_SURVEY_BUTTON_URL_TEMPLATE =
  "https://in.archivepilates.com/groupSurvey?id=#{설문ID}&token=#{접근토큰}";
export const METHOD_MATERIAL_BUTTON_URL_TEMPLATE = "https://in.archivepilates.com/method/#{관리번호}";

export const ALIMTALK_MEMBER_EXCLUSION_REASONS: Record<string, string> = {
  "3270886": "출산예정 회원 알림톡 제외",
  "3834419": "출산예정 회원 알림톡 제외",
};

export type SendableAlimtalkCandidateType =
  | "reservation_open"
  | "new_member"
  | "private_survey"
  | "group_survey"
  | "instructor_lesson_material"
  | "ticket_expiring"
  | "remaining_low"
  | "private_count_low"
  | "private_ticket_expiring"
  | "long_absence";

export type AlimtalkTemplatePolicyKey =
  | SendableAlimtalkCandidateType
  | "staff_private_survey"
  | "staff_group_survey"
  | "instructor_lesson_material";

export type AlimtalkTemplateStatus = "approved" | "pending" | "inspecting" | "paused";
export type AlimtalkPolicyAudience = "member" | "staff" | "instructor_lesson_member";
export type AlimtalkSourceDatePolicy = "today" | "recent_new_member" | "same_or_before_today" | "manual";

export interface AlimtalkButtonUrlRule {
  label: string;
  template: string;
  maxLength: number;
}

export interface AlimtalkDedupePolicy {
  label: string;
  windowDays: number | null;
}

export interface AlimtalkTemplatePolicy {
  type?: AlimtalkCandidateType;
  code: string;
  label: string;
  status: AlimtalkTemplateStatus;
  audience: AlimtalkPolicyAudience;
  automationStatus: "active" | "paused" | "manual";
  sourceDatePolicy: AlimtalkSourceDatePolicy;
  targetRules: readonly string[];
  exclusionRules: readonly string[];
  dedupePolicy: AlimtalkDedupePolicy;
  minSourceDate?: string;
  maxAgeDays?: number;
  requiresApprovedTemplate: boolean;
  requiresMemberPhone: boolean;
  requiresManagementNumber?: boolean;
  blocksTooLateGroupSurvey?: boolean;
  channelId?: string;
  buttonUrlRules?: readonly AlimtalkButtonUrlRule[];
}

export const ALIMTALK_TEMPLATE_POLICIES: Record<AlimtalkTemplatePolicyKey, AlimtalkTemplatePolicy> = {
  reservation_open: {
    type: "reservation_open",
    code: "KA01TP260518023011547VpbovK8MrI9",
    label: "스튜디오메이트 예약 안내 v3",
    status: "approved",
    audience: "member",
    automationStatus: "active",
    sourceDatePolicy: "manual",
    requiresApprovedTemplate: true,
    requiresMemberPhone: true,
    targetRules: ["운영자가 확정한 예약 오픈 주차", "예약 안내 수신 대상", "예약주차 변수가 있음"],
    exclusionRules: ["전화번호 없음", "예약주차 변수 없음", "동일 예약주차 6일 내 발송 이력 있음", "SOLAPI 미승인 템플릿"],
    dedupePolicy: { label: "예약 오픈 안내 주간 반복", windowDays: 6 },
  },
  new_member: {
    type: "new_member",
    code: "KA01TP260514081318309wQGfeIJxIAJ",
    label: "신규회원 웰컴 v3",
    status: "approved",
    audience: "member",
    automationStatus: "active",
    minSourceDate: NEW_MEMBER_ALIMTALK_START_DATE,
    sourceDatePolicy: "recent_new_member",
    maxAgeDays: NEW_MEMBER_ALIMTALK_WINDOW_DAYS,
    requiresApprovedTemplate: true,
    requiresMemberPhone: true,
    targetRules: [
      "StudioMate 등록일 기준 신규회원",
      "전화번호가 있음",
      "활성 수업 수강권이 1개 이상 있음",
      `등록일이 ${NEW_MEMBER_ALIMTALK_START_DATE} 이후이고 최근 ${NEW_MEMBER_ALIMTALK_WINDOW_DAYS}일 이내`,
    ],
    exclusionRules: [
      "알림톡 제외 회원",
      "보호 스텝/강사 연락처",
      "전화번호 없음",
      "활성 수업 수강권 없음",
      "상담 고객 또는 수업권이 아닌 상품만 보유",
      "신규회원 웰컴 발송 이력 있음",
      "SOLAPI 미승인 템플릿",
    ],
    dedupePolicy: { label: "신규회원 웰컴 영구 1회", windowDays: null },
  },
  private_survey: {
    type: "private_survey",
    code: "KA01TP260514153632171uiWXYoeiOLS",
    label: "프라이빗 사전설문 안내 v1",
    status: "approved",
    audience: "member",
    automationStatus: "active",
    minSourceDate: PRIVATE_SURVEY_ALIMTALK_START_DATE,
    sourceDatePolicy: "today",
    requiresApprovedTemplate: true,
    requiresMemberPhone: true,
    targetRules: [
      "오늘부터 다음 주 일요일까지 예정된 첫 프라이빗 예약이 있음",
      "예약이 강사레슨이 아님",
      "최근 1년 내 프라이빗 사전설문 제출 이력이 없음",
      "과거 프라이빗 출석 완료 이력이 없음",
    ],
    exclusionRules: [
      "알림톡 제외 회원",
      "보호 스텝/강사 연락처",
      "전화번호 없음",
      "프라이빗 예약 없음",
      "그룹 또는 강사레슨 예약",
      "최근 1년 내 프라이빗 사전설문 제출 이력 있음",
      "과거 프라이빗 출석 완료 이력 있음",
      "SOLAPI 미승인 템플릿",
    ],
    dedupePolicy: { label: "프라이빗 사전설문 영구 1회", windowDays: null },
  },
  group_survey: {
    type: "group_survey",
    code: "KA01TP2605210729364330NbhZVAu9zA",
    label: "그룹 첫 수업 사전확인 안내 v1",
    status: "approved",
    audience: "member",
    automationStatus: "active",
    minSourceDate: GROUP_SURVEY_ALIMTALK_START_DATE,
    sourceDatePolicy: "today",
    requiresApprovedTemplate: true,
    requiresMemberPhone: true,
    blocksTooLateGroupSurvey: true,
    buttonUrlRules: [
      { label: "그룹 사전확인 작성 버튼", template: GROUP_SURVEY_BUTTON_URL_TEMPLATE, maxLength: SOLAPI_BUTTON_URL_MAX_LENGTH },
      { label: "그룹 사전확인 작성 버튼", template: SHORT_LINK_BUTTON_URL_TEMPLATE, maxLength: SOLAPI_BUTTON_URL_MAX_LENGTH },
    ],
    targetRules: [
      "오늘부터 다음 주 일요일까지 예정된 첫 그룹수업 예약이 있음",
      "예약이 강사레슨이 아님",
      "최근 1년 내 그룹 사전확인 제출 이력이 없음",
      "과거 그룹 출석 완료 이력이 없음",
    ],
    exclusionRules: [
      "알림톡 제외 회원",
      "보호 스텝/강사 연락처",
      "전화번호 없음",
      "그룹 예약 없음",
      "프라이빗 또는 강사레슨 예약",
      "최근 1년 내 그룹 사전확인 제출 이력 있음",
      "과거 그룹 출석 완료 이력 있음",
      "수업 시작 30분 미만인 당일 급예약",
      "짧은 링크 생성 실패 또는 버튼 URL 치환 후 100자 초과",
      "SOLAPI 미승인 템플릿",
    ],
    dedupePolicy: { label: "그룹 첫 수업 사전확인 영구 1회", windowDays: null },
  },
  ticket_expiring: {
    type: "ticket_expiring",
    code: "KA01TP260514145047261araXgWLVFRs",
    label: "그룹 기간권 잔여기간 안내 v3",
    status: "approved",
    audience: "member",
    automationStatus: "active",
    sourceDatePolicy: "today",
    requiresApprovedTemplate: true,
    requiresMemberPhone: true,
    targetRules: ["활성 그룹 수강권", "만료일이 발송 기준일로부터 14일 이내", "다른 유효 수업 수강권 없음"],
    exclusionRules: [
      "알림톡 제외 회원",
      "보호 스텝/강사 연락처",
      "전화번호 없음",
      "프라이빗 또는 강사레슨 수강권",
      "수업권이 아닌 상품",
      "다른 유효 수업 수강권 보유",
      "만료일이 지났거나 14일 초과",
      "동일 수강권 기간 안내 30일 내 발송 이력 있음",
      "SOLAPI 미승인 템플릿",
    ],
    dedupePolicy: { label: "수강권별 기간 안내 30일", windowDays: 30 },
  },
  remaining_low: {
    type: "remaining_low",
    code: "KA01TP260514145047393VpTbcCZKkCV",
    label: "그룹 횟수권 잔여횟수 안내 v3",
    status: "approved",
    audience: "member",
    automationStatus: "active",
    sourceDatePolicy: "today",
    requiresApprovedTemplate: true,
    requiresMemberPhone: true,
    targetRules: ["활성 그룹 횟수권", "잔여횟수 1-4회", "다른 유효 수업 수강권 없음"],
    exclusionRules: [
      "알림톡 제외 회원",
      "보호 스텝/강사 연락처",
      "전화번호 없음",
      "프라이빗 또는 강사레슨 수강권",
      "수업권이 아닌 상품",
      "다른 유효 수업 수강권 보유",
      "잔여횟수 0회 또는 5회 이상",
      "동일 수강권 횟수 안내 30일 내 발송 이력 있음",
      "SOLAPI 미승인 템플릿",
    ],
    dedupePolicy: { label: "수강권별 횟수 안내 30일", windowDays: 30 },
  },
  private_count_low: {
    type: "private_count_low",
    code: "KA01TP260514152235608d9icGOBotnV",
    label: "프라이빗 횟수권 잔여횟수 안내 v1",
    status: "approved",
    audience: "member",
    automationStatus: "active",
    sourceDatePolicy: "today",
    requiresApprovedTemplate: true,
    requiresMemberPhone: true,
    targetRules: ["활성 프라이빗 횟수권", "잔여횟수 1-3회", "다른 유효 수업 수강권 없음"],
    exclusionRules: [
      "알림톡 제외 회원",
      "보호 스텝/강사 연락처",
      "전화번호 없음",
      "그룹 또는 강사레슨 수강권",
      "수업권이 아닌 상품",
      "다른 유효 수업 수강권 보유",
      "잔여횟수 0회 또는 4회 이상",
      "동일 수강권 횟수 안내 30일 내 발송 이력 있음",
      "SOLAPI 미승인 템플릿",
    ],
    dedupePolicy: { label: "프라이빗 수강권별 횟수 안내 30일", windowDays: 30 },
  },
  private_ticket_expiring: {
    type: "private_ticket_expiring",
    code: "KA01TP260514153314927WH270IppWQS",
    label: "프라이빗 기간권 잔여기간 안내 v1",
    status: "approved",
    audience: "member",
    automationStatus: "active",
    sourceDatePolicy: "today",
    requiresApprovedTemplate: true,
    requiresMemberPhone: true,
    targetRules: ["활성 프라이빗 수강권", "만료일이 발송 기준일로부터 14일 이내", "다른 유효 수업 수강권 없음"],
    exclusionRules: [
      "알림톡 제외 회원",
      "보호 스텝/강사 연락처",
      "전화번호 없음",
      "그룹 또는 강사레슨 수강권",
      "수업권이 아닌 상품",
      "다른 유효 수업 수강권 보유",
      "만료일이 지났거나 14일 초과",
      "동일 수강권 기간 안내 30일 내 발송 이력 있음",
      "SOLAPI 미승인 템플릿",
    ],
    dedupePolicy: { label: "프라이빗 수강권별 기간 안내 30일", windowDays: 30 },
  },
  long_absence: {
    type: "long_absence",
    code: "KA01TP260524083643752cySb9BoDOjN",
    label: "장기 미방문 수업안내 v1",
    status: "approved",
    audience: "member",
    automationStatus: "active",
    minSourceDate: LONG_ABSENCE_ALIMTALK_START_DATE,
    sourceDatePolicy: "today",
    requiresApprovedTemplate: true,
    requiresMemberPhone: true,
    targetRules: [
      "활성 수업 수강권 보유",
      `회원목록 엑셀 최근출석일 또는 예약 출석 완료일 중 더 최신값이 발송 기준일로부터 ${LONG_ABSENCE_MIN_DAYS}일 이상 지남`,
      "마지막 출석일과 보유 수강권명이 변수로 있음",
    ],
    exclusionRules: [
      "알림톡 제외 회원",
      "보호 스텝/강사 연락처",
      "전화번호 없음",
      "활성 수업 수강권 없음",
      "수강권 정지중/중지/홀딩 상태",
      "1회권/1회상품권 등 일회성 수강권 보유",
      "강사레슨 수강권 보유",
      "발송 기준일 당일 또는 이후 예정 예약이 있음",
      "출석 완료 이력 없음",
      `마지막 출석 완료일이 ${LONG_ABSENCE_MIN_DAYS}일 미만`,
      "동일 회원의 같은 마지막 출석일 기준 장기 미방문 안내 발송 이력 있음",
      "SOLAPI 미승인 템플릿",
    ],
    dedupePolicy: { label: "장기 미방문 같은 마지막 출석일 1회", windowDays: null },
  },
  staff_private_survey: {
    code: "KA01TP260519093416836f1EHZYJ00uM",
    label: "담당강사 사전설문 제출 안내 v1",
    status: "approved",
    audience: "staff",
    automationStatus: "active",
    sourceDatePolicy: "today",
    requiresApprovedTemplate: true,
    requiresMemberPhone: true,
    targetRules: ["프라이빗 사전설문 제출 완료", "담당 프라이빗 수업 매칭", "강사 연락처가 있음"],
    exclusionRules: ["담당 수업 매칭 실패", "강사 연락처 없음", "SOLAPI 미승인 템플릿"],
    dedupePolicy: { label: "프라이빗 설문 제출별 1회", windowDays: null },
  },
  staff_group_survey: {
    code: "KA01TP260522041704111wu4Z0cu9cgl",
    label: "첫 그룹수업 회원 확인 v1",
    status: "approved",
    audience: "staff",
    automationStatus: "active",
    sourceDatePolicy: "today",
    requiresApprovedTemplate: true,
    requiresMemberPhone: true,
    targetRules: ["그룹 사전확인 제출 완료", "첫 그룹수업 예약 매칭", "강사 연락처가 있음"],
    exclusionRules: ["담당 수업 매칭 실패", "강사 연락처 없음", "SOLAPI 미승인 템플릿"],
    dedupePolicy: { label: "그룹 설문 제출별 1회", windowDays: null },
  },
  instructor_lesson_material: {
    type: "instructor_lesson_material",
    code: "KA01TP260521120040094XcMvYgFTryj",
    label: "강사레슨 수업자료 안내 v1",
    status: "approved",
    audience: "instructor_lesson_member",
    automationStatus: "active",
    channelId: INSTRUCTOR_LESSON_ALIMTALK_CHANNEL_ID,
    sourceDatePolicy: "today",
    requiresApprovedTemplate: true,
    requiresMemberPhone: true,
    requiresManagementNumber: true,
    buttonUrlRules: [
      { label: "강사레슨 수업자료 버튼", template: METHOD_MATERIAL_BUTTON_URL_TEMPLATE, maxLength: SOLAPI_BUTTON_URL_MAX_LENGTH },
      { label: "강사레슨 수업자료 버튼", template: SHORT_LINK_BUTTON_URL_TEMPLATE, maxLength: SOLAPI_BUTTON_URL_MAX_LENGTH },
    ],
    targetRules: [
      "강사레슨 예약",
      "수업 하루 전 후보",
      "수업명에 영문 주제명이 있음",
      "관리번호는 영문주제-수업날짜6자리 형식",
      "강사레슨 카카오 채널 템플릿 사용",
    ],
    exclusionRules: [
      "전화번호 없음",
      "강사레슨 예약 아님",
      "수업명에서 영문 주제명 추출 실패",
      "수업자료 관리번호 없음",
      "짧은 링크 생성 실패 또는 버튼 URL 치환 후 100자 초과",
      "같은 수업자료와 수업일 조합 발송 이력 있음",
      "SOLAPI 미승인 템플릿",
    ],
    dedupePolicy: { label: "강사레슨 수업자료 수업별 1회", windowDays: null },
  },
};

export const SENDABLE_ALIMTALK_CANDIDATE_TYPES = [
  "reservation_open",
  "new_member",
  "private_survey",
  "group_survey",
  "instructor_lesson_material",
  "ticket_expiring",
  "remaining_low",
  "private_count_low",
  "private_ticket_expiring",
  "long_absence",
] as const satisfies readonly SendableAlimtalkCandidateType[];
