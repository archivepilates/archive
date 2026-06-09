#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";

const require = createRequire(import.meta.url);
const admin = require(resolveFirebaseAdmin());

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "archive-pilates";
const NOTION_API_VERSION = "2022-06-28";
const OUT_DIR =
  valueArg("--out-dir") || path.join(os.homedir(), "ArchiveIN/emergency/archive/private-chart-round-repair");

const apply = hasArg("--apply");
const all = hasArg("--all");
const since = valueArg("--since") || (all ? "" : "2026-05-27");
const until = valueArg("--until") || (all ? "" : todayKst());
const requestIdFilter = valueArg("--request-id");
const memberIdFilter = valueArg("--member-id");
const writeNotion = apply && !hasArg("--skip-notion");
const syncNotion = apply && hasArg("--sync-notion");
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
  const [record, booking] = await Promise.all([loadRecord(request.requestId), loadBooking(request.bookingId)]);
  const duplicate = booking ? await duplicateFallbackRequest(booking, request) : null;
  const expected = booking ? await expectedRoundForBooking(booking) : 0;
  const currentRequest = positiveNumber(request.sessionNumber) || 0;
  const currentRecord = positiveNumber(record?.sessionNumber) || 0;
  const current = currentRequest || currentRecord || 0;
  const needsRepair = !duplicate && Boolean(expected && (currentRequest !== expected || (currentRecord && currentRecord !== expected)));
  const correctionFrom = positiveNumber(
    record?.sessionNumberCorrection?.from || request.sessionNumberCorrection?.from,
  );
  const correctionTo = positiveNumber(record?.sessionNumberCorrection?.to || request.sessionNumberCorrection?.to);
  const needsNotionResync = Boolean(
    syncNotion &&
      !duplicate &&
      !needsRepair &&
      expected &&
      correctionFrom &&
      correctionFrom !== expected &&
      correctionTo === expected &&
      (record?.notionSync?.pageId || record?.notionSync?.instructorPageId),
  );
  const result = {
    requestId: request.requestId,
    bookingId: request.bookingId || "",
    memberId: request.memberId || "",
    memberName: request.memberName || "",
    staffName: request.staffName || "",
    lessonDate: request.lessonDate || "",
    currentRequest,
    currentRecord,
    expected,
    expectedSource: booking?.sessionOrder?.privateCumulativeRound ? "bookings.sessionOrder" : "bookings.recomputed",
    needsRepair,
    needsSupersede: Boolean(duplicate),
    needsNotionResync,
    duplicateOfRequestId: duplicate?.requestId || "",
    duplicateOfBookingId: duplicate?.bookingId || "",
    recordPageId: record?.notionSync?.pageId || "",
    instructorPageId: record?.notionSync?.instructorPageId || "",
    applied: false,
    notion: "not_requested",
    candidate: "not_requested",
    reason: "",
  };

  if (duplicate) {
    result.reason = "duplicate_fallback_request";
  } else if (needsNotionResync) {
    result.reason = "firestore_already_repaired_notion_resync";
  } else if (!booking) {
    result.reason = "booking_not_found";
  } else if (!expected) {
    result.reason = "expected_round_not_found";
  } else if (!needsRepair) {
    result.reason = "already_ok";
  }

  if (apply && duplicate) {
    await supersedeDuplicateFallback({ request, record, duplicate, expected, current });
    result.applied = true;
    result.candidate = await supersedePendingCandidate({ request, record, duplicate });
    if (writeNotion && record) {
      result.notion = await supersedeNotionPages({ request, record, duplicate, expected });
    } else if (!writeNotion) {
      result.notion = "skipped";
    }
  } else if (apply && needsRepair) {
    await applyFirestoreRepair({ request, record, expected, current });
    result.applied = true;
    result.candidate = await repairPendingReportCandidate({ request, record, expected });
    if (writeNotion && record) {
      result.notion = await repairNotionPages({ request, record, from: current, to: expected });
    } else if (!writeNotion) {
      result.notion = "skipped";
    }
  } else if (apply && needsNotionResync) {
    result.applied = true;
    result.notion = await repairNotionPages({ request, record, from: correctionFrom, to: expected });
    result.candidate = "not_changed";
  }
  rows.push(result);
}

const summary = {
  ok: true,
  mode: apply ? "apply" : "dry-run",
  projectId: PROJECT_ID,
  scope: requestIdFilter ? "request" : memberIdFilter ? "member" : all ? "all" : "date-range",
  since,
  until,
  requestId: requestIdFilter || "",
  memberId: memberIdFilter || "",
  checked: rows.length,
  needsRepair: rows.filter((row) => row.needsRepair).length,
  needsSupersede: rows.filter((row) => row.needsSupersede).length,
  needsNotionResync: rows.filter((row) => row.needsNotionResync).length,
  applied: rows.filter((row) => row.applied).length,
  notionUpdated: rows.filter((row) => String(row.notion || "").includes("updated")).length,
  generatedAt: new Date().toISOString(),
  byMember: groupCounts(rows.filter((row) => row.needsRepair || row.needsSupersede), "memberName"),
};

mkdirSync(OUT_DIR, { recursive: true });
const outPath = path.join(OUT_DIR, `${runId}-${apply ? "apply" : "dry-run"}.json`);
writeFileSync(outPath, `${JSON.stringify({ summary, rows }, null, 2)}\n`);
console.log(JSON.stringify({ summary, outPath, repairs: rows.filter((row) => row.needsRepair) }, null, 2));
await admin.app().delete();

async function loadRequests() {
  if (requestIdFilter) {
    const snap = await db.collection("privateLessonChartRequests").doc(requestIdFilter).get();
    return snap.exists ? [{ requestId: snap.id, ...(snap.data() || {}) }] : [];
  }
  let query = db.collection("privateLessonChartRequests");
  if (since) query = query.where("lessonDate", ">=", since);
  if (until) query = query.where("lessonDate", "<=", until);
  const snap = await query.get();
  return snap.docs
    .map((doc) => ({ requestId: doc.id, ...(doc.data() || {}) }))
    .filter((item) => String(item.status || "") !== "cancelled")
    .filter((item) => !memberIdFilter || String(item.memberId || "") === memberIdFilter)
    .sort((a, b) => {
      const dateCompare = String(a.lessonDate || "").localeCompare(String(b.lessonDate || ""));
      if (dateCompare) return dateCompare;
      return String(a.requestId || "").localeCompare(String(b.requestId || ""));
    });
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

async function expectedRoundForBooking(booking) {
  const cached = positiveNumber(booking.sessionOrder?.privateCumulativeRound);
  if (cached) return cached;
  if (booking.sessionOrder?.category === "private") {
    const generic = positiveNumber(booking.sessionOrder?.cumulativeRound);
    if (generic) return generic;
  }
  return recomputePrivateRoundForBooking(booking);
}

async function duplicateFallbackRequest(booking, request) {
  if (!isFallbackBookingId(booking.bookingId || request.bookingId)) return null;
  const canonical = await canonicalBookingForFallback(booking);
  if (!canonical?.bookingId) return null;
  const canonicalRequestId = `plc_${canonical.bookingId}`;
  if (canonicalRequestId === request.requestId) return null;
  const snap = await db.collection("privateLessonChartRequests").doc(canonicalRequestId).get();
  if (!snap.exists) return null;
  const canonicalRequest = snap.data() || {};
  if (String(canonicalRequest.status || "") === "cancelled") return null;
  return {
    requestId: canonicalRequestId,
    bookingId: canonical.bookingId,
  };
}

async function canonicalBookingForFallback(booking) {
  if (!booking.memberId) return null;
  const snap = await db.collection("bookings").where("memberId", "==", booking.memberId).get();
  const key = privateLessonOccurrenceKey(booking);
  return snap.docs
    .map((doc) => ({ bookingId: doc.id, ...(doc.data() || {}) }))
    .filter((item) => !isFallbackBookingId(item.bookingId))
    .filter((item) => privateLessonOccurrenceKey(item) === key)
    .sort((a, b) => bookingSourcePriority(a.bookingId) - bookingSourcePriority(b.bookingId))[0] || null;
}

async function recomputePrivateRoundForBooking(booking) {
  if (!booking.memberId) return 0;
  const snap = await db.collection("bookings").where("memberId", "==", booking.memberId).get();
  const canonical = canonicalPrivateBookings(snap.docs.map((doc) => ({ bookingId: doc.id, ...(doc.data() || {}) })));
  const currentKey = privateLessonOccurrenceKey(booking);
  const index = canonical.findIndex((item) => privateLessonOccurrenceKey(item) === currentKey);
  return index >= 0 ? index + 1 : 0;
}

async function supersedeDuplicateFallback({ request, record, duplicate, expected, current }) {
  const now = admin.firestore.Timestamp.now();
  const patch = {
    status: "cancelled",
    sessionNumber: expected || current || null,
    duplicateOfRequestId: duplicate.requestId,
    duplicateOfBookingId: duplicate.bookingId,
    supersededReason: "fallback Excel booking duplicated canonical StudioMate booking",
    sessionNumberCorrection: {
      from: current || null,
      to: expected || null,
      source: "canonical StudioMate booking",
      reason: "프라이빗 회차 보정 중 fallback 중복 요청 비활성화",
      correctedAt: now,
    },
    updatedAt: now,
  };
  await Promise.all([
    db.collection("privateLessonChartRequests").doc(request.requestId).set(patch, { merge: true }),
    db.collection("privateLessonChartRecords").doc(record?.recordId || request.requestId).set(
      {
        duplicateOfRequestId: duplicate.requestId,
        duplicateOfBookingId: duplicate.bookingId,
        sessionNumber: expected || current || null,
        sessionNumberCorrection: patch.sessionNumberCorrection,
        updatedAt: now,
      },
      { merge: true },
    ),
  ]);
}

async function applyFirestoreRepair({ request, record, expected, current }) {
  const now = admin.firestore.Timestamp.now();
  const correction = {
    from: current || null,
    to: expected,
    source: "bookings.sessionOrder.privateCumulativeRound",
    reason: "프라이빗 전체 회차 보정: 원본 이용내역 병합 후 bookings.sessionOrder 기준으로 정리",
    correctedAt: now,
  };
  const writes = [
    db.collection("privateLessonChartRequests").doc(request.requestId).set(
      {
        sessionNumber: expected,
        sessionNumberCorrection: correction,
        updatedAt: now,
      },
      { merge: true },
    ),
  ];
  if (record || request.requestId) {
    writes.push(
      db.collection("privateLessonChartRecords").doc(request.requestId).set(
        {
          sessionNumber: expected,
          sessionNumberCorrection: correction,
          updatedAt: now,
        },
        { merge: true },
      ),
    );
  }
  await Promise.all(writes);
}

async function supersedePendingCandidate({ request, record, duplicate }) {
  const candidateId = `private_lesson_report_${record?.recordId || request.requestId}`;
  const ref = db.collection("alimtalkCandidates").doc(candidateId);
  const snap = await ref.get();
  if (!snap.exists) return "no_candidate";
  const candidate = snap.data() || {};
  if (String(candidate.status || "") === "sent") return "sent_log_preserved";
  const now = admin.firestore.Timestamp.now();
  await ref.set(
    {
      status: "skipped",
      skipReason: `중복 fallback 요청 비활성화: ${duplicate.requestId}`,
      duplicateOfRequestId: duplicate.requestId,
      updatedAt: now,
    },
    { merge: true },
  );
  return "superseded";
}

async function repairPendingReportCandidate({ request, record, expected }) {
  const candidateId = `private_lesson_report_${record?.recordId || request.requestId}`;
  const ref = db.collection("alimtalkCandidates").doc(candidateId);
  const snap = await ref.get();
  if (!snap.exists) return "no_candidate";
  const candidate = snap.data() || {};
  if (String(candidate.status || "") === "sent") return "sent_log_preserved";
  const now = admin.firestore.Timestamp.now();
  await ref.set(
    {
      reason: `${request.memberName || record?.memberName || ""} ${expected}회차 회원 리포트 검수 완료`.trim(),
      payload: {
        ...(candidate.payload || {}),
        sessionNumberText: `${expected}회차`,
        sessionLabel: `${expected}회차`,
      },
      sessionNumberCorrection: {
        to: expected,
        sourceRequestId: request.requestId,
        correctedAt: now,
      },
      updatedAt: now,
    },
    { merge: true },
  );
  return "updated";
}

async function supersedeNotionPages({ request, record, duplicate, expected }) {
  const results = [];
  const title = `중복 비활성 · ${notionSessionTitle({ ...record, sessionNumber: expected || record.sessionNumber }, request)}`;
  const ids = [
    ["record_page", record?.notionSync?.pageId || ""],
    ["instructor_page", record?.notionSync?.instructorPageId || ""],
  ].filter(([, pageId]) => pageId);
  for (const [kind, pageId] of ids) {
    await notionPatch(`pages/${pageId}`, "PATCH", {
      properties: kind === "record_page"
        ? { Name: notionTitle(title), "Session Number": { number: expected || null } }
        : notionTitle(title),
    });
    await appendSupersedeNoteIfNeeded(pageId, { request, duplicate });
    results.push(`${kind}_updated`);
  }
  return results.length ? results.join(",") : "no_page";
}

async function repairNotionPages({ request, record, from, to }) {
  const results = [];
  const reportPageId = record?.notionSync?.pageId || "";
  const instructorPageId = record?.notionSync?.instructorPageId || "";
  const nextRecord = { ...record, sessionNumber: to };
  const title = notionSessionTitle(nextRecord, request);
  if (reportPageId) {
    await notionPatch(`pages/${reportPageId}`, "PATCH", {
      properties: {
        Name: notionTitle(title),
        "Session Number": { number: to },
      },
    });
    await replaceRoundTextInPage(reportPageId, from, to);
    await appendCorrectionNoteIfNeeded(reportPageId, { request, from, to });
    results.push("record_page_updated");
  }
  if (instructorPageId) {
    await notionPatch(`pages/${instructorPageId}`, "PATCH", {
      properties: notionTitle(title),
    });
    await replaceRoundTextInPage(instructorPageId, from, to);
    await appendCorrectionNoteIfNeeded(instructorPageId, { request, from, to });
    results.push("instructor_page_updated");
  }
  return results.length ? results.join(",") : "no_page";
}

async function appendSupersedeNoteIfNeeded(pageId, { request, duplicate }) {
  const marker = `중복 비활성 ID: ${request.requestId} -> ${duplicate.requestId}`;
  const blocks = await notionChildrenRecursive(pageId);
  const fullText = blocks.map(blockPlainText).join("\n");
  if (fullText.includes(marker)) return;
  await notionPatch(`blocks/${pageId}/children`, "PATCH", {
    children: [
      {
        object: "block",
        type: "callout",
        callout: {
          icon: { type: "emoji", emoji: "📎" },
          color: "gray_background",
          rich_text: [
            {
              type: "text",
              text: {
                content: `중복 요청 비활성화: 이 페이지는 fallback Excel booking에서 생성된 중복 자료입니다. 기준 요청은 ${duplicate.requestId}입니다. ${marker}`,
              },
            },
          ],
        },
      },
    ],
  });
}

async function replaceRoundTextInPage(pageId, from, to) {
  if (!from || from === to) return;
  const blocks = await notionChildrenRecursive(pageId);
  for (const block of blocks) {
    const type = block.type;
    const data = block[type];
    if (!data || !Array.isArray(data.rich_text)) continue;
    const nextRichText = replaceRichText(data.rich_text, `${from}회차`, `${to}회차`);
    if (!nextRichText.changed) continue;
    await notionPatch(`blocks/${block.id}`, "PATCH", {
      [type]: {
        rich_text: nextRichText.richText,
      },
    });
  }
}

function replaceRichText(richText, oldValue, newValue) {
  let changed = false;
  const next = richText.map((item) => {
    if (item.type !== "text") return item;
    const content = String(item.text?.content || "");
    if (!content.includes(oldValue)) return item;
    changed = true;
    return {
      ...item,
      text: {
        ...item.text,
        content: content.replaceAll(oldValue, newValue),
      },
      plain_text: String(item.plain_text || "").replaceAll(oldValue, newValue),
    };
  });
  return { changed, richText: next };
}

async function appendCorrectionNoteIfNeeded(pageId, { request, from, to }) {
  const marker = `보정 ID: ${request.requestId} / ${to}회차`;
  const blocks = await notionChildrenRecursive(pageId);
  const fullText = blocks.map(blockPlainText).join("\n");
  if (fullText.includes(marker)) return;
  await notionPatch(`blocks/${pageId}/children`, "PATCH", {
    children: [
      {
        object: "block",
        type: "callout",
        callout: {
          icon: { type: "emoji", emoji: "📎" },
          color: "gray_background",
          rich_text: [
            {
              type: "text",
              text: {
                content: `회차 보정 완료: ${from || "-"}회차에서 ${to}회차로 보정했습니다. ${marker}`,
              },
            },
          ],
        },
      },
    ],
  });
}

async function notionChildrenRecursive(blockId) {
  const output = [];
  const queue = [blockId];
  while (queue.length) {
    const current = queue.shift();
    const children = await notionChildren(current);
    output.push(...children);
    for (const child of children) {
      if (child.has_children) queue.push(child.id);
    }
  }
  return output;
}

async function notionChildren(blockId) {
  const children = [];
  let cursor = "";
  do {
    const query = cursor ? `?page_size=100&start_cursor=${encodeURIComponent(cursor)}` : "?page_size=100";
    const result = await notionPatch(`blocks/${blockId}/children${query}`, "GET");
    children.push(...(Array.isArray(result.results) ? result.results : []));
    cursor = result.has_more && result.next_cursor ? String(result.next_cursor) : "";
  } while (cursor);
  return children;
}

async function notionPatch(apiPath, method, body) {
  const response = await fetch(`https://api.notion.com/v1/${apiPath}`, {
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
  if (!response.ok) throw new Error(`Notion API ${apiPath} failed ${response.status}: ${parsed.message || text}`);
  return parsed;
}

function canonicalPrivateBookings(bookings) {
  const grouped = new Map();
  for (const booking of bookings) {
    if (!isPrivateBooking(booking) || !isCountableBooking(booking)) continue;
    const key = privateLessonOccurrenceKey(booking);
    const current = grouped.get(key);
    if (!current || preferCanonicalBookingLike(booking.bookingId, current.bookingId)) grouped.set(key, booking);
  }
  return [...grouped.values()].sort((a, b) => {
    const time = timestampMillisFromValue(a.lectureStartAt) - timestampMillisFromValue(b.lectureStartAt);
    if (time) return time;
    return String(a.bookingId || "").localeCompare(String(b.bookingId || ""));
  });
}

function isPrivateBooking(booking) {
  const lessonType = String(booking.lessonType || "").toLowerCase();
  if (lessonType === "private" || lessonType === "semi_private") return true;
  if (lessonType === "group") return false;
  const text = [booking.lessonType, booking.ticketClassType, booking.ticketName, booking.title, booking.lectureTitle, booking.roomName]
    .filter(Boolean)
    .join(" ");
  return /프라이빗|개인|1:1|private|듀엣|semi/i.test(text);
}

function isCountableBooking(booking) {
  if (["wait", "wait_cancel", "cancel"].includes(String(booking.appStatus || ""))) return false;
  return ["attended", "absent", "late_cancel", "unchecked"].includes(String(booking.attendanceStatus || ""));
}

function privateLessonOccurrenceKey(value) {
  const start = timestampMillisFromValue(value.lectureStartAt || value.lessonStartAt) || value.lectureDate || value.lessonDate || "";
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

function isFallbackBookingId(bookingId) {
  const id = String(bookingId || "");
  return id.startsWith("excel_booking_") || id.startsWith("excel_");
}

function notionSessionTitle(record, request) {
  const title = `${lessonTitleDate(request)} · ${record.memberName || request.memberName} ${record.sessionNumber}회차(자동화)`;
  const completionLabel = privateLessonReportCompletionLabel(record);
  return completionLabel ? `${title} · ${completionLabel}` : title;
}

function privateLessonReportGenerated(record) {
  return Boolean(record.publicReportUrl || record.publicReportCanonicalUrl) ||
    ["draft_created", "approved", "published"].includes(String(record.gptStatus || ""));
}

function privateLessonReportCompletionLabel(record) {
  if (!privateLessonReportGenerated(record)) return "";
  if (String(record.gptStatus || "") === "published" || String(record.publicReportApproval?.status || "") === "sent") {
    return "완료";
  }
  return "완료 미발송";
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

function notionTitle(value) {
  return { title: [{ text: { content: String(value || "").slice(0, 2000) } }] };
}

function blockPlainText(block) {
  const data = block?.[block.type] || {};
  const rich = Array.isArray(data.rich_text) ? data.rich_text : [];
  return rich.map((item) => item.plain_text || item.text?.content || "").join("");
}

function groupCounts(rows, key) {
  const result = {};
  for (const row of rows) {
    const value = String(row[key] || "unknown");
    result[value] = (result[value] || 0) + 1;
  }
  return result;
}

function timestampMillisFromValue(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (typeof value === "number") return value;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
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

function resolveFirebaseAdmin() {
  const candidates = [
    "../firebase/kangsain-functions/functions/node_modules/firebase-admin",
    "/Users/archivepilates/codex-worktrees/archive-core-deploy-set/firebase/kangsain-functions/functions/node_modules/firebase-admin",
    "/Users/archivepilates/Documents/ARCHIVE-IN/firebase/kangsain-functions/functions/node_modules/firebase-admin",
  ];
  for (const candidate of candidates) {
    if (candidate.startsWith("/") && existsSync(candidate)) return candidate;
    const resolved = path.resolve(path.dirname(new URL(import.meta.url).pathname), candidate);
    if (existsSync(resolved)) return resolved;
  }
  return "firebase-admin";
}
