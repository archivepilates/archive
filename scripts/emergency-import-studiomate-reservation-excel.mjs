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
const RESERVATION_EXPORT_ROOTS = [
  path.join(os.homedir(), "ArchiveIN/automation/downloads"),
  "/Users/archivepilates/Library/CloudStorage/GoogleDrive-home@archivepilates.com/내 드라이브/아카이브 정산/수업예약내역",
  "/Users/archivepilates/Library/CloudStorage/GoogleDrive-home@archivepilates.com/내 드라이브/아카이브 정산/수업예약내역",
];

const args = new Set(process.argv.slice(2));
const fileArg = valueArg("--file");
const apply = args.has("--apply");
const requireFile = args.has("--require-file");
const startDateArg = valueArg("--start-date");
const endDateArg = valueArg("--end-date");
const maxWrites = Number(valueArg("--max-writes") || process.env.ARCHIVEIN_EMERGENCY_MAX_WRITES || "10000");
const reportDir = path.join(os.homedir(), "ArchiveIN/automation/reports/excel-emergency-mode");

if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const sourceFile = fileArg || latestReservationExportPath();
if (!sourceFile) {
  const summary = {
    ok: false,
    mode: apply ? "apply" : "dry-run",
    source: "studiomate_reservation_excel_emergency",
    reason: "reservation Excel export not found",
    roots: RESERVATION_EXPORT_ROOTS,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (requireFile) process.exitCode = 2;
  process.exit();
}

const rows = readRows(sourceFile);
const parsedRows = rows.map(normalizeReservationRow).filter((row) => row.date && row.startTime && row.title);
const dateBounds = requestedDateBounds(parsedRows);
const [existingLectures, existingProfiles] = await Promise.all([
  loadExistingLectures(dateBounds.startDate, dateBounds.endDate),
  loadExistingProfiles(),
]);
const { lectures, bookings, skipped } = buildPlans(parsedRows, existingLectures, existingProfiles);
const staffDates = uniquePairs(lectures.map((lecture) => ({ staffId: lecture.staffId, date: lecture.date })));
const plannedWrites = lectures.length + bookings.length + staffDates.length + 1;

const summary = {
  ok: true,
  mode: apply ? "apply" : "dry-run",
  source: "studiomate_reservation_excel_emergency",
  sourceFile,
  studioId: STUDIO_ID,
  readRows: rows.length,
  parsedRows: parsedRows.length,
  dateRange: dateBounds,
  lectures: lectures.length,
  bookings: bookings.length,
  instructorViews: staffDates.length,
  skipped,
  maxWrites,
};

if (plannedWrites > maxWrites) {
  throw new Error(`Planned writes ${plannedWrites} exceeds --max-writes ${maxWrites}.`);
}

if (apply) {
  await applyPlans({ lectures, bookings });
  await rebuildInstructorViews(staffDates);
  await rebuildAttendanceSummaries(bookings, dateBounds.endDate);
  await db.collection("opsState").doc("studiomateReservationExcelEmergency").set(
    {
      active: true,
      sourceFile,
      studioId: STUDIO_ID,
      dateRange: dateBounds,
      importedRows: rows.length,
      importedLectures: lectures.length,
      importedBookings: bookings.length,
      skipped,
      updatedAt: admin.firestore.Timestamp.now(),
    },
    { merge: true },
  );
}

mkdirSync(reportDir, { recursive: true });
const reportPath = path.join(reportDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-reservation-${apply ? "apply" : "dry-run"}.json`);
writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ ...summary, reportPath }, null, 2));

function valueArg(name) {
  const prefix = `${name}=`;
  const inline = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function latestReservationExportPath() {
  const py = String.raw`
from pathlib import Path
import json
roots = ${JSON.stringify(RESERVATION_EXPORT_ROOTS)}
needles = ("예약", "수업", "reservation", "booking", "lecture")
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
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Failed to find reservation export");
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
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Failed to parse reservation export");
  return JSON.parse(result.stdout || "[]");
}

function normalizeReservationRow(row) {
  const date = normalizeDate(pick(row, ["수업일", "수업일자", "일자", "날짜", "예약일", "date", "lectureDate"]));
  const startTime = normalizeTime(pick(row, ["시작시간", "수업시작", "수업시작시간", "시간", "startTime", "start_at"]));
  const endTime = normalizeTime(pick(row, ["종료시간", "수업종료", "수업종료시간", "endTime", "end_at"]));
  const title = pick(row, ["수업명", "수업", "강의명", "상품명", "프로그램", "title", "lecture"]);
  const staffName = pick(row, ["강사", "담당강사", "강사명", "staff", "instructor"]) || "미지정";
  const roomName = pick(row, ["장소", "강의실", "룸", "room"]);
  const divisionName = pick(row, ["구분", "수업구분", "종류", "division", "type"]);
  const memberName = pick(row, ["회원명", "회원", "예약자", "이름", "name", "memberName"]);
  const memberPhone = normalizePhone(pick(row, ["전화번호", "휴대폰", "연락처", "핸드폰", "mobile", "phone"]));
  const capacity = nullableNumber(pick(row, ["정원", "수강정원", "capacity", "max"]));
  const bookingStatus = pick(row, ["예약상태", "상태", "예약구분", "status"]);
  const attendanceText = pick(row, ["출결", "출석", "출석상태", "출결상태", "attendance"]);
  const ticketName = pick(row, ["수강권명", "이용권", "회원권", "ticket"]);
  return {
    raw: row,
    date,
    startTime,
    endTime,
    title,
    staffName,
    staffId: staffIdFor(staffName),
    roomName,
    divisionName,
    lessonType: lessonType(title, divisionName),
    memberName,
    memberPhone,
    capacity,
    bookingStatus,
    appStatus: appStatus(bookingStatus),
    attendanceStatus: attendanceStatus(attendanceText || bookingStatus),
    ticketName,
    ticketRemainingCount: nullableNumber(pick(row, ["잔여횟수", "남은횟수", "remaining"])),
    ticketExpiresAt: parseTimestamp(pick(row, ["수강권종료일", "만료일", "expiresAt"])),
  };
}

function requestedDateBounds(parsedRows) {
  const dates = parsedRows.map((row) => row.date).filter(Boolean).sort();
  return {
    startDate: startDateArg || dates[0] || kstDate(new Date()),
    endDate: endDateArg || dates.at(-1) || startDateArg || kstDate(new Date()),
  };
}

async function loadExistingLectures(startDate, endDate) {
  const out = [];
  for (const date of dateRange(startDate, endDate)) {
    const snap = await db.collection("lectures").where("studioId", "==", STUDIO_ID).where("date", "==", date).get();
    out.push(...snap.docs.map((doc) => ({ id: doc.id, data: doc.data() })));
  }
  return out;
}

async function loadExistingProfiles() {
  const snap = await db.collection("memberProfiles").where("studioId", "==", STUDIO_ID).get();
  const byPhoneName = new Map();
  const byName = new Map();
  for (const doc of snap.docs) {
    const data = doc.data();
    const phone = normalizePhone(data.phone || "");
    const name = normalizeName(data.name || "");
    if (phone && name) byPhoneName.set(`${phone}|${name}`, { id: doc.id, data });
    if (name) {
      const list = byName.get(name) || [];
      list.push({ id: doc.id, data });
      byName.set(name, list);
    }
  }
  return { byPhoneName, byName };
}

function buildPlans(rows, existingLectures, existingProfiles) {
  const skipped = { rowsWithoutMember: 0, memberNoMatch: 0, memberAmbiguousName: 0 };
  const grouped = new Map();
  for (const row of rows) {
    const key = `${row.date}|${row.startTime}|${row.endTime}|${normalizeName(row.staffName)}|${normalizeName(row.title)}|${row.roomName}`;
    const group = grouped.get(key) || { row, bookings: [] };
    if (!row.memberName && !row.memberPhone) skipped.rowsWithoutMember += 1;
    else group.bookings.push(row);
    grouped.set(key, group);
  }
  const lectures = [];
  const bookings = [];
  for (const group of grouped.values()) {
    const base = group.row;
    const lectureId = matchedLectureId(base, existingLectures) || `excel_lecture_${hash(`${base.date}|${base.startTime}|${base.staffName}|${base.title}`).slice(0, 16)}`;
    const lectureBookings = [];
    for (const row of group.bookings) {
      const member = matchMember(row, existingProfiles);
      if (!member) {
        if (row.memberPhone) skipped.memberNoMatch += 1;
        else skipped.memberAmbiguousName += 1;
        continue;
      }
      const bookingId = pick(row.raw, ["예약ID", "예약번호", "bookingId", "id"]) || `excel_booking_${hash(`${lectureId}|${member.id}|${row.memberPhone}|${row.memberName}`).slice(0, 18)}`;
      const booking = {
        bookingId,
        lectureId,
        studioId: STUDIO_ID,
        memberId: member.id,
        memberName: row.memberName || member.data.name || "",
        memberPhone: row.memberPhone || normalizePhone(member.data.phone || ""),
        memberRegisteredAt: member.data.registeredAt || null,
        staffId: base.staffId,
        staffName: base.staffName,
        lectureDate: base.date,
        lectureStartAt: parseTimestamp(`${base.date} ${base.startTime}`),
        lectureEndAt: base.endTime ? parseTimestamp(`${base.date} ${base.endTime}`) : null,
        sourceStatus: row.bookingStatus || "",
        appStatus: row.appStatus,
        attendanceStatus: row.attendanceStatus,
        syncStatus: "synced",
        ticketName: row.ticketName || "",
        ticketRemainingCount: row.ticketRemainingCount,
        ticketExpiresAt: row.ticketExpiresAt,
        ticketExpiryLevel: ticketExpiryLevel(row.ticketExpiresAt),
        memberTagIds: [],
        lastMemoPreview: "",
        lastMemoAt: null,
        lastChangedBy: "excel_emergency",
        sourceHash: hash(row.raw),
        sourceUpdatedAt: null,
        syncedAt: admin.firestore.Timestamp.now(),
        updatedAt: admin.firestore.Timestamp.now(),
        emergencySource: "studiomate_reservation_excel",
        emergencySourceFile: sourceFile,
      };
      lectureBookings.push(booking);
      bookings.push(booking);
    }
    lectures.push({
      lectureId,
      studioId: STUDIO_ID,
      date: base.date,
      startAt: parseTimestamp(`${base.date} ${base.startTime}`),
      endAt: base.endTime ? parseTimestamp(`${base.date} ${base.endTime}`) : null,
      roomName: base.roomName,
      divisionName: base.divisionName,
      lessonType: base.lessonType,
      staffId: base.staffId,
      staffName: base.staffName,
      title: base.title,
      status: "open",
      capacity: base.capacity || Math.max(lectureBookings.length, 1),
      bookingCount: lectureBookings.filter((booking) => booking.appStatus === "reserved").length,
      waitCount: lectureBookings.filter((booking) => booking.appStatus === "wait").length,
      cancelCount: lectureBookings.filter((booking) => ["cancel", "wait_cancel"].includes(booking.appStatus)).length,
      sourceHash: hash({ base, bookingIds: lectureBookings.map((booking) => booking.bookingId).sort() }),
      sourceUpdatedAt: null,
      syncedAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
      emergencySource: "studiomate_reservation_excel",
      emergencySourceFile: sourceFile,
    });
  }
  return { lectures, bookings, skipped };
}

function matchedLectureId(row, existingLectures) {
  const targetStart = parseTimestamp(`${row.date} ${row.startTime}`)?.toMillis();
  const candidates = existingLectures.filter((item) => item.data.date === row.date);
  const exact = candidates.find((item) => {
    const lecture = item.data;
    return (
      Math.abs((lecture.startAt?.toMillis?.() || 0) - (targetStart || 0)) <= 60000 &&
      normalizeName(lecture.staffName || "") === normalizeName(row.staffName) &&
      normalizeName(lecture.title || "") === normalizeName(row.title)
    );
  });
  return exact?.data?.lectureId || exact?.id || "";
}

function matchMember(row, existingProfiles) {
  const name = normalizeName(row.memberName);
  if (row.memberPhone && name) {
    const exact = existingProfiles.byPhoneName.get(`${row.memberPhone}|${name}`);
    if (exact) return exact;
  }
  const byName = existingProfiles.byName.get(name) || [];
  return byName.length === 1 ? byName[0] : null;
}

async function applyPlans({ lectures, bookings }) {
  let batch = db.batch();
  let writes = 0;
  const commit = async () => {
    if (!writes) return;
    await batch.commit();
    batch = db.batch();
    writes = 0;
  };
  for (const lecture of lectures) {
    batch.set(db.collection("lectures").doc(lecture.lectureId), lecture, { merge: true });
    if (++writes >= 450) await commit();
  }
  for (const booking of bookings) {
    batch.set(db.collection("bookings").doc(booking.bookingId), booking, { merge: true });
    if (++writes >= 450) await commit();
  }
  await commit();
}

async function rebuildInstructorViews(staffDates) {
  for (const item of staffDates) {
    const [lecturesSnap, bookingsSnap] = await Promise.all([
      db.collection("lectures").where("studioId", "==", STUDIO_ID).where("staffId", "==", item.staffId).where("date", "==", item.date).get(),
      db.collection("bookings").where("studioId", "==", STUDIO_ID).where("staffId", "==", item.staffId).where("lectureDate", "==", item.date).get(),
    ]);
    const lectures = lecturesSnap.docs.map((doc) => doc.data()).filter((lecture) => lecture.status !== "deleted");
    const bookings = bookingsSnap.docs.map((doc) => doc.data());
    const byLecture = new Map();
    for (const booking of bookings) {
      const list = byLecture.get(booking.lectureId) || [];
      list.push(booking);
      byLecture.set(booking.lectureId, list);
    }
    const viewLectures = lectures
      .sort((a, b) => (a.startAt?.toMillis?.() || 0) - (b.startAt?.toMillis?.() || 0))
      .map((lecture) => {
        const lectureBookings = byLecture.get(lecture.lectureId) || [];
        return {
          lectureId: lecture.lectureId,
          timeText: lectureTimeText(lecture),
          startAt: lecture.startAt,
          endAt: lecture.endAt,
          title: lecture.title,
          roomName: lecture.roomName,
          divisionName: lecture.divisionName,
          lessonType: lecture.lessonType,
          capacity: lecture.capacity,
          bookingCount: lectureBookings.filter((booking) => booking.appStatus === "reserved").length,
          waitCount: lectureBookings.filter((booking) => booking.appStatus === "wait").length,
          uncheckedAttendanceCount: lectureBookings.filter((booking) => booking.appStatus === "reserved" && booking.attendanceStatus === "unchecked").length,
          bookings: lectureBookings.map((booking) => ({
            bookingId: booking.bookingId,
            memberId: booking.memberId,
            memberName: booking.memberName,
            memberPhone: booking.memberPhone,
            memberRegisteredAt: booking.memberRegisteredAt,
            appStatus: booking.appStatus,
            attendanceStatus: booking.attendanceStatus,
            syncStatus: booking.syncStatus,
            ticketName: booking.ticketName,
            ticketRemainingCount: booking.ticketRemainingCount,
            ticketExpiresAt: booking.ticketExpiresAt,
            ticketExpiryLevel: booking.ticketExpiryLevel,
            tags: [],
            lastMemoPreview: String(booking.lastMemoPreview || "").slice(0, 60),
            lastMemoAt: booking.lastMemoAt || null,
          })),
        };
      });
    const activeBookings = bookings.filter((booking) => booking.appStatus === "reserved");
    await db.collection("instructorViews").doc(`${item.staffId}_${item.date}`).set(
      {
        viewId: `${item.staffId}_${item.date}`,
        studioId: STUDIO_ID,
        staffId: item.staffId,
        date: item.date,
        summary: {
          totalLectures: lectures.length,
          totalBookings: activeBookings.length,
          uncheckedAttendanceCount: activeBookings.filter((booking) => booking.attendanceStatus === "unchecked").length,
          reservedCount: activeBookings.length,
          cancelCount: bookings.filter((booking) => ["cancel", "wait_cancel"].includes(booking.appStatus)).length,
          waitCount: bookings.filter((booking) => booking.appStatus === "wait").length,
        },
        lectures: viewLectures,
        updatedAt: admin.firestore.Timestamp.now(),
      },
      { merge: true },
    );
  }
}

async function rebuildAttendanceSummaries(bookings, endDate) {
  const periodStart = addDays(endDate, -29);
  const memberIds = [...new Set(bookings.map((booking) => booking.memberId).filter(Boolean))];
  for (const memberId of memberIds) {
    const snap = await db
      .collection("bookings")
      .where("studioId", "==", STUDIO_ID)
      .where("memberId", "==", memberId)
      .where("lectureDate", ">=", periodStart)
      .where("lectureDate", "<=", endDate)
      .get();
    const rows = snap.docs.map((doc) => doc.data());
    const totals = attendanceTotals(rows, endDate);
    await db.collection("attendanceSummaries").doc(`${memberId}_${endDate.replaceAll("-", "")}`).set(
      {
        summaryId: `${memberId}_${endDate.replaceAll("-", "")}`,
        studioId: STUDIO_ID,
        memberId,
        periodStart,
        periodEnd: endDate,
        ...totals,
        updatedAt: admin.firestore.Timestamp.now(),
      },
      { merge: true },
    );
  }
}

function attendanceTotals(bookings, endDate) {
  const actual = bookings.filter((booking) => booking.lectureDate <= endDate && booking.appStatus === "reserved");
  const attended = actual.filter((booking) => booking.attendanceStatus === "attended").length;
  const absent = actual.filter((booking) => ["absent", "late_cancel"].includes(booking.attendanceStatus)).length;
  return {
    attended,
    absent,
    cancel: bookings.filter((booking) => booking.appStatus === "cancel" && booking.attendanceStatus !== "late_cancel").length,
    waitCancel: bookings.filter((booking) => booking.appStatus === "wait_cancel").length,
    total: attended + absent,
  };
}

function pick(row, names) {
  const keys = Object.keys(row);
  for (const name of names) {
    const exact = keys.find((key) => normalizeHeader(key) === normalizeHeader(name));
    if (exact && cleanText(row[exact])) return cleanText(row[exact]);
  }
  for (const name of names) {
    const partial = keys.find((key) => normalizeHeader(key).includes(normalizeHeader(name)));
    if (partial && cleanText(row[partial])) return cleanText(row[partial]);
  }
  return "";
}

function appStatus(text) {
  const value = cleanText(text).toLowerCase();
  if (/대기.*취소|wait.*cancel/.test(value)) return "wait_cancel";
  if (/취소|cancel/.test(value)) return "cancel";
  if (/대기|wait/.test(value)) return "wait";
  if (/예약|출석|결석|완료|reserved|attend|absent|check/.test(value)) return "reserved";
  return "reserved";
}

function attendanceStatus(text) {
  const value = cleanText(text).toLowerCase();
  if (/노쇼|결석|absent|no.?show/.test(value)) return "absent";
  if (/당일.*취소|late/.test(value)) return "late_cancel";
  if (/출석|완료|attend|check.?in/.test(value)) return "attended";
  return "unchecked";
}

function lessonType(title, division) {
  const value = `${title} ${division}`;
  if (/프라이빗|개인|private|1:1/.test(value)) return "private";
  if (/듀엣|semi|세미/.test(value)) return "semi_private";
  if (/그룹|group|캐딜락|체어|리포머|바렐|척추|피로/.test(value)) return "group";
  return "unknown";
}

function staffIdFor(name) {
  return `excel_staff_${hash(normalizeName(name) || "unknown").slice(0, 12)}`;
}

function ticketExpiryLevel(timestamp) {
  if (!timestamp) return "unknown";
  const days = Math.round((timestamp.toMillis() - Date.now()) / 86400000);
  if (days < 0) return "expired";
  if (days <= 14) return "soon";
  return "normal";
}

function parseTimestamp(value) {
  const text = cleanText(value);
  if (!text) return null;
  const normalized = text.includes("T") ? text : text.replace(" ", "T");
  const date = new Date(`${normalized}${/[zZ]|[+-]\d\d:?\d\d$/.test(normalized) ? "" : "+09:00"}`);
  return Number.isNaN(date.getTime()) ? null : admin.firestore.Timestamp.fromDate(date);
}

function normalizeDate(value) {
  const text = cleanText(value).replace(/\./g, "-").replace(/\//g, "-");
  const match = text.match(/(20\d{2})-(\d{1,2})-(\d{1,2})/);
  if (!match) return "";
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function normalizeTime(value) {
  const text = cleanText(value);
  const match = text.match(/(\d{1,2}):(\d{2})/);
  if (!match) return "";
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function normalizePhone(value) {
  let digits = cleanText(value).replace(/\D+/g, "");
  if (digits.startsWith("82") && digits.length >= 11) digits = `0${digits.slice(2)}`;
  if (digits.length === 10 && digits.startsWith("10")) digits = `0${digits}`;
  return digits;
}

function nullableNumber(value) {
  const text = cleanText(value).replace(/,/g, "");
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function lectureTimeText(lecture) {
  const start = lecture.startAt?.toDate?.();
  const end = lecture.endAt?.toDate?.();
  if (!start) return "";
  return end ? `${hhmm(start)} - ${hhmm(end)}` : hhmm(start);
}

function hhmm(date) {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function kstDate(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function addDays(date, days) {
  const base = new Date(`${date}T00:00:00+09:00`);
  base.setDate(base.getDate() + days);
  return kstDate(base);
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

function uniquePairs(rows) {
  return [...new Map(rows.filter((row) => row.staffId && row.date).map((row) => [`${row.staffId}_${row.date}`, row])).values()];
}

function normalizeHeader(value) {
  return cleanText(value).replace(/\s+/g, "").toLowerCase();
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizeName(value) {
  return cleanText(value).replace(/\s+/g, "").toLowerCase();
}

function hash(value) {
  return createHash("sha256").update(typeof value === "string" ? value : stableStringify(value)).digest("hex");
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}
