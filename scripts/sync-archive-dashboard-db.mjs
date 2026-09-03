#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash, createSign } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

const HOME = os.homedir();
const DEFAULT_DASHBOARD_SPREADSHEET_ID = "1yEU2lDM_hTKQ-qT8UNj1PsiL7fsBwAgkzsKOzfXVsKg";
const DEFAULT_CREDENTIALS = path.join(HOME, "ArchiveIN/secrets/google/archive-codex-operator.json");
const DEFAULT_DRIVE_ROOT = path.join(
  HOME,
  "Library/CloudStorage/GoogleDrive-home@archivepilates.com/내 드라이브/아카이브 정산",
);
const DEFAULT_PYTHON = path.join(
  HOME,
  ".cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3",
);
const REPORT_DIR = path.join(HOME, "ArchiveIN/automation/reports/archive-dashboard-db-sync");
const EXCEL_CACHE_DIR = path.join(HOME, "ArchiveIN/automation/cache/archive-dashboard-excels");

const args = parseArgs(process.argv.slice(2));
const config = {
  apply: Boolean(args.apply),
  syncFirebase: Boolean(args["sync-firebase"]),
  month: typeof args.month === "string" ? args.month : "",
  includeAllVersions: Boolean(args["include-all-versions"]),
  spreadsheetId: String(args["spreadsheet-id"] || process.env.DASHBOARD_DB_SPREADSHEET_ID || DEFAULT_DASHBOARD_SPREADSHEET_ID),
  driveRoot: expandHome(String(args["drive-root"] || process.env.ARCHIVE_SETTLEMENT_DRIVE_ROOT || DEFAULT_DRIVE_ROOT)),
  credentialsPath: expandHome(String(args.credentials || process.env.GOOGLE_APPLICATION_CREDENTIALS || DEFAULT_CREDENTIALS)),
  delegatedUser: String(args["delegated-user"] || process.env.GOOGLE_DELEGATED_USER || "home@archivepilates.com"),
  python: expandHome(String(args.python || process.env.PYTHON || DEFAULT_PYTHON)),
  syncEndpoint: String(
    args["sync-endpoint"] ||
      process.env.ARCHIVE_DASHBOARD_SYNC_ENDPOINT ||
      "https://asia-northeast3-archive-pilates.cloudfunctions.net/syncDashboardNow",
  ),
};

const SOURCE_DIRS = {
  lessonSales: "수업매출원본데이터",
  ticketSales: "수강권매출원본데이터",
};

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exitCode = 1;
});

async function main() {
  validateConfig();

  const sourceFiles = discoverSourceFiles();
  const lessonRows = readExcelRows(sourceFiles.lessonSales).map((row) => normalizeLessonSalesRow(row)).filter((row) => row.기준월);
  const ticketRows = readExcelRows(sourceFiles.ticketSales).map((row) => normalizeTicketSalesRow(row)).filter((row) => row.기준월);
  const settlementRows = await readExistingSheetRows("정산대장_Master").catch(() => []);
  const settlementRates = buildSettlementRates(settlementRows);
  const dailySettlementPreview = buildDailySettlementPreview(lessonRows, settlementRates);
  const dailyInstructorPreview = buildDailyInstructorPreview(lessonRows, dailySettlementPreview);

  const sheets = {
    수강권매출_원본: buildTicketSalesRaw(ticketRows),
    수강권매출_Master: buildTicketSalesMaster(ticketRows),
    회원별누적매출: buildMemberSales(ticketRows),
    수강권분석_Master: buildTicketAnalysis(lessonRows),
    매출일일누적: buildDailyRevenue(ticketRows, lessonRows, settlementRates),
    정산대장_DailyPreview: dailySettlementPreview,
    강사통계_DailyPreview: dailyInstructorPreview,
  };

  const warnings = buildWarnings({ lessonRows, ticketRows, sourceFiles });
  const report = {
    ok: true,
    mode: config.apply ? "apply" : "dry-run",
    spreadsheetId: config.spreadsheetId,
    driveRoot: config.driveRoot,
    selectedMonth: config.month || "all",
    sourceFiles,
    sheetRows: Object.fromEntries(Object.entries(sheets).map(([name, rows]) => [name, Math.max(0, rows.length - 1)])),
    protectedSheets: ["정산대장_Master", "강사통계_Long"],
    warnings,
    appliedAt: "",
    firebaseSync: null,
  };

  if (config.apply) {
    await updateSpreadsheet(sheets);
    report.appliedAt = new Date().toISOString();
    if (config.syncFirebase) {
      report.firebaseSync = await syncFirebaseDashboard({
        dailyRevenueSheet: sheets.매출일일누적,
        settlementPreviewSheet: sheets.정산대장_DailyPreview,
        instructorPreviewSheet: sheets.강사통계_DailyPreview,
      });
    }
  }

  const reportPath = writeReport(report);
  console.log(JSON.stringify({ ...report, reportPath }, null, 2));
}

function validateConfig() {
  if (!existsSync(config.python)) throw new Error(`Python runtime not found: ${config.python}`);
  if (config.apply && !existsSync(config.credentialsPath)) {
    throw new Error(`Google credentials not found: ${config.credentialsPath}`);
  }
  if (config.apply && config.month && !args["allow-partial-overwrite"]) {
    throw new Error(
      "--month with --apply would overwrite master sheets with a partial month. Use the default all-month apply, or pass --allow-partial-overwrite intentionally.",
    );
  }
  for (const dir of Object.values(SOURCE_DIRS)) {
    const fullPath = path.join(config.driveRoot, dir);
    if (!existsSync(fullPath)) throw new Error(`Source folder not found: ${fullPath}`);
  }
}

function discoverSourceFiles() {
  return Object.fromEntries(
    Object.entries(SOURCE_DIRS).map(([key, dir]) => {
      const fullDir = path.join(config.driveRoot, dir);
      let files = readdirSync(fullDir)
        .filter((name) => !name.startsWith("~$") && /\.(xlsx|xls)$/i.test(name))
        .map((name) => {
          const parsed = parseSourceFileName(name);
          const fullPath = path.join(fullDir, name);
          return { path: fullPath, name, ...parsed, mtime: statSync(fullPath).mtimeMs };
        })
        .filter((file) => !config.month || file.month === config.month);
      if (!config.includeAllVersions) files = selectCanonicalSourceFiles(files);
      files = files.sort((a, b) => sourceSortKey(a).localeCompare(sourceSortKey(b)));
      if (!files.length) throw new Error(`No source Excel files found in ${fullDir}${config.month ? ` for ${config.month}` : ""}`);
      return [key, files];
    }),
  );
}

function selectCanonicalSourceFiles(files) {
  const byMonth = new Map();
  for (const item of files) {
    const key = item.month || item.name;
    byMonth.set(key, [...(byMonth.get(key) || []), item]);
  }
  return [...byMonth.values()].map((items) => {
    const fullMonth = items
      .filter((item) => item.isFullMonth)
      .sort(compareSourceFiles)
      .pop();
    if (fullMonth) return { ...fullMonth, selectedReason: "full-month-file" };
    const latestCumulative = [...items].sort(compareSourceFiles).pop();
    return { ...latestCumulative, selectedReason: "latest-cumulative-file" };
  });
}

function parseSourceFileName(name) {
  const matched = String(name).match(/(20\d{2}-\d{2}-\d{2})~(20\d{2}-\d{2}-\d{2})/);
  if (!matched) {
    return { month: "", startDate: "", endDate: "", monthEndDate: "", isFullMonth: false };
  }
  const month = matched[1].slice(0, 7);
  const monthEnd = lastDateOfMonth(month);
  return {
    month,
    startDate: matched[1],
    endDate: matched[2],
    monthEndDate: monthEnd,
    isFullMonth: matched[1] === `${month}-01` && matched[2] === monthEnd,
  };
}

function compareSourceFiles(a, b) {
  return (
    stringCompare(a.endDate, b.endDate) ||
    stringCompare(a.startDate, b.startDate) ||
    numberCompare(a.mtime, b.mtime) ||
    stringCompare(a.name, b.name)
  );
}

function sourceSortKey(item) {
  return [item.month || "", item.startDate || "", item.endDate || "", item.name || ""].join("\u0001");
}

function lastDateOfMonth(month) {
  if (!/^\d{4}-\d{2}$/.test(month)) return "";
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  return `${month}-${String(lastDay).padStart(2, "0")}`;
}

function stringCompare(a, b) {
  return String(a || "").localeCompare(String(b || ""));
}

function numberCompare(a, b) {
  return Number(a || 0) - Number(b || 0);
}

function readExcelRows(files) {
  mkdirSync(EXCEL_CACHE_DIR, { recursive: true });
  const stagedFiles = files.map((item, index) => {
    const stagedPath = cachedExcelPath(item, index);
    if (!existsSync(stagedPath) || statSync(stagedPath).size <= 0) {
      const partialPath = `${stagedPath}.partial-${process.pid}`;
      rmSync(partialPath, { force: true });
      try {
        copyFileWithRetry(item.path, partialPath);
        renameSync(partialPath, stagedPath);
      } finally {
        rmSync(partialPath, { force: true });
      }
    }
    return { ...item, path: stagedPath };
  });
  const script = `
import json
import pandas as pd

files = json.loads(${JSON.stringify(JSON.stringify(stagedFiles))})
rows = []

def clean(value):
    if pd.isna(value):
        return ""
    if hasattr(value, "strftime"):
        return value.strftime("%Y-%m-%d")
    return value

for item in files:
    df = pd.read_excel(item["path"], sheet_name=0)
    df = df.where(pd.notna(df), "")
    for record in df.to_dict(orient="records"):
        record = {str(k).strip(): clean(v) for k, v in record.items()}
        record["_원본파일명"] = item["name"]
        record["_원본월"] = item["month"]
        rows.append(record)

print(json.dumps(rows, ensure_ascii=False, default=str))
`;
  const result = spawnSync(config.python, ["-c", script], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Excel read failed: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

function cachedExcelPath(item, index) {
  const sourceStats = statSync(item.path);
  const sourceKey = createHash("sha256")
    .update([item.path, sourceStats.size, sourceStats.mtimeMs].join("\u0001"))
    .digest("hex")
    .slice(0, 16);
  const label = `${item.month || "unknown"}-${String(index).padStart(3, "0")}-${sourceKey}`;
  return path.join(EXCEL_CACHE_DIR, `${label}-${path.basename(item.path)}`);
}

function copyFileWithRetry(sourcePath, targetPath) {
  let lastError;
  const maxAttempts = 12;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      copyFileSync(sourcePath, targetPath);
      if (statSync(targetPath).size <= 0) throw new Error("staged file is empty");
      return;
    } catch (error) {
      lastError = error;
      rmSync(targetPath, { force: true });
      materializeCloudFile(sourcePath);
      if (attempt < maxAttempts) sleepSync(Math.min(15_000, attempt * 2_000));
    }
  }
  throw new Error(
    `Excel staging failed for ${path.basename(sourcePath)}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

function materializeCloudFile(sourcePath) {
  let descriptor;
  try {
    descriptor = openSync(sourcePath, "r");
    readSync(descriptor, Buffer.alloc(1), 0, 1, 0);
  } catch {
    // Google Drive File Provider may return EAGAIN while downloading an online-only file.
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function normalizeLessonSalesRow(row) {
  const date = dateKey(row["날짜"]);
  const month = row._원본월 || monthKey(date);
  const classType = classTypeName(row["수업"], row["수강권명"]);
  const attendance = stringValue(row["출결"]);
  const chargedAmount = amount(row["차감 금액"]);
  const unitAmount = amount(row["회당 금액"]);
  const deductedCount = amount(row["차감 횟수"]);
  return {
    원본파일명: stringValue(row._원본파일명),
    기준월: month,
    수업일자: date,
    수업시작: stringValue(row["수업시작"]),
    수업종료: stringValue(row["수업종료"]),
    수업구분: classType,
    수강권명: stringValue(row["수강권명"]),
    회원명: stringValue(row["회원명"]),
    강사명: stringValue(row["수업 강사"]),
    출결: attendance,
    차감금액: chargedAmount,
    회당금액: unitAmount,
    차감횟수: deductedCount || (attendance === "출석" ? 1 : 0),
  };
}

async function readExistingSheetRows(sheetName) {
  const token = await googleAccessToken(["https://www.googleapis.com/auth/spreadsheets.readonly"]);
  const body = await sheetsRequest(
    token,
    "GET",
    `/v4/spreadsheets/${config.spreadsheetId}/values/${encodeURIComponent(quotedRange(sheetName, "A:Z"))}?valueRenderOption=UNFORMATTED_VALUE`,
  );
  const [headers, ...rows] = body.values || [];
  if (!headers?.length) return [];
  return rows
    .filter((row) => row.some((cell) => cell !== "" && cell != null))
    .map((row) => Object.fromEntries(headers.map((header, index) => [String(header || `col${index + 1}`), row[index] ?? ""])));
}

function normalizeTicketSalesRow(row) {
  const paymentDate = dateKey(row["결제일"]);
  const month = row._원본월 || monthKey(paymentDate);
  return {
    원본파일명: stringValue(row._원본파일명),
    기준월: month,
    결제일: paymentDate,
    구분: stringValue(row["구분"]),
    수업구분: classTypeName(row["수업"]),
    회원명: stringValue(row["회원명"]),
    수강권명: stringValue(row["수강권명"]),
    카드결제금액: amount(row["카드결제금액"]),
    현금결제금액: amount(row["현금결제금액"]),
    계좌이체금액: amount(row["계좌이체금액"]),
    포인트금액: amount(row["포인트금액(환불 포인트)"]),
    결제금액합계: amount(row["결제금액합계"]),
    회당금액: amount(row["회당 금액"]),
    전체횟수: amount(row["전체 횟수"]),
    미수금: amount(row["미수금(위약금)"]),
    결제방법: stringValue(row["결제 방법"]),
    담당강사: stringValue(row["담당 강사"]),
  };
}

function buildTicketSalesRaw(rows) {
  const headers = [
    "원본파일명",
    "기준월",
    "구분",
    "수업구분",
    "결제일",
    "회원명",
    "수강권명",
    "카드결제금액",
    "현금결제금액",
    "계좌이체금액",
    "포인트금액",
    "총결제금액",
    "회당금액",
    "전체횟수",
    "미수금",
    "결제방법",
    "담당강사",
  ];
  return [headers, ...rows.map((row) => [
    row.원본파일명,
    row.기준월,
    row.구분,
    row.수업구분,
    row.결제일,
    row.회원명,
    row.수강권명,
    row.카드결제금액,
    row.현금결제금액,
    row.계좌이체금액,
    row.포인트금액,
    row.결제금액합계,
    row.회당금액,
    row.전체횟수,
    row.미수금,
    row.결제방법,
    row.담당강사,
  ])];
}

function buildTicketSalesMaster(rows) {
  const headers = ["기준월", "결제일", "회원명", "수업구분", "수강권명", "총결제금액", "결제방법", "담당강사"];
  const currentMonth = monthKey(todayKey());
  return [
    headers,
    ...rows
      .filter((row) => row.결제금액합계 > 0 && row.기준월 !== currentMonth)
      .map((row) => [row.기준월, row.결제일, row.회원명, row.수업구분, row.수강권명, row.결제금액합계, row.결제방법, row.담당강사]),
  ];
}

function buildMemberSales(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!row.회원명 || row.결제금액합계 <= 0) continue;
    const current = map.get(row.회원명) || {
      회원명: row.회원명,
      누적매출: 0,
      최근결제월: "",
      최근결제일: "",
      최근수강권명: "",
    };
    current.누적매출 += row.결제금액합계;
    if (row.결제일 >= current.최근결제일) {
      current.최근결제월 = row.기준월;
      current.최근결제일 = row.결제일;
      current.최근수강권명 = row.수강권명;
    }
    map.set(row.회원명, current);
  }
  const headers = ["회원명", "누적매출", "최근결제월", "최근결제일", "최근수강권명"];
  return [
    headers,
    ...[...map.values()]
      .sort((a, b) => b.누적매출 - a.누적매출 || a.회원명.localeCompare(b.회원명, "ko"))
      .map((row) => [row.회원명, Math.round(row.누적매출), row.최근결제월, row.최근결제일, row.최근수강권명]),
  ];
}

function buildTicketAnalysis(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!row.기준월 || !row.수강권명) continue;
    const key = [row.기준월, row.수업구분, row.수강권명].join("\u0001");
    const current = map.get(key) || {
      기준월: row.기준월,
      수업구분: row.수업구분,
      수강권명: row.수강권명,
      사용횟수: 0,
      유료출석건수: 0,
      차감매출합계: 0,
    };
    current.사용횟수 += row.차감횟수;
    if (row.출결 === "출석" && (row.차감금액 > 0 || row.회당금액 > 0)) current.유료출석건수 += row.차감횟수 || 1;
    current.차감매출합계 += row.차감금액 || (row.출결 === "출석" ? row.회당금액 : 0);
    map.set(key, current);
  }
  const headers = ["기준월", "수업구분", "수강권명", "사용횟수", "유료출석건수", "차감매출합계"];
  return [
    headers,
    ...[...map.values()]
      .sort((a, b) => a.기준월.localeCompare(b.기준월) || a.수업구분.localeCompare(b.수업구분, "ko") || b.차감매출합계 - a.차감매출합계)
      .map((row) => [row.기준월, row.수업구분, row.수강권명, round2(row.사용횟수), round2(row.유료출석건수), Math.round(row.차감매출합계)]),
  ];
}

function buildSettlementRates(rows) {
  const currentMonth = monthKey(todayKey());
  const normalized = rows
    .map((row) => ({
      기준월: monthKey(row.기준월),
      성명: stringValue(row.성명),
      그룹횟수: amount(row.그룹횟수),
      프라이빗횟수: amount(row.프라이빗횟수),
      강사레슨횟수: amount(row.강사레슨횟수),
      그룹보수합계: amount(row.그룹보수합계),
      프라이빗보수합계: amount(row.프라이빗보수합계),
      강사레슨보수합계: amount(row.강사레슨보수합계),
      총매출: amount(row.총매출),
      세전총액: amount(row.세전총액),
    }))
    .filter((row) => row.기준월 && row.기준월 < currentMonth && row.성명)
    .sort((a, b) => b.기준월.localeCompare(a.기준월));
  const byInstructor = new Map();
  for (const row of normalized) {
    if (byInstructor.has(row.성명)) continue;
    byInstructor.set(row.성명, rateFromSettlement(row));
  }
  const totals = normalized.reduce(
    (acc, row) => ({
      그룹횟수: acc.그룹횟수 + row.그룹횟수,
      프라이빗횟수: acc.프라이빗횟수 + row.프라이빗횟수,
      강사레슨횟수: acc.강사레슨횟수 + row.강사레슨횟수,
      그룹보수합계: acc.그룹보수합계 + row.그룹보수합계,
      프라이빗보수합계: acc.프라이빗보수합계 + row.프라이빗보수합계,
      강사레슨보수합계: acc.강사레슨보수합계 + row.강사레슨보수합계,
    }),
    { 그룹횟수: 0, 프라이빗횟수: 0, 강사레슨횟수: 0, 그룹보수합계: 0, 프라이빗보수합계: 0, 강사레슨보수합계: 0 },
  );
  return { byInstructor, fallback: rateFromSettlement(totals) };
}

function rateFromSettlement(row) {
  return {
    groupPayPerCount: row.그룹횟수 ? row.그룹보수합계 / row.그룹횟수 : 30000,
    privatePayPerCount: row.프라이빗횟수 ? row.프라이빗보수합계 / row.프라이빗횟수 : 0,
    instructorLessonPayPerCount: row.강사레슨횟수 ? row.강사레슨보수합계 / row.강사레슨횟수 : 0,
  };
}

function buildDailySettlementPreview(rows, rates) {
  const currentMonth = monthKey(todayKey());
  const today = todayKey();
  const map = new Map();
  for (const row of rows) {
    if (row.기준월 !== currentMonth || !row.강사명 || row.수업일자 > today) continue;
    const current = map.get(row.강사명) || {
      성명: row.강사명,
      그룹수업키: new Set(),
      프라이빗횟수: 0,
      강사레슨키: new Set(),
      총매출: 0,
    };
    const count = row.차감횟수 || 1;
    const revenue = row.차감금액 || (row.출결 === "출석" ? row.회당금액 * count : 0);
    if (row.수업구분 === "그룹") current.그룹수업키.add([row.수업일자, row.수업시작, row.수업종료].join("\u0001"));
    else if (row.수업구분 === "프라이빗") current.프라이빗횟수 += count;
    else if (row.수업구분 === "강사레슨") {
      current.강사레슨키.add([row.강사명, row.수업일자, row.수업시작, row.수업종료].join("\u0001"));
    }
    current.총매출 += revenue;
    map.set(row.강사명, current);
  }
  const headers = [
    "기준월",
    "순번",
    "성명",
    "그룹횟수",
    "프라이빗횟수",
    "강사레슨횟수",
    "그룹보수합계",
    "프라이빗보수합계",
    "강사레슨보수합계",
    "세전총액",
    "공제(3.3%)",
    "실지급액",
    "총매출",
    "수업마진률",
  ];
  const body = [...map.values()]
    .sort((a, b) => a.성명.localeCompare(b.성명, "ko"))
    .map((row, index) => {
      const rate = rates.byInstructor.get(row.성명) || rates.fallback;
      const groupCount = row.그룹수업키.size;
      const instructorLessonCount = row.강사레슨키.size;
      const groupPay = groupCount * rate.groupPayPerCount;
      const privatePay = row.프라이빗횟수 * rate.privatePayPerCount;
      const instructorPay = instructorLessonCount * rate.instructorLessonPayPerCount;
      const pretax = groupPay + privatePay + instructorPay;
      const deduction = pretax * 0.033;
      const net = pretax - deduction;
      const margin = row.총매출 ? ((row.총매출 - pretax) / row.총매출) * 100 : 0;
      return [
        currentMonth,
        index + 1,
        row.성명,
        round2(groupCount),
        round2(row.프라이빗횟수),
        round2(instructorLessonCount),
        Math.round(groupPay),
        Math.round(privatePay),
        Math.round(instructorPay),
        Math.round(pretax),
        Math.round(deduction),
        Math.round(net),
        Math.round(row.총매출),
        `${round1(margin)}%`,
      ];
    });
  return [headers, ...body];
}

function buildDailyInstructorPreview(rows, settlementPreview) {
  const currentMonth = monthKey(todayKey());
  const today = todayKey();
  const settlementByInstructor = new Map(sheetRowsToObjects(settlementPreview).map((row) => [stringValue(row.성명), row]));
  const sessions = new Map();
  for (const row of rows) {
    if (row.기준월 !== currentMonth || row.수업구분 !== "그룹" || !row.강사명 || row.수업일자 > today) continue;
    const key = [row.강사명, row.수업일자, row.수업시작, row.수업종료].join("\u0001");
    const current = sessions.get(key) || { 강사명: row.강사명, 예약: 0, 출석: 0 };
    current.예약 += 1;
    if (row.출결 === "출석") current.출석 += 1;
    sessions.set(key, current);
  }
  const byInstructor = new Map();
  for (const session of sessions.values()) {
    const current = byInstructor.get(session.강사명) || { 강사명: session.강사명, 그룹횟수: 0, 예약합계: 0, 출석합계: 0 };
    current.그룹횟수 += 1;
    current.예약합계 += session.예약;
    current.출석합계 += session.출석;
    byInstructor.set(session.강사명, current);
  }
  const headers = ["기준월", "강사명", "그룹예약평균", "그룹출석평균", "그룹예약률", "그룹출석률", "그룹횟수", "프라이빗횟수", "강사레슨횟수", "세전총액", "총매출", "수업마진률"];
  return [
    headers,
    ...[...byInstructor.values()].sort((a, b) => a.강사명.localeCompare(b.강사명, "ko")).map((row) => {
      const settlement = settlementByInstructor.get(row.강사명) || {};
      const reservationAvg = row.그룹횟수 ? row.예약합계 / row.그룹횟수 : 0;
      const attendanceAvg = row.그룹횟수 ? row.출석합계 / row.그룹횟수 : 0;
      const reservationRate = reservationAvg / 5;
      const attendanceRate = row.예약합계 ? row.출석합계 / row.예약합계 : 0;
      const pretax = amount(settlement.세전총액);
      const revenue = amount(settlement.총매출);
      const margin = revenue ? ((revenue - pretax) / revenue) * 100 : 0;
      return [
        currentMonth,
        row.강사명,
        round2(reservationAvg),
        round2(attendanceAvg),
        round4(reservationRate),
        round4(attendanceRate),
        round2(row.그룹횟수),
        amount(settlement.프라이빗횟수),
        amount(settlement.강사레슨횟수),
        Math.round(pretax),
        Math.round(revenue),
        `${round1(margin)}%`,
      ];
    }),
  ];
}

function buildDailyRevenue(ticketRows, lessonRows, rates) {
  const ticketByDate = new Map();
  for (const row of ticketRows) {
    if (!row.결제일 || row.결제금액합계 <= 0) continue;
    addToMap(ticketByDate, row.결제일, row.결제금액합계);
  }
  const lessonByDate = new Map();
  const pretaxByDate = new Map();
  const privateByDate = new Map();
  const instructorLessonByDate = new Map();
  const instructorLessonSessionKeysByDate = new Map();
  const groupSessionKeysByDate = new Map();
  const groupReservationByDate = new Map();
  const groupAttendanceByDate = new Map();
  for (const row of lessonRows) {
    if (!row.수업일자) continue;
    const count = row.차감횟수 || 1;
    const revenue = row.차감금액 || (row.출결 === "출석" ? row.회당금액 * count : 0);
    if (revenue > 0) addToMap(lessonByDate, row.수업일자, revenue);
    const rate = rates.byInstructor.get(row.강사명) || rates.fallback;
    if (row.수업구분 === "그룹") {
      const sessionKey = [row.강사명, row.수업시작, row.수업종료].join("\u0001");
      const keys = groupSessionKeysByDate.get(row.수업일자) || new Set();
      if (!keys.has(sessionKey)) {
        keys.add(sessionKey);
        addToMap(pretaxByDate, row.수업일자, rate.groupPayPerCount);
      }
      groupSessionKeysByDate.set(row.수업일자, keys);
      addToMap(groupReservationByDate, row.수업일자, 1);
      if (row.출결 === "출석") addToMap(groupAttendanceByDate, row.수업일자, 1);
    } else if (row.수업구분 === "프라이빗") {
      addToMap(privateByDate, row.수업일자, count);
      addToMap(pretaxByDate, row.수업일자, count * rate.privatePayPerCount);
    } else if (row.수업구분 === "강사레슨") {
      const sessionKey = [row.강사명, row.수업시작, row.수업종료].join("\u0001");
      const keys = instructorLessonSessionKeysByDate.get(row.수업일자) || new Set();
      if (!keys.has(sessionKey)) {
        keys.add(sessionKey);
        addToMap(instructorLessonByDate, row.수업일자, 1);
        addToMap(pretaxByDate, row.수업일자, rate.instructorLessonPayPerCount);
      }
      instructorLessonSessionKeysByDate.set(row.수업일자, keys);
    }
  }
  const dates = completeDailyDates([...ticketByDate.keys(), ...lessonByDate.keys()]);
  const cumulative = {
    ticket: new Map(),
    lesson: new Map(),
    pretax: new Map(),
    groupSessions: new Map(),
    privateSessions: new Map(),
    instructorLessonSessions: new Map(),
    groupReservations: new Map(),
    groupAttendance: new Map(),
  };
  const running = Object.fromEntries(Object.keys(cumulative).map((key) => [key, new Map()]));
  for (const date of dates) {
    const month = monthKey(date);
    addRunning(cumulative.ticket, running.ticket, month, date, ticketByDate.get(date) || 0);
    addRunning(cumulative.lesson, running.lesson, month, date, lessonByDate.get(date) || 0);
    addRunning(cumulative.pretax, running.pretax, month, date, pretaxByDate.get(date) || 0);
    addRunning(cumulative.groupSessions, running.groupSessions, month, date, groupSessionKeysByDate.get(date)?.size || 0);
    addRunning(cumulative.privateSessions, running.privateSessions, month, date, privateByDate.get(date) || 0);
    addRunning(cumulative.instructorLessonSessions, running.instructorLessonSessions, month, date, instructorLessonByDate.get(date) || 0);
    addRunning(cumulative.groupReservations, running.groupReservations, month, date, groupReservationByDate.get(date) || 0);
    addRunning(cumulative.groupAttendance, running.groupAttendance, month, date, groupAttendanceByDate.get(date) || 0);
  }
  const headers = [
    "기준일",
    "기준월",
    "일매출",
    "월누적매출",
    "전월동일일누적",
    "전년동월동일일누적",
    "일수업매출",
    "월누적수업매출",
    "전월동일일수업누적",
    "전년동월동일일수업누적",
    "월누적세전총액",
    "전월동일일세전총액",
    "월누적수업마진률",
    "전월동일일수업마진률",
    "월누적그룹세션",
    "전월동일일그룹세션",
    "월누적프라이빗",
    "전월동일일프라이빗",
    "월누적강사레슨",
    "전월동일일강사레슨",
    "월누적그룹예약률",
    "전월동일일그룹예약률",
    "월누적그룹출석률",
    "전월동일일그룹출석률",
  ];
  return [
    headers,
    ...dates.map((date) => {
      const previousMonthDate = previousMonthSameDay(date);
      const previousYearDate = previousYearSameDay(date);
      const lesson = cumulative.lesson.get(date) || 0;
      const pretax = cumulative.pretax.get(date) || 0;
      const prevLesson = cumulativeThroughDate(cumulative.lesson, previousMonthDate);
      const prevPretax = cumulativeThroughDate(cumulative.pretax, previousMonthDate);
      const groupSessions = cumulative.groupSessions.get(date) || 0;
      const groupReservations = cumulative.groupReservations.get(date) || 0;
      const groupAttendance = cumulative.groupAttendance.get(date) || 0;
      const prevGroupSessions = cumulativeThroughDate(cumulative.groupSessions, previousMonthDate);
      const prevGroupReservations = cumulativeThroughDate(cumulative.groupReservations, previousMonthDate);
      const prevGroupAttendance = cumulativeThroughDate(cumulative.groupAttendance, previousMonthDate);
      return [
        date,
        monthKey(date),
        Math.round(ticketByDate.get(date) || 0),
        Math.round(cumulative.ticket.get(date) || 0),
        Math.round(cumulativeThroughDate(cumulative.ticket, previousMonthDate)),
        Math.round(cumulativeThroughDate(cumulative.ticket, previousYearDate)),
        Math.round(lessonByDate.get(date) || 0),
        Math.round(lesson),
        Math.round(prevLesson),
        Math.round(cumulativeThroughDate(cumulative.lesson, previousYearDate)),
        Math.round(pretax),
        Math.round(prevPretax),
        lesson ? round1(((lesson - pretax) / lesson) * 100) : 0,
        prevLesson ? round1(((prevLesson - prevPretax) / prevLesson) * 100) : 0,
        round2(groupSessions),
        round2(prevGroupSessions),
        round2(cumulative.privateSessions.get(date) || 0),
        round2(cumulativeThroughDate(cumulative.privateSessions, previousMonthDate)),
        round2(cumulative.instructorLessonSessions.get(date) || 0),
        round2(cumulativeThroughDate(cumulative.instructorLessonSessions, previousMonthDate)),
        groupSessions ? round1((groupReservations / (groupSessions * 5)) * 100) : 0,
        prevGroupSessions ? round1((prevGroupReservations / (prevGroupSessions * 5)) * 100) : 0,
        groupReservations ? round1((groupAttendance / groupReservations) * 100) : 0,
        prevGroupReservations ? round1((prevGroupAttendance / prevGroupReservations) * 100) : 0,
      ];
    }),
  ];
}

function addToMap(map, key, value) {
  map.set(key, (map.get(key) || 0) + value);
}

function addRunning(targetMap, monthRunning, month, date, value) {
  const next = (monthRunning.get(month) || 0) + value;
  monthRunning.set(month, next);
  targetMap.set(date, next);
}

function completeDailyDates(existingDates) {
  const dates = new Set(existingDates);
  const months = new Set(existingDates.map((date) => monthKey(date)).filter(Boolean));
  if (config.month) months.add(config.month);
  const today = todayKey();
  for (const month of months) {
    const lastExisting = existingDates.filter((date) => monthKey(date) === month).sort().pop();
    const endDate = month === monthKey(today) && lastExisting > today ? today : lastExisting;
    if (!endDate) continue;
    for (let date = `${month}-01`; date <= endDate; date = addDays(date, 1)) {
      dates.add(date);
    }
  }
  return [...dates].sort();
}

function buildWarnings({ lessonRows, ticketRows, sourceFiles }) {
  const warnings = [
    "정산 보호: 정산대장_Master와 강사통계_Long은 이 스크립트가 갱신하지 않습니다.",
    "매출 기준: 수강권 매출은 수강권매출원본데이터의 결제금액합계를 기준으로 집계합니다.",
    "월별 요약 보호: 진행 중인 현재월 수강권 매출은 수강권매출_Master에서 제외하고 매출일일누적에만 반영합니다.",
  ];
  if (!config.apply) warnings.push("DRY_RUN: Google Sheets와 Firebase에는 쓰지 않았습니다.");
  if (!lessonRows.length) warnings.push("수업매출원본데이터에서 읽은 행이 없습니다.");
  if (!ticketRows.length) warnings.push("수강권매출원본데이터에서 읽은 행이 없습니다.");
  const latestTicketMonth = maxMonth(sourceFiles.ticketSales);
  const latestLessonMonth = maxMonth(sourceFiles.lessonSales);
  if (latestTicketMonth && latestLessonMonth && latestTicketMonth !== latestLessonMonth) {
    warnings.push(`원본 최신월이 다릅니다: 수강권=${latestTicketMonth}, 수업=${latestLessonMonth}`);
  }
  for (const [label, files] of [
    ["수업매출", sourceFiles.lessonSales],
    ["수강권매출", sourceFiles.ticketSales],
  ]) {
    for (const file of files) {
      if (file.selectedReason === "latest-cumulative-file" && isClosedMonth(file.month)) {
        warnings.push(`${label} ${file.month} 원본은 전체월 파일이 없어 ${file.name} 부분 누적 파일을 사용했습니다.`);
      }
    }
  }
  return warnings;
}

function isClosedMonth(month) {
  return /^\d{4}-\d{2}$/.test(month) && lastDateOfMonth(month) < todayKey();
}

async function updateSpreadsheet(sheets) {
  const token = await googleAccessToken(["https://www.googleapis.com/auth/spreadsheets"]);
  await ensureSheets(token, Object.keys(sheets));
  for (const [sheetName, values] of Object.entries(sheets)) {
    await sheetsRequest(token, "POST", `/v4/spreadsheets/${config.spreadsheetId}/values/${encodeURIComponent(quotedRange(sheetName, "A:Z"))}:clear`, {});
    await sheetsRequest(
      token,
      "PUT",
      `/v4/spreadsheets/${config.spreadsheetId}/values/${encodeURIComponent(quotedRange(sheetName, "A1"))}?valueInputOption=RAW`,
      { range: quotedRange(sheetName, "A1"), majorDimension: "ROWS", values },
    );
  }
}

async function ensureSheets(token, sheetNames) {
  const metadata = await sheetsRequest(token, "GET", `/v4/spreadsheets/${config.spreadsheetId}?fields=sheets.properties.title`);
  const existing = new Set((metadata.sheets || []).map((sheet) => sheet.properties?.title).filter(Boolean));
  const missing = sheetNames.filter((name) => !existing.has(name));
  if (!missing.length) return;
  await sheetsRequest(token, "POST", `/v4/spreadsheets/${config.spreadsheetId}:batchUpdate`, {
    requests: missing.map((title) => ({ addSheet: { properties: { title } } })),
  });
}

async function syncFirebaseDashboard({ dailyRevenueSheet, settlementPreviewSheet, instructorPreviewSheet }) {
  const dailyRevenue = sheetRowsToObjects(dailyRevenueSheet).map((row) => ({
    기준일: stringValue(row.기준일),
    기준월: stringValue(row.기준월),
    일매출: amount(row.일매출),
    월누적매출: amount(row.월누적매출),
    전월동일일누적: amount(row.전월동일일누적),
    전년동월동일일누적: amount(row.전년동월동일일누적),
    일수업매출: amount(row.일수업매출),
    월누적수업매출: amount(row.월누적수업매출),
    전월동일일수업누적: amount(row.전월동일일수업누적),
    전년동월동일일수업누적: amount(row.전년동월동일일수업누적),
    월누적세전총액: amount(row.월누적세전총액),
    전월동일일세전총액: amount(row.전월동일일세전총액),
    월누적수업마진률: amount(row.월누적수업마진률),
    전월동일일수업마진률: amount(row.전월동일일수업마진률),
    월누적그룹세션: amount(row.월누적그룹세션),
    전월동일일그룹세션: amount(row.전월동일일그룹세션),
    월누적프라이빗: amount(row.월누적프라이빗),
    전월동일일프라이빗: amount(row.전월동일일프라이빗),
    월누적강사레슨: amount(row.월누적강사레슨),
    전월동일일강사레슨: amount(row.전월동일일강사레슨),
    월누적그룹예약률: amount(row.월누적그룹예약률),
    전월동일일그룹예약률: amount(row.전월동일일그룹예약률),
    월누적그룹출석률: amount(row.월누적그룹출석률),
    전월동일일그룹출석률: amount(row.전월동일일그룹출석률),
  }));
  const settlementPreview = sheetRowsToObjects(settlementPreviewSheet);
  const instructorPreview = sheetRowsToObjects(instructorPreviewSheet);
  const functionResult = {
    ok: true,
    status: 0,
    skipped: true,
    body: "Skipped full Cloud Function snapshot sync; scoped Firestore dashboard patch is the scheduled source.",
  };
  const firestorePatch = await patchDashboardCurrentPreview({ dailyRevenue, settlementPreview, instructorPreview });
  return {
    ok: Boolean(firestorePatch.ok),
    status: firestorePatch.ok ? firestorePatch.status : functionResult.status,
    warning: "",
    functionResult,
    dailyRevenueRows: dailyRevenue.length,
    settlementPreviewRows: settlementPreview.length,
    instructorPreviewRows: instructorPreview.length,
    firestorePatch,
  };
}

async function patchDashboardCurrentPreview({ dailyRevenue, settlementPreview, instructorPreview }) {
  const currentMonth = monthKey(todayKey());
  const token = await googleAccessToken(["https://www.googleapis.com/auth/datastore"], { delegated: false });
  const current = await fetchFirestoreDashboard(token);
  const preview = buildFirestoreCurrentPreview({ dailyRevenue, settlementPreview, instructorPreview });
  const currentMonthDailyRevenue = dailyRevenue
    .filter((row) => monthKey(row.기준월) === currentMonth)
    .sort((a, b) => stringValue(a.기준일).localeCompare(stringValue(b.기준일)));
  const next = {
    summary: replaceMonthRows(current.summary || [], currentMonth, preview.summary),
    강사별: replaceMonthRows(current.강사별 || [], currentMonth, preview.강사별),
    강사통계: replaceMonthRows(current.강사통계 || [], currentMonth, preview.강사통계),
    월별강사평균인원: replaceMonthRows(current.월별강사평균인원 || [], currentMonth, preview.월별강사평균인원),
    매출일일누적: currentMonthDailyRevenue,
    updatedAt: new Date().toISOString(),
  };
  const fieldPaths = ["summary", "강사별", "강사통계", "월별강사평균인원", "매출일일누적", "updatedAt"];
  const mask = fieldPaths.map((field) => `updateMask.fieldPaths=${encodeURIComponent(`\`${field}\``)}`).join("&");
  const result = await fetch(
    `https://firestore.googleapis.com/v1/projects/archive-pilates/databases/(default)/documents/dashboardSnapshots/current?${mask}`,
    {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        fields: Object.fromEntries(Object.entries(next).map(([field, value]) => [field, firestoreValue(value)])),
      }),
    },
  );
  const text = await result.text();
  const body = safeJson(text) || text.slice(0, 2000);
  if (result.ok && body && typeof body === "object") {
    return {
      ok: true,
      status: result.status,
      updateTime: body.updateTime || "",
      name: body.name || "",
      currentMonth,
      previewRows: Object.fromEntries(Object.entries(preview).map(([field, value]) => [field, value.length])),
      rows: Object.fromEntries(Object.entries(next).map(([field, value]) => [field, Array.isArray(value) ? value.length : 1])),
      dailyRevenueScope: "current-month-only",
    };
  }
  return { ok: result.ok, status: result.status, body };
}

async function fetchFirestoreDashboard(token) {
  const result = await fetch("https://firestore.googleapis.com/v1/projects/archive-pilates/databases/(default)/documents/dashboardSnapshots/current", {
    headers: { authorization: `Bearer ${token}` },
  });
  const text = await result.text();
  if (!result.ok) throw new Error(`Firestore dashboard read failed ${result.status}: ${text}`);
  return decodeFirestoreFields(safeJson(text)?.fields || {});
}

function buildFirestoreCurrentPreview({ dailyRevenue, settlementPreview, instructorPreview }) {
  const currentMonth = monthKey(todayKey());
  const latestDaily = [...dailyRevenue].filter((row) => row.기준월 === currentMonth).sort((a, b) => a.기준일.localeCompare(b.기준일)).pop();
  const settlementRows = settlementPreview
    .map((row) => ({
      월: monthKey(row.기준월),
      강사: stringValue(row.성명),
      총매출: amount(row.총매출),
      세전총액: amount(row.세전총액),
      실지급액: amount(row.실지급액),
      그룹횟수: amount(row.그룹횟수),
      프라이빗횟수: amount(row.프라이빗횟수),
      강사레슨횟수: amount(row.강사레슨횟수),
    }))
    .filter((row) => row.월 === currentMonth && row.강사);
  const instructorRows = instructorPreview
    .map((row) => ({
      월: monthKey(row.기준월),
      강사: stringValue(row.강사명),
      그룹예약률: round1(amount(row.그룹예약률) * 100),
      그룹출석률: round1(amount(row.그룹출석률) * 100),
      그룹평균인원: round2(amount(row.그룹출석평균)),
      그룹횟수: amount(row.그룹횟수),
    }))
    .filter((row) => row.월 === currentMonth && row.강사);
  const lessonRevenue = settlementRows.reduce((sum, row) => sum + row.총매출, 0);
  const pretax = settlementRows.reduce((sum, row) => sum + row.세전총액, 0);
  const net = settlementRows.reduce((sum, row) => sum + row.실지급액, 0);
  const groupSessions = settlementRows.reduce((sum, row) => sum + row.그룹횟수, 0);
  const privateSessions = settlementRows.reduce((sum, row) => sum + row.프라이빗횟수, 0);
  const instructorLessonSessions = settlementRows.reduce((sum, row) => sum + row.강사레슨횟수, 0);
  const totalGroupSessions = instructorRows.reduce((sum, row) => sum + row.그룹횟수, 0);
  const reservationRate = weightedAverage(instructorRows, "그룹예약률", "그룹횟수");
  const attendanceRate = weightedAverage(instructorRows, "그룹출석률", "그룹횟수");
  const summary =
    settlementRows.length || latestDaily
      ? [
          {
            월: currentMonth,
            총매출: Math.round(latestDaily?.월누적매출 || lessonRevenue),
            수업매출: Math.round(lessonRevenue),
            실지급액: Math.round(net),
            세전총액: Math.round(pretax),
            마진률: lessonRevenue ? round1(((lessonRevenue - pretax) / lessonRevenue) * 100) : 0,
            그룹세션: round2(totalGroupSessions || groupSessions),
            프라이빗: round2(privateSessions),
            강사레슨: round2(instructorLessonSessions),
            예약률: reservationRate,
            출석률: attendanceRate,
          },
        ]
      : [];
  return {
    summary,
    강사별: settlementRows.map((row) => ({
      월: row.월,
      강사: row.강사,
      총매출: Math.round(row.총매출),
      세전총액: Math.round(row.세전총액),
      실지급액: Math.round(row.실지급액),
    })),
    강사통계: instructorRows.map((row) => ({
      월: row.월,
      강사: row.강사,
      그룹예약률: row.그룹예약률,
      그룹출석률: row.그룹출석률,
      그룹평균인원: row.그룹평균인원,
    })),
    월별강사평균인원: instructorRows.map((row) => ({
      월: row.월,
      강사: row.강사,
      그룹평균인원: row.그룹평균인원,
    })),
  };
}

function replaceMonthRows(rows, month, replacement) {
  const kept = rows.filter((row) => monthKey(row.월 || row.기준월) !== month);
  return [...kept, ...replacement].sort((a, b) => {
    const monthCompare = monthKey(a.월 || a.기준월).localeCompare(monthKey(b.월 || b.기준월));
    if (monthCompare) return monthCompare;
    return stringValue(a.강사).localeCompare(stringValue(b.강사), "ko");
  });
}

function weightedAverage(rows, valueKey, weightKey) {
  const totalWeight = rows.reduce((sum, row) => sum + amount(row[weightKey]), 0);
  if (!totalWeight) return 0;
  return round1(rows.reduce((sum, row) => sum + amount(row[valueKey]) * amount(row[weightKey]), 0) / totalWeight);
}

function firestoreValue(value) {
  if (Array.isArray(value)) return { arrayValue: { values: value.map((item) => firestoreValue(item)) } };
  if (value && typeof value === "object") {
    return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, firestoreValue(item)])) } };
  }
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (value == null) return { nullValue: null };
  return { stringValue: String(value) };
}

function decodeFirestoreFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeFirestoreValue(value)]));
}

function decodeFirestoreValue(value) {
  if (!value || typeof value !== "object") return null;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue) || 0;
  if ("doubleValue" in value) return Number(value.doubleValue) || 0;
  if ("booleanValue" in value) return Boolean(value.booleanValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decodeFirestoreValue);
  if ("mapValue" in value) return decodeFirestoreFields(value.mapValue.fields || {});
  return null;
}

function sheetRowsToObjects(rows) {
  const [headers, ...body] = rows || [];
  return body.map((row) =>
    Object.fromEntries((headers || []).map((header, index) => [header, row[index] == null ? "" : row[index]])),
  );
}

async function googleAccessToken(scopes, options = {}) {
  const key = JSON.parse(readFileSync(config.credentialsPath, "utf8"));
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: key.client_email,
    scope: scopes.join(" "),
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  if (options.delegated !== false && config.delegatedUser) {
    payload.sub = config.delegatedUser;
  }
  const assertion = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify(payload))}`;
  const signature = createSign("RSA-SHA256").update(assertion).sign(key.private_key);
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: `${assertion}.${base64url(signature)}`,
  });
  const result = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body });
  if (!result.ok) throw new Error(`Google token request failed ${result.status}: ${await result.text()}`);
  const json = await result.json();
  if (!json.access_token) throw new Error("Google token response did not include access_token");
  return json.access_token;
}

async function googleIdentityToken(audience) {
  const key = JSON.parse(readFileSync(config.credentialsPath, "utf8"));
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: key.client_email,
    aud: "https://oauth2.googleapis.com/token",
    target_audience: audience,
    exp: now + 3600,
    iat: now,
  };
  const assertion = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify(payload))}`;
  const signature = createSign("RSA-SHA256").update(assertion).sign(key.private_key);
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: `${assertion}.${base64url(signature)}`,
  });
  const result = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body });
  if (!result.ok) throw new Error(`Google identity token request failed ${result.status}: ${await result.text()}`);
  const json = await result.json();
  if (!json.id_token) throw new Error("Google identity token response did not include id_token");
  return json.id_token;
}

async function sheetsRequest(token, method, apiPath, body) {
  const result = await fetch(`https://sheets.googleapis.com${apiPath}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await result.text();
  if (!result.ok) throw new Error(`Sheets API failed ${result.status}: ${text}`);
  return safeJson(text) || {};
}

function writeReport(report) {
  mkdirSync(REPORT_DIR, { recursive: true });
  const file = `${new Date().toISOString().replace(/[:.]/g, "-")}-archive-dashboard-db-sync.json`;
  const reportPath = path.join(REPORT_DIR, file);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return reportPath;
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

function quotedRange(sheetName, range) {
  return `'${sheetName.replace(/'/g, "''")}'!${range}`;
}

function previousMonthSameDay(dateText) {
  const date = parseDate(dateText);
  return clampDate(date.year, date.month - 1, date.day);
}

function previousYearSameDay(dateText) {
  const date = parseDate(dateText);
  return clampDate(date.year - 1, date.month, date.day);
}

function cumulativeThroughDate(cumulativeByDate, targetDate) {
  const targetMonth = monthKey(targetDate);
  const candidate = [...cumulativeByDate.keys()].filter((date) => monthKey(date) === targetMonth && date <= targetDate).sort().pop();
  return candidate ? cumulativeByDate.get(candidate) || 0 : 0;
}

function clampDate(year, month, day) {
  while (month < 1) {
    year -= 1;
    month += 12;
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

function addDays(dateText, days) {
  const date = parseDate(dateText);
  const value = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

function todayKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function parseDate(dateText) {
  const matched = String(dateText).match(/(20\d{2})-(\d{2})-(\d{2})/);
  if (!matched) throw new Error(`Invalid date: ${dateText}`);
  return { year: Number(matched[1]), month: Number(matched[2]), day: Number(matched[3]) };
}

function classTypeName(value, ticketName = "") {
  const text = stringValue(value);
  const ticketText = stringValue(ticketName);
  const combined = `${text} ${ticketText}`;
  if (ticketText.includes("강사") || combined.includes("강사레슨")) return "강사레슨";
  if (text.includes("그룹")) return "그룹";
  if (combined.includes("프라이빗") || combined.includes("개인")) return "프라이빗";
  if (combined.includes("강사")) return "강사레슨";
  return text || ticketText;
}

function dateKey(value) {
  if (value == null || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value)) return googleSerialDateKey(value);
  const text = String(value).trim();
  const matched = text.match(/(20\d{2})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})/);
  return matched ? `${matched[1]}-${matched[2].padStart(2, "0")}-${matched[3].padStart(2, "0")}` : "";
}

function monthKey(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = googleSerialDateKey(value);
    return date ? date.slice(0, 7) : "";
  }
  const text = String(value || "").trim();
  const monthOnly = text.match(/^(20\d{2})[-./년\s]+(\d{1,2})\s*월?$/);
  if (monthOnly) return `${monthOnly[1]}-${monthOnly[2].padStart(2, "0")}`;
  const date = dateKey(text);
  if (date) return date.slice(0, 7);
  const matched = text.match(/(20\d{2})[-./년\s]+(\d{1,2})/);
  return matched ? `${matched[1]}-${matched[2].padStart(2, "0")}` : "";
}

function googleSerialDateKey(value) {
  if (value < 20000 || value > 90000) return "";
  const date = new Date(Math.round((value - 25569) * 86400 * 1000));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function maxMonth(files) {
  return files.map((file) => file.month).filter(Boolean).sort().pop() || "";
}

function amount(value) {
  if (typeof value === "number") return value;
  if (value == null || value === "") return 0;
  return Number(String(value).replace(/,/g, "").replace(/[^\d.-]/g, "")) || 0;
}

function stringValue(value) {
  return String(value || "").trim();
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

function safeJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function base64url(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function expandHome(value) {
  return value.startsWith("~/") ? path.join(HOME, value.slice(2)) : value;
}
