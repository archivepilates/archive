#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  EXPORT_SHEET_NAME,
  driveRequest,
  exportRowsToDashboardData,
  googleAccessToken,
  monthKey,
  parseArgs,
  quotedRange,
  sheetsRequest,
  stringValue,
} from "./dashboard-export-utils.mjs";

const HOME = os.homedir();
const DEFAULT_CREDENTIALS = path.join(HOME, "ArchiveIN/secrets/google/archive-codex-operator.json");
const REPORT_DIR = path.join(HOME, "ArchiveIN/automation/reports/archive-dashboard-db-sync");

const args = parseArgs(process.argv.slice(2));
const config = {
  apply: Boolean(args.apply),
  month: String(args.month || ""),
  spreadsheetId: String(args["spreadsheet-id"] || ""),
  credentialsPath: String(args.credentials || process.env.GOOGLE_APPLICATION_CREDENTIALS || DEFAULT_CREDENTIALS),
  delegatedUser: String(args["delegated-user"] || process.env.GOOGLE_DELEGATED_USER || "home@archivepilates.com"),
};

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exitCode = 1;
});

async function main() {
  if (!existsSync(config.credentialsPath)) throw new Error(`Google credentials not found: ${config.credentialsPath}`);
  const sheetToken = await googleAccessToken({
    credentialsPath: config.credentialsPath,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly", "https://www.googleapis.com/auth/drive.metadata.readonly"],
    delegatedUser: config.delegatedUser,
  });
  const source = config.spreadsheetId ? await spreadsheetMetadata(sheetToken, config.spreadsheetId) : await findSettlementSpreadsheet(sheetToken, config.month);
  const exportValues = await readExport(sheetToken, source.id);
  const exported = exportRowsToDashboardData(exportValues);
  const current = config.apply ? await fetchFirestoreDashboard() : {};
  const next = mergeDashboardData(current, exported, source);
  const firestorePatch = config.apply ? await writeFirestoreDashboard(next) : null;
  const report = {
    ok: !firestorePatch || firestorePatch.ok,
    mode: config.apply ? "apply" : "dry-run",
    source,
    exportSheetName: EXPORT_SHEET_NAME,
    rows: Math.max(0, exportValues.length - 1),
    updatedAt: next.updatedAt,
    firestorePatch,
    note: "계산 로직 없이 대시보드_EXPORT payloadJson을 Firestore dashboardSnapshots/current에 반영합니다.",
  };
  console.log(JSON.stringify({ ...report, reportPath: writeReport(report) }, null, 2));
  if (firestorePatch && !firestorePatch.ok) process.exitCode = 1;
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

async function readExport(token, spreadsheetId) {
  const result = await sheetsRequest(
    token,
    "GET",
    `/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(quotedRange(EXPORT_SHEET_NAME, "A:Z"))}?valueRenderOption=UNFORMATTED_VALUE`,
  );
  if (!result.values?.length) throw new Error(`${EXPORT_SHEET_NAME} is empty in ${spreadsheetId}`);
  return result.values;
}

function mergeDashboardData(current, exported, source) {
  const fields = ["summary", "강사별", "강사통계", "월별강사평균인원", "매출일일누적"];
  const next = { ...current };
  const exportMonths = new Set(fields.flatMap((field) => (exported[field] || []).map((row) => monthKey(row.월 || row.기준월))).filter(Boolean));
  for (const field of fields) {
    const exportedRows = exported[field] || [];
    const currentRows = Array.isArray(current[field]) ? current[field] : [];
    next[field] = replaceMonths(currentRows, exportedRows, exportMonths);
  }
  for (const field of ["월별그룹평균가격", "월별이용회원", "수강권TOP5", "회원매출"]) {
    if (!(field in next)) next[field] = [];
  }
  next.updatedAt = new Date().toISOString();
  next.sourceSpreadsheetId = source.id;
  next.sourceSpreadsheetName = source.name;
  next.syncMode = "dashboard_export_etl";
  return next;
}

function replaceMonths(currentRows, exportedRows, months) {
  const kept = currentRows.filter((row) => !months.has(monthKey(row.월 || row.기준월)));
  return [...kept, ...exportedRows].sort((a, b) => {
    const monthCompare = monthKey(a.월 || a.기준월).localeCompare(monthKey(b.월 || b.기준월));
    if (monthCompare) return monthCompare;
    return stringValue(a.강사 || a.기준일 || a.라벨).localeCompare(stringValue(b.강사 || b.기준일 || b.라벨), "ko");
  });
}

async function fetchFirestoreDashboard() {
  const token = await googleAccessToken({
    credentialsPath: config.credentialsPath,
    scopes: ["https://www.googleapis.com/auth/datastore"],
    delegated: false,
  });
  const result = await fetch("https://firestore.googleapis.com/v1/projects/archive-pilates/databases/(default)/documents/dashboardSnapshots/current", {
    headers: { authorization: `Bearer ${token}` },
  });
  const text = await result.text();
  if (!result.ok && result.status !== 404) throw new Error(`Firestore dashboard read failed ${result.status}: ${text}`);
  return result.status === 404 ? {} : decodeFirestoreFields(JSON.parse(text).fields || {});
}

async function writeFirestoreDashboard(data) {
  const token = await googleAccessToken({
    credentialsPath: config.credentialsPath,
    scopes: ["https://www.googleapis.com/auth/datastore"],
    delegated: false,
  });
  const result = await fetch("https://firestore.googleapis.com/v1/projects/archive-pilates/databases/(default)/documents/dashboardSnapshots/current", {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([field, value]) => [field, firestoreValue(value)])) }),
  });
  const text = await result.text();
  const body = safeJson(text) || text.slice(0, 2000);
  return { ok: result.ok, status: result.status, updateTime: body?.updateTime || "", body: result.ok ? undefined : body };
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

function latestCompletedMonth() {
  const now = new Date();
  const kst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  kst.setMonth(kst.getMonth() - 1);
  return `${kst.getFullYear()}-${String(kst.getMonth() + 1).padStart(2, "0")}`;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function writeReport(report) {
  mkdirSync(REPORT_DIR, { recursive: true });
  const reportPath = path.join(REPORT_DIR, `${new Date().toISOString().replace(/[:.]/g, "-")}-dashboard-export-etl.json`);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return reportPath;
}
