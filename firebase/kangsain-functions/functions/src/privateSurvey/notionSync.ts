import { notionToken } from "../config/secrets";
import type { PrivateSurveyResponseDoc } from "../types/models";
import { formatDateKst } from "../utils/date";

const NOTION_API_VERSION = "2022-06-28";
const NOTION_PRIVATE_MEMBERS_DATABASE_ID =
  process.env.NOTION_PRIVATE_MEMBERS_DATABASE_ID || "c58a39ceb7ac405ba43b38d3b5871ed3";
const NOTION_PRIVATE_INTAKE_DATABASE_ID =
  process.env.NOTION_PRIVATE_INTAKE_DATABASE_ID || "87064e93fd834c0ab2e2da8070522922";

export interface NotionPrivateSurveySyncResult {
  status: "synced" | "skipped" | "failed";
  action?: "created" | "updated";
  memberPageId?: string;
  intakePageId?: string;
  syncedAt?: string;
  error?: string;
}

interface NotionConfig {
  token: string;
  membersDatabaseId: string;
  intakeDatabaseId: string;
}

interface NotionPageRef {
  id: string;
}

export async function syncPrivateSurveyResponseToNotion(
  doc: PrivateSurveyResponseDoc,
): Promise<NotionPrivateSurveySyncResult> {
  if (doc.surveyType === "group") {
    return { status: "skipped", error: "group survey is not synced to private lesson chart" };
  }

  try {
    const config = notionConfig();
    const member = await upsertMember(config, doc);
    const intake = await upsertIntake(config, doc, member.id);
    return {
      status: "synced",
      action: intake.created ? "created" : "updated",
      memberPageId: member.id,
      intakePageId: intake.id,
      syncedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      syncedAt: new Date().toISOString(),
    };
  }
}

export function isNotionPrivateSurveySyncConfigured(): boolean {
  try {
    return Boolean(notionToken.value());
  } catch {
    return false;
  }
}

function notionConfig(): NotionConfig {
  const token = notionToken.value();
  if (!token) throw new Error("NOTION_TOKEN secret is not set");
  return {
    token,
    membersDatabaseId: NOTION_PRIVATE_MEMBERS_DATABASE_ID,
    intakeDatabaseId: NOTION_PRIVATE_INTAKE_DATABASE_ID,
  };
}

async function upsertMember(config: NotionConfig, doc: PrivateSurveyResponseDoc): Promise<NotionPageRef> {
  const existing = await findMember(config, doc.memberPhone, doc.memberName);
  const properties = compactObject({
    Name: notionTitle(doc.memberName),
    Phone: { phone_number: doc.memberPhone },
    Instructor: notionSelect(doc.matching.staffName || "미정"),
    Goal: notionText(doc.summary.goal),
    "Pain Point": notionText(doc.summary.painOrMedicalNote),
    "Current Focus": notionMultiSelect(focusFromSurvey(doc)),
    "Membership Type": notionSelect("Trial"),
    "Start Date": doc.submittedAt ? notionDate(timestampDate(doc.submittedAt)) : undefined,
  });

  if (existing) {
    await notionRequest(config, `pages/${existing.id}`, "PATCH", { properties });
    return { id: existing.id };
  }

  const created = await notionRequest(config, "pages", "POST", {
    parent: { database_id: config.membersDatabaseId },
    properties,
  });
  return { id: String(created.id) };
}

async function upsertIntake(
  config: NotionConfig,
  doc: PrivateSurveyResponseDoc,
  memberPageId: string,
): Promise<NotionPageRef & { created: boolean }> {
  const detailUrl = doc.delivery.detailUrl;
  const existing = await findIntake(config, detailUrl);
  const responseDate = doc.submittedAt ? timestampDate(doc.submittedAt) : new Date().toISOString().slice(0, 10);
  const properties = compactObject({
    "Survey Name": notionTitle(`${doc.memberName} / ${responseDate} 사전설문`),
    "Submitted At": doc.submittedAt ? notionDate(timestampDateTime(doc.submittedAt)) : undefined,
    "Member Relation": { relation: [{ id: memberPageId }] },
    "Matching Phone": { phone_number: doc.memberPhone },
    "Responsible Instructor": notionSelect(doc.matching.staffName || "미정"),
    "Survey Status": notionSelect("미확인"),
    "Experience Level": notionSelect(doc.experienceType),
    "Primary Goal": notionMultiSelect(splitMultiValue(doc.summary.goal)),
    "Pain Areas": notionMultiSelect(splitMultiValue(doc.summary.focusArea)),
    "Medical Precautions": notionText(doc.summary.painOrMedicalNote),
    "Exercise Level": notionText(doc.summary.exerciseLevel),
    "Concern Or Difficulty": notionText(doc.summary.concernOrDifficulty),
    "Expected Change Or Priority": notionText(doc.summary.expectationOrImportantFactor),
    "Referral Source": doc.summary.referralSource ? notionSelect(doc.summary.referralSource) : undefined,
    "Lifestyle Or Previous Gap": notionText(doc.summary.lifestyleOrPreviousIssue),
    "Mobile Counseling Card": notionText(mobileCounselingCard(doc)),
    "Raw Response URL": { url: detailUrl },
    "Source Row": { number: doc.source.rowNumber || null },
    "Source Spreadsheet": { url: `https://docs.google.com/spreadsheets/d/${doc.source.spreadsheetId}` },
  });

  const body = { properties };
  if (existing) {
    await notionRequest(config, `pages/${existing.id}`, "PATCH", body);
    return { id: existing.id, created: false };
  }

  const created = await notionRequest(config, "pages", "POST", {
    parent: { database_id: config.intakeDatabaseId },
    ...body,
  });
  return { id: String(created.id), created: true };
}

async function findMember(config: NotionConfig, phone: string, name: string): Promise<NotionPageRef | null> {
  const byPhone = await queryFirst(config, config.membersDatabaseId, {
    property: "Phone",
    phone_number: { equals: phone },
  });
  if (byPhone) return byPhone;
  return queryFirst(config, config.membersDatabaseId, {
    property: "Name",
    title: { equals: name },
  });
}

async function findIntake(config: NotionConfig, detailUrl: string): Promise<NotionPageRef | null> {
  return queryFirst(config, config.intakeDatabaseId, {
    property: "Raw Response URL",
    url: { equals: detailUrl },
  });
}

async function queryFirst(
  config: NotionConfig,
  databaseId: string,
  filter: Record<string, unknown>,
): Promise<NotionPageRef | null> {
  const result = await notionRequest(config, `databases/${databaseId}/query`, "POST", { filter, page_size: 1 });
  const first = Array.isArray(result.results) ? result.results[0] : null;
  return first?.id ? { id: String(first.id) } : null;
}

async function notionRequest(
  config: NotionConfig,
  path: string,
  method: "POST" | "PATCH",
  body: Record<string, unknown>,
): Promise<any> {
  const response = await fetch(`https://api.notion.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_API_VERSION,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`Notion API ${path} failed ${response.status}: ${parsed.message || text}`);
  return parsed;
}

function mobileCounselingCard(doc: PrivateSurveyResponseDoc): string {
  return [
    `[${doc.submittedAtText || ""} 제출]`,
    `성함: ${doc.memberName}`,
    `연락처: ${doc.memberPhone}`,
    `경험구분: ${doc.experienceType}`,
    "",
    `운동 목적: ${doc.summary.goal || "-"}`,
    `신경 부위: ${doc.summary.focusArea || "-"}`,
    `통증/병력: ${doc.summary.painOrMedicalNote || "-"}`,
    `운동 수준: ${doc.summary.exerciseLevel || "-"}`,
    `걱정/어려움: ${doc.summary.concernOrDifficulty || "-"}`,
    `기대/중요 요소: ${doc.summary.expectationOrImportantFactor || "-"}`,
    doc.summary.referralSource ? `유입경로: ${doc.summary.referralSource}` : "",
    doc.summary.lifestyleOrPreviousIssue ? `생활/이전 아쉬움: ${doc.summary.lifestyleOrPreviousIssue}` : "",
  ]
    .filter((line) => line !== "")
    .join("\n")
    .slice(0, 1900);
}

function focusFromSurvey(doc: PrivateSurveyResponseDoc): string[] {
  const text = `${doc.summary.goal} ${doc.summary.focusArea} ${doc.summary.painOrMedicalNote}`;
  const focus: string[] = [];
  if (/골반|고관절/.test(text)) focus.push("골반 정렬");
  if (/복부|코어|상체가 무너|체형|자세/.test(text)) focus.push("코어 안정성");
  if (/목|어깨|허리|통증|무릎|발목/.test(text)) focus.push("통증 관리");
  if (!focus.length) focus.push("코어 안정성");
  return focus;
}

function splitMultiValue(value: string): string[] {
  return String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function timestampDate(timestamp: PrivateSurveyResponseDoc["submittedAt"]): string {
  return timestamp ? formatDateKst(timestamp.toDate()) : new Date().toISOString().slice(0, 10);
}

function timestampDateTime(timestamp: PrivateSurveyResponseDoc["submittedAt"]): string {
  return timestamp?.toDate().toISOString() || new Date().toISOString();
}

function notionTitle(value: string): Record<string, unknown> {
  return { title: [{ text: { content: String(value || "").slice(0, 2000) } }] };
}

function notionText(value: string): Record<string, unknown> {
  return { rich_text: value ? [{ text: { content: String(value).slice(0, 2000) } }] : [] };
}

function notionSelect(value: string): Record<string, unknown> | undefined {
  return value ? { select: { name: String(value) } } : undefined;
}

function notionMultiSelect(values: string[]): Record<string, unknown> {
  return { multi_select: values.filter(Boolean).map((name) => ({ name })) };
}

function notionDate(value: string): Record<string, unknown> {
  return { date: { start: value } };
}

function compactObject(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined));
}
