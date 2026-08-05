#!/usr/bin/env node

import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import {
  currentPrivateLessonReportRevision,
} from "../firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonReportRevision";
import {
  LEGACY_PRIVATE_SURVEY_ALIMTALK_TEMPLATE_CODE,
} from "../firebase/kangsain-functions/functions/src/alimtalk/templates";
import type {
  AlimtalkCandidateDoc,
  PrivateLessonChartRecordDoc,
  PrivateLessonChartRequestDoc,
  PrivateLessonSessionDoc,
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

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const { db } = await import("../firebase/kangsain-functions/functions/src/config/firebase");
  const [
    requestSnap,
    recordSnap,
    sessionSnap,
    reportCandidateSnap,
    surveyCandidateSnap,
    mediaUploadSnap,
  ] = await Promise.all([
    db.collection("privateLessonChartRequests").get(),
    db.collection("privateLessonChartRecords").get(),
    db.collection("privateLessonSessions").get(),
    db.collection("alimtalkCandidates").where("type", "==", "private_lesson_report").get(),
    db.collection("alimtalkCandidates").where("type", "==", "private_survey").get(),
    db.collection("privateLessonChartMediaUploadSessions").get(),
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

  const requestOnly = [...requests.keys()].filter((id) => !records.has(id));
  const recordOnly = [...records.keys()].filter((id) => !requests.has(id));
  const sentRecords = [...records.values()].filter((record) =>
    record.publicReportApproval?.status === "sent" || Boolean(record.sentRevision),
  );
  const sentMissingSnapshot = sentRecords.filter(
    (record) =>
      !record.sentReportSnapshot?.revision &&
      !record.approvedReportSnapshot?.revision &&
      !record.legacySentReportSnapshot?.revision,
  );
  const mutableApprovedRecords = [...records.values()].filter((record) =>
    ["approved", "queued", "processing"].includes(String(record.publicReportApproval?.status || "")),
  );
  const approvalRevisionMismatch = mutableApprovedRecords.filter((record) => {
    const current = currentPrivateLessonReportRevision(record);
    return (
      !record.approvedRevision ||
      record.approvedRevision !== current ||
      record.approvedReportSnapshot?.revision !== record.approvedRevision
    );
  });
  const sessionRevisionMismatch = [...records.entries()].filter(([id, record]) =>
    sessions.get(id)?.reportRevision !== currentPrivateLessonReportRevision(record),
  );

  const reportCandidates = reportCandidateSnap.docs.map(
    (doc) => ({ candidateId: doc.id, ...(doc.data() as AlimtalkCandidateDoc) }),
  );
  const actionableReportCandidates = reportCandidates.filter((candidate) =>
    ["candidate", "queued", "processing"].includes(String(candidate.status || "")),
  );
  const staleReportCandidates = actionableReportCandidates.filter((candidate) => {
    const recordId = String(candidate.sourceActionKey || candidate.payload?.recordId || "");
    const record = records.get(recordId);
    const revision = String(candidate.payload?.reportRevision || "");
    return !record || !revision || currentPrivateLessonReportRevision(record) !== revision;
  });

  const surveyCandidates = surveyCandidateSnap.docs.map(
    (doc) => ({ candidateId: doc.id, ...(doc.data() as AlimtalkCandidateDoc) }),
  );
  const legacySurveyCandidates = surveyCandidates.filter(
    (candidate) =>
      candidate.templateCode === LEGACY_PRIVATE_SURVEY_ALIMTALK_TEMPLATE_CODE &&
      ["candidate", "queued", "processing"].includes(String(candidate.status || "")),
  );

  const mediaStatusCounts = countBy(mediaUploadSnap.docs.map((doc) => doc.data().status || "unknown"));
  const workflowStageCounts = countBy([...sessions.values()].map((session) => session.workflowStage || "unknown"));
  const reportCandidateStatusCounts = countBy(reportCandidates.map((candidate) => candidate.status || "unknown"));
  const surveyCandidateStatusCounts = countBy(surveyCandidates.map((candidate) => candidate.status || "unknown"));

  const attention = [
    requestOnly.length
      ? `${requestOnly.length}개 프라이빗 요청에 대응하는 리포트 레코드가 없음`
      : "",
    recordOnly.length
      ? `${recordOnly.length}개 프라이빗 리포트 레코드에 대응하는 요청이 없음`
      : "",
    legacySurveyCandidates.length
      ? `${legacySurveyCandidates.length}개 프라이빗 사전설문 후보가 구글폼 버튼형 v1 템플릿을 참조 중`
      : "",
    staleReportCandidates.length
      ? `${staleReportCandidates.length}개 리포트 후보가 현재 리포트 버전과 불일치`
      : "",
    approvalRevisionMismatch.length
      ? `${approvalRevisionMismatch.length}개 승인/처리중 리포트의 승인 스냅샷이 현재 버전과 불일치`
      : "",
    sessionRevisionMismatch.length
      ? `${sessionRevisionMismatch.length}개 운영 장부의 리포트 버전이 원천 레코드와 불일치`
      : "",
    Number(mediaStatusCounts.uploaded_to_drive || 0)
      ? `${mediaStatusCounts.uploaded_to_drive}개 미디어가 Drive 업로드 후 리포트 첨부 대기`
      : "",
  ].filter(Boolean);

  console.log(
    JSON.stringify(
      {
        ok: attention.length === 0,
        mode: "read-only",
        projectId: process.env.GOOGLE_CLOUD_PROJECT,
        generatedAt: new Date().toISOString(),
        sourceCounts: {
          requests: requestSnap.size,
          records: recordSnap.size,
          sessions: sessionSnap.size,
          reportCandidates: reportCandidateSnap.size,
          surveyCandidates: surveyCandidateSnap.size,
          mediaUploadSessions: mediaUploadSnap.size,
        },
        integrity: {
          requestOnly: requestOnly.length,
          recordOnly: recordOnly.length,
          sentRecords: sentRecords.length,
          sentMissingImmutableSnapshot: sentMissingSnapshot.length,
          legacySentSnapshots: [...records.values()].filter(
            (record) => Boolean(record.legacySentReportSnapshot?.revision),
          ).length,
          approvalRevisionMismatch: approvalRevisionMismatch.length,
          sessionRevisionMismatch: sessionRevisionMismatch.length,
          staleActionableReportCandidates: staleReportCandidates.length,
          legacyActionableSurveyCandidates: legacySurveyCandidates.length,
        },
        attentionSamples: {
          requestOnly: requestOnly.slice(0, 10),
          recordOnly: recordOnly.slice(0, 10),
          approvalRevisionMismatch: approvalRevisionMismatch.slice(0, 10).map((record) => record.recordId),
          staleActionableReportCandidates: staleReportCandidates.slice(0, 10).map((candidate) => candidate.candidateId),
          legacyActionableSurveyCandidates: legacySurveyCandidates.slice(0, 10).map((candidate) => candidate.candidateId),
        },
        workflowStageCounts,
        reportCandidateStatusCounts,
        surveyCandidateStatusCounts,
        mediaStatusCounts,
        attention,
      },
      null,
      2,
    ),
  );
}

function countBy(values: unknown[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const key = String(value || "unknown");
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])),
  );
}
