import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import {
  PRIVATE_NOTION_LEASE_MS,
  assertPrivateNotionPageOwner,
  privateNotionSourceChanged,
  reconcilePrivateNotionPages,
  runPrivateNotionProjection,
  type PrivateNotionSource,
  type PrivateNotionState,
  type PrivateNotionStore,
  type PrivateNotionRepairCursor,
} from "../../firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonNotionSync";
import { privateLessonNotionProjectionVersion, isManagedPrivateNotionBlock, notionSessionTitle } from "../../firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonChart";

function harness() {
  let time = 1_800_000_000_000;
  let source: PrivateNotionSource | null = {
    record: { recordId: "test", requestId: "test", postRecord: { changes: "A" }, notionSync: { status: "pending" } } as any,
    request: { requestId: "test", lessonDate: "2026-09-06" } as any,
  };
  const store: PrivateNotionStore = {
    async transact(_id, update) {
      const next = update(source ? structuredClone(source) : null);
      if (source && next.state) source.record.notionSync = structuredClone(next.state);
      return next.result;
    },
  };
  let calls = 0;
  const deps = {
    store,
    now: () => time,
    version: (s: PrivateNotionSource) => JSON.stringify([s.record.postRecord, s.request?.lessonDate]),
    project: async (): Promise<PrivateNotionState> => { calls++; return { status: "synced", instructorPageId: "page" }; },
  };
  return { deps, get source() { return source!; }, get calls() { return calls; }, advance: (ms: number) => { time += ms; }, remove: () => { source = null; } };
}

test("display aliases never project or mutate instructor answers, including nightly recovery", async () => {
  const h = harness();
  h.source.control = { aliasOfRecordId: "canonical" };
  const before = structuredClone(h.source);
  assert.equal(await runPrivateNotionProjection("test", { ...h.deps, retryFailures: true }), "skipped");
  assert.equal(h.calls, 0);
  assert.deepEqual(h.source, before);
});

test("page ownership fails closed for shared and conflicting owners", () => {
  assert.doesNotThrow(() => assertPrivateNotionPageOwner("a", "", ["a"]));
  assert.doesNotThrow(() => assertPrivateNotionPageOwner("a", "a", ["a", "old"]));
  assert.throws(() => assertPrivateNotionPageOwner("old", "a", []), /덮어쓰기/);
  assert.throws(() => assertPrivateNotionPageOwner("a", "", ["a", "b"]), /덮어쓰기/);
});

test("an alias introduced mid-flight cannot checkpoint or acknowledge success", async () => {
  const h = harness();
  const result = await runPrivateNotionProjection("test", { ...h.deps, project: async (_source, checkpoint) => {
    h.source.control = { aliasOfRecordId: "canonical" };
    await assert.rejects(checkpoint({ instructorPageId: "wrong" }), /lease lost/);
    return { status: "synced" };
  } });
  assert.equal(result, "skipped");
  assert.equal(h.source.record.notionSync?.instructorPageId, undefined);
});

test("replacement retains history, attachments and manual nested content but replaces managed toggles", () => {
  const toggle = (label: string) => ({ type: "toggle", has_children: true, toggle: { rich_text: [{ text: { content: label } }] } });
  assert.equal(isManagedPrivateNotionBlock(toggle("이전 양식 기록")), false);
  assert.equal(isManagedPrivateNotionBlock(toggle("강사 메모")), false);
  assert.equal(isManagedPrivateNotionBlock(toggle("홈워크")), true);
  for (const type of ["child_page", "child_database", "file", "image", "video", "table"]) assert.equal(isManagedPrivateNotionBlock({ type }), false);
  assert.equal(isManagedPrivateNotionBlock({ type: "paragraph", has_children: true }), false);
  assert.equal(isManagedPrivateNotionBlock({ type: "callout", has_children: false }), true);
});

test("Notion-only review hides unverified round/cancellation without changing canonical state", () => {
  const r: any = { memberName: "검증", sessionNumber: 99, cancelledAt: 1, notionProjectionControl: { reviewReason: "출석 확인필요" } };
  const q: any = { lessonDate: "2026-09-04", status: "cancelled" };
  assert.equal(notionSessionTitle(r, q), "2026.09.04 · 검증(확인필요)");
  assert.equal(q.status, "cancelled");
  assert.equal(r.sessionNumber, 99);
});

test("duplicate and out-of-order deliveries use the newest source once", async () => {
  const h = harness();
  h.source.record.postRecord = { changes: "C" };
  assert.equal(await runPrivateNotionProjection("test", h.deps), "synced");
  assert.equal(await runPrivateNotionProjection("test", h.deps), "skipped");
  assert.equal(h.calls, 1);
  assert.equal(h.source.record.notionSync?.sourceVersion, h.deps.version(h.source));
});

test("repeated same-content save acknowledges pending without another Notion call", async () => {
  const h = harness();
  await runPrivateNotionProjection("test", h.deps);
  h.source.record.notionSync!.status = "pending";
  await runPrivateNotionProjection("test", h.deps);
  assert.equal(h.calls, 1);
  assert.equal(h.source.record.notionSync!.status, "synced");
});

test("sync metadata and lease writes do not self-trigger; stale completion wakes once", () => {
  const before = { postRecord: { changes: "A" }, updatedAt: 1, notionSync: { status: "pending" }, notionProjectionLease: { token: "owner" } };
  assert.equal(privateNotionSourceChanged(before, { ...before, updatedAt: 2 }), false);
  assert.equal(privateNotionSourceChanged(before, { ...before, notionSync: { status: "synced" }, notionProjectionLease: { token: "" } }), false);
  assert.equal(privateNotionSourceChanged(before, { ...before, notionProjectionLease: { token: "" } }), true);
  assert.equal(privateNotionSourceChanged(before, undefined), false);
});

test("event and nightly workers cannot write one chart concurrently", async () => {
  const h = harness();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let started!: () => void;
  const ready = new Promise<void>((r) => { started = r; });
  const active = runPrivateNotionProjection("test", { ...h.deps, project: async () => { started(); await gate; return { status: "synced" }; } });
  await ready;
  assert.equal(await runPrivateNotionProjection("test", { ...h.deps, retryFailures: true }), "skipped");
  release();
  assert.equal(await active, "synced");
});

for (const succeeds of [true, false]) {
  test(`edit during ${succeeds ? "successful" : "failed"} projection retains latest pending intent`, async () => {
    const h = harness();
    const original = h.deps.version(h.source);
    const status = await runPrivateNotionProjection("test", { ...h.deps, project: async () => {
      h.source.record.postRecord = { changes: "B" };
      if (!succeeds) throw new Error("provider down");
      return { status: "synced" };
    } });
    assert.equal(status, "pending");
    assert.notEqual(h.source.record.notionSync?.sourceVersion, h.deps.version(h.source));
    if (succeeds) assert.equal(h.source.record.notionSync?.sourceVersion, original);
    assert.equal(await runPrivateNotionProjection("test", h.deps), "synced");
  });
}

test("failure does not loop; night recovery retries unchanged source", async () => {
  const h = harness();
  const original = structuredClone(h.source.record.postRecord);
  assert.equal(await runPrivateNotionProjection("test", { ...h.deps, project: async () => { throw new Error("offline"); } }), "failed");
  assert.deepEqual(h.source.record.postRecord, original);
  assert.equal(await runPrivateNotionProjection("test", h.deps), "skipped");
  assert.equal(h.calls, 0);
  assert.equal(await runPrivateNotionProjection("test", { ...h.deps, retryFailures: true }), "synced");
});

test("expired lease can recover, old owner cannot overwrite completion", async () => {
  const h = harness();
  const result = await runPrivateNotionProjection("test", { ...h.deps, project: async () => {
    h.advance(PRIVATE_NOTION_LEASE_MS + 1);
    h.source.record.postRecord = { changes: "B" };
    await runPrivateNotionProjection("test", h.deps);
    return { status: "failed", error: "stale owner" };
  } });
  assert.equal(result, "skipped");
  assert.equal(h.source.record.notionSync?.status, "synced");
  assert.equal(h.source.record.notionSync?.sourceVersion, h.deps.version(h.source));
});

test("page checkpoint survives provider failure and is reused in recovery", async () => {
  const h = harness();
  await runPrivateNotionProjection("test", { ...h.deps, project: async (_s, checkpoint) => {
    await checkpoint({ instructorPageId: "created-page", creationTitle: "" });
    throw new Error("body failed");
  } });
  assert.equal(h.source.record.notionSync?.instructorPageId, "created-page");
  await runPrivateNotionProjection("test", { ...h.deps, retryFailures: true, project: async (s) => {
    assert.equal(s.record.notionSync?.instructorPageId, "created-page");
    return { status: "synced" };
  } });
});

test("deletion and missing request never create Notion content", async () => {
  const h = harness();
  h.source.request = undefined;
  await runPrivateNotionProjection("test", h.deps);
  assert.equal(h.source.record.notionSync?.status, "failed");
  assert.equal(h.calls, 0);
  h.remove();
  assert.equal(await runPrivateNotionProjection("test", h.deps), "skipped");
});

test("night recovery catches synced-but-stale and absent status documents", async () => {
  const h = harness();
  h.source.record.notionSync = undefined;
  await runPrivateNotionProjection("test", { ...h.deps, retryFailures: true });
  h.source.request!.lessonDate = "2026-09-07";
  assert.equal(await runPrivateNotionProjection("test", { ...h.deps, retryFailures: true }), "synced");
  assert.equal(h.calls, 2);
});

test("Notion title fingerprint follows post submission, cancellation, time, round and actual sends", () => {
  const record: any = { memberName: "테스트", staffName: "테스트", sessionNumber: 1, gptStatus: "published", publicReportUrl: "https://example.com/report", postSubmittedAt: { toMillis: () => 1 } };
  const request: any = { lessonDate: "2026-09-06", status: "active" };
  const version = privateLessonNotionProjectionVersion(record, request);
  assert.equal(version, privateLessonNotionProjectionVersion({ ...record, notionSync: { status: "failed" }, updatedAt: 9 }, request));
  for (const r of [{ ...record, sessionNumber: 2 }, { ...record, postSubmittedAt: null }, { ...record, publicReportApproval: { status: "sent" } }, { ...record, sentRevision: "sent-v1" }]) {
    assert.notEqual(privateLessonNotionProjectionVersion(r, request), version);
  }
  assert.notEqual(privateLessonNotionProjectionVersion(record, { ...request, status: "cancelled" }), version);
  assert.notEqual(privateLessonNotionProjectionVersion(record, { ...request, lessonDate: "2026-09-07" }), version);
});

test("runtime worker is event-only and has no report/send/source mutations", () => {
  const code = fs.readFileSync("firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonChart.ts", "utf8");
  const api = code.slice(0, code.indexOf("function pendingNotionProjection"));
  assert.doesNotMatch(api, /await syncPrivateNotionByRecordId|await syncPrivateLessonChartRecordToNotion/);
  const projection = code.slice(code.indexOf("async function syncPrivateLessonChartRecordToNotion"), code.indexOf("export function privateLessonNotionProjectionVersion"));
  assert.doesNotMatch(projection, /resolveReportShortUrl|\.set\(|enqueue|sendAlimtalk|gemini/i);
  const adapter = code.slice(code.indexOf("const privateNotionStore:"), code.indexOf("async function syncPrivateNotionByRecordId"));
  assert.match(adapter, /notionProjectionLease/);
  assert.doesNotMatch(adapter, /updatedAt:|publicReportApproval:|postRecord:/);
  const nightly = code.slice(code.indexOf("export async function syncPendingPrivateLessonNotionProjections"), code.indexOf("const privateNotionStore:"));
  assert.match(nightly, /startAfter\(after\)/);
  assert.match(nightly, /syncState\("privateLessonNotionReconciliation"\)/);
  assert.match(nightly, /lane === "all" \? records/);
  assert.doesNotMatch(nightly, /where\("updatedAt"/);
});

test("night scan persists progress and alternates slow failures with the full-source sweep", async () => {
  let time = 0;
  let cursor: PrivateNotionRepairCursor = { nextLane: 0, cursors: {} };
  const visits: string[] = [];
  const rows = { pending: ["p1", "p2", "p3"], failed: ["f1", "f2", "f3"], all: ["old-1", "old-2", "old-3"] };
  for (let run = 0; run < 3; run++) {
    await reconcilePrivateNotionPages({
      cursor, now: () => time, budgetMs: 150, maxRecords: 30,
      list: async (lane, after) => rows[lane].filter((id) => id > after).slice(0, 5),
      save: async (next) => { cursor = structuredClone(next); },
      process: async (id) => { visits.push(id); time += 160; },
    });
  }
  assert.deepEqual(visits, ["p1", "f1", "old-1"]);
  assert.deepEqual(cursor.cursors, { pending: "p1", failed: "f1", all: "old-1" });
});

test("scan advances before interruption, dedupes lanes and wraps completed cursors", async () => {
  let cursor: PrivateNotionRepairCursor = { nextLane: 0, cursors: {} };
  const rows = { pending: ["1", "2"], failed: ["2"], all: ["1", "2", "3"] };
  const visited: string[] = [];
  const deps = {
    list: async (lane: keyof typeof rows, after: string) => rows[lane].filter((id) => id > after).slice(0, 1),
    save: async (next: PrivateNotionRepairCursor) => { cursor = structuredClone(next); },
  };
  await assert.rejects(reconcilePrivateNotionPages({ ...deps, cursor, process: async () => { throw new Error("worker stopped"); } }));
  assert.equal(cursor.cursors.pending, "1");
  assert.equal(cursor.nextLane, 1);
  await reconcilePrivateNotionPages({ ...deps, cursor, process: async (id) => { visited.push(id); } });
  assert.deepEqual(visited, ["2", "1", "3"]);
  assert.equal(new Set(visited).size, visited.length);
  assert.deepEqual(cursor.cursors, { pending: "", failed: "", all: "" });
});

test("expired owner cannot acknowledge success even without a replacement worker", async () => {
  const h = harness();
  const result = await runPrivateNotionProjection("test", { ...h.deps, project: async () => {
    h.advance(PRIVATE_NOTION_LEASE_MS + 1);
    return { status: "synced" };
  } });
  assert.equal(result, "skipped");
  assert.equal(h.source.record.notionSync?.status, "pending");
  assert.equal(await runPrivateNotionProjection("test", { ...h.deps, retryFailures: true }), "synced");
});

test("A to B interrupted write to A must restore Notion despite matching last acknowledged version", async () => {
  const h = harness();
  let displayed = "";
  const project = async (s: PrivateNotionSource): Promise<PrivateNotionState> => {
    displayed = String(s.record.postRecord?.changes);
    return { status: "synced" };
  };
  await runPrivateNotionProjection("test", { ...h.deps, project });
  h.source.record.postRecord = { changes: "B" };
  await runPrivateNotionProjection("test", { ...h.deps, project: async (s) => {
    await project(s);
    h.advance(PRIVATE_NOTION_LEASE_MS + 1);
    return { status: "synced" };
  } });
  assert.equal(displayed, "B");
  h.source.record.postRecord = { changes: "A" };
  assert.equal(h.source.record.notionSync?.sourceVersion, h.deps.version(h.source));
  assert.equal(await runPrivateNotionProjection("test", { ...h.deps, project, retryFailures: true }), "synced");
  assert.equal(displayed, "A");
});
