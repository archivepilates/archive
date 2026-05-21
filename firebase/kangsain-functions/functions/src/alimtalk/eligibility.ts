import { addDays } from "../utils/date";
import {
  ALIMTALK_MEMBER_EXCLUSION_REASONS,
  GROUP_SURVEY_ALIMTALK_START_DATE,
  NEW_MEMBER_ALIMTALK_START_DATE,
  NEW_MEMBER_ALIMTALK_WINDOW_DAYS,
  PRIVATE_SURVEY_ALIMTALK_START_DATE,
} from "./templates";
import type { AlimtalkCandidateDoc } from "../types/models";
import { isAlimtalkTemplateApproved } from "./templateStatus";

export async function autoSendabilityIssue(candidate: AlimtalkCandidateDoc, today: string): Promise<string> {
  if (!candidate.memberPhone) return "전화번호 없음";
  if (ALIMTALK_MEMBER_EXCLUSION_REASONS[candidate.memberId])
    return ALIMTALK_MEMBER_EXCLUSION_REASONS[candidate.memberId];
  if (!(await isAlimtalkTemplateApproved(candidate.templateCode)))
    return `승인 템플릿 코드 아님: ${candidate.templateCode}`;
  if ((candidate.attempts || 0) >= (candidate.maxAttempts || 2)) return "발송 실패 재시도 한도 초과";
  if (candidate.sourceDate && candidate.sourceDate > today) return "대상일이 발송 기준일 이후";
  if (candidate.type === "instructor_lesson_material") {
    if (candidate.sourceDate !== today) return "강사레슨 수업자료는 발송 기준일 후보만 발송";
    if (!candidate.payload?.managementNumber && !candidate.payload?.materialNumber && !candidate.payload?.archiveMethodId)
      return "강사레슨 수업자료 관리번호 없음";
    return "";
  }
  if (
    candidate.type !== "new_member" &&
    candidate.type !== "private_survey" &&
    candidate.type !== "group_survey" &&
    candidate.sourceDate !== today
  )
    return "수강권 알림은 발송 기준일 후보만 발송";
  if (candidate.type === "new_member" && candidate.sourceDate < NEW_MEMBER_ALIMTALK_START_DATE)
    return "신규회원 웰컴 시작일 이전 등록";
  if (
    candidate.type === "new_member" &&
    candidate.sourceDate < addDays(today, -(NEW_MEMBER_ALIMTALK_WINDOW_DAYS - 1))
  ) {
    return `신규회원 웰컴은 등록 ${NEW_MEMBER_ALIMTALK_WINDOW_DAYS}일 이내 후보만 발송`;
  }
  if (candidate.type === "private_survey" && candidate.sourceDate < PRIVATE_SURVEY_ALIMTALK_START_DATE)
    return "프라이빗 사전설문 자동발송 시작일 이전 후보";
  if (candidate.type === "private_survey" && candidate.sourceDate !== today)
    return "프라이빗 사전설문은 발송 기준일 후보만 발송";
  if (candidate.type === "group_survey" && candidate.sourceDate < GROUP_SURVEY_ALIMTALK_START_DATE)
    return "그룹 첫 수업 사전확인 자동발송 시작일 이전 후보";
  if (candidate.type === "group_survey" && candidate.sourceDate !== today)
    return "그룹 첫 수업 사전확인은 발송 기준일 후보만 발송";
  if (candidate.type === "group_survey" && candidate.payload?.groupSurveyDeliveryMode === "too_late")
    return "수업 시작 30분 미만 첫 그룹수업은 설문 발송 대신 현장 확인";
  return "";
}
