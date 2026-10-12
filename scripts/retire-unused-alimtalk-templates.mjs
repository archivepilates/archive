#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { sourceReader, root } from "./lib/alimtalk-catalog-source.mjs";

const apply = process.argv.includes("--apply");
const require = createRequire(path.join(root, "firebase/kangsain-functions/functions/package.json"));
const admin = require("firebase-admin");
const plan = JSON.parse(await fs.readFile(path.join(root, "scripts/fixtures/alimtalk-template-retirement.json")));
const source = sourceReader().constant("firebase/kangsain-functions/functions/src/alimtalk/templates.ts", "ALIMTALK_TEMPLATES");
const protectedIds = new Set(Object.values(source).filter(t => t.status === "approved").map(t => t.code));
protectedIds.add("KA01TP2610061247076605VQTRV7FTPK");
protectedIds.add("KA01TP260606215619915xrfx4W0JsZf");
assert.equal(new Set(plan.templates.map(t => t.templateId)).size, plan.templates.length);
for (const t of plan.templates) assert.ok(!protectedIds.has(t.templateId), "Active template in retirement plan");
assert.equal(source.onsite_welcome.status, "deleted");
admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: "archive-pilates" });
const db = admin.firestore();
const secret = name => execFileSync("gcloud", ["secrets", "versions", "access", "latest", `--secret=${name}`, "--project=archive-pilates"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const key = secret("SOLAPI_API_KEY"), apiSecret = secret("SOLAPI_API_SECRET");
async function request(route, method = "GET") {
  const date = new Date().toISOString(), salt = randomBytes(16).toString("hex");
  const signature = createHmac("sha256", apiSecret).update(date + salt).digest("hex");
  const response = await fetch(`https://api.solapi.com${route}`, { method, headers: { Authorization: `HMAC-SHA256 apiKey=${key}, date=${date}, salt=${salt}, signature=${signature}` }, signal: AbortSignal.timeout(30000) });
  const body = await response.json();
  if (response.status === 404 && body.errorCode === "TemplateNotFound") return { absent: true, httpStatus: 404, errorCode: body.errorCode };
  if (!response.ok) throw new Error(`SOLAPI ${method} ${response.status}: ${body.errorCode || "unknown"}`);
  return body;
}
async function inventory() {
  const rows = [], cursors = new Set();
  let cursor = "";
  for (let page = 0; page < 20; page++) {
    const data = await request(`/kakao/v2/templates?${new URLSearchParams({ limit: "100", ...(cursor ? { startKey: cursor } : {}) })}`);
    assert.ok(Array.isArray(data.templateList), "Unknown provider list schema");
    rows.push(...data.templateList);
    if (!data.nextKey) { assert.equal(new Set(rows.map(t => t.templateId)).size, rows.length); return rows; }
    assert.ok(!cursors.has(data.nextKey), "Repeated provider cursor");
    cursors.add(data.nextKey); cursor = data.nextKey;
  }
  throw new Error("Provider inventory incomplete");
}
async function ensureIdle(templateId) {
  const candidates = await db.collection("alimtalkCandidates").where("templateCode", "==", templateId).select("status").get();
  const sends = await db.collection("alimtalkSends").where("templateCode", "==", templateId).select("status").get();
  for (const snap of [...candidates.docs, ...sends.docs]) {
    assert.ok(["sent", "done", "skipped", "failed", "cancelled", "canceled"].includes(snap.data().status), `Nonterminal work blocks deletion: ${templateId}`);
  }
  return { candidateCount: candidates.size, sendCount: sends.size, pending: 0 };
}
const before = await inventory();
for (const id of protectedIds) assert.ok(before.some(t => t.templateId === id), `Protected template missing: ${id}`);
const dir = path.join(root, "artifacts/alimtalk-template-retirement-20261012");
await fs.mkdir(dir, { recursive: true });
// Persist exact provider definitions before irreversible deletion; never overwrite an earlier backup.
for (const t of before.filter(t => plan.templates.some(p => p.templateId === t.templateId))) {
  await fs.writeFile(path.join(dir, `${t.templateId}.json`), JSON.stringify(t, null, 2), { flag: "wx" }).catch(e => { if (e.code !== "EEXIST") throw e; });
}
const result = { checkedAt: new Date().toISOString(), apply, beforeCount: before.length, deletions: [] };
for (const item of plan.templates) {
  const remote = await request(`/kakao/v2/templates/${item.templateId}`);
  const idle = await ensureIdle(item.templateId);
  if (!remote.absent) {
    assert.equal(remote.channelId, plan.channelId, "Wrong channel");
    assert.equal(remote.name, item.name, "Provider definition changed; re-review required");
    if (apply) {
      await ensureIdle(item.templateId);
      await request(`/kakao/v2/templates/${item.templateId}`, "DELETE");
    }
  }
  const verified = apply ? await request(`/kakao/v2/templates/${item.templateId}`) : remote;
  if (apply) assert.equal(verified.absent, true, "Deletion not independently confirmed");
  result.deletions.push({ ...item, ...idle, deleted: !!verified.absent });
}
const after = await inventory();
for (const id of protectedIds) assert.ok(after.some(t => t.templateId === id), `Protected template lost: ${id}`);
if (apply) {
  for (const item of plan.templates) {
    const absent = await request(`/kakao/v2/templates/${item.templateId}`);
    assert.equal(absent.absent, true, "Do not remove status cache before verified deletion");
    // This is only a provider-status cache, never a candidate, send, or survey record.
    await db.collection("alimtalkTemplateStates").doc(item.templateId).delete();
  }
  result.removedStatusCacheIds = plan.templates.map(t => t.templateId);
}
result.afterCount = after.length;
result.retained = after.map(t => ({ templateId: t.templateId, name: t.name, status: t.status }));
await fs.writeFile(path.join(dir, apply ? "result.json" : "dry-run.json"), JSON.stringify(result, null, 2) + "\n");
if (apply) {
  const old = JSON.parse(await fs.readFile(path.join(root, "scripts/fixtures/alimtalk-catalog-provider-presence.json")));
  const absentIds = new Set([...old.absent.map(t => t.templateId), ...plan.templates.map(t => t.templateId), "KA01TP261006054728079NtSGrYdtSQH"]);
  const absent = [];
  for (const id of absentIds) {
    assert.ok(!after.some(t => t.templateId === id), "Unexpected surviving retired template");
    const evidence = await request(`/kakao/v2/templates/${id}`);
    assert.equal(evidence.absent, true, "Historical deletion not verified");
    absent.push({ templateId: id, httpStatus: 404, errorCode: "TemplateNotFound" });
  }
  const templates = after.map(t => ({ templateId: t.templateId, name: t.name }));
  await fs.writeFile(path.join(root, "scripts/fixtures/alimtalk-catalog-known-provider.json"), JSON.stringify({ basis: "Complete provider inventory at observedAt; not current approval or deployment evidence", observedAt: result.checkedAt, templates }, null, 2) + "\n");
  await fs.writeFile(path.join(root, "scripts/fixtures/alimtalk-catalog-provider-presence.json"), JSON.stringify({ checkedAt: result.checkedAt, inventoryComplete: true, basis: "Authorized retirement verified by individual HTTP 404 TemplateNotFound and exhausted inventory; original send history retained", present: templates.map(t => t.templateId), absent }, null, 2) + "\n");
}
console.log(JSON.stringify(result, null, 2));
