#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ensureSheets,
  googleAccessToken,
  quotedRange,
  sheetsRequest,
} from "./dashboard-export-utils.mjs";

const HOME = os.homedir();
const ROOT = process.cwd();
const args = parseArgs(process.argv.slice(2));
const APPLY = Boolean(args.apply);
const CENTER_SALE_ONLY = Boolean(args["center-sale-only"]);
const SHEET_ID = String(args["spreadsheet-id"] || process.env.HOHOYOGA_SPREADSHEET_ID || "1bP0m8_h6-jMFEHN9-_9LptuLoxZZE4Thbr0Fqpxk6tc");
const CREDENTIALS = expandHome(String(args.credentials || process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(HOME, "ArchiveIN/secrets/google/archive-codex-operator.json")));
const DELEGATED_USER = String(args["delegated-user"] || process.env.GOOGLE_DELEGATED_USER || "home@archivepilates.com");
const SNAPSHOT_SCRIPT = String(
  args["snapshot-script"] ||
    process.env.HOHOYOGA_SNAPSHOT_SCRIPT ||
    path.join(HOME, "Documents/ARCHIVE-IN/scripts/hohoyoga-monitor-snapshot.mjs"),
);
const SNAPSHOT_PATH_ARG = args["snapshot-path"] ? expandHome(String(args["snapshot-path"])) : "";
const REPORT_DIR = expandHome(String(args["report-dir"] || process.env.HOHOYOGA_REPORT_DIR || "~/ArchiveIN/automation/reports/hohoyoga-monitor"));
const ARTIFACT_DIR = path.join(ROOT, "artifacts/hohoyoga-monitor");
const RUN_AT = kstDateTime(new Date());

const SHEETS = {
  posts: "구인글",
  centerSale: "센터매매_부산",
  history: "상태이력",
  log: "모니터링로그",
};

const POST_HEADERS = [
  "글번호",
  "게시일",
  "상태",
  "지역",
  "제목",
  "작성자",
  "업체명",
  "임금",
  "요일",
  "마감날짜",
  "주소",
  "연락처",
  "이메일",
  "프로필필수",
  "원문URL",
  "본문상태",
  "본문미리보기",
  "원문본문",
  "첫수집일",
  "최근확인일",
  "현재상태",
  "완료확인일",
  "게시-완료일수",
  "마지막상태변경일",
  "신규추가여부",
  "모니터링메모",
];
const HISTORY_HEADERS = ["변경시각", "글번호", "이전상태", "새상태", "게시일", "완료확인일", "게시-완료일수", "URL", "메모"];
const LOG_HEADERS = ["실행시각", "주기", "확인페이지", "상세확인", "신규추가", "완료감지", "중복스킵", "오류", "메모"];
const CENTER_SALE_HEADERS = [
  "글번호",
  "게시일",
  "지역필터",
  "제목",
  "작성자",
  "주소/지역",
  "조회수",
  "연락처",
  "이메일",
  "원문URL",
  "본문상태",
  "본문미리보기",
  "원문본문",
  "첫수집일",
  "최근확인일",
  "현재상태",
  "신규추가여부",
  "모니터링메모",
];

await main();

async function main() {
  if (!existsSync(CREDENTIALS)) throw new Error(`Google credentials not found: ${CREDENTIALS}`);
  if (!existsSync(SNAPSHOT_SCRIPT)) throw new Error(`HohoYoga snapshot script not found: ${SNAPSHOT_SCRIPT}`);
  mkdirSync(REPORT_DIR, { recursive: true });
  mkdirSync(ARTIFACT_DIR, { recursive: true });

  const token = await googleAccessToken({
    credentialsPath: CREDENTIALS,
    scopes: ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive.metadata.readonly"],
    delegatedUser: DELEGATED_USER,
  });
  await ensureSheets(token, SHEET_ID, Object.values(SHEETS));
  await ensureHeaders(token);

  const existingRows = await readSheetObjects(token, SHEETS.posts);
  const existingById = new Map(existingRows.rows.map((row, index) => [String(row["글번호"] || "").trim(), { row, rowNumber: index + 2 }]).filter(([id]) => id));
  const trackedIds = existingRows.rows
    .filter((row) => String(row["현재상태"] || row["상태"] || "").trim() !== "완료")
    .map((row) => String(row["글번호"] || "").trim())
    .filter(Boolean);
  const snapshotPath = SNAPSHOT_PATH_ARG || path.join(ARTIFACT_DIR, `${kstDate(new Date())}-snapshot.json`);
  const snapshot = SNAPSHOT_PATH_ARG && existsSync(SNAPSHOT_PATH_ARG)
    ? JSON.parse(readFileSync(SNAPSHOT_PATH_ARG, "utf8"))
    : runSnapshot(snapshotPath, trackedIds, {
        boardSlug: "job_pilates_gyeongsang",
        boardKind: "job",
        lookbackDays: process.env.HOHOYOGA_LOOKBACK_DAYS || "21",
        maxPages: process.env.HOHOYOGA_MAX_PAGES || "40",
      });
  const plan = buildPlan(snapshot, existingById);

  const centerSaleRows = await readSheetObjects(token, SHEETS.centerSale);
  const centerSaleById = new Map(
    centerSaleRows.rows
      .map((row, index) => [String(row["글번호"] || "").trim(), { row, rowNumber: index + 2 }])
      .filter(([id]) => id),
  );
  const centerSaleTrackedIds = centerSaleRows.rows
    .filter((row) => String(row["현재상태"] || "").trim() !== "완료")
    .map((row) => String(row["글번호"] || "").trim())
    .filter(Boolean);
  const centerSaleSnapshotPath = path.join(ARTIFACT_DIR, `${kstDate(new Date())}-center-buy-snapshot.json`);
  const centerSaleSnapshot = runSnapshot(centerSaleSnapshotPath, centerSaleTrackedIds, {
    boardSlug: "center_buy",
    boardKind: "centerSale",
    lookbackDays: process.env.HOHOYOGA_CENTER_BUY_LOOKBACK_DAYS || "7",
    maxPages: process.env.HOHOYOGA_CENTER_BUY_MAX_PAGES || "35",
  });
  const centerSalePlan = buildCenterSalePlan(centerSaleSnapshot, centerSaleById);

  if (APPLY) {
    if (!CENTER_SALE_ONLY) await applyPlan(token, plan);
    await applyCenterSalePlan(token, centerSalePlan);
  }

  const report = {
    ok: true,
    mode: APPLY ? "apply" : "dry-run",
    centerSaleOnly: CENTER_SALE_ONLY,
    source: "hohoyoga_monitor",
    spreadsheetId: SHEET_ID,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`,
    runAt: RUN_AT,
    snapshotPath,
    stats: snapshot.stats || {},
    trackedIds: trackedIds.length,
    newRows: plan.newRows.length,
    updatedRows: plan.rowUpdates.length,
    completedRows: plan.completedHistoryRows.length,
    duplicatesSkipped: plan.duplicatesSkipped,
    centerSaleSnapshotPath,
    centerSaleStats: centerSaleSnapshot.stats || {},
    centerSaleTrackedIds: centerSaleTrackedIds.length,
    centerSaleNewRows: centerSalePlan.newRows.length,
    centerSaleUpdatedRows: centerSalePlan.rowUpdates.length,
    centerSaleDuplicatesSkipped: centerSalePlan.duplicatesSkipped,
    logRow: plan.logRow,
    centerSaleLogRow: centerSalePlan.logRow,
  };
  const reportPath = path.join(REPORT_DIR, `${new Date().toISOString().replace(/[:.]/g, "-")}-${APPLY ? "apply" : "dry-run"}.json`);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, reportPath }, null, 2));
}

async function ensureHeaders(token) {
  await ensureHeader(token, SHEETS.posts, POST_HEADERS);
  await ensureHeader(token, SHEETS.centerSale, CENTER_SALE_HEADERS);
  await ensureHeader(token, SHEETS.history, HISTORY_HEADERS);
  await ensureHeader(token, SHEETS.log, LOG_HEADERS);
}

async function ensureHeader(token, sheetName, headers) {
  const current = await sheetsRequest(
    token,
    "GET",
    `/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(quotedRange(sheetName, "1:1"))}`,
  );
  const row = current.values?.[0] || [];
  if (headers.every((header, index) => row[index] === header)) return;
  await sheetsRequest(token, "PUT", `/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(quotedRange(sheetName, "A1:Z1"))}?valueInputOption=USER_ENTERED`, {
    values: [headers],
  });
}

async function readSheetObjects(token, sheetName) {
  const result = await sheetsRequest(
    token,
    "GET",
    `/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(quotedRange(sheetName, "A:Z"))}`,
  );
  const [headers = [], ...rows] = result.values || [];
  return {
    headers,
    rows: rows
      .filter((row) => row.some((cell) => String(cell || "").trim()))
      .map((row) => Object.fromEntries(headers.map((header, index) => [String(header || `col${index + 1}`), row[index] ?? ""]))),
  };
}

function runSnapshot(outputPath, trackedIds, options = {}) {
  const result = spawnSync(process.execPath, [SNAPSHOT_SCRIPT], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      OUTPUT_PATH: outputPath,
      TRACKED_DOCUMENT_SRLS: trackedIds.join(","),
      BOARD_SLUG: options.boardSlug || process.env.BOARD_SLUG || "job_pilates_gyeongsang",
      BOARD_KIND: options.boardKind || process.env.BOARD_KIND || "",
      LOOKBACK_DAYS: options.lookbackDays || process.env.HOHOYOGA_LOOKBACK_DAYS || "21",
      MAX_PAGES: options.maxPages || process.env.HOHOYOGA_MAX_PAGES || "40",
      DETAIL_DELAY_MS: process.env.HOHOYOGA_DETAIL_DELAY_MS || "80",
    },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`HohoYoga snapshot failed: ${result.stderr || result.stdout}`);
  }
  if (existsSync(outputPath)) return JSON.parse(readFileSync(outputPath, "utf8"));
  return JSON.parse(result.stdout || "{}");
}

function buildPlan(snapshot, existingById) {
  const rowUpdates = [];
  const newRows = [];
  const completedHistoryRows = [];
  let duplicatesSkipped = 0;
  const seenUpdateIds = new Set();
  const activePosts = Array.isArray(snapshot.activePosts) ? snapshot.activePosts : [];
  const trackedStatuses = Array.isArray(snapshot.trackedStatuses) ? snapshot.trackedStatuses : [];

  for (const item of trackedStatuses) {
    const id = String(item.documentSrl || "").trim();
    if (!id || seenUpdateIds.has(id)) continue;
    seenUpdateIds.add(id);
    const existing = existingById.get(id);
    if (!existing) continue;
    const previousStatus = String(existing.row["현재상태"] || existing.row["상태"] || "").trim();
    const nextStatus = item.isCompleted ? "완료" : item.status || previousStatus || "진행중";
    const completedAt = nextStatus === "완료" ? existing.row["완료확인일"] || RUN_AT : existing.row["완료확인일"] || "";
    const lastChangedAt = previousStatus !== nextStatus ? RUN_AT : existing.row["마지막상태변경일"] || "";
    const row = postRowFromExisting(existing.row);
    row[19] = RUN_AT;
    row[20] = nextStatus;
    row[21] = completedAt;
    row[22] = completedAt ? postedToCompleteDays(existing.row["게시일"] || item.postedDate, completedAt) : existing.row["게시-완료일수"] || "";
    row[23] = lastChangedAt;
    row[25] = nextStatus === "완료" && previousStatus !== "완료" ? "완료 감지" : "상태 확인";
    rowUpdates.push({ rowNumber: existing.rowNumber, row });
    if (nextStatus === "완료" && previousStatus !== "완료") {
      completedHistoryRows.push([RUN_AT, id, previousStatus || "-", nextStatus, existing.row["게시일"] || item.postedDate || "", completedAt, row[22], item.sourceUrl || existing.row["원문URL"] || "", "완료 감지"]);
    }
  }

  for (const item of activePosts) {
    const id = String(item.documentSrl || "").trim();
    if (!id) continue;
    const existing = existingById.get(id);
    if (existing) {
      duplicatesSkipped += 1;
      if (!seenUpdateIds.has(id)) {
        const row = postRowFromExisting(existing.row);
        row[19] = RUN_AT;
        row[20] = item.status || row[20] || "진행중";
        row[25] = "중복 스킵, 상태 확인";
        rowUpdates.push({ rowNumber: existing.rowNumber, row });
      }
      continue;
    }
    if (item.status !== "진행중" || item.contentStatus !== "본문확보") continue;
    newRows.push(postRowFromItem(item));
  }

  const logRow = [
    RUN_AT,
    "매일",
    snapshot.stats?.pages || 0,
    snapshot.stats?.detailChecked || 0,
    newRows.length,
    completedHistoryRows.length,
    duplicatesSkipped,
    "",
    `tracked=${trackedStatuses.length}, active=${activePosts.length}`,
  ];
  return { rowUpdates, newRows, completedHistoryRows, duplicatesSkipped, logRow };
}

function buildCenterSalePlan(snapshot, existingById) {
  const rowUpdates = [];
  const newRows = [];
  let duplicatesSkipped = 0;
  const seenUpdateIds = new Set();
  const activePosts = Array.isArray(snapshot.activePosts) ? snapshot.activePosts : [];
  const trackedStatuses = Array.isArray(snapshot.trackedStatuses) ? snapshot.trackedStatuses : [];

  for (const item of trackedStatuses) {
    const id = String(item.documentSrl || "").trim();
    if (!id || seenUpdateIds.has(id)) continue;
    seenUpdateIds.add(id);
    const existing = existingById.get(id);
    if (!existing) continue;
    const row = centerSaleRowFromExisting(existing.row);
    row[10] = item.contentStatus || row[10] || "";
    row[11] = item.contentPreview || row[11] || "";
    row[12] = item.content || row[12] || "";
    row[14] = RUN_AT;
    row[15] = item.isCompleted ? "완료" : "게시중";
    row[17] = item.isCompleted ? "완료 감지" : "상태 확인";
    rowUpdates.push({ rowNumber: existing.rowNumber, row });
  }

  for (const item of activePosts) {
    if (!isBusanCenterSale(item)) continue;
    const id = String(item.documentSrl || "").trim();
    if (!id) continue;
    const existing = existingById.get(id);
    if (existing) {
      duplicatesSkipped += 1;
      if (!seenUpdateIds.has(id)) {
        const row = centerSaleRowFromExisting(existing.row);
        row[10] = item.contentStatus || row[10] || "";
        row[11] = item.contentPreview || row[11] || "";
        row[12] = item.content || row[12] || "";
        row[14] = RUN_AT;
        row[15] = item.isCompleted ? "완료" : "게시중";
        row[17] = "중복 스킵, 상태 확인";
        rowUpdates.push({ rowNumber: existing.rowNumber, row });
      }
      continue;
    }
    newRows.push(centerSaleRowFromItem(item));
  }

  const logRow = [
    RUN_AT,
    "매일",
    snapshot.stats?.pages || 0,
    snapshot.stats?.detailChecked || 0,
    newRows.length,
    0,
    duplicatesSkipped,
    "",
    `center_buy 부산필터, tracked=${trackedStatuses.length}, active=${activePosts.length}`,
  ];
  return { rowUpdates, newRows, duplicatesSkipped, logRow };
}

async function applyPlan(token, plan) {
  const data = [];
  for (const update of plan.rowUpdates) {
    data.push({ range: quotedRange(SHEETS.posts, `A${update.rowNumber}:Z${update.rowNumber}`), values: [update.row] });
  }
  if (data.length) {
    await sheetsRequest(token, "POST", `/v4/spreadsheets/${SHEET_ID}/values:batchUpdate`, {
      valueInputOption: "USER_ENTERED",
      data,
    });
  }
  if (plan.newRows.length) await appendRows(token, SHEETS.posts, plan.newRows);
  if (plan.completedHistoryRows.length) await appendRows(token, SHEETS.history, plan.completedHistoryRows);
  await appendRows(token, SHEETS.log, [plan.logRow]);
}

async function applyCenterSalePlan(token, plan) {
  const data = [];
  for (const update of plan.rowUpdates) {
    data.push({ range: quotedRange(SHEETS.centerSale, `A${update.rowNumber}:R${update.rowNumber}`), values: [update.row] });
  }
  if (data.length) {
    await sheetsRequest(token, "POST", `/v4/spreadsheets/${SHEET_ID}/values:batchUpdate`, {
      valueInputOption: "USER_ENTERED",
      data,
    });
  }
  if (plan.newRows.length) await appendRows(token, SHEETS.centerSale, plan.newRows);
  await appendRows(token, SHEETS.log, [plan.logRow]);
}

async function appendRows(token, sheetName, rows) {
  await sheetsRequest(
    token,
    "POST",
    `/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(quotedRange(sheetName, "A:Z"))}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { values: rows },
  );
}

function postRowFromItem(item) {
  return [
    item.documentSrl || "",
    item.postedDate || "",
    item.status || "",
    item.area || "",
    item.title || "",
    item.author || "",
    item.businessName || "",
    item.pay || "",
    item.weekdays || "",
    item.deadline || "",
    item.address || "",
    item.phone || "",
    item.email || "",
    item.profileRequired || "",
    item.sourceUrl || "",
    item.contentStatus || "",
    item.contentPreview || "",
    item.content || "",
    RUN_AT,
    RUN_AT,
    item.status || "진행중",
    "",
    "",
    RUN_AT,
    "신규",
    "자동 추가",
  ];
}

function postRowFromExisting(row) {
  return POST_HEADERS.map((header) => row[header] ?? "");
}

function centerSaleRowFromItem(item) {
  return [
    item.documentSrl || "",
    item.postedDate || "",
    "부산",
    item.title || "",
    item.author || "",
    item.address || item.area || "",
    item.readCount || "",
    item.phone || "",
    item.email || "",
    item.sourceUrl || "",
    item.contentStatus || "",
    item.contentPreview || "",
    item.content || "",
    RUN_AT,
    RUN_AT,
    item.isCompleted ? "완료" : "게시중",
    "신규",
    "자동 추가",
  ];
}

function centerSaleRowFromExisting(row) {
  return CENTER_SALE_HEADERS.map((header) => row[header] ?? "");
}

function isBusanCenterSale(item) {
  const title = String(item.title || "");
  const text = [item.title, item.area, item.address, item.contentPreview, item.content].join("\n");
  if (/부산|부산광역시|부산시/.test(text)) return true;
  return /해운대|센텀|민락|수영구|동래구|연제구|부산진구|서면|사하구|사상구|금정구|기장|영도구|장전|부산하단|하단동|동아대/.test(title);
}

function postedToCompleteDays(postedDate, completedAt) {
  const start = parseDate(postedDate);
  const end = parseDate(completedAt);
  if (!start || !end) return "";
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000));
}

function parseDate(value) {
  const match = String(value || "").match(/(20\d{2})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    if (arg.includes("=")) {
      const [key, ...rest] = arg.slice(2).split("=");
      parsed[key] = rest.join("=");
    } else if (argv[i + 1] && !argv[i + 1].startsWith("--")) {
      parsed[arg.slice(2)] = argv[++i];
    } else {
      parsed[arg.slice(2)] = true;
    }
  }
  return parsed;
}

function expandHome(value) {
  return String(value || "").replace(/^~(?=$|\/)/, HOME);
}

function kstDate(date) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function kstDateTime(date) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}
