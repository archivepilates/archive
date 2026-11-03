import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const expected = args.find(arg => arg.startsWith("--expected="))?.slice(11);
if (new Set(args).size !== args.length || args.some(arg => arg !== "--apply" && arg !== `--expected=${expected}`) ||
  expected && !/^[a-f0-9]{64}$/.test(expected) || apply && !expected) throw Error("Invalid repair arguments");
const git = args => execFileSync("git", args, { encoding: "utf8" }).trim();
if (apply && (git(["branch", "--show-current"]) !== "main" || git(["status", "--porcelain"]) ||
  git(["rev-parse", "HEAD"]) !== git(["rev-parse", "origin/main"]))) throw Error("Apply requires clean main equal to origin/main");
const require = createRequire(path.resolve("firebase/kangsain-functions/functions/package.json"));
const admin = require("firebase-admin");
const { privateNotionCancelledDeferral } = require(path.resolve("firebase/kangsain-functions/functions/lib/privateLessonChart/privateLessonNotionSync.js"));
const { stableHash } = require(path.resolve("firebase/kangsain-functions/functions/lib/utils/hash.js"));
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(os.homedir(), "ArchiveIN/secrets/google/archive-codex-operator.json");
admin.initializeApp({ projectId: "archive-pilates" });
const db = admin.firestore();
const id = "plc_281189166";
const recordRef = db.doc(`privateLessonChartRecords/${id}`);
const requestRef = db.doc(`privateLessonChartRequests/${id}`);
const auditRef = db.doc("workLanes/ops-health-errors-20261103/reports/notion-empty-cancellation");
const sourceHash = record => { const { notionSync, ...source } = record; return stableHash(source); };
async function read(reader) {
  const record = await reader(recordRef), request = await reader(requestRef);
  if (!record.exists || !request.exists || record.data()?.recordId !== id || record.data()?.requestId !== id)
    throw Error("Canonical incident source unavailable");
  const data = record.data(), requestData = request.data();
  const leaseReady = [data.notionProjectionLease?.untilMs, data.notionSync?.leaseUntilMs]
    .map(value => Number(value ?? 0)).every(value => Number.isFinite(value) && value <= Date.now());
  const next = leaseReady
    ? privateNotionCancelledDeferral(data, requestData) : null;
  if (next) { delete next.leaseToken; delete next.leaseUntilMs; }
  return { data, requestData, next, sourceHash: sourceHash(data),
    fingerprint: stableHash({ record: data, request: requestData,
      recordUpdated: record.updateTime, requestUpdated: request.updateTime }) };
}
try {
  const row = await read(ref => ref.get());
  if (!apply) console.log(JSON.stringify({ mode: "plan", recordId: id, eligible: Boolean(row.next), fingerprint: row.fingerprint }));
  else {
    if (!row.next || row.fingerprint !== expected) throw Error("Source changed or cancellation guard failed");
    const afterHash = await db.runTransaction(async tx => {
      const audit = await tx.get(auditRef);
      if (audit.exists) throw Error("Prior recovery exists; read back instead of replay");
      const current = await read(ref => tx.get(ref));
      if (!current.next || current.fingerprint !== expected) throw Error("Concurrent source change");
      tx.create(auditRef, { operation: "metadata_only_empty_cancellation", at: new Date().toISOString(),
        sourceCommit: git(["rev-parse", "HEAD"]), recordId: id, fingerprint: expected,
        beforeSync: current.data.notionSync, afterSyncHash: stableHash(current.next), businessHash: current.sourceHash,
        requestHash: stableHash(current.requestData), externalWrites: 0 });
      tx.update(recordRef, { notionSync: current.next });
      return stableHash(current.next);
    });
    const verified = await read(ref => ref.get());
    if (verified.sourceHash !== row.sourceHash || stableHash(verified.requestData) !== stableHash(row.requestData) ||
      stableHash(verified.data.notionSync) !== afterHash) throw Error("Recovery readback mismatch; do not replay");
    console.log(JSON.stringify({ mode: "apply", verified: true, recordId: id,
      businessFieldsUnchanged: true, externalWrites: 0, state: "cancelled_without_submission" }));
  }
} finally { await admin.app().delete(); }
