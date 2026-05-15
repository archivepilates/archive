import { logger } from "firebase-functions";
import { refs } from "../firestore/refs";
import { createAlimtalkLogDocument, sendAlimtalkLogEmail } from "../google/driveDocsMailer";
import type { AlimtalkCandidateDoc } from "../types/models";
import { todayKst } from "../utils/date";

interface QueueSummary {
  rebuilt: number;
  queued: number;
  blocked: number;
}

interface ProcessSummary {
  processed: number;
  sent: number;
  failed: number;
}

export async function sendDailyAlimtalkReport(input: {
  studioId?: string;
  date?: string;
  queueSummary: QueueSummary;
  processSummary: ProcessSummary;
}): Promise<{ documentUrl: string }> {
  const studioId = input.studioId || "5330";
  const date = input.date || todayKst();
  const candidates = await listDailyCandidates(studioId, date);
  const body = buildReportBody({
    date,
    queueSummary: input.queueSummary,
    processSummary: input.processSummary,
    candidates,
  });
  const title = `ArchiveIN 알림톡 발송 로그 ${date}`;
  const document = await createAlimtalkLogDocument({ title, body });
  const emailBody = `${body}\n\n구글드라이브 로그 문서\n${document.url}\n`;
  await sendAlimtalkLogEmail({
    subject: `[ArchiveIN] 알림톡 발송 로그 ${date}`,
    body: emailBody,
  });
  logger.info("sendDailyAlimtalkReport completed", {
    studioId,
    date,
    documentUrl: document.url,
    candidateCount: candidates.length,
  });
  return { documentUrl: document.url };
}

async function listDailyCandidates(studioId: string, date: string): Promise<AlimtalkCandidateDoc[]> {
  const snap = await refs.alimtalkCandidates().where("sourceDate", "==", date).limit(500).get();
  return snap.docs
    .map((doc) => doc.data())
    .filter((candidate) => candidate.studioId === studioId)
    .sort((a, b) => `${statusSort(a.status)}_${a.memberName}`.localeCompare(`${statusSort(b.status)}_${b.memberName}`, "ko"));
}

function buildReportBody(input: {
  date: string;
  queueSummary: QueueSummary;
  processSummary: ProcessSummary;
  candidates: AlimtalkCandidateDoc[];
}): string {
  const now = formatKstNow();
  const sent = input.candidates.filter((candidate) => candidate.status === "sent");
  const skipped = input.candidates.filter((candidate) => candidate.status === "skipped");
  const failed = input.candidates.filter((candidate) => candidate.status === "failed");
  const remaining = input.candidates.filter((candidate) => !["sent", "skipped", "failed"].includes(candidate.status));
  const autoSent = sent.filter((candidate) => candidate.queuedBy === "auto" || candidate.reviewedByUid?.startsWith("system:"));
  const operatorSent = sent.filter((candidate) => candidate.queuedBy === "operator" && !candidate.reviewedByUid?.startsWith("system:"));

  return [
    "ArchiveIN 알림톡 발송 로그",
    "",
    `기준일: ${input.date}`,
    `생성시각: ${now}`,
    "발송구분: 자동화 발송 / 운영자 승인 발송 구분 기록",
    "",
    "요약",
    `- 후보 재계산: ${input.queueSummary.rebuilt}건`,
    `- 자동 큐 전환: ${input.queueSummary.queued}건`,
    `- 자동 큐 제외/보류: ${input.queueSummary.blocked}건`,
    `- 큐 처리: ${input.processSummary.processed}건`,
    `- 발송 성공: ${input.processSummary.sent}건`,
    `- 발송 실패: ${input.processSummary.failed}건`,
    `- 중복/예외 차단: ${skipped.length}건`,
    `- 자동화 발송 성공: ${autoSent.length}건`,
    `- 운영자 승인 발송 성공: ${operatorSent.length}건`,
    "",
    "발송 완료",
    ...linesOrEmpty(sent.map(candidateLine)),
    "",
    "제외/차단",
    ...linesOrEmpty(skipped.map(candidateLine)),
    "",
    "실패",
    ...linesOrEmpty(failed.map(candidateLine)),
    "",
    "미처리/대기",
    ...linesOrEmpty(remaining.map(candidateLine)),
    "",
  ].join("\n");
}

function candidateLine(candidate: AlimtalkCandidateDoc): string {
  const mode = candidate.queuedBy === "auto" || candidate.reviewedByUid?.startsWith("system:") ? "자동화" : "운영자 승인";
  const ticket = candidate.payload?.ticketName || candidate.payload?.ticket || "";
  const detail = ticket ? ` / ${ticket}` : "";
  const error = candidate.lastError ? ` / ${candidate.lastError}` : "";
  return `- ${candidate.memberName} / ${templateLabel(candidate.type)} / ${candidate.status} / ${mode}${detail}${error}`;
}

function linesOrEmpty(lines: string[]): string[] {
  return lines.length ? lines : ["- 없음"];
}

function templateLabel(type: string): string {
  const labels: Record<string, string> = {
    new_member: "신규회원 웰컴",
    ticket_expiring: "그룹 기간 만료",
    remaining_low: "그룹 횟수 부족",
    private_count_low: "개인 횟수 부족",
    private_ticket_expiring: "개인 기간 만료",
    long_absence: "장기 미출석",
    manual_review: "수동 검토",
  };
  return labels[type] || type;
}

function statusSort(status: string): number {
  const order: Record<string, number> = {
    sent: 1,
    failed: 2,
    skipped: 3,
    queued: 4,
    processing: 5,
    reviewed: 6,
    candidate: 7,
  };
  return order[status] || 99;
}

function formatKstNow(): string {
  const date = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return `${date.toISOString().slice(0, 19).replace("T", " ")} KST`;
}
