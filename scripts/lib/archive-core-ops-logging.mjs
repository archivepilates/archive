import { createHash } from "node:crypto";
import path from "node:path";

export function stableHash(value) {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

export function sourceImportId({ sourceKind, sourceFilePath = "", mode = "", sourceVersion = "" }) {
  return stableHash({ sourceKind, sourceFilePath, mode, sourceVersion }).slice(0, 32);
}

export async function recordSourceImport(db, input) {
  const now = new Date().toISOString();
  const status = input.status || (input.mode === "apply" ? "applied" : "dry_run");
  const studioId = input.studioId || process.env.STUDIOMATE_STUDIO_ID || process.env.MANAGER_STUDIO_ID || "5330";
  const importId =
    input.importId ||
    sourceImportId({
      sourceKind: input.sourceKind,
      sourceFilePath: input.sourceFilePath || input.sourceFile || "",
      mode: input.mode || status,
      sourceVersion: input.sourceVersion || "",
    });
  const doc = {
    importId,
    studioId,
    sourceKind: input.sourceKind,
    sourceFileName: input.sourceFileName || (input.sourceFilePath || input.sourceFile ? path.basename(input.sourceFilePath || input.sourceFile) : ""),
    sourceFilePath: input.sourceFilePath || input.sourceFile || "",
    downloadedAt: input.downloadedAt || "",
    importedAt: input.importedAt || now,
    updatedAt: now,
    status,
    rowCount: toNumber(input.rowCount ?? input.readRows),
    normalizedRows: optionalNumber(input.normalizedRows ?? input.parsedRows ?? input.groupedMembers),
    appliedRows: optionalNumber(input.appliedRows ?? input.plannedWrites ?? input.bookings ?? input.importedRows),
    skippedRows: optionalNumber(input.skippedRows ?? skippedTotal(input.skipped)),
    duplicateRows: optionalNumber(input.duplicateRows),
    errorRows: optionalNumber(input.errorRows),
    sourceVersion: input.sourceVersion || "",
    notes: cleanArray(input.notes),
  };
  await db.collection("sourceImports").doc(importId).set(removeUndefined(doc), { merge: true });
  return { importId, doc };
}

export async function recordAutomationStatus(db, input) {
  const now = new Date().toISOString();
  const automationId = input.automationId || "unknown";
  const doc = {
    automationId,
    title: input.title || automationId,
    ownerArea: input.ownerArea || "other",
    status: input.status || "unknown",
    lastRunAt: input.lastRunAt || now,
    nextRunAt: input.nextRunAt || "",
    updatedAt: now,
    lastResult: input.lastResult || "",
    sourceImportIds: cleanArray(input.sourceImportIds),
    runId: input.runId || "",
    warnings: cleanArray(input.warnings),
  };
  await db.collection("automationStatus").doc(automationId).set(removeUndefined(doc), { merge: true });
  return doc;
}

export async function recordDataQualityIssues(db, issues) {
  const now = new Date().toISOString();
  const batch = db.batch();
  let writes = 0;
  for (const issue of issues.filter(Boolean)) {
    const studioId = issue.studioId || process.env.STUDIOMATE_STUDIO_ID || process.env.MANAGER_STUDIO_ID || "5330";
    const issueId =
      issue.issueId ||
      stableHash({
        issueType: issue.issueType || "unknown",
        memberId: issue.memberId || "",
        memberName: issue.memberName || "",
        studioId,
        title: issue.title || "",
      }).slice(0, 32);
    batch.set(
      db.collection("dataQualityIssues").doc(issueId),
      removeUndefined({
        issueId,
        studioId,
        issueType: issue.issueType || "unknown",
        severity: issue.severity || "warning",
        status: issue.status || "open",
        title: issue.title || "데이터 품질 이슈",
        summary: issue.summary || "",
        memberId: issue.memberId || "",
        memberName: issue.memberName || "",
        sourceImportIds: cleanArray(issue.sourceImportIds),
        sourcePaths: cleanArray(issue.sourcePaths),
        createdAt: issue.createdAt || now,
        updatedAt: now,
        resolvedAt: issue.resolvedAt || "",
        resolution: issue.resolution || "",
      }),
      { merge: true },
    );
    writes += 1;
  }
  if (writes) await batch.commit();
  return writes;
}

export function qualityIssuesFromSummary(summary, importId) {
  const sourceImportIds = importId ? [importId] : [];
  const sourcePaths = [summary.sourceFile || summary.sourceFilePath].filter(Boolean);
  const skipped = summary.skipped || {};
  const issues = [];
  addCountIssue(issues, skipped.rowsWithoutNameOrPhone, {
    issueType: "missing_phone",
    severity: "warning",
    title: "회원 원본에 이름/전화번호 누락 행 있음",
    summary: `${skipped.rowsWithoutNameOrPhone}개 행은 이름 또는 전화번호가 없어 회원 매칭에서 제외되었습니다.`,
    sourceImportIds,
    sourcePaths,
  });
  addCountIssue(issues, skipped.ambiguousExistingPhone, {
    issueType: "duplicate_member",
    severity: "critical",
    title: "동일 전화번호 기존 회원 다중 매칭",
    summary: `${skipped.ambiguousExistingPhone}개 회원 그룹은 같은 전화번호로 여러 기존 회원이 매칭되어 자동 반영에서 제외되었습니다.`,
    sourceImportIds,
    sourcePaths,
  });
  addCountIssue(issues, skipped.memberNoMatch, {
    issueType: "missing_member_id",
    severity: "warning",
    title: "예약 원본 회원 매칭 실패",
    summary: `${skipped.memberNoMatch}개 예약 행은 전화번호가 있지만 기존 회원 프로필과 매칭되지 않았습니다.`,
    sourceImportIds,
    sourcePaths,
  });
  addCountIssue(issues, skipped.memberAmbiguousName, {
    issueType: "name_only_match",
    severity: "warning",
    title: "예약 원본 이름 단독 매칭 보류",
    summary: `${skipped.memberAmbiguousName}개 예약 행은 전화번호 없이 이름만 있어 자동 매칭에서 제외되었습니다.`,
    sourceImportIds,
    sourcePaths,
  });
  addCountIssue(issues, skipped.rowsWithoutMember, {
    issueType: "missing_member_id",
    severity: "info",
    title: "예약 원본 회원 정보 없는 행",
    summary: `${skipped.rowsWithoutMember}개 예약 행은 회원명과 전화번호가 모두 없어 수업 원본만 참고해야 합니다.`,
    sourceImportIds,
    sourcePaths,
  });
  return issues;
}

function addCountIssue(issues, count, issue) {
  if (toNumber(count) <= 0) return;
  issues.push(issue);
}

function skippedTotal(skipped) {
  if (!skipped || typeof skipped !== "object") return undefined;
  return Object.values(skipped).reduce((sum, value) => sum + toNumber(value), 0);
}

function cleanArray(value) {
  return Array.isArray(value) ? value.filter((item) => item !== undefined && item !== null && item !== "") : [];
}

function optionalNumber(value) {
  return value === undefined || value === null || value === "" ? undefined : toNumber(value);
}

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value === undefined || value === null || value === "") return 0;
  return Number(String(value).replaceAll(",", "")) || 0;
}

function removeUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
