#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "archive-pilates";
const NOTION_API_VERSION = "2022-06-28";
const DEFAULT_OUT_DIR = "artifacts/private-chart-session-repair";
const NOTION_SESSION_RECORDS_DATABASE_ID = "105b17685d914fbe915ef5b65146d993";

const apply = hasArg("--apply");
const since = valueArg("--since") || "2026-05-27";
const until = valueArg("--until") || todayKst();
const outDir = valueArg("--out-dir") || DEFAULT_OUT_DIR;
const requestIdFilter = valueArg("--request-id");
const memberIdFilter = valueArg("--member-id");
const writeNotion = apply && !hasArg("--skip-notion");
const notionToken = process.env.NOTION_TOKEN || "";
const runId = new Date().toISOString().replace(/[:.]/g, "-");

if (apply && writeNotion && !notionToken) {
  throw new Error("NOTION_TOKEN is required for --apply unless --skip-notion is set.");
}

if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const requests = await loadRequests();
const rows = [];
for (const request of requests) {
  const booking = await loadBooking(request.bookingId);
  const record = await loadRecord(request.requestId);
  if (!booking) {
    rows.push({
      requestId: request.requestId,
      memberName: request.memberName,
      lessonDate: request.lessonDate,
      status: "skipped",
      reason: "booking_not_found",
      current: Number(request.sessionNumber || 0),
      expected: null,
    });
    continue;
  }
  const expected = await nextSessionNumber(booking);
  const current = Number(request.sessionNumber || record?.sessionNumber || 0);
  const needsRepair = Boolean(expected && current !== expected);
  const result = {
    requestId: request.requestId,
    bookingId: request.bookingId,
    memberId: request.memberId,
    memberName: request.memberName,
    staffName: request.staffName,
    lessonDate: request.lessonDate,
    lessonStartAt: timestampMillisFromValue(request.lessonStartAt)
      ? new Date(timestampMillisFromValue(request.lessonStartAt)).toISOString()
      : "",
    current,
    expected,
    source: canonicalSessionNumberFromBooking(booking) ? "booking_session_order" : "ledger_usage_with_booking_supplement",
    needsRepair,
    recordPageId: record?.notionSync?.pageId || "",
    instructorPageId: record?.notionSync?.instructorPageId || "",
    applied: false,
    notion: "not_requested",
  };
  if (apply && needsRepair) {
    await applyRepair(request, record, expected);
    result.applied = true;
    if (writeNotion && record) {
      result.notion = await updateNotionPages({ request, record: { ...record, sessionNumber: expected }, from: current, to: expected });
    } else if (!writeNotion) {
      result.notion = "skipped";
    }
  }
  rows.push(result);
}

const summary = {
  ok: true,
  mode: apply ? "apply" : "dry-run",
  projectId: PROJECT_ID,
  since,
  until,
  requestId: requestIdFilter || "",
  memberId: memberIdFilter || "",
  checked: rows.length,
  needsRepair: rows.filter((row) => row.needsRepair).length,
  applied: rows.filter((row) => row.applied).length,
  generatedAt: new Date().toISOString(),
};

mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `${runId}-${apply ? "apply" : "dry-run"}.json`);
writeFileSync(outPath, JSON.stringify({ summary, rows }, null, 2));
console.log(JSON.stringify({ summary, outPath, repairs: rows.filter((row) => row.needsRepair) }, null, 2));

async function loadRequests() {
  let query = db.collection("privateLessonChartRequests");
  if (requestIdFilter) {
    const snap = await query.doc(requestIdFilter).get();
    return snap.exists ? [{ requestId: snap.id, ...(snap.data() || {}) }] : [];
  }
  query = query.where("lessonDate", ">=", since).where("lessonDate", "<=", until);
  const snap = await query.get();
  return snap.docs
    .map((doc) => ({ requestId: doc.id, ...(doc.data() || {}) }))
    .filter((item) => String(item.status || "") !== "cancelled")
    .filter((item) => !memberIdFilter || String(item.memberId || "") === memberIdFilter)
    .sort((a, b) => String(a.lessonDate || "").localeCompare(String(b.lessonDate || "")));
}

async function loadBooking(bookingId) {
  if (!bookingId) return null;
  const snap = await db.collection("bookings").doc(bookingId).get();
  return snap.exists ? { bookingId: snap.id, ...(snap.data() || {}) } : null;
}

async function loadRecord(requestId) {
  if (!requestId) return null;
  const snap = await db.collection("privateLessonChartRecords").doc(requestId).get();
  return snap.exists ? { recordId: snap.id, ...(snap.data() || {}) } : null;
}

async function applyRepair(request, record, expected) {
  const now = admin.firestore.Timestamp.now();
  const current = Number(request.sessionNumber || record?.sessionNumber || 0);
  const correction = {
    from: current || null,
    to: expected,
    reason: "privateSessionLedger/memberUsageEvents 이후 bookings 보강 기준 회차 재계산",
    correctedAt: now,
  };
  await Promise.all([
    db.collection("privateLessonChartRequests").doc(request.requestId).set(
      {
        sessionNumber: expected,
        sessionNumberCorrection: correction,
        updatedAt: now,
      },
      { merge: true },
    ),
    db.collection("privateLessonChartRecords").doc(request.requestId).set(
      {
        sessionNumber: expected,
        sessionNumberCorrection: correction,
        updatedAt: now,
      },
      { merge: true },
    ),
  ]);
}

async function updateNotionPages({ request, record, from, to }) {
  const results = [];
  const reportPageId = record?.notionSync?.pageId || "";
  const instructorPageId = record?.notionSync?.instructorPageId || "";
  const correctionText = `자동화 회차 보정: ${from || "-"}회차 -> ${to}회차. 기존 장부/이용내역 이후 예약을 이어 세는 기준으로 정리했습니다.`;
  if (reportPageId) {
    await appendNotionChildren(reportPageId, [callout(correctionText)]);
    results.push("record_page_appended");
  }
  if (instructorPageId) {
    await notionRequest(`pages/${instructorPageId}`, "PATCH", {
      properties: notionTitle(notionSessionTitle(record, request)),
    });
    await appendNotionChildren(instructorPageId, [callout(correctionText)]);
    results.push("instructor_page_updated");
  }
  if (!results.length) return "no_page";
  return results.join(",");
}

async function nextSessionNumber(booking) {
  if (!booking.memberId) return 1;
  const bookingSessionNumber = canonicalSessionNumberFromBooking(booking);
  if (bookingSessionNumber) return bookingSessionNumber;
  const ledgerNumber = await nextSessionNumberFromPrivateLedger(booking);
  const usageNumber = await nextSessionNumberFromUsageEvents(booking);
  const bookingNumber = await nextSessionNumberFromBookings(booking);
  const existingChartNumber = await nextSessionNumberFromExistingChartRequests(booking);
  return Math.max(ledgerNumber || 0, usageNumber || 0, bookingNumber || 0, existingChartNumber || 1);
}

async function nextSessionNumberFromBookings(booking) {
  const snap = await db.collection("bookings").where("memberId", "==", booking.memberId).get();
  const current = privateTimelineRowFromBooking(booking);
  return canonicalPrivateBookings(snap.docs.map((doc) => ({ bookingId: doc.id, ...(doc.data() || {}) })))
    .filter(isCountablePrivateHistoryBooking)
    .filter((item) => comparePrivateTimelineRows(privateTimelineRowFromBooking(item), current) < 0).length + 1;
}

async function nextSessionNumberFromPrivateLedger(booking) {
  const snap = await db.collection("privateSessionLedger").where("memberId", "==", booking.memberId).get();
  const rows = canonicalPrivateTimelineRows(
    snap.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
      .filter((item) => ["attended", "reserved"].includes(String(item.status || "")))
      .map((item) => ({
        id: String(item.ledgerId || item.id || ""),
        memberId: String(item.memberId || ""),
        staffId: "",
        staffName: String(item.staffName || ""),
        startsAt: timestampMillisFromValue(item.startsAt),
        date: dateFromAnyValue(item.startsAt),
        title: "",
        ticketName: String(item.ticketName || ""),
        sessionNumber: positiveNumber(item.cumulativePrivateRound),
        sourcePriority: 1,
      })),
  );
  return nextSessionNumberFromTimeline(booking, rows);
}

async function nextSessionNumberFromUsageEvents(booking) {
  const snap = await db.collection("memberUsageEvents").where("memberId", "==", booking.memberId).get();
  const rows = canonicalPrivateTimelineRows(
    snap.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
      .filter((item) => ["private", "semi_private"].includes(String(item.lessonType || "")))
      .filter((item) => ["attended", "reserved"].includes(String(item.usageStatus || "")))
      .map((item) => ({
        id: String(item.usageEventId || item.id || ""),
        memberId: String(item.memberId || ""),
        staffId: "",
        staffName: String(item.staffName || ""),
        startsAt: timestampMillisFromValue(item.startsAt),
        date: dateFromAnyValue(item.startsAt),
        title: String(item.title || ""),
        ticketName: String(item.ticketName || ""),
        sessionNumber: null,
        sourcePriority: 1,
      })),
  );
  return nextSessionNumberFromTimeline(booking, rows);
}

async function nextSessionNumberFromExistingChartRequests(booking) {
  const snap = await db.collection("privateLessonChartRequests").where("memberId", "==", booking.memberId).get();
  const rows = canonicalPrivateTimelineRows(
    snap.docs
      .map((doc) => ({ requestId: doc.id, ...(doc.data() || {}) }))
      .filter((item) => String(item.status || "") !== "cancelled")
      .map((item) => ({
        id: String(item.requestId || item.bookingId || ""),
        memberId: String(item.memberId || ""),
        staffId: String(item.staffId || ""),
        staffName: String(item.staffName || ""),
        startsAt: timestampMillisFromValue(item.lessonStartAt),
        date: String(item.lessonDate || dateFromAnyValue(item.lessonStartAt) || ""),
        title: "",
        ticketName: "",
        sessionNumber: positiveNumber(item.sessionNumber),
        sourcePriority: bookingSourcePriority(String(item.bookingId || "")),
      })),
  );
  return nextSessionNumberFromTimeline(booking, rows);
}

async function nextSessionNumberFromTimeline(booking, rows) {
  if (!rows.length) return null;
  const current = privateTimelineRowFromBooking(booking);
  const exact = rows.find((row) => privateTimelineOccurrenceKey(row) === privateTimelineOccurrenceKey(current));
  if (exact?.sessionNumber) return exact.sessionNumber;
  const beforeRows = rows.filter((row) => comparePrivateTimelineRows(row, current) < 0);
  if (!beforeRows.length) return 1;
  const lastSource = beforeRows.reduce((latest, row) =>
    comparePrivateTimelineRows(row, latest) > 0 ? row : latest,
  );
  const baseNumber = Math.max(...beforeRows.map((row) => row.sessionNumber || 0), beforeRows.length);
  const supplement = await supplementalPrivateBookingsAfterTimeline(booking, current, lastSource, rows);
  return baseNumber + supplement.length + 1;
}

async function supplementalPrivateBookingsAfterTimeline(booking, current, lastSource, sourceRows) {
  if (!booking.memberId) return [];
  const boundary = timelineOrderValue(lastSource);
  const sourceKeys = new Set(sourceRows.map(privateTimelineOccurrenceKey));
  const currentKey = privateTimelineOccurrenceKey(current);
  const snap = await db.collection("bookings").where("memberId", "==", booking.memberId).get();
  return canonicalPrivateBookings(snap.docs.map((doc) => ({ bookingId: doc.id, ...(doc.data() || {}) })))
    .filter(isCountablePrivateHistoryBooking)
    .filter((item) => {
      const row = privateTimelineRowFromBooking(item);
      const order = timelineOrderValue(row);
      if (!order || order <= boundary) return false;
      if (comparePrivateTimelineRows(row, current) >= 0) return false;
      const key = privateTimelineOccurrenceKey(row);
      if (key === currentKey || sourceKeys.has(key)) return false;
      return true;
    });
}

function privateTimelineRowFromBooking(booking) {
  return {
    id: String(booking.bookingId || ""),
    memberId: String(booking.memberId || ""),
    staffId: String(booking.staffId || ""),
    staffName: String(booking.staffName || ""),
    startsAt: timestampMillisFromValue(booking.lectureStartAt),
    date: String(booking.lectureDate || dateFromAnyValue(booking.lectureStartAt) || ""),
    title: "",
    ticketName: String(booking.ticketName || ""),
    sessionNumber: null,
    sourcePriority: bookingSourcePriority(String(booking.bookingId || "")),
  };
}

function canonicalPrivateTimelineRows(rows) {
  const grouped = new Map();
  for (const row of rows) {
    if (!row.memberId || (!row.startsAt && !row.date)) continue;
    const key = privateTimelineOccurrenceKey(row);
    const current = grouped.get(key);
    if (!current || row.sourcePriority < current.sourcePriority || String(row.id || "") < String(current.id || "")) {
      grouped.set(key, row);
    }
  }
  return [...grouped.values()].sort(comparePrivateTimelineRows);
}

function privateTimelineOccurrenceKey(value) {
  return [
    value.memberId || "",
    staffOccurrenceIdentity(value.staffId, value.staffName),
    value.startsAt || value.date || "",
  ].join("|");
}

function comparePrivateTimelineRows(a, b) {
  return (
    timelineOrderValue(a) - timelineOrderValue(b) ||
    String(a.date || "").localeCompare(String(b.date || "")) ||
    String(a.id || "").localeCompare(String(b.id || ""))
  );
}

function timelineOrderValue(row) {
  if (row.startsAt) return row.startsAt;
  if (!row.date) return 0;
  const parsed = Date.parse(`${String(row.date).slice(0, 10)}T00:00:00+09:00`);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isPrivateBooking(booking) {
  if (booking.appStatus && booking.appStatus !== "reserved") return false;
  if (booking.lessonType === "group") return false;
  if (booking.lessonType === "private" || booking.lessonType === "semi_private") return true;
  const text = `${booking.ticketName || ""} ${booking.ticketClassType || ""} ${booking.ticketType || ""} ${booking.title || ""} ${booking.lectureTitle || ""}`;
  return /프라이빗|개인|1:1|PRIVATE|\bP\b/i.test(text);
}

function isCountablePrivateHistoryBooking(booking) {
  if (booking.sessionOrder?.counted === false) return false;
  if (["wait", "wait_cancel", "cancel"].includes(String(booking.appStatus || ""))) return false;
  if (["absent", "late_cancel"].includes(String(booking.attendanceStatus || ""))) return false;
  return true;
}

function canonicalSessionNumberFromBooking(booking) {
  if (!booking || booking.sessionOrder?.counted === false) return null;
  return positiveNumber(booking.sessionOrder?.privateCumulativeRound);
}

function canonicalPrivateBookings(bookings) {
  const grouped = new Map();
  for (const booking of bookings) {
    if (!isPrivateBooking(booking)) continue;
    const key = privateLessonOccurrenceKey(booking);
    const current = grouped.get(key);
    if (!current || preferCanonicalBookingLike(booking.bookingId, current.bookingId)) grouped.set(key, booking);
  }
  return [...grouped.values()].sort(
    (a, b) => timestampMillisFromValue(a.lectureStartAt) - timestampMillisFromValue(b.lectureStartAt),
  );
}

function privateLessonOccurrenceKey(value) {
  const start = timestampMillisFromValue(value.lectureStartAt) || value.lectureDate || "";
  return [
    value.memberId || normalizeKoreanName(value.memberName || ""),
    staffOccurrenceIdentity(value.staffId, value.staffName),
    start,
  ].join("|");
}

function preferCanonicalBookingLike(nextBookingId, currentBookingId) {
  const nextPriority = bookingSourcePriority(nextBookingId);
  const currentPriority = bookingSourcePriority(currentBookingId);
  if (nextPriority !== currentPriority) return nextPriority < currentPriority;
  return String(nextBookingId || "") < String(currentBookingId || "");
}

function bookingSourcePriority(bookingId) {
  const id = String(bookingId || "");
  if (id.startsWith("usage_booking_")) return 1;
  if (id.startsWith("excel_booking_")) return 2;
  if (id.startsWith("excel_") || id.startsWith("usage_")) return 3;
  return 0;
}

function timestampMillisFromValue(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (typeof value === "number") return value;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateFromAnyValue(value) {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  const millis = timestampMillisFromValue(value);
  return millis ? new Date(millis).toISOString().slice(0, 10) : "";
}

function positiveNumber(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function staffOccurrenceIdentity(staffId, staffName) {
  return normalizeKoreanName(staffName || "") || String(staffId || "");
}

function normalizeKoreanName(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/님$/g, "")
    .replace(/\d+$/g, "")
    .trim();
}

function notionSessionTitle(record, request) {
  return `${lessonTitleDate(request)} · ${record.memberName} ${record.sessionNumber}회차(${privateLessonChartStageLabel(record, request)})`;
}

function privateLessonChartStageLabel(record, request) {
  if (String(request?.status || "") === "cancelled" || String(record?.sessionStatus || "") === "cancelled") return "취소";
  if (record?.publicReportSentAt || record?.publicReportApproval?.sentAt || String(record?.publicReportApproval?.status || "") === "sent") {
    return "리포트 발송완료";
  }
  if (isPrivateLessonReportGenerated(record)) return "리포트 생성완료";
  if (record?.postSubmittedAt) return "수업 후 설문완료";
  if (record?.preSubmittedAt || String(request?.preSurveyStatus || "") === "submitted") return "수업 전 설문완료";
  return "수업 전 설문대기";
}

function isPrivateLessonReportGenerated(record) {
  if (!record?.postSubmittedAt) return false;
  if (!["draft_created", "approved", "published"].includes(String(record.gptStatus || ""))) return false;
  return Boolean(record.publicReportUrl || record.publicReportCanonicalUrl);
}

function lessonTitleDate(request) {
  const millis = timestampMillisFromValue(request.lessonStartAt);
  if (!millis) return String(request.lessonDate || "").replaceAll("-", ".");
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(millis));
  const value = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}.${value("month")}.${value("day")} ${value("hour")}:${value("minute")}`;
}

async function appendNotionChildren(pageId, children) {
  await notionRequest(`blocks/${pageId}/children`, "PATCH", { children });
}

async function notionRequest(path, method, body) {
  const response = await fetch(`https://api.notion.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${notionToken}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_API_VERSION,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`Notion API ${path} failed ${response.status}: ${parsed.message || text}`);
  return parsed;
}

function notionTitle(value) {
  return { title: [{ text: { content: String(value || "").slice(0, 2000) } }] };
}

function callout(text) {
  return {
    object: "block",
    type: "callout",
    callout: {
      icon: { type: "emoji", emoji: "📎" },
      color: "gray_background",
      rich_text: [{ type: "text", text: { content: String(text || "").slice(0, 2000) } }],
    },
  };
}

function todayKst() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function valueArg(name) {
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1] || "";
  const prefix = `${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : "";
}

function hasArg(name) {
  return process.argv.includes(name);
}
