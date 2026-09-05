import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { inactivePrivateBookingReason, isPrivateBooking } from "./private-session-order-policy.mjs";

function syncStepSucceeded(step) {
  if (!step || step.exitCode !== 0 || step.requiredFailed || step.stdoutOk === false || step.stdout?.ok === false) return false;
  if (step.name === "syncArchiveDashboardDbFromExcels") return step.stdout?.firebaseSync?.ok === true && step.stdout?.firebaseSync?.firestorePatch?.ok === true;
  if (step.name === "syncArchiveDashboardDbFromExport") return step.stdout?.firestorePatch?.ok === true;
  return true;
}

export function successfulSyncReport(report) {
  if (!(
    report?.mode === "apply" && report.ok === true &&
    report.download !== false && report.dbSyncSucceeded !== false &&
    !report.skippedImports && !report.skippedDbSync &&
    Number.isFinite(Date.parse(report.finishedAt)) &&
    Array.isArray(report.steps) && report.steps.length &&
    ["studiomate_excel_emergency_mode", "archive_dashboard_sales_daily"].includes(report.source)
  )) return false;
  if (report.source === "archive_dashboard_sales_daily") {
    return syncStepSucceeded(report.steps.find((step) => step.name === "downloadSalesExcels")) &&
      report.steps.some((step) => step.name.startsWith("syncArchiveDashboardDb") && syncStepSucceeded(step));
  }
  return ["download", "memberProfiles", "memberPhoneDedupe", "reservations", "deletedClassLogs"]
    .every((name) => report.steps.some((step) => step.name === name && syncStepSucceeded(step))) && report.steps.every(syncStepSucceeded);
}

export function summarizeSyncReports(entries, { nowMs = Date.now(), maxAgeMinutes } = {}) {
  const runs = entries.filter(({ file }) => /-run-apply\.json$/.test(file))
    .sort((a, b) => b.file.localeCompare(a.file));
  const latest = runs[0] || null;
  const lastSuccess = runs.find(({ report }) => successfulSyncReport(report)) || null;
  const successReport = lastSuccess?.report;
  const download = successReport?.steps?.find((step) => ["download", "downloadSalesExcels"].includes(step.name));
  const lastSuccessAt = successReport?.finishedAt || "";
  const sourceObservedAt = download?.stdout?.startedAt || lastSuccessAt;
  const sourceTime = Date.parse(sourceObservedAt);
  const successAgeMinutes = Number.isFinite(sourceTime) ? Math.max(0, (nowMs - sourceTime) / 60000) : null;
  const failedStep = latest && !successfulSyncReport(latest.report) ? latest.report?.steps?.find((step) => !syncStepSucceeded(step)) : null;
  const patch = failedStep?.stdout?.firebaseSync?.firestorePatch || failedStep?.stdout?.firestorePatch;
  const error = String(failedStep?.stdout?.error || failedStep?.stderr || latest?.report?.error ||
    (failedStep ? `${failedStep.name} 정상 완료 증거 없음${patch?.status ? ` · Firestore HTTP ${patch.status}` : ""}` : ""))
    .split("\n")[0].slice(0, 600);
  const lastSuccessIndex = runs.findIndex(({ report }) => successfulSyncReport(report));
  return {
    latestPath: latest?.file || "",
    latestAttemptAt: latest?.report?.finishedAt || "",
    latestAttemptSucceeded: Boolean(latest && successfulSyncReport(latest.report)),
    lastSuccessPath: lastSuccess?.file || "",
    lastSuccessAt,
    sourceObservedAt,
    successAgeMinutes,
    stale: successAgeMinutes === null || successAgeMinutes > maxAgeMinutes,
    consecutiveFailures: lastSuccessIndex < 0 ? runs.length : lastSuccessIndex,
    failureCountIsLowerBound: lastSuccessIndex < 0,
    failedStep: failedStep?.name || "",
    error,
    missingBrowserExecutable: /Executable doesn't exist/.test(error),
    reservationRange: download?.stdout?.downloads?.reservation?.range || null,
  };
}

export function loadSyncRunEvidence(dir, options = {}) {
  // Parent apply reports prove the complete pipeline; partial imports and dry runs do not.
  let names;
  try {
    names = readdirSync(dir).filter((name) => /-run-apply\.json$/.test(name)).sort().reverse();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return summarizeSyncReports([], options);
  }
  const entries = [];
  for (const name of names.slice(0, 240)) {
    const file = path.join(dir, name);
    let report;
    try {
      report = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      report = { error: "실행 결과 JSON을 읽을 수 없습니다." };
    }
    entries.push({ file, report });
    if (successfulSyncReport(report)) break;
  }
  return summarizeSyncReports(entries, options);
}

export function inspectHeadlessRuntime(require) {
  try {
    const root = path.dirname(require.resolve("playwright-core/package.json"));
    // Use the installed Playwright registry so an upgrade cannot leave a hard-coded revision behind.
    const { registry } = require(path.join(root, "lib/server/registry/index.js"));
    const executable = registry.findExecutable("chromium-headless-shell")?.executablePath();
    if (!executable) throw new Error("Playwright headless executable path unavailable");
    return { ok: existsSync(executable), executable, error: "" };
  } catch (error) {
    return { ok: false, executable: "", error: String(error?.message || error).slice(0, 300) };
  }
}

export function unresolvedMainWorkflowFailures(runs) {
  const ordered = runs.filter((run) => run.headBranch === "main")
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || Number(b.databaseId) - Number(a.databaseId));
  const result = [];
  const seen = new Set();
  for (const run of ordered) {
    if (run.status !== "completed" || !["success", "failure", "timed_out", "startup_failure"].includes(run.conclusion)) continue;
    const key = String(run.workflowDatabaseId || run.workflowName);
    if (seen.has(key)) continue;
    seen.add(key);
    if (run.conclusion !== "success") result.push(run);
  }
  return result;
}

export function recoveredMainFailureIds(runs) {
  const unresolved = new Set(unresolvedMainWorkflowFailures(runs).map((run) => String(run.workflowDatabaseId || run.workflowName)));
  return runs.filter((run) => run.headBranch === "main" && run.status === "completed" &&
    ["failure", "timed_out", "startup_failure"].includes(run.conclusion) &&
    !unresolved.has(String(run.workflowDatabaseId || run.workflowName)) &&
    runs.some((later) => later.headBranch === "main" && later.status === "completed" && later.conclusion === "success" &&
      String(later.workflowDatabaseId || later.workflowName) === String(run.workflowDatabaseId || run.workflowName) &&
      Date.parse(later.createdAt) > Date.parse(run.createdAt)))
    .map((run) => String(run.databaseId));
}

export function classifyPrivateRoundIssues(bookings, options = {}) {
  const groups = { privateBookings: [], countable: [], missingOrder: [], cancelledWithOrder: [], excludedWithOrder: [], pastUnchecked: [], pastUncheckedWithOrder: [] };
  for (const doc of bookings) {
    if (!isPrivateBooking(doc.data)) continue;
    groups.privateBookings.push(doc);
    const reason = inactivePrivateBookingReason(doc.data, options);
    const round = Number(doc.data?.sessionOrder?.privateCumulativeRound || 0);
    const hasRound = Number.isFinite(round) && round > 0;
    const explicitCancellation = /cancel|deleted/i.test(String(doc.data?.sourceStatus || "")) ||
      [doc.data?.appStatus, doc.data?.status].some((status) => ["cancel", "cancelled", "canceled"].includes(String(status || "").toLowerCase()));
    if (reason === "past_unchecked_attendance" && !explicitCancellation) groups.pastUnchecked.push(doc);
    if (!reason && !String(doc.id).startsWith("usage_booking_")) {
      groups.countable.push(doc);
      if (!hasRound) groups.missingOrder.push(doc);
    } else if (hasRound) {
      // Actual cancellation wins even if an old unchecked date also matches the countability policy.
      if (explicitCancellation) groups.cancelledWithOrder.push(doc);
      else if (reason === "past_unchecked_attendance") groups.pastUncheckedWithOrder.push(doc);
      else groups.excludedWithOrder.push(doc);
    }
  }
  return groups;
}

export function managedHealthCheckKey(finding) {
  if (finding.checkKey) return finding.checkKey;
  const title = String(finding.title || "");
  if (title.startsWith("StudioMate Excel sync ")) return "sync:studiomate-excel-sync";
  if (title.startsWith("ARCHIVE dashboard DB sync ")) return "sync:archive-dashboard-db-sync";
  if (finding.area === "private" && title === "프라이빗 회차/취소 정합성 확인 필요") return "private-session-order";
  if (finding.area === "github" && /^GitHub Actions 최근 실패 \d+건$/.test(title)) return "github-ci";
  return "";
}

export function canResolveHealthFinding(finding, activeIds, completedChecks) {
  const key = managedHealthCheckKey(finding);
  if (key === "github-ci" && !(finding.sourceRefs || []).every((ref) => completedChecks.has(`github-run:${String(ref).split(":").at(-1)}`))) return false;
  if (["private-session-order", "private-attendance"].includes(key) &&
      !(finding.sourceRefs || []).every((ref) => completedChecks.has(String(ref)))) return false;
  return Boolean(key && completedChecks.has(key) && !activeIds.has(finding.findingId || finding.queueId));
}
