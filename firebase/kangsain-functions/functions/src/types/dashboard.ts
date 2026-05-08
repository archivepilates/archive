import type { Timestamp } from "firebase-admin/firestore";

export interface DashboardSummaryRow {
  월: string;
  총매출: number;
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

export interface DashboardMemberSalesRow {
  회원명: string;
  연락처: string;
  누적매출: number;
  최근결제월: string;
  최근수강권명: string;
  최근결제일: string;
  보유수강권요약: string;
}

export type DashboardMemberMetricKind = "유효" | "그룹" | "프라이빗";

export interface DashboardMonthlyMemberRow {
  월: string;
  구분: DashboardMemberMetricKind;
  회원수: number;
}

export interface DashboardData {
  summary: DashboardSummaryRow[];
  강사별: DashboardInstructorSalesRow[];
  강사통계: DashboardInstructorStatsRow[];
  월별그룹평균가격: DashboardAveragePriceRow[];
  월별강사평균인원: DashboardInstructorAverageRow[];
  수강권TOP5: DashboardTicketTopRow[];
  회원별누적매출: DashboardMemberSalesRow[];
  월별회원: DashboardMonthlyMemberRow[];
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

export interface DashboardMemberSalesDoc extends DashboardMemberSalesRow {
  metricId: string;
  sourceSpreadsheetId: string;
  syncedAt: Timestamp;
}

export interface DashboardMonthlyMemberDoc extends DashboardMonthlyMemberRow {
  metricId: string;
  sourceSpreadsheetId: string;
  syncedAt: Timestamp;
}
