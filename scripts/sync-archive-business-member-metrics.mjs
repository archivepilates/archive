#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { googleAccessToken, parseArgs, quotedRange, sheetsRequest } from "./dashboard-export-utils.mjs";
import { decodeFirestoreFields, fetchBookingsForMonth, firestoreValue, summarizeBookingMemberMetric } from "./sync-archive-dashboard-db-export.mjs";
import { collectMetricRows, freshMetricRows, mergeMetricRows, metricMonths, ticketMemberCounts } from "./lib/business-member-metrics.mjs";

const DOCUMENT = "https://firestore.googleapis.com/v1/projects/archive-pilates/databases/(default)/documents/dashboardSnapshots/current";
const SPREADSHEET = "1yEU2lDM_hTKQ-qT8UNj1PsiL7fsBwAgkzsKOzfXVsKg";
const SHEET = "월별 유효회원";
const REPORT_DIR = path.join(os.homedir(), "ArchiveIN/automation/reports/business-member-metrics");

export async function patchMemberMetrics({ token, rows, now, source, read = readSnapshot, request = fetch }) {
  const fields = ["월별회원지표", "memberMetricsUpdatedAt", "memberMetricsSource"];
  const mask = fields.map((field) => `updateMask.fieldPaths=${encodeURIComponent(`\`${field}\``)}`).join("&");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await read(token);
    if (!current.updateTime) throw new Error("Dashboard snapshot has no updateTime; refusing unguarded write");
    const freshRows = freshMetricRows(current.data.월별회원지표, rows);
    const skippedMonths = rows.filter((row) => !freshRows.includes(row)).map((row) => row.월);
    if (!freshRows.length) return { ok: true, status: "superseded", months: [], skippedMonths };
    const next = {
      월별회원지표: mergeMetricRows(current.data.월별회원지표, freshRows),
      memberMetricsUpdatedAt: Date.parse(current.data.memberMetricsUpdatedAt || "") > Date.parse(now) ? current.data.memberMetricsUpdatedAt : now,
      memberMetricsSource: source,
    };
    const response = await request(`${DOCUMENT}?${mask}&currentDocument.updateTime=${encodeURIComponent(current.updateTime)}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ fields: Object.fromEntries(Object.entries(next).map(([key, value]) => [key, firestoreValue(value)])) }),
    });
    if (response.status === 409 || response.status === 412) continue;
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      if (response.status === 400 && ["FAILED_PRECONDITION", "ABORTED"].includes(body.error?.status)) continue;
      throw new Error(`Member metric patch failed: ${response.status} ${body.error?.status || ""}`);
    }
    const verified = await read(token);
    for (const row of freshRows) {
      const stored = verified.data.월별회원지표?.find((item) => item.월 === row.월);
      if (JSON.stringify(stored) !== JSON.stringify(row)) {
        const keys = Object.keys(row);
        if (!stored || keys.some((key) => JSON.stringify(stored[key]) !== JSON.stringify(row[key]))) {
          throw new Error(`Member metric readback mismatch: ${row.월}`);
        }
      }
    }
    return { ok: true, status: response.status, updateTime: verified.updateTime, months: freshRows.map((row) => row.월), skippedMonths };
  }
  throw new Error("Dashboard changed concurrently three times; metrics not overwritten");
}

async function readSnapshot(token) {
  const response = await fetch(DOCUMENT, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Dashboard snapshot read failed: ${response.status}`);
  const document = await response.json();
  return { data: decodeFirestoreFields(document.fields || {}), updateTime: document.updateTime };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const now = new Date().toISOString();
  const currentMonth = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 7);
  const credentialsPath = String(args.credentials || process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(os.homedir(), "ArchiveIN/secrets/google/archive-codex-operator.json"));
  const token = await googleAccessToken({ credentialsPath, scopes: ["https://www.googleapis.com/auth/datastore"], delegated: false });
  const current = await readSnapshot(token);
  const requested = String(args.months || args.month || "").split(",").filter(Boolean);
  const months = metricMonths(current.data, currentMonth, requested);
  if (!months.length) {
    console.log(JSON.stringify({ ok: true, mode: args.apply ? "apply" : "dry-run", months: [], note: "No metric months to refresh" }));
    return;
  }
  const sheetToken = await googleAccessToken({ credentialsPath, scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"], delegatedUser: String(args["delegated-user"] || "home@archivepilates.com") });
  const spreadsheetId = String(args["spreadsheet-id"] || SPREADSHEET);
  const result = await sheetsRequest(sheetToken, "GET", `/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(quotedRange(SHEET, "A1:C1000"))}?valueRenderOption=UNFORMATTED_VALUE`);
  const counts = ticketMemberCounts(result.values, months);
  const source = `${spreadsheetId}/${SHEET}`;
  const rows = await collectMetricRows({
    months, counts, now, source,
    fetchBookings: (month) => fetchBookingsForMonth(token, month),
    summarize: summarizeBookingMemberMetric,
  });
  const firestorePatch = args.apply ? await patchMemberMetrics({ token, rows, now, source }) : null;
  const report = {
    ok: true, mode: args.apply ? "apply" : "dry-run", generatedAt: now,
    months, rows, firestorePatch,
    ticketSource: { spreadsheetId, sheet: SHEET, listCountValidated: true, semantics: "settlement_sheet_not_live_ticket_inventory" },
    bookingSource: "bookings", preservedHistoricalMonths: (current.data.월별회원지표 || []).filter((row) => !months.includes(row.월)).length,
  };
  mkdirSync(REPORT_DIR, { recursive: true });
  const reportPath = path.join(REPORT_DIR, `${now.replace(/[:.]/g, "-")}-${report.mode}.json`);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, reportPath }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
