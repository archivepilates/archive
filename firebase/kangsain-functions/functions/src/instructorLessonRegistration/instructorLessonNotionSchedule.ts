import { createHash } from "node:crypto";
import { notionToken } from "../config/secrets";
import { AppError } from "../utils/errors";
import type { InstructorLessonConfirmationSchedule } from "./instructorLessonConfirmation";

const SOURCE_PARENT = "198d49eae4bf8001895bf0378d58c641";
type Block = Record<string, any>;
export type NotionLessonSchedule = InstructorLessonConfirmationSchedule & {
  sourcePageId: string;
  sourceEditedAt: string;
  sourceFingerprint: string;
  title: string;
  capacity: number;
};

const cache = new Map<string, { until: number; value: NotionLessonSchedule[] }>();
const text = (rich: any[] = []) => rich.map((part) => part.plain_text ?? part.text?.content ?? "").join("");
const blockText = (block: Block) => text(block[block.type]?.rich_text);

// Only the official heading and its adjacent schedule table are authoritative.
export function parseNotionLessonSchedule(page: Block, blocks: Block[]): NotionLessonSchedule[] {
  const title = Object.values(page.properties || {}).flatMap((value: any) => value.type === "title" ? value.title : []).map((part: any) => part.plain_text ?? part.text?.content ?? "").join("");
  const month = title.match(/^(\d{1,2})월\s+아카이브\s+강사레슨$/);
  if (!month || page.archived || page.in_trash || String(page.parent?.page_id || "").replace(/-/g, "") !== SOURCE_PARENT) {
    throw new AppError("INVALID_ARGUMENT", "명지점 월별 강사레슨 안내 원본을 확인하세요.");
  }
  const yearHeadings = blocks.filter((b) => /^heading_/.test(b.type)).map(blockText)
    .filter((value) => /강사\s*레슨\s*일정\s*안내/.test(value));
  const years = yearHeadings.map((value) => value.match(/(20\d{2})년\s*(\d{1,2})월/));
  if (years.length !== 1 || !years[0] || Number(years[0][2]) !== Number(month[1])) {
    throw new AppError("INVALID_ARGUMENT", "노션 강사레슨 공식 일정의 연도·월을 확인하세요.");
  }
  const headings = blocks.filter((b) => /^heading_/.test(b.type) && /ARCHIVE METHOD/.test(blockText(b)));
  if (headings.length !== 1) throw new AppError("INVALID_ARGUMENT", "노션 공식 ARCHIVE METHOD 일정 제목이 한 개여야 합니다.");
  const heading = blockText(headings[0]);
  const lines = heading.split(/\n/).map((line) => line.trim()).filter(Boolean);
  const course = lines.find((line) => /^#\d+\s+/.test(line));
  const dateLine = lines.find((line) => /\d{1,2}\/\d{1,2}/.test(line));
  const match = dateLine?.match(/^(\d{1,2})\/(\d{1,2})\(([일월화수목금토])\)((?:\s*,\s*(?:\d{1,2}\/)?\d{1,2}\([일월화수목금토]\))*)\s+(\d{2}:\d{2})\s*[~～–-]\s*(\d{2}:\d{2})$/);
  if (!course || !match || Number(match[1]) !== Number(month[1])) throw new AppError("INVALID_ARGUMENT", "노션 공식 일정의 과정명·날짜·시간을 확인하세요.");
  const start = match[5], end = match[6];
  if (![start, end].every((v) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v)) || start >= end) throw new AppError("INVALID_ARGUMENT", "강사레슨 시작·종료 시간이 올바르지 않습니다.");
  const section = blocks.slice(blocks.indexOf(headings[0]) + 1);
  const boundary = section.findIndex((b) => b.type === "divider" || /^heading_/.test(b.type));
  const official = boundary < 0 ? section : section.slice(0, boundary);
  const capacityMatches = official.map(blockText).join("\n").match(/하루\s*(\d+)명/);
  const capacity = Number(capacityMatches?.[1]);
  const tables = official.filter((b) => b.type === "table");
  const rows = tables.flatMap((b) => b.children || []).filter((b: Block) => b.type === "table_row")
    .map((b: Block) => (b.table_row?.cells || []).map(text));
  const teamA = rows.filter((r: string[]) => r[0]?.trim() === "A팀");
  const teamB = rows.filter((r: string[]) => r[0]?.trim() === "B팀");
  const split = (value: string) => value.split(/\s*→\s*/).map((v) => v.trim()).filter(Boolean);
  const composition = split(teamA[0]?.[1] || "");
  const other = split(teamB[0]?.[1] || "");
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100 || teamA.length !== 1 || teamB.length !== 1 || composition.length !== 2 || new Set(composition).size !== 2 || JSON.stringify([...composition].sort()) !== JSON.stringify([...other].sort())) {
    throw new AppError("INVALID_ARGUMENT", "노션 정원 또는 A팀·B팀 수강 순서를 확인하세요.");
  }
  const sourcePageId = String(page.id).replace(/-/g, "");
  if (!/^[a-f0-9]{32}$/.test(sourcePageId)) throw new AppError("INVALID_ARGUMENT", "노션 원본 ID가 올바르지 않습니다.");
  const datePart = `${match[1]}/${match[2]}(${match[3]})${match[4]}`;
  const dates = [...datePart.matchAll(/(?:(\d{1,2})\/)?(\d{1,2})\(([일월화수목금토])\)/g)];
  const results = dates.map((date) => {
    const m = Number(date[1] || month[1]);
    if (m !== Number(month[1])) throw new AppError("INVALID_ARGUMENT", "한 안내 페이지의 공식 일정은 같은 월이어야 합니다.");
    const lessonDate = `${years[0]![1]}-${String(m).padStart(2, "0")}-${date[2].padStart(2, "0")}`;
    const day = new Date(`${lessonDate}T00:00:00Z`);
    if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== lessonDate || "일월화수목금토"[day.getUTCDay()] !== date[3]) throw new AppError("INVALID_ARGUMENT", "노션 수업일과 요일이 일치하지 않습니다.");
    const managementNumber = `notion-${lessonDate.slice(2).replace(/-/g, "")}`;
    const base = `https://in.archivepilates.com/method/${managementNumber}/calendar/`;
    const utc = (time: string) => new Date(`${lessonDate}T${time}:00+09:00`).toISOString().replace(/[-:]/g, "").replace(".000", "");
    const lessonComposition = composition.join("\n");
    const schedule = {
      lessonDate, managementNumber, lessonDateText: `${day.getUTCFullYear()}년 ${m}월 ${Number(date[2])}일(${date[3]})`,
      lessonTimeText: `${start}~${end}`, lessonComposition, expectedStartTime: start, expectedEndTime: end,
      calendarUrl: base, icsUrl: `${base}archive-method-${lessonDate.slice(2).replace(/-/g, "")}.ics`,
      icsStart: utc(start), icsEnd: utc(end), sourcePageId, sourceEditedAt: String(page.last_edited_time || ""),
      title: `ARCHIVE METHOD ${course}`, capacity,
    };
    return { ...schedule, sourceFingerprint: createHash("sha256").update(JSON.stringify({ lessonDate, start, end, course, lessonComposition, capacity })).digest("hex") };
  });
  if (new Set(results.map((r) => r.lessonDate)).size !== results.length) throw new AppError("INVALID_ARGUMENT", "노션 공식 일정에 중복 날짜가 있습니다.");
  return results;
}

async function notion(path: string, body?: object): Promise<any> {
  const token = notionToken.value();
  if (!token) throw new AppError("INVALID_ARGUMENT", "노션 일정 읽기 연결이 없습니다.");
  const response = await fetch(`https://api.notion.com/v1/${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new AppError("INVALID_ARGUMENT", `노션 일정 읽기 실패 (HTTP ${response.status})`);
  return response.json();
}

async function children(id: string): Promise<Block[]> {
  const rows: Block[] = [];
  let cursor = "";
  do {
    const result = await notion(`blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ""}`);
    rows.push(...result.results);
    cursor = result.has_more ? result.next_cursor : "";
    if (rows.length > 500) throw new AppError("INVALID_ARGUMENT", "노션 일정 페이지가 너무 깁니다.");
  } while (cursor);
  return rows;
}

export async function readNotionLessonPage(pageId: string): Promise<NotionLessonSchedule[]> {
  const prior = cache.get(pageId);
  if (prior && prior.until > Date.now()) return prior.value;
  const page = await notion(`pages/${pageId}`);
  if (page.archived || page.in_trash || String(page.parent?.page_id || "").replace(/-/g, "") !== SOURCE_PARENT) throw new AppError("INVALID_ARGUMENT", "강사레슨 안내 원본이 아닙니다.");
  const blocks = await children(pageId);
  for (const block of blocks.filter((b) => b.type === "table")) block.children = await children(block.id);
  const value = parseNotionLessonSchedule(page, blocks);
  if (cache.size >= 24) cache.delete(cache.keys().next().value!);
  cache.set(pageId, { until: Date.now() + 300_000, value });
  return value;
}

export async function resolveNotionLessonSchedule(lessonDate: string): Promise<NotionLessonSchedule> {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(lessonDate)) throw new AppError("INVALID_ARGUMENT", "강사레슨 수업일을 확인하세요.");
  const title = `${Number(lessonDate.slice(5, 7))}월 아카이브 강사레슨`;
  // Discover new monthly pages under the established Myongji source without adding IDs to code.
  const root = await children(SOURCE_PARENT);
  const pages = root.filter((b) => b.type === "child_page" && b.child_page?.title === title);
  if (pages.length !== 1) throw new AppError("INVALID_ARGUMENT", `노션 명지점의 '${title}' 안내 페이지를 한 개로 확인하세요.`);
  const schedules = await readNotionLessonPage(pages[0].id);
  const selected = schedules.find((s) => s.lessonDate === lessonDate);
  if (!selected) throw new AppError("INVALID_ARGUMENT", `${lessonDate} 노션 공식 일정이 없습니다.`);
  return selected;
}
