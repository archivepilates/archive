import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const require = createRequire(new URL("firebase/kangsain-functions/functions/package.json", root));
const { GoogleAuth } = require("google-auth-library");
const client = await new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] }).getClient();
const project = "archive-pilates";
const region = "asia-northeast3";
const retired = ["scheduledProcessWriteQueue", "scheduledSyncDashboardDaily", "scheduledAttendanceReminder"];
const read = async (url) => (await client.request({ url, method: "GET", retry: false, timeout: 30000 })).data;
const report = { checkedAt: new Date().toISOString(), project, retired: [], functions: [], schedulers: [], indexes: [] };

try {
  const functions = [];
  let pageToken;
  do {
    const query = new URLSearchParams({ pageSize: "1000", ...(pageToken ? { pageToken } : {}) });
    const data = await read(`https://cloudfunctions.googleapis.com/v2/projects/${project}/locations/${region}/functions?${query}`);
    functions.push(...(data.functions || []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  for (const codebase of ["sync", "private-chart", "app", "social"]) {
    const endpoints = require(fileURLToPath(new URL(`firebase/function-codebases/${codebase}/lib/index.js`, root)));
    for (const [name, handler] of Object.entries(endpoints)) {
      const endpoint = handler.__endpoint;
      if (!endpoint) continue;
      const live = functions.find((item) => item.name.endsWith(`/${name}`));
      assert.equal(live?.state, "ACTIVE", `${name} must be ACTIVE`);
      const expected = (endpoint.secretEnvironmentVariables || []).map((item) => item.key).sort();
      const actual = (live.serviceConfig?.secretEnvironmentVariables || []).map((item) => item.key).sort();
      assert.deepEqual(actual, expected, `${name} secret bindings differ`);
      report.functions.push({ name, state: live.state, secretCount: actual.length, updateTime: live.updateTime });
    }
    // Each physical codebase initializes its own default app in production.
    const { getApps, deleteApp } = require("firebase-admin/app");
    for (const app of getApps()) await deleteApp(app);
  }
  for (const name of retired) {
    assert.ok(!functions.some((item) => item.name.endsWith(`/${name}`)), `${name} still exists`);
    try {
      await read(`https://cloudscheduler.googleapis.com/v1/projects/${project}/locations/${region}/jobs/firebase-schedule-${name}-${region}`);
      throw new Error(`${name} Scheduler still exists`);
    } catch (error) {
      assert.equal(error.response?.status, 404, `${name} needs authoritative 404`);
      report.retired.push({ name, schedulerStatus: 404, functionAbsent: true });
    }
  }
  for (const name of ["scheduledProcessAlimtalkQueue", "scheduledProcessContactSyncJobs", "scheduledSyncPrivateSurveyResponses", "scheduledCreateParkingDiscountJobs", "scheduledPublishInstagramContent"]) {
    const job = await read(`https://cloudscheduler.googleapis.com/v1/projects/${project}/locations/${region}/jobs/firebase-schedule-${name}-${region}`);
    assert.equal(job.state, "ENABLED", `${name} disabled`);
    assert.ok(["every 10 minutes", "*/10 * * * *"].includes(job.schedule), `${name} cadence changed`);
    report.schedulers.push({ name, state: job.state, schedule: job.schedule });
  }
  const indexes = await read(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/collectionGroups/socialPublishJobs/indexes`);
  assert.ok(!indexes.nextPageToken, "Incomplete index response");
  for (const field of ["nextRunAt", "updatedAt"]) {
    const index = (indexes.indexes || []).find((item) => item.name.includes("/socialPublishJobs/") &&
      item.queryScope === "COLLECTION" && item.fields[0]?.fieldPath === "status" && item.fields[1]?.fieldPath === field &&
      item.fields[0]?.order === "ASCENDING" && item.fields[1]?.order === "ASCENDING");
    assert.equal(index?.state, "READY", `social index ${field} not ready`);
    report.indexes.push({ field, state: index.state, name: index.name });
  }
  const { Firestore, Timestamp } = require("@google-cloud/firestore");
  const db = new Firestore({ projectId: project });
  try {
    const { loadDueSocialPublishJobs } = require(fileURLToPath(new URL("firebase/function-codebases/social/lib/social/socialDueJobs.js", root)));
    const jobs = await loadDueSocialPublishJobs(db.collection("socialPublishJobs"), Timestamp.now());
    report.dueSocialJobs = jobs.length;
  } finally { await db.terminate(); }
  const html = await fetch("https://core.archivepilates.com/rules/", { cache: "no-store" });
  assert.equal(html.status, 200);
  assert.ok((await html.text()).includes("2026-09-27 반복 조회와 권한 연결 정리"));
  report.coreRules = "verified";
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.error = error.response?.data?.error?.message || error.message;
  process.exitCode = 1;
}
const output = process.argv[2];
if (output) writeFileSync(output, JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
