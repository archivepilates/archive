#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import {
  createPrivateLessonReportSnapshot,
  currentPrivateLessonReportRevision,
} from "../firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonReportRevision";
import {
  LEGACY_PRIVATE_SURVEY_ALIMTALK_TEMPLATE_CODE,
} from "../firebase/kangsain-functions/functions/src/alimtalk/templates";
import type {
  AlimtalkCandidateDoc,
  PrivateLessonChartRecordDoc,
} from "../firebase/kangsain-functions/functions/src/types/models";

const defaultCredentials = path.join(
  os.homedir(),
  "ArchiveIN/secrets/google/archive-codex-operator.json",
);
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && existsSync(defaultCredentials)) {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = defaultCredentials;
}
process.env.GOOGLE_CLOUD_PROJECT ||= "archive-pilates";
process.env.GCLOUD_PROJECT ||= "archive-pilates";

const apply = process.argv.includes("--apply");
const writeLimit = numberArg("--write-limit", 100);
const retiredTestSessionIds = ["plc_test_kim_20260528"];
const outDir = path.join(
  os.homedir(),
  "ArchiveIN/automation/reports/private-report-runtime-repair",
);

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const { db } = await import("../firebase/kangsain-functions/functions/src/config/firebase");
  const [surveyCandidateSnap, recordSnap, retiredTestArtifactSnaps] = await Promise.all([
    db.collection("alimtalkCandidates").where("type", "==", "private_survey").get(),
    db.collection("privateLessonChartRecords").get(),
    Promise.all(
      retiredTestSessionIds.flatMap((id) => [
        db.collection("privateLessonChartRequests").doc(id).get(),
        db.collection("privateLessonChartRecords").doc(id).get(),
        db.collection("privateLessonSessions").doc(id).get(),
      ]),
    ),
  ]);
  const retiredTestArtifacts = retiredTestArtifactSnaps.filter((snap) => snap.exists);

  const legacySurveyCandidates = surveyCandidateSnap.docs.filter((doc) => {
    const candidate = doc.data() as AlimtalkCandidateDoc;
    return (
      candidate.templateCode === LEGACY_PRIVATE_SURVEY_ALIMTALK_TEMPLATE_CODE &&
      ["candidate", "queued", "processing"].includes(String(candidate.status || ""))
    );
  });

  const approvalRevisionMismatch = recordSnap.docs.filter((doc) => {
    const record = doc.data() as PrivateLessonChartRecordDoc;
    if (
      !["approved", "queued", "processing"].includes(
        String(record.publicReportApproval?.status || ""),
      )
    ) {
      return false;
    }
    const revision = currentPrivateLessonReportRevision(record);
    return (
      !record.approvedRevision ||
      record.approvedRevision !== revision ||
      record.approvedReportSnapshot?.revision !== record.approvedRevision
    );
  });

  const legacySentSnapshotBackfill = recordSnap.docs.filter((doc) => {
    const record = doc.data() as PrivateLessonChartRecordDoc;
    const sent =
      record.publicReportApproval?.status === "sent" ||
      Boolean(record.publicReportApproval?.sentAt) ||
      Boolean(record.sentRevision) ||
      record.gptStatus === "published";
    return (
      sent &&
      !record.sentReportSnapshot?.revision &&
      !record.approvedReportSnapshot?.revision &&
      !record.legacySentReportSnapshot?.revision
    );
  });

  const plannedWrites =
    legacySurveyCandidates.length +
    approvalRevisionMismatch.length +
    legacySentSnapshotBackfill.length +
    retiredTestArtifacts.length;
  if (plannedWrites > writeLimit) {
    throw new Error(`Planned writes ${plannedWrites} exceed --write-limit=${writeLimit}.`);
  }

  if (apply && plannedWrites) {
    const batch = db.batch();
    const now = new Date();
    for (const doc of legacySurveyCandidates) {
      batch.set(
        doc.ref,
        {
          status: "skipped",
          reasonCode: "legacy_private_survey_template_retired",
          lastError: "구형 프라이빗 사전설문 v1 템플릿 폐기로 발송 차단",
          updatedAt: now,
        },
        { merge: true },
      );
    }
    for (const doc of approvalRevisionMismatch) {
      const record = doc.data() as PrivateLessonChartRecordDoc;
      batch.set(
        doc.ref,
        {
          approvedRevision: "",
          approvedReportSnapshot: null,
          publicReportApproval: {
            ...(record.publicReportApproval || {}),
            status: "failed",
            lastError: "승인된 리포트 버전이 현재 내용과 달라 재검수가 필요합니다.",
          },
          updatedAt: now,
        },
        { merge: true },
      );
    }
    for (const doc of legacySentSnapshotBackfill) {
      const record = doc.data() as PrivateLessonChartRecordDoc;
      const revision = `legacy-${currentPrivateLessonReportRevision(record)}`;
      batch.set(
        doc.ref,
        {
          legacySentReportSnapshot: createPrivateLessonReportSnapshot(record, revision),
          updatedAt: now,
        },
        { merge: true },
      );
    }
    for (const doc of retiredTestArtifacts) batch.delete(doc.ref);
    await batch.commit();
  }

  const summary = {
    ok: true,
    mode: apply ? "apply" : "dry-run",
    projectId: process.env.GOOGLE_CLOUD_PROJECT,
    generatedAt: new Date().toISOString(),
    plannedWrites,
    legacySurveyCandidates: legacySurveyCandidates.map((doc) => doc.id),
    approvalRevisionMismatch: approvalRevisionMismatch.map((doc) => doc.id),
    legacySentSnapshotBackfill: legacySentSnapshotBackfill.map((doc) => doc.id),
    retiredTestArtifacts: retiredTestArtifacts.map((doc) => doc.ref.path),
  };
  mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(
    outDir,
    `${new Date().toISOString().replace(/[:.]/g, "-")}-${apply ? "apply" : "dry-run"}.json`,
  );
  writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ summary, reportPath }, null, 2));
}

function numberArg(name: string, fallback: number): number {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}
