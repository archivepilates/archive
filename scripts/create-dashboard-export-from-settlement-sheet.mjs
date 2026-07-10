#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  EXPORT_SHEET_NAME,
  amount,
  dashboardDataToExportRows,
  driveRequest,
  ensureSheets,
  googleAccessToken,
  monthKey,
  parseArgs,
  quotedRange,
  round1,
  round2,
  sheetsRequest,
  sheetRowsToObjects,
  stringValue,
} from "./dashboard-export-utils.mjs";

const HOME = os.homedir();
const DEFAULT_CREDENTIALS = path.join(HOME, "ArchiveIN/secrets/google/archive-codex-operator.json");
const REPORT_DIR = path.join(HOME, "ArchiveIN/automation/reports/archive-dashboard-export");
const DEFAULT_DASHBOARD_DB_SPREADSHEET_ID = "1yEU2lDM_hTKQ-qT8UNj1PsiL7fsBwAgkzsKOzfXVsKg";

const args = parseArgs(process.argv.slice(2));
const config = {
  apply: Boolean(args.apply),
  month: String(args.month || ""),
  spreadsheetId: String(args["spreadsheet-id"] || ""),
  dashboardDbSpreadsheetId: String(args["dashboard-db-spreadsheet-id"] || process.env.DASHBOARD_DB_SPREADSHEET_ID || DEFAULT_DASHBOARD_DB_SPREADSHEET_ID),
  credentialsPath: String(args.credentials || process.env.GOOGLE_APPLICATION_CREDENTIALS || DEFAULT_CREDENTIALS),
  delegatedUser: String(args["delegated-user"] || process.env.GOOGLE_DELEGATED_USER || "home@archivepilates.com"),
};

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exitCode = 1;
});

async function main() {
  if (!existsSync(config.credentialsPath)) throw new Error(`Google credentials not found: ${config.credentialsPath}`);
  const token = await googleAccessToken({
    credentialsPath: config.credentialsPath,
    scopes: ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive.metadata.readonly"],
    delegatedUser: config.delegatedUser,
  });
  const source = config.spreadsheetId ? await spreadsheetMetadata(token, config.spreadsheetId) : await findSettlementSpreadsheet(token, config.month);
  const paymentRevenueByMonth = await loadPaymentRevenueByMonth(token, config.dashboardDbSpreadsheetId);
  const dashboardData = await buildDashboardDataFromSettlement(token, source, paymentRevenueByMonth);
  const exportRows = dashboardDataToExportRows({
    data: dashboardData,
    sourceSpreadsheetId: source.id,
    sourceSpreadsheetName: source.name,
    generatedAt: dashboardData.updatedAt,
  });
  if (config.apply) {
    await ensureSheets(token, source.id, [EXPORT_SHEET_NAME]);
    await sheetsRequest(token, "POST", `/v4/spreadsheets/${source.id}/values/${encodeURIComponent(quotedRange(EXPORT_SHEET_NAME, "A:Z"))}:clear`, {});
    await sheetsRequest(
      token,
      "PUT",
      `/v4/spreadsheets/${source.id}/values/${encodeURIComponent(quotedRange(EXPORT_SHEET_NAME, "A1"))}?valueInputOption=RAW`,
      { range: quotedRange(EXPORT_SHEET_NAME, "A1"), majorDimension: "ROWS", values: exportRows },
    );
  }
  const report = {
    ok: true,
    mode: config.apply ? "apply" : "dry-run",
    source,
    dashboardDbSpreadsheetId: config.dashboardDbSpreadsheetId,
    exportSheetName: EXPORT_SHEET_NAME,
    rows: Math.max(0, exportRows.length - 1),
    sections: Object.fromEntries(
      Object.entries(dashboardData)
        .filter(([, value]) => Array.isArray(value))
        .map(([key, value]) => [key, value.length]),
    ),
    warning: "Apps Script 원본 scriptId가 확인되기 전까지 이 Node 보조 스크립트가 대시보드_EXPORT 생성 작업을 대체합니다.",
    updatedAt: dashboardData.updatedAt,
  };
  console.log(JSON.stringify({ ...report, reportPath: writeReport(report) }, null, 2));
}

async function spreadsheetMetadata(token, spreadsheetId) {
  const metadata = await sheetsRequest(token, "GET", `/v4/spreadsheets/${spreadsheetId}?fields=properties.title,spreadsheetId`);
  return { id: metadata.spreadsheetId || spreadsheetId, name: metadata.properties?.title || spreadsheetId };
}

async function findSettlementSpreadsheet(token, month) {
  const normalizedMonth = monthKey(month) || latestCompletedMonth();
  const name = `아카이브 정산_${normalizedMonth}`;
  const q = encodeURIComponent(`name='${name}' and trashed=false`);
  const result = await driveRequest(
    token,
    `/files?q=${q}&fields=files(id,name,modifiedTime,webViewLink)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
  );
  const file = (result.files || []).sort((a, b) => String(b.modifiedTime).localeCompare(String(a.modifiedTime)))[0];
  if (!file) throw new Error(`Settlement spreadsheet not found: ${name}`);
  return { id: file.id, name: file.name, webViewLink: file.webViewLink || "" };
}

async function buildDashboardDataFromSettlement(token, source, paymentRevenueByMonth) {
  const settlementRows = sheetRowsToObjects(await readValues(token, source.id, "정산대장"));
  const reportValues = await readValues(token, source.id, "월간리포트");
  const month = monthKey(source.name.replace("아카이브 정산_", ""));
  const instructorStats = parseInstructorStats(reportValues, month);
  const groupSummary = parseGroupSummary(reportValues);
  const instructorRows = settlementRows
    .map((row) => ({
      월: month,
      강사: stringValue(row.성명),
      총매출: Math.round(amount(row.총매출)),
      세전총액: Math.round(amount(row.세전총액)),
      실지급액: Math.round(amount(row.실지급액)),
      그룹횟수: round2(amount(row.그룹횟수)),
      프라이빗횟수: round2(amount(row.프라이빗횟수)),
      강사레슨횟수: round2(amount(row.강사레슨횟수)),
    }))
    .filter((row) => row.강사);
  const lessonRevenue = instructorRows.reduce((sum, row) => sum + row.총매출, 0);
  const paymentRevenue = paymentRevenueByMonth.get(month);
  const totalRevenue = paymentRevenue ? Math.round(paymentRevenue.net) : lessonRevenue;
  const pretax = instructorRows.reduce((sum, row) => sum + row.세전총액, 0);
  const net = instructorRows.reduce((sum, row) => sum + row.실지급액, 0);
  const summary = [
    {
      월: month,
      총매출: totalRevenue,
      수강권매출: totalRevenue,
      수강권총결제: paymentRevenue ? Math.round(paymentRevenue.gross) : 0,
      수강권환불: paymentRevenue ? Math.round(paymentRevenue.refunds) : 0,
      수강권매출원천: paymentRevenue?.source || "",
      수업매출: lessonRevenue,
      실지급액: net,
      세전총액: pretax,
      마진률: lessonRevenue ? round1(((lessonRevenue - pretax) / lessonRevenue) * 100) : 0,
      그룹세션: round2(groupSummary.groupSessions || instructorRows.reduce((sum, row) => sum + row.그룹횟수, 0)),
      프라이빗: round2(instructorRows.reduce((sum, row) => sum + row.프라이빗횟수, 0)),
      강사레슨: round2(instructorRows.reduce((sum, row) => sum + row.강사레슨횟수, 0)),
      예약률: round1((groupSummary.reservationRate || 0) * 100),
      출석률: round1((groupSummary.attendanceRate || 0) * 100),
    },
  ];
  return {
    summary,
    강사별: instructorRows.map(({ 그룹횟수, 프라이빗횟수, 강사레슨횟수, ...row }) => row),
    강사통계: instructorStats,
    월별강사평균인원: instructorStats.map((row) => ({ 월: row.월, 강사: row.강사, 그룹평균인원: row.그룹평균인원 })),
    매출일일누적: [],
    updatedAt: new Date().toISOString(),
  };
}

async function loadPaymentRevenueByMonth(token, spreadsheetId) {
  if (!spreadsheetId) return new Map();
  const [masterRows, rawRows] = await Promise.all([
    readOptionalSheetObjects(token, spreadsheetId, "수강권매출_Master", "A:Z"),
    readOptionalSheetObjects(token, spreadsheetId, "수강권매출_원본", "A:Z"),
  ]);
  const master = aggregateTicketRevenue(masterRows);
  const raw = aggregateTicketRevenue(rawRows);
  const months = new Set([...master.keys(), ...raw.keys()]);
  const result = new Map();
  for (const month of months) {
    const source = master.get(month)?.rows ? "수강권매출_Master" : "수강권매출_원본";
    const value = source === "수강권매출_Master" ? master.get(month) : raw.get(month);
    if (value) result.set(month, { ...value, source });
  }
  return result;
}

async function readOptionalSheetObjects(token, spreadsheetId, sheetName, range) {
  try {
    return sheetRowsToObjects(await readValues(token, spreadsheetId, sheetName, range));
  } catch {
    return [];
  }
}

function aggregateTicketRevenue(rows) {
  const byMonth = new Map();
  for (const row of rows) {
    const month = monthKey(firstValue(row, ["기준월", "월", "결제월", "결제일"]));
    if (!month) continue;
    const value = amount(firstValue(row, ["총결제금액", "결제금액합계", "결제금액", "실결제금액", "매출", "금액"]));
    const current = byMonth.get(month) || { rows: 0, positiveRows: 0, refundRows: 0, gross: 0, refunds: 0, net: 0 };
    current.rows += 1;
    current.net += value;
    if (value > 0) {
      current.positiveRows += 1;
      current.gross += value;
    } else if (value < 0) {
      current.refundRows += 1;
      current.refunds += value;
    }
    byMonth.set(month, current);
  }
  return byMonth;
}

async function readValues(token, spreadsheetId, sheetName, range = "A:Z") {
  const result = await sheetsRequest(
    token,
    "GET",
    `/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(quotedRange(sheetName, range))}?valueRenderOption=UNFORMATTED_VALUE`,
  );
  return result.values || [];
}

function firstValue(row, keys) {
  for (const key of keys) {
    if (row[key] != null && row[key] !== "") return row[key];
  }
  return "";
}

function parseGroupSummary(values) {
  const row = values[3] || [];
  return {
    groupSessions: amount(row[0]),
    reservationRate: amount(row[5]),
    attendanceRate: amount(row[6]),
  };
}

function parseInstructorStats(values, month) {
  const rows = [];
  for (let index = 7; index < values.length; index += 1) {
    const row = values[index] || [];
    if (!row[0]) break;
    rows.push({
      월: month,
      강사: stringValue(row[0]),
      그룹평균인원: round2(amount(row[2])),
      그룹예약률: round1(amount(row[3]) * 100),
      그룹출석률: round1(amount(row[4]) * 100),
    });
  }
  return rows;
}

function latestCompletedMonth() {
  const now = new Date();
  const kst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  kst.setMonth(kst.getMonth() - 1);
  return `${kst.getFullYear()}-${String(kst.getMonth() + 1).padStart(2, "0")}`;
}

function writeReport(report) {
  mkdirSync(REPORT_DIR, { recursive: true });
  const reportPath = path.join(REPORT_DIR, `${new Date().toISOString().replace(/[:.]/g, "-")}-dashboard-export.json`);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return reportPath;
}
