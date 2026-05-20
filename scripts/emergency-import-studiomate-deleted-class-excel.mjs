#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "archive-pilates";
const STUDIO_ID = process.env.STUDIOMATE_STUDIO_ID || process.env.MANAGER_STUDIO_ID || "5330";
const PYTHON =
  process.env.ARCHIVEIN_PYTHON ||
  "/Users/archivepilates/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";
const DELETED_CLASS_EXPORT_ROOTS = [
  path.join(os.homedir(), "ArchiveIN/emergency/archive/deleted-class"),
  path.join(os.homedir(), "ArchiveIN/emergency/downloads"),
];

const args = new Set(process.argv.slice(2));
const fileArg = valueArg("--file");
const apply = args.has("--apply");
const requireFile = args.has("--require-file");
const reportDir = path.join(os.homedir(), "ArchiveIN/automation/reports/deleted-class-daily");

if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const sourceFile = fileArg || latestDeletedClassExportPath();
if (!sourceFile) {
  const summary = {
    ok: false,
    mode: apply ? "apply" : "dry-run",
    source: "studiomate_deleted_class_excel_emergency",
    reason: "deleted class Excel export not found",
    roots: DELETED_CLASS_EXPORT_ROOTS,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (requireFile) process.exitCode = 2;
  process.exit();
}

const rows = readRows(sourceFile);
const logs = rows.map(normalizeDeletedClassRow).filter((row) => row.date || row.title || row.staffName);
const summary = {
  ok: true,
  mode: apply ? "apply" : "dry-run",
  source: "studiomate_deleted_class_excel_emergency",
  sourceFile,
  studioId: STUDIO_ID,
  readRows: rows.length,
  parsedRows: logs.length,
  months: [...new Set(logs.map((row) => row.month).filter(Boolean))].sort(),
};

if (apply) {
  await applyLogs(logs);
  await db.collection("opsState").doc("studiomateDeletedClassExcelEmergency").set(
    {
      active: true,
      sourceFile,
      studioId: STUDIO_ID,
      importedRows: rows.length,
      importedLogs: logs.length,
      months: summary.months,
      updatedAt: admin.firestore.Timestamp.now(),
    },
    { merge: true },
  );
}

mkdirSync(reportDir, { recursive: true });
const reportPath = path.join(reportDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-deleted-class-${apply ? "apply" : "dry-run"}.json`);
writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ ...summary, reportPath }, null, 2));

function latestDeletedClassExportPath() {
  const py = String.raw`
from pathlib import Path
import json
roots = ${JSON.stringify(DELETED_CLASS_EXPORT_ROOTS)}
needles = ("삭제", "deleted", "delete")
files = []
for root in roots:
    p = Path(root).expanduser()
    if not p.exists():
        continue
    for item in p.rglob("*"):
        name = item.name.lower()
        if item.is_file() and item.suffix.lower() in {".xlsx", ".xls", ".csv"} and not item.name.startswith("~$") and any(n in name for n in needles):
            files.append(item)
files.sort(key=lambda p: p.stat().st_mtime)
print(json.dumps(str(files[-1]) if files else ""))
`;
  const result = spawnSync(PYTHON, ["-c", py], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Failed to find deleted class export");
  const found = JSON.parse(result.stdout || "\"\"");
  return found && existsSync(found) ? found : "";
}

function readRows(filePath) {
  const py = String.raw`
from pathlib import Path
import json
import pandas as pd
source = Path(${JSON.stringify(filePath)})
if source.suffix.lower() == ".csv":
    frames = [pd.read_csv(source)]
else:
    sheets = pd.read_excel(source, sheet_name=None)
    frames = list(sheets.values())
rows = []
for df in frames:
    df = df.where(pd.notna(df), "")
    for row in df.to_dict(orient="records"):
        rows.append({str(k): ("" if v is None else str(v).strip()) for k, v in row.items()})
print(json.dumps(rows, ensure_ascii=False))
`;
  const result = spawnSync(PYTHON, ["-c", py], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Failed to parse deleted class export");
  return JSON.parse(result.stdout || "[]");
}

function normalizeDeletedClassRow(row, index) {
  const date = normalizeDate(pick(row, ["수업일", "수업일자", "일자", "날짜", "date", "lectureDate"]));
  const startTime = normalizeTime(pick(row, ["시작시간", "수업시작", "수업시작시간", "시간", "startTime"]));
  const endTime = normalizeTime(pick(row, ["종료시간", "수업종료", "수업종료시간", "endTime"]));
  const title = pick(row, ["수업명", "수업", "강의명", "프로그램", "title", "lecture"]);
  const staffName = pick(row, ["강사", "담당강사", "강사명", "staff", "instructor"]);
  const roomName = pick(row, ["장소", "강의실", "룸", "room"]);
  const divisionName = pick(row, ["구분", "수업구분", "종류", "division", "type"]);
  const deletedAtText = pick(row, ["삭제일", "삭제일시", "삭제시간", "취소일", "취소일시", "deletedAt", "deleted_at"]);
  const deletedBy = pick(row, ["삭제자", "삭제한사람", "처리자", "담당자", "deletedBy", "operator"]);
  const reason = pick(row, ["삭제사유", "삭제이유", "취소사유", "사유", "reason"]);
  const normalized = {
    studioId: STUDIO_ID,
    source: "studiomate_deleted_class_excel",
    sourceFile,
    sourceRowIndex: index,
    sourceHash: hash(row),
    date,
    month: date ? date.slice(0, 7) : "",
    startTime,
    endTime,
    title,
    staffName,
    roomName,
    divisionName,
    lessonType: lessonType(title, divisionName),
    deletedAtText,
    deletedBy,
    reason,
    raw: row,
    importedAt: admin.firestore.Timestamp.now(),
    updatedAt: admin.firestore.Timestamp.now(),
  };
  return { ...normalized, logId: deletedClassLogId(normalized) };
}

async function applyLogs(logs) {
  let batch = db.batch();
  let writes = 0;
  const commit = async () => {
    if (!writes) return;
    await batch.commit();
    batch = db.batch();
    writes = 0;
  };
  for (const log of logs) {
    const { logId, ...data } = log;
    batch.set(db.collection("studiomateDeletedClassLogs").doc(logId), data, { merge: true });
    if (++writes >= 450) await commit();
  }
  await commit();
}

function deletedClassLogId(row) {
  return hash({
    studioId: STUDIO_ID,
    date: row.date,
    startTime: row.startTime,
    endTime: row.endTime,
    staffName: normalizeName(row.staffName),
    title: normalizeName(row.title),
    roomName: normalizeName(row.roomName),
    deletedAtText: row.deletedAtText,
    rawHash: row.sourceHash,
  }).slice(0, 32);
}

function lessonType(title, divisionName) {
  const text = `${title || ""} ${divisionName || ""}`.toLowerCase();
  if (/private|개인|프라이빗/.test(text)) return "private";
  if (/group|그룹/.test(text)) return "group";
  if (/(님| 외 \\d+명)$/.test(String(title || "").trim())) return "private";
  return "";
}

function normalizeDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const dotted = text.match(/(20\d{2})[./년\s-]+(\d{1,2})[./월\s-]+(\d{1,2})/);
  if (dotted) return `${dotted[1]}-${dotted[2].padStart(2, "0")}-${dotted[3].padStart(2, "0")}`;
  const short = text.match(/^(\d{1,2})[./-](\d{1,2})$/);
  if (short) return `${new Date().getFullYear()}-${short[1].padStart(2, "0")}-${short[2].padStart(2, "0")}`;
  return "";
}

function normalizeTime(value) {
  const text = String(value || "").trim();
  const match = text.match(/(\d{1,2})[:시]\s*(\d{2})?/);
  if (!match) return "";
  return `${match[1].padStart(2, "0")}:${(match[2] || "00").padStart(2, "0")}`;
}

function pick(row, names) {
  for (const name of names) {
    if (row[name] != null && String(row[name]).trim()) return String(row[name]).trim();
  }
  const lowered = Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizeKey(key), value]));
  for (const name of names) {
    const value = lowered[normalizeKey(name)];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function normalizeKey(value) {
  return String(value || "").replace(/[\s_()[\].-]/g, "").toLowerCase();
}

function normalizeName(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

function hash(value) {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

function valueArg(name) {
  const prefix = `${name}=`;
  const inline = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}
