#!/usr/bin/env node
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  hasDeletionBlockingReferences,
  hasCompleteCleanupMarkedRelations,
  isExpiredMediaSessionCandidate,
  isExpiredUnsignedSignupCandidate,
  isLiveValidationBookingEligible,
} from "./lib/operational-data-retention-policy.mjs";

const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");

const APPLY = process.argv.includes("--apply");
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "archive-pilates";
const REPORT_DIR = path.join(os.homedir(), "ArchiveIN/automation/reports/operational-data-retention");
const FieldPath = admin.firestore.FieldPath;
const Timestamp = admin.firestore.Timestamp;

if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();
const now = Timestamp.now();
const mediaCutoff = Timestamp.fromMillis(now.toMillis() - 7 * 24 * 60 * 60 * 1000);

const liveValidation = await findLiveValidationPurgeSet();
const mediaSessions = await findExpiredMediaSessions();
const signupContracts = await findExpiredSignupContracts();
const refs = [
  ...liveValidation.refs,
  ...mediaSessions.refs,
  ...signupContracts.refs,
];

if (APPLY && refs.length) {
  for (let offset = 0; offset < refs.length; offset += 400) {
    const batch = db.batch();
    for (const ref of refs.slice(offset, offset + 400)) batch.delete(ref);
    await batch.commit();
  }
}

const report = {
  ok: true,
  mode: APPLY ? "apply" : "dry-run",
  source: "expired_operational_data_retention",
  liveValidation: liveValidation.summary,
  mediaUploadSessions: mediaSessions.summary,
  unsignedSignupContracts: signupContracts.summary,
  plannedDeletes: refs.length,
  appliedDeletes: APPLY ? refs.length : 0,
  finishedAt: new Date().toISOString(),
};
mkdirSync(REPORT_DIR, { recursive: true });
const reportPath = path.join(
  REPORT_DIR,
  `${new Date().toISOString().replace(/[:.]/g, "-")}-${APPLY ? "apply" : "dry-run"}.json`,
);
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, reportPath }, null, 2));

async function findLiveValidationPurgeSet() {
  const snap = await db
    .collection("bookings")
    .where(FieldPath.documentId(), ">=", "live_validation_")
    .where(FieldPath.documentId(), "<", "live_validation_\uf8ff")
    .get();
  const refs = [];
  let eligibleSets = 0;
  let skippedSets = 0;
  for (const bookingSnap of snap.docs) {
    const booking = bookingSnap.data() || {};
    if (!isLiveValidationBookingEligible(bookingSnap.id, booking)) {
      skippedSets += 1;
      continue;
    }
    const bookingId = bookingSnap.id;
    const [sessions, requests, records, ledger, candidates, sends] = await Promise.all([
      docsByBookingId("privateLessonSessions", bookingId),
      docsByBookingId("privateLessonChartRequests", bookingId),
      docsByBookingId("privateLessonChartRecords", bookingId),
      docsByBookingId("privateSessionLedger", bookingId),
      docsByBookingId("alimtalkCandidates", bookingId),
      docsByBookingId("alimtalkSends", bookingId),
    ]);
    const related = [...sessions, ...requests, ...records];
    const allCleanupMarked = hasCompleteCleanupMarkedRelations(
      sessions.map((docSnap) => docSnap.data() || {}),
      requests.map((docSnap) => docSnap.data() || {}),
      records.map((docSnap) => docSnap.data() || {}),
    );
    if (
      !allCleanupMarked ||
      hasDeletionBlockingReferences(ledger, candidates, sends)
    ) {
      skippedSets += 1;
      continue;
    }
    refs.push(bookingSnap.ref, ...related.map((docSnap) => docSnap.ref));
    eligibleSets += 1;
  }
  return {
    refs,
    summary: {
      scannedSets: snap.size,
      eligibleSets,
      skippedSets,
      plannedDocuments: refs.length,
    },
  };
}

async function findExpiredMediaSessions() {
  const snap = await db
    .collection("privateLessonChartMediaUploadSessions")
    .where("updatedAt", "<=", mediaCutoff)
    .limit(200)
    .get();
  const refs = [];
  let skippedReferenced = 0;
  let skippedState = 0;
  for (const sessionSnap of snap.docs) {
    const session = sessionSnap.data() || {};
    if (!isExpiredMediaSessionCandidate(session)) {
      skippedState += 1;
      continue;
    }
    const recordId = String(session.recordId || "");
    const recordSnap = recordId
      ? await db.collection("privateLessonChartRecords").doc(recordId).get()
      : null;
    const mediaFiles = Array.isArray(recordSnap?.data()?.mediaFiles) ? recordSnap.data().mediaFiles : [];
    const referenced = mediaFiles.some((item) =>
      [item?.mediaId, item?.uploadId, item?.driveFileId]
        .filter(Boolean)
        .some((value) => [session.mediaId, session.uploadId, session.driveFileId].includes(value)),
    );
    if (referenced) {
      skippedReferenced += 1;
      continue;
    }
    refs.push(sessionSnap.ref);
  }
  return {
    refs,
    summary: {
      scanned: snap.size,
      eligible: refs.length,
      skippedReferenced,
      skippedState,
      cutoff: mediaCutoff.toDate().toISOString(),
    },
  };
}

async function findExpiredSignupContracts() {
  const snap = await db.collection("memberSignupContracts").where("purgeAfter", "<=", now).limit(100).get();
  const refs = snap.docs
    .filter((docSnap) => {
      const data = docSnap.data() || {};
      return isExpiredUnsignedSignupCandidate(data);
    })
    .map((docSnap) => docSnap.ref);
  return {
    refs,
    summary: {
      scanned: snap.size,
      eligible: refs.length,
    },
  };
}

async function docsByBookingId(collectionName, bookingId) {
  const snap = await db.collection(collectionName).where("bookingId", "==", bookingId).get();
  return snap.docs;
}
