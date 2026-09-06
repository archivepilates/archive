export interface PrivateNotionPresentationInput {
  memberName: string;
  sessionNumber: number;
  lessonTime: string;
  staffName: string;
  stage: string;
  intake: {
    goal?: string;
    focusArea?: string;
    exerciseLevel?: string;
    hasCaution?: boolean;
  };
  focusAreas: string[];
  changes: string[];
  nextDirection: string;
  cautions: string[];
  homework: string;
  mediaCount: number;
  reportUrl: string;
  summaryText?: string;
  nextPlanText?: string;
  reviewReason?: string;
  cancelled?: boolean;
  submitted?: boolean;
}

type NotionBlock = Record<string, unknown>;
type RichText = { type: "text"; text: { content: string } };
type TextBlockType = "paragraph" | "heading_3" | "bulleted_list_item" | "callout";

const RICH_TEXT_LIMIT = 1900;
const ARRAY_LIMIT = 100;

function hasText(value: string | undefined): value is string {
  return typeof value === "string" && value.trim() !== "" && value.trim() !== "-";
}

function richText(value: string): RichText[] {
  const parts: RichText[] = [];
  let content = "";
  // Iterate code points so a chunk never splits a UTF-16 surrogate pair.
  for (const character of value) {
    if (content.length + character.length > RICH_TEXT_LIMIT) {
      parts.push({ type: "text", text: { content } });
      content = "";
    }
    content += character;
  }
  if (content) parts.push({ type: "text", text: { content } });
  return parts;
}

function textBlocks(type: TextBlockType, value: string, properties: Record<string, unknown> = {}): NotionBlock[] {
  const parts = richText(value);
  const blocks: NotionBlock[] = [];
  // Long fields also need multiple blocks once the rich_text array reaches 100 items.
  for (let index = 0; index < parts.length; index += ARRAY_LIMIT) {
    blocks.push({
      object: "block",
      type,
      [type]: { rich_text: parts.slice(index, index + ARRAY_LIMIT), ...properties },
    });
  }
  return blocks;
}

function field(label: string, value: string | undefined): NotionBlock[] {
  return hasText(value) ? textBlocks("bulleted_list_item", `${label}: ${value}`) : [];
}

function toggle(title: string, children: NotionBlock[]): NotionBlock[] {
  const blocks: NotionBlock[] = [];
  for (let index = 0; index < children.length; index += ARRAY_LIMIT) {
    blocks.push({
      object: "block",
      type: "toggle",
      toggle: { rich_text: richText(title), children: children.slice(index, index + ARRAY_LIMIT) },
    });
  }
  return blocks;
}

function statusText(input: PrivateNotionPresentationInput, hasReport: boolean): string {
  const stage = input.stage.trim();
  if (hasText(input.reviewReason) || ["needs_review", "확인필요", "확인 필요"].includes(stage)) {
    return "확인 필요";
  }
  if (input.cancelled || ["cancelled", "취소"].includes(stage)) return "취소";
  const labels: Record<string, string> = {
    recording: "수업 기록대기",
    report_review: "리포트 확인",
    delivered: "리포트 발송완료",
  };
  const label = Object.hasOwn(labels, stage) ? labels[stage] : hasText(input.stage) ? input.stage : "";
  const pending = [
    "",
    "수업 기록대기",
    "수업 기록 대기",
    "리포트 생성중",
    "리포트 생성 중",
    "리포트 생성 대기 중",
  ].includes(label);
  if (hasReport && pending) return "리포트 생성완료";
  if (input.submitted && ["", "수업 기록대기", "수업 기록 대기"].includes(label)) {
    return "수업 기록 제출완료";
  }
  return label || "수업 기록대기";
}

/** Pure display projection; page identity, legacy content and source selection belong to the caller. */
export function compactPrivateNotionBlocks(input: PrivateNotionPresentationInput): NotionBlock[] {
  const focusAreas = input.focusAreas.filter(hasText);
  const changes = input.changes.filter(hasText);
  const cautions = input.cautions.filter(hasText);
  const hasMedia = Number.isInteger(input.mediaCount) && input.mediaCount > 0;
  const hasReport = hasText(input.reportUrl);
  const review = hasText(input.reviewReason) || ["needs_review", "확인필요", "확인 필요"].includes(input.stage.trim());
  const status = statusText(input, hasReport);
  // ICU versions differ on Korean day periods; projection hashes must not.
  const lessonTime = input.lessonTime.replace(/\bAM\b/gi, "오전").replace(/\bPM\b/gi, "오후");
  const blocks = textBlocks("callout", status, { color: review || hasReport ? "blue_background" : "gray_background" });
  const metadata = [
    hasText(lessonTime) ? `수업: ${lessonTime}` : "",
    hasText(input.staffName) ? `담당: ${input.staffName}` : "",
  ].filter(hasText);
  if (metadata.length) blocks.push(...textBlocks("paragraph", metadata.join(" / ")));
  if (hasText(input.reviewReason)) {
    blocks.push(...textBlocks("callout", input.reviewReason, { color: "blue_background" }));
  }

  const recordBlocks = [
    ...field("진행 부위", focusAreas.join(", ")),
    ...field("확인한 변화", changes.join(", ")),
    ...field("다음 방향", input.nextDirection),
  ];
  const hasNarrative = hasText(input.summaryText) || hasText(input.nextPlanText);
  const hasOptionalRecord = cautions.length > 0 || hasText(input.homework) || hasMedia;
  if (!recordBlocks.length && !hasNarrative && !hasOptionalRecord && !hasReport) {
    recordBlocks.push(
      ...textBlocks("paragraph", input.submitted ? "수업 기록이 제출되었습니다." : "아직 수업 기록이 없습니다."),
    );
  }
  blocks.push(...textBlocks("heading_3", "오늘 기록"), ...recordBlocks);

  // Only omit exact duplicates; never shorten or synthesize narrative from keywords.
  const shown = new Set([...focusAreas, ...changes, focusAreas.join(", "), changes.join(", "), input.nextDirection]);
  const narratives: [string, string | undefined][] = [
    ["수업 요약", input.summaryText],
    ["다음 수업 계획", input.nextPlanText],
  ];
  for (const [title, value] of narratives) {
    if (!hasText(value) || shown.has(value)) continue;
    blocks.push(...textBlocks("heading_3", title), ...textBlocks("paragraph", value));
    shown.add(value);
  }

  blocks.push(
    ...toggle("회원 사전설문 참고", [
      ...field("목표", input.intake.goal),
      ...field("신경 부위", input.intake.focusArea),
      ...field("운동 수준", input.intake.exerciseLevel),
      ...(input.intake.hasCaution ? textBlocks("paragraph", "사전설문 주의 내용 확인 필요") : []),
    ]),
  );
  blocks.push(...toggle("홈워크", hasText(input.homework) ? textBlocks("paragraph", input.homework) : []));
  blocks.push(
    ...toggle(
      "주의사항",
      cautions.flatMap((value) => textBlocks("bulleted_list_item", value)),
    ),
  );
  blocks.push(...toggle("수업 자료", hasMedia ? textBlocks("paragraph", `첨부: ${input.mediaCount}개`) : []));

  if (hasReport) {
    blocks.push({
      object: "block",
      type: "bookmark",
      bookmark: { url: input.reportUrl, caption: richText("회원 리포트 보기") },
    });
  }
  return blocks;
}
