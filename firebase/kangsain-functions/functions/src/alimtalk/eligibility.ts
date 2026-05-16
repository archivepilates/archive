import { addDays } from "../utils/date";
import {
  ALIMTALK_MEMBER_EXCLUSION_REASONS,
  APPROVED_ALIMTALK_TEMPLATE_CODES,
  NEW_MEMBER_ALIMTALK_START_DATE,
  NEW_MEMBER_ALIMTALK_WINDOW_DAYS,
} from "./templates";
import type { AlimtalkCandidateDoc } from "../types/models";

export function autoSendabilityIssue(candidate: AlimtalkCandidateDoc, today: string): string {
  if (!candidate.memberPhone) return "전화번호 없음";
  if (ALIMTALK_MEMBER_EXCLUSION_REASONS[candidate.memberId])
    return ALIMTALK_MEMBER_EXCLUSION_REASONS[candidate.memberId];
  if (!APPROVED_ALIMTALK_TEMPLATE_CODES.has(candidate.templateCode))
    return `승인 템플릿 코드 아님: ${candidate.templateCode}`;
  if (candidate.sourceDate && candidate.sourceDate > today) return "대상일이 발송 기준일 이후";
  if (candidate.type !== "new_member" && candidate.sourceDate !== today) return "수강권 알림은 발송 기준일 후보만 발송";
  if (candidate.type === "new_member" && candidate.sourceDate < NEW_MEMBER_ALIMTALK_START_DATE)
    return "신규회원 웰컴 시작일 이전 등록";
  if (
    candidate.type === "new_member" &&
    candidate.sourceDate < addDays(today, -(NEW_MEMBER_ALIMTALK_WINDOW_DAYS - 1))
  ) {
    return `신규회원 웰컴은 등록 ${NEW_MEMBER_ALIMTALK_WINDOW_DAYS}일 이내 후보만 발송`;
  }
  return "";
}
