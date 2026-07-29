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
const DELEGATED_USER = String(args["delegated-user"] || process.env.HOHOYOGA_GOOGLE_DELEGATED_USER || "");
const SNAPSHOT_SCRIPT = String(
  args["snapshot-script"] ||
    process.env.HOHOYOGA_SNAPSHOT_SCRIPT ||
    path.join(ROOT, "scripts/hohoyoga-monitor-snapshot.mjs"),
);
const SNAPSHOT_PATH_ARG = args["snapshot-path"] ? expandHome(String(args["snapshot-path"])) : "";
const REPORT_DIR = expandHome(String(args["report-dir"] || process.env.HOHOYOGA_REPORT_DIR || "~/ArchiveIN/automation/reports/hohoyoga-monitor"));
const ARTIFACT_DIR = path.join(ROOT, "artifacts/hohoyoga-monitor");
const RUN_AT = kstDateTime(new Date());
const CENTER_SALE_LIMIT = Number(args["center-sale-limit"] || process.env.HOHOYOGA_CENTER_BUY_LIMIT || 0);

const SHEETS = {
  posts: "구인글",
  centerSale: "센터매매_부산",
  centerSaleReview: "센터매매_검토뷰",
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
  "등급",
  "점수",
  "등급근거",
  "매물유형",
  "확인필요",
  "추정센터",
  "소유자/게시자그룹",
  "특정근거",
  "정밀등급메모",
];
const CENTER_SALE_REVIEW_HEADERS = [
  "등급",
  "점수",
  "추정센터",
  "제목",
  "게시일",
  "연락처",
  "매물유형",
  "확인필요",
  "등급근거",
  "정밀등급메모",
  "본문요약",
  "원문URL",
  "글번호",
  "소유자/게시자그룹",
];
const CENTER_SALE_REVIEW_FORMULA = `=QUERY({ARRAYFORMULA(SWITCH('${SHEETS.centerSale}'!S2:S,"S",1,"A",2,"B",3,"C",4,"D",5,"F",6,9)),'${SHEETS.centerSale}'!S2:S,'${SHEETS.centerSale}'!T2:T,'${SHEETS.centerSale}'!X2:X,'${SHEETS.centerSale}'!D2:D,'${SHEETS.centerSale}'!B2:B,'${SHEETS.centerSale}'!H2:H,'${SHEETS.centerSale}'!V2:V,'${SHEETS.centerSale}'!W2:W,'${SHEETS.centerSale}'!U2:U,'${SHEETS.centerSale}'!AA2:AA,ARRAYFORMULA(LEFT('${SHEETS.centerSale}'!M2:M,180)),'${SHEETS.centerSale}'!J2:J,'${SHEETS.centerSale}'!A2:A,'${SHEETS.centerSale}'!Y2:Y},"select Col2,Col3,Col4,Col5,Col6,Col7,Col8,Col9,Col10,Col11,Col12,Col13,Col14,Col15 where Col14 is not null order by Col1 asc, Col3 desc",0)`;

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
    delegated: Boolean(DELEGATED_USER),
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
    googleAuthMode: DELEGATED_USER ? `service_account_delegated:${DELEGATED_USER}` : "service_account_direct",
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
  await ensureHeader(token, SHEETS.centerSaleReview, CENTER_SALE_REVIEW_HEADERS);
  await ensureCenterSaleReviewFormula(token);
  await ensureHeader(token, SHEETS.history, HISTORY_HEADERS);
  await ensureHeader(token, SHEETS.log, LOG_HEADERS);
}

async function ensureCenterSaleReviewFormula(token) {
  const current = await sheetsRequest(
    token,
    "GET",
    `/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(quotedRange(SHEETS.centerSaleReview, "A2"))}?valueRenderOption=FORMULA`,
  );
  const formula = current.values?.[0]?.[0] || "";
  if (formula === CENTER_SALE_REVIEW_FORMULA) return;
  await sheetsRequest(
    token,
    "POST",
    `/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(quotedRange(SHEETS.centerSaleReview, "A2:N1000"))}:clear`,
    {},
  );
  await sheetsRequest(
    token,
    "PUT",
    `/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(quotedRange(SHEETS.centerSaleReview, "A2"))}?valueInputOption=USER_ENTERED`,
    { values: [[CENTER_SALE_REVIEW_FORMULA]] },
  );
}

async function ensureHeader(token, sheetName, headers) {
  const current = await sheetsRequest(
    token,
    "GET",
    `/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(quotedRange(sheetName, "1:1"))}`,
  );
  const row = current.values?.[0] || [];
  if (headers.every((header, index) => row[index] === header)) return;
  const endColumn = columnName(headers.length);
  await sheetsRequest(token, "PUT", `/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(quotedRange(sheetName, `A1:${endColumn}1`))}?valueInputOption=USER_ENTERED`, {
    values: [headers],
  });
}

async function readSheetObjects(token, sheetName) {
  const result = await sheetsRequest(
    token,
    "GET",
    `/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(quotedRange(sheetName, "A:AZ"))}`,
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
  const maxAttempts = Math.max(1, Number(process.env.HOHOYOGA_SNAPSHOT_RETRIES || "3"));
  let lastOutput = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
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
    lastOutput = [result.error?.message, result.stderr, result.stdout].filter(Boolean).join("\n");
    if (result.status === 0) {
      if (existsSync(outputPath)) return JSON.parse(readFileSync(outputPath, "utf8"));
      return JSON.parse(result.stdout || "{}");
    }
    const retryable = /EPIPE|fetch failed|ECONNRESET|ETIMEDOUT|ENETUNREACH|EAI_AGAIN|socket/i.test(lastOutput);
    if (!retryable || attempt === maxAttempts) break;
    console.warn(`HohoYoga snapshot transient failure; retrying (${attempt}/${maxAttempts}).`);
    sleepSync(attempt * 3000);
  }
  throw new Error(`HohoYoga snapshot failed: ${lastOutput}`);
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
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
    updateCenterSaleRowFromItem(row, item, item.isCompleted ? "완료 감지" : "상태 확인");
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
        updateCenterSaleRowFromItem(row, item, "중복 스킵, 상태 확인");
        rowUpdates.push({ rowNumber: existing.rowNumber, row });
      }
      continue;
    }
    if (CENTER_SALE_LIMIT > 0 && existingById.size + newRows.length >= CENTER_SALE_LIMIT) continue;
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
    data.push({
      range: quotedRange(SHEETS.centerSale, `A${update.rowNumber}:${columnName(CENTER_SALE_HEADERS.length)}${update.rowNumber}`),
      values: [update.row],
    });
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
    `/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(quotedRange(sheetName, "A:AZ"))}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
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
    phoneForSheet(item.phone),
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
  const grade = gradeCenterSale(item);
  const identity = identifyCenterSale(item);
  return [
    item.documentSrl || "",
    item.postedDate || "",
    "부산",
    item.title || "",
    item.author || "",
    item.address || item.area || "",
    item.readCount || "",
    phoneForSheet(item.phone),
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
    grade.grade,
    grade.score,
    grade.reason,
    grade.type,
    grade.checkNeeded,
    identity.centerName,
    identity.ownerGroup,
    identity.evidence,
    identity.memo,
  ];
}

function centerSaleRowFromExisting(row) {
  if (isShiftedCenterSaleRow(row)) return normalizeShiftedCenterSaleRow(row);
  return CENTER_SALE_HEADERS.map((header) => row[header] ?? "");
}

function isShiftedCenterSaleRow(row) {
  return /^https?:\/\//.test(String(row["연락처"] || "").trim()) && !/^https?:\/\//.test(String(row["원문URL"] || "").trim());
}

function normalizeShiftedCenterSaleRow(row) {
  const recentCheckedAt = looksLikeKstDateTime(row["최근확인일"]) ? row["최근확인일"] : RUN_AT;
  const newFlag = /^[SABCDF]$/.test(String(row["신규추가여부"] || "").trim())
    ? "시트 규칙 보정"
    : row["신규추가여부"] || "시트 규칙 보정";
  return [
    row["글번호"] || "",
    row["게시일"] || "",
    row["지역필터"] || "부산",
    row["제목"] || "",
    row["작성자"] || "",
    "",
    row["주소/지역"] || "",
    phoneForSheet(row["조회수"]),
    "",
    row["연락처"] || "",
    row["이메일"] || "",
    row["원문URL"] || "",
    row["원문본문"] || "",
    recentCheckedAt,
    recentCheckedAt,
    row["현재상태"] || row["첫수집일"] || "게시중",
    newFlag,
    row["모니터링메모"] || "시트 규칙 보정",
    row["등급"] || "",
    row["점수"] || "",
    row["등급근거"] || "",
    row["매물유형"] || "",
    row["확인필요"] || "",
    row["추정센터"] || "",
    row["소유자/게시자그룹"] || "",
    row["특정근거"] || "",
    row["정밀등급메모"] || "",
  ];
}

function looksLikeKstDateTime(value) {
  return /^20\d{2}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(String(value || "").trim());
}

function updateCenterSaleRowFromItem(row, item, memo) {
  const grade = gradeCenterSale(item);
  row[5] = item.address || item.area || row[5] || "";
  row[6] = item.readCount || row[6] || "";
  row[7] = phoneForSheet(item.phone || row[7] || "");
  row[8] = item.email || row[8] || "";
  row[9] = item.sourceUrl || row[9] || "";
  row[10] = item.contentStatus || row[10] || "";
  row[11] = item.contentPreview || row[11] || "";
  row[12] = item.content || row[12] || "";
  row[14] = RUN_AT;
  row[15] = item.isCompleted ? "완료" : "게시중";
  row[17] = memo || row[17] || "상태 확인";
  row[18] = grade.grade;
  row[19] = grade.score;
  row[20] = grade.reason;
  row[21] = grade.type;
  row[22] = grade.checkNeeded;
  const identity = identifyCenterSale(item);
  row[23] = identity.centerName;
  row[24] = identity.ownerGroup;
  row[25] = identity.evidence;
  row[26] = identity.memo;
  return row;
}

function phoneForSheet(value) {
  const text = String(value || "").trim();
  if (!text || text.startsWith("'")) return text;
  const digits = text.replace(/\D/g, "");
  return digits.startsWith("0") && digits.length >= 9 ? `'${text}` : text;
}

function isBusanCenterSale(item) {
  const title = String(item.title || "");
  const text = [item.title, item.area, item.address, item.contentPreview, item.content].join("\n");
  if (/부산|부산광역시|부산시/.test(text)) return true;
  return /해운대|센텀|민락|수영구|동래구|연제구|부산진구|서면|사하구|사상구|금정구|기장|영도구|장전|부산하단|하단동|동아대/.test(title);
}

function gradeCenterSale(item) {
  const title = String(item.title || "");
  const content = String(item.content || item.contentPreview || "");
  const text = `${title}\n${content}`;
  const hasPhone = Boolean(String(item.phone || "").trim());
  const hasFinancialInfo = /보증금|월세|권리금|무권리|매매금액|가격|금액|협의/.test(text);
  const identity = identifyCenterSale(item);
  const isMemberWanted = /회원\s*인수합니다|회원권?\s*인수합니다|회원\s*인수\s*원합니다/.test(title);
  const isCollaboration = /샵인샵|교육협업|원장\(강사\)님 모집|강사\)님 모집/.test(text);
  if (isMemberWanted || isCollaboration) {
    return {
      grade: "F",
      score: 25,
      type: isMemberWanted ? "회원 인수/매입 요청" : "협업/모집성 글",
      reason: isMemberWanted ? "센터 매물보다 회원 인수 요청 성격이 강함" : "센터 매물보다 협업/모집 성격이 강함",
      checkNeeded: "매물 검토 대상에서 제외 권장",
    };
  }

  let score = 50;
  const reasons = [];
  const add = (points, reason) => {
    score += points;
    reasons.push(reason);
  };
  const sub = (points, reason) => {
    score -= points;
    reasons.push(reason);
  };

  if (/양도|매매|인수하실 분|매물|권리금|보증금|월세/.test(text)) add(10, "실제 양도/매매 정보");
  if (/부산|해운대|센텀|민락|수영구|동래구|연제구|부산진구|서면|사하구|사상구|금정구|기장|영도구|장전|하단|명지/.test(text)) add(6, "부산 내 위치 확인");
  if (/역세권|메인상권|대단지|대로|아파트|상가|독점상권|마린시티|국제신도시/.test(text)) add(10, "입지 강점");
  if (/무권리|권리금\s*무|권리금\s*없|권리금파격|권리금\s*협의|저렴|지원|인하/.test(text)) add(12, "권리금/조건 우호적");
  if (/회원\s*유지|즉시\s*운영|바로\s*운영|성업|오토운영|수익|운영\s*가능/.test(text)) add(10, "운영 연속성 정보");
  if (/\d+\s*평|평대|대형|기구|시설|사진첨부|리포머|캐딜락|체어|바렐/.test(text)) add(6, "규모/시설 정보");
  if (hasPhone) add(4, "연락처 있음");
  if (content.length >= 350) add(5, "본문 정보 충분");
  if (identity.centerName) add(8, "센터 특정 완료");

  if (!hasPhone) sub(8, "연락처 확인 필요");
  if (!hasFinancialInfo) sub(8, "금액 조건 부족");
  if (content.length < 160) sub(8, "본문 정보 부족");

  if (!hasPhone) score = Math.min(score, 82);
  if (!hasFinancialInfo) score = Math.min(score, 84);
  if (content.length < 160) score = Math.min(score, 70);
  score = Math.max(0, Math.min(100, score));
  const grade = score >= 92 ? "S" : score >= 82 ? "A" : score >= 72 ? "B" : score >= 62 ? "C" : score >= 50 ? "D" : "F";
  const type = /요가/.test(text) && !/필라테스/.test(text) ? "요가원/전환 가능" : "필라테스/운동센터 매물";
  const checkNeeded = [
    !hasPhone ? "연락처" : "",
    !hasFinancialInfo ? "금액조건" : "",
    /인수하실 분 찾습니다/.test(text) ? "표현상 매도/매수 방향" : "",
  ].filter(Boolean).join(", ") || "없음";

  return {
    grade,
    score,
    type,
    reason: reasons.slice(0, 5).join(" · "),
    checkNeeded,
  };
}

function identifyCenterSale(item) {
  const title = String(item.title || "");
  const content = String(item.content || item.contentPreview || "");
  const text = `${title}\n${content}`;
  const phone = normalizePhone(item.phone);
  const author = String(item.author || "").trim();

  if (phone === "01039758713") {
    const ownerGroup = `${author || "두부가계부"} / 010-3975-8713 / 동일 소유자 확인`;
    if (/강서구|명지|서부권|87평/.test(text)) {
      return {
        centerName: "대기구필라테스청담 명지점",
        ownerGroup,
        evidence: "운영자 확인 + 동일 작성자/연락처 + 강서구/명지권 87평 매물 정보",
        memo: "센터 특정 완료. 명지점 실매출, 회원 유지 조건, 권리금 협상 여지 우선 확인",
      };
    }
    if (/부산진구|당감|68평/.test(text)) {
      return {
        centerName: "대기구필라테스청담 당감동 지점",
        ownerGroup,
        evidence: "운영자 확인 + 동일 작성자/연락처 + 부산진구/당감동 68평 매물 정보",
        memo: "센터 특정 완료. 당감동 지점의 회원 구성, 재등록률, 인건비 구조 우선 확인",
      };
    }
    return {
      centerName: "",
      ownerGroup,
      evidence: "동일 작성자/연락처 매물 그룹",
      memo: "같은 소유자 매물 가능성. 지점 특정 추가 확인 필요",
    };
  }

  return {
    centerName: "",
    ownerGroup: author || phone ? [author, phone].filter(Boolean).join(" / ") : "",
    evidence: "",
    memo: "",
  };
}

function normalizePhone(value = "") {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("10")) return `0${digits}`;
  return digits;
}

function columnName(index) {
  let name = "";
  let n = index;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
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
