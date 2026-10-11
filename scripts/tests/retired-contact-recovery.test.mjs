import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const read = (file) => readFile(new URL(`../../${file}`, import.meta.url), "utf8");

test("obsolete contact recovery entrypoint is absent", async () => {
  await assert.rejects(access(new URL("../run-emergency-contacts-hourly-sync.mjs", import.meta.url)), { code: "ENOENT" });
});

test("operator guide no longer recommends obsolete contact execution or paused policy", async () => {
  const guide = await read("docs/studiomate-excel-emergency-mode.md");
  assert.doesNotMatch(guide, /node scripts\/run-emergency-contacts-hourly-sync\.mjs/);
  assert.doesNotMatch(guide, /`PAUSED`/);
  assert.match(guide, /`scheduledProcessContactSyncJobs`는 `ENABLED`, 10분/);
});

test("current Excel runner queues contacts without changing scheduler state", async () => {
  const runner = await read("scripts/run-studiomate-excel-emergency-mode.mjs");
  assert.match(runner, /--queue-contact-sync/);
  assert.doesNotMatch(runner, /resumeContactScheduler|pauseContactScheduler|gcloud.*scheduler/);
});

test("replacement remains wired to current runtime and ten minute sync export", async () => {
  const plist = await read("firebase/kangsain-functions/macmini-studiomate/com.archive.studiomate-excel-emergency-mode.plist");
  assert.match(plist, /archive-in-runtime\/scripts\/run-studiomate-excel-emergency-mode\.mjs/);
  const sync = await read("firebase/kangsain-functions/functions/src/exports/sync.ts");
  assert.match(sync, /scheduledProcessContactSyncJobs/);
  assert.match(sync, /every 10 minutes/);
});
