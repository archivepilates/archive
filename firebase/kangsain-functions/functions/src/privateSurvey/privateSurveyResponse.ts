import { createHash, createHmac, randomBytes } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import type { FirestoreEvent, QueryDocumentSnapshot } from "firebase-functions/v2/firestore";
import { DEFAULT_STUDIO_ID } from "../config/constants";
import { privateSurveyWebhookSecret, solapiApiKey, solapiApiSecret, solapiPfid } from "../config/secrets";
import { db } from "../config/firebase";
import { refs } from "../firestore/refs";
import type { AlimtalkCandidateDoc, BookingDoc, MemberProfileDoc, PrivateSurveyResponseDoc } from "../types/models";
import { ALIMTALK_TEMPLATES } from "../alimtalk/templates";
import { nowTimestamp } from "../utils/date";
import { stableHash } from "../utils/hash";
import { DelegatedGoogleClient } from "../google/delegatedGoogleClient";
import { getStaffById } from "../firestore/staffRepository";
import { isAlimtalkTemplateApproved } from "../alimtalk/templateStatus";
import { surveyDetailButtonUrlLengthIssue } from "../alimtalk/templateTargetRules";
import { sendAlimtalkLogEmail } from "../google/driveDocsMailer";
import { ensureShortLink } from "../utils/shortLinks";

const PUBLIC_VIEW_BASE_URL =
  process.env.PRIVATE_SURVEY_VIEW_BASE_URL || "https://in.archivepilates.com/privateSurveyResponseView";
const PRIVATE_SURVEY_SPREADSHEET_ID =
  process.env.PRIVATE_SURVEY_SPREADSHEET_ID || "19KlHxFl71fCVRRy8oz93lSfTjj0z4783K5EFO4_KnTk";
const PRIVATE_SURVEY_SHEET_NAME = process.env.PRIVATE_SURVEY_SHEET_NAME || "설문지 응답 시트1";
const OUTPUT_HEADERS = [
  "설문ID",
  "접근토큰",
  "상세링크",
  "ARCHIVE IN 처리상태",
  "ARCHIVE IN 전송시각",
  "ARCHIVE IN 오류",
];
const STAFF_PRIVATE_SURVEY_TEMPLATE_ID = ALIMTALK_TEMPLATES.staff_private_survey.code;
const STAFF_GROUP_SURVEY_TEMPLATE_ID = ALIMTALK_TEMPLATES.staff_group_survey.code;
const SOLAPI_SEND_URL = "https://api.solapi.com/messages/v4/send-many/detail";
const ARCHIVE_LOGO_URL = "https://in.archivepilates.com/logo120.png";

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

interface GroupSurveyRequestDoc {
  requestId: string;
  studioId: string;
  memberId: string;
  memberName: string;
  memberPhone: string;
  memberPhoneLast4: string;
  bookingId: string;
  lectureId: string;
  lectureDate: string;
  staffId: string;
  staffName: string;
  sourceCandidateId: string;
  accessTokenHash: string;
  status: "pending" | "submitted" | "skipped";
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface GroupSurveySubmitPayload {
  requestId: string;
  accessToken: string;
  exerciseExperience: string;
  painAreas: string[];
  painNote: string;
  cautionTypes: string[];
  concern: string;
  requestNote: string;
}

export async function ingestPrivateSurveyResponseHandler(request: any, response: any): Promise<void> {
  setCors(response);
  if (isGroupSurveySubmitRequest(request)) {
    await submitGroupSurveyResponseHandler(request, response);
    return;
  }
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
    const created = await createSurveyResponseIfNew(responseId, doc);
    if (!created) {
      const existing = (await refs.privateSurveyResponse(responseId).get()).data();
      response.status(200).json({
        ok: true,
        duplicate: true,
        responseId,
        detailUrl: existing?.delivery?.detailUrl || detailUrl,
        alimtalkStatus: existing?.delivery?.alimtalkStatus || "sent",
        alimtalkReason: "이미 제출된 사전설문입니다.",
      });
      return;
    }
    const delivery = pendingStaffSurveyDelivery(doc);
    await refs.privateSurveyResponse(responseId).set({ delivery, updatedAt: nowTimestamp() }, { merge: true });
    await enqueueSurveyMemoOutputs(doc);

    response.status(200).json({
      ok: true,
      responseId,
      detailUrl,
      matching,
      alimtalkStatus: delivery.alimtalkStatus,
      alimtalkReason: delivery.alimtalkReason,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("ingestPrivateSurveyResponse failed", { message });
    response.status(400).json({ ok: false, error: message });
  }
}

function isGroupSurveySubmitRequest(request: any): boolean {
  const url = String(request.originalUrl || request.url || request.path || "");
  return url.includes("/api/groupSurveySubmit") || url.includes("groupSurveySubmit");
}

export async function processPrivateSurveyIntakeHandler(
  event: FirestoreEvent<QueryDocumentSnapshot | undefined, { intakeId: string }>,
): Promise<void> {
  const snap = event.data;
  if (!snap) return;
  const intake = snap.data() as Record<string, unknown>;
  const payload = normalizePayload(intake);
  const responseId = String(intake.responseId || responseIdFor(payload));
  const accessToken = String(intake.accessToken || accessTokenFor(responseId));
  const docKey = `${responseId}-${accessToken}`;
  if (event.params.intakeId !== docKey) {
    await snap.ref.set(
      {
        status: "failed",
        lastError: "intake id does not match responseId/accessToken",
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
    return;
  }

  try {
    await snap.ref.set({ status: "processing", updatedAt: nowTimestamp() }, { merge: true });
    const detailUrl = detailUrlFor(responseId, accessToken);
    const matching = await matchSurveyToMember(payload);
    const summary = summarizeAnswers(payload);
    const doc = await buildSurveyDoc({ payload, responseId, accessToken, detailUrl, matching, summary });
    const created = await createSurveyResponseIfNew(responseId, doc);
    if (!created) {
      const existing = (await refs.privateSurveyResponse(responseId).get()).data();
      await snap.ref.set(
        {
          status: "duplicate",
          responseId,
          accessToken,
          detailUrl: existing?.delivery?.detailUrl || detailUrl,
          delivery: existing?.delivery || null,
          updatedAt: nowTimestamp(),
        },
        { merge: true },
      );
      return;
    }

    const delivery = pendingStaffSurveyDelivery(doc);
    await refs.privateSurveyResponse(responseId).set({ delivery, updatedAt: nowTimestamp() }, { merge: true });
    await enqueueSurveyMemoOutputs(doc);
    await db.collection("privateSurveyPublic").doc(docKey).set(
      {
        responseId,
        accessToken,
        docKey,
        detailUrl,
        memberName: doc.memberName,
        memberPhoneLast4: doc.memberPhoneLast4,
        experienceType: doc.experienceType,
        submittedAtText: doc.submittedAtText,
        summary: doc.summary,
        rawAnswers: doc.rawAnswers,
        matching: doc.matching,
        delivery,
        source: doc.source,
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
    await snap.ref.set(
      {
        status: "processed",
        responseId,
        accessToken,
        detailUrl,
        matching,
        delivery,
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("processPrivateSurveyIntake failed", { intakeId: event.params.intakeId, message });
    await snap.ref.set({ status: "failed", lastError: message, updatedAt: nowTimestamp() }, { merge: true });
  }
}

export async function syncPrivateSurveyResponsesFromSheet(): Promise<{ processed: number; skipped: number }> {
  const client = new DelegatedGoogleClient([
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.readonly",
  ]);
  const rows = await readSurveySheet(client);
  if (!rows.length) return { processed: 0, skipped: 0 };

  const headers = rows[0].map((value) => String(value || "").trim());
  const headerMap = ensureHeaderMap(headers);
  await ensureSheetHeaders(client, headers, headerMap);

  let processed = 0;
  let skipped = 0;
  for (let index = 1; index < rows.length; index += 1) {
    const rowNumber = index + 1;
    const row = rows[index] || [];
    const answers = answersFromRow(headers, row);
    if (!answers["타임스탬프"]) {
      skipped += 1;
      continue;
    }
    if (cell(row, headerMap["ARCHIVE IN 처리상태"]) === "전송완료" && cell(row, headerMap["설문ID"])) {
      skipped += 1;
      continue;
    }
    const memberName = firstFilled(answers, ["1. 성함을 입력해주세요"]);
    const memberPhone = normalizePhone(firstFilled(answers, ["2. 연락처를 입력해주세요"]));
    if (!memberName || !memberPhone) {
      await updateSheetOutput(client, rowNumber, headerMap, [
        "",
        "",
        "",
        "오류",
        kstNowText(),
        "성함 또는 연락처가 비어 있습니다.",
      ]);
      skipped += 1;
      continue;
    }
    const payload = normalizePayload({
      spreadsheetId: PRIVATE_SURVEY_SPREADSHEET_ID,
      sheetName: PRIVATE_SURVEY_SHEET_NAME,
      rowNumber,
      submittedAt: answers["타임스탬프"],
      experienceType: answers["필라테스 운동경험이 있으신가요?"],
      memberName,
      memberPhone,
      answers,
    });
    const responseId = cell(row, headerMap["설문ID"]) || responseIdFor(payload);
    const accessToken = cell(row, headerMap["접근토큰"]) || accessTokenFor(responseId);
    const detailUrl = detailUrlFor(responseId, accessToken);
    const docKey = `${responseId}-${accessToken}`;
    await db.collection("privateSurveyIntakes").doc(docKey).set(
      {
        docKey,
        responseId,
        accessToken,
        spreadsheetId: PRIVATE_SURVEY_SPREADSHEET_ID,
        sheetName: PRIVATE_SURVEY_SHEET_NAME,
        rowNumber,
        submittedAt: payload.submittedAt,
        experienceType: payload.experienceType,
        memberName: payload.memberName,
        memberPhone: payload.memberPhone,
        answers: payload.answers,
        status: "pending",
        createdAt: nowTimestamp(),
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
    await updateSheetOutput(client, rowNumber, headerMap, [
      responseId,
      accessToken,
      detailUrl,
      "전송완료",
      kstNowText(),
      "",
    ]);
    processed += 1;
  }
  logger.info("syncPrivateSurveyResponsesFromSheet completed", { processed, skipped });
  return { processed, skipped };
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

export async function submitGroupSurveyResponseHandler(request: any, response: any): Promise<void> {
  setCors(response);
  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return;
  }
  try {
    if (request.method === "GET") {
      const { groupRequest } = await readGroupSurveyRequest(request.query?.id, request.query?.token);
      if (groupRequest.status === "skipped") {
        response.status(410).json({ ok: false, error: "이미 대상에서 제외된 설문입니다." });
        return;
      }
      response.status(200).json({
        ok: true,
        requestId: groupRequest.requestId,
        memberName: groupRequest.memberName,
        staffName: groupRequest.staffName,
        lessonTime: await groupLessonTime(groupRequest),
        status: groupRequest.status,
      });
      return;
    }
    if (request.method !== "POST") {
      response.status(405).json({ ok: false, error: "method_not_allowed" });
      return;
    }
    const payload = normalizeGroupSurveySubmitPayload(request.body || {});
    const { groupRequest, accessToken } = await readGroupSurveyRequest(payload.requestId, payload.accessToken);
    if (groupRequest.status === "skipped") {
      response.status(410).json({ ok: false, error: "이미 대상에서 제외된 설문입니다." });
      return;
    }
    const responseId = groupRequest.requestId;
    const detailUrl = detailUrlFor(responseId, accessToken);
    if (groupRequest.status === "submitted") {
      const existing = (await refs.privateSurveyResponse(responseId).get()).data();
      response.status(200).json({
        ok: true,
        duplicate: true,
        responseId,
        detailUrl: existing?.delivery?.detailUrl || detailUrl,
        alimtalkStatus: existing?.delivery?.alimtalkStatus || "sent",
        alimtalkReason: "이미 제출된 사전설문입니다.",
      });
      return;
    }
    const answers = groupSurveyAnswers(payload);
    const summary = summarizeGroupSurveyAnswers(payload);
    const matching = await groupSurveyMatch(groupRequest);
    const doc = await buildGroupSurveyDoc({
      groupRequest,
      responseId,
      accessToken,
      detailUrl,
      answers,
      summary,
      matching,
    });

    const created = await createSurveyResponseIfNew(responseId, doc);
    if (!created) {
      const existing = (await refs.privateSurveyResponse(responseId).get()).data();
      await db
        .collection("groupSurveyRequests")
        .doc(groupRequest.requestId)
        .set(
          {
            status: "submitted",
            responseId,
            detailUrl: existing?.delivery?.detailUrl || detailUrl,
            submittedAt: nowTimestamp(),
            updatedAt: nowTimestamp(),
          },
          { merge: true },
        );
      response.status(200).json({
        ok: true,
        duplicate: true,
        responseId,
        detailUrl: existing?.delivery?.detailUrl || detailUrl,
        alimtalkStatus: existing?.delivery?.alimtalkStatus || "sent",
        alimtalkReason: "이미 제출된 사전설문입니다.",
      });
      return;
    }
    const delivery = pendingStaffSurveyDelivery(doc);
    await refs.privateSurveyResponse(responseId).set({ delivery, updatedAt: nowTimestamp() }, { merge: true });
    await writePublicSurveyDoc(doc, accessToken, delivery);
    await enqueueSurveyMemoOutputs(doc, groupSurveyMemoContent(doc, payload));
    await db.collection("groupSurveyRequests").doc(groupRequest.requestId).set(
      {
        status: "submitted",
        responseId,
        detailUrl,
        delivery,
        submittedAt: nowTimestamp(),
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
    response.status(200).json({
      ok: true,
      responseId,
      detailUrl,
      alimtalkStatus: delivery.alimtalkStatus,
      alimtalkReason: delivery.alimtalkReason,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("submitGroupSurveyResponse failed", { message });
    response.status(400).json({ ok: false, error: message });
  }
}

function setCors(response: any): void {
  response.set("Access-Control-Allow-Origin", "*");
  response.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.set("Access-Control-Allow-Headers", "Content-Type,X-Archive-Survey-Secret");
}

function assertWebhookSecret(request: any): void {
  const expected = privateSurveyWebhookSecret.value();
  const actual = String(request.get?.("X-Archive-Survey-Secret") || request.body?.secret || "");
  if (!expected || actual !== expected) throw new Error("invalid webhook secret");
}

async function createSurveyResponseIfNew(responseId: string, doc: PrivateSurveyResponseDoc): Promise<boolean> {
  try {
    await refs.privateSurveyResponse(responseId).create(doc);
    return true;
  } catch (err: any) {
    if (Number(err?.code) === 6 || String(err?.message || "").includes("ALREADY_EXISTS")) return false;
    throw err;
  }
}

async function readGroupSurveyRequest(
  requestIdInput: unknown,
  accessTokenInput: unknown,
): Promise<{ groupRequest: GroupSurveyRequestDoc; accessToken: string }> {
  const requestId = stringValue(requestIdInput);
  const accessToken = stringValue(accessTokenInput);
  if (!/^gsr-[a-z0-9-]{8,80}$/i.test(requestId) || !/^[a-f0-9]{16,80}$/i.test(accessToken)) {
    throw new Error("설문 링크가 올바르지 않습니다.");
  }
  const snap = await db.collection("groupSurveyRequests").doc(requestId).get();
  const groupRequest = snap.data() as GroupSurveyRequestDoc | undefined;
  if (!groupRequest || groupRequest.accessTokenHash !== sha256(accessToken)) {
    throw new Error("설문을 열 수 있는 권한이 없습니다.");
  }
  return { groupRequest, accessToken };
}

function normalizeGroupSurveySubmitPayload(input: Record<string, unknown>): GroupSurveySubmitPayload {
  const payload: GroupSurveySubmitPayload = {
    requestId: stringValue(input.requestId || input.id),
    accessToken: stringValue(input.accessToken || input.token),
    exerciseExperience: stringValue(input.exerciseExperience),
    painAreas: stringArray(input.painAreas),
    painNote: stringValue(input.painNote),
    cautionTypes: stringArray(input.cautionTypes),
    concern: stringValue(input.concern),
    requestNote: stringValue(input.requestNote),
  };
  if (!payload.requestId || !payload.accessToken) throw new Error("설문 링크가 올바르지 않습니다.");
  if (!payload.exerciseExperience) throw new Error("운동 경험을 선택해주세요.");
  if (!payload.painAreas.length) throw new Error("통증/불편 부위를 선택해주세요.");
  if (!payload.cautionTypes.length) throw new Error("주의사항을 선택해주세요.");
  if (!payload.concern) throw new Error("걱정되는 부분을 선택해주세요.");
  return payload;
}

function stringArray(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return raw
    .map((item) => stringValue(item))
    .filter(Boolean)
    .slice(0, 12);
}

function groupSurveyAnswers(payload: GroupSurveySubmitPayload): Record<string, string> {
  return {
    "필라테스 또는 운동 경험": payload.exerciseExperience,
    "현재 통증이나 불편한 부위": payload.painAreas.join(", "),
    "통증이나 불편함 상세": payload.painNote,
    "수업 전 강사가 알아야 할 내용": payload.cautionTypes.join(", "),
    "첫 그룹수업에서 걱정되는 부분": payload.concern,
    "강사 참고 요청사항": payload.requestNote,
  };
}

function summarizeGroupSurveyAnswers(payload: GroupSurveySubmitPayload): SurveySummary {
  return {
    goal: payload.concern,
    focusArea: payload.painAreas.join(", "),
    painOrMedicalNote: [payload.cautionTypes.join(", "), payload.painNote].filter(Boolean).join("\n"),
    exerciseLevel: payload.exerciseExperience,
    concernOrDifficulty: payload.concern,
    expectationOrImportantFactor: payload.requestNote,
    referralSource: "",
    lifestyleOrPreviousIssue: "",
  };
}

async function groupSurveyMatch(groupRequest: GroupSurveyRequestDoc): Promise<MatchResult> {
  const booking = groupRequest.bookingId ? (await refs.booking(groupRequest.bookingId).get()).data() : null;
  return {
    status: "matched",
    memberId: groupRequest.memberId,
    memberName: groupRequest.memberName,
    memberPhone: groupRequest.memberPhone,
    bookingId: groupRequest.bookingId,
    lectureId: groupRequest.lectureId,
    lectureDate: booking?.lectureDate || groupRequest.lectureDate,
    lectureStartAt: booking?.lectureStartAt || null,
    staffId: booking?.staffId || groupRequest.staffId,
    staffName: booking?.staffName || groupRequest.staffName,
    reason: "첫 그룹수업 예약 자동매칭",
  };
}

async function groupLessonTime(groupRequest: GroupSurveyRequestDoc): Promise<string> {
  const matching = await groupSurveyMatch(groupRequest);
  return lessonTimeText({
    matching,
  } as PrivateSurveyResponseDoc);
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
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(answers)) {
    const header = key.trim();
    const text = stringValue(value);
    if (!header) continue;
    if (normalized[header] && !text) continue;
    normalized[header] = text || normalized[header] || "";
  }
  return normalized;
}

function responseIdFor(payload: NormalizedSurveyPayload): string {
  return `psr-${stableHash({
    spreadsheetId: payload.spreadsheetId,
    sheetName: payload.sheetName,
    rowNumber: payload.rowNumber,
  }).slice(0, 12)}`;
}

function accessTokenFor(responseId: string): string {
  return createHmac("sha256", privateSurveyWebhookSecret.value()).update(responseId).digest("hex").slice(0, 16);
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
      alimtalkStatus: "pending",
      alimtalkReason: "강사 알림톡 발송 대기",
    },
    accessTokenHash: sha256(input.accessToken),
    createdAt: now,
    updatedAt: now,
  };
}

async function buildGroupSurveyDoc(input: {
  groupRequest: GroupSurveyRequestDoc;
  responseId: string;
  accessToken: string;
  detailUrl: string;
  answers: Record<string, string>;
  summary: SurveySummary;
  matching: MatchResult;
}): Promise<PrivateSurveyResponseDoc> {
  const now = nowTimestamp();
  return {
    responseId: input.responseId,
    studioId: input.groupRequest.studioId || DEFAULT_STUDIO_ID,
    surveyType: "group",
    source: {
      spreadsheetId: "ARCHIVE_IN_GROUP_SURVEY",
      sheetName: "groupSurvey",
      rowNumber: 0,
    },
    submittedAt: now,
    submittedAtText: kstNowText(),
    memberName: input.groupRequest.memberName,
    memberPhone: input.groupRequest.memberPhone,
    memberPhoneLast4: input.groupRequest.memberPhoneLast4 || input.groupRequest.memberPhone.slice(-4),
    experienceType: input.answers["필라테스 또는 운동 경험"] || "",
    summary: input.summary,
    rawAnswers: input.answers,
    matching: input.matching,
    delivery: {
      detailUrl: input.detailUrl,
      alimtalkStatus: "pending",
      alimtalkReason: "그룹 사전확인 강사 알림톡 발송 대기",
    },
    accessTokenHash: sha256(input.accessToken),
    createdAt: now,
    updatedAt: now,
  };
}

async function writePublicSurveyDoc(
  doc: PrivateSurveyResponseDoc,
  accessToken: string,
  delivery: PrivateSurveyResponseDoc["delivery"],
): Promise<void> {
  const docKey = `${doc.responseId}-${accessToken}`;
  await db
    .collection("privateSurveyPublic")
    .doc(docKey)
    .set(
      {
        responseId: doc.responseId,
        surveyType: doc.surveyType || "private",
        accessToken,
        docKey,
        detailUrl: delivery.detailUrl,
        memberName: doc.memberName,
        memberPhoneLast4: doc.memberPhoneLast4,
        experienceType: doc.experienceType,
        submittedAtText: doc.submittedAtText,
        summary: doc.summary,
        rawAnswers: doc.rawAnswers,
        matching: doc.matching,
        delivery,
        source: doc.source,
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
}

export async function processDueStaffSurveyAlimtalks(): Promise<{ checked: number; sent: number; failed: number }> {
  const snap = await refs
    .privateSurveyResponses()
    .where("delivery.alimtalkStatus", "in", ["pending", "failed"])
    .limit(100)
    .get();
  let checked = 0;
  let sent = 0;
  let failed = 0;
  const nowMs = Date.now();

  for (const docSnap of snap.docs) {
    const doc = docSnap.data();
    checked += 1;
    if (isStaffSurveyAlimtalkMissed(doc, nowMs)) {
      await docSnap.ref.set(
        {
          delivery: {
            ...doc.delivery,
            alimtalkStatus: "skipped",
            alimtalkReason: "수업 시작 이후라 강사 사전설문 알림톡 발송 생략",
          },
          updatedAt: nowTimestamp(),
        },
        { merge: true },
      );
      continue;
    }
    if (!isStaffSurveyAlimtalkDue(doc, nowMs)) continue;
    const accessToken = accessTokenFromDetailUrl(doc.delivery.detailUrl);
    if (!accessToken) {
      failed += 1;
      await docSnap.ref.set(
        {
          delivery: {
            ...doc.delivery,
            alimtalkStatus: "failed",
            alimtalkReason: "상세링크 접근토큰을 확인할 수 없어 강사 알림톡 발송 실패",
          },
          updatedAt: nowTimestamp(),
        },
        { merge: true },
      );
      continue;
    }

    const delivery = await deliverStaffSurveyAlimtalk(doc, accessToken);
    if (delivery.alimtalkStatus === "sent") sent += 1;
    if (delivery.alimtalkStatus === "failed") failed += 1;
    await docSnap.ref.set({ delivery, updatedAt: nowTimestamp() }, { merge: true });
    await writePublicSurveyDoc(doc, accessToken, delivery);
  }

  logger.info("processDueStaffSurveyAlimtalks completed", { checked, sent, failed });
  return { checked, sent, failed };
}

export async function processMissingSurveySubmissionAlerts(): Promise<{
  checked: number;
  due: number;
  emailed: number;
}> {
  const [privateResult, groupResult] = await Promise.all([
    processMissingPrivateSurveySubmissionAlerts(),
    processMissingGroupSurveySubmissionAlerts(),
  ]);
  const summary = {
    checked: privateResult.checked + groupResult.checked,
    due: privateResult.due + groupResult.due,
    emailed: privateResult.emailed + groupResult.emailed,
  };
  logger.info("processMissingSurveySubmissionAlerts completed", summary);
  return summary;
}

async function processMissingPrivateSurveySubmissionAlerts(): Promise<{
  checked: number;
  due: number;
  emailed: number;
}> {
  const snap = await refs.alimtalkCandidates().where("status", "==", "sent").limit(500).get();
  let checked = 0;
  let due = 0;
  let emailed = 0;
  const nowMs = Date.now();

  for (const docSnap of snap.docs) {
    const candidate = docSnap.data();
    if (candidate.type !== "private_survey") continue;
    checked += 1;
    const dueAt = privateSurveyMissingSubmissionDueAt(candidate);
    if (!dueAt || dueAt.toMillis() > nowMs) continue;
    due += 1;
    if (await hasSubmittedPrivateSurvey(candidate.memberId, candidate.memberPhone)) continue;
    const booking = await bookingForSurveyCandidate(candidate);
    const sent = await sendMissingSurveySubmissionEmailOnce({
      alertId: `private_${candidate.candidateId}`,
      surveyType: "private",
      memberName: candidate.memberName,
      memberPhone: candidate.memberPhone,
      lessonTime: booking
        ? lessonTimeText({ matching: matchFromBooking(booking) } as PrivateSurveyResponseDoc)
        : candidate.payload.lectureDate || "-",
      staffName: booking?.staffName || "",
      dueAt,
      sourceId: candidate.candidateId,
      requestOrCandidateId: candidate.candidateId,
    });
    if (sent) emailed += 1;
  }

  return { checked, due, emailed };
}

async function processMissingGroupSurveySubmissionAlerts(): Promise<{
  checked: number;
  due: number;
  emailed: number;
}> {
  const snap = await db.collection("groupSurveyRequests").where("status", "==", "pending").limit(500).get();
  let checked = 0;
  let due = 0;
  let emailed = 0;
  const nowMs = Date.now();

  for (const docSnap of snap.docs) {
    const groupRequest = docSnap.data() as GroupSurveyRequestDoc;
    checked += 1;
    const matching = await groupSurveyMatch(groupRequest);
    const dueAt = groupSurveyMissingSubmissionDueAt(matching);
    if (!dueAt || dueAt.toMillis() > nowMs) continue;
    due += 1;
    const response = await refs.privateSurveyResponse(groupRequest.requestId).get();
    if (response.exists) continue;
    const sent = await sendMissingSurveySubmissionEmailOnce({
      alertId: `group_${groupRequest.requestId}`,
      surveyType: "group",
      memberName: groupRequest.memberName,
      memberPhone: groupRequest.memberPhone,
      lessonTime: lessonTimeText({ matching } as PrivateSurveyResponseDoc),
      staffName: matching.staffName,
      dueAt,
      sourceId: groupRequest.sourceCandidateId || groupRequest.requestId,
      requestOrCandidateId: groupRequest.requestId,
    });
    if (sent) emailed += 1;
  }

  return { checked, due, emailed };
}

function privateSurveyMissingSubmissionDueAt(candidate: AlimtalkCandidateDoc): Timestamp | null {
  const lectureDate = candidate.payload.lectureDate;
  if (!lectureDate) return null;
  const due = new Date(`${lectureDate}T09:00:00+09:00`);
  if (Number.isNaN(due.getTime())) return null;
  due.setDate(due.getDate() - 1);
  return Timestamp.fromDate(due);
}

function groupSurveyMissingSubmissionDueAt(matching: MatchResult): Timestamp | null {
  const startMs = matching.lectureStartAt?.toMillis?.() || 0;
  if (!startMs) return null;
  return Timestamp.fromMillis(startMs - 60 * 60 * 1000);
}

async function bookingForSurveyCandidate(candidate: AlimtalkCandidateDoc): Promise<BookingDoc | null> {
  const bookingId = candidate.payload.bookingId || "";
  if (bookingId) {
    const booking = (await refs.booking(bookingId).get()).data();
    if (booking) return booking;
  }
  if (!candidate.memberId || !candidate.payload.lectureDate) return null;
  const snap = await refs.bookings().where("memberId", "==", candidate.memberId).get();
  return (
    snap.docs
      .map((doc) => doc.data())
      .filter((booking) => booking.lectureDate === candidate.payload.lectureDate && isPrivateBookingTicket(booking))
      .sort((a, b) => (a.lectureStartAt?.toMillis() || 0) - (b.lectureStartAt?.toMillis() || 0))[0] || null
  );
}

async function hasSubmittedPrivateSurvey(memberId: string, memberPhone: string): Promise<boolean> {
  const byMember = memberId
    ? await refs.privateSurveyResponses().where("matching.memberId", "==", memberId).limit(10).get()
    : null;
  if (
    byMember?.docs.some(
      (doc) => (doc.data().surveyType || "private") === "private" && isRecentSurveyResponse(doc.data()),
    )
  )
    return true;
  const byPhone = memberPhone
    ? await refs.privateSurveyResponses().where("memberPhone", "==", memberPhone).limit(10).get()
    : null;
  return Boolean(
    byPhone?.docs.some(
      (doc) => (doc.data().surveyType || "private") === "private" && isRecentSurveyResponse(doc.data()),
    ),
  );
}

function isRecentSurveyResponse(response: PrivateSurveyResponseDoc): boolean {
  const responseMs = response.submittedAt?.toMillis?.() || response.createdAt?.toMillis?.() || 0;
  if (!responseMs) return true;
  return Date.now() - responseMs < 365 * 24 * 60 * 60 * 1000;
}

function isPrivateBookingTicket(booking: BookingDoc): boolean {
  if (booking.lessonType === "private" || booking.lessonType === "semi_private") return true;
  if (booking.lessonType === "group") return false;
  const ticketKind = bookingTicketKind(booking);
  if (ticketKind === "private") return true;
  if (ticketKind === "group" || ticketKind === "instructor") return false;
  return /프라이빗|개인|1:1/i.test(booking.ticketName || "");
}

function bookingTicketKind(booking: BookingDoc): "group" | "private" | "instructor" | "" {
  const values = [booking.ticketClassType, booking.ticketType].map((value) => String(value || "").trim());
  for (const value of values) {
    const upper = value.toUpperCase();
    if (!upper) continue;
    if (upper === "P" || upper === "PRIVATE" || /프라이빗|개인|1:1/i.test(value)) return "private";
    if (upper === "G" || upper === "GROUP" || /그룹|체험|듀엣|소그룹/i.test(value)) return "group";
    if (upper === "I" || upper === "INSTRUCTOR" || /강사레슨/i.test(value)) return "instructor";
  }
  return "";
}

function matchFromBooking(booking: BookingDoc): MatchResult {
  return {
    status: "matched",
    memberId: booking.memberId,
    memberName: booking.memberName,
    memberPhone: booking.memberPhone,
    bookingId: booking.bookingId,
    lectureId: booking.lectureId,
    lectureDate: booking.lectureDate,
    lectureStartAt: booking.lectureStartAt,
    staffId: booking.staffId,
    staffName: booking.staffName,
    reason: "예약 기준 자동매칭",
  };
}

async function sendMissingSurveySubmissionEmailOnce(input: {
  alertId: string;
  surveyType: "private" | "group";
  memberName: string;
  memberPhone: string;
  lessonTime: string;
  staffName: string;
  dueAt: Timestamp;
  sourceId: string;
  requestOrCandidateId: string;
}): Promise<boolean> {
  const ref = db.collection("surveySubmissionAlerts").doc(input.alertId);
  const payload = {
    alertId: input.alertId,
    surveyType: input.surveyType,
    memberName: input.memberName,
    memberPhone: input.memberPhone,
    lessonTime: input.lessonTime,
    staffName: input.staffName,
    dueAt: input.dueAt,
    sourceId: input.sourceId,
    requestOrCandidateId: input.requestOrCandidateId,
    status: "email_sent",
    createdAt: nowTimestamp(),
    updatedAt: nowTimestamp(),
  };
  try {
    await ref.create(payload);
  } catch (err: any) {
    if (Number(err?.code) === 6 || String(err?.message || "").includes("ALREADY_EXISTS")) return false;
    throw err;
  }

  const typeLabel = input.surveyType === "group" ? "그룹 첫 수업 사전확인" : "프라이빗 사전설문";
  await sendAlimtalkLogEmail({
    subject: `[알림톡][확인필요] ${typeLabel} 미제출 - ${input.memberName}`,
    body: [
      `${typeLabel}이 아직 제출되지 않았어요.`,
      "",
      `이름: ${input.memberName}`,
      `연락처: ${input.memberPhone}`,
      `수업일시: ${input.lessonTime}`,
      input.staffName ? `수업 강사: ${input.staffName}` : "",
      `강사 전달 기준시각: ${formatKstDateTime(input.dueAt.toDate())}`,
      "",
      "회원에게 설문 제출 여부를 확인해 주세요.",
      "",
      `추적ID: ${input.requestOrCandidateId}`,
    ]
      .filter((line) => line !== "")
      .join("\n"),
    status: "attention",
  });
  return true;
}

function pendingStaffSurveyDelivery(doc: PrivateSurveyResponseDoc): PrivateSurveyResponseDoc["delivery"] {
  const dueText = staffSurveyDueText(doc);
  const surveyLabel = doc.surveyType === "group" ? "그룹 사전확인" : "프라이빗 사전설문";
  return {
    ...doc.delivery,
    alimtalkStatus: "pending",
    alimtalkReason: `${surveyLabel} 알림톡 발송 대기${dueText ? ` · ${dueText}` : ""}`,
  };
}

function isStaffSurveyAlimtalkDue(doc: PrivateSurveyResponseDoc, nowMs = Date.now()): boolean {
  if (doc.matching.status !== "matched" || !doc.matching.staffId) return false;
  const dueAt = staffSurveyNotificationDueAt(doc);
  if (!dueAt) return false;
  const lectureStartMs = doc.matching.lectureStartAt?.toMillis?.() || 0;
  if (lectureStartMs && nowMs >= lectureStartMs) return false;
  return dueAt.toMillis() <= nowMs;
}

function isStaffSurveyAlimtalkMissed(doc: PrivateSurveyResponseDoc, nowMs = Date.now()): boolean {
  const lectureStartMs = doc.matching.lectureStartAt?.toMillis?.() || 0;
  return Boolean(lectureStartMs && nowMs >= lectureStartMs);
}

function staffSurveyDueText(doc: PrivateSurveyResponseDoc): string {
  const dueAt = staffSurveyNotificationDueAt(doc);
  if (!dueAt) return "";
  const label = doc.surveyType === "group" ? "수업 1시간 전" : "수업 하루 전 오전";
  return `${label}(${formatKstDateTime(dueAt.toDate())})`;
}

function staffSurveyNotificationDueAt(doc: PrivateSurveyResponseDoc): Timestamp | null {
  if (doc.surveyType === "group") {
    const startMs = doc.matching.lectureStartAt?.toMillis?.() || 0;
    if (!startMs) return null;
    return Timestamp.fromMillis(startMs - 60 * 60 * 1000);
  }
  if (!doc.matching.lectureDate) return null;
  const due = new Date(`${doc.matching.lectureDate}T09:00:00+09:00`);
  if (Number.isNaN(due.getTime())) return null;
  due.setDate(due.getDate() - 1);
  return Timestamp.fromDate(due);
}

function accessTokenFromDetailUrl(detailUrl: string): string {
  try {
    return new URL(detailUrl).searchParams.get("token") || "";
  } catch {
    return "";
  }
}

function formatKstDateTime(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace(/\s/g, " ");
}

async function deliverStaffSurveyAlimtalk(
  doc: PrivateSurveyResponseDoc,
  accessToken: string,
): Promise<PrivateSurveyResponseDoc["delivery"]> {
  const delivery = { ...doc.delivery };
  if (doc.matching.status !== "matched" || !doc.matching.staffId) {
    return {
      ...delivery,
      alimtalkStatus: "pending",
      alimtalkReason: doc.matching.reason || "수업 매칭 후 강사 알림톡 발송 가능",
    };
  }

  const staff = await getStaffById(doc.matching.staffId);
  const staffPhone = normalizePhone(staff?.phone || "");
  if (!staff || !staffPhone) {
    return {
      ...delivery,
      alimtalkStatus: "pending",
      alimtalkReason: "강사 전화번호가 없어 알림톡 발송 대기",
    };
  }

  const templateId = staffSurveyTemplateId(doc);
  if (!(await isAlimtalkTemplateApproved(templateId))) {
    return {
      ...delivery,
      alimtalkStatus: "pending",
      alimtalkReason: `강사 알림톡 템플릿 검수 대기: ${templateId}`,
    };
  }
  const sendId = `${doc.surveyType === "group" ? "group_survey_staff" : "private_survey_staff"}_${doc.responseId}`;
  const sendRef = refs.alimtalkSend(sendId);
  const existing = (await sendRef.get()).data();
  if (existing?.status === "done") {
    return {
      ...delivery,
      alimtalkStatus: "sent",
      alimtalkReason: "이미 강사 사전설문 알림톡 발송 완료",
    };
  }
  const previousAttempts = existing?.attempts || 0;
  const maxAttempts = existing?.maxAttempts || 2;
  if (previousAttempts >= maxAttempts) {
    return {
      ...delivery,
      alimtalkStatus: "failed",
      alimtalkReason: `강사 알림톡 발송 실패 재시도 한도 초과: ${existing?.lastError || sendId}`,
    };
  }

  try {
    const result = await sendStaffPrivateSurveyAlimtalk({
      to: staffPhone,
      staffName: staff.name || doc.matching.staffName,
      memberName: doc.memberName,
      lessonTime: lessonTimeText(doc),
      responseId: doc.responseId,
      accessToken,
      templateId,
    });
    await sendRef.set(
      {
        sendId,
        studioId: doc.studioId,
        candidateId: sendId,
        memberId: staff.staffId,
        memberName: staff.name || doc.matching.staffName,
        memberPhone: staffPhone,
        templateCode: templateId,
        dedupeKey: sendId,
        dedupePolicy: `${doc.surveyType === "group" ? "그룹 사전확인" : "프라이빗 사전설문"} 강사 제출 알림 응답별 1회`,
        dedupeWindowDays: null,
        status: "done",
        attempts: previousAttempts + 1,
        maxAttempts,
        nextRunAt: nowTimestamp(),
        solapiMessageId: result.messageId,
        variables: result.variables,
        lastError: null,
        createdByUid: "system:private-survey-intake",
        createdAt: nowTimestamp(),
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
    return {
      ...delivery,
      alimtalkStatus: "sent",
      alimtalkReason: `${doc.surveyType === "group" ? "그룹 사전확인" : "프라이빗 사전설문"} 강사 알림톡 발송 완료`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const attempts = previousAttempts + 1;
    await sendRef.set(
      {
        sendId,
        studioId: doc.studioId,
        candidateId: sendId,
        memberId: staff.staffId,
        memberName: staff.name || doc.matching.staffName,
        memberPhone: staffPhone,
        templateCode: templateId,
        dedupeKey: sendId,
        dedupePolicy: `${doc.surveyType === "group" ? "그룹 사전확인" : "프라이빗 사전설문"} 강사 제출 알림 응답별 1회`,
        dedupeWindowDays: null,
        status: "failed",
        attempts,
        maxAttempts,
        nextRunAt: nowTimestamp(),
        lastError: message,
        createdByUid: "system:private-survey-intake",
        createdAt: nowTimestamp(),
        updatedAt: nowTimestamp(),
      },
      { merge: true },
    );
    logger.warn("staff private survey alimtalk failed", {
      responseId: doc.responseId,
      staffId: staff.staffId,
      message,
    });
    return {
      ...delivery,
      alimtalkStatus: "failed",
      alimtalkReason: attempts >= maxAttempts ? `${message} · 재시도 한도 초과` : message,
    };
  }
}

async function enqueueSurveyMemoOutputs(
  doc: PrivateSurveyResponseDoc,
  content = surveyMemoContent(doc),
): Promise<void> {
  if (doc.matching.status !== "matched" || !doc.matching.memberId || !content) return;
  const kind = surveyMemoKind(doc);
  const memoId = `${kind}_${doc.responseId}`;
  const memoRef = refs.memberMemos().doc(memoId);
  await memoRef.set(
    {
      memoId: memoRef.id,
      studioId: doc.studioId,
      memberId: doc.matching.memberId,
      memberName: doc.memberName,
      lectureId: doc.matching.lectureId,
      bookingId: doc.matching.bookingId,
      lectureDate: doc.matching.lectureDate,
      staffId: doc.matching.staffId,
      staffName: doc.matching.staffName,
      memoType: "member_note",
      visibility: "staff_and_manager",
      content,
      syncStatus: "pending",
      createdByUid: `system:${kind}`,
      createdAt: nowTimestamp(),
      updatedAt: nowTimestamp(),
    },
    { merge: true },
  );
  if (doc.matching.bookingId) {
    await refs
      .booking(doc.matching.bookingId)
      .set(
        { lastMemoPreview: content.slice(0, 60), lastMemoAt: nowTimestamp(), updatedAt: nowTimestamp() },
        { merge: true },
      );
  }
  await db.collection("studiomateMemoWriteJobs").doc(memoId).set(
    {
      jobId: memoId,
      studioId: doc.studioId,
      source: kind,
      status: "pending",
      writeMode: "playwright",
      memberId: doc.matching.memberId,
      memberName: doc.memberName,
      memberPhone: doc.memberPhone,
      bookingId: doc.matching.bookingId,
      lectureId: doc.matching.lectureId,
      lectureDate: doc.matching.lectureDate,
      staffId: doc.matching.staffId,
      staffName: doc.matching.staffName,
      content,
      attempts: 0,
      maxAttempts: 3,
      lastError: null,
      createdAt: nowTimestamp(),
      updatedAt: nowTimestamp(),
    },
    { merge: true },
  );
}

function surveyMemoKind(doc: PrivateSurveyResponseDoc): "group_survey" | "private_survey" {
  return doc.surveyType === "group" ? "group_survey" : "private_survey";
}

function surveyMemoContent(doc: PrivateSurveyResponseDoc): string {
  if (doc.surveyType === "group") return groupSurveyMemoContent(doc);
  return privateSurveyMemoContent(doc);
}

function privateSurveyMemoContent(doc: PrivateSurveyResponseDoc): string {
  return [
    "[ARCHIVE IN 프라이빗 사전설문]",
    `첫 프라이빗: ${lessonTimeText(doc)} / ${doc.matching.staffName || "강사 미확인"}`,
    "",
    `경험구분: ${doc.experienceType || "-"}`,
    `운동목적: ${doc.summary.goal || "-"}`,
    `신경부위: ${doc.summary.focusArea || "-"}`,
    `통증/병력: ${doc.summary.painOrMedicalNote || "-"}`,
    `운동수준: ${doc.summary.exerciseLevel || "-"}`,
    `걱정/어려움: ${doc.summary.concernOrDifficulty || "-"}`,
    `기대/중요요소: ${doc.summary.expectationOrImportantFactor || "-"}`,
    doc.summary.lifestyleOrPreviousIssue ? `생활/이전 아쉬움: ${doc.summary.lifestyleOrPreviousIssue}` : "",
    doc.summary.referralSource ? `유입경로: ${doc.summary.referralSource}` : "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function groupSurveyMemoContent(doc: PrivateSurveyResponseDoc, payload?: GroupSurveySubmitPayload): string {
  return [
    "[ARCHIVE IN 그룹 첫 수업 사전확인]",
    `첫 그룹수업: ${lessonTimeText(doc)} / ${doc.matching.staffName || "강사 미확인"}`,
    "",
    `운동경험: ${payload?.exerciseExperience || doc.summary.exerciseLevel || "-"}`,
    `통증/불편: ${payload?.painAreas.join(", ") || doc.summary.focusArea || "-"}`,
    payload?.painNote ? `통증상세: ${payload.painNote}` : "",
    `주의사항: ${payload?.cautionTypes.join(", ") || doc.summary.painOrMedicalNote || "-"}`,
    `걱정: ${payload?.concern || doc.summary.concernOrDifficulty || doc.summary.goal || "-"}`,
    `요청: ${payload?.requestNote || doc.summary.expectationOrImportantFactor || "-"}`,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

async function sendStaffPrivateSurveyAlimtalk(input: {
  to: string;
  staffName: string;
  memberName: string;
  lessonTime: string;
  responseId: string;
  accessToken: string;
  templateId: string;
}): Promise<{ messageId: string; variables: Record<string, string> }> {
  const detailUrl = detailUrlFor(input.responseId, input.accessToken);
  const shortLink = await ensureShortLink({
    type: "survey_detail",
    targetUrl: detailUrl,
    sourceId: input.responseId,
  });
  const variables = {
    "#{강사명}": input.staffName,
    "#{회원명}": input.memberName,
    "#{수업일시}": input.lessonTime,
    "#{설문ID}": input.responseId,
    "#{접근토큰}": input.accessToken,
    "#{링크ID}": shortLink.linkId,
  };
  const buttonUrlIssue = surveyDetailButtonUrlLengthIssue(input.responseId, input.accessToken, shortLink.linkId);
  if (buttonUrlIssue) throw new Error(buttonUrlIssue);
  const body = {
    messages: [
      {
        to: input.to,
        type: "ATA",
        kakaoOptions: {
          pfId: solapiPfid.value(),
          templateId: input.templateId,
          disableSms: true,
          variables,
        },
      },
    ],
    strict: true,
    allowDuplicates: false,
    showMessageList: true,
  };

  const response = await fetch(SOLAPI_SEND_URL, {
    method: "POST",
    headers: {
      Authorization: solapiAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => ({}))) as SolapiSendResponse;
  if (!response.ok) {
    throw new Error(result.errorMessage || result.message || `SOLAPI ${response.status}`);
  }
  if (Array.isArray(result.failedMessageList) && result.failedMessageList.length) {
    throw new Error(result.failedMessageList[0]?.statusMessage || "SOLAPI rejected message");
  }
  return {
    messageId: result.messageList?.[0]?.messageId || result.groupInfo?.groupId || "",
    variables,
  };
}

function staffSurveyTemplateId(doc: PrivateSurveyResponseDoc): string {
  return doc.surveyType === "group" ? STAFF_GROUP_SURVEY_TEMPLATE_ID : STAFF_PRIVATE_SURVEY_TEMPLATE_ID;
}

function solapiAuthHeader(): string {
  const apiKey = solapiApiKey.value();
  const apiSecret = solapiApiSecret.value();
  const dateTime = new Date().toISOString();
  const salt = randomBytes(16).toString("hex");
  const signature = createHmac("sha256", apiSecret)
    .update(dateTime + salt)
    .digest("hex");
  return `HMAC-SHA256 apiKey=${apiKey}, date=${dateTime}, salt=${salt}, signature=${signature}`;
}

interface SolapiSendResponse {
  message?: string;
  errorMessage?: string;
  failedMessageList?: Array<{ statusMessage?: string }>;
  messageList?: Array<{ messageId?: string }>;
  groupInfo?: { groupId?: string };
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
    reason: "예정 프라이빗 예약 자동매칭",
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
  const privateBooking = bookings.find((booking) => isPrivateBookingTicket(booking));
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
    goal: beginner
      ? a["3. 필라테스를 시작하려는 가장 큰 이유는 무엇인가요?"] || ""
      : a["8. 현재 운동 목표는 무엇인가요?"] || "",
    focusArea: beginner
      ? a["4. 현재 가장 신경 쓰이는 부위는 어디인가요?"] || ""
      : a["6. 현재 불편하거나 개선이 필요한 부위는?"] || "",
    painOrMedicalNote: beginner
      ? a["5. 통증이나 불편한 부위가 있다면 적어주세요"] || ""
      : a["7. 통증 / 병력 / 수술 경험이 있다면 작성해주세요"] || "",
    exerciseLevel: beginner
      ? a["6. 운동 경험은 어떤 편인가요?"] || ""
      : [
          a["3. 필라테스 경험 기간은 어느 정도이신가요?"],
          a["4. 주로 어떤 수업을 받아보셨나요?"],
          a["9. 본인의 운동 수준은 어느 정도라고 생각하시나요?"],
        ]
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
      ? [a["7. 평소 생활패턴은 어떤 편인가요?"], a["8. 가장 먼저 바꾸고 싶은 부분은 무엇인가요?"]]
          .filter(Boolean)
          .join(" / ")
      : a["5. 이전 수업에서 아쉬웠던 점은 무엇인가요?"] || "",
  };
}

function parseKoreanTimestamp(value: string): Timestamp | null {
  const match = value.match(/^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\s*(오전|오후)\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  const [, year, month, day, ampm, hourText, minute, second] = match;
  let hour = Number(hourText);
  if (ampm === "오후" && hour < 12) hour += 12;
  if (ampm === "오전" && hour === 12) hour = 0;
  const date = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day), hour - 9, Number(minute), Number(second || 0)),
  );
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
  const isGroup = doc.surveyType === "group";
  const priorityRows = [
    [isGroup ? "걱정되는 부분" : "운동 목적", doc.summary.goal],
    [isGroup ? "통증/불편 부위" : "신경 부위", doc.summary.focusArea],
    ["통증/병력", doc.summary.painOrMedicalNote],
  ];
  const detailRows = [
    ["운동 수준", doc.summary.exerciseLevel],
    [
      isGroup ? "요청사항" : "걱정/어려움",
      isGroup ? doc.summary.expectationOrImportantFactor : doc.summary.concernOrDifficulty,
    ],
    [isGroup ? "" : "기대/중요 요소", isGroup ? "" : doc.summary.expectationOrImportantFactor],
    [isGroup ? "" : "생활/이전 아쉬움", isGroup ? "" : doc.summary.lifestyleOrPreviousIssue],
    [isGroup ? "" : "유입경로", isGroup ? "" : doc.summary.referralSource],
  ].filter(([label]) => label);
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ARCHIVE IN 사전설문</title>
  <style>
    :root { color-scheme: light; --ink:#181512; --muted:#746b62; --line:#e8e0d7; --paper:#fffdf9; --accent:#c9392f; --soft:#f5efe9; --green:#2f6f68; }
    * { box-sizing: border-box; }
    body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR",sans-serif; background:#f6f1eb; color:var(--ink); }
    main { width:min(760px,100%); margin:0 auto; padding:14px 14px 30px; }
    .top { display:grid; grid-template-columns:1fr auto; gap:12px; align-items:start; padding:12px 2px 10px; border-bottom:1px solid rgba(24,21,18,.08); }
    .brand { width:44px; height:44px; border-radius:50%; object-fit:contain; }
    .eyebrow { font-size:12px; font-weight:800; color:var(--accent); }
    h1 { margin:5px 0 8px; font-size:24px; line-height:1.22; letter-spacing:0; }
    .meta { display:flex; flex-wrap:wrap; gap:6px; color:var(--muted); font-size:13px; line-height:1.5; }
    .chip { display:inline-flex; align-items:center; min-height:28px; padding:4px 9px; border:1px solid var(--line); border-radius:999px; background:rgba(255,253,249,.72); }
    .section-title { margin:22px 2px 9px; font-size:13px; font-weight:900; color:#3e3831; }
    .panel { background:var(--paper); border:1px solid var(--line); border-radius:8px; padding:15px 16px; }
    .match { margin:14px 0 0; background:var(--soft); border-color:#dfd2c5; }
    .label { font-size:12px; color:var(--muted); font-weight:800; margin-bottom:7px; }
    .value { font-size:16px; line-height:1.62; white-space:pre-line; word-break:keep-all; overflow-wrap:break-word; }
    .priority { display:grid; gap:10px; }
    .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
    .small { font-size:13px; color:var(--muted); line-height:1.5; }
    .notice { margin-top:16px; padding:12px 14px; background:#fff7f4; border:1px solid #f0c9c1; border-radius:8px; color:#9d2f24; font-size:12px; line-height:1.62; word-break:keep-all; overflow-wrap:break-word; }
    .notice strong { display:block; margin-bottom:2px; font-size:12px; color:#9d2f24; }
    @media (max-width:560px) {
      main { padding:14px 12px 30px; }
      .top { grid-template-columns:1fr 44px; gap:12px; padding-top:12px; }
      .brand { width:44px; height:44px; }
      h1 { font-size:22px; }
      .grid { grid-template-columns:1fr; }
      .panel { padding:14px; }
      .value { font-size:15px; line-height:1.62; }
    }
  </style>
</head>
<body>
  <main>
    <section class="top">
      <div>
        <div class="eyebrow">ARCHIVE IN · ${isGroup ? "그룹 첫 수업 사전확인" : "첫 프라이빗 사전설문"}</div>
        <h1>${escapeHtml(doc.memberName)}</h1>
        <div class="meta">
          <span class="chip">제출 ${escapeHtml(submitted)}</span>
          <span class="chip">${isGroup ? "운동경험" : "경험구분"} ${escapeHtml(doc.experienceType || "-")}</span>
        </div>
      </div>
      <img class="brand" src="${ARCHIVE_LOGO_URL}" alt="ARCHIVE PILATES">
    </section>
    <section class="panel match">
      <div class="label">${isGroup ? "첫 수업" : "수업 정보"}</div>
      <div class="value">${escapeHtml(matchText(doc))}</div>
    </section>
    <div class="section-title">핵심 확인</div>
    <section class="priority">
      ${priorityRows.map(([label, value]) => answerBlock(label, value)).join("")}
    </section>
    <div class="section-title">상세 답변</div>
    <section class="grid">
      ${detailRows.map(([label, value]) => answerBlock(label, value)).join("")}
    </section>
    <section class="notice">
      <strong>내부 자료 안내</strong>
      설문 내용은 수업 준비 목적의 내부 자료입니다.<br>링크를 외부에 공유하지 마세요.
    </section>
  </main>
</body>
</html>`;
}

function answerBlock(label: string, value: string): string {
  return `<section class="panel"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value || "-")}</div></section>`;
}

function matchText(doc: PrivateSurveyResponseDoc): string {
  if (doc.matching.status !== "matched") return doc.matching.reason;
  return [
    lessonTimeText(doc),
    doc.matching.staffName
      ? `${doc.surveyType === "group" ? "첫 수업 강사" : "수업 강사"}: ${doc.matching.staffName}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function lessonTimeText(doc: PrivateSurveyResponseDoc): string {
  const time = doc.matching.lectureStartAt?.toDate?.()
    ? new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(doc.matching.lectureStartAt.toDate())
    : doc.matching.lectureDate;
  return time || "-";
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

async function readSurveySheet(client: DelegatedGoogleClient): Promise<string[][]> {
  const range = encodeURIComponent(`'${PRIVATE_SURVEY_SHEET_NAME}'!A:AZ`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    PRIVATE_SURVEY_SPREADSHEET_ID,
  )}/values/${range}?valueRenderOption=FORMATTED_VALUE`;
  const result = await client.request<{ values?: string[][] }>(url);
  return result.values || [];
}

function ensureHeaderMap(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  headers.forEach((header, index) => {
    if (header) map[header] = index;
  });
  for (const header of OUTPUT_HEADERS) {
    if (map[header] == null) {
      map[header] = headers.length;
      headers.push(header);
    }
  }
  return map;
}

async function ensureSheetHeaders(
  client: DelegatedGoogleClient,
  headers: string[],
  headerMap: Record<string, number>,
): Promise<void> {
  const outputStart = Math.min(...OUTPUT_HEADERS.map((header) => headerMap[header]));
  const outputEnd = Math.max(...OUTPUT_HEADERS.map((header) => headerMap[header]));
  const range = `${columnName(outputStart + 1)}1:${columnName(outputEnd + 1)}1`;
  await writeSheetValues(client, range, [OUTPUT_HEADERS]);
}

function answersFromRow(headers: string[], row: string[]): Record<string, string> {
  const answers: Record<string, string> = {};
  headers.forEach((header, index) => {
    if (!header || OUTPUT_HEADERS.includes(header)) return;
    const key = header.trim();
    const value = String(row[index] || "").trim();
    if (answers[key] && !value) return;
    answers[key] = value || answers[key] || "";
  });
  return answers;
}

async function updateSheetOutput(
  client: DelegatedGoogleClient,
  rowNumber: number,
  headerMap: Record<string, number>,
  values: string[],
): Promise<void> {
  const start = Math.min(...OUTPUT_HEADERS.map((header) => headerMap[header]));
  const end = Math.max(...OUTPUT_HEADERS.map((header) => headerMap[header]));
  const ordered = Array.from({ length: end - start + 1 }, () => "");
  OUTPUT_HEADERS.forEach((header, index) => {
    ordered[headerMap[header] - start] = values[index] || "";
  });
  const range = `${columnName(start + 1)}${rowNumber}:${columnName(end + 1)}${rowNumber}`;
  await writeSheetValues(client, range, [ordered]);
}

async function writeSheetValues(client: DelegatedGoogleClient, range: string, values: string[][]): Promise<void> {
  const encodedRange = encodeURIComponent(`'${PRIVATE_SURVEY_SHEET_NAME}'!${range}`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    PRIVATE_SURVEY_SPREADSHEET_ID,
  )}/values/${encodedRange}?valueInputOption=USER_ENTERED`;
  await client.request(url, {
    method: "PUT",
    body: JSON.stringify({ range: `'${PRIVATE_SURVEY_SHEET_NAME}'!${range}`, majorDimension: "ROWS", values }),
  });
}

function cell(row: string[], index: number | undefined): string {
  return index == null ? "" : String(row[index] || "").trim();
}

function columnName(columnNumber: number): string {
  let n = columnNumber;
  let name = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function kstNowText(): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
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
