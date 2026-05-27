#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
const DEFAULT_USAGE_JSON =
  "/Users/archivepilates/ArchiveIN/emergency/archive/member-usage/2026-05-27/member-usage-normalized-2026-05-27.json";
const DEFAULT_FILE_PLAN =
  "/Users/archivepilates/ArchiveIN/emergency/archive/member-usage/2026-05-27/member-usage-file-plan-2026-05-27.json";
const reportDate = valueArg("--date") || kstDate(new Date());
const sourcePath = valueArg("--source") || DEFAULT_SOURCE;
const usageJsonPath = valueArg("--usage-json") || DEFAULT_USAGE_JSON;
const filePlanPath = valueArg("--file-plan") || DEFAULT_FILE_PLAN;
const outDir = valueArg("--out-dir") || path.join(os.homedir(), "ArchiveIN/emergency/archive/member-usage/2026-05-27");
const ticketJsonPath = path.join(outDir, `member-ticket-history-normalized-${reportDate}.json`);
const ticketCsvPath = path.join(outDir, `member-ticket-history-normalized-${reportDate}.csv`);
const summaryJsonPath = path.join(outDir, `member-ticket-history-dry-run-summary-${reportDate}.json`);
const reportPath = path.resolve("docs/reports", `${reportDate}-studiomate-ticket-history-dry-run.html`);

if (!existsSync(sourcePath)) throw new Error(`Member source Excel not found: ${sourcePath}`);
if (!existsSync(usageJsonPath)) throw new Error(`Usage normalized JSON not found: ${usageJsonPath}`);
if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const normalized = normalizeTicketHistory();
const profiles = await loadExistingProfiles();
const comparison = compareWithProfiles(normalized.memberPlans, profiles);
const summary = {
  ok: true,
  mode: "dry-run",
  source: "studiomate_ticket_history_backfill",
  note: "Firestore write not executed. Ticket purchase/history is prepared from member Excel plus usage history.",
  sourcePath,
  usageJsonPath,
  studioId: STUDIO_ID,
  generatedAt: new Date().toISOString(),
  normalized: {
    ticketRows: normalized.ticketRows.length,
    memberPlans: normalized.memberPlans.length,
    membersWithUsageStats: normalized.memberPlans.filter((item) => item.usageTotal > 0).length,
    byTicketStatus: countBy(normalized.ticketRows, "ticketStatus"),
    byClassType: countBy(normalized.ticketRows, "classType"),
    activeTicketRows: normalized.ticketRows.filter((row) => row.isActiveTicket).length,
    paidAmountTotal: normalized.ticketRows.reduce((sum, row) => sum + (Number(row.paymentAmount) || 0), 0),
  },
  firestoreRead: {
    profiles: profiles.total,
  },
  comparison,
  outputs: {
    ticketJsonPath,
    ticketCsvPath,
    summaryJsonPath,
    reportPath,
  },
};

mkdirSync(outDir, { recursive: true });
mkdirSync(path.dirname(reportPath), { recursive: true });
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

function normalizeTicketHistory() {
  const code = String.raw`
import csv, json, re, hashlib
from pathlib import Path
import pandas as pd

source = Path(${JSON.stringify(sourcePath)})
usage_json = Path(${JSON.stringify(usageJsonPath)})
file_plan_path = Path(${JSON.stringify(filePlanPath)})
ticket_json_path = Path(${JSON.stringify(ticketJsonPath)})
ticket_csv_path = Path(${JSON.stringify(ticketCsvPath)})

def clean(value):
    if value is None:
        return ""
    text = str(value).strip()
    if text.lower() == "nan":
        return ""
    return text

def normalize_phone(value):
    digits = re.sub(r"\D+", "", clean(value))
    if digits.startswith("82") and len(digits) >= 11:
        digits = "0" + digits[2:]
    if len(digits) == 10 and digits.startswith("10"):
        digits = "0" + digits
    return digits

def normalize_name(value):
    return re.sub(r"\s+", "", clean(value)).lower()

def normalize_date(value):
    text = clean(value).replace(".", "-").replace("/", "-")
    m = re.search(r"(20\d{2})-(\d{1,2})-(\d{1,2})", text)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    try:
        dt = pd.to_datetime(value)
        if pd.isna(dt):
            return ""
        return dt.strftime("%Y-%m-%d")
    except Exception:
        return ""

def money(value):
    text = re.sub(r"[^0-9.-]+", "", clean(value))
    if not text:
        return 0
    try:
        return int(float(text))
    except Exception:
        return 0

def number(value):
    text = re.sub(r"[^0-9.-]+", "", clean(value))
    if not text:
        return None
    try:
        return float(text)
    except Exception:
        return None

def member_key(name, phone):
    return normalize_name(name) + "|" + normalize_phone(phone)

def member_id_from_url(value):
    m = re.search(r"[?&]id=(\d+)", clean(value))
    return m.group(1) if m else ""

def active_status(status, end_date, remaining):
    s = clean(status)
    if re.search(r"만료|환불|취소|정지|양도", s):
        return False
    if end_date and end_date < ${JSON.stringify(reportDate)}:
        return False
    if remaining is not None and remaining <= 0:
        return False
    return bool(re.search(r"사용|이용|정상|예정", s))

def row_hash(row):
    basis = "|".join(str(row.get(k, "")) for k in [
        "memberKey", "ticketName", "classType", "startDate", "endDate", "issuedAt", "paymentAt", "paymentAmount", "ticketStatus", "remainingCount"
    ])
    return hashlib.sha256(basis.encode()).hexdigest()[:20]

file_plan = []
if file_plan_path.exists():
    file_plan = json.loads(file_plan_path.read_text())
member_id_by_key = {}
for item in file_plan:
    key = item.get("key", "")
    mid = member_id_from_url(item.get("memberUrl", ""))
    if key and mid:
        member_id_by_key[key] = mid

usage_rows = json.loads(usage_json.read_text())
usage_by_member_ticket = {}
usage_member_ids = {}
for row in usage_rows:
    key = row.get("memberKey", "")
    ticket = clean(row.get("ticketName", ""))
    if not key or not ticket:
        continue
    if row.get("memberId"):
        usage_member_ids[key] = str(row.get("memberId"))
    bucket = usage_by_member_ticket.setdefault((key, ticket), {"total": 0, "attended": 0, "absent": 0, "cancel": 0, "wait": 0, "reservedUnchecked": 0})
    bucket["total"] += 1
    if row.get("attendanceStatus") == "attended":
        bucket["attended"] += 1
    elif row.get("attendanceStatus") == "absent":
        bucket["absent"] += 1
    elif row.get("appStatus") == "cancel":
        bucket["cancel"] += 1
    elif row.get("appStatus") == "wait":
        bucket["wait"] += 1
    elif row.get("appStatus") == "reserved":
        bucket["reservedUnchecked"] += 1

df = pd.read_excel(source)
df = df.where(pd.notna(df), "")
ticket_rows = []
for _, raw in df.iterrows():
    name = clean(raw.get("이름", ""))
    phone = normalize_phone(raw.get("전화번호", ""))
    ticket_name = clean(raw.get("수강권명", ""))
    if not name or not phone or not ticket_name:
        continue
    key = member_key(name, phone)
    start_date = normalize_date(raw.get("수강권시작일", ""))
    end_date = normalize_date(raw.get("수강권종료일", ""))
    remaining = number(raw.get("잔여횟수", ""))
    usage = usage_by_member_ticket.get((key, ticket_name), {"total": 0, "attended": 0, "absent": 0, "cancel": 0, "wait": 0, "reservedUnchecked": 0})
    row = {
        "memberKey": key,
        "memberId": member_id_by_key.get(key) or usage_member_ids.get(key, ""),
        "memberName": name,
        "memberPhone": phone,
        "ticketName": ticket_name,
        "classType": clean(raw.get("수강권종류", "")),
        "startDate": start_date,
        "endDate": end_date,
        "isFamilyTicket": clean(raw.get("패밀리수강권", "")),
        "maxCount": number(raw.get("전체횟수", "")),
        "remainingCount": remaining,
        "usableCount": number(raw.get("예약가능횟수", "")),
        "cancelableCount": number(raw.get("취소가능횟수", "")),
        "issuedAt": normalize_date(raw.get("수강권발급일", "")),
        "ticketUpdatedAtText": clean(raw.get("수강권최종수정일", "")),
        "ticketStatus": clean(raw.get("수강권상태", "")),
        "paymentType": clean(raw.get("결제구분", "")),
        "paymentAmount": money(raw.get("결제금액", "")),
        "paymentAt": normalize_date(raw.get("결제일시", "")),
        "paymentMethod": clean(raw.get("결제방법", "")),
        "installmentMonths": clean(raw.get("할부개월수", "")),
        "usageTotal": usage["total"],
        "usageAttended": usage["attended"],
        "usageAbsent": usage["absent"],
        "usageCancel": usage["cancel"],
        "usageWait": usage["wait"],
        "usageReservedUnchecked": usage["reservedUnchecked"],
    }
    row["isActiveTicket"] = active_status(row["ticketStatus"], row["endDate"], row["remainingCount"])
    row["ticketHistoryId"] = "studiomate_ticket_" + row_hash(row)
    ticket_rows.append(row)

dedup = {}
for row in ticket_rows:
    key = row["ticketHistoryId"]
    dedup[key] = row
ticket_rows = list(dedup.values())
ticket_rows.sort(key=lambda r: (r["memberName"], r["memberPhone"], r["startDate"], r["ticketName"]))

member_plans = []
by_member = {}
for row in ticket_rows:
    by_member.setdefault(row["memberKey"], []).append(row)
for key, rows in by_member.items():
    first = rows[0]
    member_plans.append({
        "memberKey": key,
        "memberId": first.get("memberId", ""),
        "memberName": first.get("memberName", ""),
        "memberPhone": first.get("memberPhone", ""),
        "ticketHistoryCount": len(rows),
        "activeTicketCount": sum(1 for r in rows if r.get("isActiveTicket")),
        "usageTotal": sum(int(r.get("usageTotal") or 0) for r in rows),
        "paidAmountTotal": sum(int(r.get("paymentAmount") or 0) for r in rows),
        "ticketNames": sorted(set(r["ticketName"] for r in rows if r.get("ticketName"))),
    })
member_plans.sort(key=lambda r: (r["memberName"], r["memberPhone"]))

headers = list(ticket_rows[0].keys()) if ticket_rows else []
ticket_csv_path.parent.mkdir(parents=True, exist_ok=True)
with ticket_csv_path.open("w", newline="", encoding="utf-8-sig") as f:
    writer = csv.DictWriter(f, fieldnames=headers)
    writer.writeheader()
    writer.writerows(ticket_rows)
ticket_json_path.write_text(json.dumps({"ticketRows": ticket_rows, "memberPlans": member_plans}, ensure_ascii=False), encoding="utf-8")
print(json.dumps({"ticketRows": ticket_rows, "memberPlans": member_plans}, ensure_ascii=False))
`;
  const result = spawnSync(PYTHON, ["-c", code], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Failed to normalize ticket history");
  return JSON.parse(result.stdout || "{}");
}

async function loadExistingProfiles() {
  const snap = await db.collection("memberProfiles").where("studioId", "==", STUDIO_ID).get();
  const byId = new Map();
  const byPhoneName = new Map();
  for (const doc of snap.docs) {
    const data = doc.data();
    byId.set(doc.id, { id: doc.id, data });
    const key = `${normalizePhone(data.phone || "")}|${normalizeName(data.name || "")}`;
    if (key !== "|") byPhoneName.set(key, { id: doc.id, data });
  }
  return { total: snap.size, byId, byPhoneName };
}

function compareWithProfiles(memberPlans, profiles) {
  const out = {
    membersPrepared: memberPlans.length,
    profileMatched: 0,
    profileMissingButMemberIdKnown: 0,
    profileNoMatch: 0,
    activeTicketCountChanges: 0,
    ticketHistoryWillBeAdded: memberPlans.length,
    examples: [],
  };
  for (const plan of memberPlans) {
    const profile = profiles.byId.get(plan.memberId) || profiles.byPhoneName.get(`${normalizePhone(plan.memberPhone)}|${normalizeName(plan.memberName)}`);
    if (profile) {
      out.profileMatched += 1;
      const currentActive = Number(profile.data.activeTicketCount || 0);
      if (currentActive !== Number(plan.activeTicketCount || 0)) out.activeTicketCountChanges += 1;
    } else if (plan.memberId) {
      out.profileMissingButMemberIdKnown += 1;
    } else {
      out.profileNoMatch += 1;
    }
    if (out.examples.length < 30) {
      out.examples.push({
        memberName: plan.memberName,
        memberPhone: plan.memberPhone,
        memberId: plan.memberId,
        ticketHistoryCount: plan.ticketHistoryCount,
        activeTicketCount: plan.activeTicketCount,
        usageTotal: plan.usageTotal,
        paidAmountTotal: plan.paidAmountTotal,
      });
    }
  }
  return out;
}

function countBy(rows, key) {
  const out = {};
  for (const row of rows || []) {
    const value = cleanText(row[key] || "blank") || "blank";
    out[value] = (out[value] || 0) + 1;
  }
  return out;
}

function writeHtmlReport(filePath, summary) {
  const html = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>StudioMate 수강권 이력 승인 전 검토</title>
  <style>
    :root { --bg:#f7f4ee; --paper:#fffdf8; --text:#171717; --muted:#6f6b63; --line:#ded8cb; --accent:#126b4f; --warn:#b2542f; }
    * { box-sizing:border-box; }
    body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR",sans-serif; background:var(--bg); color:var(--text); line-height:1.55; }
    main { max-width:1120px; margin:0 auto; padding:40px 24px 64px; }
    h1 { margin:0 0 8px; font-size:30px; }
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
  <h1>StudioMate 수강권 이력 승인 전 검토</h1>
  <p>회원목록 엑셀의 수강권 구매/상태 정보와 회원별 이용내역의 실제 사용 통계를 결합했습니다. Firestore 쓰기는 실행하지 않았습니다.</p>
  <section class="panel">
    <div class="grid">
      ${metric("수강권 이력 행", summary.normalized.ticketRows.toLocaleString("ko-KR"))}
      ${metric("대상 회원", summary.normalized.memberPlans.toLocaleString("ko-KR"))}
      ${metric("활성 수강권 행", summary.normalized.activeTicketRows.toLocaleString("ko-KR"))}
      ${metric("프로필 매칭", summary.comparison.profileMatched.toLocaleString("ko-KR"), "ok")}
      ${metric("프로필 없음/ID 있음", summary.comparison.profileMissingButMemberIdKnown.toLocaleString("ko-KR"), summary.comparison.profileMissingButMemberIdKnown ? "warn" : "ok")}
      ${metric("프로필 미매칭", summary.comparison.profileNoMatch.toLocaleString("ko-KR"), summary.comparison.profileNoMatch ? "warn" : "ok")}
    </div>
  </section>
  <h2>수강권 상태 분포</h2>
  ${objectTable(summary.normalized.byTicketStatus)}
  <h2>수강권 종류 분포</h2>
  ${objectTable(summary.normalized.byClassType)}
  <h2>출력 파일</h2>
  <table><tbody>
    <tr><th>정규화 CSV</th><td><code>${escapeHtml(summary.outputs.ticketCsvPath)}</code></td></tr>
    <tr><th>정규화 JSON</th><td><code>${escapeHtml(summary.outputs.ticketJsonPath)}</code></td></tr>
    <tr><th>요약 JSON</th><td><code>${escapeHtml(summary.outputs.summaryJsonPath)}</code></td></tr>
  </tbody></table>
  <h2>샘플</h2>
  ${exampleTable(summary.comparison.examples)}
</main>
</body>
</html>`;
  writeFileSync(filePath, html);
}

function metric(label, value, className = "") {
  return `<div class="metric"><div class="label">${escapeHtml(label)}</div><div class="value ${className}">${escapeHtml(value)}</div></div>`;
}

function objectTable(obj) {
  const rows = Object.entries(obj || {}).sort((a, b) => Number(b[1]) - Number(a[1]));
  if (!rows.length) return "<p>없음</p>";
  return `<table><thead><tr><th>항목</th><th>건수</th></tr></thead><tbody>${rows
    .map(([key, value]) => `<tr><td>${escapeHtml(key)}</td><td>${Number(value).toLocaleString("ko-KR")}</td></tr>`)
    .join("")}</tbody></table>`;
}

function exampleTable(rows) {
  if (!rows?.length) return "<p>없음</p>";
  return `<table><thead><tr><th>회원</th><th>회원ID</th><th>수강권</th><th>사용/결제</th></tr></thead><tbody>${rows
    .map(
      (row) => `<tr><td>${escapeHtml(row.memberName)}<br><code>${escapeHtml(row.memberPhone)}</code></td><td><code>${escapeHtml(row.memberId)}</code></td><td>${Number(row.ticketHistoryCount).toLocaleString("ko-KR")}개<br><span class="label">활성 ${Number(row.activeTicketCount).toLocaleString("ko-KR")}개</span></td><td>사용 ${Number(row.usageTotal).toLocaleString("ko-KR")}건<br>${Number(row.paidAmountTotal).toLocaleString("ko-KR")}원</td></tr>`,
    )
    .join("")}</tbody></table>`;
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

function kstDate(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
