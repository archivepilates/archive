import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import XLSX from "xlsx";
import {
  prepareMonthlySettlementFinalization, applyMonthlySettlementFinalization,
  SettlementFinalizationError,
} from "../lib/monthly-settlement-finalization.mjs";

const sha = (b) => createHash("sha256").update(b).digest("hex");
const sourceKeys = ["날짜", "수업시작", "수업종료", "수업", "차감 금액", "출결"];

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "settlement-finalization-test-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  t.mock.method(globalThis, "fetch", () => assert.fail("Network is forbidden"));
  const dir = path.join(root, "202610"), privateDir = path.join(root, "private");
  fs.mkdirSync(dir, { mode: 0o700 }); fs.mkdirSync(privateDir, { mode: 0o700 });
  const names = { xlsx: "아카이브 정산명세서 202610_검토본.xlsx", index: "아카이브 정산명세서 202610_INDEX_검토본.html" };
  const regular = [
    { name: "FixtureFirst", base: 101, meal: 11, gross: 112, deductions: [1, 2, 3, 4, 5, 6], net: 91 },
    { name: "FixtureSecond", base: 201, meal: 21, vehicle: 31, gross: 253, deductions: [7, 8, 9, 10, 11, 12], net: 196 },
  ];
  const staff = ["FixtureOtherA", regular[0].name, regular[1].name, "FixtureOtherB"];
  const lessonCandidates = [
    { 날짜: "2026-10-26", 수업시작: "10:00", 수업종료: "10:50", 수업: "프라이빗", "차감 금액": 17, 출결: "출석", excelRow: 2 },
    { 날짜: "2026-10-29", 수업시작: "11:00", 수업종료: "11:50", 수업: "프라이빗", "차감 금액": 17, 출결: "출석", excelRow: 3 },
    { 날짜: "2026-10-20", 수업시작: "19:00", 수업종료: "19:50", 수업: "프라이빗", "차감 금액": 17, 출결: "출석", excelRow: 4 },
    { 날짜: "2026-10-22", 수업시작: "19:00", 수업종료: "19:50", 수업: "프라이빗", "차감 금액": 17, 출결: "출석", excelRow: 5 },
  ];
  const sourceWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(sourceWb, XLSX.utils.aoa_to_sheet([
    [...sourceKeys, "수업 강사"], ...lessonCandidates.map((r) => [...sourceKeys.map((k) => r[k]), regular[0].name]),
  ]), "Source");
  const lessonSourcePath = path.join(root, "lessons.xlsx"); XLSX.writeFile(sourceWb, lessonSourcePath);
  const wb = XLSX.utils.book_new();
  for (const name of ["강사정보", "정산대장", "정산명세서", "근로급여산정"])
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Fixture"]]), name);
  const s = wb.Sheets["근로급여산정"];
  const put = (cell, v) => { s[cell] = { t: typeof v === "number" ? "n" : "s", v }; };
  const [first, second] = regular;
  for (const [cell, v] of Object.entries({ A1: "2026년 10월 근로급여 내역", B3: first.name,
    B5: first.base, B6: first.meal, B7: first.gross, B19: first.net, B20: 34, B21: 29, B22: 120,
    B36: "2회 확정", C36: "10/26 10:00~10:50 · 10/29 11:00~11:50", B39: "14:00~22:00",
    A42: `${second.name} 10월 근로급여`, B43: second.base, B44: second.meal,
    B45: second.vehicle, B46: second.gross, B55: second.net, B57: 246 })) put(cell, v);
  first.deductions.forEach((v, i) => put(`B${12 + i}`, v));
  second.deductions.forEach((v, i) => put(`B${48 + i}`, v));
  s.B21.f = "'정산대장'!P6";
  s["!ref"] = "A1:C57";
  const rows = [[], [], ["순번", "성 명", "직 책", "그룹", "프라이빗", "강사레슨"], [],
    ...staff.map((name, i) => { const row = [i + 1, name]; row[15] = 29; row[16] = 120; row[17] = 0;
      if (name === first.name) row[17] = first.net;
      if (name === second.name) { row[17] = second.net; row[16] = 246; }
      return row; })];
  wb.Sheets["정산대장"] = XLSX.utils.aoa_to_sheet(rows);
  XLSX.writeFile(wb, path.join(dir, names.xlsx));
  const baselineFiles = [];
  for (const name of staff) {
    const file = `아카이브 정산명세서 202610 ${name}_검토본.html`;
    const bytes = Buffer.from(`<html><body><p>${name} fixture; 지급·발송 미실행</p></body></html>`);
    fs.writeFileSync(path.join(dir, file), bytes);
    if (!regular.some((r) => r.name === name)) baselineFiles.push({ name: file, sha256: sha(bytes) });
  }
  const payrollPdfPaths = [];
  for (const [i, employee] of regular.entries()) {
    const provided = `아카이브 급여명세서 202610 ${employee.name}_제공원문.pdf`;
    const bytes = Buffer.from(`%PDF-1.7\nsynthetic source ${i}\n%%EOF`);
    fs.writeFileSync(path.join(dir, provided), bytes);
    const original = path.join(root, `original-${i}.pdf`); fs.writeFileSync(original, bytes); payrollPdfPaths.push(original);
    fs.writeFileSync(path.join(dir, `아카이브 급여명세서 202610 ${employee.name}_검토본.pdf`), `%PDF-1.7\nsynthetic combined ${i}\n%%EOF`);
  }
  const indexLinks = [...staff.map((n) => `아카이브 정산명세서 202610 ${n}_검토본.html`), names.xlsx];
  const index = Buffer.from(`<!doctype html>\n<html lang="ko"><title>September layout preserved</title><body>
<p>검토본 · 실제 이체·강사 발송 미실행 · 금융 지급 승인이 아닙니다.</p>
${indexLinks.map((n) => `<a href="${encodeURIComponent(n)}">${n}</a>`).join("\n")}</body></html>\n`);
  fs.writeFileSync(path.join(dir, names.index), index);
  const employmentPdfPath = path.join(root, "employment.pdf"); fs.writeFileSync(employmentPdfPath, "%PDF-1.7\nsynthetic retained evidence\n%%EOF");
  const baselinePath = path.join(privateDir, "baseline.json");
  fs.writeFileSync(baselinePath, JSON.stringify({ target: dir, files: baselineFiles }), { mode: 0o600 });
  const auditPath = path.join(privateDir, "audit.json");
  const artifactNames = [names.xlsx, names.index, ...regular.flatMap((r) => [
    `아카이브 정산명세서 202610 ${r.name}_검토본.html`, `아카이브 급여명세서 202610 ${r.name}_검토본.pdf`,
    `아카이브 급여명세서 202610 ${r.name}_제공원문.pdf`,
  ])];
  const audit = { month: "202610", target: dir, regular, extraCount: 2, extraGross: 34, extraNet: 29,
    lessonSourceSha256: sha(fs.readFileSync(lessonSourcePath)), lessonCandidates,
    selectedExtraLessons: structuredClone(lessonCandidates.slice(0, 2)),
    weekdayWorkingHours: { start: "14:00", end: "22:00", basis: "operator_confirmed", scope: "202610_payroll" },
    dateAllocationConfirmed: true, unaffectedInstructorsPreserved: true, classCountPreserved: true,
    bankDetailsPreserved: true, sourcePdfsUnmodified: true, payrollPaid: false, staffSent: false };
  const options = { month: "202610", reviewDirectory: dir, auditPath, baselinePath, lessonSourcePath, payrollPdfPaths,
    employmentPdfPath, expectedEmploymentSha256: sha(fs.readFileSync(employmentPdfPath)),
    expectedBaselineSha256: sha(fs.readFileSync(baselinePath)) };
  const writeAudit = (rehash = true) => {
    if (rehash) audit.files = artifactNames.map((name) => {
      const b = fs.readFileSync(path.join(dir, name)); return { name, sha256: sha(b), size: b.length };
    });
    fs.writeFileSync(auditPath, JSON.stringify(audit), { mode: 0o600 });
    options.expectedAuditSha256 = sha(fs.readFileSync(auditPath));
  };
  writeAudit();
  const changeWorkbook = (change) => {
    const p = path.join(dir, names.xlsx), w = XLSX.readFile(p); change(w); XLSX.writeFile(w, p); writeAudit();
  };
  return { root, dir, privateDir, options, names, audit, writeAudit, changeWorkbook,
    intentPath: path.join(privateDir, "finalization-202610.json") };
}

function rejected(fn, code) {
  assert.throws(fn, (e) => e instanceof SettlementFinalizationError && e.code === code
    && !e.message.includes("synthetic-private-value"));
}

test("prepare is deterministic, read-only, and exposes no compensation values", (t) => {
  const f = fixture(t), before = fs.readdirSync(f.dir);
  const plan = prepareMonthlySettlementFinalization(f.options);
  assert.deepEqual(plan, prepareMonthlySettlementFinalization(f.options));
  assert.deepEqual(fs.readdirSync(f.dir), before);
  assert.equal(fs.existsSync(f.intentPath), false);
  assert.equal(plan.inputs.length, 16);
  assert.equal(plan.outputs.length, 2);
  assert.equal(plan.artifactFinalizationOnly, true);
  assert.equal(plan.paymentAuthorized, false);
  assert.equal(plan.checks.noRecalculation, true);
  assert.equal(Object.hasOwn(plan, "regular"), false);
  for (const output of plan.outputs) assert.equal(output.sha256, sha(fs.readFileSync(output.sourcePath)));
});

test("actual synthetic apply copies INDEX and XLSX byte-for-byte and independently verifies all links", (t) => {
  const f = fixture(t), plan = prepareMonthlySettlementFinalization(f.options), before = fs.readdirSync(f.dir);
  const originalHashes = plan.inputs.map((input) => sha(fs.readFileSync(input.path)));
  const result = applyMonthlySettlementFinalization(f.options, { expectedPlanSha256: plan.planSha256, intentPath: f.intentPath });
  assert.equal(result.state, "verified"); assert.equal(result.independentlyReadBack, true);
  assert.equal(result.payrollPaid, false); assert.equal(result.staffSent, false);
  assert.equal(result.paymentAuthorized, false);
  for (const output of result.outputs) assert.deepEqual(fs.readFileSync(output.path), fs.readFileSync(output.sourcePath));
  assert.deepEqual(plan.inputs.map((input) => sha(fs.readFileSync(input.path))), originalHashes);
  for (const link of result.links) assert.equal(fs.lstatSync(path.join(f.dir, link)).isFile(), true);
  assert.equal(fs.readFileSync(result.outputs[1].path, "utf8").includes("September layout preserved"), true);
  assert.equal(fs.readFileSync(result.outputs[1].path, "utf8").includes("실제 이체·강사 발송 미실행"), true);
  assert.equal(fs.existsSync(path.join(f.dir, "아카이브 정산 202610.xlsx")), false);
  assert.equal(fs.readdirSync(f.dir).length, before.length + 2);
  const intent = JSON.parse(fs.readFileSync(f.intentPath));
  assert.equal(intent.state, "verified");
  assert.deepEqual(intent.history, ["intent", "statement_written", "verified"]);
  assert.equal(intent.planSha256, plan.planSha256);
  assert.equal(fs.statSync(f.intentPath).mode & 0o777, 0o600);
  rejected(() => applyMonthlySettlementFinalization(f.options, { expectedPlanSha256: plan.planSha256, intentPath: f.intentPath }), "EXISTING_OUTPUT_OR_INTENT");
});

test("requires explicit month, evidence hashes, and known options without invoking a legacy fallback", (t) => {
  const f = fixture(t);
  for (const month of [undefined, "202613", "2026-10"]) rejected(() => prepareMonthlySettlementFinalization({ ...f.options, month }), "INVALID_MONTH");
  for (const key of ["expectedAuditSha256", "expectedBaselineSha256", "expectedEmploymentSha256"])
    rejected(() => prepareMonthlySettlementFinalization({ ...f.options, [key]: undefined }), "EXPECTED_HASH_REQUIRED");
  rejected(() => prepareMonthlySettlementFinalization({ ...f.options, apply: true }), "INVALID_OPTIONS");
  rejected(() => prepareMonthlySettlementFinalization({ ...f.options, outputDirectory: f.root }), "INVALID_OPTIONS");
});

test("foreign month, different target, or an unconfirmed allocation is rejected", (t) => {
  for (const change of [(a) => { a.month = "202611"; }, (a) => { a.target = "/foreign"; },
    (a) => { a.dateAllocationConfirmed = false; }, (a) => { a.weekdayWorkingHours.end = "21:00"; },
    (a) => { a.selectedExtraLessons[0].날짜 = "2026-10-20"; }]) {
    const f = fixture(t); change(f.audit); f.writeAudit(false);
    assert.throws(() => prepareMonthlySettlementFinalization(f.options), SettlementFinalizationError);
  }
});

test("every audit artifact, original PDF, source workbook and employment PDF is hash guarded", (t) => {
  for (let i = 0; i < 12; i++) {
    const f = fixture(t);
    const files = [...f.audit.files.map((a) => path.join(f.dir, a.name)), ...f.options.payrollPdfPaths,
      f.options.lessonSourcePath, f.options.employmentPdfPath];
    fs.appendFileSync(files[i], "synthetic-private-value");
    rejected(() => prepareMonthlySettlementFinalization(f.options), "INPUT_HASH_MISMATCH");
  }
});

test("missing and symlinked sources fail closed without dumping private data", (t) => {
  const f = fixture(t), original = f.options.payrollPdfPaths[0];
  fs.unlinkSync(original);
  rejected(() => prepareMonthlySettlementFinalization(f.options), "SOURCE_READ_FAILED");
  fs.symlinkSync(f.options.payrollPdfPaths[1], original);
  rejected(() => prepareMonthlySettlementFinalization(f.options), "NOT_REGULAR_SOURCE");
});

test("baseline protects the two unaffected statements too", (t) => {
  const f = fixture(t), baseline = JSON.parse(fs.readFileSync(f.options.baselinePath));
  fs.appendFileSync(path.join(f.dir, baseline.files[0].name), "changed");
  rejected(() => prepareMonthlySettlementFinalization(f.options), "INPUT_HASH_MISMATCH");
});

test("rejects incomplete, duplicate, foreign or wrong-size audit manifests", (t) => {
  for (const change of [(a) => a.files.pop(), (a) => { a.files[0] = a.files[1]; },
    (a) => { a.files[0].name = "foreign.xlsx"; }, (a) => { a.files[0].size++; }]) {
    const f = fixture(t); change(f.audit); f.writeAudit(false);
    assert.throws(() => prepareMonthlySettlementFinalization(f.options), SettlementFinalizationError);
  }
});

test("cached payroll components, allocations and formula error cells must match evidence", (t) => {
  for (const change of [
    (w) => { w.Sheets.근로급여산정.B5.v++; }, (w) => { w.Sheets.근로급여산정.B48.v++; },
    (w) => { w.Sheets.근로급여산정.B39.v = "09:00~17:00"; },
    (w) => { w.Sheets.근로급여산정.C36.v = "unconfirmed"; },
    (w) => { w.Sheets.근로급여산정.B7 = { t: "e", v: 7, w: "#DIV/0!" }; },
    (w) => { w.Sheets.근로급여산정.A1.v = "2026년 9월 근로급여 내역"; },
    (w) => { w.Sheets.정산대장.R6.v++; },
  ]) {
    const f = fixture(t); f.changeWorkbook(change);
    assert.throws(() => prepareMonthlySettlementFinalization(f.options), SettlementFinalizationError);
  }
});

test("source row drift and wrong instructor are rejected even with a freshly supplied source hash", (t) => {
  for (const cell of ["F2", "G2"]) {
    const f = fixture(t), w = XLSX.readFile(f.options.lessonSourcePath);
    w.Sheets.Source[cell].v = "foreign"; XLSX.writeFile(w, f.options.lessonSourcePath);
    f.audit.lessonSourceSha256 = sha(fs.readFileSync(f.options.lessonSourcePath)); f.writeAudit(false);
    rejected(() => prepareMonthlySettlementFinalization(f.options), "LESSON_SOURCE_MISMATCH");
  }
});

test("wrong, external, escaping, unquoted and missing review links are rejected", (t) => {
  for (const href of ["https://synthetic.invalid/foreign.html", "../foreign.html", "..%2Fforeign.html",
    "missing.html", "javascript:alert(1)"]) {
    const f = fixture(t), file = path.join(f.dir, f.names.index);
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/href="[^"]*"/, `href="${href}"`)); f.writeAudit();
    assert.throws(() => prepareMonthlySettlementFinalization(f.options), SettlementFinalizationError);
  }
  const f = fixture(t), file = path.join(f.dir, f.names.index);
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/href="[^"]*"/, "href=unquoted")); f.writeAudit();
  rejected(() => prepareMonthlySettlementFinalization(f.options), "INVALID_LINK");
});

test("existing canonical outputs and dangling output symlinks are never overwritten", (t) => {
  for (const name of ["아카이브 정산명세서 202610.xlsx", "아카이브 정산명세서 202610_INDEX.html"]) {
    const f = fixture(t), file = path.join(f.dir, name); fs.writeFileSync(file, "existing");
    rejected(() => prepareMonthlySettlementFinalization(f.options), "EXISTING_OUTPUT_OR_INTENT");
    assert.equal(fs.readFileSync(file, "utf8"), "existing");
  }
  const f = fixture(t); fs.symlinkSync(path.join(f.root, "absent"), path.join(f.dir, "아카이브 정산명세서 202610.xlsx"));
  rejected(() => prepareMonthlySettlementFinalization(f.options), "EXISTING_OUTPUT_OR_INTENT");
});

test("wrong plan digest and public intent directory stop before any writes", (t) => {
  const f = fixture(t), plan = prepareMonthlySettlementFinalization(f.options);
  rejected(() => applyMonthlySettlementFinalization(f.options, { expectedPlanSha256: "0".repeat(64), intentPath: f.intentPath }), "PLAN_HASH_MISMATCH");
  assert.equal(fs.existsSync(f.intentPath), false);
  fs.chmodSync(f.privateDir, 0o755);
  rejected(() => applyMonthlySettlementFinalization(f.options, { expectedPlanSha256: plan.planSha256, intentPath: f.intentPath }), "PRIVATE_INTENT_REQUIRED");
  assert.equal(fs.existsSync(plan.outputs[0].path), false);
});

test("prior intent is never blindly replayed, including unknown and formerly verified states", (t) => {
  for (const state of ["intent", "needs_review", "verified"]) {
    const f = fixture(t), plan = prepareMonthlySettlementFinalization(f.options);
    const original = JSON.stringify({ state }); fs.writeFileSync(f.intentPath, original, { mode: 0o600 });
    rejected(() => applyMonthlySettlementFinalization(f.options, { expectedPlanSha256: plan.planSha256, intentPath: f.intentPath }), "EXISTING_OUTPUT_OR_INTENT");
    assert.equal(fs.readFileSync(f.intentPath, "utf8"), original);
    assert.equal(fs.existsSync(plan.outputs[0].path), false);
  }
});

function injectLink(t, hook) {
  const original = fs.linkSync;
  t.mock.method(fs, "linkSync", (source, target) => hook(source, target, original));
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
}

test("index publication failure retains the statement and durable review-required intent", (t) => {
  const f = fixture(t), plan = prepareMonthlySettlementFinalization(f.options);
  injectLink(t, (source, target, original) => {
    if (target === plan.outputs[1].path) throw new Error("synthetic-private-value");
    return original(source, target);
  });
  rejected(() => applyMonthlySettlementFinalization(f.options, { expectedPlanSha256: plan.planSha256, intentPath: f.intentPath }), "FINALIZATION_REVIEW_REQUIRED");
  assert.equal(sha(fs.readFileSync(plan.outputs[0].path)), plan.outputs[0].sha256);
  assert.equal(fs.existsSync(plan.outputs[1].path), false);
  assert.equal(JSON.parse(fs.readFileSync(f.intentPath)).state, "needs_review");
  assert.equal(fs.readdirSync(f.dir).some((n) => n.endsWith(".tmp")), false);
  rejected(() => applyMonthlySettlementFinalization(f.options, { expectedPlanSha256: plan.planSha256, intentPath: f.intentPath }), "EXISTING_OUTPUT_OR_INTENT");
});

test("post-publication source drift fails independent verification and is not replayed", (t) => {
  const f = fixture(t), plan = prepareMonthlySettlementFinalization(f.options);
  injectLink(t, (source, target, original) => {
    original(source, target);
    if (target === plan.outputs[1].path) fs.appendFileSync(f.options.payrollPdfPaths[0], "changed");
  });
  rejected(() => applyMonthlySettlementFinalization(f.options, { expectedPlanSha256: plan.planSha256, intentPath: f.intentPath }), "FINALIZATION_REVIEW_REQUIRED");
  assert.equal(JSON.parse(fs.readFileSync(f.intentPath)).state, "needs_review");
  assert.equal(fs.existsSync(plan.outputs[1].path), true);
});

test("a concurrent destination is preserved rather than replaced", (t) => {
  const f = fixture(t), plan = prepareMonthlySettlementFinalization(f.options);
  injectLink(t, (source, target, original) => {
    if (target === plan.outputs[0].path) fs.writeFileSync(target, "concurrent owner", { flag: "wx" });
    return original(source, target);
  });
  rejected(() => applyMonthlySettlementFinalization(f.options, { expectedPlanSha256: plan.planSha256, intentPath: f.intentPath }), "FINALIZATION_REVIEW_REQUIRED");
  assert.equal(fs.readFileSync(plan.outputs[0].path, "utf8"), "concurrent owner");
  assert.equal(fs.existsSync(plan.outputs[1].path), false);
  assert.equal(JSON.parse(fs.readFileSync(f.intentPath)).state, "needs_review");
});

test("corrupted published INDEX fails hash readback without repairing or replacing it", (t) => {
  const f = fixture(t), plan = prepareMonthlySettlementFinalization(f.options);
  injectLink(t, (source, target, original) => {
    original(source, target);
    if (target === plan.outputs[1].path) fs.appendFileSync(target, "corruption");
  });
  rejected(() => applyMonthlySettlementFinalization(f.options, { expectedPlanSha256: plan.planSha256, intentPath: f.intentPath }), "FINALIZATION_REVIEW_REQUIRED");
  assert.equal(JSON.parse(fs.readFileSync(f.intentPath)).state, "needs_review");
  assert.notEqual(sha(fs.readFileSync(plan.outputs[1].path)), plan.outputs[1].sha256);
});
