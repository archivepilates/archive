import {
  constants, openSync, closeSync, readFileSync, writeFileSync, fstatSync,
  lstatSync, existsSync, fsyncSync, linkSync, renameSync, unlinkSync,
} from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import XLSX from "xlsx";

const HASH = /^[a-f0-9]{64}$/;
const KIND = "monthly_settlement_artifact_finalization_v1";
const OPTION_KEYS = ["month", "reviewDirectory", "auditPath", "expectedAuditSha256",
  "baselinePath", "expectedBaselineSha256", "lessonSourcePath", "payrollPdfPaths",
  "employmentPdfPath", "expectedEmploymentSha256"];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

export class SettlementFinalizationError extends Error {
  constructor(code) {
    super(code);
    this.name = "SettlementFinalizationError";
    this.code = code;
  }
}

function requireCheck(condition, code) {
  if (!condition) throw new SettlementFinalizationError(code);
}

function absolute(value) {
  requireCheck(typeof value === "string" && path.isAbsolute(value) && !value.includes("\0"), "INVALID_PATH");
  return path.resolve(value);
}

function regularFile(file) {
  let fd;
  try {
    const before = lstatSync(file);
    requireCheck(before.isFile() && !before.isSymbolicLink() && before.size <= 64 * 1024 * 1024, "NOT_REGULAR_SOURCE");
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(fd);
    requireCheck(opened.isFile() && opened.ino === before.ino && opened.dev === before.dev, "SOURCE_CHANGED");
    const bytes = readFileSync(fd), after = fstatSync(fd);
    requireCheck(bytes.length === after.size && opened.mtimeMs === after.mtimeMs, "SOURCE_CHANGED");
    return bytes;
  } catch (error) {
    if (error instanceof SettlementFinalizationError) throw error;
    throw new SettlementFinalizationError("SOURCE_READ_FAILED");
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function directory(dir, privateOnly = false) {
  let stat;
  try { stat = lstatSync(dir); } catch { throw new SettlementFinalizationError("DIRECTORY_REQUIRED"); }
  requireCheck(stat.isDirectory() && !stat.isSymbolicLink(), "DIRECTORY_REQUIRED");
  if (privateOnly) requireCheck((stat.mode & 0o077) === 0 && stat.uid === process.getuid(), "PRIVATE_INTENT_REQUIRED");
}

function absent(file) {
  // lstat, unlike existsSync, also detects dangling symlinks.
  try { lstatSync(file); } catch (error) {
    if (error.code === "ENOENT") return;
    throw new SettlementFinalizationError("OUTPUT_CHECK_FAILED");
  }
  throw new SettlementFinalizationError("EXISTING_OUTPUT_OR_INTENT");
}

function json(bytes) {
  try { return JSON.parse(bytes.toString("utf8")); }
  catch { throw new SettlementFinalizationError("INVALID_EVIDENCE_JSON"); }
}

function localName(name) {
  requireCheck(typeof name === "string" && name === path.basename(name) && name !== "." && name !== ".."
    && !/[\\/\0?#&]/.test(name), "INVALID_ARTIFACT_NAME");
  return name;
}

function links(html) {
  const matches = [...html.matchAll(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)];
  requireCheck(matches.length === [...html.matchAll(/\bhref\s*=/gi)].length, "INVALID_LINK");
  try { return matches.map((m) => localName(decodeURIComponent(m[1] ?? m[2]))); }
  catch { throw new SettlementFinalizationError("INVALID_LINK"); }
}

function workbook(bytes) {
  requireCheck(bytes.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4])), "INVALID_WORKBOOK");
  try { return XLSX.read(bytes, { type: "buffer", cellDates: false }); }
  catch { throw new SettlementFinalizationError("INVALID_WORKBOOK"); }
}

function validateWorkbooks(reviewBytes, sourceBytes, audit) {
  const wb = workbook(reviewBytes), source = workbook(sourceBytes);
  for (const name of ["강사정보", "정산대장", "정산명세서", "근로급여산정"])
    requireCheck(wb.Sheets[name], "REVIEW_LAYOUT_MISMATCH");
  for (const sheet of Object.values(wb.Sheets))
    requireCheck(!Object.values(sheet).some((cell) => cell?.t === "e"), "WORKBOOK_FORMULA_ERROR");
  const payroll = wb.Sheets["근로급여산정"], ledger = wb.Sheets["정산대장"];
  const value = (cell) => payroll[cell]?.v;
  const [first, second] = audit.regular;
  requireCheck(value("A1") === `${audit.month.slice(0, 4)}년 ${Number(audit.month.slice(4))}월 근로급여 내역`
    && value("B3") === first.name
    && value("A42") === `${second.name} ${Number(audit.month.slice(4))}월 근로급여`, "REVIEW_MONTH_OR_IDENTITY_MISMATCH");
  // Compare preserved source values and cached cells only; never evaluate payroll formulas.
  const check = (cells) => {
    for (const [cell, expected] of cells) requireCheck(Number.isFinite(expected) && value(cell) === expected, "PAYROLL_SOURCE_MISMATCH");
  };
  check([["B5", first.base], ["B6", first.meal], ["B7", first.gross], ["B19", first.net],
    ...first.deductions.map((v, i) => [`B${12 + i}`, v]),
    ["B43", second.base], ["B44", second.meal], ["B45", second.vehicle], ["B46", second.gross], ["B55", second.net],
    ...second.deductions.map((v, i) => [`B${48 + i}`, v]), ["B20", audit.extraGross], ["B21", audit.extraNet]]);
  requireCheck(value("B36") === "2회 확정" && value("B39") === "14:00~22:00", "ALLOCATION_SOURCE_MISMATCH");
  const dateText = String(value("C36") || "");
  for (const lesson of audit.selectedExtraLessons) {
    const date = `${Number(lesson.날짜.slice(5, 7))}/${Number(lesson.날짜.slice(8, 10))}`;
    requireCheck(dateText.includes(`${date} ${lesson.수업시작}~${lesson.수업종료}`), "ALLOCATION_SOURCE_MISMATCH");
  }
  const ledgerRows = XLSX.utils.sheet_to_json(ledger, { header: 1, defval: "" });
  const staff = ledgerRows.filter((r) => /^\d+$/.test(String(r[0])) && r[1]);
  requireCheck(staff.length === 4 && new Set(staff.map((r) => r[1])).size === 4, "REVIEW_LAYOUT_MISMATCH");
  for (const employee of audit.regular) {
    const rows = staff.filter((r) => r[1] === employee.name);
    requireCheck(rows.length === 1 && rows[0][17] === employee.net, "PAYROLL_SOURCE_MISMATCH");
    if (employee === first) requireCheck(rows[0][15] === audit.extraNet && rows[0][16] === value("B22"), "PAYROLL_SOURCE_MISMATCH");
    else requireCheck(rows[0][16] === value("B57"), "PAYROLL_SOURCE_MISMATCH");
  }
  const sourceRows = XLSX.utils.sheet_to_json(source.Sheets[source.SheetNames[0]], { header: 1, defval: "" });
  const keys = ["날짜", "수업시작", "수업종료", "수업", "차감 금액", "출결"];
  for (const lesson of audit.lessonCandidates) {
    requireCheck(Number.isInteger(lesson.excelRow) && lesson.excelRow >= 2, "LESSON_SOURCE_MISMATCH");
    const row = Object.fromEntries((sourceRows[0] || []).map((key, i) => [key, sourceRows[lesson.excelRow - 1]?.[i]]));
    requireCheck(keys.every((key) => row[key] === lesson[key]) && row.출결 === "출석"
      && (row["수업 강사"] || row.강사) === first.name, "LESSON_SOURCE_MISMATCH");
  }
  return staff.map((r) => r[1]);
}

function build(options) {
  requireCheck(options && Object.keys(options).every((k) => OPTION_KEYS.includes(k)), "INVALID_OPTIONS");
  const { month } = options;
  requireCheck(typeof month === "string" && /^20\d{2}(0[1-9]|1[0-2])$/.test(month), "INVALID_MONTH");
  for (const key of ["expectedAuditSha256", "expectedBaselineSha256", "expectedEmploymentSha256"])
    requireCheck(HASH.test(options[key] || ""), "EXPECTED_HASH_REQUIRED");
  const dir = absolute(options.reviewDirectory);
  directory(dir);
  requireCheck(path.basename(dir) === month, "WRONG_OUTPUT_DIRECTORY");
  const inputs = new Map(), bytesByPath = new Map();
  const read = (file, expected) => {
    file = absolute(file);
    if (!bytesByPath.has(file)) {
      const bytes = regularFile(file);
      inputs.set(file, { path: file, sha256: sha(bytes), size: bytes.length });
      bytesByPath.set(file, bytes);
    }
    requireCheck(!expected || inputs.get(file).sha256 === expected, "INPUT_HASH_MISMATCH");
    return bytesByPath.get(file);
  };
  const audit = json(read(options.auditPath, options.expectedAuditSha256));
  const baseline = json(read(options.baselinePath, options.expectedBaselineSha256));
  requireCheck(audit.month === month && audit.target === dir && baseline.target === dir, "FOREIGN_EVIDENCE");
  requireCheck(Array.isArray(audit.regular) && audit.regular.length === 2
    && audit.regular.every((r) => r && typeof r.name === "string" && r.name.trim() && Array.isArray(r.deductions) && r.deductions.length === 6)
    && audit.regular[0].name !== audit.regular[1].name, "INVALID_PAYROLL_EVIDENCE");
  for (const key of ["dateAllocationConfirmed", "unaffectedInstructorsPreserved", "classCountPreserved", "bankDetailsPreserved", "sourcePdfsUnmodified"])
    requireCheck(audit[key] === true, "UNVERIFIED_REVIEW_EVIDENCE");
  requireCheck(audit.payrollPaid === false && audit.staffSent === false, "PAYMENT_STATE_MISMATCH");
  requireCheck(audit.extraCount === 2 && audit.weekdayWorkingHours?.start === "14:00"
    && audit.weekdayWorkingHours?.end === "22:00" && audit.weekdayWorkingHours?.basis === "operator_confirmed"
    && audit.weekdayWorkingHours?.scope === `${month}_payroll`
    && audit.selectedExtraLessons?.length === 2 && audit.lessonCandidates?.length === 4, "ALLOCATION_SOURCE_MISMATCH");
  const prefix = `${month.slice(0, 4)}-${month.slice(4)}-`;
  requireCheck(new Set(audit.lessonCandidates.map((r) => r.excelRow)).size === 4, "LESSON_SOURCE_MISMATCH");
  for (const lesson of audit.lessonCandidates) {
    const date = new Date(`${lesson.날짜}T00:00:00Z`);
    requireCheck(typeof lesson.날짜 === "string" && lesson.날짜.startsWith(prefix)
      && /^\d{4}-\d{2}-\d{2}$/.test(lesson.날짜) && Number.isFinite(date.getTime())
      && date.toISOString().slice(0, 10) === lesson.날짜 && ![0, 6].includes(date.getUTCDay())
      && [lesson.수업시작, lesson.수업종료].every((t) => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t))
      && lesson.수업시작 < lesson.수업종료 && lesson.수업 === "프라이빗" && lesson.출결 === "출석", "LESSON_SOURCE_MISMATCH");
  }
  requireCheck(new Set(audit.selectedExtraLessons.map((r) => r.excelRow)).size === 2, "ALLOCATION_SOURCE_MISMATCH");
  for (const lesson of audit.selectedExtraLessons) requireCheck(lesson.수업종료 < "14:00"
    && audit.lessonCandidates.some((r) => ["excelRow", "날짜", "수업시작", "수업종료", "수업", "차감 금액", "출결"]
      .every((key) => r[key] === lesson[key])), "ALLOCATION_SOURCE_MISMATCH");
  for (const lesson of audit.lessonCandidates.filter((r) => !audit.selectedExtraLessons.some((s) => s.excelRow === r.excelRow)))
    requireCheck(lesson.수업시작 >= "14:00" && lesson.수업종료 <= "22:00", "ALLOCATION_SOURCE_MISMATCH");

  const reviewXlsx = `아카이브 정산명세서 ${month}_검토본.xlsx`;
  const reviewIndex = `아카이브 정산명세서 ${month}_INDEX_검토본.html`;
  const providedPdfs = audit.regular.map((r) => `아카이브 급여명세서 ${month} ${r.name}_제공원문.pdf`);
  const required = [reviewXlsx, reviewIndex, ...providedPdfs,
    ...audit.regular.map((r) => `아카이브 급여명세서 ${month} ${r.name}_검토본.pdf`),
    ...audit.regular.map((r) => `아카이브 정산명세서 ${month} ${r.name}_검토본.html`)];
  requireCheck(audit.files?.length === 8 && new Set(audit.files.map((f) => f.name)).size === 8
    && audit.files.every((f) => required.includes(f.name) && HASH.test(f.sha256)), "INVALID_ARTIFACT_MANIFEST");
  for (const file of audit.files) {
    const bytes = read(path.join(dir, localName(file.name)), file.sha256);
    requireCheck(bytes.length === file.size, "INPUT_SIZE_MISMATCH");
  }
  const preserved = links(read(path.join(dir, reviewIndex)).toString("utf8"));
  requireCheck(preserved.length === 5 && new Set(preserved).size === 5 && preserved.includes(reviewXlsx), "INVALID_REVIEW_LINKS");
  for (const name of preserved) {
    if (required.includes(name)) continue;
    const evidence = baseline.files?.filter((f) => f.name === name);
    requireCheck(evidence?.length === 1 && HASH.test(evidence[0].sha256), "PRESERVED_SOURCE_REQUIRED");
    read(path.join(dir, name), evidence[0].sha256);
  }
  requireCheck(Array.isArray(options.payrollPdfPaths) && options.payrollPdfPaths.length === 2
    && new Set(options.payrollPdfPaths.map(absolute)).size === 2, "PAYROLL_PDFS_REQUIRED");
  for (const [index, file] of options.payrollPdfPaths.entries())
    read(file, inputs.get(path.join(dir, providedPdfs[index])).sha256);
  const employment = read(options.employmentPdfPath, options.expectedEmploymentSha256);
  requireCheck(employment.subarray(0, 5).toString() === "%PDF-", "INVALID_EMPLOYMENT_PDF");
  requireCheck(HASH.test(audit.lessonSourceSha256 || ""), "LESSON_SOURCE_REQUIRED");
  const source = read(options.lessonSourcePath, audit.lessonSourceSha256);
  const staffNames = validateWorkbooks(read(path.join(dir, reviewXlsx)), source, audit);
  requireCheck(staffNames.every((name) => preserved.includes(`아카이브 정산명세서 ${month} ${name}_검토본.html`)), "INVALID_REVIEW_LINKS");
  const statement = `아카이브 정산명세서 ${month}.xlsx`, index = `아카이브 정산명세서 ${month}_INDEX.html`;
  for (const name of [statement, index]) absent(path.join(dir, name));
  const indexBytes = read(path.join(dir, reviewIndex)), statementBytes = read(path.join(dir, reviewXlsx));
  const plan = { kind: KIND, month, reviewDirectory: dir, inputs: [...inputs.values()],
    outputs: [{ path: path.join(dir, statement), sourcePath: path.join(dir, reviewXlsx), sha256: sha(statementBytes), size: statementBytes.length },
      { path: path.join(dir, index), sourcePath: path.join(dir, reviewIndex), sha256: sha(indexBytes), size: indexBytes.length }],
    links: preserved, checks: { auditArtifacts: 8, preservedStatements: 4, selectedMorningLessons: 2,
      payrollSourceCopies: 2, cachedPayrollVerified: true, noRecalculation: true },
    artifactFinalizationOnly: true, paymentAuthorized: false, payrollPaid: false, staffSent: false };
  return { plan: { ...plan, planSha256: sha(JSON.stringify(plan)) }, statementBytes, indexBytes };
}

export function prepareMonthlySettlementFinalization(options) {
  try { return build(options).plan; }
  catch (error) {
    if (error instanceof SettlementFinalizationError) throw error;
    throw new SettlementFinalizationError("INVALID_REVIEW_EVIDENCE");
  }
}

function syncDirectory(dir) {
  const fd = openSync(dir, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function atomicWrite(file, bytes, replace = false) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  let fd;
  try {
    fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    writeFileSync(fd, bytes); fsyncSync(fd); closeSync(fd); fd = undefined;
    // Hard-link publication is atomic and cannot replace a concurrently created destination.
    // An unsupported filesystem fails closed; never fall back to an overwriting rename.
    if (replace) renameSync(tmp, file);
    else linkSync(tmp, file);
    syncDirectory(path.dirname(file));
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(tmp)) unlinkSync(tmp);
  }
}

function verifyInputs(plan) {
  for (const input of plan.inputs) requireCheck(sha(regularFile(input.path)) === input.sha256, "INPUT_CHANGED_AFTER_PREPARE");
}

function verifyOutputs(plan) {
  for (const output of plan.outputs) requireCheck(sha(regularFile(output.path)) === output.sha256, "OUTPUT_READBACK_MISMATCH");
  const names = links(regularFile(plan.outputs[1].path).toString("utf8"));
  requireCheck(JSON.stringify(names) === JSON.stringify(plan.links), "OUTPUT_LINK_MISMATCH");
  for (const name of names) regularFile(path.join(plan.reviewDirectory, name));
}

export function applyMonthlySettlementFinalization(options, { expectedPlanSha256, intentPath } = {}) {
  requireCheck(HASH.test(expectedPlanSha256 || ""), "EXPECTED_PLAN_HASH_REQUIRED");
  intentPath = absolute(intentPath);
  directory(path.dirname(intentPath), true);
  absent(intentPath);
  let prepared;
  try { prepared = build(options); }
  catch (error) {
    if (error instanceof SettlementFinalizationError) throw error;
    throw new SettlementFinalizationError("INVALID_REVIEW_EVIDENCE");
  }
  requireCheck(prepared.plan.planSha256 === expectedPlanSha256, "PLAN_HASH_MISMATCH");
  const relativeIntent = path.relative(prepared.plan.reviewDirectory, intentPath);
  requireCheck(relativeIntent.startsWith(`..${path.sep}`) || path.isAbsolute(relativeIntent), "PRIVATE_INTENT_REQUIRED");
  const intent = { ...prepared.plan, state: "intent", createdAt: new Date().toISOString(), history: ["intent"] };
  const bytes = () => Buffer.from(`${JSON.stringify(intent, null, 2)}\n`);
  let manifestHash;
  const save = (state) => {
    requireCheck(sha(regularFile(intentPath)) === manifestHash, "INTENT_CHANGED");
    intent.state = state; intent.history.push(state);
    const content = bytes();
    atomicWrite(intentPath, content, true);
    requireCheck(sha(regularFile(intentPath)) === sha(content), "INTENT_READBACK_MISMATCH");
    manifestHash = sha(content);
  };
  try {
    verifyInputs(intent);
    const content = bytes();
    atomicWrite(intentPath, content);
    requireCheck(sha(regularFile(intentPath)) === sha(content), "INTENT_READBACK_MISMATCH");
    manifestHash = sha(content);
    verifyInputs(intent);
    atomicWrite(intent.outputs[0].path, prepared.statementBytes);
    requireCheck(sha(regularFile(intent.outputs[0].path)) === intent.outputs[0].sha256, "OUTPUT_READBACK_MISMATCH");
    save("statement_written");
    atomicWrite(intent.outputs[1].path, prepared.indexBytes);
    verifyOutputs(intent); verifyInputs(intent);
    save("verified");
    return { ...prepared.plan, state: "verified", intentPath, independentlyReadBack: true };
  } catch {
    // Retain every published file and the intent. Any incomplete/unknown result requires review, not replay.
    if (manifestHash) { try { save("needs_review"); } catch { /* Preserve the last durable intent. */ } }
    throw new SettlementFinalizationError("FINALIZATION_REVIEW_REQUIRED");
  }
}
