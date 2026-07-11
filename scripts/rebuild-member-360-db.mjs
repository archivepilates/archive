#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");

const HOME = os.homedir();
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "archive-pilates";
const STUDIO_ID = process.env.STUDIOMATE_STUDIO_ID || process.env.MANAGER_STUDIO_ID || "5330";
const DEFAULT_CREDENTIALS = path.join(HOME, "ArchiveIN/secrets/google/archive-codex-operator.json");
const DEFAULT_PYTHON = path.join(
  HOME,
  ".cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3",
);
const REPORT_DIR = path.join(HOME, "ArchiveIN/automation/reports/member-360-db");
const DEFAULT_TICKET_HISTORY_ROOT = path.join(HOME, "ArchiveIN/emergency/archive/member-usage");

const args = parseArgs(process.argv.slice(2));
const config = {
  apply: Boolean(args.apply),
  studioId: String(args["studio-id"] || STUDIO_ID),
  credentialsPath: expandHome(String(args.credentials || process.env.GOOGLE_APPLICATION_CREDENTIALS || DEFAULT_CREDENTIALS)),
  python: expandHome(String(args.python || process.env.PYTHON || DEFAULT_PYTHON)),
  ticketHistoryFile: expandHome(String(args["ticket-history-file"] || process.env.ARCHIVEIN_MEMBER_TICKET_HISTORY_FILE || "")),
  ticketHistoryRoot: expandHome(String(args["ticket-history-root"] || process.env.ARCHIVEIN_MEMBER_TICKET_HISTORY_ROOT || DEFAULT_TICKET_HISTORY_ROOT)),
  startDate: String(args["start-date"] || ""),
  endDate: String(args["end-date"] || ""),
  maxWrites: Number(args["max-writes"] || process.env.ARCHIVEIN_MEMBER360_MAX_WRITES || "50000"),
  sampleLimit: Number(args["sample-limit"] || "20"),
};

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && existsSync(config.credentialsPath)) {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = config.credentialsPath;
}

if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exitCode = 1;
});

async function main() {
  validateConfig();
  const [profiles, bookings, memos, tags, alimtalkCandidates, alimtalkSends] = await Promise.all([
    loadCollection("memberProfiles"),
    loadCollection("bookings"),
    loadCollection("memberMemos"),
    loadCollection("memberTags"),
    loadCollection("alimtalkCandidates"),
    loadCollection("alimtalkSends"),
  ]);
  const ticketPurchases = readTicketPurchases();
  const indexes = buildIndexes({ profiles, bookings, memos, tags, alimtalkCandidates, alimtalkSends, ticketPurchases });
  const plans = buildMemberPlans(indexes);
  const writePlan = buildWritePlan(plans);
  const report = buildReport({ profiles, bookings, memos, tags, alimtalkCandidates, alimtalkSends, ticketPurchases, indexes, plans, writePlan });

  if (config.apply) {
    if (writePlan.length > config.maxWrites) {
      throw new Error(`Planned writes ${writePlan.length} exceeds --max-writes ${config.maxWrites}`);
    }
    await applyWritePlan(writePlan);
    report.appliedAt = new Date().toISOString();
  }

  const reportPath = writeReport(report);
  console.log(JSON.stringify({ ...report, reportPath }, null, 2));
}

function validateConfig() {
  if (!existsSync(config.python)) throw new Error(`Python runtime not found: ${config.python}`);
  if (config.ticketHistoryFile && !existsSync(config.ticketHistoryFile)) throw new Error(`Ticket history file not found: ${config.ticketHistoryFile}`);
  if (!config.ticketHistoryFile && !existsSync(config.ticketHistoryRoot)) {
    throw new Error(`Ticket history root not found: ${config.ticketHistoryRoot}`);
  }
  if (config.apply && !existsSync(config.credentialsPath)) throw new Error(`Google credentials not found: ${config.credentialsPath}`);
}

async function loadCollection(collectionName) {
  let query = db.collection(collectionName).where("studioId", "==", config.studioId);
  if (collectionName === "bookings" && config.startDate) query = query.where("lectureDate", ">=", config.startDate);
  if (collectionName === "bookings" && config.endDate) query = query.where("lectureDate", "<=", config.endDate);
  const snap = await query.get();
  return snap.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
}

function readTicketPurchases() {
  const sourceFile = config.ticketHistoryFile || latestTicketHistoryFile();
  if (!sourceFile) throw new Error(`member-ticket-history-normalized CSV not found under: ${config.ticketHistoryRoot}`);
  const script = `
import csv, json
source_file = ${JSON.stringify(sourceFile)}
rows = []
with open(source_file, newline="", encoding="utf-8-sig") as f:
    reader = csv.DictReader(f)
    for record in reader:
        record = {str(k).strip().lstrip("\\ufeff"): ("" if v is None else str(v).strip()) for k, v in record.items()}
        record["_sourceFile"] = source_file
        rows.append(record)
print(json.dumps(rows, ensure_ascii=False, default=str))
`;
  const result = spawnSync(config.python, ["-c", script], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Ticket history CSV read failed: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout).map(normalizeTicketPurchase).filter((row) => row.memberName && row.ticketName && row.memberId);
}

function normalizeTicketPurchase(row) {
  const amountTotal = money(row.paymentAmount);
  const paymentDate = dateKey(row.paymentAt);
  const memberName = cleanString(row.memberName);
  const memberPhone = normalizePhone(row.memberPhone);
  const ticketName = cleanString(row.ticketName);
  const purchaseId = cleanString(row.ticketHistoryId) || `studiomate_ticket_${hash([row.memberId, memberPhone, ticketName, paymentDate, amountTotal].join("|")).slice(0, 20)}`;
  return {
    purchaseId,
    memberId: cleanString(row.memberId),
    memberPhone,
    sourcePath: cleanString(row._sourceFile),
    sourceMonth: monthKey(paymentDate || row.issuedAt || row.startDate),
    paymentDate,
    category: cleanString(row.paymentType),
    classType: classTypeName(row.classType),
    memberName,
    normalizedName: normalizeName(memberName),
    ticketName,
    amountTotal,
    paymentMethod: cleanString(row.paymentMethod),
    startDate: dateKey(row.startDate),
    endDate: dateKey(row.endDate),
    issuedAt: dateKey(row.issuedAt),
    maxCount: numberValue(row.maxCount),
    remainingCount: numberValue(row.remainingCount),
    usableCount: numberValue(row.usableCount),
    cancelableCount: numberValue(row.cancelableCount),
    ticketStatus: cleanString(row.ticketStatus),
    isActiveTicket: boolValue(row.isActiveTicket),
    isFamilyTicket: cleanString(row.isFamilyTicket),
    usageTotal: numberValue(row.usageTotal),
    usageAttended: numberValue(row.usageAttended),
    usageAbsent: numberValue(row.usageAbsent),
    usageCancel: numberValue(row.usageCancel),
    usageWait: numberValue(row.usageWait),
    usageReservedUnchecked: numberValue(row.usageReservedUnchecked),
  };
}

function latestTicketHistoryFile() {
  const script = `
import json
from pathlib import Path
root = Path(${JSON.stringify(config.ticketHistoryRoot)})
files = sorted(root.glob("*/member-ticket-history-normalized-*.csv"), key=lambda p: p.stat().st_mtime)
print(json.dumps(str(files[-1]) if files else ""))
`;
  const result = spawnSync(config.python, ["-c", script], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Ticket history lookup failed: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout || "\"\"");
}

function buildIndexes(input) {
  const profileById = new Map(input.profiles.map((item) => [item.id, { id: item.id, ...item.data }]));
  const profileByPhoneName = new Map(
    [...profileById.values()]
      .map((profile) => [`${normalizePhone(profile.phone || "")}|${normalizeName(profile.name || "")}`, profile])
      .filter(([key]) => key !== "|"),
  );
  const bookingsByMember = groupByDocs(input.bookings, (doc) => doc.data.memberId);
  const memosByMember = groupByDocs(input.memos, (doc) => doc.data.memberId);
  const tagsByMember = new Map(input.tags.map((doc) => [doc.data.memberId || doc.id, { id: doc.id, ...doc.data }]));
  const candidatesByMember = groupByDocs(input.alimtalkCandidates, (doc) => doc.data.memberId);
  const sendsByMember = groupByDocs(input.alimtalkSends, (doc) => doc.data.memberId);
  const purchaseMatchStats = { matchedByMemberId: 0, matchedByPhoneName: 0, unmatched: 0 };
  const purchaseIssues = [];
  const purchasesByMember = new Map();

  for (const purchase of input.ticketPurchases) {
    if (purchase.memberId) {
      pushMap(purchasesByMember, purchase.memberId, { ...purchase, matchType: "studiomate_member_id" });
      purchaseMatchStats.matchedByMemberId += 1;
    } else {
      const profile = profileByPhoneName.get(`${purchase.memberPhone}|${purchase.normalizedName}`);
      if (profile) {
        const memberId = profile.memberId || profile.id;
        pushMap(purchasesByMember, memberId, { ...purchase, memberId, matchType: "phone_name_profile" });
        purchaseMatchStats.matchedByPhoneName += 1;
      } else {
        purchaseMatchStats.unmatched += 1;
        addSample(purchaseIssues, { type: "unmatched_purchase", memberName: purchase.memberName, memberPhone: purchase.memberPhone, paymentDate: purchase.paymentDate, ticketName: purchase.ticketName });
      }
    }
  }

  const existingPurchaseKeys = new Set();
  for (const [memberId, purchases] of purchasesByMember.entries()) {
    for (const purchase of purchases) existingPurchaseKeys.add(canonicalPurchaseKey(memberId, purchase));
  }
  for (const profile of profileById.values()) {
    const memberId = cleanString(profile.memberId || profile.id);
    if (!memberId) continue;
    for (const purchase of profileActiveTicketPurchases(profile)) {
      const key = canonicalPurchaseKey(memberId, purchase);
      if (existingPurchaseKeys.has(key)) continue;
      existingPurchaseKeys.add(key);
      pushMap(purchasesByMember, memberId, { ...purchase, matchType: "member_profile_active_ticket" });
      purchaseMatchStats.matchedByMemberId += 1;
    }
  }

  return {
    profileById,
    bookingsByMember,
    memosByMember,
    tagsByMember,
    candidatesByMember,
    sendsByMember,
    purchasesByMember,
    purchaseMatchStats,
    purchaseIssues,
  };
}

function profileActiveTicketPurchases(profile) {
  const memberId = cleanString(profile.memberId || profile.id);
  return (profile.activeTickets || [])
    .map((ticket, index) => {
      const amountTotal = money(ticket.paymentAmount ?? ticket.amountTotal ?? ticket.price ?? "");
      const paymentDate = dateKeyFromAny(ticket.paymentAt || ticket.paymentDate || ticket.purchasedAt);
      if (!amountTotal && !paymentDate) return null;
      const ticketName = cleanString(ticket.ticketName || ticket.name || "");
      const startDate = dateKeyFromAny(ticket.availableFrom || ticket.startDate || ticket.issuedAt);
      const endDate = dateKeyFromAny(ticket.expiresAt || ticket.endDate || ticket.expireAt);
      const purchaseId =
        cleanString(ticket.purchaseId) ||
        `profile_active_ticket_${hash([memberId, ticketName, paymentDate, amountTotal, startDate, endDate, index].join("|")).slice(0, 20)}`;
      return {
        purchaseId,
        memberId,
        memberPhone: normalizePhone(profile.phone || ""),
        sourcePath: `memberProfiles/${memberId}.activeTickets`,
        sourceMonth: monthKey(paymentDate || startDate),
        paymentDate,
        category: cleanString(ticket.paymentType || "현재 수강권"),
        classType: classTypeName(ticket.classType || ticket.lessonType || ""),
        memberName: cleanString(profile.name || ""),
        normalizedName: normalizeName(profile.name || ""),
        ticketName,
        amountTotal,
        paymentMethod: cleanString(ticket.paymentMethod || ""),
        startDate,
        endDate,
        issuedAt: dateKeyFromAny(ticket.issuedAt),
        maxCount: numberValue(ticket.maxCount ?? ticket.totalCount ?? ticket.usableCount ?? ""),
        remainingCount: numberValue(ticket.remainingCount ?? ticket.remaining ?? ""),
        usableCount: numberValue(ticket.usableCount ?? ""),
        cancelableCount: numberValue(ticket.cancelableCount ?? ""),
        ticketStatus: cleanString(ticket.status || ticket.ticketStatus || ""),
        isActiveTicket: true,
        isFamilyTicket: cleanString(ticket.isFamilyTicket || ""),
        usageTotal: 0,
        usageAttended: 0,
        usageAbsent: 0,
        usageCancel: 0,
        usageWait: 0,
        usageReservedUnchecked: 0,
      };
    })
    .filter(Boolean);
}

function canonicalPurchaseKey(memberId, purchase) {
  return [
    cleanString(memberId || purchase.memberId),
    cleanString(purchase.ticketName),
    cleanString(purchase.paymentDate),
    Number(purchase.amountTotal || 0),
    cleanString(purchase.startDate),
    cleanString(purchase.endDate),
  ].join("|");
}

function buildMemberPlans(indexes) {
  const memberIds = new Set([
    ...[...indexes.profileById.values()].filter((profile) => profile.studioId === config.studioId).map((profile) => profile.memberId || profile.id),
    ...indexes.bookingsByMember.keys(),
    ...indexes.memosByMember.keys(),
    ...indexes.purchasesByMember.keys(),
    ...indexes.tagsByMember.keys(),
    ...indexes.candidatesByMember.keys(),
    ...indexes.sendsByMember.keys(),
  ]);
  return [...memberIds]
    .filter(Boolean)
    .sort()
    .map((id) => {
      const memberId = String(id);
      const fallbackProfile = fallbackProfileFromSources(memberId, indexes);
      const profileDoc = indexes.profileById.get(memberId) || fallbackProfile;
      const bookings = sortByDate(indexes.bookingsByMember.get(memberId) || [], (row) => row.data.lectureDate, (row) => timestampMillis(row.data.lectureStartAt));
      const memos = sortByDate(indexes.memosByMember.get(memberId) || [], (row) => dateFromTimestamp(row.data.createdAt) || row.data.lectureDate, (row) => timestampMillis(row.data.createdAt));
      const purchases = sortByDate(indexes.purchasesByMember.get(memberId) || [], (row) => row.paymentDate, () => 0);
      const alimtalkCandidates = sortByDate(indexes.candidatesByMember.get(memberId) || [], (row) => row.data.sourceDate, (row) => timestampMillis(row.data.updatedAt));
      const alimtalkSends = sortByDate(indexes.sendsByMember.get(memberId) || [], (row) => dateFromTimestamp(row.data.updatedAt), (row) => timestampMillis(row.data.updatedAt));
      const tags = indexes.tagsByMember.get(memberId)?.tags || [];
      const memberDoc = buildMemberDoc({ profile: profileDoc, bookings, purchases, tags });
      const summaryDoc = buildSummaryDoc({ memberDoc, profile: profileDoc, bookings, memos, purchases, tags, alimtalkCandidates, alimtalkSends });
      const cardDoc = buildCardDoc({ memberDoc, summaryDoc });
      return {
        memberId,
        memberDoc,
        summaryDoc,
        cardDoc,
        ticketDocs: buildTicketDocs(profileDoc),
        purchaseDocs: purchases.map((purchase) => buildPurchaseDoc(purchase)),
        bookingDocs: bookings.map((booking) => buildBookingMirrorDoc(booking)),
        memoDocs: memos.map((memo) => buildMemoMirrorDoc(memo)),
        alimtalkLogDocs: buildAlimtalkLogDocs(alimtalkCandidates, alimtalkSends),
        tagDocs: tags.map((tag) => buildTagMirrorDoc(tag)),
      };
    });
}

function fallbackProfileFromSources(memberId, indexes) {
  const purchase = (indexes.purchasesByMember.get(memberId) || [])[0];
  const booking = (indexes.bookingsByMember.get(memberId) || [])[0]?.data;
  const memo = (indexes.memosByMember.get(memberId) || [])[0]?.data;
  const candidate = (indexes.candidatesByMember.get(memberId) || [])[0]?.data;
  const send = (indexes.sendsByMember.get(memberId) || [])[0]?.data;
  const source = purchase || booking || memo || candidate || send || {};
  const name = source.memberName || source.name || "";
  const phone = source.memberPhone || source.phone || "";
  return {
    id: memberId,
    memberId,
    studioId: source.studioId || config.studioId,
    name,
    normalizedName: normalizeName(name),
    phone,
    phoneLast4: last4(phone),
    registeredAt: booking?.memberRegisteredAt || null,
    activeTickets: [],
    activeTicketCount: 0,
    source: "member360_fallback",
    syncedAt: admin.firestore.Timestamp.now(),
    updatedAt: admin.firestore.Timestamp.now(),
  };
}

function buildMemberDoc({ profile, bookings, purchases, tags }) {
  const recentVisitAt = latestAttendedBooking(bookings)?.data.lectureStartAt || latestBooking(bookings)?.data.lectureStartAt || null;
  return compactObject({
    memberId: profile.memberId || profile.id,
    studioId: profile.studioId,
    name: profile.name || "",
    normalizedName: profile.normalizedName || normalizeName(profile.name || ""),
    phone: normalizePhone(profile.phone || ""),
    phoneLast4: profile.phoneLast4 || last4(profile.phone || ""),
    registeredAt: profile.registeredAt || null,
    status: memberStatus(profile),
    currentTicketsSummary: summarizeActiveTickets(profile.activeTickets || []),
    recentVisitAt,
    activeTicketCount: Number(profile.activeTicketCount || (profile.activeTickets || []).length || 0),
    totalRevenue: sum(purchases.map((row) => row.amountTotal)),
    purchaseCount: purchases.length,
    bookingCount: bookings.length,
    attendedCount: bookings.filter((row) => row.data.attendanceStatus === "attended").length,
    absentCount: bookings.filter((row) => row.data.attendanceStatus === "absent").length,
    tagLabels: tags.map((tag) => tag.label).filter(Boolean).slice(0, 20),
    sourceCollections: ["memberProfiles", "bookings", "memberMemos", "memberTags", "alimtalkCandidates", "alimtalkSends", "member-ticket-history-normalized"],
    sourceProfileUpdatedAt: profile.updatedAt || null,
    rebuiltAt: admin.firestore.Timestamp.now(),
    updatedAt: admin.firestore.Timestamp.now(),
  });
}

function buildSummaryDoc({ memberDoc, profile, bookings, memos, purchases, tags, alimtalkCandidates, alimtalkSends }) {
  const recentBookings = [...bookings].slice(-10).reverse().map((row) => bookingSummary(row.data));
  const recentPurchases = [...purchases].slice(-10).reverse().map(purchaseSummary);
  const recentMemos = [...memos].slice(-5).reverse().map((row) => memoSummary(row.data));
  const recentAlimtalk = [...alimtalkSends].slice(-10).reverse().map((row) => alimtalkSendSummary(row.data));
  const pendingAlimtalk = alimtalkCandidates.filter((row) => ["candidate", "reviewed", "queued", "processing", "failed"].includes(String(row.data.status || ""))).length;
  return compactObject({
    memberId: memberDoc.memberId,
    studioId: memberDoc.studioId,
    name: memberDoc.name,
    phoneLast4: memberDoc.phoneLast4,
    status: memberDoc.status,
    registeredAt: profile.registeredAt || null,
    currentTicketsSummary: memberDoc.currentTicketsSummary,
    recentVisitAt: memberDoc.recentVisitAt || null,
    totalRevenue: memberDoc.totalRevenue,
    purchaseCount: purchases.length,
    bookingCount: bookings.length,
    attendedCount: memberDoc.attendedCount,
    absentCount: memberDoc.absentCount,
    recentPurchases,
    recentBookings,
    recentMemos,
    recentAlimtalk,
    tags: tags.slice(0, 20),
    signals: buildSignals({ memberDoc, bookings, purchases, memos, pendingAlimtalk }),
    sourcePaths: {
      profile: `memberProfiles/${memberDoc.memberId}`,
      bookings: "bookings where memberId",
      memos: "memberMemos where memberId",
      purchases: "member-ticket-history-normalized CSV generated from StudioMate member Excel plus member usage history",
      alimtalk: "alimtalkCandidates/alimtalkSends where memberId",
    },
    rebuiltAt: admin.firestore.Timestamp.now(),
    updatedAt: admin.firestore.Timestamp.now(),
  });
}

function buildCardDoc({ memberDoc, summaryDoc }) {
  return compactObject({
    ...memberDoc,
    summaryPath: `members/${memberDoc.memberId}/summary/current`,
    recentPurchases: summaryDoc.recentPurchases.slice(0, 3),
    recentBookings: summaryDoc.recentBookings.slice(0, 5),
    recentMemos: summaryDoc.recentMemos.slice(0, 3),
    signals: summaryDoc.signals,
  });
}

function buildTicketDocs(profile) {
  return (profile.activeTickets || []).map((ticket, index) => ({
    id: ticket.userTicketId || ticket.ticketId || `active_${hash([profile.memberId || profile.id, ticket.name, index].join("|")).slice(0, 16)}`,
    data: compactObject({
      memberId: profile.memberId || profile.id,
      studioId: profile.studioId,
      source: "memberProfiles.activeTickets",
      sourcePath: `memberProfiles/${profile.memberId || profile.id}`,
      ...ticket,
      updatedAt: admin.firestore.Timestamp.now(),
    }),
  }));
}

function buildPurchaseDoc(purchase) {
  return {
    id: purchase.purchaseId,
    data: compactObject({
      ...purchase,
      source: "studiomate_member_ticket_history",
      updatedAt: admin.firestore.Timestamp.now(),
    }),
  };
}

function buildBookingMirrorDoc(row) {
  const booking = row.data;
  return {
    id: row.id,
    data: compactObject({
      ...bookingSummary(booking),
      memberId: booking.memberId,
      memberName: booking.memberName || "",
      memberPhone: normalizePhone(booking.memberPhone || ""),
      sourcePath: `bookings/${row.id}`,
      sourceUpdatedAt: booking.updatedAt || null,
      mirroredAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
    }),
  };
}

function buildMemoMirrorDoc(row) {
  const memo = row.data;
  return {
    id: row.id,
    data: compactObject({
      ...memoSummary(memo),
      memberId: memo.memberId,
      memberName: memo.memberName || "",
      sourcePath: `memberMemos/${row.id}`,
      sourceUpdatedAt: memo.updatedAt || null,
      mirroredAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
    }),
  };
}

function buildAlimtalkLogDocs(candidates, sends) {
  const logs = [
    ...candidates.map((row) => ({
      id: `candidate_${row.id}`,
      data: compactObject({
        sourceType: "candidate",
        sourcePath: `alimtalkCandidates/${row.id}`,
        candidateId: row.id,
        memberId: row.data.memberId,
        type: row.data.type || "",
        templateCode: row.data.templateCode || "",
        status: row.data.status || "",
        reason: row.data.reason || "",
        sourceDate: row.data.sourceDate || "",
        updatedAt: row.data.updatedAt || admin.firestore.Timestamp.now(),
      }),
    })),
    ...sends.map((row) => ({
      id: `send_${row.id}`,
      data: compactObject({
        sourceType: "send",
        sourcePath: `alimtalkSends/${row.id}`,
        sendId: row.id,
        candidateId: row.data.candidateId || "",
        memberId: row.data.memberId,
        templateCode: row.data.templateCode || "",
        status: row.data.status || "",
        dedupeKey: row.data.dedupeKey || "",
        solapiMessageId: row.data.solapiMessageId || "",
        updatedAt: row.data.updatedAt || admin.firestore.Timestamp.now(),
      }),
    })),
  ];
  return logs;
}

function buildTagMirrorDoc(tag) {
  return {
    id: tag.tagId || hash(JSON.stringify(tag)).slice(0, 16),
    data: compactObject({
      ...tag,
      updatedAt: tag.updatedAt || admin.firestore.Timestamp.now(),
    }),
  };
}

function buildWritePlan(plans) {
  const writes = [];
  for (const plan of plans) {
    const memberRef = db.collection("members").doc(plan.memberId);
    writes.push({ ref: memberRef, data: plan.memberDoc, merge: true });
    writes.push({ ref: memberRef.collection("summary").doc("current"), data: plan.summaryDoc, merge: true });
    writes.push({ ref: db.collection("member360Cards").doc(plan.memberId), data: plan.cardDoc, merge: true });
    plan.ticketDocs.forEach((doc) => writes.push({ ref: memberRef.collection("tickets").doc(docId(doc.id)), data: doc.data, merge: true }));
    plan.purchaseDocs.forEach((doc) => writes.push({ ref: memberRef.collection("purchases").doc(docId(doc.id)), data: doc.data, merge: true }));
    plan.bookingDocs.forEach((doc) => writes.push({ ref: memberRef.collection("bookings").doc(docId(doc.id)), data: doc.data, merge: true }));
    plan.memoDocs.forEach((doc) => writes.push({ ref: memberRef.collection("memos").doc(docId(doc.id)), data: doc.data, merge: true }));
    plan.alimtalkLogDocs.forEach((doc) => writes.push({ ref: memberRef.collection("alimtalkLogs").doc(docId(doc.id)), data: doc.data, merge: true }));
    plan.tagDocs.forEach((doc) => writes.push({ ref: memberRef.collection("tags").doc(docId(doc.id)), data: doc.data, merge: true }));
  }
  return writes;
}

async function applyWritePlan(writes) {
  for (let i = 0; i < writes.length; i += 450) {
    const batch = db.batch();
    writes.slice(i, i + 450).forEach((write) => batch.set(write.ref, write.data, { merge: write.merge !== false }));
    await batch.commit();
  }
}

function buildReport(input) {
  const perMember = input.plans.map((plan) => ({
    memberId: plan.memberId,
    name: plan.memberDoc.name,
    purchases: plan.purchaseDocs.length,
    bookings: plan.bookingDocs.length,
    memos: plan.memoDocs.length,
    alimtalkLogs: plan.alimtalkLogDocs.length,
    tags: plan.tagDocs.length,
    totalRevenue: plan.memberDoc.totalRevenue,
  }));
  return {
    ok: true,
    mode: config.apply ? "apply" : "dry-run",
    projectId: PROJECT_ID,
    studioId: config.studioId,
    source: {
      profiles: input.profiles.length,
      bookings: input.bookings.length,
      memos: input.memos.length,
      tags: input.tags.length,
      alimtalkCandidates: input.alimtalkCandidates.length,
      alimtalkSends: input.alimtalkSends.length,
      ticketPurchases: input.ticketPurchases.length,
    },
    matching: {
      ticketPurchases: input.indexes.purchaseMatchStats,
      issueSamples: input.indexes.purchaseIssues.slice(0, config.sampleLimit),
    },
    output: {
      members: input.plans.length,
      plannedWrites: input.writePlan.length,
      maxWrites: config.maxWrites,
      collections: [
        "members/{memberId}",
        "members/{memberId}/summary/current",
        "members/{memberId}/tickets/{ticketId}",
        "members/{memberId}/purchases/{purchaseId}",
        "members/{memberId}/bookings/{bookingId}",
        "members/{memberId}/memos/{memoId}",
        "members/{memberId}/alimtalkLogs/{logId}",
        "members/{memberId}/tags/{tagId}",
        "member360Cards/{memberId}",
      ],
    },
    topMembersByRevenue: perMember.sort((a, b) => b.totalRevenue - a.totalRevenue).slice(0, config.sampleLimit),
    memberSamples: perMember.slice(0, config.sampleLimit),
    warnings: [
      "기존 기능별 컬렉션은 source of truth로 유지하고 members/member360Cards는 조회·분석용 미러로만 생성합니다.",
      "수강권 구매이력은 StudioMate 회원목록 엑셀과 회원별 이용내역에서 생성한 member-ticket-history-normalized CSV를 우선 사용합니다.",
      "memberProfiles가 없는 StudioMate numeric memberId도 members/{memberId} 미러를 생성하되, profile source는 fallback으로 표시됩니다.",
    ],
    generatedAt: new Date().toISOString(),
    appliedAt: "",
  };
}

function writeReport(report) {
  mkdirSync(REPORT_DIR, { recursive: true });
  const file = `${new Date().toISOString().replace(/[:.]/g, "-")}-member-360-${config.apply ? "apply" : "dry-run"}.json`;
  const reportPath = path.join(REPORT_DIR, file);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return reportPath;
}

function summarizeActiveTickets(tickets) {
  return tickets.map((ticket) => compactObject({
    ticketId: ticket.userTicketId || ticket.ticketId || "",
    name: ticket.name || "",
    remainingCount: ticket.remainingCount ?? null,
    usableCount: ticket.usableCount ?? null,
    maxCount: ticket.maxCount ?? null,
    availableFrom: ticket.availableFrom || null,
    expiresAt: ticket.expiresAt || null,
    expiryLevel: ticket.expiryLevel || "unknown",
    status: ticket.status || "",
    classType: ticket.classType || "",
  })).slice(0, 20);
}

function buildSignals({ memberDoc, bookings, purchases, memos, pendingAlimtalk }) {
  const signals = [];
  const lastBookingDate = dateFromTimestamp(memberDoc.recentVisitAt);
  const activeTickets = memberDoc.currentTicketsSummary || [];
  if (activeTickets.length && lastBookingDate && daysBetween(lastBookingDate, todayKey()) >= 14) {
    signals.push({ type: "absence_with_active_ticket", level: "warning", label: "수강권 보유 후 14일 이상 방문 없음" });
  }
  if (activeTickets.some((ticket) => Number(ticket.remainingCount) > 0 && Number(ticket.remainingCount) <= 3)) {
    signals.push({ type: "remaining_low", level: "warning", label: "잔여횟수 부족" });
  }
  if (!purchases.length && memberDoc.status === "new") {
    signals.push({ type: "new_without_purchase_match", level: "info", label: "신규/상담 회원 구매이력 매칭 없음" });
  }
  if (bookings.filter((row) => row.data.attendanceStatus === "absent").length >= 3) {
    signals.push({ type: "absence_count_high", level: "warning", label: "결석 누적 확인 필요" });
  }
  if (memos.length) signals.push({ type: "has_recent_memo", level: "info", label: "회원 메모 있음" });
  if (pendingAlimtalk) signals.push({ type: "alimtalk_pending", level: "info", label: `알림톡 대기/검토 ${pendingAlimtalk}건` });
  return signals.slice(0, 10);
}

function bookingSummary(booking) {
  return compactObject({
    bookingId: booking.bookingId || "",
    lectureId: booking.lectureId || "",
    lectureDate: booking.lectureDate || "",
    lectureStartAt: booking.lectureStartAt || null,
    lectureEndAt: booking.lectureEndAt || null,
    staffId: booking.staffId || "",
    staffName: booking.staffName || "",
    lessonType: booking.lessonType || "",
    appStatus: booking.appStatus || "",
    attendanceStatus: booking.attendanceStatus || "",
    ticketName: booking.ticketName || "",
    ticketRemainingCount: booking.ticketRemainingCount ?? null,
    ticketExpiresAt: booking.ticketExpiresAt || null,
  });
}

function memoSummary(memo) {
  return compactObject({
    memoId: memo.memoId || "",
    lectureId: memo.lectureId || "",
    bookingId: memo.bookingId || "",
    lectureDate: memo.lectureDate || "",
    staffId: memo.staffId || "",
    staffName: memo.staffName || "",
    memoType: memo.memoType || "",
    visibility: memo.visibility || "",
    contentPreview: cleanString(memo.content).slice(0, 240),
    syncStatus: memo.syncStatus || "",
    createdAt: memo.createdAt || null,
    updatedAt: memo.updatedAt || null,
  });
}

function purchaseSummary(purchase) {
  return compactObject({
    purchaseId: purchase.purchaseId,
    paymentDate: purchase.paymentDate,
    sourceMonth: purchase.sourceMonth,
    classType: purchase.classType,
    ticketName: purchase.ticketName,
    amountTotal: purchase.amountTotal,
    paymentMethod: purchase.paymentMethod,
    assignedStaffName: purchase.assignedStaffName,
  });
}

function alimtalkSendSummary(send) {
  return compactObject({
    sendId: send.sendId || "",
    candidateId: send.candidateId || "",
    templateCode: send.templateCode || "",
    status: send.status || "",
    dedupeKey: send.dedupeKey || "",
    updatedAt: send.updatedAt || null,
  });
}

function memberStatus(profile) {
  if (profile.isNewMember) return "new";
  if ((profile.activeTickets || []).length) return "active";
  return "unknown";
}

function latestAttendedBooking(bookings) {
  return [...bookings].reverse().find((row) => row.data.attendanceStatus === "attended") || null;
}

function latestBooking(bookings) {
  return bookings.length ? bookings[bookings.length - 1] : null;
}

function groupByDocs(items, keyFn) {
  const map = new Map();
  items.forEach((item) => {
    const key = cleanString(keyFn(item));
    if (!key) return;
    pushMap(map, key, item);
  });
  return map;
}

function groupBy(items, keyFn) {
  const map = new Map();
  items.forEach((item) => {
    const key = cleanString(keyFn(item));
    if (!key) return;
    pushMap(map, key, item);
  });
  return map;
}

function pushMap(map, key, value) {
  const list = map.get(key) || [];
  list.push(value);
  map.set(key, list);
}

function addSample(list, value) {
  if (list.length < config.sampleLimit) list.push(value);
}

function sortByDate(items, dateFn, timeFn) {
  return [...items].sort((a, b) => {
    const dateCompare = cleanString(dateFn(a)).localeCompare(cleanString(dateFn(b)));
    if (dateCompare) return dateCompare;
    return Number(timeFn(a) || 0) - Number(timeFn(b) || 0);
  });
}

function compactObject(input) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function sum(values) {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function docId(value) {
  const text = cleanString(value).replaceAll("/", "_");
  return text || `generated_${hash(JSON.stringify(value)).slice(0, 16)}`;
}

function normalizeName(value) {
  return cleanString(value).replace(/\s+/g, "").toLowerCase();
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function last4(value) {
  const phone = normalizePhone(value);
  return phone ? phone.slice(-4) : "";
}

function cleanString(value) {
  return String(value ?? "").trim();
}

function money(value) {
  return Number(cleanString(value).replace(/[^\d.-]/g, "")) || 0;
}

function numberValue(value) {
  return Number(cleanString(value).replace(/[^\d.-]/g, "")) || 0;
}

function boolValue(value) {
  return ["true", "1", "y", "yes", "예", "사용"].includes(cleanString(value).toLowerCase());
}

function classTypeName(value) {
  const text = cleanString(value);
  if (text.includes("개인") || text.includes("프라이빗") || /private/i.test(text)) return "프라이빗";
  if (text.includes("그룹") || /group/i.test(text)) return "그룹";
  if (text.includes("듀엣") || text.includes("세미")) return "세미프라이빗";
  return text;
}

function dateKey(value) {
  const text = cleanString(value);
  if (!text) return "";
  const matched = text.match(/(20\d{2})[-./년 ]\s*(\d{1,2})[-./월 ]\s*(\d{1,2})/);
  if (matched) return `${matched[1]}-${matched[2].padStart(2, "0")}-${matched[3].padStart(2, "0")}`;
  return text.slice(0, 10);
}

function dateKeyFromAny(value) {
  return dateFromTimestamp(value) || dateKey(value);
}

function monthKey(date) {
  return cleanString(date).slice(0, 7);
}

function todayKey() {
  const formatter = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" });
  return formatter.format(new Date());
}

function dateFromTimestamp(value) {
  const date = value?.toDate?.();
  if (!date) return "";
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function timestampMillis(value) {
  return Number(value?.toMillis?.() || 0);
}

function daysBetween(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00+09:00`).getTime();
  const end = new Date(`${endDate}T00:00:00+09:00`).getTime();
  return Math.floor((end - start) / 86400000);
}

function expandHome(value) {
  return value.startsWith("~/") ? path.join(HOME, value.slice(2)) : value;
}

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq >= 0) {
      out[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else {
      const key = arg.slice(2);
      const next = argv[index + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        index += 1;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}
