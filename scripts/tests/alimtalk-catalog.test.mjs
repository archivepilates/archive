import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { buildCatalog, catalogFile, catalogVisibility } from "../generate-alimtalk-catalog.mjs";
import { root, sourceRoot, sourceReader, hash } from "../lib/alimtalk-catalog-source.mjs";
import { purposes } from "../lib/alimtalk-catalog-metadata.mjs";
import { createCatalogFixture } from "../verify-alimtalk-catalog.mjs";

const saved = JSON.parse(await fs.readFile(path.join(root, catalogFile), "utf8"));
const moduleSource = await fs.readFile(path.join(root, "core/assets/alimtalk-catalog.js"), "utf8");
const ui = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString("base64")}`);
const require = createRequire(import.meta.url);
const compiled = await build({
  stdin: { contents: `export { ALIMTALK_TEMPLATES } from './alimtalk/templates'; export { ALIMTALK_TEMPLATE_TARGET_RULES } from './alimtalk/templateTargetRules'; export { TICKET_NOTICE_POLICY, REVIEWED_TICKET_FACT_CONTRACTS } from './alimtalk/ticketNoticePolicy';`, resolveDir: path.join(root, sourceRoot), loader: "ts" },
  bundle: true, write: false, platform: "node", format: "cjs", define: { "process.env": "{}" },
});
const sandbox = { module: { exports: {} }, require: (name) => {
  assert.equal(name, "node:crypto", "No backend runtime/service imports are permitted");
  return require("node:crypto");
} };
vm.runInNewContext(compiled.outputFiles[0].text, sandbox, { timeout: 2000 });
const actual = JSON.parse(JSON.stringify(sandbox.module.exports));

test("saved JSON exactly matches current policy/source fingerprints", async () => {
  assert.deepEqual(saved, await buildCatalog());
  assert.equal(saved.policyFingerprint, hash(JSON.stringify(saved.sourceFingerprints)));
});

test("all 23 known provider templates occur exactly once, including unconnected/history/separate project", async () => {
  const coverage = JSON.parse(await fs.readFile(path.join(root, "scripts/fixtures/alimtalk-catalog-known-provider.json"), "utf8"));
  assert.equal(coverage.templates.length, 23);
  for (const { templateId } of coverage.templates) assert.equal(saved.rows.filter((row) => row.code === templateId && row.knownProvider).length, 1);
  assert.ok(saved.rows.length > 23);
  for (const state of ["source_connected", "source_only", "archived", "unconnected", "separate_project"]) assert.ok(saved.rows.some((row) => row.implementation === state));
});

test("purpose, target, exclusions and date-policy parity against independently compiled backend exports", () => {
  assert.equal(saved.rows.filter((row) => row.type).length, Object.keys(actual.ALIMTALK_TEMPLATES).length);
  for (const [type, template] of Object.entries(actual.ALIMTALK_TEMPLATES)) {
    const row = saved.rows.find((row) => row.type === type);
    assert.equal(row.code, template.code, type);
    assert.equal(row.label, template.label, type);
    assert.equal(row.purpose, purposes[type], type);
    const policy = actual.ALIMTALK_TEMPLATE_TARGET_RULES[type];
    if (policy) {
      assert.deepEqual(row.policy, policy, type);
      assert.deepEqual(row.targetRules, policy.targetRules, type);
    }
  }
});

test("four fact-only contracts keep followup candidates without blanket template-pending or live approval", () => {
  const rows = saved.rows.filter((row) => row.factNotice);
  assert.equal(rows.length, 4);
  for (const row of rows) {
    assert.equal(row.purposeId, actual.TICKET_NOTICE_POLICY.purpose);
    assert.equal(row.factNotice.followupPurchaseExcludes, false);
    assert.equal(row.factNotice.reviewState, "reviewed_fact_only");
    assert.equal(row.factNotice.contractFingerprint, actual.REVIEWED_TICKET_FACT_CONTRACTS[row.code]);
    assert.ok(row.targetRules.includes(actual.TICKET_NOTICE_POLICY.targetRule));
    assert.notEqual(row.implementation, "pending_template");
    assert.equal(row.providerApproval.status, "UNKNOWN");
  }
});

test("timing parity: schedules are extracted from declarations and original source lines", () => {
  const reader = sourceReader();
  for (const row of saved.rows.filter((row) => row.schedule)) {
    const ref = row.sources.find((source) => source.symbol.startsWith("scheduled"));
    assert.ok(ref, row.id);
    assert.equal(row.schedule.expression, reader.schedule(ref.path, ref.symbol).expression);
    assert.equal(row.schedule.timezone, "Asia/Seoul");
    assert.ok(ui.renderCatalogRow(row).includes(ui.scheduleText(row.schedule)));
  }
  const reservation = saved.rows.find((row) => row.type === "reservation_open");
  assert.equal(reservation.careGroup, false);
  assert.equal(reservation.schedule.expression, "30 12 * * 1");
  assert.equal(saved.rows.find((row) => row.type === "staff_private_survey").timing, "D-1 09:00부터 수업 시작 전");
  assert.equal(saved.rows.find((row) => row.type === "staff_group_survey").timing, "수업 1시간 전부터 수업 시작 전");
});

test("generated data never turns static approval, history, or a send into live status", () => {
  assert.equal(ui.validateCatalog(saved), saved);
  for (const row of saved.rows) {
    assert.deepEqual(row.providerApproval, { status: "UNKNOWN", checkedAt: null, evidence: "not_read_in_this_catalog" });
    assert.equal(row.deployment.status, "UNVERIFIED");
  }
  const unsafe = structuredClone(saved);
  unsafe.rows[0].providerApproval.status = "APPROVED";
  assert.throws(() => ui.validateCatalog(unsafe), /운영 상태/);
  assert.throws(() => ui.validateCatalog({ rows: [] }), /형식/);
  const duplicate = structuredClone(saved);
  duplicate.rows.push(duplicate.rows[0]);
  assert.throws(() => ui.validateCatalog(duplicate), /정책 연결/);
});

test("filters exclude confirmed deletions consistently while preserving current templates", () => {
  assert.equal(saved.rows.length, 32, "audit/source history remains intact");
  assert.equal(ui.selectCatalogRows(saved).length, 23);
  assert.equal(ui.selectCatalogRows(saved, { scope: "known" }).length, 23);
  assert.equal(ui.selectCatalogRows(saved, { scope: "source" }).length, 0);
  assert.equal(ui.selectCatalogRows(saved, { implementation: "unconnected" }).length, 2);
  assert.equal(ui.selectCatalogRows(saved, { implementation: "archived" }).length, 3);
  for (const row of saved.rows) {
    const visible = row.visibility.state === "visible";
    for (const scope of ["all", row.knownProvider ? "known" : "source"])
      for (const implementation of ["all", row.implementation])
        assert.equal(ui.selectCatalogRows(saved, { search: row.code || row.label, scope, implementation }).includes(row), visible, row.id);
  }
  assert.equal(ui.selectCatalogRows(saved, { search: "후속 수강권" }).length, 4);
  assert.equal(ui.selectCatalogRows(saved, { search: "no-such-template" }).length, 0);
});

test("only exact missing-template evidence or explicit code-less source deletion hides rows", () => {
  const row = { code: "unknown", sourceConfiguredStatus: "unapproved", implementation: "archived", label: "삭제됨" };
  const presence = { checkedAt: "2026-09-30T12:13:51.489Z", inventoryComplete: true, present: [], absent: [] };
  assert.equal(catalogVisibility(row, presence).state, "visible");
  for (const error of [{ httpStatus: 503, errorCode: "TemplateNotFound" }, { httpStatus: 404, errorCode: "Unauthorized" }, { httpStatus: 403, errorCode: "Forbidden" }])
    assert.equal(catalogVisibility(row, { ...presence, absent: [{ templateId: row.code, ...error }] }).state, "visible");
  const absent = [{ templateId: row.code, httpStatus: 404, errorCode: "TemplateNotFound" }];
  assert.equal(catalogVisibility(row, { ...presence, absent }).state, "hidden_deleted");
  assert.equal(catalogVisibility(row, { ...presence, absent, inventoryComplete: false }).state, "visible");
  assert.equal(catalogVisibility(row, { ...presence, absent, present: [row.code] }).state, "visible");
  assert.equal(catalogVisibility({ ...row, sourceConfiguredStatus: "deleted" }, presence).state, "visible");
  assert.equal(catalogVisibility({ ...row, code: "", sourceConfiguredStatus: "deleted" }, presence).state, "hidden_deleted");
  const unknown = { ...saved.rows[0], knownProvider: false, visibility: undefined };
  assert.equal(ui.selectCatalogRows({ rows: [unknown] }).length, 1);
  const invalid = structuredClone(saved);
  invalid.rows[0].visibility = { state: "hidden_deleted", basis: "missing_from_list" };
  assert.throws(() => ui.validateCatalog(invalid), /삭제 근거/);
});

test("rendered details include all policy targets and escape HTML without action controls", () => {
  for (const row of saved.rows) {
    const html = ui.renderCatalogRow(row);
    assert.ok(html.includes(row.purpose));
    assert.ok(html.includes(row.timing));
    assert.ok(html.includes("승인 미확인"));
    assert.ok(html.includes("미검증 · 소스 연결"));
    assert.doesNotMatch(html, /<button|<form/);
    for (const ref of row.sources) assert.ok(html.includes(ref.path));
  }
  const html = ui.renderCatalogRow({ ...saved.rows[0], label: '<img src=x onerror="alert(1)">' });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

test("catalog reads only same-origin static data; no Firebase/provider SDK or mutation", () => {
  assert.doesNotMatch(moduleSource, /firebase|solapi\.com|setDoc|updateDoc|httpsCallable|XMLHttpRequest|WebSocket/);
  assert.match(moduleSource, /credentials: "omit"/);
  assert.match(moduleSource, /cache: "no-store"/);
});

test("synthetic fixture fails closed before external fetch/XHR/socket calls and never starts Firebase", async () => {
  const fixture = await createCatalogFixture({ autoCloseMs: 0 });
  try {
    const calls = [];
    const context = {
      URL, location: { href: `${fixture.origin}/messages/`, origin: fixture.origin },
      navigator: {}, document: { addEventListener() {} },
      window: { fetch: async (...args) => { calls.push(args); return { ok: true }; } },
    };
    vm.runInNewContext(fixture.assets.get("/fixture-guard.js"), context);
    await context.window.fetch("/assets/alimtalk-catalog.json");
    assert.equal(calls.length, 1);
    for (const url of ["https://firestore.googleapis.com/", "https://solapi.com/", "/firebase-config.js", "/anything-else"])
      await assert.rejects(context.window.fetch(url), /blocked/);
    await assert.rejects(context.window.fetch("/assets/alimtalk-catalog.json", { method: "POST" }), /blocked/);
    assert.equal(calls.length, 1, "No blocked request reached the native fetch");
    for (const name of ["XMLHttpRequest", "WebSocket", "EventSource"]) assert.throws(() => new context.window[name](), /blocks/);
    const html = fixture.assets.get("/messages/");
    assert.doesNotMatch(html, /firebase-config\.js/);
    assert.match(html, /fixture-guard\.js/);
    assert.ok(!fixture.assets.get("/assets/app.js").includes('if (document.querySelector("[data-firestore-dashboard]")) refresh();'));
    assert.match(fixture.csp, /connect-src 'self'/);
    assert.equal((await fetch(`${fixture.origin}/assets/alimtalk-catalog-error.json`)).status, 503);
  } finally { await fixture.close(); }
  assert.equal(fixture.server.listening, false);
});

test("operator-rule link resolves to the actual local draft; collapsed copy avoids jargon", async () => {
  const rules = await fs.readFile(path.join(root, "core/rules/index.html"), "utf8");
  assert.match(rules, /id="alimtalk-catalog-draft"/);
  assert.match(rules, /10건 미만이어도 별도 추가분 승인/);
  assert.match(rules, /독립 승인 경로는 그대로 유지/);
  for (const row of saved.rows) {
    const html = ui.renderCatalogRow(row);
    assert.doesNotMatch(html, /기지 공급자|케어 그룹|UNKNOWN/);
  }
});
