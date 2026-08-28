import { addDays } from "../utils/date";
import {
  ALIMTALK_MEMBER_EXCLUSION_REASONS,
  ALIMTALK_TEMPLATES,
  INSTRUCTOR_LESSON_ALIMTALK_CHANNEL_ID,
  INSTRUCTOR_LESSON_CONFIRMATION_ALIMTALK_IMAGE_ID,
  LEGACY_PRIVATE_SURVEY_ALIMTALK_TEMPLATE_CODE,
  NATIVE_PRIVATE_SURVEY_ALIMTALK_IMAGE_ID,
  NATIVE_PRIVATE_SURVEY_ALIMTALK_TEMPLATE_CODE,
  RECOMMENDED_MEAL_ALIMTALK_CHANNEL_ID,
  RECOMMENDED_MEAL_ALIMTALK_IMAGE_ID,
  RECOMMENDED_MEAL_ALIMTALK_TEMPLATE_CODE,
  RECOMMENDED_MEAL_REPORT_ALIMTALK_TEMPLATE_CODE,
  RESERVATION_OPEN_ALIMTALK_IMAGE_ID,
} from "./templates";
import type { AlimtalkCandidateDoc } from "../types/models";
import { shortLinkIdForTarget } from "../utils/shortLinks";
import {
  alimtalkImageTemplateContractIssue,
  alimtalkTemplateReadiness,
  type AlimtalkTemplateState,
} from "./templateStatus";
import {
  INSTRUCTOR_LESSON_VISIT_BUTTON_URL,
  METHOD_CALENDAR_BUTTON_URL_TEMPLATE,
  alimtalkTemplateTargetRule,
  solapiButtonUrlLengthIssue,
} from "./templateTargetRules";
import {
  isValidInstructorLessonManagementNumber,
  normalizeInstructorLessonManagementNumber,
} from "./instructorLessonManagement";
import { hasExplicitAlimtalkTestOverride, isAlimtalkTestRecipient } from "./testRecipients";

export const RETRYABLE_TEMPLATE_STATUS_PREFIX = "템플릿 상태 확인 일시 실패:";
const PRIVATE_SURVEY_BUTTON_URL = "https://in.archivepilates.com/s/#{링크ID}/";
const RECOMMENDED_MEAL_SURVEY_BUTTON_URL = "https://in.archivepilates.com/s/#{링크ID}/";
const RECOMMENDED_MEAL_REPORT_BUTTON_URL = "https://in.archivepilates.com/s/#{리포트링크ID}/";
const RESERVATION_NOTICE_BUTTON_URL = "https://archivepilates.notion.site/notice";
const RESERVATION_METHOD_BUTTON_URL = "https://archivepilates.notion.site/studiomate";

export async function autoSendabilityIssue(candidate: AlimtalkCandidateDoc, today: string): Promise<string> {
  const rule = alimtalkTemplateTargetRule(candidate.type);
  if (rule?.requiresMemberPhone && !candidate.memberPhone) return "전화번호 없음";
  if (ALIMTALK_MEMBER_EXCLUSION_REASONS[candidate.memberId] && !hasExplicitAlimtalkTestOverride(candidate))
    return ALIMTALK_MEMBER_EXCLUSION_REASONS[candidate.memberId];
  if (isAlimtalkTestRecipient(candidate) && !hasExplicitAlimtalkTestOverride(candidate)) {
    return "스텝 계정 알림톡 제외";
  }
  const templateContractIssue =
    privateSurveyTemplateContractIssue(candidate) ||
    instructorLessonTemplateContractIssue(candidate) ||
    recommendedMealTemplateContractIssue(candidate) ||
    recommendedMealReportTemplateContractIssue(candidate) ||
    instructorLessonConfirmationTemplateContractIssue(candidate) ||
    reservationOpenTemplateContractIssue(candidate);
  if (templateContractIssue) return templateContractIssue;
  if (rule?.requiresApprovedTemplate) {
    const readiness = await alimtalkTemplateReadiness(candidate.templateCode);
    if (readiness.retryable) {
      return `${RETRYABLE_TEMPLATE_STATUS_PREFIX} ${candidate.templateCode}`;
    }
    if (!readiness.approved) return `승인 템플릿 코드 아님: ${candidate.templateCode}`;
    const remoteContractIssue =
      privateSurveyTemplateContractIssue(candidate, readiness.state) ||
      instructorLessonTemplateContractIssue(candidate) ||
      recommendedMealTemplateContractIssue(candidate, readiness.state) ||
      recommendedMealReportTemplateContractIssue(candidate, readiness.state) ||
      instructorLessonConfirmationTemplateContractIssue(candidate, readiness.state) ||
      reservationOpenTemplateContractIssue(candidate, readiness.state);
    if (remoteContractIssue) return remoteContractIssue;
  }
  if ((candidate.attempts || 0) >= (candidate.maxAttempts || 2)) return "발송 실패 재시도 한도 초과";
  if (candidate.sourceDate && candidate.sourceDate > today) return "대상일이 발송 기준일 이후";
  if (rule?.minSourceDate && candidate.sourceDate < rule.minSourceDate) return `${rule.templateLabel} 시작일 이전 후보`;
  if (rule?.sourceDatePolicy === "today" && candidate.sourceDate !== today)
    return `${rule.templateLabel}은 발송 기준일 후보만 발송`;
  if (rule?.sourceDatePolicy === "recent_new_member") {
    if (rule.maxAgeDays && candidate.sourceDate < addDays(today, -(rule.maxAgeDays - 1))) {
      return `${rule.templateLabel}은 등록 ${rule.maxAgeDays}일 이내 후보만 발송`;
    }
  }
  const payloadIssue = requiredPayloadIssue(candidate);
  if (payloadIssue) return payloadIssue;
  if (candidate.type === "reservation_open" && !(candidate.payload?.reservationWeek || candidate.payload?.weekLabel)) {
    return "예약주차 변수 없음";
  }
  if (candidate.type === "pricing_info" && !candidate.payload?.pricingUrl) return "수강료 안내 링크 없음";
  if (candidate.type === "recommended_meal_survey") {
    if (!candidate.payload?.shortLinkId) return "추천식단 설문 짧은 링크 없음";
    if (!candidate.payload?.reportLinkId) return "추천식단 리포트 짧은 링크 없음";
  }
  if (candidate.type === "recommended_meal_report" && !candidate.payload?.shortLinkId)
    return "추천식단 리포트 짧은 링크 없음";
  if (rule?.requiresManagementNumber) {
    const rawManagementNumber = String(
      candidate.payload?.managementNumber ||
        candidate.payload?.materialNumber ||
        candidate.payload?.archiveMethodId ||
        "",
    );
    if (!rawManagementNumber) return "강사레슨 수업자료 관리번호 없음";
    const managementNumber = normalizeInstructorLessonManagementNumber(rawManagementNumber);
    if (!managementNumber) return "강사레슨 수업자료 관리번호 형식 오류";
    if (candidate.type === "instructor_lesson_material" && !isValidInstructorLessonManagementNumber(managementNumber)) {
      return "강사레슨 수업자료 관리번호 형식 오류";
    }
  }
  const buttonUrlIssue = solapiButtonUrlLengthIssue({
    rules: rule?.buttonUrlRules,
    variables: candidateTemplateVariables(candidate),
  });
  if (buttonUrlIssue) return buttonUrlIssue;
  if (rule?.blocksTooLateGroupSurvey && candidate.payload?.groupSurveyDeliveryMode === "too_late")
    return "수업 시작 30분 미만 첫 그룹수업은 설문 발송 대신 현장 확인";
  return "";
}

export function isRetryableTemplateStatusIssue(issue: string): boolean {
  return String(issue || "").startsWith(RETRYABLE_TEMPLATE_STATUS_PREFIX);
}

export function instructorLessonTemplateContractIssue(candidate: AlimtalkCandidateDoc): string {
  if (candidate.type !== "instructor_lesson_material") return "";
  const configuredTemplateCode = ALIMTALK_TEMPLATES.instructor_lesson_material.code;
  if (candidate.templateCode !== configuredTemplateCode) {
    return `강사레슨 수업자료 V3 템플릿 설정 불일치: ${candidate.templateCode}`;
  }
  return "";
}

export function privateSurveyTemplateContractIssue(
  candidate: AlimtalkCandidateDoc,
  state: AlimtalkTemplateState | null = null,
  configuredTemplateCode = String(
    process.env.PRIVATE_SURVEY_ALIMTALK_TEMPLATE_ID || NATIVE_PRIVATE_SURVEY_ALIMTALK_TEMPLATE_CODE,
  ).trim(),
): string {
  if (candidate.type !== "private_survey") return "";
  if (candidate.templateCode === LEGACY_PRIVATE_SURVEY_ALIMTALK_TEMPLATE_CODE) {
    return "프라이빗 자체설문 링크형 v2 템플릿 승인·설정 전";
  }
  if (!configuredTemplateCode) return "프라이빗 자체설문 링크형 v2 템플릿 런타임 설정 없음";
  if (candidate.templateCode !== configuredTemplateCode) {
    return `프라이빗 사전설문 템플릿 설정 불일치: ${candidate.templateCode}`;
  }
  if (!state) return "";
  const imageContractIssue = alimtalkImageTemplateContractIssue(
    state,
    NATIVE_PRIVATE_SURVEY_ALIMTALK_IMAGE_ID,
    "프라이빗 사전설문 템플릿",
  );
  if (imageContractIssue) return imageContractIssue;
  if (!state.channelId) return "프라이빗 사전설문 템플릿 채널 ID 없음";
  if (!String(state.content || "").includes("#{이름}")) {
    return "프라이빗 사전설문 템플릿 회원명 변수 없음";
  }
  if (!(state.buttonUrls || []).includes(PRIVATE_SURVEY_BUTTON_URL)) {
    return "프라이빗 사전설문 템플릿 자체설문 버튼 URL 불일치";
  }
  return "";
}

export function reservationOpenTemplateContractIssue(
  candidate: AlimtalkCandidateDoc,
  state: AlimtalkTemplateState | null = null,
): string {
  if (candidate.type !== "reservation_open") return "";
  if (candidate.templateCode !== ALIMTALK_TEMPLATES.reservation_open.code) {
    return `예약오픈 안내 템플릿 설정 불일치: ${candidate.templateCode}`;
  }
  if (!state) return "";
  const imageContractIssue = alimtalkImageTemplateContractIssue(
    state,
    RESERVATION_OPEN_ALIMTALK_IMAGE_ID,
    "예약오픈 안내 템플릿",
  );
  if (imageContractIssue) return imageContractIssue;
  const contractText = String(state.content || "");
  if (!contractText.includes("#{이름}")) return "예약오픈 안내 템플릿 회원명 변수 없음";
  if (!contractText.includes("#{예약주차}")) return "예약오픈 안내 템플릿 예약주차 변수 없음";
  const buttonUrls = state.buttonUrls || [];
  if (!buttonUrls.includes(RESERVATION_NOTICE_BUTTON_URL)) {
    return "예약오픈 안내 템플릿 예약안내 버튼 URL 불일치";
  }
  if (!buttonUrls.includes(RESERVATION_METHOD_BUTTON_URL)) {
    return "예약오픈 안내 템플릿 예약방법 버튼 URL 불일치";
  }
  return "";
}

export function instructorLessonConfirmationTemplateContractIssue(
  candidate: AlimtalkCandidateDoc,
  state: AlimtalkTemplateState | null = null,
): string {
  if (candidate.type !== "instructor_lesson_confirmation") return "";
  if (candidate.templateCode !== ALIMTALK_TEMPLATES.instructor_lesson_confirmation.code) {
    return `강사레슨 예약확정 템플릿 설정 불일치: ${candidate.templateCode}`;
  }
  if (!state) return "";
  const imageContractIssue = alimtalkImageTemplateContractIssue(
    state,
    INSTRUCTOR_LESSON_CONFIRMATION_ALIMTALK_IMAGE_ID,
    "강사레슨 예약확정 템플릿",
  );
  if (imageContractIssue) return imageContractIssue;
  if (state.channelId !== INSTRUCTOR_LESSON_ALIMTALK_CHANNEL_ID) {
    return "강사레슨 예약확정 템플릿 채널 ID 불일치";
  }
  const contractText = String(state.content || "");
  for (const variable of ["#{이름}", "#{수업일}", "#{수업시간}", "#{수업구성}"]) {
    if (!contractText.includes(variable)) return `강사레슨 예약확정 템플릿 변수 없음: ${variable}`;
  }
  const buttons = state.buttons || [];
  if (
    buttons.length !== 2 ||
    buttons[0]?.name !== "캘린더에 일정 추가" ||
    buttons[0]?.type !== "WL" ||
    buttons[0]?.mobileUrl !== METHOD_CALENDAR_BUTTON_URL_TEMPLATE ||
    buttons[0]?.desktopUrl !== METHOD_CALENDAR_BUTTON_URL_TEMPLATE ||
    buttons[1]?.name !== "방문안내 보기" ||
    buttons[1]?.type !== "WL" ||
    buttons[1]?.mobileUrl !== INSTRUCTOR_LESSON_VISIT_BUTTON_URL ||
    buttons[1]?.desktopUrl !== INSTRUCTOR_LESSON_VISIT_BUTTON_URL
  ) {
    return "강사레슨 예약확정 템플릿 2버튼 계약 불일치";
  }
  return "";
}

export function recommendedMealTemplateContractIssue(
  candidate: AlimtalkCandidateDoc,
  state: AlimtalkTemplateState | null = null,
): string {
  if (candidate.type !== "recommended_meal_survey") return "";
  if (candidate.templateCode !== RECOMMENDED_MEAL_ALIMTALK_TEMPLATE_CODE) {
    return `추천식단 템플릿 설정 불일치: ${candidate.templateCode}`;
  }
  if (!state) return "";
  const imageContractIssue = alimtalkImageTemplateContractIssue(
    state,
    RECOMMENDED_MEAL_ALIMTALK_IMAGE_ID,
    "추천식단 템플릿",
  );
  if (imageContractIssue) return imageContractIssue;
  if (state.channelId !== RECOMMENDED_MEAL_ALIMTALK_CHANNEL_ID) {
    return "추천식단 템플릿 채널 ID 불일치";
  }
  if (!String(state.content || "").includes("#{이름}")) {
    return "추천식단 템플릿 회원명 변수 없음";
  }
  if (!(state.buttonUrls || []).includes(RECOMMENDED_MEAL_SURVEY_BUTTON_URL)) {
    return "추천식단 템플릿 설문 버튼 URL 불일치";
  }
  if (!(state.buttonUrls || []).includes(RECOMMENDED_MEAL_REPORT_BUTTON_URL)) {
    return "추천식단 템플릿 리포트 버튼 URL 불일치";
  }
  const buttons = state.buttons || [];
  if (
    buttons.length !== 2 ||
    buttons[0]?.name !== "식단 설문 작성" ||
    buttons[0]?.type !== "WL" ||
    buttons[0]?.mobileUrl !== RECOMMENDED_MEAL_SURVEY_BUTTON_URL ||
    buttons[0]?.desktopUrl !== RECOMMENDED_MEAL_SURVEY_BUTTON_URL ||
    buttons[1]?.name !== "추천식단 확인" ||
    buttons[1]?.type !== "WL" ||
    buttons[1]?.mobileUrl !== RECOMMENDED_MEAL_REPORT_BUTTON_URL ||
    buttons[1]?.desktopUrl !== RECOMMENDED_MEAL_REPORT_BUTTON_URL
  ) {
    return "추천식단 템플릿 2버튼 계약 불일치";
  }
  return "";
}

export function recommendedMealReportTemplateContractIssue(
  candidate: AlimtalkCandidateDoc,
  state: AlimtalkTemplateState | null = null,
): string {
  if (candidate.type !== "recommended_meal_report") return "";
  if (candidate.templateCode !== RECOMMENDED_MEAL_REPORT_ALIMTALK_TEMPLATE_CODE) {
    return `추천식단 리포트 템플릿 설정 불일치: ${candidate.templateCode}`;
  }
  if (!state) return "";
  const imageContractIssue = alimtalkImageTemplateContractIssue(
    state,
    RECOMMENDED_MEAL_ALIMTALK_IMAGE_ID,
    "추천식단 리포트 템플릿",
  );
  if (imageContractIssue) return imageContractIssue;
  if (state.channelId !== RECOMMENDED_MEAL_ALIMTALK_CHANNEL_ID) {
    return "추천식단 리포트 템플릿 채널 ID 불일치";
  }
  if (!String(state.content || "").includes("#{이름}")) {
    return "추천식단 리포트 템플릿 회원명 변수 없음";
  }
  if (!(state.buttonUrls || []).includes(RECOMMENDED_MEAL_SURVEY_BUTTON_URL)) {
    return "추천식단 리포트 버튼 URL 불일치";
  }
  const buttons = state.buttons || [];
  if (
    buttons.length !== 1 ||
    buttons[0]?.name !== "추천식단 보기" ||
    buttons[0]?.type !== "WL" ||
    buttons[0]?.mobileUrl !== RECOMMENDED_MEAL_SURVEY_BUTTON_URL ||
    buttons[0]?.desktopUrl !== RECOMMENDED_MEAL_SURVEY_BUTTON_URL
  ) {
    return "추천식단 리포트 버튼 계약 불일치";
  }
  return "";
}

function requiredPayloadIssue(candidate: AlimtalkCandidateDoc): string {
  const payload = candidate.payload || {};
  if (candidate.type === "onsite_welcome" && !payload.shortLinkId) return "회원가입서 짧은 링크 없음";
  if (candidate.type === "recommended_meal_survey") {
    if (!payload.shortLinkId) return "추천식단 설문 짧은 링크 없음";
    if (!payload.reportLinkId) return "추천식단 리포트 짧은 링크 없음";
  }
  if (candidate.type === "recommended_meal_report" && !payload.shortLinkId) return "추천식단 리포트 짧은 링크 없음";
  if (candidate.type === "instructor_lesson_confirmation") {
    if (!payload.registrationId) return "강사레슨 등록 ID 없음";
    if (!payload.lessonDate || !payload.lessonDateText) return "강사레슨 수업일 변수 없음";
    if (!payload.lessonTimeText) return "강사레슨 수업시간 변수 없음";
    if (!payload.lessonComposition) return "강사레슨 수업구성 변수 없음";
    if (String(payload.ticketName || "").replace(/\s+/g, "") !== "강사레슨(2T)")
      return "강사레슨 수강권 발급 변수 없음";
  }
  if (candidate.type === "private_survey" || candidate.type === "group_survey") {
    if (!(payload.surveyId || payload.responseId) || !payload.accessToken) return "설문 링크 변수 없음";
  }
  if (candidate.type === "private_lesson_report") {
    if (!(payload.reportLinkId || payload.reportShortUrl || payload.publicReportUrl)) return "회원용 리포트 URL 없음";
  }
  if (candidate.type === "inbody_report") {
    if (!(payload.inbodyLinkId || payload.reportLinkId || payload.inbodyReportUrl || payload.publicReportUrl))
      return "인바디 리포트 URL 없음";
  }
  return "";
}

function candidateTemplateVariables(candidate: AlimtalkCandidateDoc): Record<string, string> {
  const payload = candidate.payload || {};
  const surveyId = String(payload.surveyId || payload.responseId || "");
  const accessToken = String(payload.accessToken || "");
  const managementNumber = normalizeInstructorLessonManagementNumber(
    String(payload.managementNumber || payload.materialNumber || payload.archiveMethodId || ""),
  );
  const reportLinkId = String(payload.reportLinkId || "");
  const inbodyLinkId = String(payload.inbodyLinkId || "");
  return {
    "#{설문ID}": surveyId,
    "#{접근토큰}": accessToken,
    "#{관리번호}": managementNumber,
    "#{수업일}": String(payload.lessonDateText || payload.lessonDate || ""),
    "#{수업시간}": String(payload.lessonTimeText || ""),
    "#{수업구성}": String(payload.lessonComposition || ""),
    "#{링크ID}": candidateShortLinkId(candidate, surveyId, accessToken, managementNumber),
    "#{주차링크ID}": String(payload.parkingLinkId || ""),
    "#{리포트링크ID}": reportLinkId,
    "#{인바디링크ID}": inbodyLinkId,
  };
}

function candidateShortLinkId(
  candidate: AlimtalkCandidateDoc,
  surveyId: string,
  accessToken: string,
  managementNumber: string,
): string {
  const existing = String(candidate.payload?.shortLinkId || "");
  if (existing) return existing;
  if (candidate.type === "private_survey" && surveyId && accessToken) {
    return shortLinkIdForTarget("private_survey", privateSurveyTargetUrl(surveyId, accessToken));
  }
  if (candidate.type === "group_survey" && surveyId && accessToken) {
    return shortLinkIdForTarget("group_survey", groupSurveyTargetUrl(surveyId, accessToken));
  }
  if (candidate.type === "instructor_lesson_material" && managementNumber) {
    return shortLinkIdForTarget("method_material", methodMaterialTargetUrl(managementNumber));
  }
  return "";
}

function groupSurveyTargetUrl(surveyId: string, accessToken: string): string {
  const url = new URL("https://in.archivepilates.com/groupSurvey");
  url.searchParams.set("id", surveyId);
  url.searchParams.set("token", accessToken);
  return url.toString();
}

function privateSurveyTargetUrl(surveyId: string, accessToken: string): string {
  const url = new URL("https://in.archivepilates.com/privateSurvey");
  url.searchParams.set("id", surveyId);
  url.searchParams.set("token", accessToken);
  return url.toString();
}

function methodMaterialTargetUrl(managementNumber: string): string {
  return `https://in.archivepilates.com/method/${encodeURIComponent(managementNumber)}`;
}
