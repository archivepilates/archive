import type { Timestamp } from "firebase-admin/firestore";

export interface DashboardSummaryRow {
  월: string;
  총매출: number;
  수강권매출?: number;
  수강권총결제?: number;
  수강권환불?: number;
  수강권매출원천?: string;
  수업매출: number;
  실지급액: number;
  세전총액: number;
  마진률: number;
  그룹세션: number;
  프라이빗: number;
  강사레슨: number;
  예약률: number;
  출석률: number;
}

export interface DashboardInstructorSalesRow {
  월: string;
  강사: string;
  총매출: number;
  세전총액: number;
  실지급액: number;
}

export interface DashboardInstructorStatsRow {
  월: string;
  강사: string;
  그룹예약률: number;
  그룹출석률: number;
  그룹평균인원: number;
}

export interface DashboardAveragePriceRow {
  월: string;
  그룹1회평균가격: number;
}

export interface DashboardInstructorAverageRow {
  월: string;
  강사: string;
  그룹평균인원: number;
}

export interface DashboardTicketTopRow {
  월: string;
  라벨: string;
  값: number;
  종류수?: number;
}

export interface DashboardMonthlyActiveMemberRow {
  월: string;
  이용회원수: number;
}

export interface DashboardMonthlyMemberMetricRow {
  월: string;
  수강권보유회원수: number;
  예약이용회원수: number;
  출석회원수: number;
  원본예약행수?: number;
  정규화예약건수?: number;
  중복정리행수?: number;
  취소제외행수?: number;
  비예약제외행수?: number;
  강사레슨제외행수?: number;
  유효예약행수?: number;
  출석예약행수?: number;
  결석예약행수?: number;
  산출원천?: string;
  산출기준?: string;
}

export interface DashboardMemberSalesRow {
  memberId: string;
  memberName: string;
  memberPhone: string;
  totalRevenue: number;
  lastMonth: string;
  recentTicketName?: string;
  recentPaymentDate?: string;
  ticketSummary?: string;
}

export interface DashboardMemberRevenueRow {
  회원명: string;
  연락처: string;
  누적매출: number;
  최근결제월: string;
  최근수강권명: string;
  최근결제일: string;
  보유수강권요약: string;
}

export type DashboardMemberMetricKind = "유효" | "그룹" | "프라이빗" | "수강권보유" | "예약이용" | "출석";

export interface DashboardMonthlyMemberRow {
  월: string;
  구분: DashboardMemberMetricKind;
  회원수: number;
}

export interface DashboardDailyRevenueRow {
  기준일: string;
  기준월: string;
  일매출: number;
  월누적매출: number;
  전월동일일누적: number;
  전년동월동일일누적: number;
  일수업매출?: number;
  월누적수업매출?: number;
  전월동일일수업누적?: number;
  전년동월동일일수업누적?: number;
  월누적세전총액?: number;
  전월동일일세전총액?: number;
  월누적수업마진률?: number;
  전월동일일수업마진률?: number;
  월누적그룹세션?: number;
  전월동일일그룹세션?: number;
  월누적프라이빗?: number;
  전월동일일프라이빗?: number;
  월누적강사레슨?: number;
  전월동일일강사레슨?: number;
  월누적그룹예약률?: number;
  전월동일일그룹예약률?: number;
  월누적그룹출석률?: number;
  전월동일일그룹출석률?: number;
}

export interface DashboardData {
  summary: DashboardSummaryRow[];
  강사별: DashboardInstructorSalesRow[];
  강사통계: DashboardInstructorStatsRow[];
  월별그룹평균가격: DashboardAveragePriceRow[];
  월별강사평균인원: DashboardInstructorAverageRow[];
  월별이용회원: DashboardMonthlyActiveMemberRow[];
  월별회원지표?: DashboardMonthlyMemberMetricRow[];
  수강권TOP5: DashboardTicketTopRow[];
  회원매출: DashboardMemberSalesRow[];
  회원별누적매출?: DashboardMemberRevenueRow[];
  월별회원?: DashboardMonthlyMemberRow[];
  매출일일누적?: DashboardDailyRevenueRow[];
  updatedAt: string;
}

export interface DashboardSnapshotDoc extends DashboardData {
  snapshotId: string;
  sourceSpreadsheetId: string;
  syncedAt: Timestamp;
}

export interface DashboardMonthlyMetricDoc extends DashboardSummaryRow {
  metricId: string;
  sourceSpreadsheetId: string;
  syncedAt: Timestamp;
}

export interface DashboardInstructorMetricDoc {
  metricId: string;
  월: string;
  강사: string;
  총매출: number;
  세전총액: number;
  실지급액: number;
  그룹예약률: number;
  그룹출석률: number;
  그룹평균인원: number;
  sourceSpreadsheetId: string;
  syncedAt: Timestamp;
}

export interface DashboardTicketMetricDoc {
  metricId: string;
  월: string;
  라벨: string;
  값: number;
  종류수?: number;
  rank: number;
  sourceSpreadsheetId: string;
  syncedAt: Timestamp;
}

export interface DashboardMemberSalesDoc extends DashboardMemberRevenueRow {
  metricId: string;
  sourceSpreadsheetId: string;
  syncedAt: Timestamp;
}

export interface DashboardMonthlyMemberDoc extends DashboardMonthlyMemberRow {
  metricId: string;
  sourceSpreadsheetId: string;
  syncedAt: Timestamp;
}
