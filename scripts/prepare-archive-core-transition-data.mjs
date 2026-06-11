#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { recordAutomationStatus, recordDataQualityIssues, recordSourceImport, stableHash } from "./lib/archive-core-ops-logging.mjs";

const require = createRequire(import.meta.url);
const admin = require("../firebase/kangsain-functions/functions/node_modules/firebase-admin");

const HOME = os.homedir();
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "archive-pilates";
const STUDIO_ID = process.env.STUDIOMATE_STUDIO_ID || process.env.MANAGER_STUDIO_ID || "5330";
const DEFAULT_CREDENTIALS = path.join(HOME, "ArchiveIN/secrets/google/archive-codex-operator.json");
const DEFAULT_USAGE_JSON = path.join(
  HOME,
  "ArchiveIN/emergency/archive/member-usage/2026-05-27/member-usage-normalized-2026-05-27.json",
);
const DEFAULT_TICKET_HISTORY_CSV = path.join(
  HOME,
  "ArchiveIN/emergency/archive/member-usage/2026-05-27/member-ticket-history-normalized-2026-05-27.csv",
);
const DEFAULT_OUT_DIR = path.join(HOME, "ArchiveIN/automation/reports/archive-core-transition");
const DOC_REPORT_DIR = path.resolve("docs/reports");
const DEFAULT_SAMPLE_MEMBER_IDS = ["3045390", "2047962", "1985970", "3030691", "3574953", "4081797"];
const PRIVATE_LEDGER_STATUSES = new Set(["attended", "reserved"]);

const args = parseArgs(process.argv.slice(2));
const config = {
  apply: Boolean(args.apply),
  confirm: Boolean(args["confirm-archive-core-transition"]),
  all: Boolean(args.all),
  writeLimit: numberValue(args["write-limit"] || "20000"),
  studioId: cleanString(args["studio-id"] || STUDIO_ID),
  credentialsPath: expandHome(cleanString(args.credentials || process.env.GOOGLE_APPLICATION_CREDENTIALS || DEFAULT_CREDENTIALS)),
  usageJsonPath: expandHome(cleanString(args["usage-json"] || process.env.ARCHIVE_CORE_USAGE_JSON || DEFAULT_USAGE_JSON)),
  ticketHistoryFile: expandHome(cleanString(args["ticket-history-file"] || process.env.ARCHIVE_CORE_TICKET_HISTORY_FILE || DEFAULT_TICKET_HISTORY_CSV)),
  outDir: expandHome(cleanString(args["out-dir"] || DEFAULT_OUT_DIR)),
  reportDate: cleanString(args.date || kstDate(new Date())),
  startDate: cleanString(args["start-date"] || ""),
  endDate: cleanString(args["end-date"] || ""),
  sampleMembers: parseList(args["sample-members"] || args["member-id"] || args.member || "").map(String),
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
  const runId = `archive_core_transition_${config.reportDate}_${hash(Date.now()).slice(0, 8)}`;
  const sourceImportId = stableHash({
    sourceKind: "studiomate_member_usage_excel",
    sourceFilePath: config.usageJsonPath,
    sourceVersion: config.reportDate,
  }).slice(0, 32);
  const ticketImportId = stableHash({
    sourceKind: "studiomate_member_excel",
    sourceFilePath: config.ticketHistoryFile,
    sourceVersion: config.reportDate,
  }).slice(0, 32);

  const rawUsageRows = JSON.parse(readFileSync(config.usageJsonPath, "utf8"));
  const rawTicketRows = parseCsv(readFileSync(config.ticketHistoryFile, "utf8")).map(normalizeTicketRow);
  const sourceSnapshot = sourceSnapshotFromPath(config.usageJsonPath);
  const selectedMemberIds = selectedMembers(rawUsageRows, rawTicketRows);
  const usageRows = filterRows(rawUsageRows, selectedMemberIds).map(normalizeUsageRow).filter((row) => row.memberId && row.lectureDate && row.startTime);
  const ticketRows = rawTicketRows.filter((row) => selectedMemberIds.has(row.memberId));
  const usagePlan = buildUsagePlan(usageRows, sourceImportId);
  const ticketPlan = buildTicketPlan(ticketRows, ticketImportId);
  const lessonPlan = buildLessonAndReservationPlan(usagePlan.events, sourceImportId);
  const ledgerPlan = buildPrivateLedgerPlan(usagePlan.events, ticketPlan.ticketsByMember, sourceImportId, sourceSnapshot);
  const existingBookings = await loadExistingBookings(selectedMemberIds);
  const shadow = compareWithExistingBookings(usagePlan.events, existingBookings);
  const quality = buildQualitySummary({
    selectedMemberIds,
    rawUsageRows,
    usageRows,
    usagePlan,
    shadow,
    sourceSnapshot,
  });
  const writePlan = [
    ...usagePlan.writes,
    ...ticketPlan.writes,
    ...lessonPlan.writes,
    ...ledgerPlan.writes,
  ];
  const summary = {
    ok: true,
    mode: config.apply ? "apply" : "dry-run",
    runId,
    studioId: config.studioId,
    generatedAt: new Date().toISOString(),
    sourceFiles: {
      usageJsonPath: config.usageJsonPath,
      ticketHistoryFile: config.ticketHistoryFile,
    },
    sourceSnapshot,
    sourceImportIds: {
      usage: sourceImportId,
      tickets: ticketImportId,
    },
    selection: {
      all: config.all,
      selectedMemberIds: [...selectedMemberIds].sort(),
      selectedMemberCount: selectedMemberIds.size,
      dateRange: dateRangeFromRows(usageRows),
    },
    raw: {
      usageRows: rawUsageRows.length,
      ticketRows: rawTicketRows.length,
    },
    normalized: {
      selectedUsageRows: usageRows.length,
      selectedTicketRows: ticketRows.length,
      usageEvents: usagePlan.events.length,
      duplicateUsageRows: usagePlan.duplicateRows,
      memberTickets: ticketPlan.tickets.length,
      memberPaymentEvents: ticketPlan.paymentEvents.length,
      lessonOccurrences: lessonPlan.lessonOccurrences.length,
      reservations: lessonPlan.reservations.length,
      privateLedgerEntries: ledgerPlan.ledgerEntries.length,
      byUsageStatus: countBy(usagePlan.events, "usageStatus"),
      byLessonType: countBy(usagePlan.events, "lessonType"),
    },
    firestoreRead: {
      existingBookings: existingBookings.length,
    },
    shadow,
    quality,
    writePlan: {
      writes: writePlan.length,
      byCollection: countBy(writePlan, "collection"),
    },
    guardrails: [
      "This script writes only ARCHIVE CORE collections when --apply is used.",
      "It does not write bookings, lectures, alimtalkCandidates, contactSyncJobs, StudioMate, or Google Contacts.",
      "External sends and writes must continue using existing canonical sources until operator-approved shadow compare.",
    ],
  };

  if (config.apply) {
    if (!config.confirm) {
      throw new Error("Apply requires --confirm-archive-core-transition.");
    }
    if (!config.all && selectedMemberIds.size === 0) {
      throw new Error("Apply requires selected members or --all.");
    }
    if (writePlan.length > config.writeLimit) {
      throw new Error(`Planned writes ${writePlan.length} exceed --write-limit=${config.writeLimit}.`);
    }
    await applyWritePlan(writePlan);
    const usageImport = await recordSourceImport(db, {
      importId: sourceImportId,
      studioId: config.studioId,
      sourceKind: "studiomate_member_usage_excel",
      sourceFilePath: config.usageJsonPath,
      mode: "apply",
      status: "applied",
      rowCount: rawUsageRows.length,
      normalizedRows: usagePlan.events.length,
      appliedRows: usagePlan.events.length,
      duplicateRows: usagePlan.duplicateRows,
      sourceVersion: config.reportDate,
      notes: ["ARCHIVE CORE 전용 이용 이벤트 장부 적용. 기존 bookings는 변경하지 않음."],
    });
    const ticketImport = await recordSourceImport(db, {
      importId: ticketImportId,
      studioId: config.studioId,
      sourceKind: "studiomate_member_excel",
      sourceFilePath: config.ticketHistoryFile,
      mode: "apply",
      status: "applied",
      rowCount: rawTicketRows.length,
      normalizedRows: ticketPlan.tickets.length,
      appliedRows: ticketPlan.tickets.length + ticketPlan.paymentEvents.length,
      sourceVersion: config.reportDate,
      notes: ["ARCHIVE CORE 전용 수강권/결제 장부 적용. 정산 원본은 검증용으로만 유지."],
    });
    const issueWrites = await recordDataQualityIssues(db, quality.issuesForFirestore);
    await recordAutomationStatus(db, {
      automationId: "archive-core-transition-ledger",
      title: "ARCHIVE CORE 이용내역 장부 전환",
      ownerArea: "core",
      status: quality.blockingIssueCount || quality.warnings.length ? "warning" : "healthy",
      lastRunAt: summary.generatedAt,
      lastResult: `${usagePlan.events.length.toLocaleString("ko-KR")} usageEvents / ${ledgerPlan.ledgerEntries.length.toLocaleString("ko-KR")} private ledger`,
      sourceImportIds: [usageImport.importId, ticketImport.importId],
      runId,
      warnings: quality.warnings,
    });
    summary.applied = {
      appliedAt: new Date().toISOString(),
      writes: writePlan.length,
      sourceImportIds: [usageImport.importId, ticketImport.importId],
      dataQualityIssueWrites: issueWrites,
    };
  }

  const outputs = writeReports(summary);
  console.log(JSON.stringify({ ...summary, outputs }, null, 2));
}

function validateConfig() {
  if (!existsSync(config.usageJsonPath)) throw new Error(`Usage JSON not found: ${config.usageJsonPath}`);
  if (!existsSync(config.ticketHistoryFile)) throw new Error(`Ticket history CSV not found: ${config.ticketHistoryFile}`);
  if (config.apply && !existsSync(config.credentialsPath)) throw new Error(`Google credentials not found: ${config.credentialsPath}`);
  if (config.apply && config.all && !args["allow-full-apply"]) {
    throw new Error("Full apply requires --all --allow-full-apply --confirm-archive-core-transition.");
  }
}

function selectedMembers(usageRows, ticketRows) {
  const explicit = config.all ? [] : config.sampleMembers.length ? config.sampleMembers : DEFAULT_SAMPLE_MEMBER_IDS;
  const ids = new Set(explicit.map(String).filter(Boolean));
  if (!config.all) return ids;
  for (const row of usageRows) if (row.memberId) ids.add(String(row.memberId));
  for (const row of ticketRows) if (row.memberId) ids.add(String(row.memberId));
  return ids;
}

function filterRows(rows, selectedMemberIds) {
  return rows.filter((row) => {
    if (selectedMemberIds.size && !selectedMemberIds.has(String(row.memberId || ""))) return false;
    if (config.startDate && cleanString(row.lectureDate) < config.startDate) return false;
    if (config.endDate && cleanString(row.lectureDate) > config.endDate) return false;
    return true;
  });
}

function normalizeUsageRow(row) {
  const lectureDate = dateKey(row.lectureDate);
  const startTime = timeKey(row.startTime);
  const endTime = timeKey(row.endTime);
  const usageStatus = usageStatusFromRow(row);
  const lessonType = lessonTypeFromRow(row);
  const memberId = cleanString(row.memberId);
  const title = cleanString(row.title);
  const staffName = cleanString(row.staffName);
  const canonicalUsageKey = buildCanonicalUsageKey({ memberId, lectureDate, startTime, title, staffName });
  return {
    rowKey: cleanString(row.rowKey) || hash(row).slice(0, 20),
    memberId,
    memberName: cleanString(row.memberName),
    memberPhone: normalizePhone(row.memberPhone),
    memberUrl: cleanString(row.memberUrl),
    lectureDate,
    startTime,
    endTime,
    startsAt: kstDateTime(lectureDate, startTime),
    endsAt: endTime ? kstDateTime(lectureDate, endTime) : "",
    title,
    staffName,
    roomName: cleanString(row.roomName),
    capacity: numberValue(row.capacity),
    ticketName: cleanString(row.ticketName),
    finalStatus: cleanString(row.finalStatus),
    statusChangedAt: cleanString(row.statusChangedAt),
    appStatus: cleanString(row.appStatus),
    attendanceStatus: cleanString(row.attendanceStatus),
    usageStatus,
    lessonType,
    sourceFile: cleanString(row.sourceFile),
    sourceOrigin: cleanString(row.sourceOrigin),
    canonicalUsageKey,
  };
}

function normalizeTicketRow(row) {
  return {
    memberKey: cleanString(row.memberKey),
    memberId: cleanString(row.memberId),
    memberName: cleanString(row.memberName),
    memberPhone: normalizePhone(row.memberPhone),
    ticketName: cleanString(row.ticketName),
    classType: cleanString(row.classType),
    startDate: dateKey(row.startDate),
    endDate: dateKey(row.endDate),
    isFamilyTicket: cleanString(row.isFamilyTicket),
    maxCount: numberValue(row.maxCount),
    remainingCount: numberValue(row.remainingCount),
    usableCount: numberValue(row.usableCount),
    cancelableCount: numberValue(row.cancelableCount),
    issuedAt: dateKey(row.issuedAt),
    ticketUpdatedAtText: cleanString(row.ticketUpdatedAtText),
    ticketStatus: cleanString(row.ticketStatus),
    paymentType: cleanString(row.paymentType),
    paymentAmount: numberValue(row.paymentAmount),
    paymentAt: dateKey(row.paymentAt),
    paymentMethod: cleanString(row.paymentMethod),
    installmentMonths: cleanString(row.installmentMonths),
    usageTotal: numberValue(row.usageTotal),
    usageAttended: numberValue(row.usageAttended),
    usageAbsent: numberValue(row.usageAbsent),
    usageCancel: numberValue(row.usageCancel),
    usageWait: numberValue(row.usageWait),
    usageReservedUnchecked: numberValue(row.usageReservedUnchecked),
    isActiveTicket: boolValue(row.isActiveTicket),
    ticketHistoryId: cleanString(row.ticketHistoryId),
  };
}

function buildUsagePlan(rows, sourceImportId) {
  const byCanonical = new Map();
  const duplicateGroups = new Map();
  let duplicateRows = 0;
  for (const row of rows) {
    const previous = byCanonical.get(row.canonicalUsageKey);
    if (!previous) {
      byCanonical.set(row.canonicalUsageKey, row);
      continue;
    }
    duplicateRows += 1;
    const duplicateGroup = duplicateGroups.get(row.canonicalUsageKey) || [previous];
    duplicateGroup.push(row);
    duplicateGroups.set(row.canonicalUsageKey, duplicateGroup);
    byCanonical.set(row.canonicalUsageKey, betterUsageRow(previous, row));
  }
  const duplicateSummary = summarizeDuplicateUsageGroups(duplicateGroups, duplicateRows);

  const now = new Date().toISOString();
  const events = [...byCanonical.values()]
    .sort((a, b) => `${a.startsAt}|${a.memberName}|${a.title}`.localeCompare(`${b.startsAt}|${b.memberName}|${b.title}`, "ko"))
    .map((row) => {
      const usageEventId = `usage_${hash(row.canonicalUsageKey).slice(0, 24)}`;
      return {
        usageEventId,
        studioId: config.studioId,
        memberId: row.memberId,
        memberName: row.memberName,
        memberPhone: row.memberPhone,
        lessonType: row.lessonType,
        usageStatus: row.usageStatus,
        lessonTitle: row.title,
        staffName: row.staffName,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        ticketName: row.ticketName,
        roomName: row.roomName,
        capacity: row.capacity,
        sourceKind: "studiomate_member_usage_excel",
        sourceImportId,
        sourceRowId: row.rowKey,
        sourceFile: row.sourceFile,
        sourceOrigin: row.sourceOrigin,
        finalStatus: row.finalStatus,
        appStatus: row.appStatus,
        attendanceStatus: row.attendanceStatus,
        canonicalUsageKey: row.canonicalUsageKey,
        quality: {
          confidence: row.memberPhone && row.memberId ? "high" : "medium",
          source: "studiomate_member_usage_excel",
          matchedBy: row.memberId ? "member_id" : row.memberPhone ? "phone_name" : "unknown",
          warnings: [],
        },
        createdAt: now,
        updatedAt: now,
      };
    });

  return {
    events,
    duplicateRows,
    duplicateSummary,
    writes: events.map((event) => ({
      collection: "memberUsageEvents",
      id: event.usageEventId,
      data: event,
    })),
  };
}

function summarizeDuplicateUsageGroups(groups, duplicateRows) {
  const summary = {
    groupCount: groups.size,
    duplicateRows,
    reviewRequired: 0,
    statusConflictGroups: 0,
    statusPatternCounts: {},
    winnerStatusCounts: {},
    affectedMemberCounts: {},
    examples: [],
  };
  for (const [canonicalUsageKey, rows] of groups.entries()) {
    const statuses = [...new Set(rows.map((row) => row.usageStatus || "unknown"))].sort();
    const pattern = statuses.join(" + ") || "unknown";
    const winner = rows.reduce((best, row) => betterUsageRow(best, row));
    if (statuses.length > 1) summary.statusConflictGroups += 1;
    if (!winner.usageStatus || winner.usageStatus === "unknown") summary.reviewRequired += 1;
    addCount(summary.statusPatternCounts, pattern);
    addCount(summary.winnerStatusCounts, winner.usageStatus || "unknown");
    addCount(summary.affectedMemberCounts, winner.memberName || winner.memberId || "unknown");
    if (summary.examples.length < 10) {
      summary.examples.push({
        canonicalUsageKey,
        memberId: winner.memberId,
        memberName: winner.memberName,
        lectureDate: winner.lectureDate,
        startTime: winner.startTime,
        lessonTitle: winner.title,
        staffName: winner.staffName,
        rowCount: rows.length,
        statusPattern: pattern,
        selectedStatus: winner.usageStatus,
        selectedRowKey: winner.rowKey,
      });
    }
  }
  return summary;
}

function buildTicketPlan(rows, sourceImportId) {
  const now = new Date().toISOString();
  const ticketById = new Map();
  const paymentById = new Map();
  const ticketsByMember = new Map();
  for (const row of rows) {
    if (!row.memberId || !row.ticketName) continue;
    const ticketId = row.ticketHistoryId || `ticket_${hash([row.memberId, row.ticketName, row.startDate, row.endDate, row.paymentAt].join("|")).slice(0, 24)}`;
    const paymentEventId = `payment_${hash([ticketId, row.memberId, row.paymentAt, row.paymentAmount, row.paymentMethod].join("|")).slice(0, 24)}`;
    const ticket = {
      ticketId,
      studioId: config.studioId,
      memberId: row.memberId,
      memberName: row.memberName,
      memberPhone: row.memberPhone,
      ticketName: row.ticketName,
      lessonType: lessonTypeFromTicket(row.ticketName, row.classType),
      classType: row.classType,
      startDate: row.startDate,
      endDate: row.endDate,
      isFamilyTicket: row.isFamilyTicket,
      maxCount: row.maxCount,
      remainingCount: row.remainingCount,
      usableCount: row.usableCount,
      cancelableCount: row.cancelableCount,
      issuedAt: row.issuedAt,
      ticketUpdatedAtText: row.ticketUpdatedAtText,
      ticketStatus: row.ticketStatus,
      isActiveTicket: row.isActiveTicket,
      usageTotal: row.usageTotal,
      usageAttended: row.usageAttended,
      usageAbsent: row.usageAbsent,
      usageCancel: row.usageCancel,
      usageWait: row.usageWait,
      usageReservedUnchecked: row.usageReservedUnchecked,
      sourceKind: "studiomate_member_excel",
      sourceImportId,
      sourceRowId: row.ticketHistoryId,
      createdAt: now,
      updatedAt: now,
    };
    const payment = {
      paymentEventId,
      studioId: config.studioId,
      memberId: row.memberId,
      memberName: row.memberName,
      memberPhone: row.memberPhone,
      ticketId,
      ticketName: row.ticketName,
      paymentType: row.paymentType,
      paymentAmount: row.paymentAmount,
      paymentAt: row.paymentAt,
      paymentMethod: row.paymentMethod,
      installmentMonths: row.installmentMonths,
      sourceKind: "studiomate_member_excel",
      sourceImportId,
      sourceRowId: row.ticketHistoryId,
      createdAt: now,
      updatedAt: now,
    };
    ticketById.set(ticketId, ticket);
    if (row.paymentAt || row.paymentAmount) paymentById.set(paymentEventId, payment);
  }
  for (const ticket of ticketById.values()) pushMap(ticketsByMember, ticket.memberId, ticket);
  const tickets = [...ticketById.values()];
  const paymentEvents = [...paymentById.values()];
  return {
    tickets,
    paymentEvents,
    ticketsByMember,
    writes: [
      ...tickets.map((ticket) => ({ collection: "memberTickets", id: ticket.ticketId, data: ticket })),
      ...paymentEvents.map((payment) => ({ collection: "memberPaymentEvents", id: payment.paymentEventId, data: payment })),
    ],
  };
}

function buildLessonAndReservationPlan(events, sourceImportId) {
  const now = new Date().toISOString();
  const lessonByKey = new Map();
  const reservations = [];
  for (const event of events) {
    const lessonKey = [dateFromIso(event.startsAt), timeFromIso(event.startsAt), normalizeText(event.lessonTitle), normalizeText(event.staffName), normalizeText(event.roomName)].join("|");
    const lessonId = `lesson_${hash(lessonKey).slice(0, 24)}`;
    const lesson = lessonByKey.get(lessonId) || {
      lessonOccurrenceId: lessonId,
      studioId: config.studioId,
      lessonType: event.lessonType,
      lessonTitle: event.lessonTitle,
      staffName: event.staffName,
      roomName: event.roomName,
      capacity: event.capacity,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      sourceKind: "studiomate_member_usage_excel",
      sourceImportId,
      sourceUsageEventIds: [],
      reservationCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    lesson.sourceUsageEventIds.push(event.usageEventId);
    lesson.reservationCount += 1;
    lessonByKey.set(lessonId, lesson);
    reservations.push({
      reservationId: `reservation_${hash(event.canonicalUsageKey).slice(0, 24)}`,
      studioId: config.studioId,
      lessonOccurrenceId: lessonId,
      memberId: event.memberId,
      memberName: event.memberName,
      memberPhone: event.memberPhone,
      startsAt: event.startsAt,
      status: event.usageStatus,
      sourceKind: "studiomate_member_usage_excel",
      sourceImportId,
      sourceUsageEventId: event.usageEventId,
      canonicalUsageKey: event.canonicalUsageKey,
      createdAt: now,
      updatedAt: now,
    });
  }
  const lessonOccurrences = [...lessonByKey.values()];
  return {
    lessonOccurrences,
    reservations,
    writes: [
      ...lessonOccurrences.map((lesson) => ({ collection: "lessonOccurrences", id: lesson.lessonOccurrenceId, data: lesson })),
      ...reservations.map((reservation) => ({ collection: "reservations", id: reservation.reservationId, data: reservation })),
    ],
  };
}

function buildPrivateLedgerPlan(events, ticketsByMember, sourceImportId, sourceSnapshot) {
  const now = new Date().toISOString();
  const sourceStale = sourceSnapshot.ageDays !== null && sourceSnapshot.ageDays > 3;
  const byMember = new Map();
  for (const event of events) {
    if (!["private", "semi_private"].includes(event.lessonType)) continue;
    if (!PRIVATE_LEDGER_STATUSES.has(event.usageStatus)) continue;
    pushMap(byMember, event.memberId, event);
  }

  const ledgerEntries = [];
  for (const [memberId, memberEvents] of byMember.entries()) {
    const sorted = memberEvents.sort((a, b) => `${a.startsAt}|${a.usageEventId}`.localeCompare(`${b.startsAt}|${b.usageEventId}`));
    const ticketCounts = new Map();
    sorted.forEach((event, index) => {
      const ticketName = event.ticketName || "";
      const ticketCount = (ticketCounts.get(ticketName) || 0) + 1;
      ticketCounts.set(ticketName, ticketCount);
      const totalRounds = ticketTotalRounds(event.ticketName, ticketsByMember.get(memberId) || []);
      const ledgerId = `private_ledger_${hash(event.canonicalUsageKey).slice(0, 24)}`;
      ledgerEntries.push({
        ledgerId,
        studioId: config.studioId,
        memberId,
        memberName: event.memberName,
        usageEventId: event.usageEventId,
        canonicalUsageKey: event.canonicalUsageKey,
        startsAt: event.startsAt,
        staffName: event.staffName,
        ticketName: event.ticketName,
        cumulativePrivateRound: index + 1,
        currentTicketRound: totalRounds ? ((ticketCount - 1) % totalRounds) + 1 : ticketCount,
        currentTicketTotalRounds: totalRounds || undefined,
        status: event.usageStatus,
        computation: {
          computedAt: now,
          computedFrom: ["memberUsageEvents"],
          sourceImportIds: [sourceImportId],
          sourceVersion: sourceSnapshot.snapshotDate || config.reportDate,
          stale: sourceStale,
          warnings: [...(totalRounds ? [] : ["ticket_total_rounds_unknown"]), ...(sourceStale ? ["usage_source_snapshot_stale"] : [])],
        },
        createdAt: now,
        updatedAt: now,
      });
    });
  }
  return {
    ledgerEntries,
    writes: ledgerEntries.map((entry) => ({ collection: "privateSessionLedger", id: entry.ledgerId, data: removeUndefined(entry) })),
  };
}

async function loadExistingBookings(selectedMemberIds) {
  const ids = [...selectedMemberIds].filter(Boolean);
  if (!ids.length) return [];
  const results = [];
  for (const memberId of ids) {
    const snap = await db.collection("bookings").where("studioId", "==", config.studioId).where("memberId", "==", memberId).get();
    for (const doc of snap.docs) results.push({ id: doc.id, data: doc.data() });
  }
  return results;
}

function compareWithExistingBookings(events, bookings) {
  const existingStrong = new Map();
  const existingLoose = new Map();
  for (const booking of bookings) {
    const data = booking.data || {};
    const date = cleanString(data.lectureDate || dateFromTimestamp(data.lectureStartAt));
    const time = timestampTime(data.lectureStartAt) || timeKey(data.startTime);
    const memberId = cleanString(data.memberId);
    const title = cleanString(data.title || data.lectureTitle || data.className);
    const staffName = cleanString(data.staffName || data.teacherName);
    const strongKey = buildCanonicalUsageKey({ memberId, lectureDate: date, startTime: time, title, staffName });
    const looseKey = [memberId, date, time].join("|");
    pushMap(existingStrong, strongKey, booking);
    pushMap(existingLoose, looseKey, booking);
  }
  const out = {
    comparedEvents: events.length,
    existingSameStrong: 0,
    existingLooseOnly: 0,
    existingStatusDifferent: 0,
    missingFromBookings: 0,
    byDecision: {},
    missingExamples: [],
    statusConflictExamples: [],
    looseExamples: [],
  };
  for (const event of events) {
    const strong = existingStrong.get(event.canonicalUsageKey) || [];
    const loose = existingLoose.get([event.memberId, dateFromIso(event.startsAt), timeFromIso(event.startsAt)].join("|")) || [];
    const candidates = strong.length ? strong : loose;
    if (!candidates.length) {
      out.missingFromBookings += 1;
      addCount(out.byDecision, "missing_from_bookings");
      addExample(out.missingExamples, event, {});
      continue;
    }
    const sameStatus = candidates.find((booking) => bookingUsageStatus(booking.data) === event.usageStatus);
    if (sameStatus && strong.length) {
      out.existingSameStrong += 1;
      addCount(out.byDecision, "existing_same_strong");
      continue;
    }
    if (sameStatus) {
      out.existingLooseOnly += 1;
      addCount(out.byDecision, "existing_same_loose");
      addExample(out.looseExamples, event, bookingExample(candidates[0]));
      continue;
    }
    out.existingStatusDifferent += 1;
    addCount(out.byDecision, strong.length ? "status_conflict_strong" : "status_conflict_loose");
    addExample(out.statusConflictExamples, event, bookingExample(candidates[0]));
  }
  return out;
}

function buildQualitySummary({ selectedMemberIds, rawUsageRows, usageRows, usagePlan, shadow, sourceSnapshot }) {
  const missingMemberId = rawUsageRows.filter((row) => !cleanString(row.memberId)).length;
  const selectedRowsWithoutMemberId = usageRows.filter((row) => !row.memberId).length;
  const warnings = [];
  const issuesForFirestore = [];
  if (missingMemberId) {
    warnings.push(`usage_json_missing_member_id_rows:${missingMemberId}`);
    issuesForFirestore.push({
      issueType: "missing_member_id",
      severity: "warning",
      status: "open",
      title: "개인 이용내역 원본에 memberId 누락 행 있음",
      summary: `전체 이용내역 원본 중 ${missingMemberId.toLocaleString("ko-KR")}개 행은 memberId가 없어 CORE 장부 원천에서 제외됩니다.`,
      sourcePaths: [config.usageJsonPath],
    });
  }
  if (usagePlan.duplicateRows) {
    const duplicateReviewRequired = usagePlan.duplicateSummary.reviewRequired || 0;
    if (duplicateReviewRequired) warnings.push(`duplicate_canonical_usage_rows:${usagePlan.duplicateRows}`);
    issuesForFirestore.push({
      issueType: "duplicate_booking",
      severity: duplicateReviewRequired ? "warning" : "info",
      status: duplicateReviewRequired ? "open" : "resolved",
      title: "개인 이용내역 canonical key 중복",
      summary: duplicateReviewRequired
        ? `선택 범위에서 ${usagePlan.duplicateRows.toLocaleString("ko-KR")}개 행이 같은 canonicalUsageKey로 묶였고, ${duplicateReviewRequired.toLocaleString("ko-KR")}개 그룹은 대표 상태 확인이 필요합니다.`
        : `선택 범위에서 ${usagePlan.duplicateRows.toLocaleString("ko-KR")}개 행이 같은 canonicalUsageKey로 묶였고, 출석/예약/결석/취소 우선순위로 실제 수업 1건씩 정규화했습니다.`,
      sourcePaths: [config.usageJsonPath],
      resolvedAt: duplicateReviewRequired ? "" : new Date().toISOString(),
      resolution: duplicateReviewRequired
        ? ""
        : "동일 회원·날짜·시각·수업명·강사 기준 중복 행은 StudioMate 이용내역의 상태 변경 로그로 확인했습니다. 대표 행은 attended > reserved > absent > late_cancel > cancelled > unknown 순서와 최신 statusChangedAt 기준으로 선택합니다.",
      operatorAction: duplicateReviewRequired
        ? "canonicalUsageKey별 대표 상태를 확인한 뒤 CORE 이용 이벤트 장부 반영 여부를 판단합니다."
        : "추가 조치 없음. 같은 수업을 여러 번 세지 않도록 CORE 이용 이벤트 장부에서 1건으로 정규화합니다.",
      breakdown: usagePlan.duplicateSummary,
      sampleRows: usagePlan.duplicateSummary.examples,
    });
  }
  if (selectedRowsWithoutMemberId) {
    warnings.push(`selected_rows_without_member_id:${selectedRowsWithoutMemberId}`);
  }
  if (shadow.existingStatusDifferent) {
    warnings.push(`shadow_status_conflicts:${shadow.existingStatusDifferent}`);
  }
  if (sourceSnapshot.ageDays !== null && sourceSnapshot.ageDays > 3) {
    warnings.push(`usage_source_snapshot_stale:${sourceSnapshot.ageDays}d`);
    issuesForFirestore.push({
      issueType: "usage_gap",
      severity: "warning",
      status: "open",
      title: "개인 이용내역 원본 최신화 필요",
      summary: `현재 CORE 전환 샘플은 ${sourceSnapshot.snapshotDate} 개인 이용내역 정규화 파일을 기준으로 합니다. 최신 프라이빗 회차 검증 전 개인별 이용내역을 다시 다운로드/정규화해야 합니다.`,
      sourcePaths: [config.usageJsonPath],
    });
  }
  return {
    selectedMemberCount: selectedMemberIds.size,
    missingMemberIdRows: missingMemberId,
    duplicateCanonicalUsageRows: usagePlan.duplicateRows,
    shadowStatusConflicts: shadow.existingStatusDifferent,
    blockingIssueCount: selectedRowsWithoutMemberId,
    warnings,
    issuesForFirestore,
  };
}

async function applyWritePlan(writes) {
  for (let index = 0; index < writes.length; index += 400) {
    const batch = db.batch();
    const chunk = writes.slice(index, index + 400);
    for (const write of chunk) {
      batch.set(db.collection(write.collection).doc(write.id), removeUndefinedDeep(write.data), { merge: true });
    }
    await batch.commit();
  }
}

function writeReports(summary) {
  mkdirSync(config.outDir, { recursive: true });
  mkdirSync(DOC_REPORT_DIR, { recursive: true });
  const suffix = `${config.reportDate}-archive-core-transition-${summary.mode}`;
  const jsonPath = path.join(config.outDir, `${suffix}.json`);
  const htmlPath = path.join(DOC_REPORT_DIR, `${suffix}.html`);
  writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`);
  writeHtmlReport(htmlPath, summary);
  return { jsonPath, htmlPath };
}

function writeHtmlReport(filePath, summary) {
  const html = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ARCHIVE CORE 전환 데이터 리포트</title>
  <style>
    :root { --bg:#f4f1ea; --paper:#fffefa; --text:#101828; --muted:#667085; --line:#d8dee8; --accent:#f5661f; --green:#08775f; --warn:#b54708; --red:#b42318; }
    * { box-sizing:border-box; }
    body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR",sans-serif; background:var(--bg); color:var(--text); line-height:1.58; }
    main { max-width:1180px; margin:0 auto; padding:40px 20px 72px; }
    h1 { margin:0; font-size:30px; letter-spacing:0; }
    h2 { margin:34px 0 12px; font-size:19px; }
    p { margin:8px 0 0; color:var(--muted); }
    .panel { margin-top:18px; background:var(--paper); border:1px solid var(--line); border-radius:8px; padding:22px; box-shadow:0 12px 30px rgba(16,24,40,.06); }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr)); gap:12px; }
    .metric { border:1px solid var(--line); border-radius:8px; padding:16px; background:#fff; min-width:0; }
    .label { color:var(--muted); font-size:13px; font-weight:700; }
    .value { margin-top:4px; font-size:26px; font-weight:800; }
    .accent { color:var(--accent); }
    .green { color:var(--green); }
    .warn { color:var(--warn); }
    .red { color:var(--red); }
    table { width:100%; border-collapse:collapse; background:#fff; border:1px solid var(--line); border-radius:8px; overflow:hidden; }
    th,td { padding:11px 12px; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; font-size:14px; }
    th { background:#eef2f7; color:#344054; }
    tr:last-child td { border-bottom:0; }
    code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; overflow-wrap:anywhere; }
    ul { margin:10px 0 0; padding-left:20px; color:var(--muted); }
    @media (max-width:520px) { main { padding:28px 12px 56px; } .panel { padding:16px; } .value { font-size:23px; } th,td { font-size:13px; } }
  </style>
</head>
<body>
<main>
  <h1>ARCHIVE CORE 전환 데이터 리포트</h1>
  <p>${escapeHtml(summary.mode)} · ${escapeHtml(summary.generatedAt)} · 외부 발송/쓰기 원천은 변경하지 않았습니다.</p>

  <section class="panel">
    <div class="grid">
      ${metric("선택 회원", summary.selection.selectedMemberCount.toLocaleString("ko-KR"), "accent")}
      ${metric("이용 이벤트", summary.normalized.usageEvents.toLocaleString("ko-KR"), "green")}
      ${metric("프라이빗 장부", summary.normalized.privateLedgerEntries.toLocaleString("ko-KR"), "green")}
      ${metric("수강권", summary.normalized.memberTickets.toLocaleString("ko-KR"))}
      ${metric("결제 이벤트", summary.normalized.memberPaymentEvents.toLocaleString("ko-KR"))}
      ${metric("예상 writes", summary.writePlan.writes.toLocaleString("ko-KR"), summary.mode === "apply" ? "accent" : "")}
    </div>
  </section>

  <section class="panel">
    <h2>Shadow Compare</h2>
    <p>개인 이용내역 원본을 기존 bookings와 비교했습니다. bookings에 없는 과거 이용내역은 CORE 회차 계산 보강 대상입니다.</p>
    <div class="grid">
      ${metric("기존 bookings", summary.firestoreRead.existingBookings.toLocaleString("ko-KR"))}
      ${metric("일치", summary.shadow.existingSameStrong.toLocaleString("ko-KR"), "green")}
      ${metric("시간만 일치", summary.shadow.existingLooseOnly.toLocaleString("ko-KR"), "warn")}
      ${metric("상태 충돌", summary.shadow.existingStatusDifferent.toLocaleString("ko-KR"), summary.shadow.existingStatusDifferent ? "warn" : "green")}
      ${metric("bookings 누락", summary.shadow.missingFromBookings.toLocaleString("ko-KR"), summary.shadow.missingFromBookings ? "warn" : "green")}
    </div>
    <h2>판정 분포</h2>
    ${objectTable(summary.shadow.byDecision)}
  </section>

  <section class="panel">
    <h2>정규화 분포</h2>
    <div class="grid">
      <div>${objectTable(summary.normalized.byLessonType, "수업 유형")}</div>
      <div>${objectTable(summary.normalized.byUsageStatus, "이용 상태")}</div>
      <div>${objectTable(summary.writePlan.byCollection, "컬렉션")}</div>
    </div>
  </section>

  <section class="panel">
    <h2>가드레일</h2>
    <ul>${summary.guardrails.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
  </section>

  <section class="panel">
    <h2>상태 충돌 예시</h2>
    ${exampleTable(summary.shadow.statusConflictExamples)}
    <h2>bookings 누락 예시</h2>
    ${exampleTable(summary.shadow.missingExamples)}
  </section>

  <section class="panel">
    <h2>원본 파일</h2>
    <table><tbody>
      <tr><th>이용내역 JSON</th><td><code>${escapeHtml(summary.sourceFiles.usageJsonPath)}</code></td></tr>
      <tr><th>수강권 CSV</th><td><code>${escapeHtml(summary.sourceFiles.ticketHistoryFile)}</code></td></tr>
    </tbody></table>
  </section>
</main>
</body>
</html>`;
  writeFileSync(filePath, html);
}

function metric(label, value, className = "") {
  return `<div class="metric"><div class="label">${escapeHtml(label)}</div><div class="value ${className}">${escapeHtml(value)}</div></div>`;
}

function objectTable(obj, firstHeading = "항목") {
  const rows = Object.entries(obj || {}).sort((a, b) => String(a[0]).localeCompare(String(b[0]), "ko"));
  if (!rows.length) return "<p>없음</p>";
  return `<table><thead><tr><th>${escapeHtml(firstHeading)}</th><th>건수</th></tr></thead><tbody>${rows
    .map(([key, value]) => `<tr><td>${escapeHtml(key)}</td><td>${Number(value).toLocaleString("ko-KR")}</td></tr>`)
    .join("")}</tbody></table>`;
}

function exampleTable(rows) {
  if (!rows?.length) return "<p>없음</p>";
  return `<table><thead><tr><th>회원</th><th>수업</th><th>CORE 상태</th><th>기존 booking</th></tr></thead><tbody>${rows
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.memberName)}<br><code>${escapeHtml(row.memberId)}</code></td>
        <td>${escapeHtml(row.startsAt)}<br>${escapeHtml(row.lessonTitle)}<br><span class="label">${escapeHtml(row.staffName)}</span></td>
        <td>${escapeHtml(row.usageStatus)}<br><code>${escapeHtml(row.lessonType)}</code></td>
        <td><code>${escapeHtml(JSON.stringify(row.extra || {}))}</code></td>
      </tr>`,
    )
    .join("")}</tbody></table>`;
}

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const [key, inlineValue] = arg.slice(2).split("=", 2);
    if (inlineValue !== undefined) out[key] = inlineValue || true;
    else if (argv[index + 1] && !argv[index + 1].startsWith("--")) out[key] = argv[++index];
    else out[key] = true;
  }
  return out;
}

function parseList(value) {
  if (Array.isArray(value)) return value.flatMap(parseList);
  return cleanString(value)
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseCsv(text) {
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;
  const pushCell = () => {
    row.push(current);
    current = "";
  };
  const pushRow = () => {
    rows.push(row);
    row = [];
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      pushCell();
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      pushCell();
      pushRow();
      continue;
    }
    current += char;
  }
  if (current || row.length) {
    pushCell();
    pushRow();
  }
  const headers = (rows.shift() || []).map((header) => cleanString(header).replace(/^\ufeff/, ""));
  return rows
    .filter((cells) => cells.some((cell) => cleanString(cell)))
    .map((cells) => Object.fromEntries(headers.map((header, index) => [header, cleanString(cells[index])])));
}

function usageStatusFromRow(row) {
  const appStatus = cleanString(row.appStatus).toLowerCase();
  const attendance = cleanString(row.attendanceStatus).toLowerCase();
  if (appStatus.includes("wait_cancel")) return "cancelled";
  if (appStatus.includes("cancel")) return "cancelled";
  if (attendance.includes("late_cancel")) return "late_cancel";
  if (attendance.includes("absent")) return "absent";
  if (attendance.includes("attended")) return "attended";
  if (appStatus.includes("reserved")) return "reserved";
  return "unknown";
}

function lessonTypeFromRow(row) {
  const explicit = lessonTypeFromTicket(`${row.ticketName || ""} ${row.title || ""}`, "");
  if (explicit !== "unknown") return explicit;
  const capacity = numberValue(row.capacity);
  if (capacity >= 2) return "group";
  if (capacity === 1) return "private";
  return "unknown";
}

function lessonTypeFromTicket(ticketName, classType) {
  const text = normalizeText(`${ticketName || ""} ${classType || ""}`);
  if (text.includes("상담")) return "consultation";
  if (text.includes("세미") || text.includes("듀엣") || text.includes("semi")) return "semi_private";
  if (text.includes("프라이빗") || text.includes("개인") || text.includes("1:1") || text.includes("private")) return "private";
  if (text.includes("그룹") || text.includes("group")) return "group";
  return "unknown";
}

function betterUsageRow(a, b) {
  const statusPriority = { attended: 6, reserved: 5, absent: 4, late_cancel: 3, cancelled: 2, unknown: 1 };
  const ap = statusPriority[a.usageStatus] || 0;
  const bp = statusPriority[b.usageStatus] || 0;
  if (bp !== ap) return bp > ap ? b : a;
  return cleanString(b.statusChangedAt).localeCompare(cleanString(a.statusChangedAt)) >= 0 ? b : a;
}

function buildCanonicalUsageKey({ memberId, lectureDate, startTime, title, staffName }) {
  return [memberId, lectureDate, startTime, normalizeText(title), normalizeText(staffName)].join("|");
}

function bookingUsageStatus(data) {
  const appStatus = cleanString(data.appStatus).toLowerCase();
  const attendance = cleanString(data.attendanceStatus).toLowerCase();
  if (appStatus.includes("cancel")) return "cancelled";
  if (attendance.includes("late_cancel")) return "late_cancel";
  if (attendance.includes("absent")) return "absent";
  if (attendance.includes("attended") || attendance.includes("present")) return "attended";
  if (appStatus.includes("reserved") || appStatus.includes("booked")) return "reserved";
  return "unknown";
}

function bookingExample(booking) {
  const data = booking.data || {};
  return {
    bookingId: booking.id,
    appStatus: data.appStatus || "",
    attendanceStatus: data.attendanceStatus || "",
    title: data.title || data.lectureTitle || "",
    staffName: data.staffName || "",
  };
}

function addExample(list, event, extra) {
  if (list.length >= 30) return;
  list.push({
    memberId: event.memberId,
    memberName: event.memberName,
    startsAt: event.startsAt,
    lessonTitle: event.lessonTitle,
    staffName: event.staffName,
    usageStatus: event.usageStatus,
    lessonType: event.lessonType,
    extra,
  });
}

function ticketTotalRounds(ticketName, ticketRows) {
  const fromName = roundFromText(ticketName);
  if (fromName) return fromName;
  const exact = ticketRows.find((ticket) => normalizeText(ticket.ticketName) === normalizeText(ticketName) && ticket.maxCount);
  return exact?.maxCount || 0;
}

function roundFromText(value) {
  const text = cleanString(value);
  const match = text.match(/(\d{1,3})\s*회/);
  return match ? Number(match[1]) : 0;
}

function dateRangeFromRows(rows) {
  const dates = rows.map((row) => row.lectureDate).filter(Boolean).sort();
  return { startDate: dates[0] || "", endDate: dates.at(-1) || "" };
}

function sourceSnapshotFromPath(filePath) {
  const basename = path.basename(filePath);
  const match = basename.match(/(20\d{2}-\d{2}-\d{2})/);
  const snapshotDate = match ? match[1] : "";
  if (!snapshotDate) return { snapshotDate: "", ageDays: null };
  const today = new Date(`${kstDate(new Date())}T00:00:00+09:00`);
  const snapshot = new Date(`${snapshotDate}T00:00:00+09:00`);
  const ageDays = Math.max(0, Math.round((today.getTime() - snapshot.getTime()) / 86400000));
  return { snapshotDate, ageDays };
}

function kstDateTime(date, time) {
  if (!date || !time) return "";
  return `${date}T${time}:00+09:00`;
}

function dateFromIso(value) {
  return cleanString(value).slice(0, 10);
}

function timeFromIso(value) {
  const match = cleanString(value).match(/T(\d{2}:\d{2})/);
  return match ? match[1] : "";
}

function timestampTime(value) {
  const date = value?.toDate?.();
  if (!date) return "";
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function dateFromTimestamp(value) {
  const date = value?.toDate?.();
  if (!date) return "";
  return kstDate(date);
}

function dateKey(value) {
  const text = cleanString(value).replace(/[./]/g, "-");
  const match = text.match(/(20\d{2})-(\d{1,2})-(\d{1,2})/);
  if (!match) return "";
  return `${match[1]}-${String(Number(match[2])).padStart(2, "0")}-${String(Number(match[3])).padStart(2, "0")}`;
}

function timeKey(value) {
  const match = cleanString(value).match(/(\d{1,2}):(\d{2})/);
  if (!match) return "";
  return `${String(Number(match[1])).padStart(2, "0")}:${match[2]}`;
}

function kstDate(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function normalizePhone(value) {
  let digits = cleanString(value).replace(/\D+/g, "");
  if (digits.startsWith("82") && digits.length >= 11) digits = `0${digits.slice(2)}`;
  if (digits.length === 10 && digits.startsWith("10")) digits = `0${digits}`;
  return digits;
}

function normalizeText(value) {
  return cleanString(value).replace(/\s+/g, "").toLowerCase();
}

function cleanString(value) {
  return String(value ?? "").normalize("NFC").trim();
}

function numberValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value === undefined || value === null || value === "") return 0;
  return Number(cleanString(value).replaceAll(",", "")) || 0;
}

function boolValue(value) {
  const text = cleanString(value).toLowerCase();
  return ["true", "y", "yes", "1", "사용", "활성"].includes(text);
}

function expandHome(value) {
  if (!value) return "";
  return value.startsWith("~/") ? path.join(HOME, value.slice(2)) : value;
}

function hash(value) {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

function pushMap(map, key, value) {
  const list = map.get(key) || [];
  list.push(value);
  map.set(key, list);
}

function addCount(obj, key) {
  obj[key] = (obj[key] || 0) + 1;
}

function countBy(rows, key) {
  const out = {};
  for (const row of rows) addCount(out, cleanString(row[key]) || "blank");
  return out;
}

function removeUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function removeUndefinedDeep(value) {
  if (Array.isArray(value)) return value.map(removeUndefinedDeep);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, removeUndefinedDeep(entry)]),
  );
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
