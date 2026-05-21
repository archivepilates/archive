import { DASHBOARD_DB_SPREADSHEET_ID, DASHBOARD_LEGACY_ENDPOINT_URL } from "../config/constants";
import { saveDashboardSnapshot } from "../firestore/dashboardRepository";
import type {
  DashboardAveragePriceRow,
  DashboardData,
  DashboardDailyRevenueRow,
  DashboardInstructorAverageRow,
  DashboardInstructorSalesRow,
  DashboardInstructorStatsRow,
  DashboardMonthlyActiveMemberRow,
  DashboardMemberSalesRow,
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
  ticketSalesRaw: "수강권매출_원본",
  memberSales: "회원별누적매출",
  dailyRevenue: "매출일일누적",
};

const MONTHLY_ACTIVE_MEMBER_SHEETS = [
  "월별유효회원",
  "월별 유효회원",
  "유효회원_월별",
  "유효회원 월별",
  "월별수강권보유회원",
  "월별 수강권 보유회원",
  "월별전체이용회원",
  "월별 전체 이용회원",
  "전체이용회원",
  "전체 이용회원",
  "월별이용회원_전체",
  "월별 이용회원_전체",
  "이용회원_월별",
  "이용회원 월별",
  "월별이용회원",
  "월별 이용회원",
  "이용회원_Master",
  "이용회원수_Master",
  "월별이용회원_Master",
];

export async function syncDashboardFromSheets(input?: {
  spreadsheetId?: string;
}): Promise<{
  summaryRows: number;
  instructorRows: number;
  memberSalesRows: number;
  updatedAt: string;
  warning?: string;
}> {
  const spreadsheetId = input?.spreadsheetId || DASHBOARD_DB_SPREADSHEET_ID;
  const { data, warning } = await loadDashboardData(spreadsheetId);
  await saveDashboardSnapshot({ data, sourceSpreadsheetId: spreadsheetId });
  logger.info("syncDashboardFromSheets completed", {
    summaryRows: data.summary.length,
    instructorRows: data.강사별.length,
    memberSalesRows: data.회원매출.length,
    warning,
  });
  return {
    summaryRows: data.summary.length,
    instructorRows: data.강사별.length,
    memberSalesRows: data.회원매출.length,
    updatedAt: data.updatedAt,
    warning,
  };
}

async function loadDashboardData(spreadsheetId: string): Promise<{ data: DashboardData; warning?: string }> {
  try {
    const [settlement, instructorStats, ticketAnalysis, ticketSales, ticketSalesRaw, memberSales, dailyRevenue, monthlyActiveMembers] = await Promise.all([
      readSheetRows(spreadsheetId, SHEETS.settlement),
      readSheetRows(spreadsheetId, SHEETS.instructorStats),
      readSheetRows(spreadsheetId, SHEETS.ticketAnalysis),
      readSheetRows(spreadsheetId, SHEETS.ticketSales),
      readSheetRows(spreadsheetId, SHEETS.ticketSalesRaw),
      readSheetRows(spreadsheetId, SHEETS.memberSales),
      readOptionalSheetRows(spreadsheetId, SHEETS.dailyRevenue),
      readFirstAvailableSheetRows(spreadsheetId, MONTHLY_ACTIVE_MEMBER_SHEETS),
    ]);

    return {
      data: buildDashboardData({
        settlement,
        instructorStats,
        ticketAnalysis,
        ticketSales,
        ticketSalesRaw,
        memberSales,
        dailyRevenue,
        monthlyActiveMembers,
      }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("Google Sheets direct read failed; falling back to legacy dashboard endpoint", err);
    return {
      data: await fetchLegacyDashboardData(),
      warning: `정산 시트 직접 읽기 실패: ${message}`,
    };
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
  ticketSalesRaw?: SheetRow[];
  memberSales?: SheetRow[];
  dailyRevenue?: SheetRow[];
  monthlyActiveMembers?: SheetRow[];
}): DashboardData {
  const settlement = input.settlement.map(normalizeSettlementRow).filter((row) => row.월);
  const instructorStats = input.instructorStats.map(normalizeInstructorStatsRow).filter((row) => row.월 && row.강사);
  const ticketAnalysis = input.ticketAnalysis.map(normalizeTicketAnalysisRow).filter((row) => row.월);
  const ticketSales = input.ticketSales.map(normalizeTicketSalesRow).filter((row) => row.월);
  const ticketSalesRaw = (input.ticketSalesRaw || []).map(normalizeTicketSalesRow).filter((row) => row.월);
  const memberSales = (input.memberSales || []).map(normalizeMemberSalesRow).filter(
    (row) => row.totalRevenue > 0 && (row.memberId || row.memberName || row.memberPhone),
  );
  const dailyRevenue = (input.dailyRevenue || []).map(normalizeDailyRevenueRow).filter((row) => row.기준일 && row.기준월);
  const monthlyActiveMembers = (input.monthlyActiveMembers || [])
    .map(normalizeMonthlyActiveMemberRow)
    .filter((row) => row.월 && row.이용회원수 > 0);

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
    월별이용회원: monthlyActiveMembers.length ? monthlyActiveMembers : buildMonthlyActiveMembers(ticketAnalysis),
    수강권TOP5: buildTicketTop5(ticketAnalysis),
    회원매출: memberSales.length ? memberSales : buildMemberSales(ticketSalesRaw.length ? ticketSalesRaw : ticketSales),
    매출일일누적: dailyRevenue,
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

async function readOptionalSheetRows(spreadsheetId: string, sheetName: string): Promise<SheetRow[]> {
  try {
    return await readSheetRows(spreadsheetId, sheetName);
  } catch (err) {
    logger.info("Optional dashboard sheet not found; continuing without it", {
      sheetName,
      message: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

async function readFirstAvailableSheetRows(spreadsheetId: string, sheetNames: string[]): Promise<SheetRow[]> {
  let lastError: unknown = null;
  const candidates: Array<{ sheetName: string; rows: number; sample?: SheetRow; normalizedRows: DashboardMonthlyActiveMemberRow[] }> = [];
  for (const sheetName of sheetNames) {
    try {
      const rows = await readSheetRows(spreadsheetId, sheetName);
      const normalizedRows = rows.map(normalizeMonthlyActiveMemberRow).filter((row) => row.월 && row.이용회원수 > 0);
      candidates.push({ sheetName, rows: rows.length, sample: rows[0], normalizedRows });
    } catch (err) {
      lastError = err;
    }
  }
  const selected =
    candidates.find((candidate) => candidate.normalizedRows.some((row) => row.이용회원수 > 0 && row.이용회원수 < 500)) ||
    candidates[0];
  if (selected) {
    logger.info("Monthly active member sheet loaded", {
      sheetName: selected.sheetName,
      rows: selected.rows,
      sample: selected.sample,
      candidates: candidates.map((candidate) => ({
        sheetName: candidate.sheetName,
        rows: candidate.rows,
        sample: candidate.sample,
        normalizedSample: candidate.normalizedRows.slice(0, 3),
      })),
    });
    return await readSheetRows(spreadsheetId, selected.sheetName);
  }
  logger.warn("Monthly active member sheet not found; using fallback from ticket analysis", {
    sheetNames,
    lastError: lastError instanceof Error ? lastError.message : String(lastError || ""),
  });
  return [];
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

function buildMonthlyActiveMembers(rows: ReturnType<typeof normalizeTicketAnalysisRow>[]): DashboardMonthlyActiveMemberRow[] {
  return [...groupByMonth(rows).entries()]
    .map(([month, monthRows]) => ({
      월: month,
      이용회원수: round0(sum(monthRows, "유료출석건수")),
    }))
    .filter((row) => row.이용회원수 > 0)
    .sort((a, b) => a.월.localeCompare(b.월));
}

function buildMemberSales(rows: ReturnType<typeof normalizeTicketSalesRow>[]): DashboardMemberSalesRow[] {
  const map = new Map<string, DashboardMemberSalesRow>();
  rows
    .filter((row) => row.총결제금액 > 0 && (row.회원ID || row.회원명 || row.회원연락처))
    .forEach((row) => {
      const key = row.회원ID || normalizePhone(row.회원연락처) || row.회원명;
      const current = map.get(key) || {
        memberId: row.회원ID,
        memberName: row.회원명,
        memberPhone: normalizePhone(row.회원연락처),
        totalRevenue: 0,
        lastMonth: "",
      };
      current.memberId ||= row.회원ID;
      current.memberName ||= row.회원명;
      current.memberPhone ||= normalizePhone(row.회원연락처);
      current.totalRevenue += row.총결제금액;
      if (row.월 > current.lastMonth) current.lastMonth = row.월;
      map.set(key, current);
    });

  return [...map.values()]
    .map((row) => ({ ...row, totalRevenue: round0(row.totalRevenue) }))
    .sort((a, b) => b.totalRevenue - a.totalRevenue || a.memberName.localeCompare(b.memberName, "ko"));
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
    회원ID: stringValue(firstValue(row, ["회원ID", "회원Id", "회원id", "회원번호", "회원코드", "회원고유번호", "memberId", "member_id"])),
    회원명: stringValue(firstValue(row, ["회원명", "회원", "고객명", "고객", "성명", "이름", "name", "memberName"])),
    회원연락처: stringValue(firstValue(row, ["회원연락처", "연락처", "휴대폰", "휴대폰번호", "전화번호", "핸드폰", "mobile", "phone"])),
    총결제금액: numberValue(
      firstValue(row, ["총결제금액", "결제금액합계", "결제금액", "실결제금액", "매출", "금액", "판매금액", "결제총액", "amount", "price"]),
    ),
  };
}

function normalizeMemberSalesRow(row: SheetRow): DashboardMemberSalesRow {
  return {
    memberId: stringValue(firstValue(row, ["회원ID", "회원Id", "회원id", "회원번호", "회원코드", "memberId", "member_id"])),
    memberName: stringValue(firstValue(row, ["회원명", "회원", "고객명", "고객", "성명", "이름", "memberName", "name"])),
    memberPhone: normalizePhone(firstValue(row, ["연락처", "회원연락처", "휴대폰", "휴대폰번호", "전화번호", "memberPhone", "phone"])),
    totalRevenue: numberValue(firstValue(row, ["누적매출", "총누적매출", "총매출", "totalRevenue", "revenue"])),
    lastMonth: monthKey(firstValue(row, ["최근결제월", "최근월", "lastMonth"])),
    recentTicketName: stringValue(firstValue(row, ["최근수강권명", "최근수강권", "recentTicketName"])),
    recentPaymentDate: dateKey(firstValue(row, ["최근결제일", "recentPaymentDate"])),
    ticketSummary: stringValue(firstValue(row, ["보유수강권 요약", "보유수강권", "수강권요약", "ticketSummary"])),
  };
}

function normalizeDailyRevenueRow(row: SheetRow): DashboardDailyRevenueRow {
  return {
    기준일: dateKey(firstValue(row, ["기준일", "일자", "date"])),
    기준월: monthKey(firstValue(row, ["기준월", "월", "month"])),
    일매출: numberValue(firstValue(row, ["일매출", "dailyRevenue"])),
    월누적매출: numberValue(firstValue(row, ["월누적매출", "mtdRevenue"])),
    전월동일일누적: numberValue(firstValue(row, ["전월동일일누적", "prevMonthSameDayMtd"])),
    전년동월동일일누적: numberValue(firstValue(row, ["전년동월동일일누적", "prevYearSameDayMtd"])),
  };
}

function normalizeMonthlyActiveMemberRow(row: SheetRow): DashboardMonthlyActiveMemberRow {
  const memberList = stringValue(firstValue(row, ["회원목록", "회원 리스트", "유효회원목록", "수강권보유회원목록", "membersList"]));
  const dedupedMemberCount = countDistinctMembers(memberList);
  const sheetMemberCount = numberValue(
    firstValue(row, [
      "월유효회원수",
      "유효회원수",
      "월별유효회원수",
      "수강권보유회원수",
      "수강권 보유 회원수",
      "이용회원수",
      "월별이용회원수",
      "회원수",
      "이용회원",
      "활성이용회원수",
      "activeMembers",
      "members",
    ]),
  );
  return {
    월: monthKey(firstValue(row, ["기준월", "월", "month", "월별"])),
    이용회원수: sheetMemberCount || dedupedMemberCount,
  };
}

function countDistinctMembers(memberList: string): number {
  if (!memberList) return 0;
  const members = memberList
    .split(/\s*,\s*/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const phone = item.match(/01\d[-\d\s)]{7,}/)?.[0]?.replace(/\D/g, "");
      const name = item.replace(/\([^)]*\)/g, "").trim();
      return phone || name;
    })
    .filter(Boolean);
  return new Set(members).size;
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
    월별이용회원: (input.월별이용회원 || [])
      .map((row) => ({
        월: monthKey(row.월),
        이용회원수: numberValue(row.이용회원수),
      }))
      .filter((row) => row.월 && row.이용회원수 > 0),
    수강권TOP5: (input.수강권TOP5 || [])
      .map((row) => ({
        월: monthKey(row.월),
        라벨: stringValue(row.라벨),
        값: numberValue(row.값),
        종류수: numberValue(row.종류수),
      }))
      .filter((row) => row.월 && row.라벨),
    회원매출: (input.회원매출 || [])
      .map((row) => ({
        memberId: stringValue(row.memberId),
        memberName: stringValue(row.memberName),
        memberPhone: normalizePhone(row.memberPhone),
        totalRevenue: numberValue(row.totalRevenue),
        lastMonth: monthKey(row.lastMonth),
        recentTicketName: stringValue(row.recentTicketName),
        recentPaymentDate: stringValue(row.recentPaymentDate),
        ticketSummary: stringValue(row.ticketSummary),
      }))
      .filter((row) => row.totalRevenue > 0 && (row.memberId || row.memberName || row.memberPhone)),
    매출일일누적: (input.매출일일누적 || [])
      .map((row) => ({
        기준일: dateKey(row.기준일),
        기준월: monthKey(row.기준월),
        일매출: numberValue(row.일매출),
        월누적매출: numberValue(row.월누적매출),
        전월동일일누적: numberValue(row.전월동일일누적),
        전년동월동일일누적: numberValue(row.전년동월동일일누적),
      }))
      .filter((row) => row.기준일 && row.기준월),
    updatedAt: stringValue(input.updatedAt) || new Date().toISOString(),
  };
}

function firstValue(row: SheetRow, keys: string[]): unknown {
  for (const key of keys) {
    if (row[key] != null && row[key] !== "") return row[key];
  }
  return "";
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

function dateKey(value: unknown): string {
  if (typeof value === "number") {
    const date = new Date(Math.round((value - 25569) * 86400 * 1000));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  }
  const text = stringValue(value);
  const matched = text.match(/(20\d{2})[-./년\s]*(\d{1,2})[-./월\s]*(\d{1,2})/);
  if (matched) return `${matched[1]}-${matched[2].padStart(2, "0")}-${matched[3].padStart(2, "0")}`;
  return text;
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

function normalizePhone(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
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
