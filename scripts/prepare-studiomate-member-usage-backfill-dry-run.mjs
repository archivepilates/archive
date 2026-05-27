#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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
const DEFAULT_SOURCE =
  "/Users/archivepilates/ArchiveIN/emergency/downloads/2026-05-27T06-04-29-283Z-member-회원목록_20260527_1504.xlsx";
const DEFAULT_RUN_DIR = path.join(os.homedir(), "ArchiveIN/emergency/archive/member-usage/2026-05-27");
const REPORT_DIR = path.resolve("docs/reports");

const sourcePath = valueArg("--source") || DEFAULT_SOURCE;
const runDir = valueArg("--run-dir") || DEFAULT_RUN_DIR;
const reportDate = valueArg("--date") || kstDate(new Date());
const reportPath = path.join(REPORT_DIR, `${reportDate}-studiomate-member-usage-backfill-dry-run.html`);
const normalizedCsvPath = path.join(runDir, `member-usage-normalized-${reportDate}.csv`);
const normalizedJsonPath = path.join(runDir, `member-usage-normalized-${reportDate}.json`);
const summaryJsonPath = path.join(runDir, `member-usage-dry-run-summary-${reportDate}.json`);

if (!existsSync(sourcePath)) throw new Error(`Source member Excel not found: ${sourcePath}`);
if (!existsSync(runDir)) throw new Error(`Member usage run dir not found: ${runDir}`);
if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const memberFiles = buildMemberFilePlan(sourcePath, runDir);
const normalized = normalizeUsageExcels({ memberFiles, sourcePath, normalizedCsvPath, normalizedJsonPath });
const dateBounds = {
  startDate: normalized.dateRange.startDate,
  endDate: normalized.dateRange.endDate,
};

const [profiles, bookings] = await Promise.all([loadExistingProfiles(), loadExistingBookings(dateBounds.startDate, dateBounds.endDate)]);
const comparison = compareRows(normalized.rows, profiles, bookings);
const summary = {
  ok: true,
  mode: "dry-run",
  source: "studiomate_member_usage_backfill",
  note: "Firestore write not executed. This report is for approval before bookings replacement/backfill.",
  sourcePath,
  runDir,
  studioId: STUDIO_ID,
  generatedAt: new Date().toISOString(),
  memberCoverage: memberFiles.coverage,
  normalized: {
    sourceRows: normalized.sourceRows,
    filesRead: normalized.filesRead,
    rowsRead: normalized.rowsRead,
    uniqueRows: normalized.rows.length,
    duplicateRowsRemoved: normalized.rowsRead - normalized.rows.length,
    dateRange: normalized.dateRange,
    byFinalStatus: countBy(normalized.rows, "finalStatus"),
    byAppStatus: countBy(normalized.rows, "appStatus"),
    byAttendanceStatus: countBy(normalized.rows, "attendanceStatus"),
  },
  firestoreRead: {
    profiles: profiles.total,
    bookingsInRange: bookings.length,
  },
  comparison,
  outputs: {
    normalizedCsvPath,
    normalizedJsonPath,
    summaryJsonPath,
    reportPath,
  },
};

mkdirSync(path.dirname(summaryJsonPath), { recursive: true });
mkdirSync(REPORT_DIR, { recursive: true });
writeFileSync(summaryJsonPath, `${JSON.stringify(summary, null, 2)}\n`);
writeHtmlReport(reportPath, summary);
console.log(JSON.stringify(summary, null, 2));

function valueArg(name) {
  const prefix = `${name}=`;
  const inline = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function buildMemberFilePlan(source, dir) {
  const sourceMembers = readSourceMembers(source);
  const successful = new Map();
  const addSuccess = (member, savedPath, origin) => {
    if (!member?.key || !savedPath || !existsSync(savedPath)) return;
    const previous = successful.get(member.key);
    const current = {
      ...member,
      savedPath,
      origin,
      mtimeMs: statMtime(savedPath),
    };
    if (!previous || current.mtimeMs >= previous.mtimeMs) successful.set(member.key, current);
  };

  for (const file of readdirSync(dir).filter((name) => /^member-usage-.*-manifest\.json$/.test(name))) {
    const manifest = safeJson(path.join(dir, file));
    for (const item of manifest.members || []) {
      if (item.status !== "downloaded") continue;
      addSuccess(
        {
          key: item.memberKey || memberKey(item.name, item.phone),
          name: cleanText(item.name),
          phone: normalizePhone(item.phone),
          memberUrl: item.memberUrl || item.download?.beforeUrl || "",
        },
        item.download?.savedPath,
        file,
      );
    }
  }

  for (const file of readdirSync(dir).filter((name) => /^member-usage-inspect-.*\.json$/.test(name))) {
    const inspect = safeJson(path.join(dir, file));
    if (!inspect?.download?.savedPath) continue;
    const queryPhone = normalizePhone(inspect.sampleQuery || "");
    const byPhone = queryPhone ? sourceMembers.byPhone.get(queryPhone) : null;
    const byName = sourceMembers.byName.get(normalizeName(inspect.sampleQuery || "")) || [];
    const member = byPhone || (byName.length === 1 ? byName[0] : null);
    if (!member) continue;
    addSuccess(
      {
        key: member.key,
        name: member.name,
        phone: member.phone,
        memberUrl: inspect.memberUrl || "",
      },
      inspect.download.savedPath,
      file,
    );
  }

  const missing = sourceMembers.list.filter((member) => !successful.has(member.key));
  return {
    list: [...successful.values()].sort((a, b) => a.key.localeCompare(b.key, "ko")),
    coverage: {
      sourceUniqueMembers: sourceMembers.list.length,
      matchedMemberFiles: successful.size,
      missingCount: missing.length,
      missing: missing.slice(0, 30),
    },
  };
}

function readSourceMembers(source) {
  const code = String.raw`
import json, pandas as pd, re
source = ${JSON.stringify(source)}
df = pd.read_excel(source)
df = df.where(pd.notna(df), "")
rows = []
seen = set()
def clean(v):
    return str(v or "").strip()
def phone(v):
    d = re.sub(r"\D+", "", clean(v))
    if d.startswith("82") and len(d) >= 11:
        d = "0" + d[2:]
    if len(d) == 10 and d.startswith("10"):
        d = "0" + d
    return d
def key(name, tel):
    return re.sub(r"\s+", "", clean(name)).lower() + "|" + phone(tel)
for _, row in df.iterrows():
    name = clean(row.get("이름", ""))
    tel = phone(row.get("전화번호", ""))
    if not name and not tel:
        continue
    k = key(name, tel)
    if k in seen:
        continue
    seen.add(k)
    rows.append({"key": k, "name": name, "phone": tel})
print(json.dumps(rows, ensure_ascii=False))
`;
  const result = spawnSync(PYTHON, ["-c", code], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Failed to read source members");
  const list = JSON.parse(result.stdout || "[]");
  const byPhone = new Map();
  const byName = new Map();
  for (const item of list) {
    if (item.phone) byPhone.set(item.phone, item);
    const name = normalizeName(item.name);
    if (name) {
      const items = byName.get(name) || [];
      items.push(item);
      byName.set(name, items);
    }
  }
  return { list, byPhone, byName };
}

function normalizeUsageExcels({ memberFiles, normalizedCsvPath: csvPath, normalizedJsonPath: jsonPath }) {
  const inputPath = path.join(runDir, `member-usage-file-plan-${reportDate}.json`);
  writeFileSync(inputPath, `${JSON.stringify(memberFiles.list, null, 2)}\n`);
  const code = String.raw`
import csv, json, re, hashlib
from pathlib import Path
import pandas as pd

files = json.loads(Path(${JSON.stringify(inputPath)}).read_text())
csv_path = Path(${JSON.stringify(csvPath)})
json_path = Path(${JSON.stringify(jsonPath)})

def clean(value):
    if value is None:
        return ""
    text = str(value).strip()
    if text.lower() == "nan":
        return ""
    return text

def normalize_name(value):
    return re.sub(r"\s+", "", clean(value)).lower()

def normalize_date(value):
    text = clean(value).replace(".", "-").replace("/", "-")
    m = re.search(r"(20\d{2})-(\d{1,2})-(\d{1,2})", text)
    if not m:
        try:
            dt = pd.to_datetime(value)
            if pd.isna(dt):
                return ""
            return dt.strftime("%Y-%m-%d")
        except Exception:
            return ""
    return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"

def normalize_time(value):
    text = clean(value)
    m = re.search(r"(\d{1,2}):(\d{2})", text)
    if m:
        return f"{int(m.group(1)):02d}:{m.group(2)}"
    try:
        dt = pd.to_datetime(value)
        if pd.isna(dt):
            return ""
        return dt.strftime("%H:%M")
    except Exception:
        return ""

def member_id(value):
    text = clean(value)
    m = re.search(r"[?&]id=(\d+)", text)
    return m.group(1) if m else ""

def app_status(text):
    value = clean(text).lower()
    if re.search(r"대기.*취소|wait.*cancel", value):
        return "wait_cancel"
    if re.search(r"취소|cancel", value):
        return "cancel"
    if re.search(r"대기|wait", value):
        return "wait"
    return "reserved"

def attendance_status(text):
    value = clean(text).lower()
    if re.search(r"노쇼|결석|absent|no.?show", value):
        return "absent"
    if re.search(r"당일.*취소|late", value):
        return "late_cancel"
    if re.search(r"출석|완료|attend|check.?in", value):
        return "attended"
    return "unchecked"

def row_hash(row):
    basis = "|".join(str(row.get(k, "")) for k in [
        "memberKey", "lectureDate", "startTime", "endTime", "title", "staffName", "roomName", "ticketName", "finalStatus", "statusChangedAt"
    ])
    return hashlib.sha256(basis.encode()).hexdigest()[:20]

rows = []
files_read = 0
rows_read = 0
for member in files:
    source = Path(member["savedPath"])
    if not source.exists() or source.name.startswith("~$"):
        continue
    try:
        sheets = pd.read_excel(source, sheet_name=None)
    except Exception as exc:
        rows.append({
            "memberKey": member.get("key", ""),
            "memberName": member.get("name", ""),
            "memberPhone": member.get("phone", ""),
            "sourceFile": str(source),
            "parseError": str(exc),
        })
        continue
    files_read += 1
    for sheet_name, df in sheets.items():
        df = df.where(pd.notna(df), "")
        for _, raw in df.iterrows():
            title = clean(raw.get("수업명", ""))
            lecture_date = normalize_date(raw.get("수업일", ""))
            start_time = normalize_time(raw.get("시작시간", ""))
            if not title and not lecture_date and not start_time:
                continue
            final_status = clean(raw.get("최종상태", ""))
            row = {
                "memberKey": member.get("key", ""),
                "memberName": member.get("name", ""),
                "memberPhone": member.get("phone", ""),
                "memberUrl": member.get("memberUrl", ""),
                "memberId": member_id(member.get("memberUrl", "")),
                "lectureDate": lecture_date,
                "startTime": start_time,
                "endTime": normalize_time(raw.get("종료시간", "")),
                "title": title,
                "staffName": clean(raw.get("강사", "")),
                "roomName": clean(raw.get("룸", "")),
                "capacity": clean(raw.get("최대수강인원", "")),
                "ticketName": clean(raw.get("사용된수강권", "")),
                "finalStatus": final_status,
                "statusChangedAt": clean(raw.get("최종상태변경일시", "")),
                "appStatus": app_status(final_status),
                "attendanceStatus": attendance_status(final_status),
                "sourceFile": str(source),
                "sourceOrigin": member.get("origin", ""),
            }
            row["rowKey"] = row_hash(row)
            rows.append(row)
            rows_read += 1

dedup = {}
for row in rows:
    if row.get("parseError"):
        continue
    dedup[row["rowKey"]] = row
unique = list(dedup.values())
unique.sort(key=lambda r: (r.get("lectureDate", ""), r.get("startTime", ""), r.get("memberName", ""), r.get("title", "")))
headers = [
    "rowKey", "memberKey", "memberName", "memberPhone", "lectureDate", "startTime", "endTime", "title", "staffName", "roomName",
    "capacity", "ticketName", "finalStatus", "statusChangedAt", "appStatus", "attendanceStatus", "memberId", "memberUrl", "sourceFile", "sourceOrigin"
]
csv_path.parent.mkdir(parents=True, exist_ok=True)
with csv_path.open("w", newline="", encoding="utf-8-sig") as f:
    writer = csv.DictWriter(f, fieldnames=headers)
    writer.writeheader()
    writer.writerows(unique)
json_path.write_text(json.dumps(unique, ensure_ascii=False), encoding="utf-8")
dates = sorted([r["lectureDate"] for r in unique if r.get("lectureDate")])
print(json.dumps({
    "sourceRows": len(files),
    "filesRead": files_read,
    "rowsRead": rows_read,
    "uniqueRows": len(unique),
    "dateRange": {"startDate": dates[0] if dates else "", "endDate": dates[-1] if dates else ""},
    "rows": unique,
}, ensure_ascii=False))
`;
  const result = spawnSync(PYTHON, ["-c", code], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Failed to normalize usage excels");
  return JSON.parse(result.stdout || "{}");
}

async function loadExistingProfiles() {
  const snap = await db.collection("memberProfiles").where("studioId", "==", STUDIO_ID).get();
  const byPhoneName = new Map();
  const byName = new Map();
  for (const doc of snap.docs) {
    const data = doc.data();
    const phone = normalizePhone(data.phone || "");
    const name = normalizeName(data.name || "");
    const item = { id: doc.id, data };
    if (phone && name) byPhoneName.set(`${phone}|${name}`, item);
    if (name) {
      const list = byName.get(name) || [];
      list.push(item);
      byName.set(name, list);
    }
  }
  return { total: snap.size, byPhoneName, byName };
}

async function loadExistingBookings(startDate, endDate) {
  const out = [];
  if (!startDate || !endDate) return out;
  for (const date of dateRange(startDate, endDate)) {
    const snap = await db.collection("bookings").where("studioId", "==", STUDIO_ID).where("lectureDate", "==", date).get();
    out.push(...snap.docs.map((doc) => ({ id: doc.id, data: doc.data() })));
  }
  return out;
}

function compareRows(rows, profiles, bookings) {
  const existingByStrongKey = new Map();
  const existingByLooseKey = new Map();
  for (const booking of bookings) {
    const data = booking.data;
    const startTime = timestampTime(data.lectureStartAt);
    const strong = [
      data.memberId || "",
      data.lectureDate || "",
      startTime,
      normalizeName(data.title || data.lectureTitle || ""),
      normalizeName(data.staffName || ""),
    ].join("|");
    const loose = [data.memberId || "", data.lectureDate || "", startTime].join("|");
    pushMap(existingByStrongKey, strong, booking);
    pushMap(existingByLooseKey, loose, booking);
  }

  const out = {
    rowsCompared: rows.length,
    memberMatched: 0,
    memberProfileMatched: 0,
    memberProfileMissingButIdKnown: 0,
    memberNoMatch: 0,
    memberAmbiguousName: 0,
    existingSameStrong: 0,
    existingStatusDifferent: 0,
    existingLooseOnly: 0,
    missingCandidates: 0,
    byDecision: {},
    statusConflicts: [],
    memberNoMatchExamples: [],
    looseMatchExamples: [],
    missingExamples: [],
  };

  for (const row of rows) {
    const member = matchMember(row, profiles);
    if (!member) {
      const ambiguous = !row.memberPhone && (profiles.byName.get(normalizeName(row.memberName)) || []).length > 1;
      if (ambiguous) out.memberAmbiguousName += 1;
      else out.memberNoMatch += 1;
      addExample(out.memberNoMatchExamples, row, { reason: ambiguous ? "ambiguous_name" : "not_found" });
      addDecision(out, ambiguous ? "member_ambiguous_name" : "member_no_match");
      continue;
    }
    out.memberMatched += 1;
    if (member.profileMissing) out.memberProfileMissingButIdKnown += 1;
    else out.memberProfileMatched += 1;
    const strongKey = [member.id, row.lectureDate, row.startTime, normalizeName(row.title), normalizeName(row.staffName)].join("|");
    const looseKey = [member.id, row.lectureDate, row.startTime].join("|");
    const strong = existingByStrongKey.get(strongKey) || [];
    const loose = existingByLooseKey.get(looseKey) || [];
    const candidates = strong.length ? strong : loose;
    if (!candidates.length) {
      out.missingCandidates += 1;
      addDecision(out, "missing_candidate");
      addExample(out.missingExamples, row, { memberId: member.id });
      continue;
    }
    const same = candidates.find((booking) => bookingStatusesEqual(booking.data, row));
    if (same && strong.length) {
      out.existingSameStrong += 1;
      addDecision(out, "existing_same_strong");
      continue;
    }
    if (same) {
      out.existingLooseOnly += 1;
      addDecision(out, "existing_same_loose");
      addExample(out.looseMatchExamples, row, existingExample(candidates[0]));
      continue;
    }
    out.existingStatusDifferent += 1;
    addDecision(out, strong.length ? "status_conflict_strong" : "status_conflict_loose");
    addExample(out.statusConflicts, row, existingExample(candidates[0]));
  }
  return out;
}

function matchMember(row, profiles) {
  const name = normalizeName(row.memberName);
  const phone = normalizePhone(row.memberPhone);
  if (phone && name) {
    const exact = profiles.byPhoneName.get(`${phone}|${name}`);
    if (exact) return exact;
  }
  const byName = profiles.byName.get(name) || [];
  if (byName.length === 1) return byName[0];
  if (row.memberId) {
    return {
      id: String(row.memberId),
      data: {
        name: row.memberName || "",
        phone: row.memberPhone || "",
      },
      profileMissing: true,
    };
  }
  return null;
}

function bookingStatusesEqual(booking, row) {
  return cleanText(booking.appStatus || "") === row.appStatus && cleanText(booking.attendanceStatus || "") === row.attendanceStatus;
}

function existingExample(booking) {
  const data = booking.data || {};
  return {
    existingBookingId: booking.id,
    existingAppStatus: data.appStatus || "",
    existingAttendanceStatus: data.attendanceStatus || "",
    existingTitle: data.title || data.lectureTitle || "",
    existingStaffName: data.staffName || "",
  };
}

function addExample(list, row, extra = {}) {
  if (list.length >= 30) return;
  list.push({
    memberName: row.memberName,
    memberPhone: row.memberPhone,
    lectureDate: row.lectureDate,
    startTime: row.startTime,
    title: row.title,
    staffName: row.staffName,
    finalStatus: row.finalStatus,
    appStatus: row.appStatus,
    attendanceStatus: row.attendanceStatus,
    ...extra,
  });
}

function addDecision(summary, key) {
  summary.byDecision[key] = (summary.byDecision[key] || 0) + 1;
}

function pushMap(map, key, value) {
  const list = map.get(key) || [];
  list.push(value);
  map.set(key, list);
}

function countBy(rows, key) {
  const out = {};
  for (const row of rows) {
    const value = cleanText(row[key] || "unknown") || "blank";
    out[value] = (out[value] || 0) + 1;
  }
  return out;
}

function writeHtmlReport(filePath, summary) {
  const c = summary.comparison;
  const n = summary.normalized;
  const html = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>StudioMate 이용내역 백필 승인 전 검토</title>
  <style>
    :root { --bg:#f7f4ee; --paper:#fffdf8; --text:#171717; --muted:#6f6b63; --line:#ded8cb; --accent:#126b4f; --warn:#b2542f; }
    * { box-sizing:border-box; }
    body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR",sans-serif; background:var(--bg); color:var(--text); line-height:1.55; }
    main { max-width:1120px; margin:0 auto; padding:40px 24px 64px; }
    h1 { margin:0 0 8px; font-size:30px; letter-spacing:0; }
    h2 { margin:34px 0 12px; font-size:18px; }
    p { margin:0 0 12px; color:var(--muted); }
    .panel { background:var(--paper); border:1px solid var(--line); border-radius:8px; padding:20px; margin-top:18px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:12px; }
    .metric { border:1px solid var(--line); border-radius:6px; padding:14px; background:#fff; }
    .label { color:var(--muted); font-size:13px; }
    .value { font-size:24px; font-weight:750; margin-top:4px; }
    .ok { color:var(--accent); }
    .warn { color:var(--warn); }
    table { width:100%; border-collapse:collapse; background:#fff; border:1px solid var(--line); border-radius:8px; overflow:hidden; }
    th, td { border-bottom:1px solid var(--line); padding:10px 12px; text-align:left; vertical-align:top; font-size:14px; }
    th { background:#f0ece3; color:#37342e; font-weight:700; }
    tr:last-child td { border-bottom:0; }
    code { word-break:break-all; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; color:#333; }
  </style>
</head>
<body>
<main>
  <h1>StudioMate 이용내역 백필 승인 전 검토</h1>
  <p>Firestore 쓰기 없이 수집 엑셀을 정규화하고 기존 ARCHIVE IN bookings와 비교한 결과입니다.</p>
  <section class="panel">
    <div class="grid">
      ${metric("수집 회원 커버리지", `${summary.memberCoverage.matchedMemberFiles}/${summary.memberCoverage.sourceUniqueMembers}`, summary.memberCoverage.missingCount === 0 ? "ok" : "warn")}
      ${metric("정규화 고유 행", n.uniqueRows.toLocaleString("ko-KR"))}
      ${metric("기존 bookings 읽기", summary.firestoreRead.bookingsInRange.toLocaleString("ko-KR"))}
      ${metric("백필 후보", c.missingCandidates.toLocaleString("ko-KR"), c.missingCandidates ? "warn" : "")}
      ${metric("상태 충돌", c.existingStatusDifferent.toLocaleString("ko-KR"), c.existingStatusDifferent ? "warn" : "ok")}
      ${metric("회원 미매칭", (c.memberNoMatch + c.memberAmbiguousName).toLocaleString("ko-KR"), c.memberNoMatch + c.memberAmbiguousName ? "warn" : "ok")}
    </div>
  </section>
  <h2>판정 요약</h2>
  ${objectTable(c.byDecision)}
  <h2>상태 분포</h2>
  ${objectTable(n.byFinalStatus)}
  <h2>출력 파일</h2>
  <table><tbody>
    <tr><th>정규화 CSV</th><td><code>${escapeHtml(summary.outputs.normalizedCsvPath)}</code></td></tr>
    <tr><th>정규화 JSON</th><td><code>${escapeHtml(summary.outputs.normalizedJsonPath)}</code></td></tr>
    <tr><th>요약 JSON</th><td><code>${escapeHtml(summary.outputs.summaryJsonPath)}</code></td></tr>
  </tbody></table>
  <h2>검토 필요 예시: 상태 충돌</h2>
  ${exampleTable(c.statusConflicts)}
  <h2>검토 필요 예시: 백필 후보</h2>
  ${exampleTable(c.missingExamples)}
  <h2>검토 필요 예시: 회원 미매칭</h2>
  ${exampleTable(c.memberNoMatchExamples)}
</main>
</body>
</html>`;
  writeFileSync(filePath, html);
}

function metric(label, value, className = "") {
  return `<div class="metric"><div class="label">${escapeHtml(label)}</div><div class="value ${className}">${escapeHtml(value)}</div></div>`;
}

function objectTable(obj) {
  const rows = Object.entries(obj || {}).sort((a, b) => String(a[0]).localeCompare(String(b[0]), "ko"));
  if (!rows.length) return "<p>없음</p>";
  return `<table><thead><tr><th>항목</th><th>건수</th></tr></thead><tbody>${rows
    .map(([key, value]) => `<tr><td>${escapeHtml(key)}</td><td>${Number(value).toLocaleString("ko-KR")}</td></tr>`)
    .join("")}</tbody></table>`;
}

function exampleTable(rows) {
  if (!rows?.length) return "<p>없음</p>";
  return `<table><thead><tr><th>회원</th><th>수업</th><th>상태</th><th>비고</th></tr></thead><tbody>${rows
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.memberName)}<br><code>${escapeHtml(row.memberPhone)}</code></td>
        <td>${escapeHtml(`${row.lectureDate} ${row.startTime}`)}<br>${escapeHtml(row.title)}<br><span class="label">${escapeHtml(row.staffName)}</span></td>
        <td>${escapeHtml(row.finalStatus)}<br><code>${escapeHtml(`${row.appStatus}/${row.attendanceStatus}`)}</code></td>
        <td><code>${escapeHtml(JSON.stringify(Object.fromEntries(Object.entries(row).filter(([key]) => !["memberName","memberPhone","lectureDate","startTime","title","staffName","finalStatus","appStatus","attendanceStatus"].includes(key)))) )}</code></td>
      </tr>`,
    )
    .join("")}</tbody></table>`;
}

function timestampTime(value) {
  const date = value?.toDate?.();
  if (!date) return "";
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function dateRange(startDate, endDate) {
  const out = [];
  let current = startDate;
  while (current <= endDate) {
    out.push(current);
    current = addDays(current, 1);
  }
  return out;
}

function addDays(date, days) {
  const base = new Date(`${date}T00:00:00+09:00`);
  base.setDate(base.getDate() + days);
  return kstDate(base);
}

function kstDate(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function safeJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function statMtime(filePath) {
  try {
    return require("node:fs").statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function memberKey(name, phone) {
  return `${normalizeName(name)}|${normalizePhone(phone)}`;
}

function normalizePhone(value) {
  let digits = cleanText(value).replace(/\D+/g, "");
  if (digits.startsWith("82") && digits.length >= 11) digits = `0${digits.slice(2)}`;
  if (digits.length === 10 && digits.startsWith("10")) digits = `0${digits}`;
  return digits;
}

function normalizeName(value) {
  return cleanText(value).replace(/\s+/g, "").toLowerCase();
}

function cleanText(value) {
  return String(value ?? "").normalize("NFC").trim();
}

function hash(value) {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
