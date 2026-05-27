#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "archive-pilates";
const STUDIO_ID = process.env.STUDIOMATE_STUDIO_ID || process.env.MANAGER_STUDIO_ID || "5330";
const DEFAULT_USAGE_JSON =
  "/Users/archivepilates/ArchiveIN/emergency/archive/member-usage/2026-05-27/member-usage-normalized-2026-05-27.json";
const DEFAULT_OUT_DIR = path.join(os.homedir(), "ArchiveIN/emergency/archive/member-usage/2026-05-27/apply-plan");

const usageJsonPath = valueArg("--usage-json") || DEFAULT_USAGE_JSON;
const outDir = valueArg("--out-dir") || DEFAULT_OUT_DIR;
const apply = hasArg("--apply");
const confirmed = hasArg("--confirm-studiomate-usage-backfill");
const limit = nullableInt(valueArg("--limit"));
const memberIdFilter = valueArg("--member-id");
const nameFilter = normalizeName(valueArg("--name"));
const phoneFilter = normalizePhone(valueArg("--phone"));
const startDateFilter = valueArg("--start-date");
const endDateFilter = valueArg("--end-date");
const includeFuture = hasArg("--include-future");
const all = hasArg("--all");
const maxWrites = Number(valueArg("--max-writes") || process.env.ARCHIVEIN_USAGE_BACKFILL_MAX_WRITES || "200000");
const runId = new Date().toISOString().replace(/[:.]/g, "-");

if (apply && !confirmed) {
  throw new Error("Refusing to write without --confirm-studiomate-usage-backfill.");
}
if (apply && !all && !memberIdFilter && !nameFilter && !phoneFilter && !startDateFilter && !endDateFilter && limit == null) {
  throw new Error("Refusing to apply without a scope filter. Add --all only after reviewing a full dry-run.");
}
if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const usageRows = JSON.parse(await fsRead(usageJsonPath));
const selectedRows = filterRows(usageRows);
const selectedDateRange = selectedRowsDateRange(selectedRows);
if (!selectedRows.length) throw new Error("No usage rows selected.");
if (apply && !endDateFilter && !includeFuture) {
  throw new Error("Refusing to apply without --end-date. Add --include-future only when future reservations are intended.");
}
if (apply && selectedDateRange.endDate > todayKst() && !includeFuture) {
  throw new Error(`Refusing to apply future rows through ${selectedDateRange.endDate}. Add --end-date or --include-future.`);
}

const [profiles, staffMap, existingBookings, existingLectures] = await Promise.all([
  loadProfiles(),
  loadStaffMap(),
  loadExistingBookings(selectedDateRange.startDate, selectedDateRange.endDate),
  loadExistingLectures(selectedDateRange.startDate, selectedDateRange.endDate),
]);

const plan = buildPlan(selectedRows, profiles, staffMap, existingBookings, existingLectures);
const summary = {
  ok: true,
  mode: apply ? "apply" : "dry-run",
  source: "studiomate_member_usage_backfill_apply",
  usageJsonPath,
  studioId: STUDIO_ID,
  generatedAt: new Date().toISOString(),
  filters: {
    limit,
    memberId: memberIdFilter,
    name: valueArg("--name"),
    phone: phoneFilter,
    startDate: startDateFilter,
    endDate: endDateFilter,
    includeFuture,
    all,
  },
  selectedRows: selectedRows.length,
  dateRange: selectedDateRange,
  existingBookingsRead: existingBookings.length,
  existingLecturesRead: existingLectures.length,
  profileCount: profiles.total,
  staffCount: staffMap.size,
  plan: {
    bookingCreates: plan.bookingCreates.length,
    bookingUpdates: plan.bookingUpdates.length,
    lectureCreates: plan.lectureCreates.length,
    unchanged: plan.unchanged,
    skipped: plan.skipped,
    affectedMembers: plan.affectedMemberIds.length,
    plannedWrites: plan.plannedWrites,
  },
  outputs: {
    summaryPath: path.join(outDir, `${runId}-usage-backfill-${apply ? "apply" : "dry-run"}-summary.json`),
    planPath: path.join(outDir, `${runId}-usage-backfill-plan.json`),
    backupPath: path.join(outDir, `${runId}-usage-backfill-existing-backup.jsonl`),
  },
};

if (plan.plannedWrites > maxWrites) {
  throw new Error(`Planned writes ${plan.plannedWrites} exceeds --max-writes ${maxWrites}.`);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(summary.outputs.planPath, `${JSON.stringify(redactPlanForReview(plan), null, 2)}\n`);
writeFileSync(summary.outputs.summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

if (apply) {
  await writeBackup(plan, summary.outputs.backupPath);
  await applyPlan(plan);
  await rebuildAttendanceSummariesForPlan(plan, selectedDateRange.endDate > todayKst() ? todayKst() : selectedDateRange.endDate);
}

console.log(JSON.stringify(summary, null, 2));

async function fsRead(filePath) {
  const { readFile } = await import("node:fs/promises");
  return readFile(filePath, "utf8");
}

function filterRows(rows) {
  let out = rows
    .filter((row) => row?.memberId && row?.lectureDate && row?.startTime)
    .filter((row) => !memberIdFilter || String(row.memberId) === memberIdFilter)
    .filter((row) => !nameFilter || normalizeName(row.memberName) === nameFilter)
    .filter((row) => !phoneFilter || normalizePhone(row.memberPhone) === phoneFilter)
    .filter((row) => !startDateFilter || row.lectureDate >= startDateFilter)
    .filter((row) => !endDateFilter || row.lectureDate <= endDateFilter);
  if (limit != null) out = out.slice(0, limit);
  return out;
}

async function loadProfiles() {
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

async function loadStaffMap() {
  const snap = await db.collection("staffs").where("studioId", "==", STUDIO_ID).get();
  const map = new Map();
  for (const doc of snap.docs) {
    const data = doc.data();
    const names = [data.name, ...(Array.isArray(data.visibleLectureStaffNames) ? data.visibleLectureStaffNames : [])];
    for (const name of names) {
      const key = normalizeName(name);
      if (key && !map.has(key)) map.set(key, { staffId: data.staffId || doc.id, name: data.name || name });
    }
  }
  return map;
}

async function loadExistingBookings(startDate, endDate) {
  const out = [];
  for (const date of dateRange(startDate, endDate)) {
    const snap = await db.collection("bookings").where("studioId", "==", STUDIO_ID).where("lectureDate", "==", date).get();
    out.push(...snap.docs.map((doc) => ({ id: doc.id, data: doc.data(), ref: doc.ref })));
  }
  return out;
}

async function loadExistingLectures(startDate, endDate) {
  const out = [];
  for (const date of dateRange(startDate, endDate)) {
    const snap = await db.collection("lectures").where("studioId", "==", STUDIO_ID).where("date", "==", date).get();
    out.push(...snap.docs.map((doc) => ({ id: doc.id, data: doc.data(), ref: doc.ref })));
  }
  return out;
}

function buildPlan(rows, profiles, staffMap, existingBookings, existingLectures) {
  const existingByRowKey = new Map();
  const existingByStrongKey = new Map();
  const existingByLooseKey = new Map();
  for (const booking of existingBookings) {
    const data = booking.data;
    const rowKey = String(data.usageBackfillRowKey || data.sourceHash || "").replace(/^usage_/, "");
    if (rowKey) existingByRowKey.set(rowKey, booking);
    const startTime = timestampTime(data.lectureStartAt);
    const strong = [data.memberId || "", data.lectureDate || "", startTime, normalizeName(data.title || data.lectureTitle || ""), normalizeName(data.staffName || "")].join("|");
    const loose = [data.memberId || "", data.lectureDate || "", startTime].join("|");
    pushMap(existingByStrongKey, strong, booking);
    pushMap(existingByLooseKey, loose, booking);
  }
  const lectureByStrongKey = new Map();
  const lectureByLooseKey = new Map();
  for (const lecture of existingLectures) {
    const data = lecture.data;
    const startTime = timestampTime(data.startAt);
    const strong = lectureStrongKey({
      lectureDate: data.date || "",
      startTime,
      title: data.title || "",
      staffName: data.staffName || "",
    });
    const loose = lectureLooseKey({
      lectureDate: data.date || "",
      startTime,
      staffName: data.staffName || "",
    });
    pushMap(lectureByStrongKey, strong, lecture);
    pushMap(lectureByLooseKey, loose, lecture);
  }

  const bookingCreates = [];
  const bookingUpdates = [];
  const lectureCreatesById = new Map();
  const skipped = { memberNoMatch: 0, invalidStatus: 0 };
  let unchanged = 0;

  for (const row of rows) {
    const member = matchMember(row, profiles);
    if (!member) {
      skipped.memberNoMatch += 1;
      continue;
    }
    if (!["reserved", "cancel", "wait", "wait_cancel"].includes(row.appStatus)) {
      skipped.invalidStatus += 1;
      continue;
    }
    const staff = staffMap.get(normalizeName(row.staffName)) || {
      staffId: `usage_staff_${hash(row.staffName || "unknown").slice(0, 12)}`,
      name: row.staffName || "미지정",
    };
    const strongKey = [member.id, row.lectureDate, row.startTime, normalizeName(row.title), normalizeName(row.staffName)].join("|");
    const looseKey = [member.id, row.lectureDate, row.startTime].join("|");
    const existing = existingByRowKey.get(row.rowKey || "") || legacyMatch(row, existingByStrongKey, strongKey) || legacyMatch(row, existingByLooseKey, looseKey) || null;
    const existingLecture = existing?.data?.lectureId
      ? null
      : findExistingLecture(row, lectureByStrongKey, lectureByLooseKey);
    const lectureId =
      existing?.data?.lectureId ||
      existingLecture?.id ||
      `usage_lecture_${hash([row.lectureDate, row.startTime, row.endTime, row.title, row.staffName, row.roomName].join("|")).slice(0, 18)}`;
    const booking = buildBookingDoc(row, member, staff, lectureId, existing?.id);
    if (existing) {
      if (bookingStatusesEqual(existing.data, booking) && existing.data.ticketName === booking.ticketName) {
        unchanged += 1;
      } else {
        bookingUpdates.push({ id: existing.id, before: existing.data, after: { ...existing.data, ...booking, bookingId: existing.id, lectureId: existing.data.lectureId || lectureId } });
      }
    } else {
      bookingCreates.push({ id: booking.bookingId, after: booking });
      if (!existingLecture) {
        const current = lectureCreatesById.get(lectureId) || { after: buildLectureDoc(row, staff, lectureId), bookingCount: 0, waitCount: 0, cancelCount: 0 };
        if (row.appStatus === "wait") current.waitCount += 1;
        else if (row.appStatus === "cancel" || row.appStatus === "wait_cancel") current.cancelCount += 1;
        else current.bookingCount += 1;
        current.after.capacity = Math.max(Number(current.after.capacity) || 0, Number(row.capacity) || 0, current.bookingCount);
        current.after.bookingCount = current.bookingCount;
        current.after.waitCount = current.waitCount;
        current.after.cancelCount = current.cancelCount;
        lectureCreatesById.set(lectureId, current);
      }
    }
  }

  const lectureCreates = [...lectureCreatesById.values()].map((item) => ({ id: item.after.lectureId, after: item.after }));
  return {
    bookingCreates,
    bookingUpdates,
    lectureCreates,
    unchanged,
    skipped,
    affectedMemberIds: affectedMembers(bookingCreates, bookingUpdates),
    plannedWrites: bookingCreates.length + bookingUpdates.length + lectureCreates.length,
  };
}

function buildBookingDoc(row, member, staff, lectureId, existingId = "") {
  const bookingId = existingId || `usage_booking_${row.rowKey || hash(JSON.stringify(row)).slice(0, 20)}`;
  return {
    bookingId,
    lectureId,
    studioId: STUDIO_ID,
    memberId: member.id,
    memberName: row.memberName || member.data.name || "",
    memberPhone: normalizePhone(row.memberPhone || member.data.phone || ""),
    memberRegisteredAt: member.data.registeredAt || null,
    staffId: staff.staffId,
    staffName: staff.name || row.staffName || "",
    lectureDate: row.lectureDate,
    lectureStartAt: timestampFromDateTime(row.lectureDate, row.startTime),
    lectureEndAt: row.endTime ? timestampFromDateTime(row.lectureDate, row.endTime) : null,
    lessonType: lessonType(row),
    sourceStatus: row.finalStatus || "",
    appStatus: row.appStatus,
    attendanceStatus: row.attendanceStatus,
    syncStatus: "synced",
    ticketName: row.ticketName || "",
    ticketClassType: ticketClassType(row.ticketName),
    ticketRemainingCount: null,
    ticketExpiresAt: null,
    ticketExpiryLevel: "unknown",
    memberTagIds: [],
    lastMemoPreview: "",
    lastMemoAt: null,
    lastChangedBy: "studiomate_usage_backfill",
    sourceHash: `usage_${row.rowKey || hash(JSON.stringify(row)).slice(0, 20)}`,
    sourceUpdatedAt: null,
    syncedAt: admin.firestore.Timestamp.now(),
    updatedAt: admin.firestore.Timestamp.now(),
    emergencySource: "studiomate_member_usage_excel",
    emergencySourceFile: row.sourceFile || usageJsonPath,
    usageBackfillRowKey: row.rowKey || "",
  };
}

function buildLectureDoc(row, staff, lectureId) {
  return {
    lectureId,
    studioId: STUDIO_ID,
    date: row.lectureDate,
    startAt: timestampFromDateTime(row.lectureDate, row.startTime),
    endAt: row.endTime ? timestampFromDateTime(row.lectureDate, row.endTime) : null,
    roomName: row.roomName || "",
    divisionName: row.capacity ? `${row.capacity}명` : "",
    lessonType: lessonType(row),
    staffId: staff.staffId,
    staffName: staff.name || row.staffName || "",
    title: row.title || "",
    status: "open",
    capacity: Number(row.capacity) || 0,
    bookingCount: 0,
    waitCount: 0,
    cancelCount: 0,
    sourceHash: `usage_lecture_${hash([row.lectureDate, row.startTime, row.title, row.staffName].join("|")).slice(0, 20)}`,
    sourceUpdatedAt: null,
    syncedAt: admin.firestore.Timestamp.now(),
    updatedAt: admin.firestore.Timestamp.now(),
    emergencySource: "studiomate_member_usage_excel",
  };
}

function findExistingLecture(row, lectureByStrongKey, lectureByLooseKey) {
  const strongMatches = lectureByStrongKey.get(lectureStrongKey(row)) || [];
  if (strongMatches.length === 1) return strongMatches[0];
  const looseMatches = lectureByLooseKey.get(lectureLooseKey(row)) || [];
  if (looseMatches.length === 1) return looseMatches[0];
  return null;
}

function legacyMatch(row, map, key) {
  const candidates = map.get(key) || [];
  if (!row.rowKey) return candidates[0] || null;
  return (
    candidates.find((booking) => {
      const data = booking.data || {};
      return !data.usageBackfillRowKey && !String(data.sourceHash || "").startsWith("usage_");
    }) || null
  );
}

function lectureStrongKey(row) {
  return [row.lectureDate || "", row.startTime || "", normalizeName(row.title || ""), normalizeName(row.staffName || "")].join("|");
}

function lectureLooseKey(row) {
  return [row.lectureDate || "", row.startTime || "", normalizeName(row.staffName || "")].join("|");
}

async function writeBackup(plan, backupPath) {
  const lines = [];
  for (const item of plan.bookingUpdates) {
    lines.push(JSON.stringify({ collection: "bookings", id: item.id, data: serializeFirestore(item.before) }));
  }
  writeFileSync(backupPath, `${lines.join("\n")}${lines.length ? "\n" : ""}`);
}

async function applyPlan(plan) {
  let batch = db.batch();
  let writes = 0;
  const commit = async () => {
    if (!writes) return;
    await batch.commit();
    batch = db.batch();
    writes = 0;
  };
  for (const item of plan.lectureCreates) {
    batch.set(db.collection("lectures").doc(item.id), item.after, { merge: true });
    if (++writes >= 450) await commit();
  }
  for (const item of plan.bookingCreates) {
    batch.set(db.collection("bookings").doc(item.id), item.after, { merge: true });
    if (++writes >= 450) await commit();
  }
  for (const item of plan.bookingUpdates) {
    batch.set(db.collection("bookings").doc(item.id), item.after, { merge: true });
    if (++writes >= 450) await commit();
  }
  await commit();
}

async function rebuildAttendanceSummariesForPlan(plan, endDate) {
  const memberIds = plan.affectedMemberIds;
  if (!memberIds.length) return;
  const periodStart = addDays(endDate, -29);
  const snaps = await Promise.all(
    memberIds.map((memberId) =>
      db
        .collection("bookings")
        .where("studioId", "==", STUDIO_ID)
        .where("memberId", "==", memberId)
        .where("lectureDate", ">=", periodStart)
        .where("lectureDate", "<=", endDate)
        .get(),
    ),
  );
  const batch = db.batch();
  snaps.forEach((snap, index) => {
    const memberId = memberIds[index];
    const bookings = snap.docs.map((doc) => ({ bookingId: doc.id, ...doc.data() }));
    const totals = attendanceTotals(bookings, endDate);
    batch.set(
      db.collection("attendanceSummaries").doc(`${memberId}_${endDate.replaceAll("-", "")}`),
      {
        summaryId: `${memberId}_${endDate.replaceAll("-", "")}`,
        studioId: STUDIO_ID,
        memberId,
        periodStart,
        periodEnd: endDate,
        attended: totals.attended,
        absent: totals.absent,
        cancel: totals.cancel,
        waitCancel: totals.waitCancel,
        total: totals.total,
        updatedAt: admin.firestore.Timestamp.now(),
      },
      { merge: true },
    );
  });
  await batch.commit();
}

function attendanceTotals(bookings, endDate) {
  const actual = actualAttendanceBookings(bookings, endDate);
  return {
    attended: actual.filter((booking) => booking.attendanceStatus === "attended").length,
    absent: actual.filter((booking) => booking.attendanceStatus === "absent" || booking.attendanceStatus === "late_cancel").length,
    cancel: bookings.filter((booking) => booking.appStatus === "cancel" && booking.attendanceStatus !== "late_cancel").length,
    waitCancel: bookings.filter((booking) => booking.appStatus === "wait_cancel").length,
    total: actual.length,
  };
}

function actualAttendanceBookings(bookings, endDate) {
  const endMs = new Date(`${endDate}T23:59:59.999+09:00`).getTime();
  const map = new Map();
  bookings
    .filter((booking) => booking.lectureDate && booking.lectureDate <= endDate)
    .filter((booking) => isPastBooking(booking, endMs))
    .filter(isActualAttendanceBooking)
    .forEach((booking) => {
      const key = attendanceKey(booking);
      const current = map.get(key);
      if (!current || bookingPriority(booking) > bookingPriority(current) || bookingUpdatedAt(booking) > bookingUpdatedAt(current)) {
        map.set(key, booking);
      }
    });
  return [...map.values()];
}

function isActualAttendanceBooking(booking) {
  if (booking.appStatus === "wait" || booking.appStatus === "wait_cancel") return false;
  if (booking.attendanceStatus === "attended") return booking.appStatus === "reserved";
  return booking.attendanceStatus === "absent" || booking.attendanceStatus === "late_cancel";
}

function isPastBooking(booking, endMs) {
  const bookingEnd = booking.lectureEndAt?.toMillis?.() || booking.lectureStartAt?.toMillis?.();
  if (bookingEnd) return bookingEnd <= endMs;
  if (!booking.lectureDate) return false;
  return new Date(`${booking.lectureDate}T23:59:59.999+09:00`).getTime() <= endMs;
}

function attendanceKey(booking) {
  const lectureKey =
    booking.lectureId ||
    `${booking.lectureDate}_${booking.lectureStartAt?.toMillis?.() || ""}_${booking.staffId || booking.staffName || ""}`;
  return `${booking.memberId || booking.memberName}_${lectureKey}`;
}

function bookingPriority(booking) {
  if (booking.attendanceStatus === "attended") return 4;
  if (booking.attendanceStatus === "absent") return 3;
  if (booking.attendanceStatus === "late_cancel") return 2;
  return 1;
}

function bookingUpdatedAt(booking) {
  return booking.updatedAt?.toMillis?.() || booking.sourceUpdatedAt?.toMillis?.() || booking.syncedAt?.toMillis?.() || 0;
}

function affectedMembers(bookingCreates, bookingUpdates) {
  return [
    ...new Set(
      [...bookingCreates.map((item) => item.after.memberId), ...bookingUpdates.map((item) => item.after.memberId)].filter(Boolean),
    ),
  ];
}

function redactPlanForReview(plan) {
  return {
    bookingCreates: plan.bookingCreates.slice(0, 100).map(reviewItem),
    bookingUpdates: plan.bookingUpdates.slice(0, 100).map((item) => ({
      id: item.id,
      before: reviewBooking(item.before),
      after: reviewBooking(item.after),
    })),
    lectureCreates: plan.lectureCreates.slice(0, 100).map((item) => ({
      id: item.id,
      date: item.after.date,
      time: timestampTime(item.after.startAt),
      title: item.after.title,
      staffName: item.after.staffName,
    })),
    truncated: {
      bookingCreates: Math.max(0, plan.bookingCreates.length - 100),
      bookingUpdates: Math.max(0, plan.bookingUpdates.length - 100),
      lectureCreates: Math.max(0, plan.lectureCreates.length - 100),
    },
  };
}

function reviewItem(item) {
  return { id: item.id, after: reviewBooking(item.after) };
}

function reviewBooking(row) {
  return {
    memberId: row.memberId,
    memberName: row.memberName,
    lectureDate: row.lectureDate,
    time: timestampTime(row.lectureStartAt),
    title: row.title || row.lectureTitle || "",
    staffName: row.staffName,
    appStatus: row.appStatus,
    attendanceStatus: row.attendanceStatus,
    ticketName: row.ticketName,
  };
}

function matchMember(row, profiles) {
  if (row.memberId && profiles.byId.has(String(row.memberId))) return profiles.byId.get(String(row.memberId));
  const key = `${normalizePhone(row.memberPhone)}|${normalizeName(row.memberName)}`;
  const exact = profiles.byPhoneName.get(key);
  if (exact) return exact;
  if (row.memberId) {
    return { id: String(row.memberId), data: { name: row.memberName || "", phone: row.memberPhone || "" } };
  }
  return null;
}

function lessonType(row) {
  const text = [row.title, row.ticketName, row.roomName].join(" ");
  if (/프라이빗|private|개인/i.test(text)) return "private";
  if (/듀엣|semi/i.test(text)) return "semi_private";
  return "group";
}

function ticketClassType(name) {
  if (/프라이빗|private|개인/i.test(name || "")) return "프라이빗";
  if (/상품|락커|양말|토삭스/i.test(name || "")) return "상품";
  return name ? "그룹" : "";
}

function bookingStatusesEqual(a, b) {
  return String(a.appStatus || "") === String(b.appStatus || "") && String(a.attendanceStatus || "") === String(b.attendanceStatus || "");
}

function timestampFromDateTime(date, time) {
  if (!date || !time) return null;
  const parsed = new Date(`${date}T${time}:00+09:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return admin.firestore.Timestamp.fromDate(parsed);
}

function timestampTime(value) {
  const date = value?.toDate?.();
  if (!date) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function selectedRowsDateRange(rows) {
  const dates = rows.map((row) => row.lectureDate).filter(Boolean).sort();
  return { startDate: dates[0] || "", endDate: dates.at(-1) || "" };
}

function dateRange(startDate, endDate) {
  const out = [];
  let current = startDate;
  while (current && current <= endDate) {
    out.push(current);
    current = addDays(current, 1);
  }
  return out;
}

function addDays(date, days) {
  const d = new Date(`${date}T00:00:00+09:00`);
  d.setDate(d.getDate() + days);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function todayKst() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function pushMap(map, key, value) {
  const list = map.get(key) || [];
  list.push(value);
  map.set(key, list);
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function normalizePhone(value) {
  let digits = String(value || "").replace(/\D+/g, "");
  if (digits.startsWith("82") && digits.length >= 11) digits = `0${digits.slice(2)}`;
  if (digits.length === 10 && digits.startsWith("10")) digits = `0${digits}`;
  return digits;
}

function normalizeName(value) {
  return String(value || "").normalize("NFC").replace(/\s+/g, "").toLowerCase();
}

function nullableInt(value) {
  if (value == null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : null;
}

function valueArg(name) {
  const prefix = `${name}=`;
  const inline = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function hasArg(name) {
  return process.argv.includes(name);
}

function serializeFirestore(value) {
  return JSON.parse(
    JSON.stringify(value, (_key, item) => {
      if (item && typeof item.toDate === "function") return { __timestamp: item.toDate().toISOString() };
      return item;
    }),
  );
}
