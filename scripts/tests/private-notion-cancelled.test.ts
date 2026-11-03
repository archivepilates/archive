import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import {
  PRIVATE_NOTION_IDENTITY_MISMATCH, privateNotionCanSkipCancelled,
  PrivateNotionAwaitingSubmission, privateNotionSourceChanged, runPrivateNotionProjection,
} from "../../firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonNotionSync";
import { privateNotionMemberIdentity } from "../../firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonNotionMemberPage";
import { classifyNotionDocument } from "../lib/system-health-queue-policy.mjs";

function harness() {
  const row: any = {
    record: { recordId: "synthetic", requestId: "synthetic", studioId: "5330", memberId: "1",
      staffId: "2", bookingId: "3", gptStatus: "waiting_post", cancelledAt: "2026-11-02T00:00:00Z",
      notionSync: { status: "failed", error: PRIVATE_NOTION_IDENTITY_MISMATCH,
        failedAt: "2026-11-02T01:00:00Z", attemptedVersion: "previous-attempt" } },
    request: { requestId: "synthetic", studioId: "5330", memberId: "1", staffId: "2", bookingId: "3",
      status: "cancelled", cancelledAt: "2026-11-02T00:00:00Z", preStatus: "pending", postStatus: "pending" },
  };
  let writes = 0, calls = 0;
  return { row, get writes() { return writes; }, get calls() { return calls; },
    run: (overrides: any = {}) => runPrivateNotionProjection("synthetic", {
      store: { transact: async (_id, update) => {
        const change = update(structuredClone(row));
        if (change.state) { row.record.notionSync = structuredClone(change.state); writes++; }
        return change.result;
      } },
      version: () => "presentation",
      project: async () => { calls++; return { status: "synced", syncedAt: "synthetic-success" }; },
      retryFailures: true,
      ...overrides,
    }),
  };
}

test("empty source-confirmed cancellation is deferred without provider calls or fabricated sync", async () => {
  const h = harness();
  const record = structuredClone(h.row.record), request = structuredClone(h.row.request);
  assert.equal(await h.run(), "skipped");
  assert.equal(h.calls, 0);
  assert.equal(h.writes, 1);
  const sync = h.row.record.notionSync;
  assert.equal(sync.status, "pending");
  assert.equal(sync.deferredReason, "cancelled_without_submission");
  assert.equal(sync.syncedAt, undefined);
  assert.equal(sync.failedAt, record.notionSync.failedAt);
  assert.equal(sync.attemptedVersion, record.notionSync.attemptedVersion);
  assert.deepEqual(h.row.request, request);
  const { notionSync: _before, ...before } = record;
  const { notionSync: _after, ...after } = h.row.record;
  assert.deepEqual(after, before);
  assert.equal(classifyNotionDocument(h.row.record).state, "cancelled_without_submission");
  assert.equal(await h.run(), "skipped");
  assert.equal(h.writes, 1);
  assert.equal(h.calls, 0);
});

test("actual projection adapter keeps cancellation guards and resumes only after source eligibility", async () => {
  const require = createRequire(path.resolve("firebase/kangsain-functions/functions/package.json"));
  const ts = require("typescript");
  const file = "firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonChart.ts";
  const tree = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);
  const node = tree.statements.find((n: any) => ts.isFunctionDeclaration(n) && n.name?.text === "syncPrivateLessonChartRecordToNotion");
  assert.ok(node);
  const code = ts.transpileModule(node.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const root = "a".repeat(32);
  const profile = { memberId: "1", name: "Synthetic", phone: "01000000001", studioId: "5330" };
  const staff = { staffId: "2", studioId: "5330", active: true, name: "Synthetic", role: "instructor" };
  const project = vm.runInNewContext(`${code}\nsyncPrivateLessonChartRecordToNotion`, {
    PrivateNotionAwaitingSubmission, canExposePrivateLessonReport: () => false,
    privateLessonNotionProjectionVersion: () => "presentation",
    errorMessage: (error: Error) => error.message,
    syncInstructorMemberChartPage: async (record: any, request: any) => {
      const identity = privateNotionMemberIdentity(record, request, profile, staff, root, root, { deferUnsubmitted: true });
      if (identity.awaitingSubmission) throw new PrivateNotionAwaitingSubmission();
      return { pageId: "synthetic-page", pageUrl: "https://www.notion.so/synthetic" };
    },
  });
  const h = harness();
  h.row.record.memberPhone = profile.phone;
  h.row.request.memberPhone = profile.phone;
  const run = () => h.run({ project: ({ record, request }: any, checkpoint: any) => project(record, request, checkpoint) });
  await run();
  h.row.record.postSubmittedAt = "submitted";
  h.row.request.postStatus = "submitted";
  assert.equal(await run(), "failed");
  assert.equal(h.row.record.notionSync.syncedAt, undefined);
  h.row.record.postSubmittedAt = null;
  h.row.request.postStatus = "pending";
  h.row.record.cancelledAt = null;
  h.row.request.cancelledAt = null;
  h.row.request.status = "pending";
  assert.equal(await run(), "pending");
  assert.equal(h.row.record.notionSync.deferredReason, "awaiting_submission");
  h.row.record.postSubmittedAt = "submitted";
  h.row.request.postStatus = "submitted";
  assert.equal(await run(), "synced");
  assert.equal(h.row.record.notionSync.instructorPageId, "synthetic-page");
});

test("runner preserves active leases and uncertain create checkpoints", async () => {
  const active = harness();
  active.row.record.notionSync.leaseUntilMs = Date.now() + 60_000;
  const before = structuredClone(active.row);
  assert.equal(await active.run(), "skipped");
  assert.equal(active.calls, 0);
  assert.equal(active.writes, 0);
  assert.deepEqual(active.row, before);
  const uncertain = harness();
  uncertain.row.record.notionSync.creationTitle = "uncertain-create";
  assert.equal(await uncertain.run({ project: async (_source: any, checkpoint: any) => {
    await checkpoint({ instructorPageId: "existing-checkpoint" });
    throw Error("uncertain content write");
  } }), "failed");
  assert.equal(uncertain.row.record.notionSync.creationTitle, "uncertain-create");
  assert.equal(uncertain.row.record.notionSync.instructorPageId, "existing-checkpoint");
  assert.equal(uncertain.row.record.notionSync.deferredReason, "");
});

test("reactivation or new submissions resume ordinary projection", async () => {
  for (const kind of ["reactivate", "submission"]) {
    const h = harness();
    await h.run();
    const before = structuredClone(h.row.record);
    if (kind === "reactivate") {
      h.row.record.cancelledAt = null;
      h.row.request.cancelledAt = null;
      h.row.request.status = "pending";
    } else h.row.record.postRecord = { summary: "synthetic" };
    assert.equal(privateNotionSourceChanged(before, h.row.record), true);
    assert.equal(await h.run(), "synced");
    assert.equal(h.calls, 1);
    assert.equal(h.row.record.notionSync.deferredReason, "");
  }
});

const unsafeChanges: Record<string, (row: any) => void> = {
  missingRequest: (r) => { r.request = undefined; },
  activeRequest: (r) => { r.request.status = "pending"; },
  missingCancellation: (r) => { r.request.cancelledAt = null; },
  differentStudio: (r) => { r.request.studioId = "other"; },
  recordAlias: (r) => { r.record.recordId = "other"; },
  mismatchedMember: (r) => { r.request.memberId = "other"; },
  mismatchedStaff: (r) => { r.request.staffId = "other"; },
  mismatchedBooking: (r) => { r.request.bookingId = "other"; },
  mismatchedRequest: (r) => { r.request.requestId = "other"; },
  submittedRequest: (r) => { r.request.postStatus = "submitted"; },
  preSubmission: (r) => { r.record.preSubmittedAt = "submitted"; },
  submittedAnswers: (r) => { r.record.postAnswers = { synthetic: true }; },
  generatedReport: (r) => { r.record.gptDraftSummary = "synthetic"; },
  completedSync: (r) => { r.record.notionSync.status = "synced"; },
  publishedReport: (r) => { r.record.publicReportUrl = "https://example.com/synthetic"; },
  media: (r) => { r.record.media = { files: [] }; },
  approvedReport: (r) => { r.record.publicReportApproval = { status: "pending" }; },
  existingSession: (r) => { r.record.notionSync.instructorPageId = "page"; },
  existingParent: (r) => { r.record.notionProjectionControl = { memberPageId: "parent" }; },
  existingPage: (r) => { r.record.notionPageUrl = "https://www.notion.so/synthetic"; },
  uncertainCreate: (r) => { r.record.notionSync.creationTitle = "uncertain"; },
  unknownTransport: (r) => { r.record.notionSync.error = "provider timeout"; },
  historicalSuccess: (r) => { r.record.notionSync.syncedAt = "historical"; },
  existingVersion: (r) => { r.record.notionSync.sourceVersion = "historical"; },
  lease: (r) => { r.record.notionSync.leaseToken = "unresolved"; },
  recordLease: (r) => { r.record.notionProjectionLease = { token: "unresolved", untilMs: 0 }; },
};
for (const [name, change] of Object.entries(unsafeChanges)) {
  test(`${name} cannot suppress a real or uncertain projection`, () => {
    const h = harness();
    change(h.row);
    assert.equal(privateNotionCanSkipCancelled(h.row.record, h.row.request), false);
  });
}

test("health still reports an unreviewed cancellation failure and invalid defer markers", async () => {
  const h = harness();
  assert.equal(classifyNotionDocument(h.row.record, { nowMs: Date.parse("2026-11-03T00:00:00Z") }).needsAttention, true);
  await h.run();
  for (const change of [
    (r: any) => { r.notionSync.error = "unknown"; },
    (r: any) => { r.notionSync.deferredVersion = ""; },
    (r: any) => { r.notionSync.creationTitle = "uncertain"; },
    (r: any) => { r.postSubmittedAt = "submitted"; },
    (r: any) => { r.gptDraftSummary = "synthetic"; },
    (r: any) => { r.notionProjectionLease = { token: "owner" }; },
  ]) {
    const record = structuredClone(h.row.record);
    change(record);
    assert.equal(classifyNotionDocument(record, { nowMs: Date.parse("2026-11-03T00:00:00Z") }).needsAttention, true);
  }
});
