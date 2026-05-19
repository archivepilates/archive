import { createHash, createHmac } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { DEFAULT_STUDIO_ID } from "../config/constants";
import { privateSurveyWebhookSecret } from "../config/secrets";
import { refs } from "../firestore/refs";
import type { BookingDoc, MemberProfileDoc, PrivateSurveyResponseDoc } from "../types/models";
import { enqueueMemberMemoJob } from "../queue/enqueueWriteJob";
import { nowTimestamp } from "../utils/date";
import { stableHash } from "../utils/hash";

const PUBLIC_VIEW_BASE_URL =
  process.env.PRIVATE_SURVEY_VIEW_BASE_URL ||
  "https://asia-northeast3-archive-pilates.cloudfunctions.net/privateSurveyResponseView";

interface SurveyIngestPayload {
  spreadsheetId?: string;
  sheetName?: string;
  rowNumber?: number;
  submittedAt?: string;
  experienceType?: string;
  memberName?: string;
  memberPhone?: string;
  answers?: Record<string, unknown>;
}

interface NormalizedSurveyPayload {
  spreadsheetId: string;
  sheetName: string;
  rowNumber: number;
  submittedAt: string;
  experienceType: string;
  memberName: string;
  memberPhone: string;
  answers: Record<string, string>;
}

interface SurveySummary {
  goal: string;
  focusArea: string;
  painOrMedicalNote: string;
  exerciseLevel: string;
  concernOrDifficulty: string;
  expectationOrImportantFactor: string;
  referralSource: string;
  lifestyleOrPreviousIssue: string;
}

interface MatchResult {
  status: PrivateSurveyResponseDoc["matching"]["status"];
  memberId: string;
  memberName: string;
  memberPhone: string;
  bookingId: string;
  lectureId: string;
  lectureDate: string;
  lectureStartAt: Timestamp | null;
  staffId: string;
  staffName: string;
  reason: string;
}

export async function ingestPrivateSurveyResponseHandler(request: any, response: any): Promise<void> {
  setCors(response);
  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return;
  }
  if (request.method !== "POST") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  try {
    assertWebhookSecret(request);
    const payload = normalizePayload(request.body || {});
    const responseId = responseIdFor(payload);
    const accessToken = accessTokenFor(responseId);
    const detailUrl = detailUrlFor(responseId, accessToken);
    const matching = await matchSurveyToMember(payload);
    const summary = summarizeAnswers(payload);
    const doc = await buildSurveyDoc({ payload, responseId, accessToken, detailUrl, matching, summary });
    await refs.privateSurveyResponse(responseId).set(doc, { merge: true });

    let memoJobId = "";
    let memoStatus: PrivateSurveyResponseDoc["delivery"]["studioMateMemoStatus"] = "skipped";
    if (matching.memberId) {
      const memoContent = studioMateMemoContent(doc);
      const job = await enqueueMemberMemoJob({
        studioId: doc.studioId,
        memberId: matching.memberId,
        content: memoContent,
        createdByUid: "system:private-survey-ingest",
      });
      memoJobId = job.jobId;
      memoStatus = "queued";
    }

    await refs.privateSurveyResponse(responseId).set(
      {
        delivery: {
          ...doc.delivery,
          studioMateMemoStatus: memoStatus,
          studioMateMemoJobId: memoJobId,
        },
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );

    response.status(200).json({
      ok: true,
      responseId,
      detailUrl,
      matching,
      studioMateMemoStatus: memoStatus,
      studioMateMemoJobId: memoJobId,
      alimtalkStatus: "skipped",
      alimtalkReason: doc.delivery.alimtalkReason,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("ingestPrivateSurveyResponse failed", { message });
    response.status(400).json({ ok: false, error: message });
  }
}

export async function privateSurveyResponseViewHandler(request: any, response: any): Promise<void> {
  const responseId = String(request.query?.id || "");
  const accessToken = String(request.query?.token || "");
  response.set("Cache-Control", "no-store");
  if (!responseId || !accessToken) {
    response.status(400).send(renderMessagePage("설문 링크가 올바르지 않습니다."));
    return;
  }
  const snap = await refs.privateSurveyResponse(responseId).get();
  const doc = snap.data();
  if (!doc || sha256(accessToken) !== doc.accessTokenHash) {
    response.status(403).send(renderMessagePage("설문을 열 수 있는 권한이 없습니다."));
    return;
  }
  response.status(200).send(renderSurveyPage(doc));
}

function setCors(response: any): void {
  response.set("Access-Control-Allow-Origin", "*");
  response.set("Access-Control-Allow-Methods", "POST,OPTIONS");
  response.set("Access-Control-Allow-Headers", "Content-Type,X-Archive-Survey-Secret");
}

function assertWebhookSecret(request: any): void {
  const expected = privateSurveyWebhookSecret.value();
  const actual = String(request.get?.("X-Archive-Survey-Secret") || request.body?.secret || "");
  if (!expected || actual !== expected) throw new Error("invalid webhook secret");
}

function normalizePayload(input: Record<string, unknown>): NormalizedSurveyPayload {
  const answers = normalizeAnswers((input.answers || {}) as Record<string, unknown>);
  const payload = {
    spreadsheetId: stringValue(input.spreadsheetId),
    sheetName: stringValue(input.sheetName || "설문지 응답 시트1"),
    rowNumber: Number(input.rowNumber || 0),
    submittedAt: stringValue(input.submittedAt || answers["타임스탬프"]),
    experienceType: stringValue(input.experienceType || answers["필라테스 운동경험이 있으신가요?"]),
    memberName: stringValue(input.memberName || firstFilled(answers, ["1. 성함을 입력해주세요"])),
    memberPhone: normalizePhone(stringValue(input.memberPhone || firstFilled(answers, ["2. 연락처를 입력해주세요"]))),
    answers,
  };
  if (!payload.spreadsheetId || !payload.sheetName || !payload.rowNumber) throw new Error("source is required");
  if (!payload.memberName || !payload.memberPhone) throw new Error("member name/phone is required");
  return payload;
}

function normalizeAnswers(answers: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(answers).map(([key, value]) => [key.trim(), stringValue(value)]));
}

function responseIdFor(payload: NormalizedSurveyPayload): string {
  return `psr_${stableHash({
    spreadsheetId: payload.spreadsheetId,
    sheetName: payload.sheetName,
    rowNumber: payload.rowNumber,
  }).slice(0, 28)}`;
}

function accessTokenFor(responseId: string): string {
  return createHmac("sha256", privateSurveyWebhookSecret.value()).update(responseId).digest("hex").slice(0, 40);
}

function detailUrlFor(responseId: string, accessToken: string): string {
  const url = new URL(PUBLIC_VIEW_BASE_URL);
  url.searchParams.set("id", responseId);
  url.searchParams.set("token", accessToken);
  return url.toString();
}

async function buildSurveyDoc(input: {
  payload: NormalizedSurveyPayload;
  responseId: string;
  accessToken: string;
  detailUrl: string;
  matching: MatchResult;
  summary: SurveySummary;
}): Promise<PrivateSurveyResponseDoc> {
  const now = nowTimestamp();
  return {
    responseId: input.responseId,
    studioId: DEFAULT_STUDIO_ID,
    source: {
      spreadsheetId: input.payload.spreadsheetId,
      sheetName: input.payload.sheetName,
      rowNumber: input.payload.rowNumber,
    },
    submittedAt: parseKoreanTimestamp(input.payload.submittedAt),
    submittedAtText: input.payload.submittedAt,
    memberName: input.payload.memberName,
    memberPhone: input.payload.memberPhone,
    memberPhoneLast4: input.payload.memberPhone.slice(-4),
    experienceType: input.payload.experienceType,
    summary: input.summary,
    rawAnswers: input.payload.answers,
    matching: input.matching,
    delivery: {
      detailUrl: input.detailUrl,
      studioMateMemoStatus: "pending",
      studioMateMemoJobId: "",
      alimtalkStatus: "skipped",
      alimtalkReason: "담당강사 설문 제출 알림용 승인 템플릿이 없어 알림톡 발송을 보류했습니다.",
    },
    accessTokenHash: sha256(input.accessToken),
    createdAt: now,
    updatedAt: now,
  };
}

async function matchSurveyToMember(payload: NormalizedSurveyPayload): Promise<MatchResult> {
  const phoneLast4 = payload.memberPhone.slice(-4);
  const profileSnap = await refs
    .memberProfiles()
    .where("studioId", "==", DEFAULT_STUDIO_ID)
    .where("phoneLast4", "==", phoneLast4)
    .get();
  const profiles = profileSnap.docs
    .map((snap) => snap.data())
    .filter((profile) => normalizePhone(profile.phone || "") === payload.memberPhone);

  if (!profiles.length) return emptyMatch("not_found", "전화번호와 일치하는 StudioMate 회원을 찾지 못했습니다.");
  if (profiles.length > 1) return emptyMatch("ambiguous", "전화번호가 같은 회원이 여러 명입니다.");

  const profile = profiles[0];
  const booking = await nearestBooking(profile, payload.submittedAt);
  if (!booking) {
    return {
      ...emptyMatch("no_booking", "회원은 찾았지만 예정된 프라이빗 예약을 찾지 못했습니다."),
      memberId: profile.memberId,
      memberName: profile.name,
      memberPhone: profile.phone || "",
    };
  }

  return {
    status: "matched",
    memberId: profile.memberId,
    memberName: profile.name,
    memberPhone: profile.phone || "",
    bookingId: booking.bookingId,
    lectureId: booking.lectureId,
    lectureDate: booking.lectureDate,
    lectureStartAt: booking.lectureStartAt || null,
    staffId: booking.staffId,
    staffName: booking.staffName,
    reason: "전화번호 완전일치 후 가장 가까운 예정 프라이빗 예약에 매칭했습니다.",
  };
}

async function nearestBooking(profile: MemberProfileDoc, submittedAtText: string): Promise<BookingDoc | null> {
  const submittedDate = formatDate(parseKoreanTimestamp(submittedAtText)?.toDate() || new Date());
  const snap = await refs.bookings().where("memberId", "==", profile.memberId).get();
  const bookings = snap.docs
    .map((doc) => doc.data())
    .filter((booking) => booking.appStatus === "reserved" && booking.lectureDate >= submittedDate)
    .sort((a, b) => {
      if (a.lectureDate !== b.lectureDate) return a.lectureDate.localeCompare(b.lectureDate);
      return (a.lectureStartAt?.toMillis() || 0) - (b.lectureStartAt?.toMillis() || 0);
    });
  const privateBooking = bookings.find((booking) => /프라이빗|개인|1:1/i.test(booking.ticketName || ""));
  return privateBooking || bookings[0] || null;
}

function emptyMatch(status: MatchResult["status"], reason: string): MatchResult {
  return {
    status,
    memberId: "",
    memberName: "",
    memberPhone: "",
    bookingId: "",
    lectureId: "",
    lectureDate: "",
    lectureStartAt: null,
    staffId: "",
    staffName: "",
    reason,
  };
}

function summarizeAnswers(payload: NormalizedSurveyPayload): SurveySummary {
  const a = payload.answers;
  const beginner = payload.experienceType.includes("초보");
  return {
    goal: beginner ? a["3. 필라테스를 시작하려는 가장 큰 이유는 무엇인가요?"] || "" : a["8. 현재 운동 목표는 무엇인가요?"] || "",
    focusArea: beginner ? a["4. 현재 가장 신경 쓰이는 부위는 어디인가요?"] || "" : a["6. 현재 불편하거나 개선이 필요한 부위는?"] || "",
    painOrMedicalNote: beginner
      ? a["5. 통증이나 불편한 부위가 있다면 적어주세요"] || ""
      : a["7. 통증 / 병력 / 수술 경험이 있다면 작성해주세요"] || "",
    exerciseLevel: beginner
      ? a["6. 운동 경험은 어떤 편인가요?"] || ""
      : [a["3. 필라테스 경험 기간은 어느 정도이신가요?"], a["4. 주로 어떤 수업을 받아보셨나요?"], a["9. 본인의 운동 수준은 어느 정도라고 생각하시나요?"]]
          .filter(Boolean)
          .join(" / "),
    concernOrDifficulty: beginner
      ? a["9. 운동을 시작할 때 가장 걱정되는 부분은 무엇인가요?"] || ""
      : a["10. 운동 시 가장 어려운 부분은 무엇인가요?"] || "",
    expectationOrImportantFactor: beginner
      ? a["10. 아카이브필라테스를 통해 기대하는 변화는 무엇인가요?"] || ""
      : a["11. 프라이빗 수업 진행 시 중요하게 생각하는 요소는 무엇인가요?"] || "",
    referralSource: beginner
      ? a["11. 아카이브필라테스를 어떻게 알게 되셨나요?"] || ""
      : a["12. 아카이브필라테스를 어떻게 알게 되셨나요?"] || "",
    lifestyleOrPreviousIssue: beginner
      ? [a["7. 평소 생활패턴은 어떤 편인가요?"], a["8. 가장 먼저 바꾸고 싶은 부분은 무엇인가요?"]].filter(Boolean).join(" / ")
      : a["5. 이전 수업에서 아쉬웠던 점은 무엇인가요?"] || "",
  };
}

function studioMateMemoContent(doc: PrivateSurveyResponseDoc): string {
  return [
    "[첫 프라이빗 사전설문]",
    `제출: ${doc.submittedAtText}`,
    `설문 확인: ${doc.delivery.detailUrl}`,
    doc.matching.staffName ? `담당강사: ${doc.matching.staffName}` : "",
    "설문 전문은 링크에서 확인",
  ]
    .filter(Boolean)
    .join("\n");
}

function parseKoreanTimestamp(value: string): Timestamp | null {
  const match = value.match(/^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\s*(오전|오후)\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  const [, year, month, day, ampm, hourText, minute, second] = match;
  let hour = Number(hourText);
  if (ampm === "오후" && hour < 12) hour += 12;
  if (ampm === "오전" && hour === 12) hour = 0;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), hour - 9, Number(minute), Number(second || 0)));
  return Timestamp.fromDate(date);
}

function renderSurveyPage(doc: PrivateSurveyResponseDoc): string {
  const submitted = doc.submittedAt?.toDate?.()
    ? new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(doc.submittedAt.toDate())
    : doc.submittedAtText;
  const rows = [
    ["운동 목적", doc.summary.goal],
    ["신경 부위", doc.summary.focusArea],
    ["통증/병력", doc.summary.painOrMedicalNote],
    ["운동 수준", doc.summary.exerciseLevel],
    ["걱정/어려움", doc.summary.concernOrDifficulty],
    ["기대/중요 요소", doc.summary.expectationOrImportantFactor],
    ["유입경로", doc.summary.referralSource],
    ["생활/이전 아쉬움", doc.summary.lifestyleOrPreviousIssue],
  ];
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ARCHIVE IN 사전설문</title>
  <style>
    :root { color-scheme: light; --ink:#181512; --muted:#746b62; --line:#e6ded5; --paper:#fffdf9; --accent:#2f6f68; --soft:#eef5f2; }
    * { box-sizing: border-box; }
    body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR",sans-serif; background:#f6f1eb; color:var(--ink); }
    main { width:min(720px,100%); margin:0 auto; padding:18px 14px 36px; }
    .top { padding:18px 2px 12px; }
    .eyebrow { font-size:12px; font-weight:800; color:var(--accent); }
    h1 { margin:6px 0 8px; font-size:28px; line-height:1.15; letter-spacing:0; }
    .meta { color:var(--muted); font-size:14px; line-height:1.55; }
    .panel { background:var(--paper); border:1px solid var(--line); border-radius:8px; padding:16px; margin:12px 0; }
    .match { background:var(--soft); border-color:#c9ddd7; }
    .label { font-size:12px; color:var(--muted); font-weight:800; margin-bottom:6px; }
    .value { font-size:16px; line-height:1.55; white-space:pre-wrap; word-break:keep-all; overflow-wrap:anywhere; }
    .grid { display:grid; gap:10px; }
    .small { font-size:13px; color:var(--muted); line-height:1.5; }
    footer { padding:12px 2px; color:var(--muted); font-size:12px; }
  </style>
</head>
<body>
  <main>
    <section class="top">
      <div class="eyebrow">ARCHIVE IN · 첫 프라이빗 사전설문</div>
      <h1>${escapeHtml(doc.memberName)} 회원</h1>
      <div class="meta">제출 ${escapeHtml(submitted)}<br>경험구분 ${escapeHtml(doc.experienceType || "-")}</div>
    </section>
    <section class="panel match">
      <div class="label">담당 수업 매칭</div>
      <div class="value">${escapeHtml(matchText(doc))}</div>
    </section>
    <section class="grid">
      ${rows.map(([label, value]) => answerBlock(label, value)).join("")}
    </section>
    <section class="panel">
      <div class="label">원본 위치</div>
      <div class="small">Google Sheets ${escapeHtml(doc.source.sheetName)} · ${doc.source.rowNumber}행</div>
    </section>
    <footer>설문 내용은 수업 준비 목적의 내부 자료입니다.</footer>
  </main>
</body>
</html>`;
}

function answerBlock(label: string, value: string): string {
  return `<section class="panel"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value || "-")}</div></section>`;
}

function matchText(doc: PrivateSurveyResponseDoc): string {
  if (doc.matching.status !== "matched") return doc.matching.reason;
  const time = doc.matching.lectureStartAt?.toDate?.()
    ? new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(doc.matching.lectureStartAt.toDate())
    : doc.matching.lectureDate;
  return `${doc.matching.staffName || "담당강사 미확인"} · ${time}`;
}

function renderMessagePage(message: string): string {
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><body style="font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif;margin:0;padding:24px;background:#f6f1eb;color:#181512"><main style="max-width:520px;margin:auto;background:#fffdf9;border:1px solid #e6ded5;border-radius:8px;padding:20px"><strong>ARCHIVE IN</strong><p>${escapeHtml(message)}</p></main></body></html>`;
}

function firstFilled(answers: Record<string, string>, labels: string[]): string {
  for (const label of labels) {
    const matches = Object.entries(answers).filter(([key, value]) => key === label && value);
    if (matches.length) return matches[0][1];
  }
  return "";
}

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("82")) return `0${digits.slice(2)}`;
  return digits;
}

function stringValue(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(date);
}

function escapeHtml(value: string): string {
  return String(value).replace(/[&<>"']/g, (char) => {
    const chars: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return chars[char] || char;
  });
}
