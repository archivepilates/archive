import { addDays } from "../utils/date";
import { ALIMTALK_MEMBER_EXCLUSION_REASONS } from "./templates";
import type { AlimtalkCandidateDoc } from "../types/models";
import { shortLinkIdForTarget } from "../utils/shortLinks";
import { isAlimtalkTemplateApproved } from "./templateStatus";
import { alimtalkTemplateTargetRule, solapiButtonUrlLengthIssue } from "./templateTargetRules";
import { isValidInstructorLessonManagementNumber, normalizeInstructorLessonManagementNumber } from "./instructorLessonManagement";

export async function autoSendabilityIssue(candidate: AlimtalkCandidateDoc, today: string): Promise<string> {
  const rule = alimtalkTemplateTargetRule(candidate.type);
  if (rule?.requiresMemberPhone && !candidate.memberPhone) return "전화번호 없음";
  if (ALIMTALK_MEMBER_EXCLUSION_REASONS[candidate.memberId])
    return ALIMTALK_MEMBER_EXCLUSION_REASONS[candidate.memberId];
  if (rule?.requiresApprovedTemplate && !(await isAlimtalkTemplateApproved(candidate.templateCode)))
    return `승인 템플릿 코드 아님: ${candidate.templateCode}`;
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
  if (rule?.requiresManagementNumber) {
    const rawManagementNumber = String(
      candidate.payload?.managementNumber || candidate.payload?.materialNumber || candidate.payload?.archiveMethodId || "",
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
    "#{링크ID}": candidateShortLinkId(candidate, surveyId, accessToken, managementNumber),
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

function methodMaterialTargetUrl(managementNumber: string): string {
  return `https://in.archivepilates.com/method/${encodeURIComponent(managementNumber)}`;
}
