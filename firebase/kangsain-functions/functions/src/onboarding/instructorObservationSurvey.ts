import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { DEFAULT_STUDIO_ID } from "../config/constants";
import { db } from "../config/firebase";
import { notionToken } from "../config/secrets";

export const INSTRUCTOR_OBSERVATION_COLLECTION = "instructorObservationResponses";
export const INSTRUCTOR_OBSERVATION_NOTION_DATABASE_ID =
  process.env.INSTRUCTOR_OBSERVATION_NOTION_DATABASE_ID || "b4f68fe17682488eb7d98884379725ca";

const NOTION_API_VERSION = "2022-06-28";
const ALLOWED_ORIGINS = new Set([
  "https://in.archivepilates.com",
  "https://archive-pilates-in.web.app",
  "https://archive-pilates.web.app",
]);

export interface InstructorObservationPayload {
  submissionId: string;
  instructorName: string;
  observationMode: "현장 참가" | "영상 시청";
  attendedOn: string;
  observedInstructor: string;
  classNameEquipment: string;
  classType: "그룹" | "개인" | "기타";
  expectedLevel: "초급" | "초중급" | "중급" | "기타";
  classGoal: string;
  classFlow: string;
  memorableCueing: string;
  understandingMethods: string[];
  understandingOther: string;
  levelAdjustment: string;
  memberResponseCheck: string;
  flowTimeScore: number;
  transitionNote: string;
  archiveStyle: string;
  keepChangeReason: string;
  immediateApplication: string;
  oneSentence: string;
}

export async function instructorObservationSurveyApiHandler(request: Request, response: Response): Promise<void> {
  setCors(request, response);
  response.set("Cache-Control", "no-store");
  response.set("X-Content-Type-Options", "nosniff");
  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return;
  }
  if (request.method !== "POST") {
    response.set("Allow", "POST, OPTIONS").status(405).json({ ok: false, error: "지원하지 않는 요청입니다." });
    return;
  }

  try {
    const body = request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
    if (optionalText(body.website, 200)) {
      response.status(200).json({ ok: true, duplicate: false });
      return;
    }
    const payload = parseInstructorObservationPayload(body);
    const canonicalKey = instructorObservationCanonicalKey(payload);
    const responseId = `observation-${canonicalKey}`;
    const ref = db.collection(INSTRUCTOR_OBSERVATION_COLLECTION).doc(responseId);
    const existing = await ref.get();
    if (existing.exists) {
      const existingData = existing.data() || {};
      const currentNotionStatus = String(existingData.notionSync?.status || "pending");
      if (currentNotionStatus !== "synced") {
        const notion = await syncInstructorObservationToNotion(payload, responseId);
        await ref.set(
          {
            notionSync: notion,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        response.status(200).json({ ok: true, duplicate: true, responseId, notionStatus: notion.status });
        return;
      }
      response.status(200).json({
        ok: true,
        duplicate: true,
        responseId,
        notionStatus: currentNotionStatus,
      });
      return;
    }

    const now = FieldValue.serverTimestamp();
    await ref.create({
      responseId,
      canonicalKey,
      studioId: DEFAULT_STUDIO_ID,
      ...payload,
      review: {
        status: "검토 대기",
        goodObservation: "",
        additionalFocus: "",
        nextObservationTopic: "",
        reviewer: "",
        reviewedOn: "",
      },
      notionSync: { status: "pending", pageId: "", error: "" },
      createdAt: now,
      updatedAt: now,
    });

    const notion = await syncInstructorObservationToNotion(payload, responseId);
    await ref.set(
      {
        notionSync: notion,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    response.status(200).json({
      ok: true,
      duplicate: false,
      responseId,
      notionStatus: notion.status,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "설문 저장 중 오류가 발생했습니다.";
    logger.error("instructorObservationSurvey submit failed", { message });
    response.status(400).json({ ok: false, error: message });
  }
}

export function parseInstructorObservationPayload(body: Record<string, unknown>): InstructorObservationPayload {
  const observationMode = requiredChoice(body.observationMode, "참관 방식", ["현장 참가", "영상 시청"] as const);
  const classType = requiredChoice(body.classType, "수업 형태", ["그룹", "개인", "기타"] as const);
  const expectedLevel = requiredChoice(body.expectedLevel, "예상 대상 수준", ["초급", "초중급", "중급", "기타"] as const);
  const score = Number(body.flowTimeScore);
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    throw new Error("수업 흐름과 시간 운영 점수를 선택해 주세요.");
  }
  const submissionId = optionalText(body.submissionId, 80);
  if (!/^[a-z0-9-]{20,80}$/i.test(submissionId)) throw new Error("설문 링크를 새로고침한 뒤 다시 제출해 주세요.");

  const understandingMethods = textList(body.understandingMethods, 8, 50);
  if (!understandingMethods.length) throw new Error("회원 이해를 도운 방법을 하나 이상 선택해 주세요.");
  const understandingOther = optionalText(body.understandingOther, 500);
  if (understandingMethods.includes("기타") && !understandingOther) {
    throw new Error("기타 방법을 작성해 주세요.");
  }

  return {
    submissionId,
    instructorName: requiredText(body.instructorName, "작성 강사", 60),
    observationMode,
    attendedOn: requiredDate(body.attendedOn, "수업일 / 분석일"),
    observedInstructor: requiredText(body.observedInstructor, "수업 대상 강사", 60),
    classNameEquipment: requiredText(body.classNameEquipment, "수업명 / 기구", 120),
    classType,
    expectedLevel,
    classGoal: requiredText(body.classGoal, "수업 목표", 1200),
    classFlow: requiredText(body.classFlow, "수업 전체 흐름", 2000),
    memorableCueing: requiredText(body.memorableCueing, "인상적인 큐잉", 2000),
    understandingMethods,
    understandingOther,
    levelAdjustment: requiredText(body.levelAdjustment, "수준 차이 대응", 2000),
    memberResponseCheck: requiredText(body.memberResponseCheck, "회원 반응 확인", 1600),
    flowTimeScore: score,
    transitionNote: optionalText(body.transitionNote, 1000),
    archiveStyle: requiredText(body.archiveStyle, "아카이브다운 수업", 1600),
    keepChangeReason: requiredText(body.keepChangeReason, "유지·수정·이유", 2000),
    immediateApplication: requiredText(body.immediateApplication, "바로 적용할 한 가지", 1200),
    oneSentence: requiredText(body.oneSentence, "한 문장 정리", 500),
  };
}

async function syncInstructorObservationToNotion(
  payload: InstructorObservationPayload,
  responseId: string,
): Promise<{ status: "synced" | "failed"; pageId: string; error: string; syncedAt: string }> {
  const syncedAt = new Date().toISOString();
  try {
    const token = notionToken.value();
    if (!token) throw new Error("NOTION_TOKEN secret is not set");
    const notionResponse = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Notion-Version": NOTION_API_VERSION,
      },
      body: JSON.stringify({
        parent: { database_id: INSTRUCTOR_OBSERVATION_NOTION_DATABASE_ID },
        properties: {
          "작성 강사": notionTitle(payload.instructorName),
          "수업일·분석일": { date: { start: payload.attendedOn } },
          "참관 방식": notionSelect(payload.observationMode),
          "수업 대상 강사": notionSelect(payload.observedInstructor),
          "수업명·기구": notionText(payload.classNameEquipment),
          "수업 형태": notionSelect(payload.classType),
          "예상 대상 수준": notionSelect(payload.expectedLevel),
          "1. 수업 목표": notionText(payload.classGoal),
          "2. 전체 흐름": notionText(payload.classFlow),
          "3. 인상적인 큐잉": notionText(payload.memorableCueing),
          "4. 이해를 도운 방법": notionMultiSelect(payload.understandingMethods),
          "4. 기타 방법": notionText(payload.understandingOther),
          "5. 수준 차이 대응": notionText(payload.levelAdjustment),
          "6. 회원 반응 확인": notionText(payload.memberResponseCheck),
          "7. 흐름·시간 점수": { number: payload.flowTimeScore },
          "7. 전환·진행 메모": notionText(payload.transitionNote),
          "8. 아카이브다운 부분": notionText(payload.archiveStyle),
          "9. 유지·수정·이유": notionText(payload.keepChangeReason),
          "10. 바로 적용할 한 가지": notionText(payload.immediateApplication),
          "11. 한 문장 정리": notionText(payload.oneSentence),
          "검토 상태": notionSelect("검토 대기"),
        },
        children: [
          {
            object: "block",
            type: "paragraph",
            paragraph: {
              rich_text: [{ type: "text", text: { content: `ARCHIVE IN 원본 ID: ${responseId}` } }],
            },
          },
        ],
      }),
    });
    const text = await notionResponse.text();
    const parsed = text ? JSON.parse(text) : {};
    if (!notionResponse.ok) {
      throw new Error(`Notion API ${notionResponse.status}: ${String(parsed.message || text).slice(0, 300)}`);
    }
    return { status: "synced", pageId: String(parsed.id || ""), error: "", syncedAt };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("instructorObservationSurvey Notion sync failed", { responseId, message });
    return { status: "failed", pageId: "", error: message.slice(0, 500), syncedAt };
  }
}

function notionTitle(value: string): Record<string, unknown> {
  return { title: [{ type: "text", text: { content: value.slice(0, 2000) } }] };
}

function notionText(value: string): Record<string, unknown> {
  return { rich_text: value ? [{ type: "text", text: { content: value.slice(0, 2000) } }] : [] };
}

function notionSelect(value: string): Record<string, unknown> {
  return { select: { name: value.slice(0, 100) } };
}

function notionMultiSelect(values: string[]): Record<string, unknown> {
  return { multi_select: values.map((name) => ({ name: name.slice(0, 100) })) };
}

function requiredText(value: unknown, label: string, maxLength: number): string {
  const text = optionalText(value, maxLength);
  if (!text) throw new Error(`${label} 항목을 작성해 주세요.`);
  return text;
}

function optionalText(value: unknown, maxLength: number): string {
  return String(value == null ? "" : value).trim().slice(0, maxLength);
}

function requiredDate(value: unknown, label: string): string {
  const text = optionalText(value, 10);
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(text)) throw new Error(`${label}을 선택해 주세요.`);
  return text;
}

function requiredChoice<const T extends readonly string[]>(value: unknown, label: string, choices: T): T[number] {
  const text = String(value || "").trim();
  if (!(choices as readonly string[]).includes(text)) throw new Error(`${label}을 선택해 주세요.`);
  return text as T[number];
}

function textList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => optionalText(item, maxLength)).filter(Boolean))].slice(0, maxItems);
}

function setCors(request: Request, response: Response): void {
  const origin = String(request.get("origin") || "");
  if (ALLOWED_ORIGINS.has(origin)) {
    response.set("Access-Control-Allow-Origin", origin);
    response.set("Vary", "Origin");
  }
  response.set("Access-Control-Allow-Methods", "POST,OPTIONS");
  response.set("Access-Control-Allow-Headers", "Content-Type");
}

export function instructorObservationCanonicalKey(payload: InstructorObservationPayload): string {
  return createHash("sha256")
    .update([
      payload.instructorName,
      payload.observationMode,
      payload.attendedOn,
      payload.observedInstructor,
      payload.classNameEquipment,
    ].join("|"))
    .digest("hex");
}
