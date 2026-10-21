import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as crypto from "node:crypto";
import vm from "node:vm";

const root = new URL("../../firebase/kangsain-functions/functions/", import.meta.url);
const ts = createRequire(new URL("package.json", root))("typescript");
const NOW = Date.parse("2026-10-23T00:00:00Z");
const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const stamp = ms => ({ toMillis: () => ms });
class Clock extends Date { static now() { return NOW; } }
const source = readFileSync(new URL("src/alimtalk/memberDispatchRequests.ts", root), "utf8");
const exports = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText, { exports, Date: Clock, Error, Buffer, URL, require: id => {
  if (id === "node:crypto") return crypto;
  if (id === "../utils/hash") return { stableHash: hash };
  if (id === "./testRecipients") return { normalizeRecipientPhone: phone => String(phone || "").replace(/\D/g, "") };
  throw new Error(`Unexpected runtime import: ${id}`);
} });

function fixture(type = "recommended_meal_survey") {
  const id = type === "pricing_info" ? "pricing_info_2026-10-22_test" : "meal-2026-10-22-test";
  const token = "a".repeat(48), phone = "01000000001";
  const candidate = { candidateId: type === "pricing_info" ? id : `${id}-invite`, type,
    sourceActionKey: id, memberId: type === "pricing_info" ? `pricing_lead_${hash({ phone }).slice(0, 12)}` : "1001",
    memberPhone: phone, memberName: "테스트 회원", studioId: "5330", templateCode: "synthetic", status: "processing", queueLeaseId: "lease" };
  const surveyUrl = `https://in.archivepilates.com/recommendedMealSurvey/?id=${id}&token=${token}`;
  const reportUrl = `https://in.archivepilates.com/recommendedMealPlan/?id=${id}&token=${token}`;
  const request = { requestId: id, candidateId: candidate.candidateId, memberId: candidate.memberId,
    memberName: candidate.memberName, memberPhone: phone, studioId: "5330", templateCode: "synthetic", status: "queued" };
  const rows = new Map(), writes = [], queries = [];
  const path = `${type === "pricing_info" ? "pricingInquiryAlimtalkRequests" : "recommendedMealProgramRequests"}/${id}`;
  if (type === "pricing_info") {
    Object.assign(request, { pricingUrl: "https://archivepilates.notion.site/pricing", buttonUrl: "https://archivepilates.notion.site/pricing" });
    candidate.payload = { pricingUrl: request.pricingUrl, buttonUrl: request.buttonUrl };
  } else {
    Object.assign(request, { accessTokenHash: crypto.createHash("sha256").update(token).digest("hex"), expiresAt: stamp(NOW + 1000),
      surveyUrl, reportUrl, shortLinkId: "survey-link", shortUrl: "https://in.archivepilates.com/s/survey-link/",
      reportShortLinkId: "report-link", reportShortUrl: "https://in.archivepilates.com/s/report-link/" });
    candidate.payload = { surveyId: id, accessToken: token, surveyUrl, reportUrl,
      shortLinkId: request.shortLinkId, shortUrl: request.shortUrl,
      reportLinkId: request.reportShortLinkId, reportShortUrl: request.reportShortUrl };
    rows.set("shortLinks/survey-link", { linkId: "survey-link", active: true, type, targetUrl: surveyUrl, sourceId: id });
    rows.set("shortLinks/report-link", { linkId: "report-link", active: true, type: "recommended_meal_report", targetUrl: reportUrl, sourceIds: [`${id}-report`] });
  }
  rows.set(path, request); rows.set(`alimtalkCandidates/${candidate.candidateId}`, candidate);
  const doc = path => ({ path });
  const snapshot = path => ({ ref: doc(path), data: () => rows.get(path) });
  const db = { doc, collection: name => ({ where: (field, op, value) => ({ limit: limit => ({ get: async () => {
    queries.push({ name, field, op, value, limit });
    return { docs: [...rows].filter(([path, row]) => path.startsWith(`${name}/`) && row[field] === value).slice(0, limit).map(([path]) => snapshot(path)) };
  } }) }) }), runTransaction: async callback => {
    const staged = [];
    const result = await callback({ get: async ref => { assert.equal(staged.length, 0); return snapshot(ref.path); },
      update: (ref, patch) => { assert.ok(rows.has(ref.path)); staged.push([ref.path, patch]); } });
    for (const [path, patch] of staged) { rows.set(path, { ...rows.get(path), ...patch }); writes.push([path, patch]); }
    return result;
  } };
  const deps = { db, timestamp: () => stamp(NOW) };
  const send = { sendId: candidate.candidateId, candidateId: candidate.candidateId, memberId: candidate.memberId,
    memberPhone: phone, studioId: candidate.studioId, templateCode: candidate.templateCode, status: "done", solapiMessageId: "synthetic-receipt" };
  return { candidate, request, rows, writes, queries, deps, path, send,
    check: () => exports.assertMemberDispatchRequestAllowed(deps, candidate),
    reconcile: () => exports.reconcileMemberDispatchRequestOutcome(deps, candidate.candidateId, path),
    outcome: status => { rows.set(`alimtalkCandidates/${candidate.candidateId}`, { ...candidate, status }); } };
}

for (const type of ["pricing_info", "recommended_meal_survey"]) {
  test(`${type}: production-shaped canonical pending request passes without writes`, async () => {
    const f = fixture(type); await f.check(); assert.equal(f.writes.length, 0);
  });
  for (const [label, change] of [
    ["missing request", f => f.rows.delete(f.path)],
    ["cancelled", f => { f.request.status = "cancelled"; }],
    ["submitted", f => { f.request.status = "submitted"; }],
    ["deleted", f => { f.request.deleted = true; }],
    ["wrong phone", f => { f.request.memberPhone = "01000000002"; }],
    ["wrong studio", f => { f.request.studioId = "9999"; }],
    ["wrong name", f => { f.request.memberName = "다른 회원"; }],
    ["wrong candidate", f => { f.request.candidateId = "another"; }],
    ["changed claim", f => { f.rows.set(`alimtalkCandidates/${f.candidate.candidateId}`, { ...f.candidate, queueLeaseId: "other" }); }],
    ["prior outbound", f => { f.rows.set(`alimtalkSends/${f.candidate.candidateId}`, f.send); }],
  ]) test(`${type}: ${label} blocks before transport without changing audit`, async () => {
    const f = fixture(type); change(f); await assert.rejects(f.check(), error => error instanceof exports.MemberDispatchRequestBlockedError);
    assert.equal(f.writes.length, 0);
  });
  test(`${type}: morning terminal outcome replaces quiet queued display with matching receipt`, async () => {
    const f = fixture(type); Object.assign(f.request, { lastError: "member_dispatch_quiet_hours", nextEligibleAt: new Date(NOW).toISOString() });
    f.outcome("sent"); f.rows.set(`alimtalkSends/${f.candidate.candidateId}`, f.send);
    assert.equal((await f.reconcile()).status, "updated");
    const row = f.rows.get(f.path); assert.equal(row.status, "sent"); assert.equal(row.solapiMessageId, "synthetic-receipt");
    assert.equal(row.lastError, null); assert.equal(row.nextEligibleAt, null);
    assert.equal((await f.reconcile()).status, "unchanged");
  });
  test(`${type}: mismatched receipt cannot update another request`, async () => {
    const f = fixture(type); f.outcome("sent"); f.rows.set(`alimtalkSends/${f.candidate.candidateId}`, { ...f.send, memberPhone: "01000000002" });
    assert.equal((await f.reconcile()).status, "binding_mismatch"); assert.equal(f.writes.length, 0);
  });
  test(`${type}: ambiguous outcome never becomes sent`, async () => {
    const f = fixture(type); f.outcome("failed"); f.rows.set(`alimtalkSends/${f.candidate.candidateId}`, { ...f.send, status: "processing", solapiMessageId: "" });
    await f.reconcile(); assert.equal(f.rows.get(f.path).status, "unknown");
    assert.equal(f.rows.get(f.path).solapiMessageId, undefined);
  });
}
for (const [label, change] of [
  ["expired", f => { f.request.expiresAt = stamp(NOW - 1); }],
  ["exact expiry boundary", f => { f.request.expiresAt = stamp(NOW); }],
  ["missing expiry", f => { delete f.request.expiresAt; }],
  ["malformed expiry", f => { f.request.expiresAt = "invalid"; }],
  ["different token hash", f => { f.request.accessTokenHash = "0".repeat(64); }],
  ["different member", f => { f.request.memberId = "1002"; }],
  ["changed short link", f => { f.rows.get("shortLinks/survey-link").targetUrl += "changed"; }],
  ["inactive report link", f => { f.rows.get("shortLinks/report-link").active = false; }],
  ["different link source", f => { f.rows.get("shortLinks/report-link").sourceIds = ["other"]; }],
  ["wrong report route", f => { f.request.reportUrl = f.request.reportUrl.replace("recommendedMealPlan", "recommendedMealReport"); }],
]) test(`meal invitation: ${label} blocks resumed dispatch`, async () => {
  const f = fixture(); change(f); await assert.rejects(f.check(), error => error instanceof exports.MemberDispatchRequestBlockedError);
  assert.equal(f.writes.length, 0);
});
test("submitted meal answers remain submitted while original invite receipt is reconciled", async () => {
  const f = fixture(); Object.assign(f.request, { status: "submitted", submittedAt: stamp(NOW), responseId: "keep-response" });
  f.outcome("sent"); f.rows.set(`alimtalkSends/${f.candidate.candidateId}`, f.send); await f.reconcile();
  const row = f.rows.get(f.path); assert.equal(row.status, "submitted"); assert.equal(row.responseId, "keep-response");
  assert.equal(row.dispatchStatus, "sent"); assert.equal(row.solapiMessageId, "synthetic-receipt");
});
test("queued request reconciliation uses only two bounded existing-status queries", async () => {
  const f = fixture(); f.outcome("skipped"); await exports.reconcileQueuedMemberDispatchRequests(f.deps);
  assert.equal(f.rows.get(f.path).status, "skipped"); assert.equal(f.queries.length, 2);
  for (const query of f.queries) { assert.equal(query.field, "status"); assert.equal(query.value, "queued"); assert.equal(query.limit, 20); }
});
test("actual producers keep atomic request creation and canonical outcome reconciliation", () => {
  for (const relative of ["alimtalk/pricingInquiryAlimtalk.ts", "mealPlan/recommendedMealAlimtalk.ts"]) {
    const text = readFileSync(new URL(`src/${relative}`, root), "utf8");
    assert.match(text, /batch\.set\(refs\.alimtalkCandidate/); assert.match(text, /batch\.set\(requestRef/);
    assert.ok(text.indexOf("await batch.commit()") < text.indexOf("await processAlimtalkCandidate"));
    assert.match(text, /await reconcileMemberDispatchRequestOutcome\(\{ db, timestamp: nowTimestamp \}/);
  }
  const program = readFileSync(new URL("src/mealPlan/recommendedMealProgram.ts", root), "utf8");
  assert.ok(program.includes('const REPORT_BASE_URL = "https://in.archivepilates.com/recommendedMealPlan/"'));
});
