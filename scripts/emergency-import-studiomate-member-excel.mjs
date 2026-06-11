#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { qualityIssuesFromSummary, recordDataQualityIssues, recordSourceImport } from "./lib/archive-core-ops-logging.mjs";

const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "archive-pilates";
const STUDIO_ID = process.env.STUDIOMATE_STUDIO_ID || process.env.MANAGER_STUDIO_ID || "5330";
const PYTHON =
  process.env.ARCHIVEIN_PYTHON ||
  "/Users/archivepilates/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";
const MEMBER_EXPORT_ROOTS = [
  "/Users/archivepilates/ArchiveIN/emergency/archive/member",
  "/Users/archivepilates/ArchiveIN/emergency/downloads",
  "/Users/archivepilates/Library/CloudStorage/GoogleDrive-home@archivepilates.com/내 드라이브/아카이브 정산/회원원본데이터",
  "/Users/archivepilates/Library/CloudStorage/GoogleDrive-home@archivepilates.com/내 드라이브/아카이브 정산/회원원본데이터",
];
const PROTECTED_STAFF_CONTACTS = [
  { name: "김기효", phone: "01086488585", role: "owner" },
  { name: "김민지", phone: "01075594765", role: "instructor" },
  { name: "김아영", phone: "01032510242", role: "instructor" },
  { name: "배민진", phone: "01044033249", role: "owner" },
  { name: "이초림", phone: "01040381248", role: "instructor" },
  { name: "정은영", phone: "01040180513", role: "staff" },
];

const args = new Set(process.argv.slice(2));
const fileArg = valueArg("--file");
const apply = args.has("--apply");
const allowNewExcelProfiles = args.has("--allow-new-excel-profiles");
const legacyNewExcelProfileMaxAgeDays = valueArg("--new-excel-profile-max-age-days") || process.env.ARCHIVEIN_NEW_EXCEL_PROFILE_MAX_AGE_DAYS || "";
const queueContactSync = args.has("--queue-contact-sync");
const maxWrites = Number(valueArg("--max-writes") || process.env.ARCHIVEIN_EMERGENCY_MAX_WRITES || "5000");
const today = kstDate(new Date());

if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const sourceFile = fileArg || latestMemberExportPath();
if (!sourceFile) {
  throw new Error("StudioMate member Excel export not found. Pass --file <xlsx|xls|csv> or check the Drive folder.");
}

const rows = readMemberRows(sourceFile);
const groupedMembers = groupRows(rows);
const [existingProfiles, existingContacts] = await Promise.all([loadExistingProfiles(), loadExistingContacts()]);
const { plans, skipped } = buildPlans(groupedMembers, existingProfiles, existingContacts);
const summary = {
  ok: true,
  mode: apply ? "apply" : "dry-run",
  source: "studiomate_excel_emergency",
  sourceFile,
  studioId: STUDIO_ID,
  readRows: rows.length,
  groupedMembers: groupedMembers.length,
  plannedWrites: plans.length,
  plannedContactSyncJobs: plans.filter((plan) => plan.contactSyncJobDoc).length,
  plannedStudiomateMemberIdLookupJobs: plans.filter((plan) => plan.studiomateMemberIdLookupJobDoc).length,
  matchedExistingProfiles: plans.filter((plan) => plan.matchType === "existing").length,
  temporaryExcelProfiles: plans.filter((plan) => plan.matchType === "temporary_excel_id").length,
  skipped,
  missingIdentitySummary: groupedMembers.missingIdentitySummary || null,
  allowNewExcelProfiles,
  newExcelProfileRule: "active_ticket_required_registered_at_not_limited",
  legacyNewExcelProfileMaxAgeDays,
  queueContactSync,
  maxWrites,
};

if (plans.length > maxWrites) {
  throw new Error(`Planned writes ${plans.length} exceeds --max-writes ${maxWrites}.`);
}

if (apply) {
  await applyPlans(plans);
  await db.collection("opsState").doc("studiomateExcelEmergency").set(
    {
      active: true,
      sourceFile,
      studioId: STUDIO_ID,
      importedRows: rows.length,
      importedMembers: plans.length,
      skippedMembers: skipped,
      queueContactSync,
      updatedAt: admin.firestore.Timestamp.now(),
    },
    { merge: true },
  );
}

const { importId } = await recordSourceImport(db, {
  sourceKind: "studiomate_member_excel",
  sourceFilePath: sourceFile,
  mode: summary.mode,
  status: apply ? "applied" : "dry_run",
  rowCount: summary.readRows,
  normalizedRows: summary.groupedMembers,
  appliedRows: apply ? summary.plannedWrites : 0,
  skippedRows: Object.values(summary.skipped || {}).reduce((sum, value) => sum + Number(value || 0), 0),
  notes: [
    `matchedExistingProfiles=${summary.matchedExistingProfiles}`,
    `temporaryExcelProfiles=${summary.temporaryExcelProfiles}`,
    `queueContactSync=${summary.queueContactSync}`,
    `missingIdentityReviewRequired=${summary.missingIdentitySummary?.reviewRequired || 0}`,
    `missingIdentityReviewedSafe=${summary.missingIdentitySummary?.reviewedSafe || 0}`,
  ],
});
await recordDataQualityIssues(db, qualityIssuesFromSummary(summary, importId));

console.log(JSON.stringify({ ...summary, sourceImportId: importId }, null, 2));

function valueArg(name) {
  const prefix = `${name}=`;
  const inline = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function latestMemberExportPath() {
  const py = String.raw`
from pathlib import Path
import json
roots = ${JSON.stringify(MEMBER_EXPORT_ROOTS)}
files = []
for root in roots:
    p = Path(root)
    if not p.exists():
        continue
    for item in p.rglob("*"):
        if item.is_file() and item.suffix.lower() in {".xlsx", ".xls", ".csv"} and "회원목록" in item.name and not item.name.startswith("~$"):
            files.append(item)
files.sort(key=lambda p: p.stat().st_mtime)
print(json.dumps(str(files[-1]) if files else ""))
`;
  const result = spawnSync(PYTHON, ["-c", py], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Failed to find member export");
  const found = JSON.parse(result.stdout || "\"\"");
  return found && existsSync(found) ? found : "";
}

function readMemberRows(filePath) {
  const py = String.raw`
from pathlib import Path
import json
import pandas as pd
source = Path(${JSON.stringify(filePath)})
if source.suffix.lower() == ".csv":
    df = pd.read_csv(source)
else:
    df = pd.read_excel(source, sheet_name=0)
df = df.where(pd.notna(df), "")
rows = []
for row in df.to_dict(orient="records"):
    rows.append({str(k): ("" if v is None else str(v).strip()) for k, v in row.items()})
print(json.dumps(rows, ensure_ascii=False))
`;
  const result = spawnSync(PYTHON, ["-c", py], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Failed to parse member export");
  return JSON.parse(result.stdout || "[]");
}

function groupRows(rows) {
  const groups = new Map();
  const missingIdentitySummary = createMissingIdentitySummary();
  for (const [index, row] of rows.entries()) {
    const name = cleanText(row["이름"]);
    const phone = normalizePhone(row["전화번호"]);
    if (!name || !phone) {
      addMissingIdentityRow(missingIdentitySummary, row, index);
      continue;
    }
    const key = `${phone}|${normalizeName(name)}`;
    const current = groups.get(key) || { name, normalizedName: normalizeName(name), phone, rows: [] };
    current.rows.push(row);
    groups.set(key, current);
  }
  const out = [...groups.values()];
  out.skippedNoPhone = missingIdentitySummary.total;
  out.missingIdentitySummary = missingIdentitySummary;
  return out;
}

async function loadExistingProfiles() {
  const snap = await db.collection("memberProfiles").where("studioId", "==", STUDIO_ID).get();
  const byPhone = new Map();
  for (const doc of snap.docs) {
    const data = doc.data();
    const phone = normalizePhone(data.phone || "");
    if (!phone) continue;
    const list = byPhone.get(phone) || [];
    list.push({ id: doc.id, data });
    byPhone.set(phone, list);
  }
  return byPhone;
}

async function loadExistingContacts() {
  const snap = await db.collection("memberContactIndex").where("studioId", "==", STUDIO_ID).get();
  const out = new Map();
  for (const doc of snap.docs) out.set(doc.id, doc.data());
  return out;
}

function buildPlans(groups, existingProfiles, existingContacts) {
  let skippedNoActiveTicket = 0;
  let skippedAmbiguousPhone = 0;
  let skippedNoExistingProfile = 0;
  let skippedProtectedStaffContact = 0;
  let skippedNewProfileNoActiveTicket = 0;
  let skippedNewProfileTooOld = 0;
  let consultationContacts = 0;
  let skippedNoPhone = groups.skippedNoPhone || 0;
  const missingIdentitySummary = groups.missingIdentitySummary || createMissingIdentitySummary();
  const plans = [];
  for (const group of groups) {
    if (isProtectedStaffContact(group)) {
      skippedProtectedStaffContact += 1;
      continue;
    }
    const activeTickets = buildActiveTickets(group.rows);
    const ticketStatusSummary = buildTicketStatusSummary(group.rows);
    const registeredAt = parseKstTimestamp(bestDate(group.rows, "등록일"));
    const latestAttendance = bestDate(group.rows, "최근출석일");
    const email = firstNonEmpty(group.rows, "이메일");
    const gender = firstNonEmpty(group.rows, "성별");
    const birthDate = firstNonEmpty(group.rows, "생년월일");
    const contactMemo = cleanContactMemo(firstNonEmpty(group.rows, "메모"));
    const memoPreview = contactMemo.slice(0, 120);
    if (isConsultationGroup(group, activeTickets)) {
      const consultationDate = parseKstTimestamp(consultationDateText(group.rows));
      const memberId = `consultation_excel_${hash(`${group.phone}|${group.normalizedName}`).slice(0, 16)}`;
      const contactDisplayName = [group.name, "상담", compactDate(consultationDate)].filter(Boolean).join(" ");
      const contactHash = hash({
        name: group.name,
        contactDisplayName,
        contactMemo,
        phone: group.phone,
        consultationDate: consultationDate?.toMillis() || null,
        source: "studiomate_excel_consultation_v2",
      });
      const previousContact = existingContacts.get(memberId);
      const shouldQueueHomeSync =
        queueContactSync &&
        (!previousContact ||
          previousContact.contactHash !== contactHash ||
          previousContact.contactTargets?.home_archivepilates !== "synced");
      const jobId = `contact_${memberId}_home_${contactHash.slice(0, 16)}`;
      const contactIndexDoc = {
        memberId,
        studioId: STUDIO_ID,
        name: group.name,
        contactDisplayName,
        contactMemo,
        phone: group.phone,
        phoneLast4: group.phone.slice(-4),
        registeredAt: consultationDate,
        activeTicketCount: 0,
        activeTicketNames: [],
        source: "studiomate_excel_emergency",
        contactHash,
        contactTargets: {
          archivepilates_gmail: previousContact?.contactTargets?.archivepilates_gmail || "skipped",
          home_archivepilates: shouldQueueHomeSync
            ? "pending"
            : previousContact?.contactTargets?.home_archivepilates || "skipped",
        },
        homeContactResourceName: previousContact?.homeContactResourceName || "",
        lastContactSyncJobId: shouldQueueHomeSync ? jobId : previousContact?.lastContactSyncJobId || "",
        contactLastError: shouldQueueHomeSync ? null : previousContact?.contactLastError || null,
        contactUpdatedAt: previousContact?.contactUpdatedAt || null,
        syncedAt: admin.firestore.Timestamp.now(),
        updatedAt: admin.firestore.Timestamp.now(),
      };
      const contactSyncJobDoc = shouldQueueHomeSync
        ? {
            jobId,
            studioId: STUDIO_ID,
            memberId,
            memberName: group.name,
            contactDisplayName,
            contactMemo,
            memberPhone: group.phone,
            target: "home_archivepilates",
            status: "pending",
            attempts: 0,
            maxAttempts: 5,
            nextRunAt: admin.firestore.Timestamp.now(),
            lastError: null,
            sourceReason: "consultation_member_excel",
            createdAt: admin.firestore.Timestamp.now(),
            updatedAt: admin.firestore.Timestamp.now(),
          }
        : null;
      consultationContacts += 1;
      plans.push({ memberId, matchType: "consultation_excel", contactIndexDoc, contactSyncJobDoc });
      continue;
    }
    const existing = existingProfiles.get(group.phone) || [];
    const exact = existing.filter((item) => normalizeName(item.data.name || "") === group.normalizedName);
    let memberId = "";
    let matchType = "temporary_excel_id";
    if (exact.length === 1) {
      memberId = exact[0].id;
      matchType = "existing";
    } else if (existing.length === 1) {
      memberId = existing[0].id;
      matchType = "existing";
    } else if (existing.length > 1) {
      skippedAmbiguousPhone += 1;
      continue;
    } else if (allowNewExcelProfiles) {
      if (!activeTickets.length) {
        skippedNewProfileNoActiveTicket += 1;
        continue;
      }
      memberId = `excel_${hash(`${group.phone}|${group.normalizedName}`).slice(0, 16)}`;
    } else {
      skippedNoExistingProfile += 1;
      continue;
    }
    if (!activeTickets.length) skippedNoActiveTicket += 1;
    const profileDoc = {
      memberId,
      studioId: STUDIO_ID,
      name: group.name,
      normalizedName: group.normalizedName,
      phone: group.phone,
      phoneLast4: group.phone.slice(-4),
      email,
      birthDate,
      gender,
      memoPreview,
      activeTicketNames: activeTickets.map((ticket) => ticket.name),
      activeTicketCount: activeTickets.length,
      activeTickets,
      ticketStatusSummary,
      isNewMember: registeredAt ? daysBetween(kstDate(registeredAt.toDate()), today) <= 3 : false,
      newMemberBasis: registeredAt ? "registered_at" : "unknown",
      registeredAt,
      sourceUpdatedAt: null,
      syncedAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
      emergencySource: "studiomate_excel",
      emergencySourceFile: sourceFile,
      emergencyLastAttendance: latestAttendance,
    };
    const contactDisplayName = [group.name, "회원", compactDate(registeredAt)].filter(Boolean).join(" ");
    const contactHash = hash({
      name: group.name,
      contactDisplayName,
      contactMemo,
      phone: group.phone,
      registeredAt: registeredAt?.toMillis() || null,
      activeTicketNames: profileDoc.activeTicketNames,
    });
    const previousContact = existingContacts.get(memberId);
    const shouldQueueHomeSync =
      queueContactSync &&
      (!previousContact ||
        previousContact.contactHash !== contactHash ||
        previousContact.contactTargets?.home_archivepilates !== "synced");
    const contactTargets = {
      archivepilates_gmail: previousContact?.contactTargets?.archivepilates_gmail || "skipped",
      home_archivepilates: shouldQueueHomeSync
        ? "pending"
        : previousContact?.contactTargets?.home_archivepilates || "skipped",
    };
    const jobId = `contact_${memberId}_home_${contactHash.slice(0, 16)}`;
    const contactIndexDoc = {
      memberId,
      studioId: STUDIO_ID,
      name: group.name,
      contactDisplayName,
      contactMemo,
      phone: group.phone,
      phoneLast4: group.phone.slice(-4),
      registeredAt,
      activeTicketCount: activeTickets.length,
      activeTicketNames: profileDoc.activeTicketNames,
      source: "studiomate_excel_emergency",
      contactHash,
      contactTargets,
      homeContactResourceName: previousContact?.homeContactResourceName || "",
      lastContactSyncJobId: shouldQueueHomeSync ? jobId : previousContact?.lastContactSyncJobId || "",
      contactLastError: shouldQueueHomeSync ? null : previousContact?.contactLastError || null,
      contactUpdatedAt: previousContact?.contactUpdatedAt || null,
      syncedAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
    };
    const contactSyncJobDoc = shouldQueueHomeSync
      ? {
          jobId,
          studioId: STUDIO_ID,
          memberId,
          memberName: group.name,
          contactDisplayName,
          contactMemo,
          memberPhone: group.phone,
          target: "home_archivepilates",
          status: "pending",
          attempts: 0,
          maxAttempts: 5,
          nextRunAt: admin.firestore.Timestamp.now(),
          lastError: null,
          sourceReason: profileDoc.isNewMember ? "notice_member_signup" : "member_profile_refresh",
          createdAt: admin.firestore.Timestamp.now(),
          updatedAt: admin.firestore.Timestamp.now(),
        }
      : null;
    const studiomateMemberIdLookupJobDoc =
      matchType === "temporary_excel_id"
        ? {
            jobId: `studiomate_member_id_lookup_${memberId}`,
            studioId: STUDIO_ID,
            memberId,
            memberName: group.name,
            memberPhone: group.phone,
            phoneLast4: group.phone.slice(-4),
            status: "pending",
            attempts: 0,
            maxAttempts: 5,
            source: "studiomate_excel_new_member",
            sourceFile,
            createdAt: admin.firestore.Timestamp.now(),
            updatedAt: admin.firestore.Timestamp.now(),
            lastError: null,
          }
        : null;
    plans.push({ memberId, matchType, profileDoc, contactIndexDoc, contactSyncJobDoc, studiomateMemberIdLookupJobDoc });
  }
  return {
    plans,
    skipped: {
      rowsWithoutNameOrPhone: skippedNoPhone,
      rowsWithoutName: missingIdentitySummary.missingName || 0,
      rowsWithoutPhone: missingIdentitySummary.missingPhone || 0,
      rowsWithoutNameOrPhoneReviewRequired: missingIdentitySummary.reviewRequired || 0,
      rowsWithoutNameOrPhoneReviewedSafe: missingIdentitySummary.reviewedSafe || 0,
      ambiguousExistingPhone: skippedAmbiguousPhone,
      noExistingProfile: skippedNoExistingProfile,
      profilesWithoutActiveTicket: skippedNoActiveTicket,
      newProfileNoActiveTicket: skippedNewProfileNoActiveTicket,
      newProfileTooOld: skippedNewProfileTooOld,
      protectedStaffContact: skippedProtectedStaffContact,
      consultationContacts,
    },
  };
}

function createMissingIdentitySummary() {
  return {
    total: 0,
    missingName: 0,
    missingPhone: 0,
    reviewRequired: 0,
    reviewedSafe: 0,
    ticketStatusCounts: {},
    ticketKindCounts: {},
    ticketNameCounts: {},
    sampleRows: [],
  };
}

function addMissingIdentityRow(summary, row, index) {
  const missingName = !cleanText(row["이름"]);
  const missingPhone = !normalizePhone(row["전화번호"]);
  const needsReview = missingIdentityNeedsReview(row, { missingName, missingPhone });
  summary.total += 1;
  if (missingName) summary.missingName += 1;
  if (missingPhone) summary.missingPhone += 1;
  if (needsReview) summary.reviewRequired += 1;
  else summary.reviewedSafe += 1;
  incrementCounter(summary.ticketStatusCounts, cleanText(row["수강권상태"]) || "없음");
  incrementCounter(summary.ticketKindCounts, cleanText(row["수강권종류"]) || "없음");
  incrementCounter(summary.ticketNameCounts, cleanText(row["수강권명"]) || "없음");
  if (summary.sampleRows.length < 12) {
    summary.sampleRows.push(sampleMissingIdentityRow(row, index, needsReview));
  }
}

function missingIdentityNeedsReview(row, { missingName, missingPhone }) {
  if (missingName) return true;
  if (!missingPhone) return false;
  const ticketName = cleanText(row["수강권명"]);
  const ticketStatus = cleanText(row["수강권상태"]);
  if (!ticketName && !ticketStatus) return false;
  return !isInactiveTicketStatus(ticketStatus);
}

function sampleMissingIdentityRow(row, index, needsReview) {
  return {
    excelRow: index + 2,
    name: cleanText(row["이름"]),
    missingName: !cleanText(row["이름"]),
    missingPhone: !normalizePhone(row["전화번호"]),
    ticketName: cleanText(row["수강권명"]),
    ticketKind: cleanText(row["수강권종류"]),
    ticketStatus: cleanText(row["수강권상태"]),
    registeredAt: cleanText(row["등록일"]),
    recentAttendance: cleanText(row["최근출석일"]),
    needsReview,
  };
}

function buildActiveTickets(rows) {
  const active = [];
  for (const row of rows) {
    const status = cleanText(row["수강권상태"]);
    if (!isUsableTicketStatus(status)) continue;
    const name = cleanText(row["수강권명"]);
    if (!name) continue;
    const expiresAt = parseKstTimestamp(row["수강권종료일"]);
    const availableFrom = parseKstTimestamp(row["수강권시작일"]);
    const remainingCount = nullableNumber(row["잔여횟수"]);
    if (expiresAt && kstDate(expiresAt.toDate()) < today) continue;
    if (remainingCount != null && Number.isFinite(Number(remainingCount)) && Number(remainingCount) <= 0) continue;
    active.push({
      userTicketId: "",
      ticketId: "",
      name,
      remainingCount,
      usableCount: nullableNumber(row["예약가능횟수"]),
      maxCount: nullableNumber(row["전체횟수"]),
      availableFrom,
      expiresAt,
      expiryLevel: ticketExpiryLevel(expiresAt),
      status,
      classType: cleanText(row["수강권종류"]),
    });
  }
  const byKey = new Map();
  for (const ticket of active) {
    const key = `${ticket.name}|${ticket.expiresAt?.toMillis() || ""}|${ticket.remainingCount ?? ""}`;
    byKey.set(key, ticket);
  }
  return [...byKey.values()].sort((a, b) => (a.expiresAt?.toMillis() || Number.MAX_SAFE_INTEGER) - (b.expiresAt?.toMillis() || Number.MAX_SAFE_INTEGER));
}

function buildTicketStatusSummary(rows) {
  const holdingTickets = [];
  for (const row of rows) {
    const status = cleanText(row["수강권상태"]);
    const name = cleanText(row["수강권명"]);
    if (!name || !isHoldingTicketStatus(status)) continue;
    holdingTickets.push({
      name,
      status,
      availableFrom: parseKstTimestamp(row["수강권시작일"]),
      expiresAt: parseKstTimestamp(row["수강권종료일"]),
      updatedAtText: cleanText(row["수강권최종수정일"]),
    });
  }
  return {
    hasHoldingTicket: holdingTickets.length > 0,
    holdingTicketCount: holdingTickets.length,
    holdingTickets,
  };
}

function isHoldingTicketStatus(status) {
  return /정지|중지|홀딩/.test(cleanText(status));
}

function isInactiveTicketStatus(status) {
  return /만료|환불|취소|정지|양도|종료|해지/.test(cleanText(status));
}

function incrementCounter(target, key) {
  target[key] = (target[key] || 0) + 1;
}

async function applyPlans(plans) {
  let batch = db.batch();
  let count = 0;
  for (const plan of plans) {
    if (plan.profileDoc) {
      batch.set(db.collection("memberProfiles").doc(plan.memberId), plan.profileDoc, { merge: true });
      count += 1;
    }
    batch.set(db.collection("memberContactIndex").doc(plan.memberId), plan.contactIndexDoc, { merge: true });
    count += 1;
    if (plan.contactSyncJobDoc) {
      batch.set(db.collection("contactSyncJobs").doc(plan.contactSyncJobDoc.jobId), plan.contactSyncJobDoc, {
        merge: true,
      });
      count += 1;
    }
    if (plan.studiomateMemberIdLookupJobDoc) {
      batch.set(
        db.collection("studiomateMemberIdLookupJobs").doc(plan.studiomateMemberIdLookupJobDoc.jobId),
        plan.studiomateMemberIdLookupJobDoc,
        { merge: true },
      );
      count += 1;
    }
    if (count >= 450) {
      await batch.commit();
      batch = db.batch();
      count = 0;
    }
  }
  if (count) await batch.commit();
}

function isUsableTicketStatus(status) {
  if (!status) return false;
  if (/만료|환불|취소|정지|양도/.test(status)) return false;
  return /사용|이용|정상|예정/.test(status);
}

function isConsultationGroup(group, activeTickets) {
  if (activeTickets.length) return false;
  return group.rows.some((row) => cleanText(row["등급"]) === "상담회원");
}

function consultationDateText(rows) {
  const memoDate = rows.map((row) => consultationDateFromMemo(row["메모"])).find(Boolean);
  return memoDate || bestDate(rows, "등록일");
}

function consultationDateFromMemo(value) {
  const text = cleanText(value);
  const bracketDate = text.match(/\[(20\d{2}[-.]\d{1,2}[-.]\d{1,2})\]\[[^\]]*상담[^\]]*\]/);
  if (bracketDate) return bracketDate[1];
  const plainDate = text.match(/(20\d{2}[-.]\d{1,2}[-.]\d{1,2}).{0,20}상담|상담.{0,20}(20\d{2}[-.]\d{1,2}[-.]\d{1,2})/);
  return plainDate?.[1] || plainDate?.[2] || "";
}

function parseKstTimestamp(value) {
  const text = cleanText(value);
  if (!text) return null;
  const normalized = text.replace(/\./g, "-").replace(/\s+/g, "");
  const match = normalized.match(/^(20\d{2})-(\d{1,2})-(\d{1,2})/);
  if (!match) return null;
  const [, y, m, d] = match;
  return admin.firestore.Timestamp.fromDate(new Date(`${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T00:00:00+09:00`));
}

function ticketExpiryLevel(expiresAt) {
  if (!expiresAt) return "unknown";
  const days = daysBetween(today, kstDate(expiresAt.toDate()));
  if (days < 0) return "expired";
  if (days <= 14) return "soon";
  return "normal";
}

function daysBetween(start, end) {
  return Math.round((new Date(`${end}T00:00:00+09:00`).getTime() - new Date(`${start}T00:00:00+09:00`).getTime()) / 86400000);
}

function kstDate(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function compactDate(timestamp) {
  if (!timestamp) return "";
  return kstDate(timestamp.toDate()).replace(/^20/, "").replaceAll("-", "");
}

function firstNonEmpty(rows, key) {
  for (const row of rows) {
    const value = cleanText(row[key]);
    if (value) return value;
  }
  return "";
}

function bestDate(rows, key) {
  return rows.map((row) => cleanText(row[key])).filter(Boolean).sort().at(-1) || "";
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function cleanContactMemo(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 1000);
}

function normalizeName(value) {
  return cleanText(value).replace(/\s+/g, "").toLowerCase();
}

function normalizePhone(value) {
  let digits = cleanText(value).replace(/\D+/g, "");
  if (digits.startsWith("82") && digits.length >= 11) digits = `0${digits.slice(2)}`;
  if (digits.length === 10 && digits.startsWith("10")) digits = `0${digits}`;
  if (digits.length % 2 === 0) {
    const half = digits.length / 2;
    if (digits.slice(0, half) === digits.slice(half)) digits = digits.slice(0, half);
  }
  return digits;
}

function isProtectedStaffContact(input) {
  const phone = normalizePhone(input.phone || "");
  const name = normalizeName(input.name || "");
  return PROTECTED_STAFF_CONTACTS.some((contact) => {
    if (phone && phone === contact.phone) return true;
    return name === normalizeName(contact.name);
  });
}

function nullableNumber(value) {
  const cleaned = cleanText(value).replace(/,/g, "");
  if (!cleaned) return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function hash(value) {
  return createHash("sha256").update(typeof value === "string" ? value : stableStringify(value)).digest("hex");
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}
