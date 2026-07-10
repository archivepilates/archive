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
const DEFAULT_OUT_DIR = path.join(os.homedir(), "ArchiveIN/automation/reports/private-session-ledger");

const args = parseArgs(process.argv.slice(2));
const config = {
  apply: Boolean(args.apply),
  all: Boolean(args.all),
  memberId: cleanString(args["member-id"] || args.member || ""),
  memberName: cleanString(args.name || ""),
  memberPhone: normalizePhone(args.phone || ""),
  outDir: expandHome(cleanString(args["out-dir"] || DEFAULT_OUT_DIR)),
  writeLimit: numberValue(args["write-limit"] || "5000"),
};

if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exitCode = 1;
});

async function main() {
  if (!config.all && !config.memberId && !config.memberName && !config.memberPhone) {
    throw new Error("Set --member-id, --name, --phone, or --all.");
  }
  const members = await loadMembers();
  if (!members.length) throw new Error("No members matched.");
  const rows = [];
  let plannedWrites = 0;
  for (const member of members) {
    const result = await recomputeMember(member);
    rows.push(result);
    plannedWrites += result.plannedWrites;
  }
  if (plannedWrites > config.writeLimit) {
    throw new Error(`Planned writes ${plannedWrites} exceed --write-limit=${config.writeLimit}.`);
  }
  const summary = {
    ok: true,
    mode: config.apply ? "apply" : "dry-run",
    projectId: PROJECT_ID,
    studioId: STUDIO_ID,
    generatedAt: new Date().toISOString(),
    selectedMembers: members.length,
    plannedWrites,
    affectedBookings: rows.reduce((sum, row) => sum + row.bookingPatches.length, 0),
    affectedRequests: rows.reduce((sum, row) => sum + row.requestPatches.length, 0),
    ledgerEntries: rows.reduce((sum, row) => sum + row.ledgerEntries.length, 0),
  };
  mkdirSync(config.outDir, { recursive: true });
  const reportPath = path.join(
    config.outDir,
    `${new Date().toISOString().replace(/[:.]/g, "-")}-private-session-ledger-${config.apply ? "apply" : "dry-run"}.json`,
  );
  writeFileSync(reportPath, `${JSON.stringify({ summary, rows: rows.map(redactForReport) }, null, 2)}\n`);
  console.log(JSON.stringify({ summary, reportPath }, null, 2));
}

async function loadMembers() {
  if (config.memberId) {
    const snap = await db.collection("memberProfiles").doc(config.memberId).get();
    if (snap.exists) return [{ memberId: snap.id, ...(snap.data() || {}) }];
    return [{ memberId: config.memberId, name: "", phone: "" }];
  }
  let snap;
  if (config.memberPhone) {
    snap = await db.collection("memberProfiles").where("phone", "==", config.memberPhone).get();
  } else if (config.memberName) {
    snap = await db.collection("memberProfiles").where("name", "==", config.memberName).get();
  } else {
    snap = await db.collection("memberProfiles").where("studioId", "==", STUDIO_ID).get();
  }
  return snap.docs.map((doc) => ({ memberId: doc.id, ...(doc.data() || {}) }));
}

async function recomputeMember(member) {
  const [bookingSnap, ledgerSnap, requestSnap] = await Promise.all([
    db.collection("bookings").where("memberId", "==", member.memberId).get(),
    db.collection("privateSessionLedger").where("memberId", "==", member.memberId).get(),
    db.collection("privateLessonChartRequests").where("memberId", "==", member.memberId).get(),
  ]);
  const bookings = bookingSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
  const timeline = new Map();
  for (const booking of bookings) {
    if (!isCountablePrivateBooking(booking)) continue;
    mergeTimelineRow(timeline, timelineRowFromBooking(booking));
  }

  const ordered = [...timeline.values()].sort(compareTimelineRows);
  const ledgerEntries = ordered.map((row, index) => ledgerEntryFromTimeline(member, row, index + 1));
  const ledgerByKey = new Map(ledgerEntries.map((entry) => [entry.occurrenceKey, entry]));
  const ledgerByBookingId = new Map(ledgerEntries.filter((entry) => entry.bookingId).map((entry) => [entry.bookingId, entry]));
  const bookingPatches = buildBookingPatches(bookings, ledgerByKey, ledgerByBookingId);
  const requestPatches = await buildRequestPatches(requestSnap.docs, bookings, ledgerEntries, ledgerByKey, ledgerByBookingId);
  const staleLedgerDeletes = ledgerSnap.docs.map((doc) => doc.id);
  const plannedWrites = ledgerEntries.length + staleLedgerDeletes.length + bookingPatches.length * 2 + requestPatches.length * 2;

  if (config.apply) {
    await applyMemberPlan({ member, ledgerEntries, staleLedgerDeletes, bookingPatches, requestPatches });
  }

  return {
    memberId: member.memberId,
    memberName: member.name || ordered[0]?.memberName || "",
    sourceCounts: {
      bookings: bookingSnap.size,
      previousLedger: ledgerSnap.size,
      chartRequests: requestSnap.size,
    },
    ledgerEntries,
    bookingPatches,
    requestPatches,
    plannedWrites,
    applied: config.apply,
  };
}

function buildBookingPatches(bookings, ledgerByKey, ledgerByBookingId) {
  const now = admin.firestore.Timestamp.now();
  const patches = [];
  for (const booking of bookings) {
    const bookingId = String(booking.bookingId || booking.id || "");
    const key = occurrenceKey(timelineRowFromBooking(booking));
    const expectedByBooking = ledgerByBookingId.get(bookingId);
    const expectedByKey = ledgerByKey.get(key);
    const duplicateOfLedger = Boolean(expectedByKey?.bookingId && expectedByKey.bookingId !== bookingId);
    const expected = expectedByBooking || (duplicateOfLedger ? null : expectedByKey);
    if (expected) {
      const currentRound = positiveNumber(booking.sessionOrder?.privateCumulativeRound);
      const currentCounted = booking.sessionOrder?.counted;
      if (currentRound !== expected.cumulativePrivateRound || currentCounted !== true) {
        patches.push({
          bookingId: booking.bookingId || booking.id,
          reason: "sync_private_session_order_from_ledger",
          before: sessionOrderSnapshot(booking),
          patch: {
            sessionOrder: {
              ...(booking.sessionOrder || {}),
              category: "private",
              cumulativeRound: expected.cumulativePrivateRound,
              privateCumulativeRound: expected.cumulativePrivateRound,
              counted: true,
              excludedReason: null,
              computedFrom: "privateSessionLedger",
              computedAt: now,
            },
            sessionOrderCorrection: {
              fromPrivateCumulativeRound: currentRound,
              toPrivateCumulativeRound: expected.cumulativePrivateRound,
              fromCounted: currentCounted ?? null,
              toCounted: true,
              reason: "private session ledger recompute",
              correctedAt: now,
            },
            updatedAt: now,
          },
        });
      }
      continue;
    }
    if (booking.sessionOrder?.counted === true || positiveNumber(booking.sessionOrder?.privateCumulativeRound)) {
      const reason = duplicateOfLedger ? "duplicate_source" : inactivePrivateBookingReason(booking) || "not_in_private_session_ledger";
      patches.push({
        bookingId: booking.bookingId || booking.id,
        reason,
        before: sessionOrderSnapshot(booking),
        patch: {
          sessionOrder: {
            ...(booking.sessionOrder || {}),
            category: isPrivateBooking(booking) ? "private" : "group",
            cumulativeRound: null,
            privateCumulativeRound: null,
            counted: false,
            excludedReason: reason,
            computedFrom: "privateSessionLedger",
            computedAt: now,
          },
          sessionOrderCorrection: {
            fromPrivateCumulativeRound: positiveNumber(booking.sessionOrder?.privateCumulativeRound),
            toPrivateCumulativeRound: null,
            fromCounted: booking.sessionOrder?.counted ?? null,
            toCounted: false,
            reason,
            correctedAt: now,
          },
          updatedAt: now,
        },
      });
    }
  }
  return patches;
}

async function buildRequestPatches(requestDocs, bookings, ledgerEntries, ledgerByKey, ledgerByBookingId) {
  const now = admin.firestore.Timestamp.now();
  const patches = [];
  for (const doc of requestDocs) {
    const request = { requestId: doc.id, ...(doc.data() || {}) };
    const key = occurrenceKey(timelineRowFromRequest(request));
    const ledger = ledgerByBookingId.get(String(request.bookingId || "")) || ledgerByKey.get(key);
    if (String(request.status || "") === "cancelled") {
      const sessionNumber = cancelledRequestSessionNumber(request, bookings, ledgerEntries);
      if (Number(request.sessionNumber || 0) !== sessionNumber) {
        patches.push({
          requestId: request.requestId,
          recordId: request.requestId,
          reason: "sync_cancelled_chart_request_display_round",
          before: { sessionNumber: request.sessionNumber, status: request.status, bookingId: request.bookingId },
          requestPatch: {
            sessionNumber,
            sessionNumberCorrection: {
              from: positiveNumber(request.sessionNumber),
              to: sessionNumber || null,
              reason: sessionNumber ? "cancelled private booking would-be round" : "cancelled non-private booking excluded from private rounds",
              correctedAt: now,
            },
            updatedAt: now,
          },
          recordPatch: {
            sessionNumber,
            sessionNumberCorrection: {
              from: positiveNumber(request.sessionNumber),
              to: sessionNumber || null,
              reason: sessionNumber ? "cancelled private booking would-be round" : "cancelled non-private booking excluded from private rounds",
              correctedAt: now,
            },
            updatedAt: now,
          },
        });
      }
      continue;
    }
    if (!ledger) {
      const replacement = replacementBookingForRequest(request, bookings, ledgerByKey, ledgerByBookingId);
      if (replacement) {
        const replacementKey = occurrenceKey(timelineRowFromBooking(replacement));
        const replacementLedger =
          ledgerByBookingId.get(String(replacement.bookingId || replacement.id || "")) ||
          ledgerByKey.get(replacementKey);
        const sessionNumber =
          replacementLedger?.cumulativePrivateRound || positiveNumber(replacement.sessionOrder?.privateCumulativeRound) || 1;
        patches.push({
          requestId: request.requestId,
          recordId: request.requestId,
          reason: "migrate_chart_request_to_rescheduled_booking",
          before: {
            sessionNumber: request.sessionNumber,
            status: request.status,
            bookingId: request.bookingId,
            lessonStartAt: request.lessonStartAt?.toDate?.()?.toISOString?.() || request.lessonStartAt || null,
          },
          requestPatch: {
            bookingId: replacement.bookingId || replacement.id,
            lectureId: replacement.lectureId || "",
            staffId: replacement.staffId || request.staffId || "",
            staffName: replacement.staffName || request.staffName || "",
            lessonDate: replacement.lectureDate || "",
            lessonStartAt: replacement.lectureStartAt || null,
            lessonEndAt: replacement.lectureEndAt || null,
            sessionNumber,
            sessionNumberCorrection: {
              from: positiveNumber(request.sessionNumber),
              to: sessionNumber,
              reason: "privateSessionLedger canonical round",
              correctedAt: now,
            },
            rescheduleCorrection: {
              fromBookingId: request.bookingId || null,
              toBookingId: replacement.bookingId || replacement.id || null,
              fromLessonStartAt: request.lessonStartAt || null,
              toLessonStartAt: replacement.lectureStartAt || null,
              fromSessionNumber: positiveNumber(request.sessionNumber),
              toSessionNumber: sessionNumber,
              reason: "rescheduled booking matched during privateSessionLedger recompute",
              correctedAt: now,
            },
            cancellationReason: null,
            cancelledAt: null,
            updatedAt: now,
          },
          recordPatch: {
            bookingId: replacement.bookingId || replacement.id,
            lectureId: replacement.lectureId || "",
            staffId: replacement.staffId || request.staffId || "",
            staffName: replacement.staffName || request.staffName || "",
            lessonDate: replacement.lectureDate || "",
            lessonStartAt: replacement.lectureStartAt || null,
            sessionNumber,
            sessionNumberCorrection: {
              from: positiveNumber(request.sessionNumber),
              to: sessionNumber,
              reason: "privateSessionLedger canonical round",
              correctedAt: now,
            },
            rescheduleCorrection: {
              fromBookingId: request.bookingId || null,
              toBookingId: replacement.bookingId || replacement.id || null,
              fromLessonStartAt: request.lessonStartAt || null,
              toLessonStartAt: replacement.lectureStartAt || null,
              fromSessionNumber: positiveNumber(request.sessionNumber),
              toSessionNumber: sessionNumber,
              reason: "rescheduled booking matched during privateSessionLedger recompute",
              correctedAt: now,
            },
            cancellationReason: null,
            cancelledAt: null,
            updatedAt: now,
          },
        });
        continue;
      }
      patches.push({
        requestId: request.requestId,
        recordId: request.requestId,
        reason: "chart_request_not_in_private_session_ledger",
        before: { sessionNumber: request.sessionNumber, status: request.status, bookingId: request.bookingId },
        requestPatch: {
          status: "cancelled",
          cancellationReason: "booking_not_in_private_session_ledger",
          cancelledAt: now,
          updatedAt: now,
          alimtalk: {
            ...(request.alimtalk || {}),
            status: request.alimtalk?.status === "sent" ? "sent" : "skipped",
            lastError: "booking_not_in_private_session_ledger",
          },
        },
        recordPatch: {
          sessionStatus: "cancelled",
          cancellationReason: "booking_not_in_private_session_ledger",
          cancelledAt: now,
          updatedAt: now,
        },
      });
      continue;
    }
    if (positiveNumber(request.sessionNumber) !== ledger.cumulativePrivateRound) {
      patches.push({
        requestId: request.requestId,
        recordId: request.requestId,
        reason: "sync_chart_request_round_from_ledger",
        before: { sessionNumber: request.sessionNumber, status: request.status, bookingId: request.bookingId },
        requestPatch: {
          sessionNumber: ledger.cumulativePrivateRound,
          sessionNumberCorrection: {
            from: positiveNumber(request.sessionNumber),
            to: ledger.cumulativePrivateRound,
            reason: "privateSessionLedger canonical round",
            correctedAt: now,
          },
          updatedAt: now,
        },
        recordPatch: {
          sessionNumber: ledger.cumulativePrivateRound,
          sessionNumberCorrection: {
            from: positiveNumber(request.sessionNumber),
            to: ledger.cumulativePrivateRound,
            reason: "privateSessionLedger canonical round",
            correctedAt: now,
          },
          updatedAt: now,
        },
      });
    }
  }
  return patches;
}

function replacementBookingForRequest(request, bookings, ledgerByKey, ledgerByBookingId) {
  const requestStaff = staffOccurrenceIdentity(request.staffId, request.staffName);
  const requestStart = timestampMillisFromValue(request.lessonStartAt);
  const candidates = bookings
    .filter((booking) => String(booking.bookingId || booking.id || "") !== String(request.bookingId || ""))
    .filter((booking) => String(booking.lectureDate || "") === String(request.lessonDate || ""))
    .filter((booking) => staffOccurrenceIdentity(booking.staffId, booking.staffName) === requestStaff)
    .filter((booking) => isCountablePrivateBooking(booking))
    .filter((booking) => {
      const key = occurrenceKey(timelineRowFromBooking(booking));
      return Boolean(ledgerByBookingId.get(String(booking.bookingId || booking.id || "")) || ledgerByKey.get(key));
    })
    .sort((a, b) => {
      const aDistance = Math.abs(timestampMillisFromValue(a.lectureStartAt) - requestStart);
      const bDistance = Math.abs(timestampMillisFromValue(b.lectureStartAt) - requestStart);
      return aDistance - bDistance || bookingSourcePriority(String(a.bookingId || a.id || "")) - bookingSourcePriority(String(b.bookingId || b.id || ""));
    });
  return candidates.length === 1 ? candidates[0] : null;
}

function cancelledRequestSessionNumber(request, bookings, ledgerEntries) {
  const booking = bookings.find((item) => String(item.bookingId || item.id || "") === String(request.bookingId || ""));
  if (booking && !isPrivateBooking(booking)) return 0;
  const startsAt = timestampMillisFromValue(request.lessonStartAt) || timestampMillisFromValue(booking?.lectureStartAt);
  if (!startsAt) return Number(request.sessionNumber || 0) || 0;
  return ledgerEntries.filter((entry) => timestampMillisFromValue(entry.startsAt) < startsAt).length + 1;
}

async function applyMemberPlan({ member, ledgerEntries, staleLedgerDeletes, bookingPatches, requestPatches }) {
  const chunks = [];
  const ledgerBatch = [];
  for (const id of staleLedgerDeletes) {
    ledgerBatch.push((batch) => batch.delete(db.collection("privateSessionLedger").doc(id)));
  }
  for (const entry of ledgerEntries) {
    const { occurrenceKey: _occurrenceKey, ...data } = entry;
    ledgerBatch.push((batch) => batch.set(db.collection("privateSessionLedger").doc(entry.ledgerId), removeUndefined(data), { merge: true }));
  }
  chunks.push(...ledgerBatch);
  for (const item of bookingPatches) {
    chunks.push((batch) => batch.set(db.collection("bookings").doc(item.bookingId), item.patch, { merge: true }));
  }
  for (const item of requestPatches) {
    chunks.push((batch) => batch.set(db.collection("privateLessonChartRequests").doc(item.requestId), item.requestPatch, { merge: true }));
    chunks.push((batch) => batch.set(db.collection("privateLessonChartRecords").doc(item.recordId), item.recordPatch, { merge: true }));
  }
  for (let index = 0; index < chunks.length; index += 400) {
    const batch = db.batch();
    for (const applyToBatch of chunks.slice(index, index + 400)) applyToBatch(batch);
    await batch.commit();
  }
  await db.collection("opsState").doc(`privateSessionLedger_${member.memberId}`).set(
    {
      studioId: STUDIO_ID,
      memberId: member.memberId,
      memberName: member.name || "",
      ledgerEntries: ledgerEntries.length,
      bookingPatches: bookingPatches.length,
      requestPatches: requestPatches.length,
      updatedAt: admin.firestore.Timestamp.now(),
    },
    { merge: true },
  );
}

function ledgerEntryFromTimeline(member, row, round) {
  const ledgerId = `private_ledger_${hash(`${row.memberId}|${row.startsAt}|${row.staffName}|${row.bookingId || row.usageEventId || ""}`).slice(0, 24)}`;
  const occurrence = occurrenceKey(row);
  const ticketTotal = roundFromText(row.ticketName);
  return removeUndefined({
    ledgerId,
    occurrenceKey: occurrence,
    studioId: STUDIO_ID,
    memberId: row.memberId || member.memberId,
    memberName: row.memberName || member.name || "",
    bookingId: row.bookingId || "",
    usageEventId: row.usageEventId || "",
    canonicalUsageKey: row.canonicalUsageKey || occurrence,
    startsAt: admin.firestore.Timestamp.fromMillis(row.startsAt),
    staffName: row.staffName || "",
    ticketName: row.ticketName || "",
    cumulativePrivateRound: round,
    currentTicketRound: ticketTotal ? ((round - 1) % ticketTotal) + 1 : undefined,
    currentTicketTotalRounds: ticketTotal || undefined,
    status: row.status || "reserved",
    computation: {
      computedAt: new Date().toISOString(),
      computedFrom: ["bookings"],
      policy: "bookings_single_reservation_snapshot_attended_or_today_future",
    },
    createdAt: admin.firestore.Timestamp.now(),
    updatedAt: admin.firestore.Timestamp.now(),
  });
}

function mergeTimelineRow(timeline, next) {
  const key = occurrenceKey(next);
  if (!key) return;
  const current = timeline.get(key);
  if (!current) {
    timeline.set(key, next);
    return;
  }
  const preferred = preferredTimelineSource(current, next);
  const fallback = preferred === current ? next : current;
  timeline.set(key, {
    ...current,
    ...next,
    status: betterStatus(current.status, next.status),
    bookingId: preferred.bookingId || fallback.bookingId || "",
    usageEventId: current.usageEventId || next.usageEventId,
    canonicalUsageKey: current.canonicalUsageKey || next.canonicalUsageKey,
    ticketName: preferred.ticketName || fallback.ticketName,
    memberName: preferred.memberName || fallback.memberName,
    sourcePriority: Math.min(current.sourcePriority, next.sourcePriority),
  });
}

function preferredTimelineSource(a, b) {
  if ((b.sourcePriority ?? 9) !== (a.sourcePriority ?? 9)) return (b.sourcePriority ?? 9) < (a.sourcePriority ?? 9) ? b : a;
  if (b.status !== a.status) return betterStatus(a.status, b.status) === b.status ? b : a;
  return String(b.bookingId || "").localeCompare(String(a.bookingId || "")) < 0 ? b : a;
}

function timelineRowFromBooking(booking) {
  return {
    memberId: String(booking.memberId || ""),
    memberName: String(booking.memberName || ""),
    bookingId: String(booking.bookingId || booking.id || ""),
    startsAt: timestampMillisFromValue(booking.lectureStartAt),
    staffName: String(booking.staffName || ""),
    ticketName: String(booking.ticketName || ""),
    status: booking.attendanceStatus === "attended" ? "attended" : "reserved",
    sourcePriority: bookingSourcePriority(String(booking.bookingId || booking.id || "")),
  };
}

function timelineRowFromRequest(request) {
  return {
    memberId: String(request.memberId || ""),
    memberName: String(request.memberName || ""),
    bookingId: String(request.bookingId || ""),
    startsAt: timestampMillisFromValue(request.lessonStartAt),
    staffName: String(request.staffName || ""),
    ticketName: "",
    status: "reserved",
    sourcePriority: bookingSourcePriority(String(request.bookingId || "")),
  };
}

function isCountablePrivateBooking(booking) {
  if (inactivePrivateBookingReason(booking)) return false;
  return true;
}

function inactivePrivateBookingReason(booking) {
  if (!booking) return "missing_booking";
  if (booking.archiveBooking?.isCanonical === false) return String(booking.sessionOrder?.excludedReason || "duplicate_source");
  if (booking.sessionOrder?.counted === false && /duplicate|missing|stale|cancel|superseded/i.test(String(booking.sessionOrder?.excludedReason || ""))) {
    return String(booking.sessionOrder.excludedReason || "session_order_excluded");
  }
  if (booking.appStatus && String(booking.appStatus) !== "reserved") return `booking_app_status_${booking.appStatus}`;
  if (["absent", "late_cancel"].includes(String(booking.attendanceStatus || ""))) return `attendance_status_${booking.attendanceStatus}`;
  if (isPastUncheckedBooking(booking)) return "past_unchecked_attendance";
  const sourceStatus = String(booking.sourceStatus || "");
  if (/missing_from_latest_reservation_import|stale|lecture_deleted|deleted|cancel/i.test(sourceStatus)) return sourceStatus;
  if (!isPrivateBooking(booking)) return "not_private_booking";
  return "";
}

function isPastUncheckedBooking(booking) {
  if (String(booking.attendanceStatus || "unchecked") === "attended") return false;
  const date = String(booking.lectureDate || dateFromTimestampLike(booking.lectureStartAt) || "");
  return Boolean(date && date < todayKst());
}

function isPrivateBooking(booking) {
  if (String(booking.lessonType || "") === "group") return false;
  if (["private", "semi_private"].includes(String(booking.lessonType || ""))) return true;
  const text = `${booking.ticketName || ""} ${booking.ticketClassType || ""} ${booking.ticketType || ""} ${booking.title || ""} ${booking.lectureTitle || ""}`;
  return /프라이빗|개인|1:1|PRIVATE|\bP\b/i.test(text);
}

function occurrenceKey(row) {
  if (!row.memberId || !row.startsAt) return "";
  return [row.memberId, normalizeName(row.staffName), row.startsAt].join("|");
}

function compareTimelineRows(a, b) {
  return a.startsAt - b.startsAt || String(a.bookingId || a.usageEventId || "").localeCompare(String(b.bookingId || b.usageEventId || ""));
}

function betterStatus(a, b) {
  const priority = { attended: 3, reserved: 2 };
  return (priority[b] || 0) > (priority[a] || 0) ? b : a;
}

function sessionOrderSnapshot(booking) {
  return {
    privateCumulativeRound: booking.sessionOrder?.privateCumulativeRound ?? null,
    counted: booking.sessionOrder?.counted ?? null,
    excludedReason: booking.sessionOrder?.excludedReason ?? null,
  };
}

function bookingSourcePriority(bookingId) {
  const id = String(bookingId || "");
  if (!id) return 9;
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

function dateFromTimestampLike(value) {
  const millis = timestampMillisFromValue(value);
  return millis ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date(millis)) : "";
}

function todayKst() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

function positiveNumber(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function staffOccurrenceIdentity(staffId, staffName) {
  return normalizeName(staffName || "") || String(staffId || "");
}

function roundFromText(value) {
  const match = String(value || "").match(/(\d{1,3})\s*회/);
  return match ? Number(match[1]) : 0;
}

function normalizeName(value) {
  return String(value || "").replace(/\s+/g, "").replace(/님$/g, "").replace(/\d+$/g, "").trim();
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function cleanString(value) {
  return String(value || "").trim();
}

function numberValue(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) parsed[key] = true;
    else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function expandHome(value) {
  if (!value.startsWith("~")) return value;
  return path.join(os.homedir(), value.slice(1));
}

function removeUndefined(value) {
  if (Array.isArray(value)) return value.map(removeUndefined);
  if (!value || typeof value !== "object") return value;
  if (typeof value.toDate === "function" || typeof value.toMillis === "function") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, removeUndefined(item)]),
  );
}

function redactForReport(row) {
  return {
    ...row,
    ledgerEntries: row.ledgerEntries.map((entry) => ({
      ledgerId: entry.ledgerId,
      bookingId: entry.bookingId,
      usageEventId: entry.usageEventId,
      startsAt: entry.startsAt?.toDate?.()?.toISOString?.() || entry.startsAt,
      staffName: entry.staffName,
      ticketName: entry.ticketName,
      cumulativePrivateRound: entry.cumulativePrivateRound,
      status: entry.status,
    })),
  };
}

function hash(value) {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}
