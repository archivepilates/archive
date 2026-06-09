#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";

const require = createRequire(import.meta.url);
const admin = require(resolveFirebaseAdmin());

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "archive-pilates";
const STUDIO_ID = process.env.STUDIOMATE_STUDIO_ID || process.env.MANAGER_STUDIO_ID || "5330";
const OUT_DIR = path.join(os.homedir(), "ArchiveIN/emergency/archive/member-session-counters");

const apply = hasArg("--apply");
const memberIdFilter = valueArg("--member-id");
const maxWrites = Number(valueArg("--max-writes") || "200000");
const runId = new Date().toISOString().replace(/[:.]/g, "-");

if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const bookings = await loadBookings();
const plan = buildPlan(bookings);
const summary = {
  ok: true,
  mode: apply ? "apply" : "dry-run",
  projectId: PROJECT_ID,
  studioId: STUDIO_ID,
  memberId: memberIdFilter || "",
  generatedAt: new Date().toISOString(),
  source: "bookings",
  bookingsRead: bookings.length,
  members: plan.memberWrites.length,
  bookingOrderWrites: plan.bookingOrderWrites.length,
  plannedWrites: plan.memberWrites.length * 2 + plan.bookingOrderWrites.length,
  sampleMembers: plan.memberWrites.slice(0, 20).map((item) => ({
    memberId: item.memberId,
    memberName: item.memberName,
    groupUsed: item.sessionCounters.group.usedCount,
    groupCountable: item.sessionCounters.group.countableCount,
    privateUsed: item.sessionCounters.private.usedCount,
    privateCountable: item.sessionCounters.private.countableCount,
  })),
  outputs: {
    summaryPath: path.join(OUT_DIR, `${runId}-session-counters-${apply ? "apply" : "dry-run"}-summary.json`),
    planPath: path.join(OUT_DIR, `${runId}-session-counters-plan.json`),
  },
};

if (summary.plannedWrites > maxWrites) {
  throw new Error(`Planned writes ${summary.plannedWrites} exceeds --max-writes ${maxWrites}.`);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(summary.outputs.summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(summary.outputs.planPath, `${JSON.stringify(redactedPlan(plan), null, 2)}\n`);

if (apply) {
  await applyPlan(plan);
}

console.log(JSON.stringify(summary, null, 2));
await admin.app().delete();

async function loadBookings() {
  let query = db.collection("bookings").where("studioId", "==", STUDIO_ID);
  if (memberIdFilter) query = query.where("memberId", "==", memberIdFilter);
  const snap = await query.get();
  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
}

function buildPlan(rows) {
  const grouped = new Map();
  for (const booking of rows) {
    if (!booking.memberId || !booking.lectureDate) continue;
    if (!grouped.has(booking.memberId)) grouped.set(booking.memberId, []);
    grouped.get(booking.memberId).push(booking);
  }

  const memberWrites = [];
  const bookingOrderWrites = [];
  const now = admin.firestore.Timestamp.now();

  for (const [memberId, memberBookings] of grouped.entries()) {
    const ordered = canonicalMemberBookings(memberBookings);
    const counters = emptyCounters(now);
    const running = { group: 0, private: 0 };
    const bookingOrders = [];

    for (const booking of ordered) {
      const category = bookingCategory(booking);
      if (!category) continue;
      const bucket = counters[category];
      bucket.totalRows += 1;
      if (isCancelledBooking(booking)) {
        bucket.cancelledCount += 1;
        continue;
      }
      if (!isCountableBooking(booking)) continue;

      running[category] += 1;
      const startsAtMs = timestampMillis(booking.lectureStartAt);
      bucket.countableCount += 1;
      if (isUsedBooking(booking)) {
        bucket.usedCount += 1;
        if (booking.attendanceStatus === "attended") bucket.attendedCount += 1;
        if (booking.attendanceStatus === "absent") bucket.absentCount += 1;
        if (booking.attendanceStatus === "late_cancel") bucket.lateCancelCount += 1;
        if (!bucket.firstUsedAt || startsAtMs < timestampMillis(bucket.firstUsedAt)) bucket.firstUsedAt = booking.lectureStartAt || null;
        if (!bucket.lastUsedAt || startsAtMs > timestampMillis(bucket.lastUsedAt)) bucket.lastUsedAt = booking.lectureStartAt || null;
      } else {
        bucket.reservedCount += 1;
        if (!bucket.nextReservedAt || startsAtMs < timestampMillis(bucket.nextReservedAt)) bucket.nextReservedAt = booking.lectureStartAt || null;
      }

      const order = {
        category,
        groupCumulativeRound: category === "group" ? running.group : null,
        privateCumulativeRound: category === "private" ? running.private : null,
        cumulativeRound: running[category],
        computedFrom: "bookings",
        computedAt: now,
      };
      bookingOrders.push({ bookingId: booking.id, current: booking.sessionOrder || null, sessionOrder: removeUndefined(order) });
    }

    const memberName = ordered.find((booking) => booking.memberName)?.memberName || "";
    const sessionCounters = {
      source: "bookings",
      version: 1,
      computedAt: now,
      group: finalizeCounter(counters.group),
      private: finalizeCounter(counters.private),
    };
    memberWrites.push({ memberId, memberName, sessionCounters });
    bookingOrderWrites.push(...bookingOrders.filter((item) => !sameSessionOrder(item.current, item.sessionOrder)));
  }

  return { memberWrites, bookingOrderWrites };
}

function canonicalMemberBookings(rows) {
  const map = new Map();
  for (const booking of rows) {
    const key = canonicalBookingKey(booking);
    const current = map.get(key);
    if (!current || bookingPriority(booking) > bookingPriority(current)) map.set(key, booking);
  }
  return [...map.values()].sort(compareBookings);
}

function canonicalBookingKey(booking) {
  const time = timeFromTimestamp(booking.lectureStartAt);
  return [
    booking.memberId || "",
    booking.lectureDate || "",
    time,
    normalizeName(booking.staffId || booking.staffName || ""),
    normalizeName(booking.ticketName || booking.title || booking.lectureTitle || ""),
    booking.appStatus === "cancel" ? "cancel" : "active",
  ].join("|");
}

function bookingPriority(booking) {
  if (!String(booking.id || "").startsWith("excel_") && !String(booking.id || "").startsWith("usage_")) return 5;
  if (String(booking.id || "").startsWith("usage_")) return 4;
  if (String(booking.id || "").startsWith("excel_")) return 3;
  return 1;
}

function compareBookings(a, b) {
  const aMs = timestampMillis(a.lectureStartAt);
  const bMs = timestampMillis(b.lectureStartAt);
  if (aMs !== bMs) return aMs - bMs;
  return String(a.id || "").localeCompare(String(b.id || ""));
}

function bookingCategory(booking) {
  const lessonType = String(booking.lessonType || "").toLowerCase();
  const text = [booking.lessonType, booking.ticketClassType, booking.ticketName, booking.title, booking.lectureTitle, booking.roomName]
    .filter(Boolean)
    .join(" ");
  if (lessonType === "private" || lessonType === "semi_private") return "private";
  if (/프라이빗|개인|1:1|private|듀엣|semi/i.test(text)) return "private";
  if (lessonType === "group" || /그룹|group/i.test(text)) return "group";
  return "group";
}

function isCancelledBooking(booking) {
  return booking.appStatus === "cancel" || booking.appStatus === "wait_cancel" || booking.appStatus === "wait";
}

function isCountableBooking(booking) {
  if (isCancelledBooking(booking)) return false;
  return ["attended", "absent", "late_cancel", "unchecked"].includes(String(booking.attendanceStatus || ""));
}

function isUsedBooking(booking) {
  return ["attended", "absent", "late_cancel"].includes(String(booking.attendanceStatus || ""));
}

function emptyCounters(now) {
  return {
    group: emptyCounter(now),
    private: emptyCounter(now),
  };
}

function emptyCounter(now) {
  return {
    usedCount: 0,
    countableCount: 0,
    reservedCount: 0,
    attendedCount: 0,
    absentCount: 0,
    lateCancelCount: 0,
    cancelledCount: 0,
    totalRows: 0,
    firstUsedAt: null,
    lastUsedAt: null,
    nextReservedAt: null,
    updatedAt: now,
  };
}

function finalizeCounter(counter) {
  return removeUndefined(counter);
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

  for (const item of plan.memberWrites) {
    const memberPatch = {
      sessionCounters: item.sessionCounters,
      groupSessionCount: item.sessionCounters.group.usedCount,
      privateSessionCount: item.sessionCounters.private.usedCount,
      groupCountableSessionCount: item.sessionCounters.group.countableCount,
      privateCountableSessionCount: item.sessionCounters.private.countableCount,
      sessionCountersUpdatedAt: item.sessionCounters.computedAt,
      updatedAt: item.sessionCounters.computedAt,
    };
    batch.set(db.collection("memberProfiles").doc(item.memberId), memberPatch, { merge: true });
    if (++writes >= 450) await commit();
    batch.set(db.collection("member360Cards").doc(item.memberId), memberPatch, { merge: true });
    if (++writes >= 450) await commit();
  }

  for (const item of plan.bookingOrderWrites) {
    batch.set(db.collection("bookings").doc(item.bookingId), { sessionOrder: item.sessionOrder }, { merge: true });
    if (++writes >= 450) await commit();
  }
  await commit();
}

function sameSessionOrder(a, b) {
  if (!a) return false;
  return (
    String(a.category || "") === String(b.category || "") &&
    Number(a.cumulativeRound || 0) === Number(b.cumulativeRound || 0) &&
    Number(a.groupCumulativeRound || 0) === Number(b.groupCumulativeRound || 0) &&
    Number(a.privateCumulativeRound || 0) === Number(b.privateCumulativeRound || 0)
  );
}

function redactedPlan(plan) {
  return {
    memberWrites: plan.memberWrites.slice(0, 100).map((item) => ({
      memberId: item.memberId,
      memberName: item.memberName,
      group: item.sessionCounters.group,
      private: item.sessionCounters.private,
    })),
    bookingOrderWrites: plan.bookingOrderWrites.slice(0, 100).map((item) => ({
      bookingId: item.bookingId,
      sessionOrder: item.sessionOrder,
    })),
    truncated: {
      memberWrites: Math.max(0, plan.memberWrites.length - 100),
      bookingOrderWrites: Math.max(0, plan.bookingOrderWrites.length - 100),
    },
  };
}

function removeUndefined(value) {
  if (Array.isArray(value)) return value.map(removeUndefined);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, removeUndefined(item)]));
  }
  return value;
}

function timestampMillis(value) {
  return value?.toMillis?.() || value?.toDate?.()?.getTime?.() || 0;
}

function timeFromTimestamp(value) {
  const date = value?.toDate?.();
  if (!date) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function normalizeName(value) {
  return String(value || "").normalize("NFC").replace(/\s+/g, "").toLowerCase();
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

function resolveFirebaseAdmin() {
  const candidates = [
    "../firebase/kangsain-functions/functions/node_modules/firebase-admin",
    "/Users/archivepilates/codex-worktrees/archive-core-deploy-set/firebase/kangsain-functions/functions/node_modules/firebase-admin",
    "/Users/archivepilates/Documents/ARCHIVE-IN/firebase/kangsain-functions/functions/node_modules/firebase-admin",
  ];
  for (const candidate of candidates) {
    if (candidate.startsWith("/") && existsSync(candidate)) return candidate;
    if (!candidate.startsWith("/") && existsSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), candidate))) return candidate;
  }
  return "firebase-admin";
}
