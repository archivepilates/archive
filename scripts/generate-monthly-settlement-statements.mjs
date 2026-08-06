#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import XLSX from "xlsx";
import { googleAccessToken, sheetsRequest } from "./dashboard-export-utils.mjs";
import {
  calculateSplitCompensation,
  readRegularCompensationCarryForward,
} from "./lib/monthly-settlement-compensation.mjs";

const HOME = os.homedir();
const DEFAULT_ROOT = path.join(
  HOME,
  "Library/CloudStorage/GoogleDrive-home@archivepilates.com/내 드라이브/아카이브필라테스/아카이브필라테스/03_재무_대출_정산/아카이브 월말정산",
);
const DEFAULT_BACKUP_ROOT = path.join(HOME, "Library/CloudStorage/GoogleDrive-home@archivepilates.com/내 드라이브/아카이브 정산/월별정산백업");
const DEFAULT_SETTLEMENT_DRIVE_ROOT = path.dirname(DEFAULT_BACKUP_ROOT);
const DEFAULT_CREDENTIALS = path.join(HOME, "ArchiveIN/secrets/google/archive-codex-operator.json");
const args = parseArgs(process.argv.slice(2));
const ym = String(args.month || previousMonthYyyyMm());
const rootDir = expandHome(String(args.root || process.env.ARCHIVE_MONTHLY_SETTLEMENT_ROOT || DEFAULT_ROOT));
const backupRoot = expandHome(String(args["backup-root"] || process.env.ARCHIVE_SETTLEMENT_BACKUP_ROOT || DEFAULT_BACKUP_ROOT));
const settlementDriveRoot = expandHome(String(args["settlement-drive-root"] || process.env.ARCHIVE_SETTLEMENT_DRIVE_ROOT || DEFAULT_SETTLEMENT_DRIVE_ROOT));
const credentialsPath = expandHome(String(args.credentials || process.env.GOOGLE_APPLICATION_CREDENTIALS || DEFAULT_CREDENTIALS));
const delegatedUser = String(args["delegated-user"] || process.env.GOOGLE_DELEGATED_USER || "home@archivepilates.com");
const targetDir = path.join(rootDir, ym);
const statementXlsx = path.join(targetDir, `아카이브 정산명세서 ${ym}.xlsx`);
const settlementXlsx = path.join(targetDir, `아카이브 정산 ${ym}.xlsx`);
const apply = Boolean(args.apply);

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  mkdirSync(targetDir, { recursive: true });
  await ensureInputWorkbooks();
  const statement = readStatementWorkbook(statementXlsx);
  const previous = readPreviousSummary(rootDir, ym);
  const operation = existsSync(settlementXlsx) ? readOperationWorkbook(settlementXlsx) : null;
  const summary = buildSummary(statement.instructors, previous?.totalPayout || 0, operation);
  const files = [];
  for (const instructor of statement.instructors) {
    const html = renderInstructorHtml({ ym, instructor, generatedAt: new Date() });
    const fileName = `아카이브 정산명세서 ${ym} ${instructor.name}.html`;
    const outputPath = path.join(targetDir, fileName);
    if (apply) writeFileSync(outputPath, html);
    files.push({ name: instructor.name, fileName, payout: instructor.finalPayout });
  }
  const indexHtml = renderIndexHtml({ ym, summary, files, generatedAt: new Date() });
  const indexPath = path.join(targetDir, `아카이브 정산명세서 ${ym}_INDEX.html`);
  if (apply) writeFileSync(indexPath, indexHtml);

  const result = {
    ok: true,
    mode: apply ? "apply" : "dry-run",
    month: ym,
    targetDir,
    statementXlsx,
    settlementXlsx: existsSync(settlementXlsx) ? settlementXlsx : "",
    indexPath,
    instructorFiles: files.length,
    summary,
  };
  console.log(JSON.stringify(result, null, 2));
}

async function ensureInputWorkbooks() {
  if (!existsSync(settlementXlsx)) {
    await exportSettlementBackupWorkbook(settlementXlsx);
  }

  if (!existsSync(statementXlsx)) {
    createStatementWorkbookFromSettlement(settlementXlsx, statementXlsx);
  }
}

async function exportSettlementBackupWorkbook(outputPath) {
  const gsheetPath = path.join(backupRoot, `아카이브 정산_${yyyyMmHyphen(ym)}.gsheet`);
  if (!existsSync(gsheetPath)) {
    console.warn(`월별정산백업 파일이 없어 수업매출원본데이터에서 정산 workbook을 생성합니다: ${gsheetPath}`);
    await createSettlementWorkbookFromRaw(outputPath);
    return;
  }

  const pointer = JSON.parse(readFileSync(gsheetPath, "utf8"));
  const docId = pointer.doc_id || pointer.id;
  if (!docId) throw new Error(`Google Sheet doc_id를 읽을 수 없습니다: ${gsheetPath}`);

  const token = await googleAccessToken({
    credentialsPath,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    delegatedUser,
  });
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(docId)}/export?mimeType=${encodeURIComponent(
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  )}`;
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`정산 백업 export 실패 (${response.status}): ${await response.text()}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(outputPath, buffer);
}

async function createSettlementWorkbookFromRaw(outputPath) {
  const range = monthDateRange(ym);
  const lessonSource = findMonthlySourceFile("수업매출원본데이터", "수업매출_현황", range);
  if (!lessonSource) {
    throw new Error(`수업매출원본데이터에서 ${range.start}~${range.end} 원본 엑셀을 찾을 수 없습니다.`);
  }

  const refs = await loadReferenceTables();
  const rawRows = readWorkbookObjects(lessonSource).map((row) => mapRawLessonRow(row, path.basename(lessonSource)));
  const auxRows = buildAuxRows(rawRows, refs);
  const payroll = buildPayrollRows(auxRows, refs);
  const report = buildMonthlyReportRows(auxRows, payroll.rows);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(buildRawSheetRows(rawRows)), "Sheet1");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(buildSessionSheetRows(payroll.groupSessions)), "Sheet2");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(buildLegacySummarySheetRows(payroll, report)), "Sheet3");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(buildAuxSheetRows(auxRows)), "정산보조");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(buildPayrollSheetRows(payroll.rows)), "정산대장");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(buildReportSheetRows(report)), "월간리포트");
  XLSX.writeFile(wb, outputPath);
}

async function loadReferenceTables() {
  const token = await googleAccessToken({
    credentialsPath,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly", "https://www.googleapis.com/auth/drive.readonly"],
    delegatedUser,
  });
  const priceFile = findGsheetPointerByNormalizedName(settlementDriveRoot, "기간권 차감금액표");
  const rateFile = findGsheetPointerByNormalizedName(settlementDriveRoot, "아카이브 강사 보수기준표");
  const priceMap = {};
  const groupMap = {};
  const privateMap = {};

  if (priceFile) {
    const priceRows = await readSheetValues(token, priceFile, "A:Z");
    for (const row of priceRows.slice(1)) {
      const ticketName = clean(row[1]);
      if (ticketName) priceMap[ticketName] = money(row[2]);
    }
  }

  if (rateFile) {
    const groupRows = await readSheetValues(token, rateFile, "'그룹'!A:Z");
    for (const row of groupRows.slice(1)) {
      const name = clean(row[0]);
      if (name) groupMap[name] = row.slice(1).map(number);
    }
    const privateRows = await readSheetValues(token, rateFile, "'프라이빗'!A:Z");
    for (const row of privateRows.slice(1)) {
      const name = clean(row[0]);
      if (name) privateMap[name] = number(row[1]);
    }
  }

  return { priceMap, groupMap, privateMap };
}

async function readSheetValues(token, spreadsheetId, range) {
  const result = await sheetsRequest(token, "GET", `/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`);
  return result.values || [];
}

function findGsheetPointerByNormalizedName(root, baseName) {
  const wanted = normalizeFileName(`${baseName}.gsheet`);
  for (const name of readdirSync(root)) {
    if (normalizeFileName(name) !== wanted) continue;
    const pointer = JSON.parse(readFileSync(path.join(root, name), "utf8"));
    return pointer.doc_id || pointer.id || "";
  }
  return "";
}

function findMonthlySourceFile(dirName, prefix, range) {
  const dir = path.join(settlementDriveRoot, dirName);
  if (!existsSync(dir)) return "";
  const expected = `${prefix}${range.start}~${range.end}.xlsx`;
  const exact = path.join(dir, expected);
  if (existsSync(exact)) return exact;
  const candidates = readdirSync(dir)
    .filter((name) => name.endsWith(".xlsx") && normalizeFileName(name).includes(normalizeFileName(prefix)) && name.includes(`${range.start}~${range.end}`))
    .map((name) => path.join(dir, name));
  return candidates[0] || "";
}

function readWorkbookObjects(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: "" });
}

function mapRawLessonRow(row, sourceFileName) {
  const ticketName = clean(row["수강권명"]);
  const classDate = normalizeDate(row["날짜"]);
  const classTime = normalizeTime(row["수업시작"]);
  const instructorName = clean(row["수업 강사"] || row["강사"]);
  return {
    sourceFileName,
    classDate,
    weekday: clean(row["요일"]) || getWeekdayKorean(classDate),
    classTime,
    endTime: normalizeTime(row["수업종료"]),
    memberName: clean(row["회원명"]),
    instructorName,
    originalType: clean(row["수업"]),
    finalType: ticketName.includes("강사레슨") ? "강사레슨" : clean(row["수업"]),
    ticketName,
    attendance: clean(row["출결"]),
    revenue: money(row["차감 금액"] || row["차감금액"]),
    sessionKey: `${classDate}_${classTime}_${instructorName}`,
  };
}

function buildAuxRows(rawRows, refs) {
  return rawRows.map((row) => {
    const attendanceFlag = row.attendance === "출석" ? 1 : 0;
    const settlementCount = settlementCountForAttendance(row.attendance);
    const baseRevenue = row.revenue > 0 ? row.revenue : refs.priceMap[row.ticketName] || 0;
    const settlementRevenue = baseRevenue * settlementCount;
    let appliedRate = 0;
    let linePay = 0;
    if (row.finalType === "프라이빗") {
      appliedRate = refs.privateMap[row.instructorName] || 0.45;
      linePay = settlementCount ? (settlementRevenue / 1.1) * appliedRate : 0;
    } else if (row.finalType === "강사레슨") {
      appliedRate = refs.privateMap[row.instructorName] || 0.45;
      linePay = settlementCount ? (settlementRevenue / 1.1) * appliedRate : 0;
    }
    return {
      ...row,
      attendanceFlag,
      settlementCount,
      settlementRevenue,
      appliedRate,
      linePay: Math.round(linePay),
    };
  });
}

function buildPayrollRows(auxRows, refs) {
  const byInstructor = new Map();
  const groupSessions = new Map();
  const lessonSessions = new Map();

  for (const row of auxRows) {
    if (!row.instructorName) continue;
    if (!byInstructor.has(row.instructorName)) {
      byInstructor.set(row.instructorName, {
        name: row.instructorName,
        groupCount: 0,
        privateCount: 0,
        lessonCount: 0,
        groupPay: 0,
        privatePay: 0,
        lessonPay: 0,
        groupRevenue: 0,
        privateRevenue: 0,
        lessonRevenue: 0,
      });
    }
    const instructor = byInstructor.get(row.instructorName);
    if (row.finalType === "그룹") {
      if (!groupSessions.has(row.sessionKey)) {
        groupSessions.set(row.sessionKey, { instructorName: row.instructorName, weekday: row.weekday, classTime: row.classTime, booked: 0, attended: 0, revenue: 0 });
      }
      const session = groupSessions.get(row.sessionKey);
      session.booked += 1;
      if (row.attendanceFlag) {
        session.attended += 1;
        session.revenue += row.settlementRevenue;
      }
      continue;
    }
    if (row.finalType === "프라이빗") {
      if (!row.settlementCount) continue;
      instructor.privateCount += row.settlementCount;
      instructor.privateRevenue += row.settlementRevenue;
      instructor.privatePay += row.linePay;
      continue;
    }
    if (row.finalType === "강사레슨") {
      if (!lessonSessions.has(row.sessionKey)) {
        lessonSessions.set(row.sessionKey, { instructorName: row.instructorName, attended: 0, revenue: 0, pay: 0 });
      }
      if (!row.settlementCount) continue;
      const session = lessonSessions.get(row.sessionKey);
      session.attended += row.settlementCount;
      session.revenue += row.settlementRevenue;
      session.pay += row.linePay;
    }
  }

  for (const session of groupSessions.values()) {
    const instructor = byInstructor.get(session.instructorName);
    instructor.groupCount += 1;
    instructor.groupRevenue += session.revenue;
    const rates = refs.groupMap[session.instructorName] || [15000, 25000, 25000, 30000, 32000, 35000, 35000, 35000, 35000, 35000, 35000];
    instructor.groupPay += Math.round(rates[session.attended] ?? rates[rates.length - 1] ?? 0);
  }

  for (const session of lessonSessions.values()) {
    if (session.attended <= 0) continue;
    const instructor = byInstructor.get(session.instructorName);
    instructor.lessonCount += 1;
    instructor.lessonRevenue += session.revenue;
    instructor.lessonPay += session.pay;
  }

  const rows = [...byInstructor.values()].sort((a, b) => a.name.localeCompare(b.name, "ko")).map((row, index) => {
    const totalRevenue = Math.round(row.groupRevenue + row.privateRevenue + row.lessonRevenue);
    const totalPay = Math.round(row.groupPay + row.privatePay + row.lessonPay);
    const withholding = Math.floor(totalPay * 0.033);
    return {
      no: index + 1,
      name: row.name,
      groupCount: row.groupCount,
      privateCount: row.privateCount,
      lessonCount: row.lessonCount,
      groupPay: Math.round(row.groupPay),
      privatePay: Math.round(row.privatePay),
      lessonPay: Math.round(row.lessonPay),
      totalPay,
      withholding,
      netPay: totalPay - withholding,
      totalRevenue,
      marginRate: totalRevenue > 0 ? (totalRevenue - totalPay) / totalRevenue : 0,
      groupRevenue: Math.round(row.groupRevenue),
      privateRevenue: Math.round(row.privateRevenue),
      lessonRevenue: Math.round(row.lessonRevenue),
    };
  });

  return { rows, groupSessions, lessonSessions };
}

function buildMonthlyReportRows(auxRows, payrollRows) {
  const groupSessions = new Map();
  for (const row of auxRows.filter((item) => item.finalType === "그룹")) {
    if (!groupSessions.has(row.sessionKey)) groupSessions.set(row.sessionKey, { instructorName: row.instructorName, weekday: row.weekday, time: row.classTime, booked: 0, attended: 0 });
    const session = groupSessions.get(row.sessionKey);
    session.booked += 1;
    if (row.attendanceFlag) session.attended += 1;
  }
  const sessions = [...groupSessions.values()];
  const totalSessions = sessions.length;
  const totalBooked = sessions.reduce((sum, row) => sum + row.booked, 0);
  const totalAttended = sessions.reduce((sum, row) => sum + row.attended, 0);
  const instructorMap = new Map();
  for (const session of sessions) {
    if (!instructorMap.has(session.instructorName)) instructorMap.set(session.instructorName, { sessions: 0, booked: 0, attended: 0 });
    const row = instructorMap.get(session.instructorName);
    row.sessions += 1;
    row.booked += session.booked;
    row.attended += session.attended;
  }
  return {
    summary: {
      totalSessions,
      totalBooked,
      totalAttended,
      avgBooked: totalSessions ? totalBooked / totalSessions : 0,
      avgAttended: totalSessions ? totalAttended / totalSessions : 0,
      avgBookingRate: totalSessions ? totalBooked / (totalSessions * 5) : 0,
      avgAttendanceRate: totalBooked ? totalAttended / totalBooked : 0,
    },
    instructorStats: [...instructorMap.entries()].sort((a, b) => a[0].localeCompare(b[0], "ko")).map(([name, row]) => ({
      name,
      avgBooked: row.sessions ? row.booked / row.sessions : 0,
      avgAttended: row.sessions ? row.attended / row.sessions : 0,
      bookingRate: row.sessions ? row.booked / (row.sessions * 5) : 0,
      attendanceRate: row.booked ? row.attended / row.booked : 0,
    })),
    payrollRows,
  };
}

function buildRawSheetRows(rawRows) {
  return [
    ["수업", "날짜", "수업시작", "수업종료", "요일", "회원명", "수강권명", "차감 금액", "수업 강사", "출결"],
    ...rawRows.map((row) => [row.originalType, row.classDate, row.classTime, row.endTime, row.weekday, row.memberName, row.ticketName, row.revenue, row.instructorName, row.attendance]),
  ];
}

function buildAuxSheetRows(auxRows) {
  return [
    ["원본파일명", "수업일자", "요일", "수업시간", "회원명", "강사명", "원래수업구분", "최종수업구분", "수강권명", "출결", "차감금액", "세션키", "정산대상", "정산매출", "적용요율", "행보수"],
    ...auxRows.map((row) => [row.sourceFileName, row.classDate, row.weekday, row.classTime, row.memberName, row.instructorName, row.originalType, row.finalType, row.ticketName, row.attendance, row.revenue, row.sessionKey, row.settlementCount, row.settlementRevenue, row.appliedRate, row.linePay]),
  ];
}

function buildPayrollSheetRows(rows) {
  return [
    ["순번", "성명", "그룹횟수", "프라이빗횟수", "강사레슨횟수", "그룹보수합계", "프라이빗보수합계", "강사레슨보수합계", "세전총액", "공제(3.3%)", "실지급액", "총매출", "수업 마진률"],
    ...rows.map((row) => [row.no, row.name, row.groupCount, row.privateCount, row.lessonCount, row.groupPay, row.privatePay, row.lessonPay, row.totalPay, row.withholding, row.netPay, row.totalRevenue, row.marginRate]),
  ];
}

function buildSessionSheetRows(groupSessions) {
  return [
    ["수업", "날짜/시간/강사", "수업예약인원", "수업출석인원", "수업매출"],
    ...[...groupSessions.entries()].map(([key, row]) => ["그룹", key, row.booked, row.attended, row.revenue]),
  ];
}

function buildLegacySummarySheetRows(payroll, report) {
  const names = payroll.rows.map((row) => row.name);
  const rowByName = new Map(payroll.rows.map((row) => [row.name, row]));
  const valueRow = (label, getter, totalValue = null) => [
    label,
    ...names.map((name) => getter(rowByName.get(name))),
    totalValue ?? names.reduce((sum, name) => sum + number(getter(rowByName.get(name))), 0),
  ];
  return [
    [`아카이브 ${Number(ym.slice(4, 6))}월 정산표`, "", "", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", "", "", ""],
    ["구분", ...names, "합계", "그룹 출석총인원", "그룹 예약총인원"],
    [...valueRow("강사 그룹 횟수", (row) => row.groupCount), report.summary.totalAttended, report.summary.totalBooked],
    valueRow("강사 그룹 매출", (row) => row.groupRevenue || 0),
    valueRow("강사 그룹 보수", (row) => row.groupPay),
    valueRow("그룹 출석 인원 평균", (row) => report.instructorStats.find((item) => item.name === row.name)?.avgAttended || 0, report.summary.avgAttended),
    valueRow("강사 프라이빗 횟수", (row) => row.privateCount),
    valueRow("강사 프라이빗 매출", (row) => row.privateRevenue || 0),
    valueRow("강사 프라이빗 보수", (row) => row.privatePay),
  ];
}

function buildReportSheetRows(report) {
  return [
    ["아카이브 월간 운영 리포트"],
    [],
    ["전체 그룹 세션 수", "그룹 예약총인원", "그룹 출석총인원", "그룹 예약평균", "그룹 출석평균", "전체 그룹 예약률", "전체 그룹 출석률"],
    [report.summary.totalSessions, report.summary.totalBooked, report.summary.totalAttended, report.summary.avgBooked, report.summary.avgAttended, report.summary.avgBookingRate, report.summary.avgAttendanceRate],
    [],
    [],
    ["강사명", "그룹 예약평균", "그룹 출석평균", "그룹 예약률", "그룹 출석률"],
    ...report.instructorStats.map((item) => [item.name, item.avgBooked, item.avgAttended, item.bookingRate, item.attendanceRate]),
  ];
}

function createStatementWorkbookFromSettlement(settlementPath, outputPath) {
  const settlementWb = XLSX.readFile(settlementPath, { cellDates: true });
  const previousInfo = readPreviousInstructorInfo(rootDir, ym);
  const payroll = readCurrentPayrollRows(settlementWb, previousInfo);
  const infoRows = buildInstructorInfoSheetRows(payroll, previousInfo);
  const ledgerRows = buildStatementLedgerRows(payroll);
  const statementRows = buildSimpleStatementSheetRows(payroll);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(infoRows), "강사정보");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ledgerRows), "정산대장");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(statementRows), "정산명세서");
  XLSX.writeFile(wb, outputPath);
}

function readPreviousInstructorInfo(root, currentYm) {
  for (let offset = -1; offset >= -12; offset -= 1) {
    const previousYm = shiftYyyyMm(currentYm, offset);
    const previousFile = path.join(root, previousYm, `아카이브 정산명세서 ${previousYm}.xlsx`);
    if (!existsSync(previousFile)) continue;
    const wb = XLSX.readFile(previousFile, { cellDates: true });
    const infoRows = rows(wb, "강사정보");
    const ledgerRows = rows(wb, "정산대장");
    const result = new Map();

    for (const row of infoRows.slice(4)) {
      const name = clean(row[1]);
      if (!name) continue;
      result.set(name, {
        name,
        role: clean(row[2]),
        groupGrade: clean(row[3]),
        privateGrade: clean(row[4]),
        bank: clean(row[5]),
        account: clean(row[6]),
        accountHolder: clean(row[7]),
      });
    }

    for (const row of ledgerRows.slice(4)) {
      const name = clean(row[1]);
      if (!name) continue;
      const current = result.get(name) || { name };
      const compensation = readRegularCompensationCarryForward(ledgerRows, row);
      current.regularPayout = compensation.regularPayout;
      current.regularGrossDeduction = compensation.regularGrossDeduction;
      result.set(name, current);
    }

    return result;
  }

  return new Map();
}

function readCurrentPayrollRows(wb, previousInfo) {
  const payrollRows = rows(wb, "정산대장");
  if (payrollRows.length) return readPayrollRowsFromCurrentSettlement(payrollRows, wb, previousInfo);

  const legacyRows = rows(wb, "Sheet3");
  if (legacyRows.length) return readPayrollRowsFromLegacyOperation(legacyRows, previousInfo);

  throw new Error("정산대장 또는 Sheet3 시트를 찾을 수 없어 정산명세서 원본을 생성할 수 없습니다.");
}

function readPayrollRowsFromCurrentSettlement(payrollRows, wb, previousInfo) {
  const header = payrollRows[0].map(clean);
  const index = Object.fromEntries(header.map((name, idx) => [name, idx]));
  const groupAverageByName = readGroupAverageByName(wb);

  return payrollRows
    .slice(1)
    .filter((row) => clean(row[index["성명"]]))
    .map((row, idx) => normalizeStatementRow({
      no: number(row[index["순번"]]) || idx + 1,
      name: clean(row[index["성명"]]),
      groupCount: number(row[index["그룹횟수"]]),
      privateCount: number(row[index["프라이빗횟수"]]),
      lessonCount: number(row[index["강사레슨횟수"]]),
      groupAverage: groupAverageByName.get(clean(row[index["성명"]])) || 0,
      groupPay: money(row[index["그룹보수합계"]]),
      privatePay: money(row[index["프라이빗보수합계"]]),
      lessonPay: money(row[index["강사레슨보수합계"]]),
    }, previousInfo));
}

function readPayrollRowsFromLegacyOperation(values, previousInfo) {
  const names = (values[2] || []).slice(1, 7).map(clean);
  const byLabel = new Map();
  for (const row of values) {
    const label = clean(row[0]);
    if (label) byLabel.set(label, row);
  }

  return names
    .filter(Boolean)
    .map((name, idx) => normalizeStatementRow({
      no: idx + 1,
      name,
      groupCount: number(byLabel.get("강사 그룹 횟수")?.[idx + 1]),
      privateCount: number(byLabel.get("강사 프라이빗 횟수")?.[idx + 1]),
      lessonCount: 0,
      groupAverage: number(byLabel.get("그룹 출석 인원 평균")?.[idx + 1]),
      groupPay: money(byLabel.get("강사 그룹 보수")?.[idx + 1]),
      privatePay: money(byLabel.get("강사 프라이빗 보수")?.[idx + 1]),
      lessonPay: 0,
    }, previousInfo));
}

function normalizeStatementRow(raw, previousInfo) {
  const info = previousInfo.get(raw.name) || { name: raw.name };
  const regularGrossDeduction = info.regularPayout ? info.regularGrossDeduction || 0 : 0;
  const lessonPay = raw.lessonPay || 0;
  const compensation = calculateSplitCompensation({
    groupPay: raw.groupPay,
    privatePay: raw.privatePay,
    lessonPay,
    regularPayout: info.regularPayout || 0,
    regularGrossDeduction,
  });
  const { adjustmentAmount } = compensation;
  const adjustmentText = buildAdjustmentText({ regularGrossDeduction, lessonPay });

  return {
    ...raw,
    role: instructorRole(raw.name, info.role),
    groupGrade: info.groupGrade || "",
    privateGrade: info.privateGrade || "",
    bank: info.bank || "",
    account: info.account || "",
    accountHolder: info.accountHolder || raw.name,
    adjustmentAmount,
    adjustmentText,
    ...compensation,
  };
}

function defaultInstructorRole(name) {
  return clean(name) === "정은영" ? "부원장" : "강사";
}

function instructorRole(name, role) {
  return clean(name) === "정은영" ? "부원장" : clean(role) || defaultInstructorRole(name);
}

function readGroupAverageByName(wb) {
  const result = new Map();
  const reportRows = rows(wb, "월간리포트");
  for (let i = 0; i < reportRows.length; i += 1) {
    const row = reportRows[i].map(clean);
    if (row[0] !== "강사명") continue;
    for (const valueRow of reportRows.slice(i + 1)) {
      const name = clean(valueRow[0]);
      if (!name) break;
      result.set(name, number(valueRow[2]));
    }
    break;
  }
  return result;
}

function buildInstructorInfoSheetRows(instructors, previousInfo) {
  return [
    [" 기초 정보", "", "", "", "", "", "", "", ""],
    ["회사명 : 아카이브필라테스", "", "", "", "", "", "", "", ""],
    ["순번", "성 명", "직 책", "그룹보수", "프라이빗보수", "계 좌 번 호", "", "", ""],
    ["", "", "", "", "", "은행", "계좌번호", "예금주", ""],
    ...instructors.map((row, idx) => {
      const info = previousInfo.get(row.name) || row;
      return [idx + 1, row.name, instructorRole(row.name, row.role || info.role), row.groupGrade || "", row.privateGrade || "", row.bank || "", row.account || "", row.accountHolder || row.name, ""];
    }),
  ];
}

function buildStatementLedgerRows(instructors) {
  const total = instructors.reduce(
    (acc, row) => {
      for (const key of ["groupCount", "privateCount", "lessonCount", "groupPay", "privatePay", "adjustmentAmount", "pretaxPay", "deductionTotal", "incomeTax", "localTax", "freelancerPayout"]) {
        acc[key] += number(row[key]);
      }
      return acc;
    },
    { groupCount: 0, privateCount: 0, lessonCount: 0, groupPay: 0, privatePay: 0, adjustmentAmount: 0, pretaxPay: 0, deductionTotal: 0, incomeTax: 0, localTax: 0, freelancerPayout: 0 },
  );
  return [
    [`${ym.slice(0, 4)}년 ${Number(ym.slice(4, 6))}월 정산`, "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
    ["순번", "성 명", "직 책", "그룹", "프라이빗", "강사레슨", "그룹평균", "수업보수\n(그룹)", "수업보수\n(프라이빗)", "조정금액", "조정내용", "세전 보수총액", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", "", "", "", "", "", "공제합계", "소득세(3%)", "주민세(0.3%)", "지급액", "실지급 합산", "정규직 실지급"],
    ...instructors.map((row) => [
      row.no,
      row.name,
      row.role,
      row.groupCount,
      row.privateCount,
      row.lessonCount,
      row.groupAverage,
      row.groupPay,
      row.privatePay,
      row.adjustmentAmount || "",
      row.adjustmentText,
      row.pretaxPay,
      row.deductionTotal,
      row.incomeTax,
      row.localTax,
      row.freelancerPayout,
      row.combinedPayout || "",
      row.regularPayout || "",
    ]),
    ["", "합  계", "", total.groupCount, total.privateCount, total.lessonCount, total.groupCount + total.privateCount + total.lessonCount, total.groupPay, total.privatePay, total.adjustmentAmount || "", "", total.pretaxPay, total.deductionTotal, total.incomeTax, total.localTax, total.freelancerPayout, "", ""],
  ];
}

function buildSimpleStatementSheetRows(instructors) {
  return [
    ["", `${ym.slice(0, 4)}년 ${Number(ym.slice(4, 6))}월 정산`, "정산명세서", "", "", `${Number(ym.slice(4, 6))}월`, "", ""],
    ...instructors.flatMap((row) => [
      ["", "이 름", `${row.name} ${row.role || "강사"} 님`, "지급일", "", row.name, row.no, row.role],
      ["", "그룹보수", row.groupPay, "", "", "", "", ""],
      ["", "프라이빗 보수", row.privatePay, "", "", "", "", ""],
      ["", "그룹", row.groupCount, "", "", "", "", ""],
      ["", "프라이빗", row.privateCount, "", "", "", "", ""],
      ["", "강사레슨", row.lessonCount, "", "", "", "", ""],
      ["", "조정금액", row.adjustmentAmount || 0, row.adjustmentText || "", "", "", "", ""],
      ["", "세전 보수총액", row.pretaxPay, "", "", "", "", ""],
      ["", "지급액", row.finalPayout, "", "", "", "", ""],
      ["", "", "", "", "", "", "", ""],
    ]),
  ];
}

function buildAdjustmentText({ regularGrossDeduction, lessonPay }) {
  const lines = [];
  if (regularGrossDeduction) lines.push(`정규직급여 (${Math.round(regularGrossDeduction).toLocaleString("ko-KR")})`);
  if (lessonPay) lines.push(`강사 레슨 ${Math.round(lessonPay).toLocaleString("ko-KR")}`);
  return lines.join("\n");
}

function readStatementWorkbook(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const info = rows(wb, "강사정보");
  const ledger = rows(wb, "정산대장");
  const infoByName = new Map();
  for (const row of info.slice(4)) {
    const name = clean(row[1]);
    if (!name) continue;
    infoByName.set(name, {
      name,
      role: clean(row[2]),
      groupGrade: clean(row[3]),
      privateGrade: clean(row[4]),
      bank: clean(row[5]),
      account: clean(row[6]),
      accountHolder: clean(row[7]),
    });
  }
  const instructors = ledger
    .slice(4)
    .filter((row) => /^\d+$/.test(clean(row[0])) && clean(row[1]))
    .map((row) => {
      const hasLessonCountColumn = clean(ledger[2]?.[5]) === "강사레슨";
      const groupAverageIndex = hasLessonCountColumn ? 6 : 5;
      const groupPayIndex = hasLessonCountColumn ? 7 : 6;
      const privatePayIndex = hasLessonCountColumn ? 8 : 7;
      const adjustmentAmountIndex = hasLessonCountColumn ? 9 : 8;
      const adjustmentTextIndex = hasLessonCountColumn ? 10 : 9;
      const pretaxPayIndex = hasLessonCountColumn ? 11 : 10;
      const deductionTotalIndex = hasLessonCountColumn ? 12 : 11;
      const incomeTaxIndex = hasLessonCountColumn ? 13 : 12;
      const localTaxIndex = hasLessonCountColumn ? 14 : 13;
      const freelancerPayoutIndex = hasLessonCountColumn ? 15 : 14;
      const combinedPayoutIndex = hasLessonCountColumn ? 16 : 15;
      const regularPayoutIndex = hasLessonCountColumn ? 17 : 16;
      const name = clean(row[1]);
      const base = infoByName.get(name) || { name, role: clean(row[2]) };
      const freelancerPayout = money(row[freelancerPayoutIndex]);
      const combinedPayout = money(row[combinedPayoutIndex]);
      const regularPayout = money(row[regularPayoutIndex]);
      const finalPayout = combinedPayout || freelancerPayout;
      return {
        ...base,
        role: instructorRole(name, base.role),
        groupCount: number(row[3]),
        privateCount: number(row[4]),
        lessonCount: hasLessonCountColumn ? number(row[5]) : 0,
        groupAverage: number(row[groupAverageIndex]),
        groupPay: money(row[groupPayIndex]),
        privatePay: money(row[privatePayIndex]),
        adjustmentAmount: money(row[adjustmentAmountIndex]),
        adjustmentText: clean(row[adjustmentTextIndex]),
        pretaxPay: money(row[pretaxPayIndex]),
        deductionTotal: money(row[deductionTotalIndex]),
        incomeTax: money(row[incomeTaxIndex]),
        localTax: money(row[localTaxIndex]),
        freelancerPayout,
        combinedPayout,
        regularPayout,
        finalPayout,
      };
    });
  return { instructors };
}

function readPreviousSummary(root, currentYm) {
  const previousYm = shiftYyyyMm(currentYm, -1);
  const previousFile = path.join(root, previousYm, `아카이브 정산명세서 ${previousYm}.xlsx`);
  if (!existsSync(previousFile)) return null;
  const statement = readStatementWorkbook(previousFile);
  return {
    month: previousYm,
    totalPayout: statement.instructors.reduce((sum, row) => sum + row.finalPayout, 0),
  };
}

function readOperationWorkbook(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const sheet3 = rows(wb, "Sheet3");
  if (!sheet3.length) return readCurrentOperationWorkbook(wb);
  const byLabel = new Map();
  for (const row of sheet3) {
    const label = clean(row[0]);
    if (label) byLabel.set(label, row);
  }
  return {
    groupAttendanceAverage: number(byLabel.get("그룹 출석 인원 평균")?.[7]),
    groupReservationAverage: number(byLabel.get("그룹 예약 인원 평균")?.[7]),
    groupRevenue: money(byLabel.get("강사 그룹 매출")?.[7]),
    groupPay: money(byLabel.get("강사 그룹 보수")?.[7]),
    privateCount: number(byLabel.get("강사 프라이빗 횟수")?.[7]),
    privateRevenue: money(byLabel.get("강사 프라이빗 매출")?.[7]),
    privatePay: money(byLabel.get("강사 프라이빗 보수")?.[7]),
  };
}

function readCurrentOperationWorkbook(wb) {
  const auxRows = rows(wb, "정산보조");
  const payrollRows = rows(wb, "정산대장");
  const reportRows = rows(wb, "월간리포트");
  if (!auxRows.length && !payrollRows.length) return null;

  const auxHeader = (auxRows[0] || []).map(clean);
  const auxIndex = Object.fromEntries(auxHeader.map((name, idx) => [name, idx]));
  const payrollHeader = (payrollRows[0] || []).map(clean);
  const payrollIndex = Object.fromEntries(payrollHeader.map((name, idx) => [name, idx]));
  const payroll = payrollRows.slice(1);
  const aux = auxRows.slice(1);

  const groupRevenue = aux
    .filter((row) => clean(row[auxIndex["최종수업구분"]]) === "그룹")
    .reduce((sum, row) => sum + money(row[auxIndex["정산매출"]]), 0);
  const privateRevenue = aux
    .filter((row) => clean(row[auxIndex["최종수업구분"]]) === "프라이빗")
    .reduce((sum, row) => sum + money(row[auxIndex["정산매출"]]), 0);
  const groupPay = payroll.reduce((sum, row) => sum + money(row[payrollIndex["그룹보수합계"]]), 0);
  const privatePay = payroll.reduce((sum, row) => sum + money(row[payrollIndex["프라이빗보수합계"]]), 0);
  const privateCount = payroll.reduce((sum, row) => sum + number(row[payrollIndex["프라이빗횟수"]]), 0);

  return {
    groupAttendanceAverage: readReportSummaryValue(reportRows, "그룹 출석평균"),
    groupReservationAverage: readReportSummaryValue(reportRows, "그룹 예약평균"),
    groupRevenue,
    groupPay,
    privateCount,
    privateRevenue,
    privatePay,
  };
}

function readReportSummaryValue(reportRows, headerName) {
  for (let i = 0; i < reportRows.length - 1; i += 1) {
    const header = reportRows[i].map(clean);
    const index = header.indexOf(headerName);
    if (index < 0) continue;
    return number(reportRows[i + 1]?.[index]);
  }
  return 0;
}

function buildSummary(instructors, previousTotalPayout, operation) {
  const totalPayout = instructors.reduce((sum, row) => sum + row.finalPayout, 0);
  const groupTotal = instructors.reduce((sum, row) => sum + row.groupCount, 0);
  const privateTotal = instructors.reduce((sum, row) => sum + row.privateCount, 0);
  const weightedGroupAverage = groupTotal
    ? instructors.reduce((sum, row) => sum + row.groupAverage * row.groupCount, 0) / groupTotal
    : 0;
  return {
    totalPayout,
    previousTotalPayout,
    diffFromPrevious: totalPayout - previousTotalPayout,
    groupTotal,
    privateTotal: operation?.privateCount || privateTotal,
    totalClassCount: groupTotal + (operation?.privateCount || privateTotal),
    monthlyGroupAverage: operation?.groupAttendanceAverage || weightedGroupAverage,
    groupRevenue: operation?.groupRevenue || 0,
    groupPay: operation?.groupPay || instructors.reduce((sum, row) => sum + row.groupPay, 0),
    privateRevenue: operation?.privateRevenue || 0,
    privatePay: operation?.privatePay || instructors.reduce((sum, row) => sum + row.privatePay, 0),
  };
}

function renderIndexHtml({ ym, summary, files, generatedAt }) {
  const title = `${formatYm(ym)} 정산명세서`;
  const direction = summary.diffFromPrevious >= 0 ? "증가" : "감소";
  const diffClass = summary.diffFromPrevious >= 0 ? "up" : "down";
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ARCHIVE PILATES ${title}</title>
  <style>${baseCss()}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:14px;margin-top:24px}.summary-card{background:#fff;border:1px solid var(--line);border-radius:18px;padding:18px}.summary-card b{display:block;font-size:26px;margin-top:6px}.summary-card .sub{color:var(--muted);font-size:13px}.up{color:#0f7b50}.down{color:#bf3b21}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:14px;margin-top:20px}.cards .card{display:flex;justify-content:space-between;gap:12px;text-decoration:none;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:18px;padding:18px}.cards span{color:var(--accent-dark);font-weight:900}.section-title{margin:30px 0 0;font-size:22px}</style>
</head>
<body><main><article class="statement">
  <div class="eyebrow">ARCHIVE PILATES</div>
  <h1>${escapeHtml(title)}</h1>
  <p class="muted">강사별 전달용 HTML 파일 인덱스입니다. 생성일 ${formatDate(generatedAt)}</p>
  <section class="summary">
    <div class="summary-card"><span class="label">총 지급 합계</span><b>${formatWon(summary.totalPayout)}</b><span class="sub ${diffClass}">전월대비 ${direction} ${formatWon(Math.abs(summary.diffFromPrevious))}</span></div>
    <div class="summary-card"><span class="label">그룹수업 합계</span><b>${formatCount(summary.groupTotal)}회</b><span class="sub">그룹 보수 ${formatWon(summary.groupPay)}</span></div>
    <div class="summary-card"><span class="label">프라이빗 수업 합계</span><b>${formatCount(summary.privateTotal)}회</b><span class="sub">프라이빗 보수 ${formatWon(summary.privatePay)}</span></div>
    <div class="summary-card"><span class="label">총수업 수</span><b>${formatCount(summary.totalClassCount)}회</b><span class="sub">그룹 + 프라이빗</span></div>
    <div class="summary-card"><span class="label">월 그룹 평균</span><b>${formatNumber(summary.monthlyGroupAverage, 2)}명</b><span class="sub">출석 인원 기준</span></div>
  </section>
  <h2 class="section-title">강사별 명세서</h2>
  <section class="cards">
    ${files
      .map((file) => `<a class="card" href="${encodeURI(file.fileName)}"><strong>${escapeHtml(file.name)}</strong><span>${formatWon(file.payout)}</span></a>`)
      .join("")}
  </section>
</article></main></body></html>`;
}

function renderInstructorHtml({ ym, instructor, generatedAt }) {
  const title = `ARCHIVE PILATES 정산명세서 ${ym} ${instructor.name}`;
  const displayRole = instructorRole(instructor.name, instructor.role);
  const totalClassCount = number(instructor.groupCount) + number(instructor.privateCount) + number(instructor.lessonCount);
  const adjustmentRows = parseAdjustmentRows(instructor);
  const rows = [
    detailRow("그룹 보수", `${formatCount(instructor.groupCount)}회 · 평균 ${formatNumber(instructor.groupAverage, 2)}명`, instructor.groupPay),
    detailRow("프라이빗 보수", `${formatCount(instructor.privateCount)}회`, instructor.privatePay),
    ...adjustmentRows,
    detailRow("세전 보수총액", "3.3% 공제 전 기준", instructor.pretaxPay),
    detailRow("소득세 3%", "원천징수", instructor.incomeTax),
    detailRow("주민세 0.3%", "원천징수", instructor.localTax),
    detailRow("공제 합계", "소득세 + 주민세", instructor.deductionTotal),
    detailRow("프리랜서 지급액", "세전 보수총액 - 공제 합계", instructor.freelancerPayout, true),
  ];
  if (instructor.regularPayout) rows.push(detailRow("정규직 실지급", "급여 지급분", instructor.regularPayout));
  if (instructor.combinedPayout) rows.push(detailRow("실지급 합산", "프리랜서 지급액 + 정규직 실지급", instructor.combinedPayout, true));
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${baseCss()}</style>
</head>
<body>
<main>
  <article class="statement">
    <header class="brand-row">
      <div>
        <div class="brand-mark">AP</div>
        <div class="eyebrow" style="margin-top:18px;">ARCHIVE PILATES</div>
        <h1>정산명세서</h1>
      </div>
      <div class="meta">
        <strong>${escapeHtml(formatYm(ym))} 정산</strong>
        작성일 ${formatDate(generatedAt)}<br>
        전달용 HTML
      </div>
    </header>
    <section class="person">
      <div class="panel">
        <div class="label">${escapeHtml(displayRole)}</div>
        <div class="name">${escapeHtml(instructor.name)}</div>
        <div class="role">총 수업 ${formatCount(totalClassCount)}회</div>
      </div>
      <div class="panel">
        <div class="label">최종 지급 기준액</div>
        <div class="total">${formatWon(instructor.finalPayout)}</div>
        <div class="role">${instructor.combinedPayout ? "실지급 합산" : "지급액"}</div>
      </div>
    </section>
    <section class="grid">
      <div class="metric"><div class="label">그룹</div><div class="value">${formatCount(instructor.groupCount)}회</div></div>
      <div class="metric"><div class="label">프라이빗</div><div class="value">${formatCount(instructor.privateCount)}회</div></div>
      <div class="metric"><div class="label">그룹 평균</div><div class="value">${formatNumber(instructor.groupAverage, 2)}명</div></div>
      <div class="metric"><div class="label">세전 보수</div><div class="value">${formatWon(instructor.pretaxPay)}</div></div>
    </section>
    <section>
      <table aria-label="정산 상세">
        <thead><tr><th>항목</th><th>금액</th></tr></thead>
        <tbody>${rows.join("")}</tbody>
      </table>
    </section>
    <section>
      <ul class="note-list">
        ${instructor.combinedPayout ? "<li>프리랜서 수업 보수와 정규직 실지급을 합산해 최종 지급 기준액을 표시했습니다.</li>" : "<li>세전 보수총액에서 원천징수 3.3%를 반영해 지급액을 표시했습니다.</li>"}
        ${instructor.bank ? `<li>지급 계좌: ${escapeHtml(instructor.bank)} · ${escapeHtml(String(instructor.account || ""))} · ${escapeHtml(instructor.accountHolder || instructor.name)}</li>` : ""}
        <li>본 명세서는 ARCHIVE PILATES 내부 정산 기준에 따라 작성되었습니다.</li>
      </ul>
    </section>
    <footer class="footer">
      <span>ARCHIVE PILATES</span>
      <span>정산 관련 문의는 운영자에게 확인해 주세요.</span>
    </footer>
  </article>
</main>
</body>
</html>`;
}

function detailRow(label, sub, value, accent = false) {
  return `<tr><td><strong>${escapeHtml(label)}</strong><br><span class="muted">${escapeHtml(sub)}</span></td><td class="amount ${accent ? "accent" : ""}">${formatWon(value)}</td></tr>`;
}

function parseAdjustmentRows(instructor) {
  if (!instructor.adjustmentAmount && !instructor.adjustmentText) return [];
  const text = instructor.adjustmentText || "정산 조정 반영";
  const rows = [];
  const salary = text.match(/정규직급여\s*\(([-,\d]+)\)/);
  const lesson = text.match(/강사\s*레슨\s*([-,\d]+)/);
  if (salary) rows.push(detailRow("정규직 급여 공제", "프리랜서 수업 보수에서 차감", -Math.abs(money(salary[1]))));
  if (lesson) rows.push(detailRow("강사 레슨 조정", "정산 조정 반영", money(lesson[1])));
  if (!rows.length) rows.push(detailRow("조정금액", text, instructor.adjustmentAmount));
  return rows;
}

function baseCss() {
  return `
:root{color-scheme:light;--bg:#f7f4ef;--paper:#fffdfa;--ink:#171717;--muted:#726b62;--line:#e6ded3;--soft:#f1ebe3;--accent:#f36b21;--accent-dark:#c84f12}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;min-height:100dvh;background:radial-gradient(circle at 20% 0%,#fff 0,#f7f4ef 36%,#efe7db 100%);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","SF Pro Display","SF Pro Text",sans-serif;line-height:1.55}
main{width:min(960px,calc(100% - 32px));margin:0 auto;padding:34px 0 48px}.statement{background:var(--paper);border:1px solid rgba(55,45,35,.12);border-radius:28px;padding:clamp(24px,4vw,42px);box-shadow:0 24px 70px rgba(48,38,25,.13)}
.brand-row{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;border-bottom:1px solid var(--line);padding-bottom:24px}.brand-mark{width:62px;height:62px;border-radius:18px;background:var(--accent);color:#fff;display:grid;place-items:center;font-weight:900;font-size:22px;letter-spacing:.5px;box-shadow:0 18px 28px rgba(243,107,33,.22)}
.eyebrow{color:var(--accent-dark);font-size:13px;font-weight:900;letter-spacing:.08em;text-transform:uppercase}h1{margin:8px 0 0;font-size:clamp(30px,5vw,50px);line-height:1.05;letter-spacing:0}.meta{text-align:right;color:var(--muted);font-size:14px}.meta strong{color:var(--ink);display:block;font-size:18px}
.person{display:grid;grid-template-columns:1.2fr .8fr;gap:18px;margin-top:26px}.panel{background:linear-gradient(180deg,#fff,#fbf7f1);border:1px solid var(--line);border-radius:20px;padding:22px}.label{color:var(--muted);font-size:13px;font-weight:800}.name{margin:4px 0 0;font-size:34px;font-weight:900}.role{margin-top:8px;color:var(--muted)}.total{font-size:36px;font-weight:950;margin-top:5px}
.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:18px}.metric{background:#fff;border:1px solid var(--line);border-radius:16px;padding:16px;min-width:0}.metric .value{font-size:22px;font-weight:900;margin-top:4px}
table{width:100%;border-collapse:collapse;margin-top:18px;font-size:15px}th,td{padding:13px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);text-align:left;font-size:12px;letter-spacing:.04em;text-transform:uppercase}td:last-child,th:last-child{text-align:right}.amount{font-weight:850}.muted{color:var(--muted)}.accent{color:var(--accent-dark)}.note-list{margin:16px 0 0;padding:0;list-style:none;display:grid;gap:8px}.note-list li{background:var(--soft);border-radius:14px;padding:12px 14px;color:#5f554a}.footer{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-top:24px;padding-top:18px;border-top:1px solid var(--line);color:var(--muted);font-size:13px}
@media(max-width:760px){main{width:min(100% - 20px,960px);padding-top:16px}.statement{border-radius:22px}.brand-row,.person{grid-template-columns:1fr;display:grid}.meta{text-align:left}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}table{font-size:14px}}@media print{body{background:#fff}main{width:100%;padding:0}.statement{border:none;border-radius:0;box-shadow:none}}`;
}

function rows(wb, name) {
  const sheet = wb.Sheets[name];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
}

function parseArgs(argv) {
  const parsed = {};
  for (const arg of argv) {
    if (arg.startsWith("--") && arg.includes("=")) {
      const [key, ...rest] = arg.slice(2).split("=");
      parsed[key] = rest.join("=");
    } else if (arg.startsWith("--")) {
      parsed[arg.slice(2)] = true;
    }
  }
  return parsed;
}

function previousMonthYyyyMm() {
  const date = new Date();
  date.setMonth(date.getMonth() - 1);
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function shiftYyyyMm(ym, diff) {
  const year = Number(ym.slice(0, 4));
  const month = Number(ym.slice(4, 6));
  const date = new Date(Date.UTC(year, month - 1 + diff, 1));
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function yyyyMmHyphen(value) {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}`;
}

function monthDateRange(value) {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const lastDay = new Date(year, month, 0).getDate();
  return {
    start: `${year}-${String(month).padStart(2, "0")}-01`,
    end: `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
  };
}

function normalizeDate(value) {
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  const text = clean(value);
  const matched = text.match(/(20\d{2})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})/);
  return matched ? `${matched[1]}-${matched[2].padStart(2, "0")}-${matched[3].padStart(2, "0")}` : text;
}

function normalizeTime(value) {
  if (value instanceof Date) {
    return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
  }
  const text = clean(value);
  const matched = text.match(/(\d{1,2}):(\d{2})/);
  return matched ? `${matched[1].padStart(2, "0")}:${matched[2]}` : text;
}

function getWeekdayKorean(dateStr) {
  const date = new Date(`${dateStr}T00:00:00`);
  return ["일", "월", "화", "수", "목", "금", "토"][date.getDay()] || "";
}

function settlementCountForAttendance(value) {
  const attendance = clean(value);
  if (attendance === "출석") return 1;
  if (attendance === "노쇼") return 0.5;
  return 0;
}

function normalizeFileName(value) {
  return String(value || "").normalize("NFC").replace(/\s+/g, "");
}

function formatYm(ym) {
  return `${ym.slice(0, 4)}년 ${Number(ym.slice(4, 6))}월`;
}

function formatDate(date) {
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

function clean(value) {
  return String(value ?? "").trim();
}

function number(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? "").replace(/[,%원\\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value) {
  return number(value);
}

function formatWon(value) {
  return `${Math.round(number(value)).toLocaleString("ko-KR")}원`;
}

function formatCount(value) {
  const n = number(value);
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

function formatNumber(value, digits = 1) {
  return number(value).toLocaleString("ko-KR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function expandHome(value) {
  return value.startsWith("~/") ? path.join(HOME, value.slice(2)) : value;
}
