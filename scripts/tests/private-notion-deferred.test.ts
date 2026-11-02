import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import {
  PRIVATE_NOTION_LEASE_MS, PrivateNotionAwaitingSubmission, privateNotionCanAwaitSubmission,
  privateNotionDeferredVersion, privateNotionHasSubmittedContent, privateNotionSourceChanged,
  runPrivateNotionProjection, type PrivateNotionState,
} from "../../firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonNotionSync";

// Extract adapters into a sandbox: never import Firebase initialization or provider credentials.
const requireFunctions = createRequire(path.resolve("firebase/kangsain-functions/functions/package.json"));
const ts = requireFunctions("typescript");
const source = fs.readFileSync("firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonChart.ts", "utf8");
const tree = ts.createSourceFile("privateLessonChart.ts", source, ts.ScriptTarget.ES2022, true);
function adapter(name: string, globals: Record<string, unknown> = {}) {
  const declaration = tree.statements.find((node: any) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, name);
  const code = ts.transpileModule(declaration.getText(tree).replace(/^export /, ""), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return vm.runInNewContext(`${code}\n${name}`, { PrivateNotionAwaitingSubmission, ...globals });
}

function harness() {
  let time = Date.parse("2026-11-02T00:00:00Z");
  const record: any = { recordId: "synthetic", requestId: "synthetic", memberId: "100", staffId: "200",
    bookingId: "synthetic", gptStatus: "waiting_post", preSubmittedAt: null, postSubmittedAt: null,
    notionSync: { status: "pending" } };
  const request: any = { requestId: "synthetic", memberId: "100", staffId: "200", bookingId: "synthetic",
    lessonDate: "2099-01-01", status: "pending", preStatus: "pending", postStatus: "pending" };
  const row: any = { record, request };
  let calls = 0, writes = 0;
  const deps = {
    store: { transact: async (_id: string, update: any) => {
      const next = update(structuredClone(row));
      if (next.state) { row.record.notionSync = structuredClone(next.state); writes++; }
      return next.result;
    } },
    now: () => time,
    version: (current: any) => JSON.stringify([current.record.postSubmittedAt, current.request?.lessonDate]),
    project: async (_source: any, _checkpoint: (page: Partial<PrivateNotionState>) => Promise<void>): Promise<PrivateNotionState> => {
      calls++;
      throw new PrivateNotionAwaitingSubmission();
    },
  };
  return { row, deps, get calls() { return calls; }, get writes() { return writes; },
    advance: (ms: number) => { time += ms; },
    run: (extra: Partial<typeof deps> & { retryFailures?: boolean } = {}) => runPrivateNotionProjection("synthetic", { ...deps, ...extra }) };
}

test("missing-parent deferral persists pending metadata and no success, then emits no self-trigger", async () => {
  const h = harness();
  await h.run();
  const state = h.row.record.notionSync;
  assert.equal(state.status, "pending");
  assert.equal(state.deferredReason, "awaiting_submission");
  assert.equal(state.deferredVersion, privateNotionDeferredVersion(h.row.record, h.row.request));
  assert.equal(state.sourceVersion, "");
  assert.equal(state.error, "");
  assert.equal(state.syncedAt, undefined);
  assert.equal(state.leaseToken, "");
  assert.equal(state.leaseUntilMs, 0);
  const before = { ...h.row.record, notionSync: { status: "pending" }, notionProjectionLease: { token: "owner" } };
  const after = { ...h.row.record, notionProjectionLease: { token: "", untilMs: 0 } };
  assert.equal(privateNotionSourceChanged(before, after), false);
  assert.equal(privateNotionSourceChanged({ ...before, notionSync: { status: "failed" } }, after), false);
});

test("unchanged deferred shell is skipped by events and repeated nightly attempts without writes", async () => {
  const h = harness();
  await h.run();
  const before = structuredClone(h.row), writes = h.writes;
  for (let night = 0; night < 3; night++) {
    h.advance(24 * 60 * 60 * 1000);
    assert.equal(await h.run({ retryFailures: true }), "skipped");
    assert.equal(await h.run(), "skipped");
  }
  assert.equal(h.calls, 1);
  assert.equal(h.writes, writes);
  assert.deepEqual(h.row, before);
});

test("explicit incident metadata uses the same deferred digest and skips without an attempt", async () => {
  const h = harness();
  h.row.record.notionSync = { status: "pending", error: "", deferredReason: "awaiting_submission",
    deferredVersion: privateNotionDeferredVersion(h.row.record, h.row.request), sourceVersion: "" };
  assert.equal(await h.run({ retryFailures: true }), "skipped");
  assert.equal(h.calls, 0);
  assert.equal(h.writes, 0);
});

test("post submission resumes once, clears waiting and ordinary dedup still prevents a repeat", async () => {
  const h = harness();
  await h.run();
  const before = structuredClone(h.row.record);
  h.row.record.postSubmittedAt = "submitted";
  h.row.record.postRecord = { synthetic: "content" };
  assert.equal(privateNotionSourceChanged(before, h.row.record), true);
  let projected = 0;
  const project = async (): Promise<PrivateNotionState> => { projected++; return { status: "synced", syncedAt: "success" }; };
  assert.equal(await h.run({ project }), "synced");
  assert.equal(h.row.record.notionSync.deferredReason, "");
  assert.equal(h.row.record.notionSync.deferredVersion, "");
  assert.equal(await h.run({ project, retryFailures: true }), "skipped");
  assert.equal(projected, 1);
});

test("identity-only canonical changes invalidate deferral even when rendered version is unchanged", async () => {
  const h = harness();
  await h.run();
  const before = privateNotionDeferredVersion(h.row.record, h.row.request);
  const rendered = h.deps.version(h.row);
  h.row.record.memberId = "changed";
  assert.equal(h.deps.version(h.row), rendered);
  assert.notEqual(privateNotionDeferredVersion(h.row.record, h.row.request), before);
  assert.equal(await h.run({ project: async () => { throw Error("identity mismatch"); } }), "failed");
  assert.equal(h.row.record.notionSync.deferredReason, "");
});

for (const change of ["submission", "identity"] as const) {
  test(`mid-flight ${change} change cannot be acknowledged as unchanged waiting`, async () => {
    const h = harness();
    await h.run({ project: async () => {
      if (change === "submission") h.row.request.preStatus = "submitted";
      else h.row.record.memberId = "changed";
      throw new PrivateNotionAwaitingSubmission();
    } });
    assert.equal(h.row.record.notionSync.deferredReason, "");
    const after = { ...h.row.record, notionProjectionLease: { token: "" } };
    const before = { ...h.row.record, notionProjectionLease: { token: "owner" } };
    assert.equal(privateNotionSourceChanged(before, after), true);
  });
}

test("request-only submission wakes the real handler despite an unchanged presentation fingerprint", async () => {
  const h = harness();
  await h.run();
  const before = structuredClone(h.row.request);
  h.row.request.preStatus = "submitted";
  let calls = 0;
  const handler = adapter("syncPrivateNotionOnRequestWrite", {
    privateNotionSourceChanged, privateNotionHasSubmittedContent,
    refs: { privateLessonChartRecord: () => ({ get: async () => ({ data: () => h.row.record }) }) },
    privateLessonNotionProjectionVersion: () => "same-presentation",
    PRIVATE_NOTION_DEBOUNCE_MS: 0, setTimeout: (fn: () => void) => fn(),
    syncPrivateNotionByRecordId: async () => { calls++; },
  });
  await handler({ params: { requestId: "synthetic" }, data: { before: { data: () => before }, after: { data: () => h.row.request } } });
  assert.equal(calls, 1);
  assert.equal(await h.run({ project: async () => { throw Error("post submission guard"); } }), "failed");
  assert.equal(h.row.record.notionSync.deferredReason, "");
});

test("aliases, active leases, uncertain session creates and real errors cannot become healthy waiting", async () => {
  const alias = harness();
  alias.row.control = { aliasOfRecordId: "owner" };
  assert.equal(await alias.run(), "skipped");
  assert.equal(alias.writes, 0);
  const active = harness();
  active.row.record.notionSync.leaseUntilMs = active.deps.now() + PRIVATE_NOTION_LEASE_MS;
  assert.equal(await active.run(), "skipped");
  assert.equal(active.writes, 0);
  const uncertain = harness();
  uncertain.row.record.notionSync.creationTitle = "uncertain-create";
  assert.equal(privateNotionCanAwaitSubmission(uncertain.row.record, uncertain.row.request), false);
  await uncertain.run({ project: async () => { throw Error("uncertain create"); } });
  assert.equal(uncertain.row.record.notionSync.status, "failed");
  assert.equal(uncertain.row.record.notionSync.creationTitle, "uncertain-create");
  assert.equal(uncertain.row.record.notionSync.deferredReason, "");
  assert.equal(await uncertain.run(), "skipped");
});

test("event and nightly attempts share the lease; expired owners cannot overwrite recovery", async () => {
  const h = harness();
  let recovered = 0;
  assert.equal(await h.run({ project: async () => {
    assert.equal(await h.run({ retryFailures: true }), "skipped");
    h.advance(PRIVATE_NOTION_LEASE_MS + 1);
    assert.equal(await h.run({ retryFailures: true, project: async () => {
      recovered++;
      return { status: "synced", instructorPageId: "recovered-page" };
    } }), "synced");
    throw new PrivateNotionAwaitingSubmission();
  } }), "skipped");
  assert.equal(recovered, 1);
  assert.equal(h.row.record.notionSync.status, "synced");
  assert.equal(h.row.record.notionSync.instructorPageId, "recovered-page");
  assert.equal(h.row.record.notionSync.deferredReason, "");
});

test("page checkpoint survives failure and alias introduced in flight prevents acknowledgment", async () => {
  const h = harness();
  await h.run({ project: async (_source: any, checkpoint: any) => {
    await checkpoint({ instructorPageId: "checkpoint-page" });
    throw Error("content write failed");
  } });
  assert.equal(h.row.record.notionSync.instructorPageId, "checkpoint-page");
  assert.equal(await h.run({ retryFailures: true, project: async (current: any) => {
    assert.equal(current.record.notionSync.instructorPageId, "checkpoint-page");
    return { status: "synced" };
  } }), "synced");
  const alias = harness();
  assert.equal(await alias.run({ project: async (_source: any, checkpoint: any) => {
    alias.row.control = { aliasOfRecordId: "canonical" };
    await assert.rejects(checkpoint({ instructorPageId: "wrong-page" }), /lease lost/);
    throw new PrivateNotionAwaitingSubmission();
  } }), "skipped");
  assert.equal(alias.row.record.notionSync.deferredReason, "");
});

test("failure timestamps preserve historical success without stamping a new syncedAt", async () => {
  const h = harness();
  h.row.record.notionSync.syncedAt = "historical-success";
  await h.run({ project: async () => { throw Error("provider down"); } });
  assert.equal(h.row.record.notionSync.failedAt, new Date(h.deps.now()).toISOString());
  assert.equal(h.row.record.notionSync.syncedAt, "historical-success");
  h.row.request = undefined;
  h.advance(1000);
  await h.run();
  assert.equal(h.row.record.notionSync.failedAt, new Date(h.deps.now()).toISOString());
  assert.equal(h.row.record.notionSync.deferredReason, "");
});

test("real projection adapter stamps failedAt and propagates typed waiting without claiming success", async () => {
  const h = harness();
  let failure: Error = new Error("synthetic provider failure");
  const project = adapter("syncPrivateLessonChartRecordToNotion", {
    canExposePrivateLessonReport: () => false,
    privateLessonNotionProjectionVersion: () => "rendered",
    syncInstructorMemberChartPage: async () => { throw failure; },
    errorMessage: (error: Error) => error.message,
  });
  const failed = await project(h.row.record, h.row.request, async () => {});
  assert.equal(failed.status, "failed");
  assert.ok(Number.isFinite(Date.parse(failed.failedAt)));
  assert.equal(failed.syncedAt, undefined);
  failure = new PrivateNotionAwaitingSubmission();
  await assert.rejects(project(h.row.record, h.row.request, async () => {}), PrivateNotionAwaitingSubmission);
});

test("known session and parent pages keep their sync path; unknown create is not replayed", async () => {
  const h = harness(), calls: string[] = [];
  const sync = adapter("syncInstructorMemberChartPage", {
    notionSessionTitle: () => "synthetic-title", notionInstructorChartChildren: () => [],
    claimPrivateNotionPage: async () => { calls.push("claim"); },
    updateNotionPageTitle: async () => { calls.push("title"); },
    replacePageContent: async () => { calls.push("content"); }, notionPageUrl: () => "synthetic-url",
    findSourceLinkedNotionMemberPage: async () => "known-parent",
    ensureInstructorMemberPage: async () => { throw Error("must not create parent"); },
    findChildPageByExactTitle: async () => "",
    notionRequest: async () => { calls.push("create-session"); return { id: "new-session" }; },
    notionTitle: () => ({}), errorMessage: (error: Error) => error.message,
  });
  h.row.record.notionSync.instructorPageId = "known-session";
  assert.equal((await sync(h.row.record, h.row.request, async () => {})).pageId, "known-session");
  assert.deepEqual(calls, ["claim", "title", "content"]);
  calls.length = 0;
  delete h.row.record.notionSync.instructorPageId;
  assert.equal((await sync(h.row.record, h.row.request, async () => {})).pageId, "new-session");
  assert.deepEqual(calls, ["create-session", "claim"]);
  calls.length = 0;
  h.row.record.notionSync.creationTitle = "uncertain-create";
  await assert.rejects(sync(h.row.record, h.row.request, async () => {}), /중복 생성을/);
  assert.deepEqual(calls, []);
});

test("source-side pending intent clears stale deferral and dates the new pending interval", () => {
  const pending = adapter("pendingNotionProjection")({ notionSync: { deferredReason: "awaiting_submission" } });
  assert.equal(pending.deferredReason, "");
  assert.equal(pending.deferredVersion, "");
  assert.ok(Number.isFinite(Date.parse(pending.pendingAt)));
});
