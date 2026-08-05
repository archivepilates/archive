#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { db } from "../firebase/kangsain-functions/functions/src/config/firebase";
import { DelegatedGoogleClient } from "../firebase/kangsain-functions/functions/src/google/delegatedGoogleClient";
import type {
  PrivateLessonChartRecordDoc,
  PrivateLessonChartRequestDoc,
} from "../firebase/kangsain-functions/functions/src/types/models";

const apply = process.argv.includes("--apply");
const requestIds = valueArg("--request-ids")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const notionToken = process.env.NOTION_TOKEN || "";
const allowedId = /^plc_(?:(?:editval|mediaval)-\d{8}-\d{4}|weekly_e2e_kim_\d{8}_\d{4})$/;
const outDir = path.join(os.homedir(), "ArchiveIN/automation/reports/private-live-validation-cleanup");

if (!requestIds.length) throw new Error("--request-ids is required.");
if (requestIds.some((id) => !allowedId.test(id))) {
  throw new Error("Only known private-flow validation IDs can be cleaned.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const rows = [];
  const driveClient = apply ? new DelegatedGoogleClient(["https://www.googleapis.com/auth/drive"]) : null;
  for (const requestId of requestIds) {
    const [requestSnap, recordSnap, sessionSnap, mediaSnap, candidateSnap, sendSnap] =
      await Promise.all([
        db.collection("privateLessonChartRequests").doc(requestId).get(),
        db.collection("privateLessonChartRecords").doc(requestId).get(),
        db.collection("privateLessonSessions").doc(requestId).get(),
        db.collection("privateLessonChartMediaUploadSessions").where("requestId", "==", requestId).get(),
        db.collection("alimtalkCandidates").where("sourceActionKey", "==", requestId).get(),
        db.collection("alimtalkSends").where("sourceActionKey", "==", requestId).get(),
      ]);
    if (!sendSnap.empty) throw new Error(`Refusing cleanup because ${requestId} has send history.`);
    const request = requestSnap.data() as PrivateLessonChartRequestDoc | undefined;
    const record = recordSnap.data() as PrivateLessonChartRecordDoc | undefined;
    const bookingId = String(request?.bookingId || record?.bookingId || `live_validation_${requestId}`);
    const [bookingSnap, ledgerSnap] = await Promise.all([
      db.collection("bookings").doc(bookingId).get(),
      db.collection("privateSessionLedger").where("bookingId", "==", bookingId).get(),
    ]);
    const notionPageIds = uniqueStrings([record?.notionSync?.pageId, record?.notionSync?.instructorPageId]);
    const driveFolderIds = uniqueStrings([record?.media?.sessionFolderId]);
    const firestoreRefs = [
      requestSnap.exists ? requestSnap.ref : null,
      recordSnap.exists ? recordSnap.ref : null,
      sessionSnap.exists ? sessionSnap.ref : null,
      bookingSnap.exists ? bookingSnap.ref : null,
      ...mediaSnap.docs.map((doc) => doc.ref),
      ...ledgerSnap.docs.map((doc) => doc.ref),
    ].filter(Boolean);

    if (apply) {
      if (notionPageIds.length && !notionToken) throw new Error("NOTION_TOKEN is required for Notion cleanup.");
      for (const pageId of notionPageIds) await archiveNotionPage(pageId);
      for (const folderId of driveFolderIds) {
        await driveClient?.request(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?supportsAllDrives=true`,
          { method: "DELETE" },
        );
      }
      for (let offset = 0; offset < firestoreRefs.length; offset += 400) {
        const batch = db.batch();
        for (const ref of firestoreRefs.slice(offset, offset + 400)) batch.delete(ref!);
        await batch.commit();
      }
      const now = new Date();
      for (const candidate of candidateSnap.docs) {
        if (["candidate", "queued", "processing", "failed"].includes(String(candidate.data().status || ""))) {
          await candidate.ref.set(
            {
              status: "skipped",
              reasonCode: "live_validation_cleanup",
              lastError: "라이브 검증 종료 후 발송 차단",
              updatedAt: now,
            },
            { merge: true },
          );
        }
      }
    }

    rows.push({
      requestId,
      bookingId,
      firestoreDocuments: firestoreRefs.map((ref) => ref!.path),
      notionPageIds,
      driveFolderIds,
      candidateIds: candidateSnap.docs.map((doc) => doc.id),
    });
  }

  const report = {
    ok: true,
    mode: apply ? "apply" : "dry-run",
    generatedAt: new Date().toISOString(),
    requestIds,
    rows,
  };
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(
    outDir,
    `${new Date().toISOString().replace(/[:.]/g, "-")}-${apply ? "apply" : "dry-run"}.json`,
  );
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, outPath }, null, 2));
}

async function archiveNotionPage(pageId: string): Promise<void> {
  const response = await fetch(`https://api.notion.com/v1/pages/${encodeURIComponent(pageId)}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${notionToken}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28",
    },
    body: JSON.stringify({ archived: true }),
  });
  if (!response.ok) throw new Error(`Notion cleanup failed ${response.status}: ${await response.text()}`);
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function valueArg(name: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "") : "";
}
