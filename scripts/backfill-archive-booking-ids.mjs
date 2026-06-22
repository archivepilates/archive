#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");

const HOME = os.homedir();
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "archive-pilates";
const STUDIO_ID = process.env.STUDIOMATE_STUDIO_ID || process.env.MANAGER_STUDIO_ID || "5330";
const DEFAULT_CREDENTIALS = path.join(HOME, "ArchiveIN/secrets/google/archive-codex-operator.json");
const REPORT_DIR = path.join(HOME, "ArchiveIN/automation/reports/archive-booking-ids");
const KEY_VERSION = "v2";
const COMPUTED_FROM = "archiveBooking.identity.v2";

const args = parseArgs(process.argv.slice(2));
const config = {
  apply: Boolean(args.apply),
  studioId: String(args["studio-id"] || STUDIO_ID),
  startDate: String(args["start-date"] || ""),
  endDate: String(args["end-date"] || ""),
  maxWrites: Number(args["max-writes"] || "80000"),
  sampleLimit: Number(args["sample-limit"] || "20"),
  credentialsPath: expandHome(String(args.credentials || process.env.GOOGLE_APPLICATION_CREDENTIALS || DEFAULT_CREDENTIALS)),
};

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && existsSync(config.credentialsPath)) {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = config.credentialsPath;
}

if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  if (config.apply && !existsSync(config.credentialsPath)) {
    throw new Error(`Google credentials not found: ${config.credentialsPath}`);
  }

  const bookings = await loadBookings();
  const plans = buildPlans(bookings);
  const writes = plans.filter((plan) => plan.needsWrite);
  if (config.apply && writes.length > config.maxWrites) {
    throw new Error(`Planned writes ${writes.length} exceeds --max-writes ${config.maxWrites}`);
  }
  if (config.apply) await applyPlans(writes);

  const report = buildReport({ bookings, plans, writes });
  const reportPath = writeReport(report);
  console.log(JSON.stringify({ ...report, reportPath }, null, 2));
}

async function loadBookings() {
  let query = db.collection("bookings").where("studioId", "==", config.studioId);
  if (config.startDate) query = query.where("lectureDate", ">=", config.startDate);
  if (config.endDate) query = query.where("lectureDate", "<=", config.endDate);
  const snap = await query.get();
  return snap.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
}

function buildPlans(bookings) {
  const withIdentity = bookings.map((doc) => {
    const identity = archiveBookingIdentity(doc.data);
    return { ...doc, identity };
  });
  const byArchiveId = groupBy(withIdentity, (doc) => doc.identity.archiveBookingId);
  const canonicalByArchiveId = new Map();
  for (const [archiveBookingId, group] of byArchiveId.entries()) {
    canonicalByArchiveId.set(archiveBookingId, group.reduce(preferredCanonicalDoc));
  }

  return withIdentity.map((doc) => {
    const canonical = canonicalByArchiveId.get(doc.identity.archiveBookingId);
    const group = byArchiveId.get(doc.identity.archiveBookingId) || [doc];
    const isCanonical = canonical.id === doc.id;
    const patch = {
      archiveBookingId: doc.identity.archiveBookingId,
      canonicalBookingKey: doc.identity.archiveBookingId,
      archiveBookingKeyVersion: KEY_VERSION,
      archiveBooking: {
        id: doc.identity.archiveBookingId,
        keyVersion: KEY_VERSION,
        computedFrom: COMPUTED_FROM,
        occurrenceKeyHash: doc.identity.occurrenceKeyHash,
        sourceType: doc.identity.sourceType,
        sourcePriority: doc.identity.sourcePriority,
        isCanonical,
        canonicalBookingId: canonical.id,
        canonicalSourceType: canonical.identity.sourceType,
        duplicateGroupSize: group.length,
        supersededByBookingId: isCanonical ? null : canonical.id,
        duplicateReason: isCanonical ? null : "duplicate_source",
        computedAt: admin.firestore.Timestamp.now(),
      },
    };
    return {
      id: doc.id,
      data: doc.data,
      patch,
      identity: doc.identity,
      canonicalId: canonical.id,
      isCanonical,
      groupSize: group.length,
      needsWrite: needsPatch(doc.data, patch),
    };
  });
}

function archiveBookingIdentity(booking) {
  const sourceType = bookingSourceType(booking.bookingId || "");
  const sourcePriority = bookingSourcePriority(sourceType);
  const startKey = timestampKey(booking.lectureStartAt) || `${booking.lectureDate || ""}T${booking.startTime || ""}`;
  const memberKey = booking.memberId || phoneKey(booking.memberPhone) || normalizeText(booking.memberName);
  const staffKey = booking.staffId || normalizeText(booking.staffName);
  const lessonKey = normalizeText(booking.lessonType || booking.ticketClassType || booking.ticketName || "");
  const occurrenceKey = [
    booking.studioId || config.studioId,
    memberKey,
    staffKey,
    startKey,
    lessonKey,
  ].join("|");
  const occurrenceKeyHash = hash(occurrenceKey);
  return {
    archiveBookingId: `ab_${occurrenceKeyHash.slice(0, 24)}`,
    occurrenceKeyHash,
    sourceType,
    sourcePriority,
  };
}

function preferredCanonicalDoc(current, next) {
  const qualityDelta = bookingOperationalScore(next.data) - bookingOperationalScore(current.data);
  if (qualityDelta > 0) return next;
  if (qualityDelta < 0) return current;

  const sourceDelta = next.identity.sourcePriority - current.identity.sourcePriority;
  if (sourceDelta > 0) return next;
  if (sourceDelta < 0) return current;

  return String(next.id) < String(current.id) ? next : current;
}

function needsPatch(current, patch) {
  if (current.archiveBookingId !== patch.archiveBookingId) return true;
  if (current.canonicalBookingKey !== patch.canonicalBookingKey) return true;
  if (current.archiveBookingKeyVersion !== patch.archiveBookingKeyVersion) return true;
  const existing = current.archiveBooking || {};
  return [
    "id",
    "keyVersion",
    "computedFrom",
    "occurrenceKeyHash",
    "sourceType",
    "sourcePriority",
    "isCanonical",
    "canonicalBookingId",
    "canonicalSourceType",
    "duplicateGroupSize",
    "supersededByBookingId",
    "duplicateReason",
  ].some((key) => primitive(existing[key]) !== primitive(patch.archiveBooking[key]));
}

async function applyPlans(plans) {
  for (let index = 0; index < plans.length; index += 450) {
    const batch = db.batch();
    for (const plan of plans.slice(index, index + 450)) {
      batch.set(db.collection("bookings").doc(plan.id), plan.patch, { merge: true });
    }
    await batch.commit();
  }
}

function buildReport({ bookings, plans, writes }) {
  const duplicateGroups = new Map();
  for (const plan of plans) {
    if (plan.groupSize <= 1) continue;
    duplicateGroups.set(plan.patch.archiveBooking.id, [...(duplicateGroups.get(plan.patch.archiveBooking.id) || []), plan]);
  }
  const sourceTypes = countBy(plans, (plan) => plan.identity.sourceType);
  const duplicateSourceTypes = countBy(
    plans.filter((plan) => !plan.isCanonical),
    (plan) => plan.identity.sourceType,
  );
  return {
    ok: true,
    mode: config.apply ? "apply" : "dry-run",
    projectId: PROJECT_ID,
    studioId: config.studioId,
    keyVersion: KEY_VERSION,
    computedFrom: COMPUTED_FROM,
    selectedRange: { startDate: config.startDate || null, endDate: config.endDate || null },
    totals: {
      loadedBookings: bookings.length,
      plannedWrites: writes.length,
      archiveBookingGroups: new Set(plans.map((plan) => plan.identity.archiveBookingId)).size,
      duplicateGroups: duplicateGroups.size,
      duplicateDocuments: plans.filter((plan) => !plan.isCanonical).length,
    },
    sourceTypes,
    duplicateSourceTypes,
    duplicateSamples: [...duplicateGroups.values()].slice(0, config.sampleLimit).map((group) => ({
      archiveBookingId: group[0].identity.archiveBookingId,
      canonicalBookingId: group.find((plan) => plan.isCanonical)?.id || "",
      bookings: group.map((plan) => ({
        bookingId: plan.id,
        memberName: plan.data.memberName || "",
        memberId: plan.data.memberId || "",
        lectureDate: plan.data.lectureDate || "",
        lectureStartAt: timestampKey(plan.data.lectureStartAt),
        staffName: plan.data.staffName || "",
        sourceType: plan.identity.sourceType,
        attendanceStatus: plan.data.attendanceStatus || "",
        appStatus: plan.data.appStatus || "",
        isCanonical: plan.isCanonical,
        supersededByBookingId: plan.patch.archiveBooking.supersededByBookingId,
      })),
    })),
    warnings: [
      "archiveBookingId/canonicalBookingKey는 원천 예약 ID를 대체하지 않는 중복판별용 운영 ID입니다.",
      "중복 source 문서는 삭제하지 않고 archiveBooking.isCanonical=false 및 supersededByBookingId로 표시합니다.",
      "member-facing 발송/쓰기 로직은 별도 검증 후 archiveBookingId를 점진적으로 참조해야 합니다.",
    ],
    generatedAt: new Date().toISOString(),
    appliedAt: config.apply ? new Date().toISOString() : "",
  };
}

function bookingSourceType(bookingId) {
  const value = String(bookingId || "");
  if (value.startsWith("usage_booking_")) return "usage_history";
  if (value.startsWith("excel_booking_")) return "excel_fallback";
  if (/^\d+$/.test(value)) return "studiomate_booking_id";
  return "fallback";
}

function bookingSourcePriority(sourceType) {
  if (sourceType === "studiomate_booking_id") return 4;
  if (sourceType === "usage_history") return 3;
  if (sourceType === "excel_fallback") return 2;
  return 1;
}

function bookingOperationalScore(booking) {
  const appStatus = String(booking.appStatus || "");
  const attendanceStatus = String(booking.attendanceStatus || "");
  if (attendanceStatus === "attended") return 60;
  if (appStatus === "reserved" && attendanceStatus === "unchecked") return 50;
  if (appStatus === "reserved" && attendanceStatus === "absent") return 40;
  if (attendanceStatus === "absent") return 35;
  if (attendanceStatus === "late_cancel") return 30;
  if (appStatus === "wait") return 20;
  if (appStatus === "cancel" || appStatus === "wait_cancel") return 10;
  return 0;
}

function timestampKey(value) {
  const millis = timestampMillis(value);
  if (millis) return String(millis);
  if (value instanceof Date) return String(value.getTime());
  if (typeof value === "string" && value) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? String(parsed) : value;
  }
  return "";
}

function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  return 0;
}

function phoneKey(value) {
  return String(value || "").replace(/\D+/g, "");
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();
}

function primitive(value) {
  if (value == null) return "";
  return String(value);
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function groupBy(items, keyFn) {
  const grouped = new Map();
  for (const item of items) {
    const key = keyFn(item);
    grouped.set(key, [...(grouped.get(key) || []), item]);
  }
  return grouped;
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item) || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const [key, inlineValue] = arg.slice(2).split("=");
    parsed[key] = inlineValue ?? (argv[index + 1]?.startsWith("--") ? true : argv[++index] ?? true);
  }
  return parsed;
}

function expandHome(value) {
  if (!value) return "";
  return value.startsWith("~/") ? path.join(HOME, value.slice(2)) : value;
}

function writeReport(report) {
  mkdirSync(REPORT_DIR, { recursive: true });
  const reportPath = path.join(
    REPORT_DIR,
    `${new Date().toISOString().replace(/[:.]/g, "-")}-archive-booking-id-${config.apply ? "apply" : "dry-run"}.json`,
  );
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return reportPath;
}
