import type { AlimtalkCandidateType } from "../types/models";
import {
  ALIMTALK_TEMPLATES,
  GROUP_SURVEY_ALIMTALK_START_DATE,
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

export const ALIMTALK_TEMPLATE_TARGET_RULES: Partial<Record<AlimtalkCandidateType, AlimtalkTemplateTargetRule>> = {
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
    targetRules: ["활성 그룹 수강권", "만료일이 발송 기준일로부터 14일 이내", "다른 유효 수업 수강권 없음"],
    exclusionRules: [
      "알림톡 제외 회원",
      "전화번호 없음",
      "프라이빗 또는 강사레슨 수강권",
      "수업권이 아닌 상품",
      "다른 유효 수업 수강권 보유",
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
    targetRules: ["활성 그룹 횟수권", "잔여횟수 1-4회", "다른 유효 수업 수강권 없음"],
    exclusionRules: [
      "알림톡 제외 회원",
      "전화번호 없음",
      "프라이빗 또는 강사레슨 수강권",
      "수업권이 아닌 상품",
      "다른 유효 수업 수강권 보유",
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
    targetRules: ["활성 프라이빗 횟수권", "잔여횟수 1-3회", "다른 유효 수업 수강권 없음"],
    exclusionRules: [
      "알림톡 제외 회원",
      "전화번호 없음",
      "그룹 또는 강사레슨 수강권",
      "수업권이 아닌 상품",
      "다른 유효 수업 수강권 보유",
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
    targetRules: ["활성 프라이빗 수강권", "만료일이 발송 기준일로부터 14일 이내", "다른 유효 수업 수강권 없음"],
    exclusionRules: [
      "알림톡 제외 회원",
      "전화번호 없음",
      "그룹 또는 강사레슨 수강권",
      "수업권이 아닌 상품",
      "다른 유효 수업 수강권 보유",
      "만료일이 지났거나 14일 초과",
      "동일 수강권 기간 안내 30일 내 발송 이력 있음",
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
