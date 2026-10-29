import assert from "node:assert/strict";
import test from "node:test";
import { ORIGINAL_TEMPLATE, validInventoryQuery, inventoryRequestKind, parseInventoryPage, verifyInventoryCoverage,
  nativeTemplatePath, parseNativeInventoryPage }
  from "../audit-instructor-signup-enrichment.mjs";

const COMPANY = "848f6dc7fa024a6cb28a2994c0835e53";
const LIST = `https://kr-service.eformsign.com/v1.0/companies/${COMPANY}/documents`;
const query = (skip = 0) => ({ skip, limit: 20, type: "ai", search: "", sort: "update_date", sort_type: "desc" });
const id = index => index.toString(16).padStart(32, "0");

function page(skip = 0, total = 26, patch = {}) {
  const documents = Array.from({ length: Math.max(0, Math.min(20, total - skip)) }, (_, i) => ({
    document_id: id(skip + i + 1), title: `Synthetic ${skip + i + 1}`,
    form_id: i % 2 ? "b".repeat(32) : ORIGINAL_TEMPLATE,
    private_answers: "NEVER_PERSIST", token: "NEVER_PERSIST" }));
  return { request: { input: { query: query(skip) }, access_token: "NEVER_PERSIST" },
    body: { status: "200", code: "-1", result: { total_rows: total, documents } }, httpStatus: 200,
    domRows: documents.map((doc, i) => ({ documentId: doc.document_id, title: doc.title,
      href: `/eform/document/view_service.html?document_id=${doc.document_id}&form_id=${i % 2 ? "b".repeat(32) : ORIGINAL_TEMPLATE}`,
      completed: true })), expectedSkip: skip, expectedLimit: 20, ...patch };
}

test("only exact read-only completed-list POST queries and known metadata POSTs are allowed", () => {
  assert.equal(validInventoryQuery(query()), true);
  const emptyQuery = query(); delete emptyQuery.search;
  assert.equal(validInventoryQuery(emptyQuery), true);
  assert.equal(validInventoryQuery({ ...query(), limit: "100", skip: "0" }), true);
  assert.equal(inventoryRequestKind({ url: LIST, method: "POST", payload: { input: { query: query() } } }), "completed_list");
  for (const patch of [{ type: "ip" }, { skip: 1 }, { skip: -20 }, { limit: 1000 }, { search: "Private Name" },
    { sort: "title" }, { action: "delete" }]) {
    assert.equal(inventoryRequestKind({ url: LIST, method: "POST", payload: { input: { query: { ...query(), ...patch } } } }), "blocked_non_read");
  }
  assert.equal(inventoryRequestKind({ url: LIST.replace(COMPANY, "b".repeat(32)), method: "POST", payload: { input: { query: query() } } }), "blocked_non_read");
  assert.equal(inventoryRequestKind({ url: LIST + "/" + id(1) + "/status", method: "GET" }), "blocked_document_detail");
  assert.equal(inventoryRequestKind({ url: "https://www.eformsign.com/eform/document/view_service.html", method: "GET" }), "blocked_document_detail");
  assert.equal(inventoryRequestKind({ url: LIST + "/send", method: "POST" }), "blocked_document_detail");
  assert.equal(inventoryRequestKind({ url: `https://kr-service.eformsign.com/v1.0/companies/${COMPANY}/multi_category_by_permission`, method: "POST" }), "metadata");
});

test("sanitized inventory retains only original-template list proof, never answers or credentials", () => {
  const p = parseInventoryPage(page());
  assert.equal(p.total, 26); assert.equal(p.ids.length, 20); assert.equal(p.documents.length, 10);
  assert.ok(p.documents.every(row => row.templateId === ORIGINAL_TEMPLATE && row.status === "completed_list_only"));
  assert.doesNotMatch(JSON.stringify(p), /NEVER_PERSIST|private_answers|access_token/);
  assert.deepEqual(Object.keys(p.documents[0]).sort(), ["documentId", "listProofHash", "sourceSkip", "status", "templateId", "title"]);
});

test("full pages plus partial final page have exact contiguous, total and unique coverage", () => {
  const first = parseInventoryPage(page()), last = parseInventoryPage(page(20));
  const coverage = verifyInventoryCoverage([first, last], first);
  assert.equal(coverage.complete, true); assert.equal(coverage.uniqueAllTemplates, 26);
  assert.equal(coverage.pagesVerified, 2); assert.equal(coverage.matchedOriginalTemplate, 13);
  assert.throws(() => verifyInventoryCoverage([first], first));
  assert.throws(() => verifyInventoryCoverage([last, first], first));
  assert.throws(() => verifyInventoryCoverage([first, { ...last, ids: first.ids.slice(0, 6) }], first));
  assert.throws(() => verifyInventoryCoverage([first, last], { ...first, total: 27 }));
});

test("page guards reject short pages, ambiguous IDs, wrong links and stale UI", () => {
  for (const mutate of [
    p => p.body.result.documents.pop(), p => { p.domRows[0].documentId = id(999); },
    p => { p.body.result.documents[0].id = id(999); }, p => { p.domRows[0].title = "Wrong title"; },
    p => { p.domRows[0].href = "https://example.invalid/"; },
    p => { p.request.input.query.skip = 20; }, p => { p.body.result.total_rows = "26"; },
  ]) {
    const value = page(); mutate(value); assert.throws(() => parseInventoryPage(value));
  }
});

test("ai inventory never promotes folder membership to individual document status proof", () => {
  const value = page(); value.domRows.forEach(row => { delete row.completed; });
  assert.ok(parseInventoryPage(value).documents.every(row => row.status === "completed_list_only"));
});

test("anchor tolerates volatile raw response hash but rejects actual title or identity changes", () => {
  const first = parseInventoryPage(page()), last = parseInventoryPage(page(20));
  const anchor = structuredClone(first); anchor.documents[0].listProofHash = "f".repeat(64);
  assert.equal(verifyInventoryCoverage([first, last], anchor).complete, true);
  anchor.documents[0].title = "Changed";
  assert.throws(() => verifyInventoryCoverage([first, last], anchor));
});

test("empty complete inventory is distinct from missing pages", () => {
  const first = parseInventoryPage(page(0, 0));
  assert.equal(verifyInventoryCoverage([first], first).uniqueAllTemplates, 0);
  assert.throws(() => verifyInventoryCoverage([], first));
});

test("native replay pages use a DOM-bound template path and label API proof distinctly", () => {
  const firstValue = page(), first = parseInventoryPage(firstValue);
  const templatePath = nativeTemplatePath(firstValue.body.result.documents, firstValue.domRows);
  assert.deepEqual(templatePath, ["form_id"]);
  const last = parseNativeInventoryPage({ ...page(20), templatePath });
  const anchor = parseNativeInventoryPage({ ...page(), templatePath });
  assert.equal(first.proof.source, "native_ui_and_list_post");
  assert.equal(last.proof.source, "native_list_post");
  assert.equal(verifyInventoryCoverage([first, last], anchor).uniqueAllTemplates, 26);
  assert.doesNotMatch(JSON.stringify(last), /NEVER_PERSIST|private_answers|access_token/);
  const wrong = page(20); wrong.body.result.documents[0].form_id = "invalid";
  assert.throws(() => parseNativeInventoryPage({ ...wrong, templatePath }));
  assert.throws(() => nativeTemplatePath(firstValue.body.result.documents, firstValue.domRows.map(row => ({
    ...row, href: row.href.replace(ORIGINAL_TEMPLATE, "c".repeat(32)) }))));
});
