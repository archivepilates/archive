#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { db } from "../firebase/kangsain-functions/functions/src/config/firebase";
import { privateLessonSessionProjection } from "../firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonSession";
import type {
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
  const changed: PrivateLessonSessionDoc[] = [];
  const stageCounts: Record<string, number> = {};
  const stageSamples: Record<string, string[]> = {};

  for (const id of ids) {
    const next = privateLessonSessionProjection(id, requests.get(id), records.get(id), sessions.get(id));
    stageCounts[next.workflowStage] = (stageCounts[next.workflowStage] || 0) + 1;
    stageSamples[next.workflowStage] ||= [];
    if (stageSamples[next.workflowStage].length < 5) stageSamples[next.workflowStage].push(id);
    if (sessionChanged(next, sessions.get(id))) changed.push(next);
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
    changedSessionSamples: changed.slice(0, 20).map((session) => session.sessionId),
    stageCounts,
    stageSamples,
  };
  mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(
    outDir,
    `${new Date().toISOString().replace(/[:.]/g, "-")}-private-lesson-sessions-${apply ? "apply" : "dry-run"}.json`,
  );
  writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ summary, reportPath }, null, 2));
}

function sessionChanged(next: PrivateLessonSessionDoc, current?: PrivateLessonSessionDoc): boolean {
  if (!current) return true;
  return stableStringify(comparable(next)) !== stableStringify(comparable(current));
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
