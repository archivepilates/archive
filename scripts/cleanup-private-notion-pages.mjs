#!/usr/bin/env node
// Explicit, resumable Notion-only maintenance; never changes lesson/send data.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply-notion-cleanup");
const phases = ["--snapshot", "--verify", "--prepare", "--refresh", "--titles"].filter((flag) => args.has(flag));
assert.ok(phases.length <= 1, "Run one phase at a time");
assert.equal(apply, phases.some((p) => ["--prepare", "--refresh", "--titles"].includes(p)), "Apply phases require --apply-notion-cleanup");
const limit = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] || 1000);
assert.ok(Number.isSafeInteger(limit) && limit > 0 && limit <= 1000, "Invalid limit");
assert.equal(process.env.GOOGLE_CLOUD_PROJECT, "archive-pilates");
assert.ok(process.env.GOOGLE_APPLICATION_CREDENTIALS);
const require = createRequire(new URL("../firebase/kangsain-functions/functions/package.json", import.meta.url));
require("tsx/cjs");
const { GoogleAuth } = require("google-auth-library");
const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
const client = await auth.getClient();
const secret = await client.request({ url: "https://secretmanager.googleapis.com/v1/projects/archive-pilates/secrets/NOTION_TOKEN/versions/latest:access" });
const token = Buffer.from(secret.data.payload.data, "base64").toString("utf8").trim();
process.env.NOTION_TOKEN = token;
const helper = require("./src/privateLessonChart/privateLessonChart.ts");
const { db } = require("./src/config/firebase.ts");
const { Timestamp } = require("firebase-admin/firestore");
const out = process.env.PRIVATE_NOTION_CLEANUP_DIR;
assert.ok(out && path.isAbsolute(out) && !out.startsWith(process.cwd() + "/"), "Use a private backup directory outside the repo");
fs.mkdirSync(out, { recursive: true, mode: 0o700 });
const save = (name, data) => fs.writeFileSync(path.join(out, name + ".json"), JSON.stringify(data, null, 2), { mode: 0o600 });
const load = (name, fallback = null) => fs.existsSync(path.join(out, name + ".json")) ? JSON.parse(fs.readFileSync(path.join(out, name + ".json"), "utf8")) : fallback;
const norm = (id) => String(id || "").replaceAll("-", "").toLowerCase();
const hash = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const text = (b) => (b[b.type]?.rich_text || b[b.type]?.caption || []).map((t) => t.plain_text ?? t.text?.content ?? "").join("");
const title = (p) => Object.values(p.properties || {}).find((v) => v.type === "title")?.title?.map((t) => t.plain_text || t.text?.content || "").join("") || "";
const pageTitle = (s) => ({ title: { title: [{ type: "text", text: { content: s } }] } });
let nextAt = 0;
async function notion(endpoint, method = "GET", body) {
  assert.ok(apply || method === "GET", "Writes require --apply-notion-cleanup");
  for (let retry = 0; retry < 4; retry++) {
    await delay(Math.max(0, nextAt - Date.now()));
    nextAt = Date.now() + 420;
    const response = await fetch("https://api.notion.com/v1/" + endpoint, {
      method, headers: { Authorization: "Bearer " + token, "Notion-Version": "2022-06-28", "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(25000),
    });
    const data = await response.json();
    if (response.ok) return data;
    if (response.status === 429) { await delay(Math.max(1000, Number(response.headers.get("retry-after") || 2) * 1000)); continue; }
    throw new Error(`Notion ${method} ${endpoint}: ${response.status} ${data.message}`);
  }
  throw new Error(`Notion throttled: ${endpoint}`);
}
async function children(id) {
  const result = [];
  let cursor = "";
  do {
    const page = await notion(`blocks/${id}/children?page_size=100${cursor ? "&start_cursor=" + cursor : ""}`);
    result.push(...page.results);
    cursor = page.has_more ? page.next_cursor : "";
  } while (cursor);
  return result;
}
async function tree(id) {
  const blocks = await children(id);
  for (const block of blocks) if (block.has_children && !["child_page", "child_database"].includes(block.type)) block.backupChildren = await tree(block.id);
  return blocks;
}
const sourceHash = (doc) => {
  const { notionSync, notionProjectionLease, notionProjectionControl, ...source } = doc;
  return hash(source);
};
const memberParents = {
  "배민진": "2e3d49eae4bf80bc8ea8c91808914670",
  "정은영": "22dd49eae4bf809da7e7d6953e41eb86",
};
const archiveRoots = ["2f7d49eae4bf80f59943e1b53c430ed8", "2e3d49eae4bf807fa480f81040af69b4", "32cd49eae4bf801b81c3fc71a48feccf"];
const owners = [
  ["plc_253959176", "plc_excel_booking_c8699f0607cf1b222d"],
  ["plc_253959177", "plc_excel_booking_ad2ccf57768c22c49b"],
  ["plc_254373389", "plc_excel_booking_c4c0d95e33c725499b"],
  ["plc_254373396", "plc_excel_booking_9b1a47a1944f5bc4d1"],
  ["plc_254373397", "plc_excel_booking_2bc87fcc44971970a0"],
  ["plc_254431160", "plc_excel_booking_e7164cf201a236019d"],
  ["plc_256449810", "plc_256240430"],
  ["plc_264437447", "plc_262185101"],
  ["plc_264437448", "plc_262949867"],
  ["plc_270574018", "plc_269323592"],
];
const aliases = new Set(owners.map(([, id]) => id));
const reviewIds = ["plc_269448860", "plc_269448862", "plc_254373397", "plc_264437448"];
const isTest = (id, r) => r.isTest || /test|canary|테스트/i.test(id + " " + r.memberName);
async function assertUnchanged(id, before) {
  const current = (await db.collection("privateLessonChartRecords").doc(id).get()).data();
  assert.ok(current && sourceHash(current) === sourceHash(before), `Source edited during maintenance: ${id}`);
  assert.ok(!current.notionProjectionLease?.token || current.notionProjectionLease.untilMs < Date.now(), `Active worker: ${id}`);
  return current;
}
function legacyBlocks(blocks) {
  const supported = ["paragraph", "heading_1", "heading_2", "heading_3", "bulleted_list_item", "numbered_list_item", "quote", "bookmark", "callout"];
  return blocks.filter((b) => !b.has_children && supported.includes(b.type)).map(helper.privateNotionArchiveBlock);
}
async function preserveHistory(pageId, blocks, extra = []) {
  const existing = blocks.find((b) => b.type === "toggle" && text(b) === "이전 양식 기록");
  if (existing) {
    const archived = await children(existing.id);
    const missing = extra.filter((b) => !archived.some((a) => text(a) === text(b)));
    if (missing.length) await notion(`blocks/${existing.id}/children`, "PATCH", { children: missing });
    const confirmed = missing.length ? await children(existing.id) : archived;
    for (const block of extra) assert.ok(confirmed.some((a) => text(a) === text(block)), "Legacy answer preservation incomplete");
    return;
  }
  const archive = [...legacyBlocks(blocks), ...extra];
  if (!archive.length) return;
  assert.ok(archive.length <= 100, "Archive needs pagination; stop before replacing");
  await notion(`blocks/${pageId}/children`, "PATCH", { children: [{ object: "block", type: "toggle", toggle: {
    rich_text: [{ type: "text", text: { content: "이전 양식 기록" } }], color: "gray_background", children: archive,
  } }] });
  const saved = (await children(pageId)).find((b) => b.type === "toggle" && text(b) === "이전 양식 기록");
  assert.ok(saved, "Archive write not confirmed");
  const archived = await children(saved.id);
  assert.equal(archived.length, archive.length, "Archive incomplete");
  assert.deepEqual(archived.map(text), archive.map(text), "Archive content changed");
}
async function withLease(ids, action) {
  const token = `notion-cleanup-${process.pid}-${Date.now()}`;
  await db.runTransaction(async (tx) => {
    const snaps = await tx.getAll(...ids.map((id) => db.collection("privateLessonChartRecords").doc(id)));
    for (const snap of snaps) {
      const r = snap.data();
      assert.ok(r && (!r.notionProjectionLease?.token || r.notionProjectionLease.untilMs < Date.now()), `Active worker: ${snap.id}`);
    }
    for (const snap of snaps) tx.update(snap.ref, { notionProjectionLease: { token, untilMs: Date.now() + 600000 } });
  });
  try { return await action(token); }
  finally {
    await db.runTransaction(async (tx) => {
      const snaps = await tx.getAll(...ids.map((id) => db.collection("privateLessonChartRecords").doc(id)));
      for (const snap of snaps) if (snap.data()?.notionProjectionLease?.token === token) tx.update(snap.ref, { notionProjectionLease: { token: "", untilMs: 0 } });
    });
  }
}

let lockFd;
const lockPath = path.join(out, "cleanup.lock");
if (apply) {
  lockFd = fs.openSync(lockPath, "wx", 0o600);
  fs.writeFileSync(lockFd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
}
try {
  const records = new Map((await db.collection("privateLessonChartRecords").get()).docs.map((d) => [d.id, d.data()]));
  const requests = new Map((await db.collection("privateLessonChartRequests").get()).docs.map((d) => [d.id, d.data()]));
  const targets = [...records].filter(([id, r]) => !isTest(id, r) && !aliases.has(id) &&
    (String(r.lessonDate || requests.get(r.requestId || id)?.lessonDate) >= "2026-08-01" || owners.some(([owner]) => owner === id)));
  const missing = [...records].filter(([, r]) => !r.isTest && r.notionSync?.status === "failed" && !r.notionSync?.instructorPageId);
  const members = [...new Map(missing.map(([id, r]) => [`${r.staffName}|${r.memberId}`, { name: r.memberName, memberId: r.memberId, staff: r.staffName, sampleId: id }])).values()];
  if (!apply && !args.has("--snapshot") && !args.has("--verify")) {
    const archivePages = [];
    for (const root of archiveRoots) for (const b of await children(root)) {
      if (b.type === "child_page") archivePages.push({ id: b.id, title: b.child_page.title, parentId: root });
    }
    const matches = members.map((m) => ({ ...m, archiveMatches: archivePages.filter((p) => p.title.replace(/\s+/g, "").replace(/님$/, "") === m.name.replace(/\s+/g, "").replace(/님$/, "")) }));
    save("inventory", { checkedAt: new Date().toISOString(), missing: missing.map(([id]) => id), members: matches, archivePages });
    console.log(JSON.stringify({ mode: "dry-run", missing: missing.length, members: matches }, null, 2));
  }
  if (args.has("--snapshot")) {
    if (!load("source-before")) save("source-before", { records: Object.fromEntries(records), requests: Object.fromEntries(requests), hashes: Object.fromEntries([...records].map(([id, r]) => [id, sourceHash(r)])) });
    const ids = [...new Set(targets.map(([, r]) => norm(r.notionSync?.instructorPageId)).filter(Boolean))];
    for (const [i, id] of ids.entries()) {
      if (!load("page-before-" + id)?.recursive) save("page-before-" + id, { page: await notion("pages/" + id), blocks: await tree(id), recursive: true });
      if ((i + 1) % 25 === 0) console.log(`SNAPSHOT ${i + 1}/${ids.length}`);
    }
    console.log(JSON.stringify({ snapshotPages: ids.length, sourceRows: records.size, targetRows: targets.length }));
    save("snapshot-complete", { ids, at: new Date().toISOString() });
  }
  if (apply) {
    assert.ok(load("source-before") && load("inventory") && load("snapshot-complete"), "Run inventory and complete snapshot before apply");
    assert.ok(args.has("--prepare") || args.has("--refresh") || args.has("--titles"), "Select an explicit apply phase");
    if (args.has("--prepare")) {
      for (const [ownerId, aliasId] of owners) {
        const owner = records.get(ownerId), alias = records.get(aliasId);
        assert.ok(owner && alias);
        assert.equal(owner.memberId, alias.memberId);
        const pageId = norm(owner.notionSync?.instructorPageId);
        assert.equal(pageId, norm(alias.notionSync?.instructorPageId));
        const ownerReq = requests.get(owner.requestId || ownerId), aliasReq = requests.get(alias.requestId || aliasId);
        assert.equal(ownerReq.lessonDate, aliasReq.lessonDate);
        const aliasBooking = (await db.collection("bookings").doc(aliasReq.bookingId).get()).data();
        const targetBooking = aliasBooking?.supersededByBookingId || aliasBooking?.sessionOrder?.supersededByBookingId || aliasReq.rescheduleCorrection?.toBookingId;
        assert.ok(targetBooking === ownerReq.bookingId || aliasReq.bookingId === ownerReq.bookingId, `Unproven alias: ${aliasId}`);
        const prior = load("page-before-" + pageId);
        assert.ok(prior, "Missing page backup");
        const extra = [];
        if (alias.postSubmittedAt || alias.preSubmittedAt) {
          for (const [phase, values] of [["이전 예약의 수업 전 기록", alias.prePlan], ["이전 예약의 수업 후 기록", alias.postRecord]]) {
            for (const [key, value] of Object.entries(values || {})) {
              if (value == null || value === "" || (Array.isArray(value) && !value.length)) continue;
              const content = `${phase} · ${key}: ${Array.isArray(value) ? value.join(", ") : typeof value === "object" ? JSON.stringify(value) : value}`;
              const rich = content.match(/[\s\S]{1,1800}/g).map((s) => ({ type: "text", text: { content: s } }));
              extra.push({ object: "block", type: "paragraph", paragraph: { rich_text: rich } });
            }
          }
        }
        await assertUnchanged(ownerId, owner);
        await assertUnchanged(aliasId, alias);
        await withLease([ownerId, aliasId], async (leaseToken) => {
          await preserveHistory(pageId, await children(pageId), extra);
          await db.runTransaction(async (tx) => {
          const aRef = db.collection("privateLessonChartRecords").doc(aliasId), oRef = db.collection("privateLessonChartRecords").doc(ownerId);
          const a = (await tx.get(aRef)).data(), o = (await tx.get(oRef)).data();
          const ownerRef = db.collection("syncStates").doc("privateNotionPage_" + pageId);
          const old = (await tx.get(ownerRef)).data();
          const currentAliasRequest = (await tx.get(db.collection("privateLessonChartRequests").doc(alias.requestId || aliasId))).data();
          const currentOwnerRequest = (await tx.get(db.collection("privateLessonChartRequests").doc(owner.requestId || ownerId))).data();
          const currentBooking = (await tx.get(db.collection("bookings").doc(aliasReq.bookingId))).data();
          assert.equal(hash(currentAliasRequest), hash(aliasReq));
          assert.equal(hash(currentOwnerRequest), hash(ownerReq));
          assert.equal(hash(currentBooking), hash(aliasBooking));
          assert.ok(!old?.ownerRecordId || old.ownerRecordId === ownerId);
          for (const [now, previous] of [[a, alias], [o, owner]]) {
            assert.equal(sourceHash(now), sourceHash(previous));
            assert.equal(now.notionProjectionLease?.token, leaseToken);
            assert.ok(now.notionProjectionLease.untilMs > Date.now());
          }
          tx.set(ownerRef, { pageId, ownerRecordId: ownerId, purpose: "notion_display_page_owner", aliasRecordIds: [aliasId], verifiedAt: Timestamp.now() }, { merge: true });
          tx.update(aRef, { "notionProjectionControl.aliasOfRecordId": ownerId, "notionProjectionControl.reason": "verified_duplicate_page_binding", "notionProjectionControl.verifiedAt": new Date().toISOString() });
          });
        });
        console.log(`OWNER_VERIFIED ${ownerId}`);
      }
      const inventory = load("inventory");
      const mappings = load("member-pages", {});
      for (const member of inventory.members) {
        const key = member.staff + "|" + member.memberId;
        const profile = (await db.collection("memberProfiles").doc(member.memberId).get()).data();
        assert.ok(profile, `Missing canonical member: ${member.memberId}`);
        assert.ok(memberParents[member.staff]);
        let pageId = mappings[key];
        if (!pageId && member.archiveMatches.length) {
          assert.equal(member.archiveMatches.length, 1);
          const candidate = member.archiveMatches[0];
          const known = [...records.values()].filter((r) => r.memberId === member.memberId && r.notionSync?.instructorPageId);
          let matched = false;
          for (const r of known) {
            const p = await notion("pages/" + r.notionSync.instructorPageId);
            if (norm(p.parent?.page_id) === norm(candidate.id)) { matched = true; break; }
          }
          assert.ok(matched, "Archive identity has no source-linked child; manual review required");
          pageId = candidate.id;
        }
        if (!pageId) {
          const existing = (await children(memberParents[member.staff])).filter((b) => b.type === "child_page" && b.child_page.title === member.name + "님");
          assert.ok(existing.length <= 1, "Ambiguous member page");
          assert.equal(existing.length, 0, "Unbound same-name member page requires identity review; no automatic adoption");
          {
            assert.ok(!mappings[key + "|creating"], "Previous page creation was uncertain; do not repeat automatically");
            // Save creation intent first. A resumed uncertain create is reconciled by exact parent/title.
            mappings[key + "|creating"] = true; save("member-pages", mappings);
            const p = await notion("pages", "POST", { parent: { page_id: memberParents[member.staff] }, properties: pageTitle(member.name + "님"), children: [
              { object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: "ARCHIVE PILATES · 개인레슨 기록" } }], color: "gray" } },
            ] });
            pageId = p.id;
          }
        }
        mappings[key] = pageId; delete mappings[key + "|creating"]; save("member-pages", mappings);
        for (const id of inventory.missing) {
          const r = records.get(id);
          if (r.memberId !== member.memberId || r.staffName !== member.staff) continue;
          await assertUnchanged(id, r);
          await withLease([id], async () => db.collection("privateLessonChartRecords").doc(id).update({
            "notionProjectionControl.memberPageId": pageId,
            ...(reviewIds.includes(id) ? { "notionProjectionControl.reviewReason": "출석 원천 확인필요. 출석 여부와 회차는 예약 원천 확인 후 확정합니다." } : {}),
          }));
        }
        console.log(`MEMBER_CONNECTED ${member.name}`);
      }
      for (const id of reviewIds.filter((id) => !inventory.missing.includes(id))) {
        const r = await assertUnchanged(id, records.get(id));
        await withLease([id], async () => db.collection("privateLessonChartRecords").doc(id).update({ "notionProjectionControl.reviewReason": "출석·회차 원천 확인필요. 취소로 단정하지 않으며 원본 기록은 보존합니다." }));
      }
      save("prepared", { at: new Date().toISOString(), aliases: owners.length, members: inventory.members.length });
    }
    if (args.has("--refresh")) {
      assert.ok(load("prepared"));
      const done = load("refreshed", {});
      let attempted = 0;
      for (const [id, before] of targets) {
        if (done[id]?.ok && done[id].pageId === norm(before.notionSync?.instructorPageId) && done[id].sourceVersion === helper.privateLessonNotionProjectionVersion(before, requests.get(before.requestId || id))) continue;
        if (attempted++ >= limit) break;
        const current = await assertUnchanged(id, before);
        const q = (await db.collection("privateLessonChartRequests").doc(current.requestId || id).get()).data();
        let pageId = current.notionSync?.instructorPageId;
        if (pageId) {
          await withLease([id], async () => preserveHistory(pageId, await children(pageId)));
        }
        const result = await helper.syncPrivateNotionByRecordId(id, true);
        const after = (await db.collection("privateLessonChartRecords").doc(id).get()).data();
        assert.equal(sourceHash(after), sourceHash(before), `Source changed: ${id}`);
        pageId = after.notionSync?.instructorPageId;
        assert.ok(pageId && after.notionSync.status === "synced", `Not synced: ${id} ${result}`);
        const p = await notion("pages/" + pageId);
        assert.equal(title(p), helper.notionSessionTitle(after, q));
        const body = await children(pageId);
        const expected = helper.notionInstructorChartChildren(after, q);
        const managed = body.filter((b) => !(b.type === "toggle" && text(b) === "이전 양식 기록"));
        for (const e of expected) assert.ok(managed.some((b) => b.type === e.type && text(b) === text(e)), `Missing section: ${id} ${text(e)}`);
        assert.equal(body.filter((b) => b.type === "heading_3" && text(b) === "오늘 기록").length, 1);
        done[id] = { ok: true, pageId: norm(pageId), sourceVersion: after.notionSync.sourceVersion, at: new Date().toISOString() };
        save("refreshed", done);
        console.log(`REFRESHED ${Object.keys(done).length}/${targets.length} ${id}`);
      }
    }
    if (args.has("--titles")) {
      assert.ok(load("prepared"));
      const done = load("titles-refreshed", {});
      let attempted = 0;
      for (const [id, r] of records) {
        if (isTest(id, r) || aliases.has(id) || r.notionProjectionControl?.aliasOfRecordId || !r.notionSync?.instructorPageId) continue;
        const q = requests.get(r.requestId || id);
        if (!q) continue;
        const p = await notion("pages/" + r.notionSync.instructorPageId);
        const expected = helper.notionSessionTitle(r, q);
        if (title(p) !== expected) {
          if (attempted++ >= limit) break;
          if (!done[id]) save("title-before-" + id, { pageId: p.id, title: title(p) });
          await assertUnchanged(id, r);
          await withLease([id], async () => {
            const current = (await db.collection("privateLessonChartRecords").doc(id).get()).data();
            assert.equal(sourceHash(current), sourceHash(r));
            assert.ok(!current.notionProjectionControl?.aliasOfRecordId);
            const peerRecords = [...records].filter(([, value]) => norm(value.notionSync?.instructorPageId) === norm(p.id));
            const owner = (await db.collection("syncStates").doc("privateNotionPage_" + norm(p.id)).get()).data();
            assert.ok(owner?.ownerRecordId === id || (!owner && peerRecords.length === 1 && peerRecords[0][0] === id), "Title ownership mismatch");
            assert.equal(hash((await db.collection("privateLessonChartRequests").doc(r.requestId || id).get()).data()), hash(q));
            await notion("pages/" + p.id, "PATCH", { properties: pageTitle(expected) });
          });
          assert.equal(title(await notion("pages/" + p.id)), expected);
          done[id] = { pageId: norm(p.id), at: new Date().toISOString() }; save("titles-refreshed", done);
        }
      }
      console.log(JSON.stringify({ titlesCorrected: Object.keys(done).length }));
    }
  }
  if (args.has("--verify")) {
    const baseline = load("source-before");
    const changedSourceIds = [...records].filter(([id, r]) => baseline.hashes[id] && sourceHash(r) !== baseline.hashes[id]).map(([id]) => id);
    const changedRequests = [...requests].filter(([id, r]) => baseline.requests[id] && hash(r) !== hash(baseline.requests[id])).map(([id]) => id);
    const failed = [...records].filter(([, r]) => r.notionSync?.status === "failed").map(([id, r]) => ({ id, error: r.notionSync.error }));
    const aliasErrors = owners.filter(([owner, alias]) => records.get(alias)?.notionProjectionControl?.aliasOfRecordId !== owner);
    const removedIds = Object.keys(baseline.hashes).filter((id) => !records.has(id));
    const result = { at: new Date().toISOString(), changedSourceIds, changedRequests, removedIds, failed, aliasErrors, refreshed: Object.keys(load("refreshed", {})).length, titleCorrections: Object.keys(load("titles-refreshed", {})).length };
    save("verification", result); console.log(JSON.stringify(result, null, 2));
    assert.equal(changedSourceIds.length + changedRequests.length + removedIds.length + failed.length + aliasErrors.length, 0, "Verification requires review");
  }
} finally {
  await db.terminate();
  if (lockFd !== undefined) { fs.closeSync(lockFd); fs.unlinkSync(lockPath); }
}
