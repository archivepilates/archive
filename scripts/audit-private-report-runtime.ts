#!/usr/bin/env node

import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  currentPrivateLessonReportRevision,
} from "../firebase/kangsain-functions/functions/src/privateLessonChart/privateLessonReportRevision";
import {
  LEGACY_PRIVATE_SURVEY_ALIMTALK_TEMPLATE_CODE,
  ALIMTALK_TEMPLATES,
} from "../firebase/kangsain-functions/functions/src/alimtalk/templates";
import type {
  AlimtalkCandidateDoc,
  AlimtalkSendDoc,
  PrivateLessonChartRecordDoc,
  PrivateLessonChartRequestDoc,
  PrivateLessonSessionDoc,
  PrivateSurveyRequestDoc,
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
    surveyRequestSnap,
    privateSurveyShortLinkSnap,
    mediaUploadSnap,
    surveySendSnap,
  ] = await Promise.all([
    db.collection("privateLessonChartRequests").get(),
    db.collection("privateLessonChartRecords").get(),
    db.collection("privateLessonSessions").get(),
    db.collection("alimtalkCandidates").where("type", "==", "private_lesson_report").get(),
    db.collection("alimtalkCandidates").where("type", "==", "private_survey").get(),
    db.collection("privateSurveyRequests").get(),
    db.collection("shortLinks").where("type", "==", "private_survey").get(),
    db.collection("privateLessonChartMediaUploadSessions").get(),
    db.collection("alimtalkSends").where("templateCode", "==", ALIMTALK_TEMPLATES.private_survey.code).get(),
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
    (record) => !record.sentRevision || record.sentReportSnapshot?.revision !== record.sentRevision,
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
  const actionableReportCandidates = reportCandidates.filter(isActionableCandidate);
  const staleReportCandidates = actionableReportCandidates.filter((candidate) => {
    const recordId = String(candidate.sourceActionKey || candidate.payload?.recordId || "");
    const record = records.get(recordId);
    const revision = String(candidate.payload?.reportRevision || "");
    return !record || !revision || currentPrivateLessonReportRevision(record) !== revision;
  });

  const surveyCandidates = surveyCandidateSnap.docs.map(
    (doc) => ({ candidateId: doc.id, ...(doc.data() as AlimtalkCandidateDoc) }),
  );
  const surveyRequests = new Map(
    surveyRequestSnap.docs.map((doc) => [doc.id, doc.data() as PrivateSurveyRequestDoc]),
  );
  const privateSurveyShortLinks = new Map(
    privateSurveyShortLinkSnap.docs.map((doc) => [doc.id, doc.data()]),
  );
  const surveySends = new Map(
    surveySendSnap.docs.map((doc) => {
      const send = doc.data() as AlimtalkSendDoc;
      return [send.candidateId || doc.id, send] as const;
    }),
  );
  const currentPrivateSurveyTemplate = ALIMTALK_TEMPLATES.private_survey.code;
  const legacySurveyCandidates = surveyCandidates.filter(
    (candidate) =>
      candidate.templateCode === LEGACY_PRIVATE_SURVEY_ALIMTALK_TEMPLATE_CODE &&
      isActionableCandidate(candidate),
  );
  const actionableSurveyCandidates = surveyCandidates.filter(
    (candidate) => candidate.templateCode === currentPrivateSurveyTemplate && isActionableCandidate(candidate),
  );
  const actionableSurveyCandidatesMissingRequest = actionableSurveyCandidates.filter((candidate) => {
    const requestId = String(candidate.payload?.surveyId || candidate.payload?.responseId || "");
    return !requestId || !surveyRequests.has(requestId);
  });
  const sentSurveyCandidatesWithBrokenLink = surveyCandidates.filter((candidate) => {
    if (String(candidate.status || "") !== "sent") return false;
    if (candidate.templateCode !== currentPrivateSurveyTemplate) return false;
    const send = surveySends.get(candidate.candidateId);
    const variables = send?.variables || {};
    const requestId = String(variables["#{설문ID}"] || candidate.payload?.surveyId || candidate.payload?.responseId || "");
    const accessToken = String(variables["#{접근토큰}"] || candidate.payload?.accessToken || "");
    const shortLinkId = String(variables["#{링크ID}"] || candidate.payload?.shortLinkId || "");
    const request = surveyRequests.get(requestId);
    const link = privateSurveyShortLinks.get(shortLinkId);
    return (
      !send ||
      send.status !== "done" ||
      !request ||
      !accessToken ||
      sha256(accessToken) !== request.accessTokenHash ||
      !shortLinkId ||
      !validPrivateSurveyShortLink(link, requestId, accessToken)
    );
  });
  const nowMs = Date.now();
  const stalePendingSurveyRequests = [...surveyRequests.values()].filter((request) =>
    request.status === "pending" &&
    request.lessonStartAt?.toMillis?.() &&
    request.lessonStartAt.toMillis() + 24 * 60 * 60 * 1000 < nowMs,
  );

  const mediaStatusCounts = countBy(mediaUploadSnap.docs.map((doc) => doc.data().status || "unknown"));
  const workflowStageCounts = countBy([...sessions.values()].map((session) => session.workflowStage || "unknown"));
  const reportCandidateStatusCounts = countBy(reportCandidates.map((candidate) => candidate.status || "unknown"));
  const surveyCandidateStatusCounts = countBy(surveyCandidates.map((candidate) => candidate.status || "unknown"));

  const attention = [
    legacySurveyCandidates.length
      ? `${legacySurveyCandidates.length}개 프라이빗 사전설문 후보가 구글폼 버튼형 v1 템플릿을 참조 중`
      : "",
    actionableSurveyCandidatesMissingRequest.length
      ? `${actionableSurveyCandidatesMissingRequest.length}개 진행중 사전설문 후보에 요청 문서가 없음`
      : "",
    sentSurveyCandidatesWithBrokenLink.length
      ? `${sentSurveyCandidatesWithBrokenLink.length}개 발송완료 사전설문 후보의 short link 계약 불일치`
      : "",
    staleReportCandidates.length
      ? `${staleReportCandidates.length}개 리포트 후보가 현재 리포트 버전과 불일치`
      : "",
    approvalRevisionMismatch.length
      ? `${approvalRevisionMismatch.length}개 승인/처리중 리포트의 승인 스냅샷이 현재 버전과 불일치`
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
          surveyRequests: surveyRequestSnap.size,
          privateSurveyShortLinks: privateSurveyShortLinkSnap.size,
          privateSurveySends: surveySendSnap.size,
        },
        integrity: {
          requestOnly: requestOnly.length,
          recordOnly: recordOnly.length,
          sentRecords: sentRecords.length,
          sentMissingImmutableSnapshot: sentMissingSnapshot.length,
          approvalRevisionMismatch: approvalRevisionMismatch.length,
          sessionRevisionMismatch: sessionRevisionMismatch.length,
          staleActionableReportCandidates: staleReportCandidates.length,
          legacyActionableSurveyCandidates: legacySurveyCandidates.length,
          actionableSurveyCandidatesMissingRequest: actionableSurveyCandidatesMissingRequest.length,
          sentSurveyCandidatesWithBrokenLink: sentSurveyCandidatesWithBrokenLink.length,
          stalePendingSurveyRequests: stalePendingSurveyRequests.length,
        },
        attentionSamples: {
          approvalRevisionMismatch: approvalRevisionMismatch.slice(0, 10).map((record) => record.recordId),
          staleActionableReportCandidates: staleReportCandidates.slice(0, 10).map((candidate) => candidate.candidateId),
          legacyActionableSurveyCandidates: legacySurveyCandidates.slice(0, 10).map((candidate) => candidate.candidateId),
          actionableSurveyCandidatesMissingRequest: actionableSurveyCandidatesMissingRequest.slice(0, 10).map((candidate) => candidate.candidateId),
          sentSurveyCandidatesWithBrokenLink: sentSurveyCandidatesWithBrokenLink.slice(0, 10).map((candidate) => candidate.candidateId),
          stalePendingSurveyRequests: stalePendingSurveyRequests.slice(0, 10).map((request) => request.requestId),
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

function isActionableCandidate(candidate: AlimtalkCandidateDoc): boolean {
  const status = String(candidate.status || "");
  if (["candidate", "reviewed", "queued", "processing"].includes(status)) return true;
  return status === "failed" && Number(candidate.attempts || 0) < Number(candidate.maxAttempts || 2);
}

function validPrivateSurveyShortLink(
  link: FirebaseFirestore.DocumentData | undefined,
  requestId: string,
  accessToken: string,
): boolean {
  if (!link?.active) return false;
  try {
    const target = new URL(String(link.targetUrl || ""));
    return (
      target.hostname === "in.archivepilates.com" &&
      target.pathname.replace(/\/$/, "") === "/privateSurvey" &&
      target.searchParams.get("id") === requestId &&
      target.searchParams.get("token") === accessToken
    );
  } catch {
    return false;
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
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
