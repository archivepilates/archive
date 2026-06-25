#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "archive-pilates";
const STUDIO_ID = process.env.STUDIOMATE_STUDIO_ID || process.env.MANAGER_STUDIO_ID || "5330";
const DEFAULT_OUT_DIR = path.join(os.homedir(), "ArchiveIN/automation/reports/bookings-reconcile");

const args = parseArgs(process.argv.slice(2));
const config = {
  apply: Boolean(args.apply),
  startDate: cleanText(args["start-date"] || ""),
  endDate: cleanText(args["end-date"] || ""),
  writeLimit: numberValue(args["write-limit"] || "20000"),
  outDir: expandHome(cleanText(args["out-dir"] || DEFAULT_OUT_DIR)),
};

if (!config.startDate || !config.endDate) throw new Error("Set --start-date and --end-date.");
if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const bookings = await loadBookings();
  const groups = groupBookings(bookings);
  const duplicateGroups = [...groups.values()].filter((group) => activeRows(group).length > 1);
  const patches = [];
  for (const group of duplicateGroups) {
    const sorted = [...activeRows(group)].sort(comparePreferredBooking);
    const keeper = sorted[0];
    for (const duplicate of sorted.slice(1)) {
      patches.push(buildSupersededPatch(duplicate, keeper, group.key));
    }
  }

  if (patches.length > config.writeLimit) {
    throw new Error(`Planned writes ${patches.length} exceed --write-limit=${config.writeLimit}.`);
  }
  if (config.apply) await applyPatches(patches);

  const summary = {
    ok: true,
    mode: config.apply ? "apply" : "dry-run",
    projectId: PROJECT_ID,
    studioId: STUDIO_ID,
    dateRange: { startDate: config.startDate, endDate: config.endDate },
    loadedBookings: bookings.length,
    groupedKeys: groups.size,
    duplicateGroups: duplicateGroups.length,
    plannedSupersededWrites: patches.length,
    applied: config.apply,
  };
  mkdirSync(config.outDir, { recursive: true });
  const reportPath = path.join(
    config.outDir,
    `${new Date().toISOString().replace(/[:.]/g, "-")}-bookings-canonical-dedupe-${config.apply ? "apply" : "dry-run"}.json`,
  );
  writeFileSync(
    reportPath,
    `${JSON.stringify(
      {
        summary,
        samples: patches.slice(0, 100).map((patch) => ({
          duplicateBookingId: patch.bookingId,
          keepBookingId: patch.keepBookingId,
          key: patch.key,
          memberName: patch.memberName,
          lectureDate: patch.lectureDate,
          startTime: patch.startTime,
          staffName: patch.staffName,
        })),
      },
      null,
      2,
    )}\n`,
  );
  console.log(JSON.stringify({ summary, reportPath }, null, 2));
}

async function loadBookings() {
  const snap = await db
    .collection("bookings")
    .where("studioId", "==", STUDIO_ID)
    .where("lectureDate", ">=", config.startDate)
    .where("lectureDate", "<=", config.endDate)
    .get();
  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
}

function groupBookings(bookings) {
  const groups = new Map();
  for (const booking of bookings) {
    const key = canonicalGroupKey(booking);
    if (!key) continue;
    const group = groups.get(key) || { key, rows: [] };
    group.rows.push(booking);
    groups.set(key, group);
  }
  return groups;
}

function activeRows(group) {
  return group.rows.filter((booking) => ["reserved", "wait"].includes(String(booking.appStatus || "reserved")));
}

function canonicalGroupKey(booking) {
  const date = String(booking.lectureDate || "").slice(0, 10);
  const start = startTimeOf(booking);
  const member = cleanText(booking.memberId || "") || normalizePhone(booking.memberPhone || "") || normalizeName(booking.memberName || "");
  const staff = cleanText(booking.staffId || "") || normalizeName(booking.staffName || "");
  if (!date || !start || !member) return "";
  return ["occurrence", STUDIO_ID, date, start, member, staff].join("|");
}

function comparePreferredBooking(a, b) {
  return bookingRank(a) - bookingRank(b) || millis(b.updatedAt || b.syncedAt) - millis(a.updatedAt || a.syncedAt) || String(a.id).localeCompare(String(b.id));
}

function bookingRank(booking) {
  const id = String(booking.bookingId || booking.id || "");
  let score = 0;
  if (id.startsWith("excel_booking_")) score += 200;
  if (id.startsWith("usage_booking_")) score += 300;
  if (id.startsWith("excel_")) score += 100;
  if (!booking.sourceBookingId && id.startsWith("excel_booking_")) score += 50;
  if (Number.isFinite(Number(booking.sourcePriority))) score += Number(booking.sourcePriority);
  else score += 50;
  if (booking.attendanceStatus === "attended") score -= 5;
  return score;
}

function buildSupersededPatch(duplicate, keeper, key) {
  const now = admin.firestore.Timestamp.now();
  return {
    bookingId: duplicate.bookingId || duplicate.id,
    keepBookingId: keeper.bookingId || keeper.id,
    key,
    memberName: duplicate.memberName || "",
    lectureDate: duplicate.lectureDate || "",
    startTime: startTimeOf(duplicate),
    staffName: duplicate.staffName || "",
    patch: {
      appStatus: "superseded",
      sourceStatus: "superseded_by_canonical_booking_dedupe",
      reconcileStatus: "superseded_by_canonical_booking_dedupe",
      supersededByBookingId: keeper.bookingId || keeper.id,
      canonicalBookingKey: key.startsWith("fallback|") ? duplicate.canonicalBookingKey || "" : key,
      archiveBookingId: key.startsWith("fallback|") ? duplicate.archiveBookingId || "" : key,
      syncStatus: "synced",
      sessionOrder: {
        ...(duplicate.sessionOrder || {}),
        counted: false,
        privateCumulativeRound: null,
        cumulativeRound: null,
        excludedReason: "superseded_by_canonical_booking_dedupe",
        computedFrom: "bookings_canonical_dedupe",
        computedAt: now,
      },
      sessionOrderCorrection: {
        fromPrivateCumulativeRound: duplicate.sessionOrder?.privateCumulativeRound || null,
        toPrivateCumulativeRound: null,
        fromCounted: duplicate.sessionOrder?.counted ?? null,
        toCounted: false,
        reason: "duplicate booking superseded by canonical booking dedupe",
        correctedAt: now,
      },
      lastChangedBy: "bookings_canonical_dedupe",
      updatedAt: now,
    },
  };
}

async function applyPatches(patches) {
  let batch = db.batch();
  let writes = 0;
  const commit = async () => {
    if (!writes) return;
    await batch.commit();
    batch = db.batch();
    writes = 0;
  };
  for (const item of patches) {
    batch.set(db.collection("bookings").doc(item.bookingId), item.patch, { merge: true });
    if (++writes >= 450) await commit();
  }
  await commit();
}

function startTimeOf(booking) {
  return (
    normalizeTime(booking.startTime || "") ||
    (booking.lectureStartAt?.toDate?.()
      ? hhmm(booking.lectureStartAt.toDate())
      : booking.lectureStartAt?.toMillis?.()
        ? hhmm(booking.lectureStartAt.toDate())
        : "")
  );
}

function millis(value) {
  if (!value) return 0;
  if (value.toMillis) return value.toMillis();
  if (value.toDate) return value.toDate().getTime();
  if (value._seconds) return value._seconds * 1000;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function hhmm(date) {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
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

function normalizeName(value) {
  return cleanText(value).replace(/\s+/g, "").toLowerCase();
}

function cleanText(value) {
  return String(value ?? "").normalize("NFC").trim();
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function expandHome(value) {
  return value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
}

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (arg === "--apply") out.apply = true;
    else if (arg.startsWith("--")) {
      const [key, ...rest] = arg.slice(2).split("=");
      out[key] = rest.join("=") || true;
    }
  }
  return out;
}
