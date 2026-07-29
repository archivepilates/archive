#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { db } from "../firebase/kangsain-functions/functions/src/config/firebase";
import {
  privateLessonRoundVerified,
  privateLessonSessionProjection,
} from "../firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonSession";
import type {
  BookingDoc,
  PrivateLessonChartRecordDoc,
  PrivateLessonChartRequestDoc,
  PrivateLessonSessionDoc,
} from "../firebase/kangsain-functions/functions/src/types/models";
import { stableStringify } from "../firebase/kangsain-functions/functions/src/utils/hash";

const args = parseArgs(process.argv.slice(2));
const apply = Boolean(args.apply);
const all = Boolean(args.all);
const requestedIds = String(args.ids || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const writeLimit = numberValue(args["write-limit"] || "2000");
const outDir = expandHome(
  String(args["out-dir"] || path.join(os.homedir(), "ArchiveIN/automation/reports/private-lesson-sessions")),
);

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});

async function main(): Promise<void> {
  if (!all && !requestedIds.length) {
    throw new Error("Run with --all or --ids=id1,id2. Dry-run is the default; add --apply after reviewing counts.");
  }

  const [requestSnap, recordSnap, sessionSnap] = await Promise.all([
    db.collection("privateLessonChartRequests").get(),
    db.collection("privateLessonChartRecords").get(),
    db.collection("privateLessonSessions").get(),
  ]);
  const requests = new Map(
    requestSnap.docs.map((doc) => [doc.id, doc.data() as PrivateLessonChartRequestDoc]),
  );
  const records = new Map(
    recordSnap.docs.map((doc) => [doc.id, doc.data() as PrivateLessonChartRecordDoc]),
  );
  const sessions = new Map(
    sessionSnap.docs.map((doc) => [doc.id, doc.data() as PrivateLessonSessionDoc]),
  );
  const sourceIds = [...new Set([...requests.keys(), ...records.keys()])].sort();
  const ids = all ? sourceIds : sourceIds.filter((id) => requestedIds.includes(id));
  if (!ids.length) throw new Error("No private lesson session source documents matched.");
  const bookingIds = [
    ...new Set(
      ids
        .map((id) => String(requests.get(id)?.bookingId || records.get(id)?.bookingId || ""))
        .filter(Boolean),
    ),
  ];
  const bookings = await loadBookings(bookingIds);
  const changed: PrivateLessonSessionDoc[] = [];
  const changedFieldCounts: Record<string, number> = {};
  const stageCounts: Record<string, number> = {};
  const stageSamples: Record<string, string[]> = {};
  const needsReviewDetails: Array<Record<string, unknown>> = [];

  for (const id of ids) {
    const request = requests.get(id);
    const record = records.get(id);
    const bookingId = String(request?.bookingId || record?.bookingId || "");
    const sessionNumber = Number(request?.sessionNumber || record?.sessionNumber || 0) || null;
    const booking = bookings.get(bookingId);
    const next = privateLessonSessionProjection(id, request, record, sessions.get(id), {
      roundVerified: privateLessonRoundVerified(booking, sessionNumber),
    });
    if (next.workflowStage === "needs_review" && needsReviewDetails.length < 50) {
      needsReviewDetails.push({
        sessionId: id,
        bookingId,
        memberName: next.memberName,
        staffName: next.staffName,
        lessonDate: next.lessonDate,
        sessionNumber,
        bookingRound: booking?.sessionOrder?.privateCumulativeRound || null,
        bookingCounted: booking?.sessionOrder?.counted ?? null,
        reason: !booking
          ? "booking_missing"
          : booking.sessionOrder?.counted === false
            ? booking.sessionOrder?.excludedReason || "booking_not_counted"
            : "round_mismatch",
      });
    }
    stageCounts[next.workflowStage] = (stageCounts[next.workflowStage] || 0) + 1;
    stageSamples[next.workflowStage] ||= [];
    if (stageSamples[next.workflowStage].length < 5) stageSamples[next.workflowStage].push(id);
    const current = sessions.get(id);
    if (sessionChanged(next, current)) {
      changed.push(next);
      for (const field of changedTopLevelFields(next, current)) {
        changedFieldCounts[field] = (changedFieldCounts[field] || 0) + 1;
      }
    }
  }

  if (changed.length > writeLimit) {
    throw new Error(`Planned writes ${changed.length} exceed --write-limit=${writeLimit}.`);
  }

  if (apply) {
    for (let index = 0; index < changed.length; index += 400) {
      const batch = db.batch();
      for (const session of changed.slice(index, index + 400)) {
        batch.set(db.collection("privateLessonSessions").doc(session.sessionId), session, { merge: true });
      }
      await batch.commit();
    }
  }

  const summary = {
    ok: true,
    mode: apply ? "apply" : "dry-run",
    generatedAt: new Date().toISOString(),
    requestDocuments: requestSnap.size,
    recordDocuments: recordSnap.size,
    existingSessions: sessionSnap.size,
    sourceSessionIds: sourceIds.length,
    selectedSessionIds: ids.length,
    plannedWrites: changed.length,
    changedFieldCounts: Object.fromEntries(
      Object.entries(changedFieldCounts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])),
    ),
    changedSessionSamples: changed.slice(0, 20).map((session) => session.sessionId),
    stageCounts,
    stageSamples,
    needsReviewDetails,
  };
  mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(
    outDir,
    `${new Date().toISOString().replace(/[:.]/g, "-")}-private-lesson-sessions-${apply ? "apply" : "dry-run"}.json`,
  );
  writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ summary, reportPath }, null, 2));
}

async function loadBookings(ids: string[]): Promise<Map<string, BookingDoc>> {
  const result = new Map<string, BookingDoc>();
  for (let index = 0; index < ids.length; index += 250) {
    const refs = ids.slice(index, index + 250).map((id) => db.collection("bookings").doc(id));
    const snaps = refs.length ? await db.getAll(...refs) : [];
    for (const snap of snaps) {
      if (snap.exists) result.set(snap.id, snap.data() as BookingDoc);
    }
  }
  return result;
}

function sessionChanged(next: PrivateLessonSessionDoc, current?: PrivateLessonSessionDoc): boolean {
  if (!current) return true;
  return stableStringify(comparable(next)) !== stableStringify(comparable(current));
}

function changedTopLevelFields(
  next: PrivateLessonSessionDoc,
  current?: PrivateLessonSessionDoc,
): string[] {
  if (!current) return ["document_missing"];
  const nextComparable = comparable(next);
  const currentComparable = comparable(current);
  return [...new Set([...Object.keys(nextComparable), ...Object.keys(currentComparable)])]
    .filter((field) => stableStringify(nextComparable[field]) !== stableStringify(currentComparable[field]))
    .sort();
}

function comparable(session: PrivateLessonSessionDoc): Record<string, unknown> {
  const normalized = normalizeForComparison(session) as Record<string, unknown>;
  delete normalized.updatedAt;
  const notionProjection = normalized.notionProjection as Record<string, unknown> | undefined;
  if (notionProjection) delete notionProjection.updatedAt;
  return normalized;
}

function normalizeForComparison(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeForComparison);
  if (!value || typeof value !== "object") return value;
  const timestamp = value as { toMillis?: () => number };
  if (typeof timestamp.toMillis === "function") return timestamp.toMillis();
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, normalizeForComparison(item)]),
  );
}

function numberValue(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function parseArgs(values: string[]): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) parsed[key] = true;
    else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function expandHome(value: string): string {
  return value.startsWith("~") ? path.join(os.homedir(), value.slice(1)) : value;
}
