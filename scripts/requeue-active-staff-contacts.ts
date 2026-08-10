#!/usr/bin/env node
import process from "node:process";
import type { StaffDoc } from "../firebase/kangsain-functions/functions/src/types/models";

const APPLY = process.argv.includes("--apply");
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "archive-pilates";
const DEFAULT_KEY_FILE = "/Users/archivepilates/ArchiveIN/secrets/google/archive-codex-operator.json";

process.env.GOOGLE_APPLICATION_CREDENTIALS ||= DEFAULT_KEY_FILE;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const [{ db }, { formatStaffContactDisplayName, queueActiveStaffContactSync }] = await Promise.all([
    import("../firebase/kangsain-functions/functions/src/config/firebase"),
    import("../firebase/kangsain-functions/functions/src/sync/queueStaffContactSync"),
  ]);

  const snapshot = await db.collection("staffs").where("active", "==", true).get();
  const candidates: StaffDoc[] = snapshot.docs
    .map((doc) => doc.data() as StaffDoc)
    .filter((staff) => Boolean(staff.staffId && staff.name?.trim() && normalizePhone(staff.phone || "")));

  const planned: Array<{ staffId: string; name: string; currentName: string; desiredName: string }> = [];
  for (const staff of candidates) {
    const desiredName = formatStaffContactDisplayName(staff);
    const contact = (await db.collection("memberContactIndex").doc(`staff_${staff.staffId}`).get()).data();
    if (contact?.contactDisplayName === desiredName && contact?.contactTargets?.home_archivepilates === "synced") {
      continue;
    }
    planned.push({
      staffId: staff.staffId,
      name: staff.name,
      currentName: String(contact?.contactDisplayName || ""),
      desiredName,
    });
  }

  if (!APPLY) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: "dry-run",
          projectId: PROJECT_ID,
          activeStaffCount: candidates.length,
          plannedCount: planned.length,
          planned,
        },
        null,
        2,
      ),
    );
    return;
  }

  const queued: Array<{ staffId: string; name: string; jobId: string }> = [];
  const skipped: Array<{ staffId: string; name: string }> = [];
  for (const item of planned) {
    const staff = candidates.find((candidate) => candidate.staffId === item.staffId);
    if (!staff) continue;
    const result = await queueActiveStaffContactSync(staff);
    if (result.queued && result.jobId) {
      queued.push({ staffId: staff.staffId, name: staff.name, jobId: result.jobId });
    } else {
      skipped.push({ staffId: staff.staffId, name: staff.name });
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: "apply",
        projectId: PROJECT_ID,
        activeStaffCount: candidates.length,
        plannedCount: planned.length,
        queuedCount: queued.length,
        skippedCount: skipped.length,
        queued,
        skipped,
      },
      null,
      2,
    ),
  );
}

function normalizePhone(value: string): string {
  let digits = String(value || "").replace(/\D+/g, "");
  if (digits.startsWith("82") && digits.length >= 11) digits = `0${digits.slice(2)}`;
  if (digits.length === 10 && digits.startsWith("10")) digits = `0${digits}`;
  return digits;
}
