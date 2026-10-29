import assert from "node:assert/strict";
import test from "node:test";
import { parseSourceArgs, validateSourceInventory, sourceRequestKind, selectLatestCompleted,
  baselineSourceJob, verifiedDocumentHref, verifiedSourceRow } from "../read-instructor-signup-enrichment-sources.mjs";
import { INSTRUCTOR_MEMBER_EFORMSIGN_TEMPLATE_ID as TEMPLATE } from "../lib/instructor-lesson-registration-contract.mjs";

const DIRECTORY = "/Users/archivepilates/ArchiveIN/operations/instructor-signup-enrichment-20261030";
const COMPANY = "848f6dc7fa024a6cb28a2994c0835e53";
const LIST = `https://kr-service.eformsign.com/v1.0/companies/${COMPANY}/documents`;
const id = n => n.toString(16).padStart(32, "0");
const hash = "a".repeat(64);
function inventory() {
  return { ok: true, source: "eformsign_native_completed_list", account: "archivepilates@gmail.com", templateId: TEMPLATE,
    sourceWindow: { startedAt: "2026-10-30T00:00:00Z", finishedAt: "2026-10-30T00:01:00Z" },
    cleanup: { contextClosed: true, lockReleased: true },
    coverage: { complete: true, totalAllTemplates: 2, uniqueAllTemplates: 2, matchedOriginalTemplate: 2,
      pageSize: 20, pagesExpected: 1, pagesVerified: 1, firstPageRevalidated: true },
    pages: [{ skip: 0, limit: 20, totalRows: 2, rowCount: 2, queryHash: hash, responseHash: hash, documentIdsHash: hash }],
    documents: [1, 2].map(n => ({ documentId: id(n), title: `Synthetic ${n}`, templateId: TEMPLATE,
      status: "completed_list_only", listProofHash: hash, sourceSkip: 0 })) };
}
const doc = (n, completed = "2026-10-29T01:00:00Z", memberName = "Synthetic Instructor", memberPhone = "01000000001") => ({
  documentId: id(n), title: `Synthetic ${n}`, templateId: TEMPLATE,
  completionProof: { documentId: id(n), selectedDocumentId: id(n), templateId: TEMPLATE, status: "completed",
    providerCompletedAt: completed, observedAt: "2026-10-30T00:00:00Z", recipients: [{ name: memberName, phone: memberPhone }] } });

test("CLI requires one private inventory path and a bounded nonzero limit", () => {
  assert.deepEqual(parseSourceArgs([`--inventory=${DIRECTORY}/inventory.json`]), { inventoryPath: `${DIRECTORY}/inventory.json`, limit: 200 });
  assert.equal(parseSourceArgs(["--limit=1", `--inventory=${DIRECTORY}/inventory.json`]).limit, 1);
  for (const args of [[], ["--inventory=/tmp/inventory.json"], [`--inventory=${DIRECTORY}/../inventory.json`],
    [`--inventory=${DIRECTORY}/inventory.json`, "--limit=201"], [`--inventory=${DIRECTORY}/inventory.json`, "--limit=0"],
    [`--inventory=${DIRECTORY}/inventory.json`, "--limit=1.5"], [`--inventory=${DIRECTORY}/inventory.json`, "--send"],
    [`--inventory=${DIRECTORY}/inventory.json`, `--inventory=${DIRECTORY}/inventory.json`]]) assert.throws(() => parseSourceArgs(args));
});

test("inventory proof must be complete, native, original-template and exact unique scope", () => {
  assert.equal(validateSourceInventory(inventory()).scopeComplete, true);
  for (const mutate of [
    x => { x.ok = false; }, x => { x.coverage.complete = false; }, x => { x.account = "wrong@example.invalid"; },
    x => { x.templateId = id(9); }, x => { x.coverage.firstPageRevalidated = false; },
    x => { x.cleanup.lockReleased = false; }, x => { x.coverage.pagesVerified = 2; },
    x => { x.documents[0].templateId = id(9); }, x => { x.documents[1].documentId = x.documents[0].documentId; },
    x => { x.documents[0].status = "completed"; }, x => { x.documents[0].title = ""; },
    x => { x.documents[0].listProofHash = "b".repeat(64); }, x => { x.pages[0].rowCount = 1; },
    x => { x.source = "workLanes"; }, x => { x.sourceWindow.finishedAt = "invalid"; },
  ]) { const value = inventory(); mutate(value); assert.throws(() => validateSourceInventory(value)); }
});

test("limited audit cannot claim full scope or latest-document completeness", () => {
  const result = validateSourceInventory(inventory(), 1);
  assert.equal(result.inventoryCount, 2); assert.equal(result.documents.length, 1); assert.equal(result.scopeComplete, false);
});

test("sanitized inventory records cannot carry credentials or arbitrary payloads forward", () => {
  const source = inventory(); source.documents[0].token = "NEVER_PERSIST";
  source.documents[0].answers = { health: "NEVER_PERSIST" };
  assert.doesNotMatch(JSON.stringify(validateSourceInventory(source)), /NEVER_PERSIST|answers|token/);
});

const scope = { documentIds: new Set([id(1), id(2)]), titles: new Set(["Synthetic 1", "Synthetic 2"]) };
const kind = (url, method = "GET", payload, extra = {}) => sourceRequestKind({ ...scope, url, method, payload, ...extra });
test("only whitelisted exact company GET/status paths can be read", () => {
  assert.equal(kind(`${LIST}/${id(1)}/status`), "status_read");
  assert.equal(kind(`${LIST}/${id(1)}/status`, "POST"), "blocked_status");
  assert.equal(kind(`${LIST}/${id(3)}/status`), "blocked_status");
  assert.equal(kind(`${LIST.replace(COMPANY, id(4))}/${id(1)}/status`), "blocked_status");
  assert.equal(kind(`${LIST.replace("kr-service.eformsign.com", "example.invalid")}/${id(1)}/status`), "blocked_status");
  assert.equal(kind(`${LIST}/${id(1)}/send`, "POST"), "blocked_document");
  assert.equal(kind(`${LIST}/${id(1)}/histories?lang=ko&_=${Date.now()}`), "history_read");
  assert.equal(kind(`${LIST}/${id(3)}/histories`), "blocked_document");
  assert.equal(kind(`${LIST}/${id(1)}/histories`, "POST"), "blocked_document");
});

test("only known completed-list and metadata read POSTs pass; sends and mutations remain blocked", () => {
  const payload = { input: { query: { skip: 0, limit: 20, type: "ai", search: "Synthetic 1", sort: "update_date", sort_type: "desc" } } };
  assert.equal(kind(LIST, "POST", payload), "completed_list");
  for (const changes of [{ type: "ip" }, { limit: 1000 }, { skip: 20 }, { search: "Other Name" }, { action: "send" }]) {
    assert.equal(kind(LIST, "POST", { input: { query: { ...payload.input.query, ...changes } } }), "blocked_non_read");
  }
  assert.equal(kind(`https://kr-service.eformsign.com/v1.0/companies/${COMPANY}/multi_category_by_permission`, "POST"), "metadata");
  assert.equal(kind(`https://kr-service.eformsign.com/v1.0/companies/${COMPANY}/members/archivepilates@gmail.com/unstructured_forms`, "POST"), "metadata");
  for (const method of ["POST", "PATCH", "PUT", "DELETE"]) assert.equal(kind("https://www.eformsign.com/send", method), "blocked_non_read");
});

test("only the current verified viewer is allowed; foreign links, downloads and query tokens are blocked", () => {
  const target = doc(1), href = verifiedDocumentHref(target);
  assert.equal(kind(href), "blocked_viewer");
  assert.equal(kind(href, "GET", undefined, { viewerDocumentId: id(1) }), "viewer_read");
  assert.equal(kind(verifiedDocumentHref(doc(2)), "GET", undefined, { viewerDocumentId: id(1) }), "blocked_viewer");
  for (const link of [href.replace("www.eformsign.com", "example.invalid"), href + "&token=NEVER_PERSIST", href.replace(TEMPLATE, id(3))]) assert.throws(() => verifiedDocumentHref(target, link));
  for (const link of [href.replace("mode=ai", "mode=ip"), href.replace("viewFlag=true", "viewFlag=false"),
    href.replace("is_preview=true", "is_preview=false"), href + `&document_id=${id(2)}`]) assert.throws(() => verifiedDocumentHref(target, link));
  assert.equal(kind("https://www.eformsign.com/file.pdf"), "blocked_download");
});

test("latest actual provider time, not array order or observation time, selects one document per phone", () => {
  const first = doc(1), latest = doc(2, "2026-10-29T02:00:00Z"), other = doc(3, "2026-10-29T01:00:00Z", "Other Instructor", "01000000002");
  first.completionProof.observedAt = "2026-10-30T03:00:00Z";
  const result = selectLatestCompleted([latest, first, other]);
  assert.deepEqual(result.selected.map(row => row.documentId).sort(), [id(2), id(3)]);
  assert.deepEqual(result.excluded, [{ documentId: id(1), reason: "older_completed_document" }]);
});

test("equal actual completion instants and conflicting names hold the whole phone group", () => {
  const tied = selectLatestCompleted([doc(1), doc(2, "2026-10-29T10:00:00+09:00")]);
  assert.equal(tied.selected.length, 0); assert.ok(tied.excluded.every(row => row.reason === "equal_completion_time_hold"));
  const conflict = selectLatestCompleted([doc(1), doc(2, "2026-10-29T02:00:00Z", "Other Instructor")]);
  assert.equal(conflict.selected.length, 0); assert.ok(conflict.excluded.every(row => row.reason === "recipient_name_conflict"));
});

test("unverified completion cannot enter selection", () => {
  for (const mutate of [x => { x.completionProof.status = "waiting"; }, x => { x.completionProof.recipients = []; },
    x => { x.completionProof.providerCompletedAt = "invalid"; }, x => { x.completionProof.recipients[0].phone = "010****0001"; }]) {
    const value = doc(1); mutate(value); assert.throws(() => selectLatestCompleted([value]));
  }
});

test("baseline job requires active exact native instructor identity and never fabricates registration", () => {
  const member = { memberId: "123456", name: "Synthetic Instructor", phone: "01000000001", memberGrade: "강사회원", inactive: false };
  const result = baselineSourceJob(doc(1), member);
  assert.equal(result.baselineOnly, true); assert.equal(result.sendAllowed, false); assert.equal(result.status, "done");
  assert.equal(result.registrationId, ""); assert.equal(result.source, "completed_signup_profile_baseline_v2");
  for (const patch of [{ memberId: "excel_123" }, { name: "Other" }, { phone: "01000000002" }, { inactive: true },
    { inactive: undefined }, { memberGrade: "일반회원" }]) assert.throws(() => baselineSourceJob(doc(1), { ...member, ...patch }));
});

test("private verified rows match canonical queue input without retaining extra answers or credentials", () => {
  const member = { memberId: "123456", name: "Synthetic Instructor", phone: "01000000001", memberGrade: "강사회원", inactive: false };
  const document = doc(1), profile = { version: 2, templateId: TEMPLATE, documentId: id(1), memberName: member.name,
    memberPhone: member.phone, birthDateRaw: "900101", addressRaw: "Synthetic address", career: "", affiliation: "",
    token: "NEVER_PERSIST", health: "NEVER_PERSIST" };
  document.completionProof.observedAt = new Date().toISOString();
  const row = verifiedSourceRow(document, member, profile, document.completionProof, "2026-10-30T00:00:00Z");
  assert.equal(row.status, "verified"); assert.equal(row.documentName, document.title); assert.deepEqual(row.member, member);
  assert.equal(row.profile.birthDateRaw, "900101"); assert.equal(row.completionProof.providerCompletedAt, document.completionProof.providerCompletedAt);
  assert.equal(row.eligibleForBaseline, false); assert.equal(row.profileMemoJobId, `instructor_member_completion_${id(1)}`);
  assert.doesNotMatch(JSON.stringify(row), /NEVER_PERSIST|health|token/);
});
