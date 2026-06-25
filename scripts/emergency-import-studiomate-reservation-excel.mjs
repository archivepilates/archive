#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { qualityIssuesFromSummary, recordDataQualityIssues, recordSourceImport } from "./lib/archive-core-ops-logging.mjs";
import { cleanupImportedSourceFiles } from "./lib/imported-source-retention.mjs";

const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "archive-pilates";
const STUDIO_ID = process.env.STUDIOMATE_STUDIO_ID || process.env.MANAGER_STUDIO_ID || "5330";
const PYTHON =
  process.env.ARCHIVEIN_PYTHON ||
  "/Users/archivepilates/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";
const RESERVATION_EXPORT_ROOTS = [
  path.join(os.homedir(), "ArchiveIN/emergency/downloads"),
  path.join(os.homedir(), "ArchiveIN/automation/downloads"),
  "/Users/archivepilates/Library/CloudStorage/GoogleDrive-home@archivepilates.com/내 드라이브/아카이브 정산/수업예약내역",
  "/Users/archivepilates/Library/CloudStorage/GoogleDrive-home@archivepilates.com/내 드라이브/아카이브 정산/수업예약내역",
];
const FALLBACK_STAFF_BY_NAME = new Map(
  [
    ["배민진", "1983525"],
    ["정은영", "2222464"],
    ["이초림", "2849322"],
  ].map(([name, staffId]) => [normalizeName(name), { staffId, name }]),
);

const args = new Set(process.argv.slice(2));
const fileArg = valueArg("--file");
const apply = args.has("--apply");
const requireFile = args.has("--require-file");
const keepSourceFile = args.has("--keep-source-file");
const startDateArg = valueArg("--start-date");
const endDateArg = valueArg("--end-date");
const missingPolicy = valueArg("--missing-policy") || "mark";
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
const [existingLectures, existingProfiles, existingStaffs] = await Promise.all([
  loadExistingLectures(dateBounds.startDate, dateBounds.endDate),
  loadExistingProfiles(),
  loadExistingStaffs(),
]);
const { lectures, bookings, reservationOnlyProfiles, skipped } = buildPlans(parsedRows, existingLectures, existingProfiles, existingStaffs);
const staleCandidates = await findStaleBookingsMissingFromLatestImport(dateBounds, parsedRows, bookings);
const staleBookings = staleCandidates.filter((item) => missingPolicy !== "report-only" || item.data?.reconcileStatus !== "missing_from_latest_reservation_import");
const staffDates = uniquePairs(lectures.map((lecture) => ({ staffId: lecture.staffId, date: lecture.date })));
const plannedWrites = lectures.length + bookings.length + reservationOnlyProfiles.length + staleBookings.length + staffDates.length + 1;
const staleCandidateBreakdown = countBy(staleCandidates, (item) => item.data?.reconcileStatus || item.data?.sourceStatus || "unknown");
const staleBreakdown = countBy(staleBookings, (item) => item.data?.reconcileStatus || item.data?.sourceStatus || "unknown");

const summary = {
  ok: true,
  mode: apply ? "apply" : "dry-run",
  source: "studiomate_reservation_excel_emergency",
  snapshotPolicy: "bookings_single_source_reconcile_import_range",
  sourceFile,
  studioId: STUDIO_ID,
  readRows: rows.length,
  parsedRows: parsedRows.length,
  dateRange: dateBounds,
  lectures: lectures.length,
  bookings: bookings.length,
  reservationOnlyProfiles: reservationOnlyProfiles.length,
  staleCandidates: staleCandidates.length,
  staleCandidateBreakdown,
  staleBookings: staleBookings.length,
  staleBreakdown,
  missingPolicy,
  instructorViews: staffDates.length,
  skipped,
  maxWrites,
};

if (plannedWrites > maxWrites) {
  throw new Error(`Planned writes ${plannedWrites} exceeds --max-writes ${maxWrites}.`);
}

if (apply) {
  await applyPlans({ lectures, bookings, reservationOnlyProfiles, staleBookings });
  await rebuildInstructorViews(staffDates);
  await rebuildAttendanceSummaries(bookings, dateBounds.endDate);
  await db.collection("opsState").doc("studiomateReservationExcelEmergency").set(
    {
      active: true,
      sourceFile,
      studioId: STUDIO_ID,
      dateRange: dateBounds,
      snapshotPolicy: "bookings_single_source_reconcile_import_range",
      importedRows: rows.length,
      importedLectures: lectures.length,
      importedBookings: bookings.length,
      importedReservationOnlyProfiles: reservationOnlyProfiles.length,
      staleBookings: staleBookings.length,
      skipped,
      updatedAt: admin.firestore.Timestamp.now(),
    },
    { merge: true },
  );
}

mkdirSync(reportDir, { recursive: true });
const reportPath = path.join(reportDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-reservation-${apply ? "apply" : "dry-run"}.json`);
writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`);
const { importId } = await recordSourceImport(db, {
  sourceKind: "studiomate_reservation_excel",
  sourceFilePath: sourceFile,
  mode: summary.mode,
  status: apply ? "applied" : "dry_run",
  rowCount: summary.readRows,
  normalizedRows: summary.parsedRows,
  appliedRows: apply ? summary.bookings : 0,
  skippedRows: Object.values(summary.skipped || {}).reduce((sum, value) => sum + Number(value || 0), 0),
  notes: [
    `dateRange=${summary.dateRange?.startDate || ""}~${summary.dateRange?.endDate || ""}`,
    `lectures=${summary.lectures}`,
    `bookings=${summary.bookings}`,
    `reservationOnlyProfiles=${summary.reservationOnlyProfiles}`,
    `staleCandidates=${summary.staleCandidates}`,
    `staleBookings=${summary.staleBookings}`,
    `supersededBookings=${summary.staleBreakdown?.superseded_by_latest_reservation_import || 0}`,
    `missingCandidates=${summary.staleCandidateBreakdown?.missing_from_latest_reservation_import || 0}`,
    `missingPolicy=${summary.missingPolicy}`,
    `snapshotPolicy=${summary.snapshotPolicy}`,
  ],
});
await recordDataQualityIssues(db, qualityIssuesFromSummary(summary, importId));
summary.sourceFileRetention = await cleanupImportedSourceFiles({
  apply,
  db,
  importId,
  kind: "bookings",
  paths: [sourceFile],
  keep: keepSourceFile,
});
writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`);

console.log(JSON.stringify({ ...summary, reportPath, sourceImportId: importId }, null, 2));

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
needles = ("예약", "예약내역", "reservation", "booking")
excluded = ("매출", "sales", "lesson-sales", "ticket-sales", "/sales/")
files = []
for root in roots:
    p = Path(root).expanduser()
    if not p.exists():
        continue
    for item in p.rglob("*"):
        name = item.name.lower()
        full = str(item).lower()
        if (
            item.is_file()
            and item.suffix.lower() in {".xlsx", ".xls", ".csv"}
            and not item.name.startswith("~$")
            and any(n in name for n in needles)
            and not any(n in name or n in full for n in excluded)
        ):
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
  const memberPhone = normalizePhone(pick(row, ["전화번호", "휴대폰번호", "휴대폰", "연락처", "핸드폰", "mobile", "phone"]));
  const capacity = nullableNumber(pickExact(row, ["정원", "수업정원", "예약정원", "수강정원", "capacity"]));
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
  const byPhone = new Map();
  const byName = new Map();
  for (const doc of snap.docs) {
    const data = doc.data();
    const phone = normalizePhone(data.phone || "");
    const name = normalizeName(data.name || "");
    if (phone && name) byPhoneName.set(`${phone}|${name}`, { id: doc.id, data });
    if (phone) {
      const list = byPhone.get(phone) || [];
      list.push({ id: doc.id, data });
      byPhone.set(phone, list);
    }
    if (name) {
      const list = byName.get(name) || [];
      list.push({ id: doc.id, data });
      byName.set(name, list);
    }
  }
  return { byPhoneName, byPhone, byName };
}

async function loadExistingStaffs() {
  const snap = await db.collection("staffs").where("studioId", "==", STUDIO_ID).where("active", "==", true).get();
  const byName = new Map();
  for (const doc of snap.docs) {
    const data = doc.data();
    const name = normalizeName(data.name || "");
    if (name) byName.set(name, { staffId: data.staffId || doc.id, name: data.name || "" });
  }
  return { byName };
}

function buildPlans(rows, existingLectures, existingProfiles, existingStaffs) {
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
  const reservationOnlyProfiles = new Map();
  for (const group of grouped.values()) {
    const base = group.row;
    const matchedLecture = matchedLectureDoc(base, existingLectures);
    const matchedStaff = existingStaffs.byName.get(normalizeName(base.staffName)) || FALLBACK_STAFF_BY_NAME.get(normalizeName(base.staffName));
    const lectureId = matchedLecture?.data?.lectureId || matchedLecture?.id || `excel_lecture_${hash(`${base.date}|${base.startTime}|${base.staffName}|${base.title}`).slice(0, 16)}`;
    const staffId = matchedStaff?.staffId || matchedLecture?.data?.staffId || base.staffId;
    const staffName = matchedStaff?.name || matchedLecture?.data?.staffName || base.staffName;
    const lectureBookings = [];
    for (const row of group.bookings) {
      const member = matchMember(row, existingProfiles);
      if (!member) {
        if (row.memberPhone) skipped.memberNoMatch += 1;
        else skipped.memberAmbiguousName += 1;
        continue;
      }
      if (member.reservationOnlyProfile) mergeReservationOnlyProfile(reservationOnlyProfiles, member, row);
      const sourceBookingId = pick(row.raw, ["예약ID", "예약번호", "bookingId", "id"]);
      const canonicalBookingKey = buildCanonicalBookingKey({
        date: base.date,
        startTime: base.startTime,
        memberId: member.id,
        memberPhone: row.memberPhone || normalizePhone(member.data.phone || ""),
        memberName: row.memberName || member.data.name || "",
        staffId,
        staffName,
        title: base.title,
        lessonType: base.lessonType,
      });
      const bookingId = sourceBookingId || `excel_booking_${hash(canonicalBookingKey).slice(0, 18)}`;
      const booking = {
        bookingId,
        archiveBookingId: canonicalBookingKey,
        canonicalBookingKey,
        sourceBookingId,
        sourcePriority: sourceBookingId ? 1 : 3,
        lectureId,
        studioId: STUDIO_ID,
        memberId: member.id,
        memberName: row.memberName || member.data.name || "",
        memberPhone: row.memberPhone || normalizePhone(member.data.phone || ""),
        memberRegisteredAt: member.data.registeredAt || null,
        staffId,
        staffName,
        lectureDate: base.date,
        lectureTitle: base.title,
        lectureStartAt: parseTimestamp(`${base.date} ${base.startTime}`),
        lectureEndAt: base.endTime ? parseTimestamp(`${base.date} ${base.endTime}`) : null,
        lessonType: base.lessonType,
        sourceStatus: row.bookingStatus || "",
        appStatus: row.appStatus,
        attendanceStatus: row.attendanceStatus,
        syncStatus: "synced",
        ticketName: row.ticketName || "",
        ticketClassType: matchedActiveTicketClassType(row, member.data),
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
    const activeBookingCount = lectureBookings.filter((booking) => booking.appStatus === "reserved").length;
    lectures.push({
      lectureId,
      studioId: STUDIO_ID,
      date: base.date,
      startAt: parseTimestamp(`${base.date} ${base.startTime}`),
      endAt: base.endTime ? parseTimestamp(`${base.date} ${base.endTime}`) : null,
      roomName: base.roomName,
      divisionName: base.divisionName,
      lessonType: base.lessonType,
      staffId,
      staffName,
      title: base.title,
      status: "open",
      capacity: base.capacity || (base.lessonType === "group" ? null : Math.max(activeBookingCount, 1)),
      bookingCount: activeBookingCount,
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
  return { lectures, bookings, reservationOnlyProfiles: [...reservationOnlyProfiles.values()], skipped };
}

async function findStaleBookingsMissingFromLatestImport(dateBounds, parsedRows, plannedBookings) {
  if (!dateBounds.startDate || !dateBounds.endDate || !parsedRows.length) return [];
  const importedBookingIds = new Set(plannedBookings.map((booking) => booking.bookingId).filter(Boolean));
  const importedByCanonicalKey = new Map(plannedBookings.map((booking) => [booking.canonicalBookingKey, booking]).filter(([key]) => key));
  const importedByPresenceKey = new Map(
    plannedBookings.map((booking) => [reservationPresenceKey(booking), booking]).filter(([key]) => key),
  );
  const stale = [];
  for (const date of dateRange(dateBounds.startDate, dateBounds.endDate)) {
    const snap = await db
      .collection("bookings")
      .where("studioId", "==", STUDIO_ID)
      .where("lectureDate", "==", date)
      .get();
    for (const doc of snap.docs) {
      const booking = doc.data();
      const bookingId = String(booking.bookingId || doc.id || "");
      if (!bookingId || importedBookingIds.has(bookingId)) continue;
      if (!["reserved", "wait"].includes(String(booking.appStatus || "reserved"))) continue;
      const now = admin.firestore.Timestamp.now();
      const canonicalBookingKey = booking.canonicalBookingKey || existingCanonicalBookingKey(booking);
      const replacement = importedByCanonicalKey.get(canonicalBookingKey) || importedByPresenceKey.get(reservationPresenceKey(booking));
      if (replacement) {
        stale.push({
          id: doc.id,
          data: {
            appStatus: "superseded",
            sourceStatus: "superseded_by_latest_reservation_import",
            reconcileStatus: "superseded_by_latest_reservation_import",
            supersededByBookingId: replacement.bookingId,
            canonicalBookingKey: canonicalBookingKey || replacement.canonicalBookingKey,
            archiveBookingId: canonicalBookingKey || replacement.canonicalBookingKey,
            syncStatus: "synced",
            sessionOrder: {
              ...(booking.sessionOrder || {}),
              counted: false,
              privateCumulativeRound: null,
              cumulativeRound: null,
              excludedReason: "superseded_by_latest_reservation_import",
              computedFrom: "studiomate_reservation_excel",
              computedAt: now,
            },
            sessionOrderCorrection: {
              fromPrivateCumulativeRound: booking.sessionOrder?.privateCumulativeRound || null,
              toPrivateCumulativeRound: null,
              fromCounted: booking.sessionOrder?.counted ?? null,
              toCounted: false,
              reason: "duplicate booking superseded by latest reservation import",
              correctedAt: now,
            },
            staleSourceFile: sourceFile,
            staleMarkedAt: now,
            lastChangedBy: "excel_emergency_duplicate_reservation_reconcile",
            updatedAt: now,
          },
        });
        continue;
      }
      stale.push({
        id: doc.id,
        data: {
          appStatus: "cancel",
          sourceStatus: "missing_from_latest_reservation_import",
          reconcileStatus: "missing_from_latest_reservation_import",
          syncStatus: "synced",
          sessionOrder: {
            ...(booking.sessionOrder || {}),
            counted: false,
            excludedReason: "missing_from_latest_reservation_import",
            computedFrom: "studiomate_reservation_excel",
            computedAt: now,
          },
          sessionOrderCorrection: {
            fromPrivateCumulativeRound: booking.sessionOrder?.privateCumulativeRound || null,
            toPrivateCumulativeRound: booking.sessionOrder?.privateCumulativeRound || null,
            fromCounted: booking.sessionOrder?.counted ?? null,
            toCounted: false,
            reason: "latest reservation import no longer contains this booking",
            correctedAt: now,
          },
          staleSourceFile: sourceFile,
          staleMarkedAt: now,
          lastChangedBy: "excel_emergency_missing_reservation_reconcile",
          updatedAt: now,
        },
      });
    }
  }
  return stale;
}

function matchedLectureDoc(row, existingLectures) {
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
  if (exact) return exact;
  return candidates.find((item) => {
    const lecture = item.data;
    return (
      Math.abs((lecture.startAt?.toMillis?.() || 0) - (targetStart || 0)) <= 60000 &&
      normalizeName(lecture.title || "") === normalizeName(row.title)
    );
  }) || null;
}

function matchMember(row, existingProfiles) {
  const name = normalizeName(row.memberName);
  if (row.memberPhone) {
    const phoneMatches = existingProfiles.byPhone.get(row.memberPhone) || [];
    if (phoneMatches.length === 1) return phoneMatches[0];
    if (phoneMatches.length > 1) return bestPhoneMatch(phoneMatches, name);
    return reservationOnlyMember(row);
  }
  const byName = existingProfiles.byName.get(name) || [];
  return byName.length === 1 ? byName[0] : null;
}

function reservationOnlyMember(row) {
  const memberId = `reservation_phone_${hash({ studioId: STUDIO_ID, phone: row.memberPhone }).slice(0, 18)}`;
  const now = admin.firestore.Timestamp.now();
  return {
    id: memberId,
    reservationOnlyProfile: true,
    data: {
      memberId,
      studioId: STUDIO_ID,
      name: row.memberName || "",
      phone: row.memberPhone,
      phoneLast4: row.memberPhone.slice(-4),
      status: "reservation_only",
      profileKind: "reservation_only",
      memberProfileQuality: "reservation_only",
      externalActionEligible: false,
      activeTickets: [],
      source: "studiomate_reservation_excel",
      sourcePolicy: "booking_history_reference_only",
      sourceWarnings: ["no_studiomate_member_profile_match_by_phone"],
      firstSeenLectureDate: row.date || "",
      lastSeenLectureDate: row.date || "",
      aliasNames: row.memberName ? [row.memberName] : [],
      createdAt: now,
      updatedAt: now,
    },
  };
}

function mergeReservationOnlyProfile(map, member, row) {
  const current = map.get(member.id) || member.data || {};
  const names = new Set([...(Array.isArray(current.aliasNames) ? current.aliasNames : []), row.memberName].filter(Boolean));
  map.set(member.id, {
    ...current,
    name: current.name || row.memberName || "",
    phone: row.memberPhone || current.phone || "",
    phoneLast4: (row.memberPhone || current.phone || "").slice(-4),
    firstSeenLectureDate:
      current.firstSeenLectureDate && row.date
        ? [current.firstSeenLectureDate, row.date].sort()[0]
        : current.firstSeenLectureDate || row.date || "",
    lastSeenLectureDate:
      current.lastSeenLectureDate && row.date
        ? [current.lastSeenLectureDate, row.date].sort().at(-1)
        : current.lastSeenLectureDate || row.date || "",
    aliasNames: [...names].slice(0, 20),
    updatedAt: admin.firestore.Timestamp.now(),
  });
}

function bestPhoneMatch(matches, normalizedName) {
  const exactNameMatches = normalizedName
    ? matches.filter((item) => normalizeName(item.data?.name || "") === normalizedName)
    : [];
  const candidates = exactNameMatches.length ? exactNameMatches : matches;
  return [...candidates].sort(compareMemberProfilePriority)[0] || null;
}

function compareMemberProfilePriority(a, b) {
  return memberProfilePriority(a) - memberProfilePriority(b) || String(a.id).localeCompare(String(b.id));
}

function memberProfilePriority(item) {
  const data = item?.data || {};
  const id = String(item?.id || data.memberId || "");
  let score = 0;
  if (id.startsWith("excel_") || id.startsWith("consultation_excel_")) score += 100;
  if (!data.memberId && !data.studiomateMemberId) score += 20;
  if (Array.isArray(data.activeTickets) && data.activeTickets.length) score -= 10;
  if (String(data.status || "").includes("퇴") || String(data.status || "").toLowerCase().includes("inactive")) score += 20;
  return score;
}

async function applyPlans({ lectures, bookings, reservationOnlyProfiles, staleBookings }) {
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
  for (const profile of reservationOnlyProfiles) {
    batch.set(db.collection("memberProfiles").doc(profile.memberId), profile, { merge: true });
    if (++writes >= 450) await commit();
  }
  for (const booking of bookings) {
    batch.set(db.collection("bookings").doc(booking.bookingId), booking, { merge: true });
    if (++writes >= 450) await commit();
  }
  for (const booking of staleBookings) {
    batch.set(db.collection("bookings").doc(booking.id), booking.data, { merge: true });
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
    const lectures = lecturesSnap.docs
      .map((doc) => doc.data())
      .filter((lecture) => lecture.status !== "deleted" && lecture.emergencySourceFile === sourceFile);
    const lectureIds = new Set(lectures.map((lecture) => lecture.lectureId).filter(Boolean));
    const bookings = bookingsSnap.docs
      .map((doc) => doc.data())
      .filter((booking) => lectureIds.has(booking.lectureId) && booking.emergencySourceFile === sourceFile);
    const staffName =
      lectures.map((lecture) => cleanText(lecture.staffName)).find(Boolean) ||
      bookings.map((booking) => cleanText(booking.staffName)).find(Boolean) ||
      "";
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
          staffName: lecture.staffName,
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
            lessonType: booking.lessonType,
            ticketClassType: booking.ticketClassType,
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
        staffName,
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

function pickExact(row, names) {
  const keys = Object.keys(row);
  for (const name of names) {
    const exact = keys.find((key) => normalizeHeader(key) === normalizeHeader(name));
    if (exact && cleanText(row[exact])) return cleanText(row[exact]);
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

function matchedActiveTicketClassType(row, memberProfile) {
  const tickets = Array.isArray(memberProfile?.activeTickets) ? memberProfile.activeTickets : [];
  if (!tickets.length) return "";
  const ticketName = normalizeName(row.ticketName || "");
  const exact = tickets.find((ticket) => ticketName && normalizeName(ticket.name || "") === ticketName);
  if (exact?.classType) return cleanText(exact.classType);
  const partial = tickets.find((ticket) => {
    const name = normalizeName(ticket.name || "");
    return ticketName && name && (name.includes(ticketName) || ticketName.includes(name));
  });
  if (partial?.classType) return cleanText(partial.classType);
  if (tickets.length === 1 && tickets[0]?.classType) return cleanText(tickets[0].classType);
  return "";
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
  let text = cleanText(value);
  if (/^\d+\.0+$/.test(text)) text = text.replace(/\.0+$/, "");
  if (/^\d+(?:\.\d+)?e\+?\d+$/i.test(text)) {
    const parsed = Number(text);
    if (Number.isFinite(parsed)) text = String(Math.trunc(parsed));
  }
  let digits = text.replace(/\D+/g, "");
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
  return String(value ?? "").normalize("NFC").trim();
}

function normalizeName(value) {
  return cleanText(value).replace(/\s+/g, "").toLowerCase();
}

function reservationPresenceKey(value) {
  const date = String(value.date || value.lectureDate || "").slice(0, 10);
  const start =
    String(value.startTime || "") ||
    (value.lectureStartAt?.toDate?.()
      ? hhmm(value.lectureStartAt.toDate())
      : value.lectureStartAt?.toMillis?.()
        ? hhmm(value.lectureStartAt.toDate())
        : "");
  const memberPhone = normalizePhone(value.memberPhone || value.phone || "");
  const memberName = normalizeName(value.memberName || value.name || "");
  const staffName = normalizeName(value.staffName || value.staff || "");
  return [date, start, staffName, memberPhone || memberName].join("|");
}

function buildCanonicalBookingKey(input) {
  return `ab_${hash({
    studioId: STUDIO_ID,
    date: String(input.date || "").slice(0, 10),
    startTime: normalizeTime(input.startTime || ""),
    memberId: cleanText(input.memberId || ""),
    memberPhone: normalizePhone(input.memberPhone || ""),
    memberName: normalizeName(input.memberName || ""),
    staffId: cleanText(input.staffId || ""),
    staffName: normalizeName(input.staffName || ""),
    title: normalizeName(input.title || ""),
    lessonType: cleanText(input.lessonType || ""),
  }).slice(0, 24)}`;
}

function existingCanonicalBookingKey(booking) {
  const startTime =
    String(booking.startTime || "") ||
    (booking.lectureStartAt?.toDate?.()
      ? hhmm(booking.lectureStartAt.toDate())
      : booking.lectureStartAt?.toMillis?.()
        ? hhmm(booking.lectureStartAt.toDate())
        : "");
  return buildCanonicalBookingKey({
    date: booking.lectureDate,
    startTime,
    memberId: booking.memberId,
    memberPhone: booking.memberPhone,
    memberName: booking.memberName,
    staffId: booking.staffId,
    staffName: booking.staffName,
    title: booking.lectureTitle || booking.title || booking.lessonName || "",
    lessonType: booking.lessonType,
  });
}

function countBy(items, fn) {
  const out = {};
  for (const item of items) {
    const key = fn(item);
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function hash(value) {
  return createHash("sha256").update(typeof value === "string" ? value : stableStringify(value)).digest("hex");
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}
