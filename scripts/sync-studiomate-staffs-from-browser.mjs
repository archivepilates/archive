#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { acquireStudioMateBrowserLock } from "./lib/studiomate-browser-lock.mjs";
import { ensureStudioMateLoggedIn } from "./lib/studiomate-login.mjs";
import { STAFF_EMPLOYMENT_SOURCE, buildStaffEmploymentPlans, validateStaffSnapshot, staffScanDue } from "./lib/studiomate-staff-employment.mjs";

const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");
const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const staffIdScope = valueArg("--staff-id");
const snapshotFile = valueArg("--snapshot-file");
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "archive-pilates";
const STUDIO_ID = process.env.STUDIOMATE_STUDIO_ID || "5330";
const BASE_URL = "https://arcpilates.studiomate.kr";
const PROFILE_DIR = expandHome(process.env.STUDIOMATE_EMERGENCY_PROFILE_DIR || "~/ArchiveIN/automation/browser-profile");
const REPORT_DIR = expandHome(process.env.STUDIOMATE_STAFF_SCAN_REPORT_DIR || "~/ArchiveIN/automation/reports/studiomate-staff-scan");
const HEADLESS = process.env.HEADLESS !== "false";
if (PROJECT_ID !== "archive-pilates" || STUDIO_ID !== "5330") throw new Error("Unexpected staff sync project/studio");
if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();
const startedAt = new Date().toISOString();
let summary;
try {
  const prior = (await db.doc("opsState/studiomateStaffBrowserScan").get()).data();
  if (args.has("--if-due") && !staffScanDue(prior)) {
    summary = { ok: true, skipped: "full_scan_not_due", lastFullScanAt: prior.lastFullScanAt };
  } else {
    const existing = (await db.collection("staffs").where("studioId", "==", STUDIO_ID).get()).docs.map(doc => ({ ...doc.data(), docId: doc.id }));
    const scanned = snapshotFile ? JSON.parse(await readFile(snapshotFile, "utf8")) : await scanStudioMateStaffTab(existing);
    validateStaffSnapshot(scanned, { studioId: STUDIO_ID });
    const plans = buildPlans(scanned, existing, { retireMissing: !staffIdScope });
    summary = { ok: true, mode: apply ? "apply" : "dry-run", source: STAFF_EMPLOYMENT_SOURCE,
      studioId: STUDIO_ID, scanUrl: scanned.scanUrl, scannedStaffs: scanned.total,
      scannedNames: scanned.staffs.map(s => s.name), staffIdScope: staffIdScope || null,
      plannedWrites: plans.writes.length, skippedOperators: plans.skippedOperators,
      writes: plans.writes.map(({ data, ...plan }) => ({ ...plan, after: data.employmentStatus })) };
    if (apply) {
      const batch = db.batch();
      for (const plan of plans.writes) {
        const ref = db.collection("staffs").doc(plan.docId);
        if (plan.change === "create_unprovisioned_staff") batch.create(ref, plan.data);
        else batch.set(ref, plan.data, { merge: true });
      }
      batch.set(db.doc("opsState/studiomateStaffBrowserScan"), {
        source: STAFF_EMPLOYMENT_SOURCE, scannedStaffs: scanned.total, scannedNames: summary.scannedNames,
        updatedAt: admin.firestore.Timestamp.now(),
        ...(!staffIdScope ? { fullScanComplete: true, lastFullScanAt: scanned.capturedAt } : {}),
      }, { merge: true });
      await batch.commit();
    }
  }
} catch (error) {
  process.exitCode = 1;
  summary = { ok: false, mode: apply ? "apply" : "dry-run", error: error instanceof Error ? error.message : String(error) };
}
summary = { ...summary, startedAt, finishedAt: new Date().toISOString() };
await mkdir(REPORT_DIR, { recursive: true });
summary.reportPath = path.join(REPORT_DIR, `${new Date().toISOString().replace(/[:.]/g, "-" )}-staff-employment-${apply ? "apply" : "dry-run"}.json`);
await writeFile(summary.reportPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));

function buildPlans(scanned, existing, options = {}) {
  if (options.retireMissing !== false) return buildStaffEmploymentPlans(scanned, existing);
  if (!staffIdScope) throw new Error("Partial scan requires a staff scope");
  return buildStaffEmploymentPlans(scanned, existing, { staffIdScope });
}

async function scanStudioMateStaffTab(existing) {
  const release = await acquireStudioMateBrowserLock({ owner: "studiomate-staff-browser-scan", waitMs: 0 });
  let context;
  try {
    const { chromium } = await import("playwright");
    context = await chromium.launchPersistentContext(PROFILE_DIR, { headless: HEADLESS });
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/staffs`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await ensureStudioMateLoggedIn(page, { headless: HEADLESS, waitForLogin: process.env.WAIT_FOR_LOGIN === "true" });
    if (new URL(page.url()).pathname !== "/staffs") await page.goto(`${BASE_URL}/staffs`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: /^총\s*\d+명$/ }).waitFor({ state: "visible" });
    // A loading page briefly reports zero; require actual visible staff rows.
    await page.getByRole("row").filter({ has: page.getByRole("img") }).first().waitFor({ state: "visible", timeout: 20000 });
    const source = await page.evaluate(() => ({
      total: Number(document.querySelector("h4")?.textContent?.match(/총\s*(\d+)명/)?.[1]),
      filters: [...document.querySelectorAll(".staff-filter input")].map(i => i.value),
      search: document.querySelector('input[placeholder="이름 또는 휴대폰 번호로 검색"]')?.value,
      rows: [...document.querySelectorAll("table.el-table__body tr")].map(r => [...r.querySelectorAll("td")].map(c => c.innerText.trim())),
    }));
    if (source.filters[0] !== "역할 전체" || source.filters[1] !== "근무형태 전체" || source.search !== "") throw new Error("Staff roster filters are not complete");
    if (!source.total || source.rows.length !== source.total) throw new Error("Incomplete staff roster page; no writes allowed");
    const staffs = [];
    for (const cells of source.rows) {
      const name = cells[1]?.split("\n")[0]?.trim();
      const phone = (cells[4] || "").replace(/\D/g, "");
      const matches = existing.filter(s => String(s.phone || "").replace(/\D/g, "") === phone && s.name === name);
      let staffId;
      if (matches.length === 1) {
        staffId = String(matches[0].studiomateStaffId || matches[0].staffId || matches[0].docId);
      } else {
        if (matches.length > 1) throw new Error("Ambiguous staff identity in canonical records");
        await page.getByRole("img", { name, exact: true }).click();
        await page.waitForURL(`${BASE_URL}/staffs/detail?id=*`);
        await page.getByRole("heading", { name, exact: true }).waitFor({ state: "visible" });
        staffId = new URL(page.url()).searchParams.get("id");
        await page.getByRole("link", { name: "강사", exact: true }).click();
        await page.waitForURL(`${BASE_URL}/staffs`);
        await page.getByRole("img", { name, exact: true }).waitFor({ state: "visible" });
      }
      staffs.push({ staffId, name, phone, sourceRole: cells[2], employmentType: cells[3] });
    }
    const final = await page.evaluate(() => ({
      total: Number(document.querySelector("h4")?.textContent?.match(/총\s*(\d+)명/)?.[1]),
      rows: [...document.querySelectorAll("table.el-table__body tr")].map(r => [...r.querySelectorAll("td")].map(c => c.innerText.trim())),
    }));
    if (final.total !== source.total || JSON.stringify(final.rows) !== JSON.stringify(source.rows)) throw new Error("Staff roster changed during scan");
    return { source: STAFF_EMPLOYMENT_SOURCE, studioId: STUDIO_ID, scanUrl: `${BASE_URL}/staffs`,
      capturedAt: new Date().toISOString(), total: source.total, complete: true,
      filters: { role: "전체", employmentType: "전체", search: "" }, staffs };
  } finally {
    try { if (context) await context.close(); } finally { await release(); }
  }
}

function valueArg(name) {
  const inline = process.argv.slice(2).find(a => a.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || "" : "";
}
function expandHome(value) { return String(value).replace(/^~/, os.homedir()); }
