#!/usr/bin/env node
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "archive-pilates";
const apply = process.argv.includes("--apply");

if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const snapshot = await db.collection("privateLessonChartRecords").where("gptStatus", "==", "pending").get();
const targets = snapshot.docs.filter((doc) => {
  const record = doc.data();
  return !record.postRecord || !record.postSubmittedAt;
});

let updated = 0;
if (apply && targets.length) {
  for (let offset = 0; offset < targets.length; offset += 400) {
    const batch = db.batch();
    for (const doc of targets.slice(offset, offset + 400)) {
      batch.set(
        doc.ref,
        {
          gptStatus: "waiting_post",
          gptStatusMigrationReason: "post_record_not_submitted",
          gptStatusMigratedAt: admin.firestore.Timestamp.now(),
          updatedAt: admin.firestore.Timestamp.now(),
        },
        { merge: true },
      );
      updated += 1;
    }
    await batch.commit();
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      mode: apply ? "apply" : "dry-run",
      projectId: PROJECT_ID,
      pendingChecked: snapshot.size,
      waitingPostTargets: targets.length,
      updated,
      sampleRecordIds: targets.slice(0, 10).map((doc) => doc.id),
    },
    null,
    2,
  ),
);
