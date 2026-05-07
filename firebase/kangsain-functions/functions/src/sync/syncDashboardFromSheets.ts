import { DASHBOARD_DB_SPREADSHEET_ID, DASHBOARD_LEGACY_ENDPOINT_URL } from "../config/constants";
import { saveDashboardSnapshot } from "../firestore/dashboardRepository";
import type {
  DashboardAveragePriceRow,
  DashboardData,
  DashboardInstructorAverageRow,
  DashboardInstructorSalesRow,
  DashboardInstructorStatsRow,
  DashboardMemberSalesRow,
  DashboardMonthlyMemberRow,
  DashboardSummaryRow,
  DashboardTicketTopRow,
} from "../types/dashboard";
import { logger } from "firebase-functions";

type SheetRow = Record<string, unknown>;

const SHEETS = {
  settlement: "정산대장_Master",
  instructorStats: "강사통계_Long",
  ticketAnalysis: "수강권분석_Master",
  ticketSales: "수강권매출_Master",
  memberSales: "회원별누적매출",
  activeMembers: "월별 이용회원",
  groupMembers: "월별 그룹회원",
  privateMembers: "월별 프라이빗 회원",
};

export async function syncDashboardFromSheets(input?: {
  spreadsheetId?: string;
}): Promise<{ summaryRows: number; instructorRows: number; updatedAt: string }> {
  const spreadsheetId = input?.spreadsheetId || DASHBOARD_DB_SPREADSHEET_ID;
  const data = await loadDashboardData(spreadsheetId);
  await saveDashboardSnapshot({ data, sourceSpreadsheetId: spreadsheetId });
  logger.info("syncDashboardFromSheets completed", {
    summaryRows: data.summary.length,
    instructorRows: data.강사별.length,
  });
  return {
    summaryRows: data.summary.length,
    instructorRows: data.강사별.length,
    updatedAt: data.updatedAt,
  };
}

async function loadDashboardData(spreadsheetId: string): Promise<DashboardData> {
  try {
    const [settlement, instructorStats, ticketAnalysis, ticketSales, memberSales, activeMembers, groupMembers, privateMembers] =
      await Promise.all([
      readSheetRows(spreadsheetId, SHEETS.settlement),
      readSheetRows(spreadsheetId, SHEETS.instructorStats),
      readSheetRows(spreadsheetId, SHEETS.ticketAnalysis),
      readSheetRows(spreadsheetId, SHEETS.ticketSales),
      readSheetRows(spreadsheetId, SHEETS.memberSales),
      readSheetRows(spreadsheetId, SHEETS.activeMembers),
      readSheetRows(spreadsheetId, SHEETS.groupMembers),
      readSheetRows(spreadsheetId, SHEETS.privateMembers),
    ]);

    return buildDashboardData({
      settlement,
      instructorStats,
      ticketAnalysis,
      ticketSales,
      memberSales,
      activeMembers,
      groupMembers,
      privateMembers,
    });
  } catch (err) {
    logger.warn("Google Sheets direct read failed; falling back to legacy dashboard endpoint", err);
    return fetchLegacyDashboardData();
  }
}

async function fetchLegacyDashboardData(): Promise<DashboardData> {
  const result = await fetch(`${DASHBOARD_LEGACY_ENDPOINT_URL}&t=${Date.now()}`);
  if (!result.ok) throw new Error(`Legacy dashboard endpoint failed ${result.status}: ${await result.text()}`);
  const body = (await result.json()) as { data?: Partial<DashboardData> } & Partial<DashboardData>;
  return normalizeDashboardPayload(body.data || body);
}

export function buildDashboardData(input: {
  settlement: SheetRow[];
  instructorStats: SheetRow[];
  ticketAnalysis: SheetRow[];
  ticketSales: SheetRow[];
  memberSales?: SheetRow[];
  activeMembers?: SheetRow[];
  groupMembers?: SheetRow[];
  privateMembers?: SheetRow[];
}): DashboardData {
  const settlement = input.settlement.map(normalizeSettlementRow).filter((row) => row.월);
  const instructorStats = input.instructorStats.map(normalizeInstructorStatsRow).filter((row) => row.월 && row.강사);
  const ticketAnalysis = input.ticketAnalysis.map(normalizeTicketAnalysisRow).filter((row) => row.월);
  const ticketSales = input.ticketSales.map(normalizeTicketSalesRow).filter((row) => row.월);
  const memberSales = (input.memberSales || []).map(normalizeMemberSalesRow).filter((row) => row.회원명 || row.연락처);
  const monthlyMembers = [
    ...normalizeMonthlyMemberRows(input.activeMembers || [], "이용"),
    ...normalizeMonthlyMemberRows(input.groupMembers || [], "그룹"),
    ...normalizeMonthlyMemberRows(input.privateMembers || [], "프라이빗"),
  ];

  return {
    summary: buildSummary(settlement, instructorStats, ticketSales),
    강사별: settlement
      .filter((row) => row.강사)
      .map((row) => ({
        월: row.월,
        강사: row.강사,
        총매출: row.총매출,
        세전총액: row.세전총액,
        실지급액: row.실지급액,
      })),
    강사통계: instructorStats.map((row) => ({
      월: row.월,
      강사: row.강사,
      그룹예약률: round1(row.그룹예약률 * 100),
      그룹출석률: round1(row.그룹출석률 * 100),
      그룹평균인원: round2(row.그룹출석평균),
    })),
    월별그룹평균가격: buildMonthlyGroupAveragePrice(ticketAnalysis),
    월별강사평균인원: instructorStats.map((row) => ({
      월: row.월,
      강사: row.강사,
      그룹평균인원: round2(row.그룹출석평균),
    })),
    수강권TOP5: buildTicketTop5(ticketAnalysis),
    회원별누적매출: memberSales,
    월별회원: monthlyMembers,
    updatedAt: new Date().toISOString(),
  };
}

async function readSheetRows(spreadsheetId: string, sheetName: string): Promise<SheetRow[]> {
  const token = await getGoogleAccessToken();
  const range = encodeURIComponent(`'${sheetName}'!A:Z`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId,
  )}/values/${range}?valueRenderOption=UNFORMATTED_VALUE`;
  const result = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!result.ok) throw new Error(`Google Sheets API failed ${result.status}: ${await result.text()}`);
  const body = (await result.json()) as { values?: unknown[][] };
  const values = body.values || [];
  const [headers, ...rows] = values;
  if (!headers?.length) return [];
  return rows
    .filter((row) => row.some((cell) => cell !== "" && cell != null))
    .map((row) =>
      Object.fromEntries(headers.map((header, index) => [String(header || `col${index + 1}`), row[index] ?? ""])),
    );
}

async function getGoogleAccessToken(): Promise<string> {
  if (process.env.GOOGLE_OAUTH_ACCESS_TOKEN) return process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  const result = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token?scopes=https://www.googleapis.com/auth/spreadsheets.readonly",
    { headers: { "Metadata-Flavor": "Google" } },
  );
  if (!result.ok) throw new Error(`Metadata token request failed ${result.status}: ${await result.text()}`);
  const body = (await result.json()) as { access_token?: string };
  if (!body.access_token) throw new Error("Metadata token response did not include access_token");
  return body.access_token;
}

function buildSummary(
  settlement: ReturnType<typeof normalizeSettlementRow>[],
  instructorStats: ReturnType<typeof normalizeInstructorStatsRow>[],
  ticketSales: ReturnType<typeof normalizeTicketSalesRow>[],
): DashboardSummaryRow[] {
  const byMonth = new Map<string, DashboardSummaryRow>();
  for (const row of settlement) {
    const current = byMonth.get(row.월) || emptySummary(row.월);
    current.수업매출 += row.총매출;
    current.실지급액 += row.실지급액;
    current.세전총액 += row.세전총액;
    current.그룹세션 += row.그룹횟수;
    current.프라이빗 += row.프라이빗횟수;
    current.강사레슨 += row.강사레슨횟수;
    byMonth.set(row.월, current);
  }

  for (const row of ticketSales) {
    const current = byMonth.get(row.월) || emptySummary(row.월);
    current.총매출 += row.총결제금액;
    byMonth.set(row.월, current);
  }

  const statsByMonth = groupByMonth(instructorStats);
  for (const [month, rows] of statsByMonth) {
    const current = byMonth.get(month) || emptySummary(month);
    current.예약률 = weightedPercent(rows, "그룹예약률", "그룹횟수");
    current.출석률 = weightedPercent(rows, "그룹출석률", "그룹횟수");
    byMonth.set(month, current);
  }

  return [...byMonth.values()]
    .map((row) => ({
      ...row,
      총매출: round0(row.총매출),
      수업매출: round0(row.수업매출),
      실지급액: round0(row.실지급액),
      세전총액: round0(row.세전총액),
      마진률: row.수업매출 ? round1(((row.수업매출 - row.세전총액) / row.수업매출) * 100) : 0,
      예약률: round1(row.예약률),
      출석률: round1(row.출석률),
    }))
    .sort((a, b) => b.월.localeCompare(a.월));
}

function buildMonthlyGroupAveragePrice(
  rows: ReturnType<typeof normalizeTicketAnalysisRow>[],
): DashboardAveragePriceRow[] {
  const grouped = groupByMonth(rows.filter((row) => row.수업구분 === "그룹"));
  return [...grouped.entries()]
    .map(([month, monthRows]) => {
      const paid = sum(monthRows, "유료출석건수");
      const revenue = sum(monthRows, "차감매출합계");
      return { 월: month, 그룹1회평균가격: paid ? round2(revenue / paid) : 0 };
    })
    .sort((a, b) => a.월.localeCompare(b.월));
}

function buildTicketTop5(rows: ReturnType<typeof normalizeTicketAnalysisRow>[]): DashboardTicketTopRow[] {
  const output: DashboardTicketTopRow[] = [];
  const grouped = groupByMonth(rows.filter((row) => row.수업구분 === "그룹" && row.수강권명 && row.차감매출합계 > 0));
  for (const [month, monthRows] of grouped) {
    const sortedRows = [...monthRows].sort((a, b) => b.차감매출합계 - a.차감매출합계);
    const topRows = sortedRows.slice(0, 5);
    const otherRows = sortedRows.slice(5);
    output.push(...topRows.map((row) => ({ 월: month, 라벨: row.수강권명, 값: round0(row.차감매출합계) })));
    if (otherRows.length) {
      output.push({
        월: month,
        라벨: "기타",
        값: round0(sum(otherRows, "차감매출합계")),
        종류수: otherRows.length,
      });
    }
  }
  return output.sort((a, b) => (a.월 === b.월 ? b.값 - a.값 : a.월.localeCompare(b.월)));
}

function emptySummary(month: string): DashboardSummaryRow {
  return {
    월: month,
    총매출: 0,
    수업매출: 0,
    실지급액: 0,
    세전총액: 0,
    마진률: 0,
    그룹세션: 0,
    프라이빗: 0,
    강사레슨: 0,
    예약률: 0,
    출석률: 0,
  };
}

function normalizeSettlementRow(row: SheetRow) {
  return {
    월: monthKey(row.기준월),
    강사: stringValue(row.성명),
    그룹횟수: numberValue(row.그룹횟수),
    프라이빗횟수: numberValue(row.프라이빗횟수),
    강사레슨횟수: numberValue(row.강사레슨횟수),
    세전총액: numberValue(row.세전총액),
    실지급액: numberValue(row.실지급액),
    총매출: numberValue(row.총매출),
  };
}

function normalizeInstructorStatsRow(row: SheetRow) {
  return {
    월: monthKey(row.기준월),
    강사: stringValue(row.강사명),
    그룹예약평균: numberValue(row.그룹예약평균),
    그룹출석평균: numberValue(row.그룹출석평균),
    그룹예약률: numberValue(row.그룹예약률),
    그룹출석률: numberValue(row.그룹출석률),
    그룹횟수: numberValue(row.그룹횟수),
  };
}

function normalizeTicketAnalysisRow(row: SheetRow) {
  return {
    월: monthKey(row.기준월),
    수업구분: stringValue(row.수업구분),
    수강권명: stringValue(row.수강권명),
    사용횟수: numberValue(row.사용횟수),
    유료출석건수: numberValue(row.유료출석건수),
    차감매출합계: numberValue(row.차감매출합계),
  };
}

function normalizeTicketSalesRow(row: SheetRow) {
  return {
    월: monthKey(row.기준월),
    총결제금액: numberValue(row.총결제금액),
  };
}

function normalizeMemberSalesRow(row: SheetRow): DashboardMemberSalesRow {
  return {
    회원명: stringValue(row.회원명),
    연락처: stringValue(row.연락처),
    누적매출: numberValue(row.누적매출),
    최근결제월: monthKey(row.최근결제월),
    최근수강권명: stringValue(row.최근수강권명),
    최근결제일: dateValue(row.최근결제일),
    보유수강권요약: stringValue(row["보유수강권 요약"] ?? row.보유수강권요약),
  };
}

function normalizeMonthlyMemberRows(rows: SheetRow[], kind: DashboardMonthlyMemberRow["구분"]): DashboardMonthlyMemberRow[] {
  return rows
    .map((row) => ({
      월: monthKey(row.기준월 ?? row.월),
      구분: kind,
      회원수: numberValue(row.회원수),
    }))
    .filter((row) => row.월);
}

function normalizeDashboardPayload(input: Partial<DashboardData>): DashboardData {
  return {
    summary: (input.summary || [])
      .map((row) => ({
        월: monthKey(row.월),
        총매출: numberValue(row.총매출),
        수업매출: numberValue(row.수업매출),
        실지급액: numberValue(row.실지급액),
        세전총액: numberValue(row.세전총액),
        마진률: numberValue(row.마진률),
        그룹세션: numberValue(row.그룹세션),
        프라이빗: numberValue(row.프라이빗),
        강사레슨: numberValue(row.강사레슨),
        예약률: numberValue(row.예약률),
        출석률: numberValue(row.출석률),
      }))
      .filter((row) => row.월),
    강사별: (input.강사별 || [])
      .map((row) => ({
        월: monthKey(row.월),
        강사: stringValue(row.강사),
        총매출: numberValue(row.총매출),
        세전총액: numberValue(row.세전총액),
        실지급액: numberValue(row.실지급액),
      }))
      .filter((row) => row.월 && row.강사),
    강사통계: (input.강사통계 || [])
      .map((row) => ({
        월: monthKey(row.월),
        강사: stringValue(row.강사),
        그룹예약률: numberValue(row.그룹예약률),
        그룹출석률: numberValue(row.그룹출석률),
        그룹평균인원: numberValue(row.그룹평균인원),
      }))
      .filter((row) => row.월 && row.강사),
    월별그룹평균가격: (input.월별그룹평균가격 || [])
      .map((row) => ({
        월: monthKey(row.월),
        그룹1회평균가격: numberValue(row.그룹1회평균가격),
      }))
      .filter((row) => row.월),
    월별강사평균인원: (input.월별강사평균인원 || [])
      .map((row) => ({
        월: monthKey(row.월),
        강사: stringValue(row.강사),
        그룹평균인원: numberValue(row.그룹평균인원),
      }))
      .filter((row) => row.월 && row.강사),
    수강권TOP5: (input.수강권TOP5 || [])
      .map((row) => ({
        월: monthKey(row.월),
        라벨: stringValue(row.라벨),
        값: numberValue(row.값),
        종류수: numberValue(row.종류수),
      }))
      .filter((row) => row.월 && row.라벨),
    회원별누적매출: (input.회원별누적매출 || [])
      .map((row) => ({
        회원명: stringValue(row.회원명),
        연락처: stringValue(row.연락처),
        누적매출: numberValue(row.누적매출),
        최근결제월: monthKey(row.최근결제월),
        최근수강권명: stringValue(row.최근수강권명),
        최근결제일: dateValue(row.최근결제일),
        보유수강권요약: stringValue(row.보유수강권요약),
      }))
      .filter((row) => row.회원명 || row.연락처),
    월별회원: (input.월별회원 || [])
      .map((row) => ({
        월: monthKey(row.월),
        구분: normalizeMemberMetricKind(row.구분),
        회원수: numberValue(row.회원수),
      }))
      .filter((row) => row.월),
    updatedAt: stringValue(input.updatedAt) || new Date().toISOString(),
  };
}

function monthKey(value: unknown): string {
  if (typeof value === "number") {
    const date = new Date(Math.round((value - 25569) * 86400 * 1000));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  const text = stringValue(value);
  const matched = text.match(/(20\d{2})[-./년\s]*(\d{1,2})/);
  if (matched) return `${matched[1]}-${matched[2].padStart(2, "0")}`;
  return "";
}

function weightedPercent<T>(rows: T[], valueKey: keyof T, weightKey: keyof T): number {
  const weight = sum(rows, weightKey);
  if (!weight) return 0;
  return (rows.reduce((total, row) => total + Number(row[valueKey] || 0) * Number(row[weightKey] || 0), 0) / weight) * 100;
}

function groupByMonth<T extends { 월: string }>(rows: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  rows.forEach((row) => grouped.set(row.월, [...(grouped.get(row.월) || []), row]));
  return grouped;
}

function sum<T>(rows: T[], key: keyof T): number {
  return rows.reduce((total, row) => total + numberValue(row[key]), 0);
}

function stringValue(value: unknown): string {
  return String(value || "").trim();
}

function numberValue(value: unknown): number {
  if (typeof value === "number") return value;
  if (value == null || value === "") return 0;
  return Number(String(value).replace(/,/g, "").replace("%", "").trim()) || 0;
}

function dateValue(value: unknown): string {
  if (typeof value === "number") {
    const date = new Date(Math.round((value - 25569) * 86400 * 1000));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
      date.getUTCDate(),
    ).padStart(2, "0")}`;
  }
  const text = stringValue(value);
  const matched = text.match(/(20\d{2})[-./년\s]*(\d{1,2})[-./월\s]*(\d{1,2})/);
  if (matched) return `${matched[1]}-${matched[2].padStart(2, "0")}-${matched[3].padStart(2, "0")}`;
  return text;
}

function normalizeMemberMetricKind(value: unknown): DashboardMonthlyMemberRow["구분"] {
  const text = stringValue(value);
  if (text === "그룹" || text === "프라이빗") return text;
  return "이용";
}

function round0(value: number): number {
  return Math.round(value);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
