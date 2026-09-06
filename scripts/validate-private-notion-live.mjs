#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";

if (!process.argv.includes("--confirm-synthetic-notion-test")) {
  throw new Error("Requires --confirm-synthetic-notion-test; creates and removes one isolated chart/page, never sends.");
}
const project = process.env.GOOGLE_CLOUD_PROJECT;
assert.equal(project, "archive-pilates");
assert.ok(process.env.GOOGLE_APPLICATION_CREDENTIALS);
const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");
admin.initializeApp({ projectId: project });
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });
const token = process.env.NOTION_TOKEN || execFileSync("gcloud", ["secrets", "versions", "access", "latest", "--secret=NOTION_TOKEN", "--project=archive-pilates"], { encoding: "utf8" }).trim();
const id = `plc_notion_canary_${Date.now()}_${randomUUID().slice(0, 8)}`;
const parentPageId = "36ed49eae4bf8161a0d3edd9f30643b9";
const pageTitle = `ARCHIVE PILATES Notion 검증 ${id}`;
const out = "artifacts/private-notion-event-sync";
mkdirSync(out, { recursive: true });
const recordRef = db.collection("privateLessonChartRecords").doc(id);
const requestRef = db.collection("privateLessonChartRequests").doc(id);
const sessionRef = db.collection("privateLessonSessions").doc(id);
const summary = { id, startedAt: new Date().toISOString(), stages: [], cleanup: {}, ok: false };
let pageId = "";
let pageCreateAttempted = false;

async function notion(path, method = "GET", body) {
  const r = await fetch(`https://api.notion.com/v1/${path}`, {
    method, signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${token}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Notion ${method} ${path}: ${r.status} ${data.message || ""}`);
  return data;
}

async function waitFor(label, read, timeout = 240000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await read();
    if (result) return result;
    await delay(2000);
  }
  throw new Error(`Timed out: ${label}`);
}

async function synced(label, marker, started) {
  const row = await waitFor(label, async () => {
    const doc = (await recordRef.get()).data();
    if (doc?.notionSync?.status === "failed") throw new Error(`${label}: ${doc.notionSync.error}`);
    return doc?.notionSync?.status === "synced" && !doc.notionProjectionLease?.token ? doc : null;
  });
  const blocks = await notion(`blocks/${pageId}/children?page_size=100`);
  assert.ok(JSON.stringify(blocks).includes(marker), `${label}: provider read-back missing marker`);
  const headings = blocks.results.filter((b) => b.type === "heading_3" && b.heading_3.rich_text.some((t) => t.plain_text === "오늘 기록"));
  assert.equal(headings.length, 1, `${label}: repeated body`);
  summary.stages.push({ label, latencyMs: Date.now() - started, sourceVersion: row.notionSync.sourceVersion, blockCount: blocks.results.length });
  console.log(JSON.stringify(summary.stages.at(-1)));
  return row;
}

try {
  assert.equal((await recordRef.get()).exists, false);
  assert.equal((await requestRef.get()).exists, false);
  pageCreateAttempted = true;
  const page = await notion("pages", "POST", {
    parent: { page_id: parentPageId },
    properties: { title: { title: [{ text: { content: pageTitle } }] } },
  });
  pageId = page.id;
  summary.pageId = pageId;
  const stamp = admin.firestore.Timestamp.now();
  const common = { studioId: "notion-live-canary", bookingId: id, memberId: id, memberName: "Notion 자동 검증", memberPhone: "", staffId: id, staffName: "김기효", staffPhone: "", lessonDate: "2000-01-01", sessionNumber: 1, isTest: true, source: "notion_projection_live_canary", createdAt: stamp, updatedAt: stamp };
  const marker = (s) => `${id}-${s}`;
  const start = Date.now();
  const batch = db.batch();
  batch.create(requestRef, { ...common, requestId: id, status: "cancelled", cancellationReason: "Isolated Notion canary; no booking, phone, or send", preStatus: "pending", postStatus: "pending", workflowVersion: "post_only_v2" });
  batch.create(recordRef, { ...common, recordId: id, requestId: id, cancelledAt: stamp, gptStatus: "draft_created", postRecord: { focusAreas: ["테스트"], changes: [marker("A")], nextDirection: "합성 데이터 검증", homework: marker("homework") }, notionSync: { status: "pending", instructorPageId: pageId, instructorPageUrl: page.url } });
  await batch.commit();
  summary.saveLatencyMs = Date.now() - start;
  await synced("initial-save", marker("A"), start);

  const initialBlocks = await notion(`blocks/${pageId}/children?page_size=100`);
  const generatedHomework = initialBlocks.results.find((b) => b.type === "toggle" && b.toggle.rich_text.some((t) => t.plain_text === "홈워크"));
  assert.ok(generatedHomework, "generated homework toggle");
  const homeworkChildren = await notion(`blocks/${generatedHomework.id}/children?page_size=100`);
  await notion(`blocks/${homeworkChildren.results[0].id}`, "PATCH", { paragraph: { rich_text: [{ text: { content: marker("manual-child-edit") } }] } });
  await notion(`blocks/${pageId}/children`, "PATCH", { children: [
    { object: "block", type: "paragraph", paragraph: { rich_text: [{ text: { content: marker("manual-paragraph") } }] } },
    { object: "block", type: "toggle", toggle: { rich_text: [{ text: { content: "홈워크" } }], children: [
      { object: "block", type: "paragraph", paragraph: { rich_text: [{ text: { content: marker("manual-toggle") } }] } },
    ] } },
  ] });

  const editStart = Date.now();
  for (const value of ["B", "C"]) await recordRef.update({ "postRecord.changes": [marker(value)], "notionSync.status": "pending", updatedAt: admin.firestore.Timestamp.now() });
  const latest = await synced("latest-edit", marker("C"), editStart);
  const preserved = await notion(`blocks/${pageId}/children?page_size=100`);
  assert.ok(JSON.stringify(preserved).includes(marker("manual-paragraph")), "manual paragraph preserved");
  let nestedText = "";
  for (const block of preserved.results.filter((b) => b.has_children)) nestedText += JSON.stringify(await notion(`blocks/${block.id}/children?page_size=100`));
  assert.ok(nestedText.includes(marker("manual-child-edit")), "manual child edit preserved");
  assert.ok(nestedText.includes(marker("manual-toggle")), "same-title manual toggle preserved");
  summary.manualContentPreserved = true;
  const before = await notion(`pages/${pageId}`);
  const duplicateStart = Date.now();
  await recordRef.update({ canaryTouch: admin.firestore.Timestamp.now(), "notionSync.status": "pending", updatedAt: admin.firestore.Timestamp.now() });
  const same = await synced("same-content-save", marker("C"), duplicateStart);
  assert.equal(same.notionSync.sourceVersion, latest.notionSync.sourceVersion);
  assert.equal((await notion(`pages/${pageId}`)).last_edited_time, before.last_edited_time);

  const requestStart = Date.now();
  await requestRef.update({ lessonDate: "2000-01-02", updatedAt: admin.firestore.Timestamp.now() });
  await waitFor("request-only change", async () => {
    const row = (await recordRef.get()).data();
    return row?.notionSync?.status === "synced" && row.notionSync.sourceVersion !== same.notionSync.sourceVersion && !row.notionProjectionLease?.token;
  });
  await synced("request-only-change", marker("C"), requestStart);
  const title = (await notion(`pages/${pageId}`)).properties.title.title.map((t) => t.plain_text).join("");
  assert.ok(title.includes("2000.01.02") && title.includes("취소"));

  const beforeRecovery = (await recordRef.get()).data();
  const recoveryStart = Date.now();
  await recordRef.update({ "notionSync.status": "failed", "notionSync.error": "Synthetic retry fixture", "notionSync.sourceVersion": "", updatedAt: admin.firestore.Timestamp.now() });
  await recordRef.update({ "notionSync.status": "pending", "notionSync.error": "" });
  const recovered = await synced("failed-state-recovery", marker("C"), recoveryStart);
  assert.deepEqual(recovered.postRecord, beforeRecovery.postRecord);
  assert.equal(recovered.gptStatus, beforeRecovery.gptStatus);
  assert.equal(recovered.publicReportApproval, undefined);
  for (const collection of ["alimtalkCandidates", "alimtalkSends"]) {
    const result = await db.collection(collection).where("memberId", "==", id).limit(1).get();
    assert.equal(result.empty, true, `${collection}: unexpected external action`);
  }
  summary.ok = true;
} catch (err) {
  summary.error = err.message;
  process.exitCode = 1;
} finally {
  try {
    // Creation acknowledgments may be lost. Reconcile only this unique fixture ID.
    await db.runTransaction(async (tx) => {
      const docs = await tx.getAll(recordRef, requestRef, sessionRef);
      for (const doc of docs) {
        if (!doc.exists) continue;
        assert.equal(doc.data().memberId, id, "Refusing to delete another fixture/member");
        assert.equal(doc.data().studioId, "notion-live-canary");
        tx.delete(doc.ref);
      }
    });
    await waitFor("fixture removal", async () => {
      const docs = await db.getAll(recordRef, requestRef, sessionRef);
      return docs.every((d) => !d.exists);
    }, 30000);
    summary.cleanup.firestore = true;
  } catch (err) { summary.cleanup.firestoreError = err.message; process.exitCode = 1; }
  try {
    // Independent cleanup: a database failure must not skip the Notion artifact.
    if (!pageId && pageCreateAttempted) {
      let cursor = "";
      do {
        const children = await notion(`blocks/${parentPageId}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ""}`);
        const match = children.results.find((child) => child.child_page?.title === pageTitle);
        if (match) { pageId = match.id; break; }
        cursor = children.has_more ? children.next_cursor : "";
      } while (cursor);
      if (!pageId) throw new Error(`Uncertain Notion creation: verify unique title ${pageTitle}`);
    }
    if (pageId) {
      await notion(`pages/${pageId}`, "PATCH", { archived: true });
      assert.equal((await notion(`pages/${pageId}`)).archived, true);
      summary.cleanup.notionArchived = true;
      const ownerRef = db.collection("syncStates").doc("privateNotionPage_" + pageId.replaceAll("-", "").toLowerCase());
      await db.runTransaction(async (tx) => {
        const owner = (await tx.get(ownerRef)).data();
        if (!owner) return;
        assert.equal(owner.ownerRecordId, id, "Refusing to remove another chart's ownership");
        tx.delete(ownerRef);
      });
      summary.cleanup.pageOwnership = !(await ownerRef.get()).exists;
    }
  } catch (err) { summary.cleanup.notionError = err.message; process.exitCode = 1; }
  summary.finishedAt = new Date().toISOString();
  writeFileSync(`${out}/${id}.json`, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  await db.terminate();
}
