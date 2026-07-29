import { logger } from "firebase-functions";
import { db } from "../config/firebase";
import { refs } from "../firestore/refs";
import { createAlimtalkLogDocument, sendAlimtalkLogEmail } from "../google/driveDocsMailer";
import type { AlimtalkCandidateDoc } from "../types/models";
import { todayKst } from "../utils/date";

interface QueueSummary {
  rebuilt: number;
  queued: number;
  blocked: number;
  approvalRequired?: boolean;
  approvalId?: string;
}

interface ProcessSummary {
  processed: number;
  sent: number;
  failed: number;
  deferred?: number;
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
  const surveyStats = await surveyFlowStats(studioId, date);
  const body = buildReportBody({
    date,
    queueSummary: input.queueSummary,
    processSummary: input.processSummary,
    candidates,
    surveyStats,
  });
  const status = reportStatus(input.processSummary, surveyStats);
  const title = `ARCHIVE IN 알림톡 발송 로그 ${date}`;
  const document = await createAlimtalkLogDocument({ title, body });
  const emailBody = `${body}\n\n구글드라이브 로그 문서\n${document.url}\n`;
  await sendAlimtalkLogEmail({
    subject: `[알림톡][${status === "failure" ? "실패" : "성공"}] 발송 로그 ${date}`,
    body: emailBody,
    status,
  });
  logger.info("sendDailyAlimtalkReport completed", {
    studioId,
    date,
    documentUrl: document.url,
    candidateCount: candidates.length,
  });
  return { documentUrl: document.url };
}

function reportStatus(
  processSummary: ProcessSummary,
  surveyStats: { submitted: number; staffSent: number; memoFailed: number },
): "success" | "failure" {
  return processSummary.failed > 0 || surveyStats.memoFailed > 0 ? "failure" : "success";
}

async function listDailyCandidates(studioId: string, date: string): Promise<AlimtalkCandidateDoc[]> {
  const snap = await refs.alimtalkCandidates().where("sourceDate", "==", date).limit(500).get();
  return snap.docs
    .map((doc) => doc.data())
    .filter((candidate) => candidate.studioId === studioId)
    .sort((a, b) =>
      `${statusSort(a.status)}_${a.memberName}`.localeCompare(`${statusSort(b.status)}_${b.memberName}`, "ko"),
    );
}

function buildReportBody(input: {
  date: string;
  queueSummary: QueueSummary;
  processSummary: ProcessSummary;
  candidates: AlimtalkCandidateDoc[];
  surveyStats: { submitted: number; staffSent: number; memoFailed: number };
}): string {
  const now = formatKstNow();
  const sent = input.candidates.filter((candidate) => candidate.status === "sent");
  const skipped = input.candidates.filter((candidate) => candidate.status === "skipped");
  const failed = input.candidates.filter((candidate) => candidate.status === "failed");
  const remaining = input.candidates.filter((candidate) => !["sent", "skipped", "failed"].includes(candidate.status));
  const autoSent = sent.filter(
    (candidate) => candidate.queuedBy === "auto" || candidate.reviewedByUid?.startsWith("system:"),
  );
  const operatorSent = sent.filter(
    (candidate) => candidate.queuedBy === "operator" && !candidate.reviewedByUid?.startsWith("system:"),
  );

  return [
    "ARCHIVE IN 알림톡 발송 로그",
    "",
    `기준일: ${input.date}`,
    `생성시각: ${now}`,
    "발송구분: 자동화 발송 / 운영자 승인 발송 구분 기록",
    "",
    "요약",
    `- 후보 재계산: ${input.queueSummary.rebuilt}건`,
    `- 자동 큐 전환: ${input.queueSummary.queued}건`,
    `- 자동 큐 제외/보류: ${input.queueSummary.blocked}건`,
    `- 대량 발송 승인 대기: ${input.queueSummary.approvalRequired ? `예 (${input.queueSummary.approvalId || ""})` : "아니오"}`,
    `- 큐 처리: ${input.processSummary.processed}건`,
    `- 발송 성공: ${input.processSummary.sent}건`,
    `- 발송 실패: ${input.processSummary.failed}건`,
    `- 템플릿 상태 재시도 대기: ${input.processSummary.deferred || 0}건`,
    `- 중복/예외 차단: ${skipped.length}건`,
    `- 자동화 발송 성공: ${autoSent.length}건`,
    `- 운영자 승인 발송 성공: ${operatorSent.length}건`,
    `- 설문 제출: ${input.surveyStats.submitted}건`,
    `- 강사 설문 알림 발송: ${input.surveyStats.staffSent}건`,
    `- StudioMate 메모쓰기 확인필요: ${input.surveyStats.memoFailed}건`,
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

async function surveyFlowStats(
  studioId: string,
  date: string,
): Promise<{ submitted: number; staffSent: number; memoFailed: number }> {
  const [surveySnap, staffSendSnap, memoJobSnap] = await Promise.all([
    refs.privateSurveyResponses().where("studioId", "==", studioId).limit(300).get(),
    refs.alimtalkSends().where("studioId", "==", studioId).where("status", "==", "done").limit(300).get(),
    db
      .collection("studiomateMemoWriteJobs")
      .where("studioId", "==", studioId)
      .where("status", "in", ["failed", "retry"])
      .limit(300)
      .get(),
  ]);
  const submitted = surveySnap.docs.filter(
    (doc) => dateText(doc.data().createdAt) === date || dateText(doc.data().submittedAt) === date,
  ).length;
  const staffSent = staffSendSnap.docs
    .map((doc) => doc.data())
    .filter(
      (send) =>
        /^group_survey_staff_|^private_survey_staff_/.test(send.sendId || "") && dateText(send.updatedAt) === date,
    ).length;
  const memoFailed = memoJobSnap.docs
    .map((doc) => doc.data())
    .filter(
      (job) => /^group_survey_|^private_survey_/.test(job.jobId || "") && dateText(job.updatedAt) === date,
    ).length;
  return { submitted, staffSent, memoFailed };
}

function dateText(value: FirebaseFirestore.Timestamp | null | undefined): string {
  const date = value?.toDate?.();
  if (!date) return "";
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(date);
}

function candidateLine(candidate: AlimtalkCandidateDoc): string {
  const mode =
    candidate.queuedBy === "auto" || candidate.reviewedByUid?.startsWith("system:") ? "자동화" : "운영자 승인";
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
    reservation_open: "수업예약오픈안내",
    new_member: "신규회원 웰컴",
    private_survey: "프라이빗 사전설문",
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
