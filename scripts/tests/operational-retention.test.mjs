import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  hasDeletionBlockingReferences,
  hasCompleteCleanupMarkedRelations,
  isExpiredMediaSessionCandidate,
  isExpiredUnsignedSignupCandidate,
  isLiveValidationBookingEligible,
  shouldApplyOperationalDataPurge,
} from "../lib/operational-data-retention-policy.mjs";
import {
  inactivePrivateBookingReason,
  isExcludedPrivateBooking,
  isPrivateBooking,
} from "../lib/private-session-order-policy.mjs";

const cleanup = { sourceStatus: "live_validation_cleanup_test" };

test("operational data policy accepts only fully marked synthetic sets", () => {
  assert.equal(
    isLiveValidationBookingEligible("live_validation_1", {
      appStatus: "cancel",
      sourceStatus: "live_validation_cancelled",
      sessionOrder: { excludedReason: "live_validation_cleanup_test" },
    }),
    true,
  );
  assert.equal(
    isLiveValidationBookingEligible("booking_1", {
      appStatus: "cancel",
      sourceStatus: "live_validation_cancelled",
      sessionOrder: { excludedReason: "live_validation_cleanup_test" },
    }),
    false,
  );
  assert.equal(hasCompleteCleanupMarkedRelations([cleanup], [cleanup], [cleanup]), true);
  assert.equal(hasCompleteCleanupMarkedRelations([cleanup], [], [cleanup]), false);
  assert.equal(hasCompleteCleanupMarkedRelations([cleanup], [{}], [cleanup]), false);
  assert.equal(hasDeletionBlockingReferences([], [], []), false);
  assert.equal(hasDeletionBlockingReferences([{ bookingId: "booking_1" }], [], []), true);
  assert.equal(hasDeletionBlockingReferences([], [{ bookingId: "booking_1" }], []), true);
  assert.equal(hasDeletionBlockingReferences([], [], [{ bookingId: "booking_1" }]), true);
});

test("operational data policy protects completed media and signed contracts", () => {
  assert.equal(isExpiredMediaSessionCandidate({ status: "pending" }), true);
  assert.equal(isExpiredMediaSessionCandidate({ status: "failed" }), true);
  assert.equal(isExpiredMediaSessionCandidate({ status: "attached" }), false);
  assert.equal(
    isExpiredMediaSessionCandidate({ status: "failed", driveFileId: "drive_1" }),
    false,
  );
  assert.equal(isExpiredUnsignedSignupCandidate({ status: "expired" }), true);
  assert.equal(
    isExpiredUnsignedSignupCandidate({ status: "expired", submittedAt: "submitted" }),
    false,
  );
  assert.equal(
    isExpiredUnsignedSignupCandidate({ status: "cancelled", signature: "signed" }),
    false,
  );
});

test("Firestore purge requires its explicit flag and attached media clears TTL", () => {
  assert.equal(shouldApplyOperationalDataPurge({ repair: true }), false);
  assert.equal(shouldApplyOperationalDataPurge({ apply: true }), false);
  assert.equal(
    shouldApplyOperationalDataPurge({ repair: true, "purge-operational-data": true }),
    true,
  );

  const mediaSource = readFileSync(
    path.resolve(
      "firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonMedia.ts",
    ),
    "utf8",
  );
  assert.match(
    mediaSource,
    /status:\s*"attached"[\s\S]{0,260}expireAt:\s*FieldValue\.delete\(\)/,
  );
});

test("private-session verification uses the same countability policy as the ledger", () => {
  const futurePrivate = {
    lessonType: "private",
    appStatus: "reserved",
    attendanceStatus: "unchecked",
    lectureDate: "2026-08-01",
  };
  assert.equal(isPrivateBooking(futurePrivate), true);
  assert.equal(isExcludedPrivateBooking(futurePrivate, { todayKst: "2026-07-30" }), false);

  const pastUnchecked = { ...futurePrivate, lectureDate: "2026-07-29" };
  assert.equal(
    inactivePrivateBookingReason(pastUnchecked, { todayKst: "2026-07-30" }),
    "past_unchecked_attendance",
  );
  assert.equal(isExcludedPrivateBooking(pastUnchecked, { todayKst: "2026-07-30" }), true);

  const pastAttended = { ...pastUnchecked, attendanceStatus: "attended" };
  assert.equal(isExcludedPrivateBooking(pastAttended, { todayKst: "2026-07-30" }), false);

  assert.equal(
    isExcludedPrivateBooking({ ...futurePrivate, sourceStatus: "missing_from_latest_reservation_import" }),
    true,
  );
  assert.equal(
    isExcludedPrivateBooking({ ...futurePrivate, archiveBooking: { isCanonical: false } }),
    true,
  );
  assert.equal(
    isExcludedPrivateBooking({ ...futurePrivate, bookingId: "usage_booking_history_mirror" }),
    true,
  );
  assert.equal(isPrivateBooking({ lessonType: "group", ticketName: "프라이빗 오표기" }), false);
});

test("HohoYoga snapshot retries transient response-body failures", () => {
  const source = readFileSync(path.resolve("scripts/hohoyoga-monitor-snapshot.mjs"), "utf8");
  assert.match(source, /connection:\s*"close"/);
  assert.match(source, /async function requestText[\s\S]*attempt <= 5/);
  assert.match(source, /isTransientNetworkError[\s\S]*EPIPE/);
});

test("local artifact compaction keeps work and failure records", () => {
  const home = mkdtempSync(path.join(tmpdir(), "archive-retention-"));
  const reportDir = path.join(home, "ArchiveIN/automation/reports/admin-emergency-sync");
  const runDir = path.join(home, "ArchiveIN/emergency/runs");
  mkdirSync(reportDir, { recursive: true });
  mkdirSync(runDir, { recursive: true });

  const emptyPath = path.join(reportDir, "empty.json");
  const workPath = path.join(reportDir, "work.json");
  const failedPath = path.join(reportDir, "failed.json");
  writeFileSync(emptyPath, JSON.stringify({ ok: true, processed: [] }));
  writeFileSync(workPath, JSON.stringify({ ok: true, processed: [{ id: "job" }] }));
  writeFileSync(failedPath, JSON.stringify({ ok: false, processed: [] }));

  const onsitePath = path.join(runDir, "onsite-welcome.jsonl");
  writeFileSync(
    onsitePath,
    [
      JSON.stringify({ ok: true, processed: 0 }),
      JSON.stringify({ ok: true, processed: 2 }),
      JSON.stringify({ ok: false, processed: 0 }),
      JSON.stringify({ ok: true, processed: 0 }),
    ].join("\n") + "\n",
  );

  const result = spawnSync(
    process.execPath,
    [path.resolve("scripts/prune-operational-artifacts.mjs"), "--apply"],
    { cwd: path.resolve("."), env: { ...process.env, HOME: home }, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.emptyAdminReports.deleted, 1);
  assert.equal(readFileSync(workPath, "utf8").includes("job"), true);
  assert.equal(readFileSync(failedPath, "utf8").includes('"ok":false'), true);
  const retained = readFileSync(onsitePath, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(retained.length, 3);
  assert.equal(retained.some((row) => row.processed === 2), true);
  assert.equal(retained.some((row) => row.ok === false), true);
  assert.deepEqual(retained.at(-1), { ok: true, processed: 0 });
});
