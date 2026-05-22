#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { acquireStudioMateBrowserLock } from "./lib/studiomate-browser-lock.mjs";
import { ensureStudioMateLoggedIn } from "./lib/studiomate-login.mjs";

const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "archive-pilates";
const STUDIO_ID = process.env.STUDIOMATE_STUDIO_ID || process.env.MANAGER_STUDIO_ID || "5330";
const BASE_URL = process.env.STUDIOMATE_BASE_URL || "https://arcpilates.studiomate.kr";
const PROFILE_DIR = expandHome(process.env.STUDIOMATE_EMERGENCY_PROFILE_DIR || "~/ArchiveIN/automation/browser-profile");
const REPORT_DIR = expandHome(process.env.STUDIOMATE_STAFF_SCAN_REPORT_DIR || "~/ArchiveIN/automation/reports/studiomate-staff-scan");
const HEADLESS = process.env.HEADLESS !== "false";
const WAIT_FOR_LOGIN = process.env.WAIT_FOR_LOGIN === "true";
const TODAY = kstDate(new Date());
const OPERATOR_STAFF_IDS = new Set(["operator_01029244425"]);

if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const startedAt = new Date();
let summary;
try {
  const scanned = await scanStudioMateStaffTab();
  const existing = await loadExistingStaffs();
  const plans = await buildPlans(scanned, existing);
  summary = {
    ok: true,
    mode: apply ? "apply" : "dry-run",
    source: "studiomate_staff_tab_browser_scan",
    studioId: STUDIO_ID,
    baseUrl: BASE_URL,
    profileDir: PROFILE_DIR,
    scanUrl: scanned.scanUrl,
    scannedStaffs: scanned.staffs.length,
    scannedNames: scanned.staffs.map((staff) => staff.name),
    plannedWrites: plans.writes.length,
    plannedRetirements: plans.writes.filter((plan) => plan.change === "retire_missing_no_future_schedule").length,
    keptMissingWithFutureSchedule: plans.keptMissingWithFutureSchedule,
    skippedOperators: plans.skippedOperators,
    writes: plans.writes,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
  };

  if (apply && plans.writes.length) {
    const batch = db.batch();
    for (const plan of plans.writes) {
      batch.set(db.collection("staffs").doc(plan.staffId), plan.data, { merge: true });
    }
    batch.set(
      db.collection("opsState").doc("studiomateStaffBrowserScan"),
      {
        active: true,
        source: summary.source,
        scannedStaffs: summary.scannedStaffs,
        scannedNames: summary.scannedNames,
        plannedWrites: summary.plannedWrites,
        plannedRetirements: summary.plannedRetirements,
        keptMissingWithFutureSchedule: summary.keptMissingWithFutureSchedule,
        updatedAt: admin.firestore.Timestamp.now(),
      },
      { merge: true },
    );
    await batch.commit();
  }
} catch (error) {
  process.exitCode = 1;
  summary = {
    ok: false,
    mode: apply ? "apply" : "dry-run",
    source: "studiomate_staff_tab_browser_scan",
    studioId: STUDIO_ID,
    baseUrl: BASE_URL,
    profileDir: PROFILE_DIR,
    error: error instanceof Error ? error.message : String(error),
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
  };
}

await writeReport(summary);
if (summary.ok) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.error(JSON.stringify(summary, null, 2));
}

async function scanStudioMateStaffTab() {
  const releaseBrowserLock = await acquireStudioMateBrowserLock({ owner: "studiomate-staff-browser-scan" });
  const { chromium } = await import("playwright");
  let context = null;

  try {
    context = await chromium.launchPersistentContext(PROFILE_DIR, {
      acceptDownloads: true,
      headless: HEADLESS,
    });
    const page = await context.newPage();
    let capturedAuthorization = "";
    page.on("request", (request) => {
      if (!request.url().includes("api.studiomate.kr")) return;
      capturedAuthorization = request.headers().authorization || capturedAuthorization;
    });
    await page.goto(new URL("/staffs", BASE_URL).toString(), { waitUntil: "networkidle", timeout: 60000 });
    await closeNoticeDialog(page);
    await assertLoggedIn(page);
    if (!new URL(page.url()).pathname.startsWith("/staffs")) {
      await page.goto(new URL("/staffs", BASE_URL).toString(), { waitUntil: "networkidle", timeout: 60000 });
      await closeNoticeDialog(page);
      await assertLoggedIn(page);
    }
    await page.waitForTimeout(1200);
    if (!capturedAuthorization) throw new Error("StudioMate authorization header was not captured from the browser session.");
    const staffs = await fetchAllStaffs(capturedAuthorization);
    return { scanUrl: page.url(), staffs };
  } finally {
    if (context) await context.close();
    await releaseBrowserLock();
  }
}

async function fetchAllStaffs(authorization) {
  const out = [];
  let page = 1;
  let lastPage = 1;
  do {
    const query = new URLSearchParams({ order_by: "asc", search: "", page: String(page), per_page: "100" });
    const response = await fetch(`https://api.studiomate.kr/staff/staff?${query.toString()}`, {
      headers: { authorization, accept: "application/json" },
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`StudioMate staff tab API failed ${response.status}: ${text.slice(0, 500)}`);
    const json = JSON.parse(text);
    const pageData = json.staffs || {};
    const rows = Array.isArray(pageData.data) ? pageData.data : [];
    out.push(...rows.map(normalizeStudioMateStaff).filter((staff) => staff.staffId && staff.name));
    lastPage = Number(pageData.last_page || page);
    page += 1;
  } while (page <= lastPage);
  return out;
}

async function loadExistingStaffs() {
  const snap = await db.collection("staffs").where("studioId", "==", STUDIO_ID).get();
  return snap.docs.map((doc) => ({ docId: doc.id, ...doc.data() }));
}

async function buildPlans(scanned, existing) {
  const writes = [];
  const scannedIds = new Set(scanned.staffs.map((staff) => staff.staffId));
  const existingById = new Map(existing.map((staff) => [staff.staffId || staff.docId, staff]));
  for (const staff of scanned.staffs) {
    const current = existingById.get(staff.staffId);
    const data = {
      staffId: staff.staffId,
      studioId: STUDIO_ID,
      name: staff.name,
      phone: staff.phone || current?.phone || "",
      phoneLast4: staff.phone ? staff.phone.slice(-4) : current?.phoneLast4 || "",
      color: staff.color || current?.color || "",
      themeColor: staff.color || current?.themeColor || "",
      role: protectedRole(current?.role, staff.role),
      active: !staff.deletedAt,
      studiomateStaffId: staff.staffId,
      visibleLectureStaffNames: current?.visibleLectureStaffNames?.length ? current.visibleLectureStaffNames : [staff.name],
      sourceUpdatedAt: staff.updatedAt || null,
      updatedAt: admin.firestore.Timestamp.now(),
      createdAt: current?.createdAt || admin.firestore.Timestamp.now(),
    };
    if (current?.uid) data.uid = current.uid;
    if (current?.email) data.email = current.email;
    writes.push({
      staffId: staff.staffId,
      name: staff.name,
      change: current ? "upsert_scanned_staff" : "create_scanned_staff",
      before: pickStaff(current),
      after: pickStaff(data),
      data,
    });
  }

  const skippedOperators = [];
  const keptMissingWithFutureSchedule = [];
  for (const staff of existing) {
    const staffId = staff.staffId || staff.docId;
    if (!staff.active || scannedIds.has(staffId)) continue;
    if (OPERATOR_STAFF_IDS.has(staffId) || staff.role === "manager") {
      skippedOperators.push({ staffId, name: staff.name, role: staff.role });
      continue;
    }
    const future = await futureScheduleCount(staffId);
    if (future.lectures || future.bookings) {
      keptMissingWithFutureSchedule.push({ staffId, name: staff.name, ...future });
      continue;
    }
    writes.push({
      staffId,
      name: staff.name,
      change: "retire_missing_no_future_schedule",
      before: pickStaff(staff),
      after: { ...pickStaff(staff), active: false },
      data: {
        active: false,
        retiredAt: admin.firestore.Timestamp.now(),
        retiredReason: "StudioMate 강사탭 주간 스캔에서 제외되고 미래 수업/예약 없음",
        updatedAt: admin.firestore.Timestamp.now(),
      },
    });
  }
  return { writes, skippedOperators, keptMissingWithFutureSchedule };
}

async function futureScheduleCount(staffId) {
  const [lectures, bookings] = await Promise.all([
    db.collection("lectures").where("studioId", "==", STUDIO_ID).where("staffId", "==", staffId).where("date", ">=", TODAY).limit(1).get(),
    db
      .collection("bookings")
      .where("studioId", "==", STUDIO_ID)
      .where("staffId", "==", staffId)
      .where("lectureDate", ">=", TODAY)
      .limit(1)
      .get(),
  ]);
  return { lectures: lectures.size, bookings: bookings.size };
}

function normalizeStudioMateStaff(row) {
  const profile = row.profile || {};
  const representativeContact = Array.isArray(row.contact_infos)
    ? row.contact_infos.find((item) => item?.is_representative)?.contact || row.contact_infos[0]?.contact
    : "";
  return {
    staffId: stringValue(row.id),
    name: stringValue(row.name || profile.name),
    phone: digitsOnly(row.mobile || representativeContact),
    role: roleFromStudioMate(row),
    color: colorValue(profile.representative_color || row.color || row.theme_color),
    deletedAt: row.deleted_at || profile.deleted_at || null,
    updatedAt: parseTimestamp(row.updated_at || profile.updated_at),
  };
}

function roleFromStudioMate(row) {
  const roles = Array.isArray(row.roles) ? row.roles : [];
  const text = roles.map((role) => `${role.name || ""} ${role.display_name || ""}`).join(" ");
  if (/studio_owner|오너|owner/i.test(text)) return "owner";
  if (/manager|매니저|관리/i.test(text)) return "manager";
  return "instructor";
}

function protectedRole(currentRole, scannedRole) {
  if (currentRole) return currentRole;
  return scannedRole || "instructor";
}

async function assertLoggedIn(page) {
  await ensureStudioMateLoggedIn(page, { headless: HEADLESS, waitForLogin: WAIT_FOR_LOGIN });
}

async function closeNoticeDialog(page) {
  for (const candidate of [
    page.getByRole("button", { name: "닫기" }).last(),
    page.getByText("닫기", { exact: true }).last(),
    page.locator(".el-dialog__headerbtn").first(),
  ]) {
    if (await candidate.isVisible().catch(() => false)) {
      await candidate.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(300);
    }
  }
}

async function writeReport(summary) {
  await mkdir(REPORT_DIR, { recursive: true });
  const reportPath = path.join(
    REPORT_DIR,
    `${new Date().toISOString().replace(/[:.]/g, "-")}-staff-scan-${apply ? "apply" : "dry-run"}.json`,
  );
  summary.reportPath = reportPath;
  await writeFile(reportPath, `${JSON.stringify(summary, null, 2)}\n`);
}

function pickStaff(staff) {
  if (!staff) return null;
  return {
    staffId: staff.staffId,
    name: staff.name,
    role: staff.role,
    active: staff.active,
    phoneLast4: staff.phoneLast4 || "",
    color: staff.color || staff.themeColor || "",
  };
}

function parseTimestamp(value) {
  if (!value) return null;
  const normalized = String(value).includes("T") ? String(value) : String(value).replace(" ", "T");
  const date = new Date(`${normalized}${/[zZ]|[+-]\d\d:?\d\d$/.test(normalized) ? "" : "+09:00"}`);
  return Number.isNaN(date.getTime()) ? null : admin.firestore.Timestamp.fromDate(date);
}

function colorValue(value) {
  const text = stringValue(value);
  if (/^#[0-9a-f]{6}$/i.test(text)) return text;
  const hex = text.match(/[0-9a-f]{6}/i)?.[0];
  return hex ? `#${hex}` : "";
}

function kstDate(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(date);
}

function expandHome(value) {
  return String(value || "").replace(/^~/, os.homedir());
}

function stringValue(value) {
  return value == null ? "" : String(value).trim();
}

function digitsOnly(value) {
  return stringValue(value).replace(/\D/g, "");
}
