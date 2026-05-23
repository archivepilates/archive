import { addDays } from "../utils/date";
import { ALIMTALK_MEMBER_EXCLUSION_REASONS } from "./templates";
import type { AlimtalkCandidateDoc } from "../types/models";
import { isAlimtalkTemplateApproved } from "./templateStatus";
import { alimtalkTemplateTargetRule } from "./templateTargetRules";

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
    if (
      !candidate.payload?.managementNumber &&
      !candidate.payload?.materialNumber &&
      !candidate.payload?.archiveMethodId
    )
      return "강사레슨 수업자료 관리번호 없음";
  }
  if (rule?.blocksTooLateGroupSurvey && candidate.payload?.groupSurveyDeliveryMode === "too_late")
    return "수업 시작 30분 미만 첫 그룹수업은 설문 발송 대신 현장 확인";
  return "";
}
