import type { AlimtalkCandidateType } from "../types/models";
import {
  ALIMTALK_TEMPLATES,
  GROUP_SURVEY_ALIMTALK_START_DATE,
  LONG_ABSENCE_ALIMTALK_START_DATE,
  NEW_MEMBER_ALIMTALK_START_DATE,
  NEW_MEMBER_ALIMTALK_WINDOW_DAYS,
  PRIVATE_SURVEY_ALIMTALK_START_DATE,
} from "./templates";

export interface AlimtalkTemplateTargetRule {
  type: AlimtalkCandidateType;
  templateCode: string;
  templateLabel: string;
  targetRules: string[];
  exclusionRules: string[];
  minSourceDate?: string;
  sourceDatePolicy: "today" | "recent_new_member" | "same_or_before_today" | "manual";
  maxAgeDays?: number;
  requiresApprovedTemplate: boolean;
  requiresMemberPhone: boolean;
  requiresManagementNumber?: boolean;
  blocksTooLateGroupSurvey?: boolean;
  buttonUrlRules?: AlimtalkButtonUrlRule[];
}

export interface AlimtalkButtonUrlRule {
  label: string;
  template: string;
  maxLength: number;
}

export const SOLAPI_BUTTON_URL_MAX_LENGTH = 100;
export const SHORT_LINK_BUTTON_URL_TEMPLATE = "https://in.archivepilates.com/s/#{링크ID}/";
export const SURVEY_DETAIL_BUTTON_URL_TEMPLATE =
  "https://in.archivepilates.com/privateSurveyResponseView?id=#{설문ID}&token=#{접근토큰}";
export const GROUP_SURVEY_BUTTON_URL_TEMPLATE =
  "https://in.archivepilates.com/groupSurvey?id=#{설문ID}&token=#{접근토큰}";
export const METHOD_MATERIAL_BUTTON_URL_TEMPLATE = "https://in.archivepilates.com/method/#{관리번호}";
export const PRIVATE_REPORT_BUTTON_URL_TEMPLATE = "https://in.archivepilates.com/s/#{리포트링크ID}/";

export const ALIMTALK_TEMPLATE_TARGET_RULES: Partial<Record<AlimtalkCandidateType, AlimtalkTemplateTargetRule>> = {
  reservation_open: {
    type: "reservation_open",
    templateCode: ALIMTALK_TEMPLATES.reservation_open.code,
    templateLabel: ALIMTALK_TEMPLATES.reservation_open.label,
    sourceDatePolicy: "today",
    requiresApprovedTemplate: true,
    requiresMemberPhone: true,
    targetRules: [
      "월요일 예약 오픈 안내일",
      "예약 오픈 주간에 유효한 그룹 또는 혼합 수강권 보유",
      "프라이빗/강사레슨 수강권 제외",
      "예약주차 변수가 있음",
    ],
    exclusionRules: [
      "전화번호 없음",
      "예약주차 변수 없음",
      "예약 오픈 주간에 유효한 그룹/혼합 수강권 없음",
      "프라이빗 또는 강사레슨 수강권",
      "동일 예약주차 6일 내 발송 이력 있음",
      "SOLAPI 미승인 템플릿",
    ],
  },
  new_member: {
    type: "new_member",
    templateCode: ALIMTALK_TEMPLATES.new_member.code,
    templateLabel: ALIMTALK_TEMPLATES.new_member.label,
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
      "전화번호 없음",
      "활성 수업 수강권 없음",
      "상담 고객 또는 수업권이 아닌 상품만 보유",
      "신규회원 웰컴 발송 이력 있음",
      "SOLAPI 미승인 템플릿",
    ],
  },
  onsite_welcome: {
    type: "onsite_welcome",
    templateCode: ALIMTALK_TEMPLATES.onsite_welcome.code,
    templateLabel: ALIMTALK_TEMPLATES.onsite_welcome.label,
    sourceDatePolicy: "today",
    requiresApprovedTemplate: true,
    requiresMemberPhone: true,
    buttonUrlRules: [
      {
        label: "회원가입서 작성 버튼",
        template: SHORT_LINK_BUTTON_URL_TEMPLATE,
        maxLength: SOLAPI_BUTTON_URL_MAX_LENGTH,
      },
    ],
    targetRules: [
      "현장 웰컴 페이지에서 가입서 링크가 준비된 lookup_ready 요청",
      "직원이 웰컴 페이지의 알림톡 전송 버튼을 직접 클릭",
      "StudioMate 전화번호 단건 조회 성공",
      "회원가입서 초안과 짧은 링크가 있음",
      "기존 신규회원 웰컴 발송 이력이 없음",
    ],
    exclusionRules: [
      "전화번호 없음",
      "회원가입서 링크 없음",
      "신규회원 웰컴 v5 템플릿 코드 미설정 또는 미승인",
      "기존 신규회원 웰컴 발송 이력 있음",
      "같은 현장 웰컴 요청 이미 sent/error 처리",
    ],
  },
  private_survey: {
    type: "private_survey",
    templateCode: ALIMTALK_TEMPLATES.private_survey.code,
    templateLabel: ALIMTALK_TEMPLATES.private_survey.label,
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
      "전화번호 없음",
      "프라이빗 예약 없음",
      "그룹 또는 강사레슨 예약",
      "최근 1년 내 프라이빗 사전설문 제출 이력 있음",
      "과거 프라이빗 출석 완료 이력 있음",
      "SOLAPI 미승인 템플릿",
    ],
  },
  group_survey: {
    type: "group_survey",
    templateCode: ALIMTALK_TEMPLATES.group_survey.code,
    templateLabel: ALIMTALK_TEMPLATES.group_survey.label,
    minSourceDate: GROUP_SURVEY_ALIMTALK_START_DATE,
    sourceDatePolicy: "today",
    requiresApprovedTemplate: true,
    requiresMemberPhone: true,
    blocksTooLateGroupSurvey: true,
    buttonUrlRules: [
      {
        label: "그룹 사전확인 작성 버튼",
        template: GROUP_SURVEY_BUTTON_URL_TEMPLATE,
        maxLength: SOLAPI_BUTTON_URL_MAX_LENGTH,
      },
      {
        label: "그룹 사전확인 작성 버튼",
        template: SHORT_LINK_BUTTON_URL_TEMPLATE,
        maxLength: SOLAPI_BUTTON_URL_MAX_LENGTH,
      },
    ],
    targetRules: [
      "오늘부터 다음 주 일요일까지 예정된 첫 그룹수업 예약이 있음",
      "예약이 강사레슨이 아님",
      "최근 1년 내 그룹 사전확인 제출 이력이 없음",
      "과거 그룹 출석 완료 이력이 없음",
    ],
    exclusionRules: [
      "알림톡 제외 회원",
      "전화번호 없음",
      "그룹 예약 없음",
      "프라이빗 또는 강사레슨 예약",
      "최근 1년 내 그룹 사전확인 제출 이력 있음",
      "과거 그룹 출석 완료 이력 있음",
      "수업 시작 30분 미만인 당일 급예약",
      "짧은 링크 생성 실패 또는 버튼 URL 치환 후 100자 초과",
      "SOLAPI 미승인 템플릿",
    ],
  },
  ticket_expiring: {
    type: "ticket_expiring",
    templateCode: ALIMTALK_TEMPLATES.ticket_expiring.code,
    templateLabel: ALIMTALK_TEMPLATES.ticket_expiring.label,
    sourceDatePolicy: "today",
    requiresApprovedTemplate: true,
    requiresMemberPhone: true,
    targetRules: [
      "활성 그룹 수강권",
      "만료일이 발송 기준일로부터 14일 이내",
      "다른 현재 또는 사용예정 유효 수업 수강권 없음",
    ],
    exclusionRules: [
      "알림톡 제외 회원",
      "전화번호 없음",
      "프라이빗 또는 강사레슨 수강권",
      "수업권이 아닌 상품",
      "다른 현재 또는 사용예정 유효 수업 수강권 보유",
      "만료일이 지났거나 14일 초과",
      "동일 수강권 기간 안내 30일 내 발송 이력 있음",
      "SOLAPI 미승인 템플릿",
    ],
  },
  remaining_low: {
    type: "remaining_low",
    templateCode: ALIMTALK_TEMPLATES.remaining_low.code,
    templateLabel: ALIMTALK_TEMPLATES.remaining_low.label,
    sourceDatePolicy: "today",
    requiresApprovedTemplate: true,
    requiresMemberPhone: true,
    targetRules: ["활성 그룹 횟수권", "잔여횟수 1-4회", "다른 현재 또는 사용예정 유효 수업 수강권 없음"],
    exclusionRules: [
      "알림톡 제외 회원",
      "전화번호 없음",
      "프라이빗 또는 강사레슨 수강권",
      "수업권이 아닌 상품",
      "다른 현재 또는 사용예정 유효 수업 수강권 보유",
      "잔여횟수 0회 또는 5회 이상",
      "동일 수강권 횟수 안내 30일 내 발송 이력 있음",
      "SOLAPI 미승인 템플릿",
    ],
  },
  private_count_low: {
    type: "private_count_low",
    templateCode: ALIMTALK_TEMPLATES.private_count_low.code,
    templateLabel: ALIMTALK_TEMPLATES.private_count_low.label,
    sourceDatePolicy: "today",
    requiresApprovedTemplate: true,
    requiresMemberPhone: true,
    targetRules: ["활성 프라이빗 횟수권", "잔여횟수 1-3회", "다른 현재 또는 사용예정 유효 수업 수강권 없음"],
    exclusionRules: [
      "알림톡 제외 회원",
      "전화번호 없음",
      "그룹 또는 강사레슨 수강권",
      "수업권이 아닌 상품",
      "다른 현재 또는 사용예정 유효 수업 수강권 보유",
      "잔여횟수 0회 또는 4회 이상",
      "동일 수강권 횟수 안내 30일 내 발송 이력 있음",
      "SOLAPI 미승인 템플릿",
    ],
  },
  private_ticket_expiring: {
    type: "private_ticket_expiring",
    templateCode: ALIMTALK_TEMPLATES.private_ticket_expiring.code,
    templateLabel: ALIMTALK_TEMPLATES.private_ticket_expiring.label,
    sourceDatePolicy: "today",
    requiresApprovedTemplate: true,
    requiresMemberPhone: true,
    targetRules: [
      "활성 프라이빗 수강권",
      "만료일이 발송 기준일로부터 14일 이내",
      "다른 현재 또는 사용예정 유효 수업 수강권 없음",
    ],
    exclusionRules: [
      "알림톡 제외 회원",
      "전화번호 없음",
      "그룹 또는 강사레슨 수강권",
      "수업권이 아닌 상품",
      "다른 현재 또는 사용예정 유효 수업 수강권 보유",
      "만료일이 지났거나 14일 초과",
      "동일 수강권 기간 안내 30일 내 발송 이력 있음",
      "SOLAPI 미승인 템플릿",
    ],
  },
  long_absence: {
    type: "long_absence",
    templateCode: ALIMTALK_TEMPLATES.long_absence.code,
    templateLabel: ALIMTALK_TEMPLATES.long_absence.label,
    minSourceDate: LONG_ABSENCE_ALIMTALK_START_DATE,
    sourceDatePolicy: "today",
    requiresApprovedTemplate: true,
    requiresMemberPhone: true,
    targetRules: [
      "활성 수업 수강권 보유",
      "마지막 출석 완료일이 발송 기준일로부터 7일 이상 지남",
      "마지막 출석일과 보유 수강권명이 변수로 있음",
    ],
    exclusionRules: [
      "알림톡 제외 회원",
      "전화번호 없음",
      "활성 수업 수강권 없음",
      "수강권 정지중/중지/홀딩 상태",
      "출석 완료 이력 없음",
      "발송 기준일 이후 예정 예약 있음",
      "마지막 출석 완료일이 7일 미만",
      "동일 회원 장기 미방문 안내 14일 내 발송 이력 있음",
      "SOLAPI 미승인 템플릿",
    ],
  },
  instructor_lesson_material: {
    type: "instructor_lesson_material",
    templateCode: ALIMTALK_TEMPLATES.instructor_lesson_material.code,
    templateLabel: ALIMTALK_TEMPLATES.instructor_lesson_material.label,
    sourceDatePolicy: "today",
    requiresApprovedTemplate: true,
    requiresMemberPhone: true,
    requiresManagementNumber: true,
    buttonUrlRules: [
      {
        label: "강사레슨 수업자료 버튼",
        template: METHOD_MATERIAL_BUTTON_URL_TEMPLATE,
        maxLength: SOLAPI_BUTTON_URL_MAX_LENGTH,
      },
      {
        label: "강사레슨 수업자료 버튼",
        template: SHORT_LINK_BUTTON_URL_TEMPLATE,
        maxLength: SOLAPI_BUTTON_URL_MAX_LENGTH,
      },
    ],
    targetRules: ["강사레슨 예약", "수업 하루 전 후보", "수업자료 관리번호가 있음", "강사레슨 카카오 채널 템플릿 사용"],
    exclusionRules: [
      "전화번호 없음",
      "강사레슨 예약 아님",
      "수업자료 관리번호 없음",
      "짧은 링크 생성 실패 또는 버튼 URL 치환 후 100자 초과",
      "같은 수업자료와 수업일 조합 발송 이력 있음",
      "SOLAPI 미승인 템플릿",
    ],
  },
  private_lesson_report: {
    type: "private_lesson_report",
    templateCode: ALIMTALK_TEMPLATES.private_lesson_report.code,
    templateLabel: ALIMTALK_TEMPLATES.private_lesson_report.label,
    sourceDatePolicy: "same_or_before_today",
    requiresApprovedTemplate: true,
    requiresMemberPhone: true,
    buttonUrlRules: [
      {
        label: "프라이빗 수업 리포트 버튼",
        template: PRIVATE_REPORT_BUTTON_URL_TEMPLATE,
        maxLength: SOLAPI_BUTTON_URL_MAX_LENGTH,
      },
      {
        label: "프라이빗 인바디 리포트 버튼",
        template: "https://in.archivepilates.com/s/#{인바디링크ID}/",
        maxLength: SOLAPI_BUTTON_URL_MAX_LENGTH,
      },
    ],
    targetRules: [
      "수업 후 기록이 제출된 프라이빗 회차",
      "Gemini 회원용 리포트 초안이 생성됨",
      "회원용 HTML 리포트 URL이 있음",
      "Notion에서 발송 체크와 발송상태 대기 확인",
      "최신 인바디 리포트가 있으면 인바디 버튼에 연결하고, 없으면 측정 데이터 없음 안내 화면에 연결",
    ],
    exclusionRules: [
      "전화번호 없음",
      "수업 후 기록 미제출",
      "회원용 리포트 URL 없음",
      "Notion 발송 체크 전",
      "Notion 발송상태가 대기가 아님",
      "같은 회차 리포트 발송 이력 있음",
      "SOLAPI 미승인 템플릿",
    ],
  },
  inbody_report: {
    type: "inbody_report",
    templateCode: ALIMTALK_TEMPLATES.inbody_report.code,
    templateLabel: ALIMTALK_TEMPLATES.inbody_report.label,
    sourceDatePolicy: "same_or_before_today",
    requiresApprovedTemplate: true,
    requiresMemberPhone: true,
    buttonUrlRules: [
      {
        label: "인바디 리포트 버튼",
        template: PRIVATE_REPORT_BUTTON_URL_TEMPLATE,
        maxLength: SOLAPI_BUTTON_URL_MAX_LENGTH,
      },
    ],
    targetRules: [
      "프라이빗 유효회원",
      "인바디 측정 후 회원용 리포트 URL 생성 완료",
      "회원 전화번호가 있음",
      "운영자 승인 또는 자동 발송 조건 충족",
    ],
    exclusionRules: [
      "프라이빗 유효회원 아님",
      "전화번호 없음",
      "인바디 리포트 URL 없음",
      "같은 측정 또는 리포트 발송 이력 있음",
      "운영자 승인 전 또는 자동 발송 조건 미충족",
      "SOLAPI 미승인 템플릿",
    ],
  },
};

export function alimtalkTemplateTargetRule(type: string): AlimtalkTemplateTargetRule | null {
  return ALIMTALK_TEMPLATE_TARGET_RULES[type as AlimtalkCandidateType] || null;
}

export function renderAlimtalkButtonUrl(template: string, variables: Record<string, string>): string {
  return Object.entries(variables).reduce((url, [name, value]) => url.replaceAll(name, value), template);
}

export function solapiButtonUrlLengthIssue(input: {
  rules?: AlimtalkButtonUrlRule[];
  variables: Record<string, string>;
}): string {
  for (const rule of input.rules || []) {
    const url = renderAlimtalkButtonUrl(rule.template, input.variables);
    if (url.length > rule.maxLength)
      return `${rule.label} URL ${url.length}자: SOLAPI 버튼 URL은 ${rule.maxLength}자 이하`;
  }
  return "";
}

export function surveyDetailButtonUrlLengthIssue(
  responseId: string,
  accessToken: string,
  shortLinkId = "sv-000000000000",
): string {
  return solapiButtonUrlLengthIssue({
    rules: [
      {
        label: "설문 확인하기 버튼",
        template: SURVEY_DETAIL_BUTTON_URL_TEMPLATE,
        maxLength: SOLAPI_BUTTON_URL_MAX_LENGTH,
      },
      {
        label: "설문 확인하기 버튼",
        template: SHORT_LINK_BUTTON_URL_TEMPLATE,
        maxLength: SOLAPI_BUTTON_URL_MAX_LENGTH,
      },
    ],
    variables: {
      "#{설문ID}": responseId,
      "#{접근토큰}": accessToken,
      "#{링크ID}": shortLinkId,
    },
  });
}
